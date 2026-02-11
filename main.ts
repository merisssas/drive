const APP_NAME = "Harmony Drive";

const CLI_SCRIPTS = ["drive_panel.ts", "smart_sync.ts", "turbo_client.ts"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function renderHomePage(): string {
  const cliItems = CLI_SCRIPTS.map((script) => `<li><code>${script}</code></li>`).join("\n");

  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${APP_NAME}</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at top, #16243e, #0b1120 60%);
        color: #e5e7eb;
      }

      main {
        width: min(720px, calc(100vw - 2rem));
        background: rgba(15, 23, 42, 0.88);
        border: 1px solid rgba(148, 163, 184, 0.25);
        border-radius: 16px;
        padding: 2rem;
        box-shadow: 0 18px 50px rgba(2, 6, 23, 0.5);
      }

      h1 {
        margin: 0 0 0.5rem;
        font-size: clamp(1.5rem, 2vw, 2rem);
      }

      p {
        margin: 0.25rem 0 1rem;
        color: #cbd5e1;
      }

      .badge {
        display: inline-block;
        margin-top: 0.25rem;
        margin-bottom: 1rem;
        padding: 0.3rem 0.6rem;
        border-radius: 999px;
        background: rgba(34, 197, 94, 0.2);
        border: 1px solid rgba(34, 197, 94, 0.45);
        color: #bbf7d0;
        font-weight: 600;
        font-size: 0.875rem;
      }

      ul {
        margin: 0.5rem 0 0;
        padding-left: 1.25rem;
      }

      code {
        color: #93c5fd;
      }

      .footer {
        margin-top: 1.5rem;
        padding-top: 1rem;
        border-top: 1px solid rgba(148, 163, 184, 0.25);
        font-size: 0.9rem;
      }

      a {
        color: #7dd3fc;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${APP_NAME}</h1>
      <p>Deployment entrypoint aktif. Repositori ini berfokus pada utilitas CLI untuk sinkronisasi WebDAV.</p>
      <span class="badge">Status: running</span>

      <h2>Endpoint tersedia</h2>
      <ul>
        <li><a href="/">/</a></li>
        <li><a href="/health">/health</a> (JSON health check)</li>
      </ul>

      <h2>CLI scripts</h2>
      <ul>
        ${cliItems}
      </ul>

      <div class="footer">
        Cek endpoint kesehatan: <a href="/health">/health</a>
      </div>
    </main>
  </body>
</html>`;
}

Deno.serve((request) => {
  const { pathname } = new URL(request.url);

  if (pathname === "/health") {
    return json({ status: "ok" });
  }

  if (pathname === "/") {
    return html(renderHomePage());
  }

  return json({ error: "Not found" }, 404);
});
