const STORE_CONFIG = {
  checkoutBaseUrl: "https://caomisa.pay.yampi.com.br/r/GQRMH52BFY",
  whatsappNumber: "",
  vslEmbedUrl: "",
  pixelIds: {
    meta: "",
    googleAnalytics: "",
    tiktok: ""
  }
};

const sizes = {
  PP: { length: 27, belly: 42, neck: 23, checkoutUrl: "https://caomisa.pay.yampi.com.br/r/GTGZ3K18CI" },
  P: { length: 30, belly: 50, neck: 26, soldOut: true },
  M: { length: 35, belly: 56, neck: 36, checkoutUrl: "https://caomisa.pay.yampi.com.br/r/LPXHM0NDU9" },
  G: { length: 38, belly: 60, neck: 38, checkoutUrl: "https://caomisa.pay.yampi.com.br/r/5SCNKN19CN" },
  GG: { length: 48, belly: 68, neck: 43, checkoutUrl: "https://caomisa.pay.yampi.com.br/r/JI87HL0M1T" }
};

const packages = {
  unit: { label: "1 camisa pet", price: 49.9 }
};

let selectedSize = "M";
let selectedPackage = "unit";
let quantity = 1;

const formatBRL = (value) =>
  value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });

function updateIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function updatePrice() {
  const currentPrice = document.querySelector("#currentPrice");
  const installmentPrice = document.querySelector("#installmentPrice");
  const total = packages[selectedPackage].price * quantity;
  const instValue = 6.64 * quantity;
  
  currentPrice.textContent = formatBRL(total);
  if(installmentPrice) {
    installmentPrice.textContent = instValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

function updateSizeNote() {
  const data = sizes[selectedSize];
  document.querySelector(
    "#sizeNote"
  ).textContent = `${selectedSize}: comprimento ${data.length} cm, barriga ${data.belly} cm, pescoco ${data.neck} cm.`;
}

function buildOrder() {
  const total = packages[selectedPackage].price * quantity;
  return {
    product: "Caomisa Brasil Pet",
    size: selectedSize,
    package: packages[selectedPackage].label,
    quantity,
    total
  };
}

function buildCheckoutUrl(order) {
  const sizeData = sizes[order.size];
  const baseUrl = (sizeData && sizeData.checkoutUrl) ? sizeData.checkoutUrl : STORE_CONFIG.checkoutBaseUrl;

  if (baseUrl) {
    const params = new URLSearchParams({
      quantity: String(order.quantity)
    });
    return `${baseUrl}?${params.toString()}`;
  }

  if (STORE_CONFIG.whatsappNumber) {
    const message = `Oi! Quero comprar: ${order.product}%0ATamanho: ${order.size}%0APedido: ${order.package}%0AQuantidade: ${order.quantity}%0ATotal: ${formatBRL(order.total)}`;
    return `https://wa.me/${STORE_CONFIG.whatsappNumber}?text=${message}`;
  }

  return "";
}

function trackEvent(name, payload = {}) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: name, ...payload });

  if (typeof window.fbq === "function") {
    window.fbq("trackCustom", name, payload);
  }

  if (typeof window.ttq?.track === "function") {
    window.ttq.track(name, payload);
  }
}

function openCheckoutModal(order, checkoutUrl) {
  const modal = document.querySelector("#checkoutModal");
  const summary = document.querySelector("#modalSummary");
  const fallback = document.querySelector("#fallbackContact");

  summary.innerHTML = `
    <strong>${order.product}</strong>
    <span>Tamanho: ${order.size}</span>
    <span>Pedido: ${order.package}</span>
    <span>Quantidade: ${order.quantity}</span>
    <span>Total: ${formatBRL(order.total)}</span>
  `;

  if (checkoutUrl) {
    const isWhatsapp = checkoutUrl.startsWith("https://wa.me/");
    fallback.href = checkoutUrl;
    fallback.innerHTML = `<i data-lucide="${
      isWhatsapp ? "message-circle" : "credit-card"
    }" aria-hidden="true"></i>${isWhatsapp ? "Enviar pelo WhatsApp" : "Continuar para pagamento"}`;
  } else {
    fallback.href = "#comprar";
  }

  if (typeof modal.showModal === "function") {
    modal.showModal();
  } else {
    alert("Checkout pronto para conectar. Passe o link do checkout ou WhatsApp.");
  }

  updateIcons();
}

function initGallery() {
  const mainPhoto = document.querySelector("#mainPhoto");
  document.querySelectorAll(".thumb").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".thumb").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      mainPhoto.src = button.dataset.photo;
    });
  });
}

function initSizeSelector() {
  document.querySelectorAll(".size-btn").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) {
        return;
      }
      selectedSize = button.dataset.size;
      document.querySelectorAll(".size-btn").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      updateSizeNote();
      trackEvent("SelectSize", { size: selectedSize });
    });
  });
}

function initQuantity() {
  const input = document.querySelector("#quantity");

  document.querySelector("#decreaseQty").addEventListener("click", () => {
    quantity = Math.max(1, quantity - 1);
    input.value = quantity;
    updatePrice();
  });

  document.querySelector("#increaseQty").addEventListener("click", () => {
    quantity = Math.min(9, quantity + 1);
    input.value = quantity;
    updatePrice();
  });
}

function initCheckout() {
  document.querySelector("#buyForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const order = buildOrder();
    const checkoutUrl = buildCheckoutUrl(order);

    trackEvent("InitiateCheckout", {
      content_name: order.product,
      size: order.size,
      package: order.package,
      quantity: order.quantity,
      value: order.total,
      currency: "BRL"
    });

    if (checkoutUrl && !checkoutUrl.startsWith("https://wa.me/")) {
      window.location.href = checkoutUrl;
      return;
    }

    openCheckoutModal(order, checkoutUrl);
  });

  document.querySelector("#closeModal").addEventListener("click", () => {
    document.querySelector("#checkoutModal").close();
  });
}

function initVideoSlot() {
  const shell = document.querySelector("[data-video-placeholder]");
  if (!shell) {
    return;
  }

  shell.addEventListener("click", () => {
    if (!STORE_CONFIG.vslEmbedUrl) {
      trackEvent("VslPlaceholderClick");
      return;
    }

    shell.innerHTML = `<iframe src="${STORE_CONFIG.vslEmbedUrl}" title="Video da camisa pet" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  updateIcons();
  initGallery();
  initSizeSelector();
  initQuantity();
  initCheckout();
  initVideoSlot();
  updateSizeNote();
  updatePrice();
});
