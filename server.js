const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const port = Number(process.env.PORT || 4173);
const root = __dirname;
const envPath = path.join(root, ".env");
const dataDir = path.join(root, "data");
const productCachePath = path.join(dataDir, "products-cache.json");
const productOverridesPath = path.join(dataDir, "product-overrides.json");
const productReviewsPath = path.join(dataDir, "product-reviews.json");
const siteCollectionsPath = path.join(dataDir, "site-collections.json");
const webhookConfigPath = path.join(dataDir, "yampi-webhook.json");

const YAMPI_PRODUCT_EVENTS = [
  "product.created",
  "product.updated",
  "product.deleted",
  "product.inventory.updated"
];

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const index = trimmed.indexOf("=");
    if (index < 0) return;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  });
}

const yampiConfig = {
  alias: process.env.YAMPI_ALIAS || "",
  token: process.env.YAMPI_USER_TOKEN || "",
  secret: process.env.YAMPI_USER_SECRET_KEY || "",
  webhookSecret: process.env.YAMPI_WEBHOOK_SECRET || "",
  checkoutBase: (process.env.YAMPI_CHECKOUT_BASE || "").replace(/\/$/, ""),
  publicUrl: (process.env.PUBLIC_SITE_URL || "").replace(/\/$/, "")
};

const adminConfig = {
  user: process.env.ADMIN_USER || "",
  pass: process.env.ADMIN_PASS || "",
  sessionSecret: process.env.ADMIN_SESSION_SECRET || process.env.YAMPI_WEBHOOK_SECRET || ""
};

const kvConfig = {
  url: (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, ""),
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "",
  prefix: process.env.DATA_KV_PREFIX || "caomisa"
};

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

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tempPath, filePath);
}

function dataStoreEnabled() {
  return Boolean(kvConfig.url && kvConfig.token);
}

function dataStoreKey(filePath) {
  return `${kvConfig.prefix}:${path.basename(filePath, ".json")}`;
}

function sanitizeStoredImage(value = "", fallback = "") {
  const image = cleanText(value);
  if (!image) return fallback;
  if (/^data:image\//i.test(image)) {
    return /^data:image\/webp;base64,/i.test(image) && image.length <= 3_500_000 ? image : fallback;
  }
  if (/^(https?:\/\/|\/|assets\/)/i.test(image)) return image.slice(0, 2000);
  return fallback;
}

