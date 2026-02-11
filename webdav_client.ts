import {
  HarmonyWebDavClient as WebDavClient,
  loadRcloneConfig,
  type RemoteConfig,
} from "./drive_panel.ts";

export { loadRcloneConfig, WebDavClient };
export type { RemoteConfig };

if (import.meta.main) {
  const config: RemoteConfig = {
    url: Deno.env.get("WEBDAV_URL") ?? "https://alist.example.com/dav",
    user: Deno.env.get("WEBDAV_USER") ?? "admin",
    pass: Deno.env.get("WEBDAV_PASS") ?? "password123",
  };

  const client = new WebDavClient(config);

  console.log("WebDAV client aktif (mode harmonized). Gunakan drive_panel.ts untuk panel lengkap.");
  console.log("Contoh upload: await client.upload('./contoh_file.zip', '/folder_tujuan/')");
  console.log("Contoh download: await client.download('/folder_remote/file.mp4', './file_hasil.mp4')");

  void client;
}
