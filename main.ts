const APP_NAME = "Harmony Drive";

type DriveItem = {
  id: string;
  name: string;
  type: "folder" | "file";
  size?: string;
  modifiedAt: string;
  owner: string;
  shared?: boolean;
};

const DRIVE_ITEMS: DriveItem[] = [
  {
    id: "f-project",
    name: "Project Alpha",
    type: "folder",
    modifiedAt: "Hari ini, 09:42",
    owner: "Saya",
    shared: true,
  },
  {
    id: "f-assets",
    name: "Marketing Assets",
    type: "folder",
    modifiedAt: "Kemarin, 21:13",
    owner: "Tim Brand",
  },
  {
    id: "f-contract",
    name: "Kontrak 2026",
    type: "folder",
    modifiedAt: "07 Feb 2026",
    owner: "Legal",
    shared: true,
  },
  {
    id: "doc-roadmap",
    name: "Roadmap_Q2.pdf",
    type: "file",
    size: "2.1 MB",
    modifiedAt: "Hari ini, 08:55",
    owner: "Saya",
  },
  {
    id: "doc-budget",
    name: "Budget-Review.xlsx",
    type: "file",
    size: "834 KB",
    modifiedAt: "Kemarin, 17:04",
    owner: "Finance",
    shared: true,
  },
  {
    id: "img-landing",
    name: "Landing-Hero.png",
    type: "file",
    size: "4.6 MB",
    modifiedAt: "31 Jan 2026",
    owner: "Tim Design",
  },
  {
    id: "vid-demo",
    name: "Demo-Product.mp4",
    type: "file",
    size: "124 MB",
    modifiedAt: "29 Jan 2026",
    owner: "Saya",
    shared: true,
  },
  {
    id: "zip-backup",
    name: "webdav-backup.zip",
    type: "file",
    size: "1.3 GB",
    modifiedAt: "25 Jan 2026",
    owner: "Infra",
  },
];

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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderDriveRows(items: DriveItem[]): string {
  return items
    .map((item) => {
      const icon = item.type === "folder" ? "📁" : "📄";
      const sharedBadge = item.shared
        ? '<span class="shared">Shared</span>'
        : "";
      const size = item.type === "folder" ? "—" : escapeHtml(item.size ?? "—");

      return `<tr>
        <td>
          <div class="name-cell">
            <span class="item-icon">${icon}</span>
            <span>${escapeHtml(item.name)}</span>
            ${sharedBadge}
          </div>
        </td>
        <td>${escapeHtml(item.owner)}</td>
        <td>${size}</td>
        <td>${escapeHtml(item.modifiedAt)}</td>
      </tr>`;
    })
    .join("\n");
}

