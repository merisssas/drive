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

const DEFAULT_RCLONE_KEY_HEX = "9c935b48730a554d6bfd7c63c886a92bd390198eb8128afbf4de162b8b95f638";
const RCLONE_KEY_HEX = Deno.env.get("RCLONE_KEY_HEX") ?? DEFAULT_RCLONE_KEY_HEX;

function normalizeRemotePath(...segments: string[]): string {
  return join(...segments).replace(/\\/g, "/");
}

function normalizeEtag(etag: string | null): string | null {
  if (!etag) return null;
  return etag.replace(/\"/g, "").trim() || null;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function md5FromPath(path: string): Promise<string> {
  const data = await Deno.readFile(path);
  const digest = await crypto.subtle.digest("MD5", data);
  return bytesToHex(new Uint8Array(digest));
}

interface RemoteMetadata {
  size: number | null;
  etag: string | null;
  lastModified: string | null;
}

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
  private readonly createdDirs = new Set<string>();
  private readonly pendingDirs = new Map<string, Promise<void>>();
  private readonly uploadTimeoutMs: number;

  constructor(config: RemoteConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
    this.authHeader = `Basic ${encodeBase64(`${config.user}:${config.pass}`)}`;
    this.uploadTimeoutMs = Number(Deno.env.get("UPLOAD_TIMEOUT_MS") ?? "30000");
  }

  private cleanPath(path: string): string {
    return path.replace(/^\//, "").split("/").map(encodeURIComponent).join("/");
  }

  async mkdir(remotePath: string): Promise<void> {
    const normalizedPath = remotePath.replace(/\/+/g, "/").replace(/\/$/, "");
    if (!normalizedPath || this.createdDirs.has(normalizedPath)) return;
    if (this.pendingDirs.has(normalizedPath)) {
      await this.pendingDirs.get(normalizedPath);
      return;
    }

    const targetUrl = `${this.baseUrl}/${this.cleanPath(remotePath)}`;
    const request = fetch(targetUrl, {
      method: "MKCOL",
      headers: { Authorization: this.authHeader },
    }).then((response) => {
      if ([201, 301, 405, 409].includes(response.status)) {
        this.createdDirs.add(normalizedPath);
      }
    }).catch(() => undefined).finally(() => {
      this.pendingDirs.delete(normalizedPath);
    });

    this.pendingDirs.set(normalizedPath, request);
    await request;
  }

  async getRemoteMetadata(remotePath: string): Promise<RemoteMetadata | null> {
    const targetUrl = `${this.baseUrl}/${this.cleanPath(remotePath)}`;
    try {
      const response = await fetch(targetUrl, {
        method: "HEAD",
        headers: { Authorization: this.authHeader },
      });

      if (!response.ok) return null;

      const length = response.headers.get("Content-Length");
      return {
        size: length ? parseInt(length, 10) : null,
        etag: normalizeEtag(response.headers.get("ETag")),
        lastModified: response.headers.get("Last-Modified"),
      };
    } catch {
      return null;
    }
  }

  async upload(localPath: string, remotePath: string): Promise<void> {
    const normalizedRemote = remotePath.endsWith("/")
      ? normalizeRemotePath(remotePath, basename(localPath))
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

  private pickFilenameFromLink(fileUrl: string, contentDisposition: string | null): string {
    if (contentDisposition) {
      const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
      if (utf8Match?.[1]) {
        try {
          return decodeURIComponent(utf8Match[1]).trim();
        } catch {
          return utf8Match[1].trim();
        }
      }

      const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
      if (filenameMatch?.[1]) return filenameMatch[1].trim();
    }

    try {
      const pathname = new URL(fileUrl).pathname;
      const name = basename(decodeURIComponent(pathname));
      if (name && name !== "/" && name !== ".") return name;
    } catch {
      // fallback handled below
    }

    return `download-${Date.now()}.bin`;
  }

  async uploadFromLink(fileUrl: string, remotePath: string): Promise<string> {
    const sourceResponse = await fetch(fileUrl, { signal: AbortSignal.timeout(this.uploadTimeoutMs) });
    if (!sourceResponse.ok || !sourceResponse.body) {
      throw new Error(`Gagal mengambil file dari link: ${sourceResponse.status} ${sourceResponse.statusText}`);
    }

    const fileName = this.pickFilenameFromLink(fileUrl, sourceResponse.headers.get("Content-Disposition"));
    const normalizedRemote = remotePath.endsWith("/")
      ? normalizeRemotePath(remotePath, fileName)
      : remotePath;

    const targetUrl = `${this.baseUrl}/${this.cleanPath(normalizedRemote)}`;
    const contentType = sourceResponse.headers.get("Content-Type") ?? "application/octet-stream";
    const contentLength = sourceResponse.headers.get("Content-Length");
    const response = await fetch(targetUrl, {
      method: "PUT",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": contentType,
        ...(contentLength ? { "Content-Length": contentLength } : {}),
      },
      body: sourceResponse.body,
      signal: AbortSignal.timeout(this.uploadTimeoutMs),
    });

    if (!response.ok && response.status !== 201 && response.status !== 204) {
      throw new Error(`Upload dari link gagal: ${response.status} ${response.statusText}`);
    }

    return normalizedRemote;
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
      remote: normalizeRemotePath(remoteFolder, relative(localFolder, entry.path)),
      size: stat.size,
    });
  }

  const queue = [...files];
  let processed = 0;
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  const start = Date.now();

  const worker = async () => {
    while (true) {
      const task = queue.shift();
      if (!task) return;

      try {
        const slashIndex = task.remote.lastIndexOf("/");
        const remoteDir = slashIndex >= 0 ? task.remote.slice(0, slashIndex) : "";
        if (remoteDir) await client.mkdir(remoteDir);

        const remoteMetadata = await client.getRemoteMetadata(task.remote);

        const etagAvailable = remoteMetadata?.etag;
        const sameSize = remoteMetadata?.size !== null && remoteMetadata?.size === task.size;
        const sameChecksum = etagAvailable
          ? (await md5FromPath(task.local)).toLowerCase() === etagAvailable.toLowerCase()
          : false;

        if (sameSize && sameChecksum) {
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
      console.log("4) Upload file dari link (URL)");
      console.log("5) Exit");

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
        const fileUrl = this.ask("Link file (URL)");
        const remotePath = this.ask("Path remote tujuan (boleh folder dengan akhiran /)");

        const slashIndex = remotePath.lastIndexOf("/");
        const remoteDir = remotePath.endsWith("/")
          ? remotePath.slice(0, -1)
          : slashIndex >= 0
          ? remotePath.slice(0, slashIndex)
          : "";

        if (remoteDir) await this.client.mkdir(remoteDir);

        const uploadedPath = await this.client.uploadFromLink(fileUrl, remotePath);
        console.log(`✅ Upload dari link selesai: ${uploadedPath}\n`);
      } else if (selected === "5") {
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
