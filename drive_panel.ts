import { decodeBase64, encodeBase64 } from "jsr:@std/encoding/base64";
import { walk } from "jsr:@std/fs";
import { parse } from "jsr:@std/ini";
import { basename, join, relative } from "jsr:@std/path";
import { crypto } from "jsr:@std/crypto";

export interface RemoteConfig {
  url: string;
  user: string;
  pass: string;
  type?: string;
}

export interface PanelLoginConfig {
  username: string;
  password: string;
}

const RCLONE_KEY_HEX = "9c935b48730a554d6bfd7c63c886a92bd390198eb8128afbf4de162b8b95f638";

async function rcloneReveal(obscured: string): Promise<string> {
  if (!obscured) return "";

  try {
    const ciphertext = decodeBase64(obscured.replace(/-/g, "+").replace(/_/g, "/"));
    if (ciphertext.length < 16) return obscured;

    const iv = ciphertext.slice(0, 16);
    const data = ciphertext.slice(16);

    const keyBytes = new Uint8Array(
      RCLONE_KEY_HEX.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
    );

    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-CTR" },
      false,
      ["decrypt"],
    );

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-CTR", counter: iv, length: 64 },
      key,
      data,
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch {
    return obscured;
  }
}

export async function loadRcloneConfig(
  configPath: string,
  remoteName: string,
): Promise<RemoteConfig | null> {
  try {
    const text = await Deno.readTextFile(configPath);
    const data = parse(text) as Record<string, Record<string, string>>;
    const remote = data[remoteName];

    if (!remote) return null;

    return {
      url: remote.url,
      user: remote.user,
      pass: await rcloneReveal(remote.pass),
      type: remote.type,
    };
  } catch {
    return null;
  }
}

export class HarmonyWebDavClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: RemoteConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
    this.authHeader = `Basic ${encodeBase64(`${config.user}:${config.pass}`)}`;
  }

  private cleanPath(path: string): string {
    return path.replace(/^\//, "").split("/").map(encodeURIComponent).join("/");
  }

  async mkdir(remotePath: string): Promise<void> {
    const targetUrl = `${this.baseUrl}/${this.cleanPath(remotePath)}`;
    await fetch(targetUrl, {
      method: "MKCOL",
      headers: { Authorization: this.authHeader },
    }).catch(() => undefined);
  }

  async getRemoteSize(remotePath: string): Promise<number | null> {
    const targetUrl = `${this.baseUrl}/${this.cleanPath(remotePath)}`;
    try {
      const response = await fetch(targetUrl, {
        method: "HEAD",
        headers: { Authorization: this.authHeader },
      });

      if (!response.ok) return null;

      const length = response.headers.get("Content-Length");
      return length ? parseInt(length, 10) : null;
    } catch {
      return null;
    }
  }

  async upload(localPath: string, remotePath: string): Promise<void> {
    const normalizedRemote = remotePath.endsWith("/")
      ? join(remotePath, basename(localPath)).replace(/\\/g, "/")
      : remotePath;

    const targetUrl = `${this.baseUrl}/${this.cleanPath(normalizedRemote)}`;
    const file = await Deno.open(localPath, { read: true });

    try {
      const stat = await file.stat();
      const response = await fetch(targetUrl, {
        method: "PUT",
        headers: {
          Authorization: this.authHeader,
          "Content-Length": stat.size.toString(),
          "Content-Type": "application/octet-stream",
        },
        body: file.readable,
      });

      if (!response.ok && response.status !== 201 && response.status !== 204) {
        throw new Error(`Upload gagal: ${response.status} ${response.statusText}`);
      }
    } finally {
      file.close();
    }
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    const targetUrl = `${this.baseUrl}/${this.cleanPath(remotePath)}`;
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: { Authorization: this.authHeader },
    });

    if (!response.ok || !response.body) {
      throw new Error(`Download gagal: ${response.status} ${response.statusText}`);
    }

    const file = await Deno.open(localPath, { write: true, create: true, truncate: true });
    try {
      await response.body.pipeTo(file.writable);
    } finally {
      file.close();
    }
  }
}

interface SyncTask {
  local: string;
  remote: string;
  size: number;
}

export interface SyncReport {
  processed: number;
  uploaded: number;
  skipped: number;
  failed: number;
  elapsedMs: number;
}