function renderHomePage(): string {
  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${APP_NAME}</title>
    <style>
      :root {
        font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        color-scheme: dark;
        --bg: #0b1020;
        --panel: #11182b;
        --panel-soft: #162038;
        --line: rgba(148, 163, 184, 0.26);
        --text: #e2e8f0;
        --muted: #94a3b8;
        --accent: #4f46e5;
        --accent-soft: rgba(79, 70, 229, 0.22);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background: radial-gradient(circle at 5% 0%, #1e293b 0%, var(--bg) 42%);
        color: var(--text);
      }

      .layout {
        display: grid;
        grid-template-columns: 250px 1fr;
        min-height: 100vh;
      }

      aside {
        background: rgba(15, 23, 42, 0.9);
        border-right: 1px solid var(--line);
        padding: 1.2rem;
      }

      .brand {
        margin: 0;
        font-size: 1.2rem;
      }

      .subtitle {
        color: var(--muted);
        margin: 0.35rem 0 1rem;
        font-size: 0.92rem;
      }

      .new-button {
        width: 100%;
        border: 0;
        border-radius: 0.7rem;
        background: linear-gradient(135deg, #6366f1, #4f46e5);
        color: white;
        font-weight: 600;
        padding: 0.7rem 0.9rem;
        margin-bottom: 1rem;
      }

      nav {
        display: grid;
        gap: 0.35rem;
      }

      .nav-item {
        color: var(--text);
        text-decoration: none;
        border-radius: 0.6rem;
        padding: 0.55rem 0.7rem;
        display: flex;
        justify-content: space-between;
        border: 1px solid transparent;
      }

      .nav-item:hover,
      .nav-item.active {
        background: var(--accent-soft);
        border-color: rgba(99, 102, 241, 0.45);
      }

      main {
        padding: 1.5rem;
      }

      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1rem;
      }

      .search {
        flex: 1;
        max-width: 460px;
        border: 1px solid var(--line);
        border-radius: 0.75rem;
        padding: 0.68rem 0.8rem;
        background: rgba(15, 23, 42, 0.7);
        color: var(--text);
      }

      .status {
        padding: 0.42rem 0.72rem;
        border: 1px solid rgba(34, 197, 94, 0.45);
        border-radius: 999px;
        color: #bbf7d0;
        background: rgba(34, 197, 94, 0.16);
        font-weight: 600;
        font-size: 0.85rem;
      }

      .panel {
        background: rgba(15, 23, 42, 0.8);
        border: 1px solid var(--line);
        border-radius: 1rem;
        overflow: hidden;
      }

      .panel-head {
        padding: 1rem 1.1rem;
        border-bottom: 1px solid var(--line);
        display: flex;
        justify-content: space-between;
        align-items: baseline;
      }

      .panel-head h2 {
        margin: 0;
        font-size: 1.05rem;
      }

      .panel-head small {
        color: var(--muted);
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        text-align: left;
        padding: 0.85rem 1.1rem;
        border-bottom: 1px solid rgba(148, 163, 184, 0.18);
      }

      th {
        font-size: 0.85rem;
        color: var(--muted);
        font-weight: 600;
        background: rgba(15, 23, 42, 0.65);
      }

      tr:hover td {
        background: rgba(30, 41, 59, 0.4);
      }

      .name-cell {
        display: flex;
        align-items: center;
        gap: 0.55rem;
      }

      .item-icon {
        width: 1.2rem;
        text-align: center;
      }

      .shared {
        margin-left: 0.45rem;
        font-size: 0.74rem;
        background: rgba(14, 165, 233, 0.18);
        border: 1px solid rgba(14, 165, 233, 0.4);
        color: #bae6fd;
        padding: 0.18rem 0.45rem;
        border-radius: 999px;
      }

      .footer {
        margin-top: 1rem;
        color: var(--muted);
        font-size: 0.9rem;
      }

      .footer a {
        color: #93c5fd;
      }

      @media (max-width: 900px) {
        .layout {
          grid-template-columns: 1fr;
        }

        aside {
          border-right: 0;
          border-bottom: 1px solid var(--line);
        }

        th:nth-child(2),
        th:nth-child(3),
        td:nth-child(2),
        td:nth-child(3) {
          display: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="layout">
      <aside>
        <h1 class="brand">${APP_NAME}</h1>
        <p class="subtitle">Web dashboard untuk sinkronisasi WebDAV</p>
        <button class="new-button" type="button">+ Baru</button>

        <nav>
          <a class="nav-item active" href="/">File Saya <span>12</span></a>
          <a class="nav-item" href="#">Recent <span>6</span></a>
          <a class="nav-item" href="#">Shared <span>4</span></a>
          <a class="nav-item" href="#">Trash <span>0</span></a>
        </nav>
      </aside>

      <main>
        <div class="topbar">
          <input class="search" placeholder="Cari file dan folder..." aria-label="Cari file" />
          <span class="status">Server aktif</span>
        </div>

        <section class="panel">
          <div class="panel-head">
            <h2>Semua file</h2>
            <small>Tampilan ala Google Drive / Nextcloud</small>
          </div>

          <table>
            <thead>
              <tr>
                <th>Nama</th>
                <th>Pemilik</th>
                <th>Ukuran</th>
                <th>Diubah</th>
              </tr>
            </thead>
            <tbody>
              ${renderDriveRows(DRIVE_ITEMS)}
            </tbody>
          </table>
        </section>

        <p class="footer">Health check tetap tersedia di <a href="/health">/health</a>.</p>
      </main>
    </div>
  </body>
</html>`;
}

Deno.serve((request) => {
  const { pathname } = new URL(request.url);

  if (pathname === "/health") {
    return json({ status: "ok", service: APP_NAME });
  }

  if (pathname === "/") {
    return html(renderHomePage());
  }

  return json({ error: "Not found" }, 404);
});
