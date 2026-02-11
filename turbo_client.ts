import { basename, join, relative } from "jsr:@std/path";
import { walk } from "jsr:@std/fs";
import {
  HarmonyWebDavClient as WebDavClient,
  loadRcloneConfig,
} from "./drive_panel.ts";

async function uploadFolderParallel(
  client: WebDavClient,
  localFolder: string,
  remoteFolder: string,
  concurrency = 4,
): Promise<void> {
  const filesToUpload: { local: string; remote: string }[] = [];

  for await (const entry of walk(localFolder)) {
    if (!entry.isFile) continue;
    const relPath = relative(localFolder, entry.path).replace(/\\/g, "/");
    filesToUpload.push({
      local: entry.path,
      remote: join(remoteFolder, relPath).replace(/\\/g, "/"),
    });
  }

  let cursor = 0;
  let completed = 0;

  const worker = async () => {
    while (true) {
      const task = filesToUpload[cursor++];
      if (!task) return;

      const slash = task.remote.lastIndexOf("/");
      const remoteDir = slash >= 0 ? task.remote.slice(0, slash) : "";
      if (remoteDir) await client.mkdir(remoteDir);

      await client.upload(task.local, task.remote);
      completed++;
      console.log(`[${completed}/${filesToUpload.length}] ✅ ${basename(task.local)}`);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
}

if (import.meta.main) {
  const remoteName = Deno.env.get("REMOTE_NAME") ?? "myalist";
  const localDir = Deno.env.get("LOCAL_DIR") ?? "./downloads";
  const remoteDir = Deno.env.get("REMOTE_DIR") ?? "/Backup/Videos";
  const concurrency = Number(Deno.env.get("CONCURRENCY") ?? "5");

  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
  const configPath = join(home, ".config", "rclone", "rclone.conf");

  const config = await loadRcloneConfig(configPath, remoteName);
  if (!config) {
    console.error(`❌ Remote [${remoteName}] was not found`);
    Deno.exit(1);
  }

  console.log("🚀 Harmonized turbo mode is active...");
  await uploadFolderParallel(new WebDavClient(config), localDir, remoteDir, concurrency);
}