export async function smartSync(
  client: HarmonyWebDavClient,
  localFolder: string,
  remoteFolder: string,
  concurrency = 4,
): Promise<SyncReport> {
  const files: SyncTask[] = [];

  for await (const entry of walk(localFolder)) {
    if (!entry.isFile) continue;
    const stat = await Deno.stat(entry.path);
    files.push({
      local: entry.path,
      remote: join(remoteFolder, relative(localFolder, entry.path)).replace(/\\/g, "/"),
      size: stat.size,
    });
  }

  let cursor = 0;
  let processed = 0;
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  const start = Date.now();

  const worker = async () => {
    while (true) {
      const task = files[cursor++];
      if (!task) return;

      try {
        const slashIndex = task.remote.lastIndexOf("/");
        const remoteDir = slashIndex >= 0 ? task.remote.slice(0, slashIndex) : "";
        if (remoteDir) await client.mkdir(remoteDir);

        const remoteSize = await client.getRemoteSize(task.remote);
        if (remoteSize !== null && remoteSize === task.size) {
          skipped++;
          console.log(`[SKIP] ${basename(task.local)} (already synchronized)`);
        } else {
          await client.upload(task.local, task.remote);
          uploaded++;
          console.log(`[UP]   ${basename(task.local)}`);
        }
      } catch (error) {
        failed++;
        console.error(`[ERR]  ${basename(task.local)}:`, error);
      } finally {
        processed++;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  return {
    processed,
    uploaded,
    skipped,
    failed,
    elapsedMs: Date.now() - start,
  };
}

export class DrivePowerPanel {
  private readonly loginConfig: PanelLoginConfig;
  private readonly client: HarmonyWebDavClient;

  constructor(client: HarmonyWebDavClient, loginConfig?: Partial<PanelLoginConfig>) {
    this.client = client;
    this.loginConfig = {
      username: loginConfig?.username ?? Deno.env.get("PANEL_USER") ?? "admin",
      password: loginConfig?.password ?? Deno.env.get("PANEL_PASS") ?? "admin123",
    };
  }

  private ask(question: string): string {
    return Deno.prompt(question)?.trim() ?? "";
  }

  private renderHero(): void {
    console.log("\n⚡ Harmony Drive Panel ⚡");
    console.log("Satu script terpadu: login, upload, download, smart sync, dan telemetry.");
    console.log("Dirancang untuk workflow cepat, hemat bandwidth, dan otomatis skip file sama.\n");
  }

  async login(): Promise<boolean> {
    this.renderHero();
    const username = this.ask("Username");
    const password = this.ask("Password");

    if (username !== this.loginConfig.username || password !== this.loginConfig.password) {
      console.error("❌ Login gagal. Cek PANEL_USER/PANEL_PASS atau kredensial default.");
      return false;
    }

    console.log("✅ Login berhasil. Selamat datang di panel power!\n");
    return true;
  }

  async start(): Promise<void> {
    const ok = await this.login();
    if (!ok) return;

    while (true) {
      console.log("=== MENU PANEL ===");
      console.log("1) Upload file");
      console.log("2) Download file");
      console.log("3) Smart sync folder (parallel + resume)");
      console.log("4) Exit");

      const selected = this.ask("Pilih menu");
      if (selected === "1") {
        const localPath = this.ask("Path file lokal");
        const remotePath = this.ask("Path remote tujuan");
        await this.client.upload(localPath, remotePath);
        console.log("✅ Upload selesai.\n");
      } else if (selected === "2") {
        const remotePath = this.ask("Path file remote");
        const localPath = this.ask("Path file lokal output");
        await this.client.download(remotePath, localPath);
        console.log("✅ Download selesai.\n");
      } else if (selected === "3") {
        const localFolder = this.ask("Folder lokal sumber");
        const remoteFolder = this.ask("Folder remote tujuan");
        const concurrency = parseInt(this.ask("Concurrency (default 4)") || "4", 10);

        const report = await smartSync(this.client, localFolder, remoteFolder, Number.isNaN(concurrency) ? 4 : concurrency);
        console.log("\n🏁 Smart sync selesai!");
        console.log(`Processed: ${report.processed}`);
        console.log(`Uploaded : ${report.uploaded}`);
        console.log(`Skipped  : ${report.skipped}`);
        console.log(`Failed   : ${report.failed}`);
        console.log(`Durasi   : ${(report.elapsedMs / 1000).toFixed(2)} detik\n`);
      } else if (selected === "4") {
        console.log("👋 Sampai jumpa.");
        return;
      } else {
        console.log("⚠️ Menu tidak dikenal.\n");
      }
    }
  }
}

if (import.meta.main) {
  const remoteName = Deno.env.get("REMOTE_NAME") ?? "myalist";
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
  const configPath = Deno.env.get("RCLONE_CONFIG") ?? join(home, ".config", "rclone", "rclone.conf");

  const config = await loadRcloneConfig(configPath, remoteName);
  if (!config) {
    console.error(`❌ Remote [${remoteName}] tidak ditemukan dari ${configPath}`);
    Deno.exit(1);
  }

  const client = new HarmonyWebDavClient(config);
  const panel = new DrivePowerPanel(client);
  await panel.start();
}
