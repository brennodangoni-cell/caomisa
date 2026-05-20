const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.env.PORT || 4173);
const root = __dirname;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function resolveFile(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = cleanPath === "/" ? "/index.html" : cleanPath;
  const fullPath = path.join(root, normalized);

  if (!fullPath.startsWith(root)) {
    return null;
  }

  return fullPath;
}

const server = http.createServer((req, res) => {
  const filePath = resolveFile(req.url || "/");

  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Pagina nao encontrada");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`Caomisa rodando em http://localhost:${port}`);
});
