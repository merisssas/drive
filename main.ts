const APP_NAME = "Harmony Drive";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

Deno.serve((request) => {
  const { pathname } = new URL(request.url);

  if (pathname === "/health") {
    return json({ status: "ok" });
  }

  if (pathname === "/") {
    return json({
      app: APP_NAME,
      message:
        "Deployment entrypoint is running. This repository primarily contains CLI utilities for WebDAV sync.",
      endpoints: ["/", "/health"],
      cli_scripts: ["drive_panel.ts", "smart_sync.ts", "turbo_client.ts"],
    });
  }

  return json({ error: "Not found" }, 404);
});
