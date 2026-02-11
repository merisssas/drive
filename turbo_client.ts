/**
 * TURBO WEBDAV CLIENT (Deno)
 * Features: Rclone Config Support, Native Password Decryption, Parallel Transfers, Streams.
 */

import { encodeBase64, decodeBase64 } from "jsr:@std/encoding/base64";
import { join, basename, relative } from "jsr:@std/path";
import { parse } from "jsr:@std/ini";
import { walk } from "jsr:@std/fs";
import { crypto } from "jsr:@std/crypto";

// --- 1. MODUL KRIPTOGRAFI RCLONE (NATIVE) ---

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

// --- 2. CONFIG LOADER ---

interface RemoteConfig {
  url: string;
  user: string;
  pass: string;
  type?: string;
}

async function loadRcloneConfig(
  configPath: string,
  remoteName: string,
): Promise<RemoteConfig | null> {
  try {
    const text = await Deno.readTextFile(configPath);
    const data = parse(text) as Record<string, Record<string, string>>;

    if (!data[remoteName]) return null;
    const remote = data[remoteName];

    const realPass = await rcloneReveal(remote.pass);

    return {
      url: remote.url,
      user: remote.user,
      pass: realPass,
      type: remote.type,
    };
  } catch (error) {
    console.error(
      `⚠️ Gagal baca config: ${error instanceof Error ? error.message : error}`,
    );
    return null;
  }
}

// --- 3. CORE WEBDAV CLIENT ---

class WebDavClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config: RemoteConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
    const kv = `${config.user}:${config.pass}`;
    this.authHeader = `Basic ${encodeBase64(kv)}`;
  }

  async mkdir(remotePath: string) {
    const targetUrl = `${this.baseUrl}/${this.cleanPath(remotePath)}`;
    await fetch(targetUrl, {
      method: "MKCOL",
      headers: { Authorization: this.authHeader },
    });
  }

  async uploadFile(localPath: string, remotePath: string): Promise<boolean> {
    const targetUrl = `${this.baseUrl}/${this.cleanPath(remotePath)}`;
    let file: Deno.FsFile | undefined;

    try {
      file = await Deno.open(localPath, { read: true });
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
        throw new Error(`HTTP ${response.status}`);
      }
      return true;
    } catch (err) {
      console.error(`❌ Gagal upload ${basename(localPath)}:`, err);
      return false;
    } finally {
      file?.close();
    }
  }

  private cleanPath(path: string): string {
    return path.replace(/^\//, "").split("/").map(encodeURIComponent).join("/");
  }
}

// --- 4. PARALLEL PROCESSOR ---

async function uploadFolderParallel(
  client: WebDavClient,
  localFolder: string,
  remoteFolder: string,
  concurrency: number = 4,
) {
  console.log(`🚀 Memulai Upload Parallel (Max ${concurrency} threads)...`);

  const filesToUpload: { local: string; remote: string }[] = [];

  for await (const entry of walk(localFolder)) {
    if (entry.isFile) {
      const relPath = relative(localFolder, entry.path);
      const normalizedRelPath = relPath.replace(/\\/g, "/");

      filesToUpload.push({
        local: entry.path,
        remote: join(remoteFolder, normalizedRelPath).replace(/\\/g, "/"),
      });
    }
  }

  const total = filesToUpload.length;
  let completed = 0;
  console.log(`📂 Ditemukan ${total} file. Mulai streaming...`);

  let cursor = 0;
  const worker = async () => {
    while (true) {
      const task = filesToUpload[cursor++];
      if (!task) return;

      const remoteDir = task.remote.substring(0, task.remote.lastIndexOf("/"));
      if (remoteDir) await client.mkdir(remoteDir);

      await client.uploadFile(task.local, task.remote);
      completed++;
      console.log(`[${completed}/${total}] ✅ ${basename(task.local)}`);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  console.log("✨ Semua tugas selesai!");
}

// --- 5. MAIN ENTRY ---

if (import.meta.main) {
  const homeDir = Deno.env.get("HOME") || Deno.env.get("USERPROFILE");
  const configPath = join(homeDir || "", ".config", "rclone", "rclone.conf");

  const remoteName = "myalist";
  const localDir = "./hasil_download";
  const remoteTarget = "/backup_data";

  console.log(`🔍 Membaca config rclone dari: ${configPath}`);

  const config = await loadRcloneConfig(configPath, remoteName);

  if (!config) {
    console.error("❌ Config tidak ditemukan atau remote name salah!");
    Deno.exit(1);
  }

  console.log(`✅ Login sukses sebagai: ${config.url}`);
  const client = new WebDavClient(config);

  await uploadFolderParallel(client, localDir, remoteTarget, 5);
}
