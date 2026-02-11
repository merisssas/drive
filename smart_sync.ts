import { join } from "jsr:@std/path";
import {
  HarmonyWebDavClient as WebDavClient,
  loadRcloneConfig,
  smartSync,
} from "./drive_panel.ts";

if (import.meta.main) {
  const remoteName = Deno.env.get("REMOTE_NAME") ?? "myalist";
  const localDir = Deno.env.get("LOCAL_DIR") ?? "./downloads";
  const remoteDir = Deno.env.get("REMOTE_DIR") ?? "/Backup/Videos";
  const concurrency = Number(Deno.env.get("CONCURRENCY") ?? "5");

  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
  const configPath = Deno.env.get("RCLONE_CONFIG") ?? join(home, ".config", "rclone", "rclone.conf");

  const config = await loadRcloneConfig(configPath, remoteName);
  if (!config) {
    console.error(`❌ Remote [${remoteName}] was not found in ${configPath}`);
    Deno.exit(1);
  }

  const report = await smartSync(new WebDavClient(config), localDir, remoteDir, concurrency);
  console.log("🏁 Synchronization completed:", report);
}
