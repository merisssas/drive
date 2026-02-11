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

  console.log("WebDAV client is active (harmonized mode). Use drive_panel.ts for the full panel experience.");
  console.log("Example upload: await client.upload('./sample_file.zip', '/destination_folder/')");
  console.log("Example download: await client.download('/remote_folder/file.mp4', './downloaded_file.mp4')");

  void client;
}
