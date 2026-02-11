import { encodeBase64 } from "jsr:@std/encoding/base64";
import { basename, join } from "jsr:@std/path";
import { parse } from "jsr:@std/ini";

/**
 * Konfigurasi remote WebDAV.
 */
export interface RemoteConfig {
  url: string;
  user: string;
  pass: string;
  type?: string;
}

/**
 * Klien WebDAV sederhana berbasis stream untuk upload/download file besar.
 */
export class WebDavClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: RemoteConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
    const credentials = `${config.user}:${config.pass}`;
    this.authHeader = `Basic ${encodeBase64(credentials)}`;
  }

  /**
   * Download file dari remote ke local menggunakan streaming.
   */
  async download(remotePath: string, localPath: string): Promise<void> {
    const targetUrl = `${this.baseUrl}/${this.cleanPath(remotePath)}`;
    console.log(`⬇️  Downloading: ${targetUrl} -> ${localPath}`);

    const response = await fetch(targetUrl, {
      method: "GET",
      headers: { Authorization: this.authHeader },
    });

    if (!response.ok) {
      throw new Error(`Gagal download: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("Body response kosong");
    }

    const file = await Deno.open(localPath, {
      write: true,
      create: true,
      truncate: true,
    });

    try {
      await response.body.pipeTo(file.writable);
      console.log("✅ Download selesai!");
    } finally {
      file.close();
    }
  }

  /**
   * Upload file dari local ke remote menggunakan streaming.
   */
  async upload(localPath: string, remotePath: string): Promise<void> {
    if (remotePath.endsWith("/")) {
      remotePath = join(remotePath, basename(localPath));
    }

    const targetUrl = `${this.baseUrl}/${this.cleanPath(remotePath)}`;
    console.log(`⬆️  Uploading: ${localPath} -> ${targetUrl}`);

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
        throw new Error(`Gagal upload: ${response.status} ${response.statusText}`);
      }

      console.log("✅ Upload selesai!");
    } finally {
      file.close();
    }
  }

  private cleanPath(path: string): string {
    return path
      .replace(/^\//, "")
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }
}

/**
 * Membaca config rclone (.conf) lalu mengambil section remote tertentu.
 *
 * Catatan: rclone biasanya menyimpan pass dalam bentuk obfuscated.
 * Untuk dipakai langsung di skrip ini, nilai pass harus berupa password asli.
 */
export async function loadRcloneConfig(
  configPath: string,
  remoteName: string,
): Promise<RemoteConfig | null> {
  try {
    const text = await Deno.readTextFile(configPath);
    const data = parse(text) as Record<string, Record<string, string>>;

    if (!data[remoteName]) {
      console.error(`Remote [${remoteName}] tidak ditemukan di config.`);
      return null;
    }

    const remote = data[remoteName];
    return {
      url: remote.url,
      user: remote.user,
      pass: remote.pass,
      type: remote.type,
    };
  } catch (error) {
    console.error("Gagal membaca file config:", error);
    return null;
  }
}

if (import.meta.main) {
  const config: RemoteConfig = {
    url: Deno.env.get("WEBDAV_URL") ?? "https://alist.example.com/dav",
    user: Deno.env.get("WEBDAV_USER") ?? "admin",
    pass: Deno.env.get("WEBDAV_PASS") ?? "password123",
    type: "webdav",
  };

  const client = new WebDavClient(config);

  console.log("WebDAV client siap digunakan.");
  console.log("Contoh:");
  console.log("- await client.upload('./contoh_file.zip', '/folder_tujuan/')");
  console.log("- await client.download('/folder_remote/file.mp4', './file_hasil.mp4')");

  // Simpan agar variabel tidak dianggap unused saat dijalankan tanpa aksi.
  void client;
}