async function readJsonData(filePath) {
  if (dataStoreEnabled()) {
    try {
      const response = await fetch(`${kvConfig.url}/get/${encodeURIComponent(dataStoreKey(filePath))}`, {
        headers: { Authorization: `Bearer ${kvConfig.token}` },
        cache: "no-store"
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.result != null) {
        return typeof payload.result === "string" ? JSON.parse(payload.result) : payload.result;
      }
    } catch (error) {
      console.warn(`KV indisponivel para ${path.basename(filePath)}: ${error.message}`);
    }
  }

  return readJsonFile(filePath);
}

async function writeJsonData(filePath, payload) {
  if (dataStoreEnabled()) {
    const response = await fetch(`${kvConfig.url}/set/${encodeURIComponent(dataStoreKey(filePath))}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${kvConfig.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || `Erro ao salvar ${path.basename(filePath)} no KV.`);
    }
    return;
  }

  writeJsonFile(filePath, payload);
}

async function readProductCache() {
  return readJsonData(productCachePath);
}

async function writeProductCache(payload) {
  await writeJsonData(productCachePath, payload);
}

async function readWebhookConfig() {
  return (await readJsonData(webhookConfigPath)) || {};
}

async function writeWebhookConfig(payload) {
  await writeJsonData(webhookConfigPath, {
    ...(await readWebhookConfig()),
    ...payload,
    updatedAt: new Date().toISOString()
  });
}

async function readProductOverrides() {
  return (await readJsonData(productOverridesPath)) || {};
}

async function writeProductOverrides(payload) {
  await writeJsonData(productOverridesPath, payload);
}

async function readProductReviews() {
  const payload = await readJsonData(productReviewsPath);
  return Array.isArray(payload?.reviews) ? payload.reviews : [];
}

async function writeProductReviews(reviews) {
  await writeJsonData(productReviewsPath, {
    reviews: Array.isArray(reviews) ? reviews : [],
    updatedAt: new Date().toISOString()
  });
}

function readRequestBody(req, limit = 1_000_000) {
  if (req.body != null) {
    const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (body.length > limit) return Promise.reject(new Error("Payload muito grande"));
    return Promise.resolve(body);
  }

  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        req.destroy();
        reject(new Error("Payload muito grande"));
      }
    });
    req.on("end", () => {
      resolve(body);
    });
    req.on("error", reject);
  });
}

async function readRequestJson(req) {
  const body = await readRequestBody(req);
  if (!body) return {};
  return JSON.parse(body);
}

async function readRequestJsonWithLimit(req, limit) {
  const body = await readRequestBody(req, limit);
  if (!body) return {};
  return JSON.parse(body);
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signAdminPayload(payload) {
  const encoded = base64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", adminConfig.sessionSecret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyAdminToken(token = "") {
  if (!adminConfig.sessionSecret) return false;
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature) return false;
  const expected = crypto
    .createHmac("sha256", adminConfig.sessionSecret)
    .update(encoded)
    .digest("base64url");
  if (!timingSafeEqualString(signature, expected)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return payload.sub === "admin" && Number(payload.exp || 0) > Date.now();
  } catch {
    return false;
  }
}

function adminTokenFromRequest(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function requireAdmin(req, res) {
  if (verifyAdminToken(adminTokenFromRequest(req))) return true;
  sendJson(res, 401, { ok: false, message: "Login do admin necessário." });
  return false;
}

async function handleAdminLogin(req, res) {
  const body = await readRequestJson(req);
  if (!adminConfig.user || !adminConfig.pass || !adminConfig.sessionSecret) {
    sendJson(res, 500, { ok: false, message: "ADMIN_USER, ADMIN_PASS e ADMIN_SESSION_SECRET precisam estar configurados." });
    return;
  }

  const usernameOk = timingSafeEqualString(cleanText(body.username), adminConfig.user);
  const passwordOk = timingSafeEqualString(cleanText(body.password), adminConfig.pass);
  if (!usernameOk || !passwordOk) {
    sendJson(res, 401, { ok: false, message: "Usuário ou senha incorretos." });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    token: signAdminPayload({
      sub: "admin",
      iat: Date.now(),
      exp: Date.now() + 12 * 60 * 60 * 1000
    })
  });
}

function hmacSignature(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64");
}

function verifyYampiSignature(rawBody, parsedBody, secret, signature) {
  if (!secret) return { ok: true, verified: false };
  if (!signature) return { ok: false, verified: false };

  const candidates = [rawBody];
  if (parsedBody && typeof parsedBody === "object") {
    candidates.push(JSON.stringify(parsedBody));
  }

  const ok = candidates.some((payload) => timingSafeEqualString(hmacSignature(payload, secret), signature));
  return { ok, verified: ok };
}

function yampiHeaders() {
  return {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "User-Token": yampiConfig.token,
    "User-Secret-Key": yampiConfig.secret
  };
}

function ensureYampiConfig() {
  if (!yampiConfig.alias || !yampiConfig.token || !yampiConfig.secret) {
    throw new Error("Credenciais da Yampi ausentes no .env");
  }
}

function yampiUrl(endpoint, params = {}) {
  const url = new URL(`https://api.dooki.com.br/v2/${yampiConfig.alias}/${endpoint.replace(/^\//, "")}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url;
}

async function yampiRequest(endpoint, params = {}, options = {}) {
  ensureYampiConfig();
  const requestOptions = {
    method: options.method || "GET",
    headers: yampiHeaders()
  };
  if (options.body !== undefined) {
    requestOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(yampiUrl(endpoint, params), {
    ...requestOptions
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = data?.message || data?.error || `Yampi respondeu ${response.status}`;
    throw new Error(message);
  }

  return data;
}

function relationData(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.data)) return value.data;
  if (value.data && typeof value.data === "object") return [value.data];
  if (typeof value === "object") return [value];
  return [];
}

function yampiWebhookUrl() {
  return yampiConfig.publicUrl ? `${yampiConfig.publicUrl}/api/yampi/webhook` : "";
}

async function yampiWebhookSecret() {
  const stored = await readWebhookConfig();
  return yampiConfig.webhookSecret || stored.secretKey || stored.secret_key || "";
}

function webhookEvents(webhook) {
  return relationData(webhook?.events)
    .map((event) => (typeof event === "string" ? event : event.name))
    .filter(Boolean);
}

function sameUrl(left, right) {
  return String(left || "").replace(/\/$/, "") === String(right || "").replace(/\/$/, "");
}

function unwrapResource(resource) {
  return resource?.data && typeof resource.data === "object" && !Array.isArray(resource.data)
    ? { ...resource.data, ...resource }
    : resource;
}

function getPageItems(payload) {
  const data = payload?.data;
  if (Array.isArray(data)) return data.map(unwrapResource);
  if (Array.isArray(data?.data)) return data.data.map(unwrapResource);
  return [];
}

function nextPage(payload, currentPage) {
  const pagination = payload?.meta?.pagination || payload?.pagination || payload?.meta;
  if (!pagination) return null;
  const totalPages = Number(pagination.total_pages || pagination.last_page || pagination.totalPages || 0);
  const page = Number(pagination.current_page || pagination.currentPage || currentPage);
  return totalPages && page < totalPages ? page + 1 : null;
}

async function fetchYampiCollection(endpoint, params = {}) {
  const items = [];
  let page = 1;
  for (let guard = 0; guard < 40; guard += 1) {
    const payload = await yampiRequest(endpoint, { ...params, page, limit: params.limit || 100 });
    items.push(...getPageItems(payload));
    const next = nextPage(payload, page);
    if (!next) break;
    page = next;
  }
  return items;
}

function numberValue(...values) {
  for (const value of values) {
    const normalized = Number(String(value ?? "").replace(",", "."));
    if (Number.isFinite(normalized) && normalized > 0) return normalized;
  }
  return 0;
}

function imageUrl(image) {
  if (!image) return "";
  if (typeof image === "string") return image;

  const keys = ["url", "src", "path", "image", "large", "medium", "small", "thumb", "original"];
  for (const key of keys) {
    const value = image[key];
    if (!value) continue;
    if (typeof value === "string") return value;
    if (typeof value === "object") {
      const nested = imageUrl(value);
      if (nested) return nested;
    }
  }

  return "";
}

function productImages(product, skus = []) {
  const productLevelImages = [
    ...relationData(product.images),
    ...relationData(product.photos),
    ...relationData(product.firstImage)
  ].map(imageUrl).filter(Boolean);

  const skuImages = skus
    .flatMap((sku) => relationData(sku.images || sku.image || sku.photo))
    .map(imageUrl)
    .filter(Boolean);

  const images = productLevelImages.length ? productLevelImages : skuImages;
  const single = imageUrl(product.image || product.photo || product.cover);
  if (single) images.unshift(single);
  return [...new Set(images)].slice(0, 8);
}

function variationLabel(sku) {
  const values = [
    ...relationData(sku.variations),
    ...relationData(sku.options),
    ...relationData(sku.attributes)
  ].map((variation) => variation.value || variation.name || variation.title || variation.option || "").filter(Boolean);
  return values.length ? values.join(" / ") : (sku.title || sku.name || sku.sku || "Unico");
}

function skuToken(sku) {
  if (sku.token) return sku.token;
  const purchase = sku.purchase_url || sku.purchaseUrl || "";
  const match = String(purchase).match(/\/r\/([^:/?,]+)/);
  return match ? match[1] : "";
}

function skuPrice(sku) {
  return numberValue(
    sku.price_discount,
    sku.price_sale,
    sku.price,
    sku.sale_price,
    sku.promotional_price
  );
}

function skuOldPrice(sku) {
  return numberValue(sku.price_sale, sku.compare_at_price, sku.old_price, sku.price);
}

function skuStock(sku) {
  return Number(sku.total_in_stock ?? sku.stock ?? sku.quantity ?? sku.inventory ?? 0);
}

function plainText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function productDescription(product) {
  const textRelations = relationData(product.texts || product.description);
  const textFromRelation = textRelations
    .map((item) => item.description || item.text || item.content || item.body || "")
    .find(Boolean);
  return plainText(
    product.description ||
    product.short_description ||
    product.text ||
    textFromRelation ||
    "Produto importado automaticamente da loja."
  );
}

function productCategory(product) {
  const categories = relationData(product.categories || product.category);
  const category = categories.find(Boolean);
  return category?.name || category?.title || product.category?.name || product.category || "Produtos";
}

function categoryName(category) {
  const item = unwrapResource(category);
  return plainText(item?.name || item?.title || item?.slug || "");
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function slugText(value, fallback = "colecao") {
  return String(value || fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || fallback;
}

function productPublicBaseSlug(product = {}) {
  const cleanName = cleanText(product.name || product.title || product.id || "produto")
    .replace(/\s*-\s*frete\s+gr[aá]tis\s*$/i, "")
    .replace(/\s*\|\s*.*$/i, "")
    .trim();
  const nameSlug = slugText(cleanName, "");
  if (nameSlug) return nameSlug;
  return slugText(cleanText(product.id).replace(/^yampi-/i, "").replace(/-\d+$/g, ""), "produto");
}

function productPublicSlug(product = {}, catalogProducts = []) {
  const base = productPublicBaseSlug(product);
  const sameSlugProducts = catalogProducts.filter((item) => productPublicBaseSlug(item) === base);
  if (sameSlugProducts.length <= 1) return base;
  return `${base}-${slugText(product.yampiProductId || product.id, "produto")}`;
}

function productPublicUrl(product = {}, catalogProducts = []) {
  return `/produto/${encodeURIComponent(productPublicSlug(product, catalogProducts))}`;
}

function defaultSiteCollections(products = []) {
  const uniqueCategories = [...new Set(products.map((product) => cleanText(product.category)).filter(Boolean))];
  const preferred = ["Camisas", "Casacos", "Brasil", "Passeio", "Kits"];
  const names = [...new Set([...preferred, ...uniqueCategories.map((name) => name.toLowerCase() === "camisetas" ? "Camisas" : name)])];

  return names.map((name, index) => {
    const sourceCategory = name.toLowerCase() === "camisas" ? "Camisas" : name;
    const product = products.find((item) => cleanText(item.category).toLowerCase() === sourceCategory.toLowerCase());
    const fallbackImages = {
      Camisas: "assets/foto-2.webp",
      Casacos: "assets/foto-5.webp",
      Brasil: "assets/foto-3.webp",
      Passeio: "assets/foto-4.webp",
      Kits: "assets/foto-principal.webp"
    };
    return {
      id: slugText(name),
      name,
      image: product?.image || fallbackImages[name] || "assets/banner-placeholder.svg",
      sourceCategory,
      productIds: [],
      sortOrder: index
    };
  });
}

function sanitizeSiteCollections(collections = [], products = []) {
  const source = Array.isArray(collections) && collections.length
    ? collections
    : defaultSiteCollections(products);
  const productIds = new Set(products.map((product) => product.id));
  const usedIds = new Set();

  return source.map((collection, index) => {
    const rawName = cleanText(collection.name || collection.title || `Coleção ${index + 1}`);
    const name = rawName.toLowerCase() === "camisetas" ? "Camisas" : rawName;
    const baseId = slugText(collection.id || name, `colecao-${index + 1}`);
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);

    const explicitProductIds = Array.isArray(collection.productIds)
      ? collection.productIds.map((item) => cleanText(item)).filter(Boolean)
      : [];

    return {
      id,
      name,
      image: sanitizeStoredImage(collection.image || collection.photo, "assets/banner-placeholder.svg"),
      sourceCategory: cleanText(collection.sourceCategory || collection.category || name),
      productIds: explicitProductIds.filter((productId) => !productIds.size || productIds.has(productId)),
      sortOrder: Number.isFinite(Number(collection.sortOrder)) ? Number(collection.sortOrder) : index
    };
  }).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
}

async function readSiteCollections(products = []) {
  const payload = await readJsonData(siteCollectionsPath);
  return sanitizeSiteCollections(payload?.collections, products);
}

async function writeSiteCollections(collections) {
  await writeJsonData(siteCollectionsPath, {
    updatedAt: new Date().toISOString(),
    collections
  });
}

function sanitizeDescriptionBlocks(blocks = []) {
  const source = Array.isArray(blocks) ? blocks : [];
  return [0, 1, 2].map((index) => {
    const block = source[index] || {};
    return {
      title: cleanText(block.title),
      text: cleanText(block.text),
      image: sanitizeStoredImage(block.image, "assets/banner-placeholder.svg")
    };
  });
}

function sanitizeReviews(reviews = []) {
  const source = Array.isArray(reviews) ? reviews : [];
  return source
    .map((review) => ({
      id: cleanText(review.id),
      name: cleanText(review.name) || "Cliente Caomisa",
      city: cleanText(review.city).slice(0, 80),
      stars: Math.max(1, Math.min(5, Number(review.stars || 5))),
      text: cleanText(review.text),
      image: sanitizeStoredReviewImage(review.image),
      status: cleanText(review.status) || "approved",
      createdAt: cleanText(review.createdAt)
    }))
    .filter((review) => review.text);
}

function sanitizeReviewImage(value = "") {
  const image = cleanText(value);
  if (!image) return "";
  if (!/^data:image\/webp;base64,/i.test(image)) return "";
  return image.length <= 2_800_000 ? image : "";
}

function sanitizeStoredReviewImage(value = "") {
  const image = cleanText(value);
  if (!image) return "";
  if (/^data:image\//i.test(image)) return sanitizeReviewImage(image);
  if (/^(https?:\/\/|\/|assets\/)/i.test(image)) return image.slice(0, 2000);
  return "";
}

function sanitizeReviewSubmission(body = {}) {
  return {
    name: cleanText(body.name).slice(0, 80) || "Cliente Caomisa",
    stars: Math.max(1, Math.min(5, Number(body.stars || 5))),
    email: cleanText(body.email).slice(0, 160),
    text: cleanText(body.text).slice(0, 900),
    image: sanitizeReviewImage(body.image)
  };
}

function approvedReviewsForProduct(productId, reviews) {
  return reviews
    .filter((review) => review.productId === productId && review.status === "approved")
    .map((review) => ({
      id: review.id,
      name: review.name,
      city: review.city || "",
      stars: review.stars,
      text: review.text,
      image: review.image || "",
      status: "approved",
      createdAt: review.createdAt
    }));
}

function attachApprovedReviews(product, reviews) {
  const premium = product.premium || {};
  const curatedReviews = sanitizeReviews(premium.reviews)
    .filter((review) => review.status !== "rejected" && review.status !== "pending");
  const submittedReviews = approvedReviewsForProduct(product.id, reviews);
  const visibleReviews = [...submittedReviews, ...curatedReviews].filter((review, index, source) => {
    const key = review.id || `${review.name}|${review.stars}|${review.text}`;
    return source.findIndex((item) => (item.id || `${item.name}|${item.stars}|${item.text}`) === key) === index;
  });
  const rating = visibleReviews.length
    ? visibleReviews.reduce((sum, review) => sum + Number(review.stars || 0), 0) / visibleReviews.length
    : Math.max(0, Math.min(5, Number(premium.rating || 0)));

  return {
    ...product,
    premium: {
      ...premium,
      sizeGuideDesktopImage: premium.sizeGuideDesktopImage || "assets/size-guide-caomisa.webp",
      sizeGuideMobileImage: premium.sizeGuideMobileImage || premium.sizeGuideDesktopImage || "assets/size-guide-caomisa-mobile.webp",
      reviews: visibleReviews,
      rating,
      reviewCount: visibleReviews.length
    }
  };
}

function sanitizePremiumOverride(premium = {}) {
  return {
    soldCount: cleanText(premium.soldCount),
    rating: Math.max(0, Math.min(5, Number(premium.rating || 0))),
    reviewCount: Math.max(0, Number(premium.reviewCount || 0)),
    badgeText: cleanText(premium.badgeText),
    deliveryText: cleanText(premium.deliveryText),
    descriptionTitle: cleanText(premium.descriptionTitle),
    descriptionIntro: cleanText(premium.descriptionIntro),
    sizeGuideDesktopImage: sanitizeStoredImage(premium.sizeGuideDesktopImage, "assets/size-guide-caomisa.webp"),
    sizeGuideMobileImage: sanitizeStoredImage(premium.sizeGuideMobileImage, "assets/size-guide-caomisa-mobile.webp"),
    descriptionBlocks: sanitizeDescriptionBlocks(premium.descriptionBlocks),
    specs: cleanText(premium.specs),
    reviews: sanitizeReviews(premium.reviews)
  };
}

function mergePremium(base = {}, override = {}) {
  return {
    ...base,
    ...override,
    descriptionBlocks: Array.isArray(override.descriptionBlocks) ? override.descriptionBlocks : base.descriptionBlocks,
    reviews: Array.isArray(override.reviews) ? override.reviews : base.reviews
  };
}

function isProductHidden(product, overrides = {}) {
  const directOverride = overrides[product.id];
  if (directOverride?.hidden) return true;
  if (!product.yampiProductId) return false;

  return Object.values(overrides).some((override) =>
    override?.hidden && override.yampiProductId && override.yampiProductId === product.yampiProductId
  );
}

async function applyProductOverrides(products) {
  const overrides = await readProductOverrides();
  const reviews = await readProductReviews();
  return products.filter((product) => !isProductHidden(product, overrides)).map((product) => {
    const override = overrides[product.id] || {};
    const productWithOverride = override.premium
      ? {
          ...product,
          premium: mergePremium(product.premium, override.premium),
          pageContentUpdatedAt: override.updatedAt || null
        }
      : product;
    return attachApprovedReviews(productWithOverride, reviews);
  });
}

function productSlug(product) {
  return String(product.slug || product.handle || product.name || `produto-${product.id}`)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || `produto-${product.id}`;
}

function legacySizeFromName(name) {
  const match = String(name || "").match(/\s+TAMANH[OA]\s+([A-Z0-9]{1,4})\s*$/i);
  if (!match) return null;
  const size = match[1].toUpperCase();
  const validSizes = new Set(["PP", "P", "M", "G", "GG", "XG", "EG", "U", "UN", "UNICO"]);
  if (!validSizes.has(size)) return null;
  return {
    baseName: String(name).slice(0, match.index).trim(),
    size: size === "UNICO" ? "Único" : size
  };
}

function firstPositive(values) {
  return values.find((value) => Number(value || 0) > 0) || 0;
}

function buildSiteProduct(product, productSkus) {
  const productId = String(product.id || product.product_id || product.uuid || productSlug(product));
  const uniqueSkus = [...new Map(productSkus.map((sku) => [String(sku.id || sku.sku || skuToken(sku)), sku])).values()];
  const images = productImages(product, uniqueSkus);
  const yampiSkus = uniqueSkus.map((sku) => {
    const size = variationLabel(sku);
    const price = skuPrice(sku);
    const oldPrice = skuOldPrice(sku);
    return {
      id: String(sku.id || sku.sku || size),
      sku: sku.sku || sku.reference || "",
      token: skuToken(sku),
      purchaseUrl: sku.purchase_url || sku.purchaseUrl || "",
      size,
      price,
      oldPrice: oldPrice > price ? oldPrice : 0,
      stock: skuStock(sku),
      variations: relationData(sku.variations),
      sourceProductId: productId
    };
  }).filter((sku) => sku.token || sku.purchaseUrl || sku.id);

  const prices = yampiSkus.map((sku) => sku.price).filter(Boolean);
  const oldPrices = yampiSkus.map((sku) => sku.oldPrice).filter(Boolean);
  const price = prices.length ? Math.min(...prices) : numberValue(product.price_discount, product.price_sale, product.price);
  const oldPrice = oldPrices.length ? Math.max(...oldPrices) : numberValue(product.price_sale, product.price);
  const description = productDescription(product);
  const name = product.name || product.title || "Produto";

  return {
    id: `yampi-${productSlug(product)}-${productId}`,
    yampiProductId: productId,
    name,
    category: productCategory(product),
    price,
    oldPrice: oldPrice > price ? oldPrice : 0,
    stock: yampiSkus.reduce((sum, sku) => sum + Number(sku.stock || 0), 0),
    image: images[0] || "assets/banner-placeholder.svg",
    images: images.length ? images : ["assets/banner-placeholder.svg"],
    sizes: yampiSkus.length ? yampiSkus.map((sku) => sku.size) : ["Unico"],
    description,
    yampi: {
      productId,
      url: product.url || product.link || "",
      skus: yampiSkus
    },
    premium: {
      soldCount: product.total_orders ? `+${product.total_orders} vendidos` : "+598 vendidos",
      rating: Number(product.rating || product.average_rating || 4.9),
      reviewCount: Number(product.total_reviews || product.reviews_count || 127),
      badgeText: product.featured ? "Mais vendido" : "Compra segura",
      deliveryText: "Frete gratis para todo o Brasil com checkout seguro.",
      descriptionTitle: `${name} com compra segura`,
      descriptionIntro: description,
      sizeGuideDesktopImage: "assets/size-guide-caomisa.webp",
      sizeGuideMobileImage: "assets/size-guide-caomisa-mobile.webp",
      descriptionBlocks: [0, 1, 2].map((index) => ({
        title: ["Detalhes do produto", "Conforto e acabamento", "Compra segura"][index],
        text: [
          description,
          "Variações e tamanhos sincronizados automaticamente.",
          "Ao finalizar, o cliente vai para o checkout correto com os itens escolhidos."
        ][index],
        image: images[index] || images[0] || "assets/banner-placeholder.svg"
      })),
      specs: [
        `Produto: ${productId}`,
        `Categoria: ${productCategory(product)}`,
        `Variações: ${yampiSkus.length || 1}`,
        "Checkout: seguro"
      ].join("\n"),
      reviews: []
    }
  };
}

function groupLegacySizeProducts(siteProducts) {
  const grouped = new Map();
  const passthrough = [];

  siteProducts.forEach((product) => {
    const parsed = legacySizeFromName(product.name);
    if (!parsed?.baseName) {
      passthrough.push(product);
      return;
    }

    const groupKey = `${parsed.baseName.toLowerCase()}::${product.category}`;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        ...product,
        id: `yampi-${productSlug({ name: parsed.baseName })}-group`,
        yampiProductId: `legacy-group:${groupKey}`,
        name: parsed.baseName,
        images: [],
        yampi: {
          productId: `legacy-group:${groupKey}`,
          url: "",
          skus: []
        }
      });
    }

    const group = grouped.get(groupKey);
    const productImagesForGroup = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
    group.images = [...new Set([...group.images, ...productImagesForGroup])].slice(0, 8);
    group.image = group.images[0] || product.image || "assets/banner-placeholder.svg";

    const skus = product.yampi?.skus?.length ? product.yampi.skus : [{
      id: product.yampiProductId,
      token: "",
      purchaseUrl: "",
      price: product.price,
      oldPrice: product.oldPrice,
      stock: product.stock
    }];

    skus.forEach((sku) => {
      group.yampi.skus.push({
        ...sku,
        size: parsed.size,
        price: sku.price || product.price,
        oldPrice: sku.oldPrice || product.oldPrice,
        stock: sku.stock ?? product.stock,
        sourceProductId: sku.sourceProductId || product.yampiProductId
      });
    });

    const description = product.description && product.description !== "Produto importado automaticamente da loja."
      ? product.description
      : group.description;
    group.description = description;
  });

  const groupedProducts = [...grouped.values()].map((group) => {
    const seenSizes = new Set();
    group.yampi.skus = group.yampi.skus.filter((sku) => {
      if (seenSizes.has(sku.size)) return false;
      seenSizes.add(sku.size);
      return true;
    }).sort((a, b) => {
      const order = ["PP", "P", "M", "G", "GG", "XG", "EG", "Único"];
      return order.indexOf(a.size) - order.indexOf(b.size);
    });
    group.sizes = group.yampi.skus.map((sku) => sku.size);
    group.price = firstPositive(group.yampi.skus.map((sku) => sku.price)) || group.price;
    group.oldPrice = Math.max(...group.yampi.skus.map((sku) => Number(sku.oldPrice || 0)), group.oldPrice || 0);
    group.stock = group.yampi.skus.reduce((sum, sku) => sum + Number(sku.stock || 0), 0);
    group.premium = {
      ...group.premium,
      badgeText: "Tamanhos sincronizados",
      descriptionTitle: `${group.name} com tamanhos sincronizados`,
      descriptionBlocks: group.premium.descriptionBlocks.map((block, index) => ({
        ...block,
        image: group.images[index] || group.images[0] || "assets/banner-placeholder.svg"
      })),
      specs: [
        `Produto: ${group.yampiProductId}`,
        `Categoria: ${group.category}`,
        `Tamanhos: ${group.sizes.join(", ")}`,
        "Checkout: seguro"
      ].join("\n")
    };
    return group;
  });

  return [...groupedProducts, ...passthrough];
}

function transformYampiProducts(products, skus) {
  const skusByProduct = new Map();
  skus.forEach((sku) => {
    const productId = sku.product_id || sku.productId || sku.product?.id || sku.product?.data?.id;
    if (!productId) return;
    const key = String(productId);
    if (!skusByProduct.has(key)) skusByProduct.set(key, []);
    skusByProduct.get(key).push(sku);
  });

  const siteProducts = products.map((product) => {
    const productId = String(product.id || product.product_id || product.uuid || productSlug(product));
    const productSkus = [
      ...relationData(product.skus),
      ...(skusByProduct.get(productId) || [])
    ];
    return buildSiteProduct(product, productSkus);
  });

  return groupLegacySizeProducts(siteProducts);
}

function transformYampiCategories(categories, siteProducts) {
  const fromCatalog = categories
    .filter((category) => category?.active !== false)
    .map(categoryName)
    .filter(Boolean);
  const fromProducts = siteProducts.map((product) => product.category).filter(Boolean);

  return [...new Set([...fromCatalog, ...fromProducts])]
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function productPayload(products, categories, extra = {}) {
  const safeProducts = Array.isArray(products) ? products : [];
  const safeCategories = [
    ...new Set([
      ...(Array.isArray(categories) ? categories : []),
      ...safeProducts.map((product) => product.category)
    ]
      .map((category) => cleanText(category))
      .filter(Boolean))
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return {
    ok: true,
    source: "yampi",
    syncedAt: new Date().toISOString(),
    ...extra,
    count: safeProducts.length,
    products: safeProducts,
    categories: safeCategories
  };
}

async function cachedProductPayload() {
  const cache = await readProductCache();
  const products = await applyProductOverrides(Array.isArray(cache?.products) ? cache.products : []);
  const categories = [
    ...new Set([
      ...(Array.isArray(cache?.categories) ? cache.categories : []),
      ...products.map((product) => product.category)
    ]
      .map((category) => cleanText(category))
      .filter(Boolean))
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));

  return {
    ok: true,
    source: cache?.source || (cache ? "cache" : "empty"),
    syncedAt: cache?.syncedAt || null,
    count: products.length,
    products,
    categories
  };
}

async function fetchYampiCategories() {
  try {
    return await fetchYampiCollection("catalog/categories");
  } catch (error) {
    console.warn(`Nao foi possivel sincronizar categorias da Yampi: ${error.message}`);
    return [];
  }
}

async function syncYampiCatalog() {
  const [products, skus, categories] = await Promise.all([
    fetchYampiCollection("catalog/products", {
      include: "skus,images,categories,texts,firstImage",
      active: 1
    }),
    fetchYampiCollection("catalog/skus", {
      include: "product,variations,images"
    }),
    fetchYampiCategories()
  ]);
  const transformed = await applyProductOverrides(transformYampiProducts(products, skus));
  const payload = productPayload(transformed, transformYampiCategories(categories, transformed));
  await writeProductCache(payload);
  return payload;
}

function checkoutBaseFromItems(items) {
  if (yampiConfig.checkoutBase) return yampiConfig.checkoutBase;
  const purchaseUrl = items.map((item) => item.purchaseUrl).find(Boolean);
  if (purchaseUrl) {
    try {
      return new URL(purchaseUrl).origin;
    } catch {
      return "";
    }
  }
  return `https://${yampiConfig.alias}.pay.yampi.com.br`;
}

function checkoutUrlFromPurchaseUrl(item) {
  if (!item.purchaseUrl) return "";
  try {
    const url = new URL(item.purchaseUrl);
    if (item.quantity > 1) {
      const parts = url.pathname.split("/");
      const token = parts.pop();
      if (token) parts.push(`${token}:${item.quantity}`);
      url.pathname = parts.join("/");
    }
    return url.toString();
  } catch {
    return "";
  }
}

async function handleYampiSync(res) {
  const previousProducts = (await cachedProductPayload()).products;
  const payload = await syncYampiCatalog();
  const nextIds = new Set(payload.products.map((product) => product.id));
  const removedProducts = previousProducts
    .filter((product) => !nextIds.has(product.id))
    .map((product) => ({
      id: product.id,
      name: product.name,
      yampiProductId: product.yampiProductId || null
    }));

  sendJson(res, 200, {
    ...payload,
    removedCount: removedProducts.length,
    removedProducts
  });
}

async function handleProducts(res) {
  const cache = await cachedProductPayload();
  if (cache.syncedAt || !yampiConfig.alias || !yampiConfig.token || !yampiConfig.secret) {
    sendJson(res, 200, cache);
    return;
  }

  try {
    sendJson(res, 200, await syncYampiCatalog());
  } catch (error) {
    sendJson(res, 200, {
      ...cache,
      warning: error.message || "Nao foi possivel sincronizar a Yampi agora."
    });
  }
}

async function handleCategories(res) {
  const cache = await cachedProductPayload();
  sendJson(res, 200, {
    ok: true,
    source: cache.source,
    syncedAt: cache.syncedAt,
    count: cache.categories.length,
    categories: cache.categories
  });
}

async function handleCollectionsGet(res) {
  const cache = await cachedProductPayload();
  sendJson(res, 200, {
    ok: true,
    collections: await readSiteCollections(cache.products)
  });
}

async function handleCollectionsPut(req, res) {
  const body = await readRequestJsonWithLimit(req, 8_000_000);
  const cache = await cachedProductPayload();
  const collections = sanitizeSiteCollections(body.collections, cache.products);
  await writeSiteCollections(collections);
  sendJson(res, 200, {
    ok: true,
    collections
  });
}

async function handleProductMetadata(req, res, productId) {
  const body = await readRequestJsonWithLimit(req, 12_000_000);
  const cache = await cachedProductPayload();
  const product = cache.products.find((item) => item.id === productId);

  if (!product) {
    sendJson(res, 404, { ok: false, message: "Produto não encontrado no catálogo sincronizado." });
    return;
  }

  const overrides = await readProductOverrides();
  const premium = sanitizePremiumOverride(body.premium || {});
  overrides[product.id] = {
    productId: product.id,
    yampiProductId: product.yampiProductId || null,
    premium,
    updatedAt: new Date().toISOString()
  };
  await writeProductOverrides(overrides);

  const payload = await cachedProductPayload();
  const updatedProduct = payload.products.find((item) => item.id === product.id);
  const existingCache = await readProductCache() || {};
  await writeProductCache({
    ...existingCache,
    categories: payload.categories,
    source: "yampi"
  });

  sendJson(res, 200, {
    ok: true,
    product: updatedProduct,
    products: payload.products,
    categories: payload.categories
  });
}

async function handleProductDelete(res, productId) {
  const cache = await readProductCache() || {};
  const rawProducts = Array.isArray(cache.products) ? cache.products : [];
  const visibleProducts = (await cachedProductPayload()).products;
  const product = rawProducts.find((item) => item.id === productId)
    || visibleProducts.find((item) => item.id === productId);

  if (!product) {
    sendJson(res, 404, { ok: false, message: "Produto não encontrado no catálogo sincronizado." });
    return;
  }

  const now = new Date().toISOString();
  const overrides = await readProductOverrides();
  overrides[product.id] = {
    ...(overrides[product.id] || {}),
    productId: product.id,
    yampiProductId: product.yampiProductId || null,
    hidden: true,
    deletedAt: now,
    updatedAt: now
  };
  await writeProductOverrides(overrides);

  const payload = await cachedProductPayload();
  await writeProductCache({
    ...cache,
    categories: payload.categories,
    source: cache.source || "yampi"
  });

  sendJson(res, 200, {
    ok: true,
    deletedId: product.id,
    deletedProduct: {
      id: product.id,
      name: product.name,
      yampiProductId: product.yampiProductId || null
    },
    products: payload.products,
    categories: payload.categories,
    count: payload.products.length
  });
}

async function handleProductReviewSubmit(req, res, productId) {
  const body = await readRequestJsonWithLimit(req, 5_000_000);
  const cache = await cachedProductPayload();
  const product = cache.products.find((item) => item.id === productId);

  if (!product) {
    sendJson(res, 404, { ok: false, message: "Produto não encontrado." });
    return;
  }

  const review = sanitizeReviewSubmission(body);
  if (!review.text || review.text.length < 8) {
    sendJson(res, 400, { ok: false, message: "Escreva um depoimento um pouco mais completo." });
    return;
  }

  const reviews = await readProductReviews();
  const now = new Date().toISOString();
  const nextReview = {
    id: crypto.randomUUID(),
    productId: product.id,
    productName: product.name,
    yampiProductId: product.yampiProductId || null,
    name: review.name,
    email: review.email,
    stars: review.stars,
    text: review.text,
    image: review.image,
    status: "pending",
    createdAt: now,
    updatedAt: now
  };

  await writeProductReviews([nextReview, ...reviews]);
  sendJson(res, 201, {
    ok: true,
    review: nextReview,
    message: "Depoimento recebido e aguardando aprovação."
  });
}

async function moderationReviewsPayload() {
  const catalog = await cachedProductPayload();
  const productById = new Map(catalog.products.map((product) => [product.id, product]));
  const reviews = (await readProductReviews()).map((review) => {
    const product = productById.get(review.productId);
    return {
      ...review,
      productName: product?.name || review.productName || "Produto",
      productImage: product?.image || "",
      productUrl: product ? productPublicUrl(product, catalog.products) : `/produto/${encodeURIComponent(review.productId)}`
    };
  });

  return {
    ok: true,
    reviews,
    counts: {
      pending: reviews.filter((review) => review.status === "pending").length,
      approved: reviews.filter((review) => review.status === "approved").length,
      rejected: reviews.filter((review) => review.status === "rejected").length
    }
  };
}

async function handleReviewsModeration(res) {
  sendJson(res, 200, await moderationReviewsPayload());
}

async function handleReviewStatus(req, res, reviewId) {
  const body = await readRequestJson(req);
  const nextStatus = cleanText(body.status);
  const validStatuses = new Set(["pending", "approved", "rejected"]);
  if (!validStatuses.has(nextStatus)) {
    sendJson(res, 400, { ok: false, message: "Status de depoimento inválido." });
    return;
  }

  const reviews = await readProductReviews();
  const index = reviews.findIndex((review) => review.id === reviewId);
  if (index < 0) {
    sendJson(res, 404, { ok: false, message: "Depoimento não encontrado." });
    return;
  }

  reviews[index] = {
    ...reviews[index],
    status: nextStatus,
    updatedAt: new Date().toISOString(),
    approvedAt: nextStatus === "approved" ? new Date().toISOString() : reviews[index].approvedAt || null
  };
  await writeProductReviews(reviews);

  sendJson(res, 200, await moderationReviewsPayload());
}

async function handleReviewDelete(res, reviewId) {
  const reviews = await readProductReviews();
  const nextReviews = reviews.filter((review) => review.id !== reviewId);
  if (nextReviews.length === reviews.length) {
    sendJson(res, 404, { ok: false, message: "Depoimento não encontrado." });
    return;
  }

  await writeProductReviews(nextReviews);
  sendJson(res, 200, await moderationReviewsPayload());
}

async function handleYampiWebhook(req, res) {
  const rawBody = await readRequestBody(req);
  let body = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    sendJson(res, 400, { ok: false, message: "Payload JSON inválido." });
    return;
  }

  const secret = await yampiWebhookSecret();
  const signature = req.headers["x-yampi-hmac-sha256"];
  const verification = verifyYampiSignature(rawBody, body, secret, signature);
  if (!verification.ok) {
    sendJson(res, 401, { ok: false, message: "Assinatura Yampi inválida." });
    return;
  }

  const event = String(body.event || "").trim();
  const shouldSync = YAMPI_PRODUCT_EVENTS.includes(event) || event.startsWith("category.");
  if (!shouldSync) {
    sendJson(res, 202, { ok: true, ignored: true, event: event || null });
    return;
  }

  syncYampiCatalog()
    .then((payload) => {
      console.log(`Webhook Yampi ${event}: ${payload.count} produto(s) sincronizado(s).`);
    })
    .catch((error) => {
      console.error(`Erro ao processar webhook Yampi ${event}:`, error);
    });

  sendJson(res, 202, {
    ok: true,
    event,
    accepted: true,
    verified: verification.verified,
    message: "Sincronizacao Yampi agendada."
  });
}

async function handleYampiWebhookInstall(res) {
  const url = yampiWebhookUrl();
  if (!url) {
    sendJson(res, 400, {
      ok: false,
      message: "Defina PUBLIC_SITE_URL no .env para registrar o webhook na Yampi."
    });
    return;
  }

  const webhookBody = {
    url,
    events: YAMPI_PRODUCT_EVENTS,
    name: "Caomisa - catalogo Yampi"
  };
  const existingWebhooks = await fetchYampiCollection("webhooks");
  const existing = existingWebhooks.find((webhook) => sameUrl(webhook.url, url));
  let webhook = existing;
  let created = false;
  let updated = false;

  if (existing?.id) {
    const events = webhookEvents(existing);
    const hasAllEvents = YAMPI_PRODUCT_EVENTS.every((event) => events.includes(event));
    if (!hasAllEvents || existing.name !== webhookBody.name) {
      const payload = await yampiRequest(`webhooks/${existing.id}`, {}, {
        method: "PUT",
        body: webhookBody
      });
      webhook = unwrapResource(payload);
      updated = true;
    }
  } else {
    const payload = await yampiRequest("webhooks", {}, {
      method: "POST",
      body: webhookBody
    });
    webhook = unwrapResource(payload);
    created = true;
  }

  const secret = webhook?.secret_key || webhook?.secretKey || "";
  if (secret || webhook?.id) {
    await writeWebhookConfig({
      id: webhook?.id || existing?.id || null,
      url,
      secretKey: secret || (await readWebhookConfig()).secretKey || "",
      events: YAMPI_PRODUCT_EVENTS
    });
  }

  sendJson(res, created ? 201 : 200, {
    ok: true,
    created,
    updated,
    webhookId: webhook?.id || existing?.id || null,
    webhookUrl: url,
    events: YAMPI_PRODUCT_EVENTS,
    secretConfigured: Boolean((await yampiWebhookSecret()) || secret)
  });
}

async function handleYampiCheckout(req, res) {
  const body = await readRequestJson(req);
  const items = Array.isArray(body.items) ? body.items : [];
  const validItems = items
    .map((item) => ({
      token: String(item.token || "").trim(),
      quantity: Math.max(1, Number(item.quantity || 1)),
      purchaseUrl: String(item.purchaseUrl || "")
    }))
    .filter((item) => item.token);

  if (!validItems.length) {
    sendJson(res, 400, { ok: false, message: "Nenhum item válido no carrinho." });
    return;
  }

  const directPurchaseUrl = validItems.length === 1 ? checkoutUrlFromPurchaseUrl(validItems[0]) : "";
  if (directPurchaseUrl) {
    sendJson(res, 200, {
      ok: true,
      url: directPurchaseUrl
    });
    return;
  }

  const base = checkoutBaseFromItems(validItems);
  const path = validItems.map((item) => `${encodeURIComponent(item.token)}:${item.quantity}`).join(",");
  sendJson(res, 200, {
    ok: true,
    url: `${base}/r/${path}`
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url || "/", `http://localhost:${port}`);

  try {
    if (url.pathname === "/api/admin/login" && req.method === "POST") {
      await handleAdminLogin(req, res);
      return true;
    }

    if (url.pathname === "/api/products" && req.method === "GET") {
      await handleProducts(res);
      return true;
    }

    if (url.pathname === "/api/categories" && req.method === "GET") {
      await handleCategories(res);
      return true;
    }

    if (url.pathname === "/api/collections" && req.method === "GET") {
      await handleCollectionsGet(res);
      return true;
    }

    if (url.pathname === "/api/collections" && req.method === "PUT") {
      if (!requireAdmin(req, res)) return true;
      await handleCollectionsPut(req, res);
      return true;
    }

    const metadataMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/metadata$/);
    if (metadataMatch && req.method === "PUT") {
      if (!requireAdmin(req, res)) return true;
      await handleProductMetadata(req, res, decodeURIComponent(metadataMatch[1]));
      return true;
    }

    const productDeleteMatch = url.pathname.match(/^\/api\/products\/([^/]+)$/);
    if (productDeleteMatch && req.method === "DELETE") {
      if (!requireAdmin(req, res)) return true;
      await handleProductDelete(res, decodeURIComponent(productDeleteMatch[1]));
      return true;
    }

    const publicReviewMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/reviews$/);
    if (publicReviewMatch && req.method === "POST") {
      await handleProductReviewSubmit(req, res, decodeURIComponent(publicReviewMatch[1]));
      return true;
    }

    if (url.pathname === "/api/reviews" && req.method === "GET") {
      if (!requireAdmin(req, res)) return true;
      await handleReviewsModeration(res);
      return true;
    }

    const reviewStatusMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)$/);
    if (reviewStatusMatch && req.method === "PATCH") {
      if (!requireAdmin(req, res)) return true;
      await handleReviewStatus(req, res, decodeURIComponent(reviewStatusMatch[1]));
      return true;
    }

    if (reviewStatusMatch && req.method === "DELETE") {
      if (!requireAdmin(req, res)) return true;
      await handleReviewDelete(res, decodeURIComponent(reviewStatusMatch[1]));
      return true;
    }

    if (url.pathname === "/api/yampi/status") {
      if (!requireAdmin(req, res)) return true;
      sendJson(res, 200, {
        ok: true,
        configured: Boolean(yampiConfig.alias && yampiConfig.token && yampiConfig.secret),
        alias: yampiConfig.alias || null,
        webhookUrl: yampiWebhookUrl() || null,
        webhookConfigured: Boolean(await yampiWebhookSecret())
      });
      return true;
    }

    if (url.pathname === "/api/yampi/sync") {
      if (!requireAdmin(req, res)) return true;
      await handleYampiSync(res);
      return true;
    }

    if (url.pathname === "/api/yampi/webhook" && req.method === "POST") {
      await handleYampiWebhook(req, res);
      return true;
    }

    if (url.pathname === "/api/yampi/webhook/install" && req.method === "POST") {
      if (!requireAdmin(req, res)) return true;
      await handleYampiWebhookInstall(res);
      return true;
    }

    if (url.pathname === "/api/yampi/checkout" && req.method === "POST") {
      await handleYampiCheckout(req, res);
      return true;
    }

    sendJson(res, 404, { ok: false, message: "Endpoint não encontrado." });
    return true;
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      message: error.message || "Erro interno"
    });
    return true;
  }
}

function resolveFile(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  let normalized = cleanPath === "/" ? "/index.html" : cleanPath;

  if (normalized === "/produtos" || normalized === "/produtos/") {
    normalized = "/produtos.html";
  } else if (normalized === "/admin" || normalized === "/admin/") {
    normalized = "/admin.html";
  } else if (/^\/produto\/[^/]+\/?$/.test(normalized)) {
    normalized = "/produto.html";
  } else if (!path.extname(normalized)) {
    normalized = `${normalized}.html`;
  }

  const fullPath = path.join(root, normalized);

  if (!fullPath.startsWith(root)) {
    return null;
  }

  return fullPath;
}

async function requestListener(req, res) {
  if ((req.url || "").startsWith("/api/")) {
    await handleApi(req, res);
    return;
  }

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
    const cacheControl = [".webp", ".png", ".jpg", ".jpeg", ".svg", ".ico", ".woff2"].includes(ext)
      ? "public, max-age=3600"
      : "no-store";

    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": cacheControl
    });
    res.end(data);
  });
}

const server = http.createServer(requestListener);

if (require.main === module) {
  server.listen(port, () => {
    console.log(`Caomisa rodando em http://localhost:${port}`);
  });
}

module.exports = { requestListener, handleApi };
