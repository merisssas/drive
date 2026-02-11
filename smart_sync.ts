/**
 * DENO SMART SYNC CLIENT (WebDAV)
 * Features: Rclone Decrypt, Parallel Uploads, Smart Skip (Resume), Streaming.
 */

import { decodeBase64, encodeBase64 } from "jsr:@std/encoding/base64";
import { walk } from "jsr:@std/fs";
import { parse } from "jsr:@std/ini";
import { basename, join, relative } from "jsr:@std/path";
import { crypto } from "jsr:@std/crypto";

// ==========================================
// 1. MODUL KRIPTOGRAFI RCLONE (JANGAN DIUBAH)
// ==========================================
const RCLONE_KEY_HEX = "9c935b48730a554d6bfd7c63c886a92bd390198eb8128afbf4de162b8b95f638";

async function rcloneReveal(obscured: string): Promise<string> {
  if (!obscured) return "";

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
}

// ==========================================
// 2. CONFIG LOADER
// ==========================================
interface RemoteConfig {
  url: string;
  user: string;
  pass: string;
}

async function loadRcloneConfig(
  configPath: string,
  remoteName: string,
): Promise<RemoteConfig | null> {
  try {
    const text = await Deno.readTextFile(configPath);
    const data = parse(text) as Record<string, Record<string, string>>;
    if (!data[remoteName]) return null;

    return {
      url: data[remoteName].url,
      user: data[remoteName].user,
      pass: await rcloneReveal(data[remoteName].pass),
    };
  } catch {
    return null;
  }
}

// ==========================================
// 3. CORE WEBDAV CLIENT
// ==========================================
class WebDavClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: RemoteConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
    this.authHeader = `Basic ${encodeBase64(`${config.user}:${config.pass}`)}`;
  }

  private cleanPath(path: string): string {
    return path.replace(/^\//, "").split("/").map(encodeURIComponent).join("/");
  }

  // Cek ukuran file di remote (Head Request)
  async getRemoteSize(remotePath: string): Promise<number | null> {
    const targetUrl = `${this.baseUrl}/${this.cleanPath(remotePath)}`;
    try {
      const res = await fetch(targetUrl, {
        method: "HEAD",
        headers: { Authorization: this.authHeader },
      });

      if (res.status === 200) {
        const size = res.headers.get("Content-Length");
        return size ? parseInt(size, 10) : null;
      }

      return null; // File tidak ditemukan atau error
    } catch {
      return null;
    }
  }

  async mkdir(remotePath: string): Promise<void> {
    const targetUrl = `${this.baseUrl}/${this.cleanPath(remotePath)}`;
    await fetch(targetUrl, {
      method: "MKCOL",
      headers: { Authorization: this.authHeader },
    }).catch(() => {
      // Biarkan saja jika folder sudah ada atau server menolak MKCOL berulang.
    });
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    const targetUrl = `${this.baseUrl}/${this.cleanPath(remotePath)}`;
    const file = await Deno.open(localPath, { read: true });

    try {
      const stat = await file.stat();

      const res = await fetch(targetUrl, {
        method: "PUT",
        headers: {
          Authorization: this.authHeader,
          "Content-Length": stat.size.toString(),
        },
        body: file.readable,
      });

      if (!res.ok && res.status !== 201 && res.status !== 204) {
        throw new Error(res.statusText);
      }
    } finally {
      file.close();
    }
  }
}

// ==========================================
// 4. SMART SYNC ENGINE (PARALLEL & RESUME)
// ==========================================
interface SyncTask {
  local: string;
  remote: string;
  size: number;
}

async function smartSync(
  client: WebDavClient,
  localFolder: string,
  remoteFolder: string,
  concurrency: number = 4,
): Promise<void> {
  console.log(`🚀 Starting Smart Sync (Threads: ${concurrency})...`);

  const files: SyncTask[] = [];

  // 1. Scanning Local Files
  console.log("🔍 Scanning local files...");
  for await (const entry of walk(localFolder)) {
    if (entry.isFile) {
      const relPath = relative(localFolder, entry.path).replace(/\\/g, "/");
      const stat = await Deno.stat(entry.path);
      files.push({
        local: entry.path,
        remote: join(remoteFolder, relPath).replace(/\\/g, "/"),
        size: stat.size,
      });
    }
  }

  console.log(`📂 Total Local Files: ${files.length}`);

  let cursor = 0;
  let processed = 0;
  let skipped = 0;
  let uploaded = 0;
  let errored = 0;

  const worker = async () => {
    while (true) {
      const task = files[cursor++];
      if (!task) return;

      try {
        const slashIndex = task.remote.lastIndexOf("/");
        const remoteDir = slashIndex >= 0 ? task.remote.slice(0, slashIndex) : "";
        if (remoteDir) await client.mkdir(remoteDir);

        // --- LOGIKA UTAMA SMART RESUME ---
        const remoteSize = await client.getRemoteSize(task.remote);

        if (remoteSize !== null && remoteSize === task.size) {
          skipped++;
          console.log(`[SKIP] ⏭️  ${basename(task.local)} (Sama persis)`);
        } else {
          await client.uploadFile(task.local, task.remote);
          uploaded++;
          console.log(`[UP]   ✅ ${basename(task.local)}`);
        }
      } catch (err) {
        errored++;
        console.error(`[ERR]  ❌ ${basename(task.local)}:`, err);
      } finally {
        processed++;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  console.log("-".repeat(30));
  console.log(
    `🏁 Selesai! Uploaded: ${uploaded} | Skipped: ${skipped} | Errors: ${errored} | Processed: ${processed}`,
  );
}

// ==========================================
// 5. MAIN CONFIGURATION
// ==========================================
if (import.meta.main) {
  // --- KONFIGURASI USER ---
  const REMOTE_NAME = "myalist"; // Nama di dalam [] di rclone.conf
  const LOCAL_DIR = "./downloads"; // Folder lokal sumber
  const REMOTE_DIR = "/Backup/Videos"; // Folder tujuan di AList/Nextcloud
  // ------------------------

  // Auto-detect lokasi rclone config (Linux/Mac/Windows)
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE");
  const configPath = join(home || "", ".config", "rclone", "rclone.conf");

  console.log(`Reading Config: ${configPath}`);
  const config = await loadRcloneConfig(configPath, REMOTE_NAME);

  if (!config) {
    console.error(`❌ Gagal! Pastikan remote [${REMOTE_NAME}] ada di rclone.conf`);
    Deno.exit(1);
  }

  const client = new WebDavClient(config);

  // Jalankan Sync (5 threads)
  await smartSync(client, LOCAL_DIR, REMOTE_DIR, 5);
}
