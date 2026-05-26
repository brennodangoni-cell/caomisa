const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");
const dataDir = path.join(root, "data");
const files = [
  "products-cache.json",
  "product-overrides.json",
  "product-reviews.json",
  "site-collections.json",
  "site-content.json",
  "yampi-webhook.json"
];

function loadEnv() {
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, "utf8").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const index = trimmed.indexOf("=");
    if (index < 0) return;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  });
}

function keyFor(fileName) {
  const prefix = process.env.DATA_KV_PREFIX || "caomisa";
  return `${prefix}:${fileName.replace(/\.json$/, "")}`;
}

async function uploadJson(fileName) {
  const filePath = path.join(dataDir, fileName);
  if (!fs.existsSync(filePath)) {
    console.log(`skip ${fileName} (nao existe localmente)`);
    return;
  }

  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const url = String(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!url || !token) {
    throw new Error("Configure KV_REST_API_URL e KV_REST_API_TOKEN antes de rodar o seed.");
  }

  const response = await fetch(`${url}/set/${encodeURIComponent(keyFor(fileName))}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Erro ao enviar ${fileName} para KV.`);
  }
  console.log(`ok ${fileName} -> ${keyFor(fileName)}`);
}

async function main() {
  loadEnv();
  for (const file of files) {
    await uploadJson(file);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
