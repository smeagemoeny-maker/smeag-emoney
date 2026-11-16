const {
  apiCharge,
  apiCheckout,
  apiLogin,
  apiPersonByNfc,
  apiProducts,
  apiPusanPayment,
  getApiBase,
  setApiBase,
  setAuthToken,
  setUnauthorizedHandler,
} = window.PusanApi;
const {
  READER_FORMATS,
  dispatchManualUid,
  enableKeyboardReader,
  getReaderFormat,
  listenForNfc,
  phoneNfcSupport,
  readerUidToHex,
  setReaderFormat,
  startNfcScan,
  stopNfcScan,
} = window.PusanNfc;

// Two sales screens: SMEAG Cafe (campus cafes) and PUSAN Mart (single store).
const STORES = {
  cafe: {
    key: "cafe",
    navLabel: "SMEAG Cafe",
    eyebrow: "SMEAG CAFE",
    title: "Cafe Sales",
    campuses: ["Capital", "Encanto", "Tarlac"],
    defaultCampus: "Capital",
  },
  mart: {
    key: "mart",
    navLabel: "PUSAN Mart",
    eyebrow: "PUSAN MART",
    title: "Mart Sales",
    campuses: ["Pusan Mart"],
    defaultCampus: "Pusan Mart",
  },
};

const NAV_LABELS = {
  cafe: STORES.cafe.navLabel,
  mart: STORES.mart.navLabel,
  buyer: "Buyer",
  "pusan-pay": "Pusan Pay",
  settings: "Settings",
};

// Material icon paths (same icon family as the Android app's bottom NavigationBar).
const NAV_ICONS = {
  cafe: "M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.9 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3zM4 19h16v2H4z",
  mart: "M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1.003 1.003 0 0020 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z",
  buyer: "M3 5v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2H5c-1.11 0-2 .9-2 2zm12 4c0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3 3 1.34 3 3zm-9 8c0-2 4-3.1 6-3.1s6 1.1 6 3.1v1H6v-1z",
  "pusan-pay": "M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z",
  settings: "M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z",
};

const DISCOUNTS = [
  { label: "No Discount", text: "No Discount", rate: 0 },
  { label: "Teacher 10%", text: "Teacher 10%", rate: 0.1 },
  { label: "Manager 15%", text: "Manager 15%", rate: 0.15 },
];

const ALL = "All";
const CHARGE_PRESETS = [100, 500, 1000, 2000];
const READER_FORMAT_TEXT = {
  auto: "Auto (10-digit number = decimal, reversed; otherwise HEX)",
  hex: "HEX as is",
  "dec-reversed": "Decimal (bytes reversed)",
  dec: "Decimal (byte order as is)",
};

function newStoreState(store) {
  return {
    campus: store.defaultCampus,
    products: [],
    loaded: false,
    category: ALL,
    search: "",
    cart: [],
    discountLabel: "No Discount",
    discountRate: 0,
    lastReceipt: null,
    lastLookup: null, // person shown after a tap with an empty cart
    panel: "sale", // cafe only: "sale" | "charge"
    chargeAmount: "",
    lastCharge: null,
  };
}

const state = {
  route: "login",
  manager: null,
  // What this account may use; comes from the API at login (see api/src/access.mjs).
  access: null,
  demoMode: false,
  stores: { cafe: newStoreState(STORES.cafe), mart: newStoreState(STORES.mart) },
  nfcMode: "idle",
  status: "Log in or open the demo.",
  buyer: null,
  pusanAmount: "",
  manualUid: "",
  busy: false,
};

const app = document.querySelector("#app");
if (!app) throw new Error("Missing app root");

// A tap on a store screen with an empty cart (sale panel) looks up the student without pressing a button.
function idleLookupStore() {
  const key = state.route;
  if (state.nfcMode !== "idle" || !STORES[key] || !state.manager) return null;
  const store = state.stores[key];
  return !store.cart.length && store.panel !== "charge" ? key : null;
}

listenForNfc(async ({ uid, source }) => {
  if (state.busy) return;
  const mode = state.nfcMode === "idle" ? idleLookupStore() : state.nfcMode;
  if (!mode) return;
  state.busy = true;
  state.status = `NFC read: ${source} / ${uid}`;
  render();

  try {
    if (mode === "buyer") await handleBuyer(uid);
    else if (mode === "pusan-pay") await handlePusanPay(uid);
    else if (mode === "cafe-charge") await handleCharge(uid);
    else if (STORES[mode]) await handleCheckout(mode, uid);
  } catch (error) {
    state.status = error instanceof Error ? error.message : "NFC failed.";
  } finally {
    state.busy = false;
    state.nfcMode = "idle";
    stopNfcScan();
    render();
  }
});

// USB/Bluetooth readers (keyboard mode) are only listened to while a tap is expected.
enableKeyboardReader(() => !state.busy && (state.nfcMode !== "idle" || !!idleLookupStore()));

window.addEventListener("nfc-error", (event) => {
  if (state.nfcMode === "idle") return;
  state.status = event.detail?.message || "Could not read the card.";
  render();
});

setUnauthorizedHandler((message) => {
  logout(message || "Your login has expired. Please log in again.");
});

window.addEventListener("hashchange", () => {
  setRoute(location.hash.replace("#/", ""));
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js").catch(() => undefined);
}

if (new URLSearchParams(location.search).get("demo") === "1") {
  enterDemo();
} else {
  render();
}

// ---------- routing ----------

// Screens the logged-in account may open, in nav order.
function allowedRoutes() {
  const access = state.access;
  if (!access) return [];
  return [
    ...["cafe", "mart"].filter((key) => access.stores.includes(key)),
    "buyer",
    ...(access.canPusanPay ? ["pusan-pay"] : []),
    "settings",
  ];
}

function homeRoute() {
  return allowedRoutes()[0] || "login";
}

function normalizeRoute(route) {
  if (route === "sales") route = "mart"; // legacy link
  if (!state.manager) return "login";
  return allowedRoutes().includes(route) ? route : homeRoute();
}

function setRoute(route) {
  state.route = normalizeRoute(route);
  if (state.nfcMode !== "idle") {
    state.nfcMode = "idle";
    stopNfcScan();
  }
  render();
  if (STORES[state.route] && !state.stores[state.route].loaded) loadProducts(state.route);
}

function go(route) {
  if (location.hash === `#/${route}`) setRoute(route);
  else location.hash = `#/${route}`;
}

// ---------- data ----------

async function loadProducts(storeKey, { quiet = false } = {}) {
  const store = state.stores[storeKey];
  if (state.demoMode) {
    store.products = demoProducts(storeKey, store.campus);
    store.loaded = true;
    render();
    return;
  }
  const campus = store.campus;
  const requestId = (store.requestId || 0) + 1;
  store.requestId = requestId;
  if (!quiet) {
    state.status = "Loading products...";
    render();
  }
  try {
    const all = await apiProducts(campus);
    // A newer request (e.g. campus changed meanwhile) owns the result.
    if (store.requestId !== requestId || store.campus !== campus) return;
    store.products = filterStoreProducts(storeKey, campus, all);
    store.loaded = true;
    // Drop cart lines whose product disappeared, refresh product data for the rest.
    store.cart = store.cart
      .map((line) => ({ ...line, product: store.products.find((p) => p.id === line.product.id) }))
      .filter((line) => line.product);
    if (!quiet) state.status = `${STORES[storeKey].navLabel} · ${store.campus}: ${store.products.length} products`;
  } catch (error) {
    if (store.requestId !== requestId) return;
    state.status = `Could not load products: ${error instanceof Error ? error.message : error}`;
  }
  render();
}

// The products API returns the campus rows plus campus 'ALL' rows, which mix in other
// campuses' menus. Keep only rows that belong to this store and campus.
function filterStoreProducts(storeKey, campus, products) {
  const campusUp = campus.toUpperCase();
  return products.filter((p) => {
    const menu = String(p.mMenu || "").trim();
    const menuUp = menu.toUpperCase();
    const rowCampus = String(p.campus || "").toUpperCase();
    if (!menu || !p.sMenu) return false;
    if (storeKey === "cafe") {
      const isCafe = /CAFE|AMERICANO/.test(menuUp);
      const isThisCampus = rowCampus === campusUp ? true : menuUp.startsWith(campusUp);
      return isCafe && isThisCampus;
    }
    return rowCampus === campusUp || menuUp.startsWith(campusUp);
  });
}

async function handleCheckout(storeKey, uid) {
  const store = state.stores[storeKey];
  // Empty cart: the tap only looks up the student's info and balance.
  if (!store.cart.length) return handleLookup(storeKey, uid);
  const payload = {
    uid,
    store: storeKey,
    campus: store.campus,
    cart: store.cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
    discountLabel: store.discountLabel,
    discountRate: store.discountRate,
  };

  let checkout;
  if (state.demoMode) {
    checkout = {
      orderId: `demo-${Date.now()}`,
      finalTotal: cartTotal(store),
      remainingBalance: Math.max(0, 1000 - cartTotal(store)),
      buyerName: "Demo Buyer",
    };
    for (const line of store.cart) line.product.stock -= line.quantity;
  } else {
    checkout = (await apiCheckout(payload)).checkout;
  }

  store.lastReceipt = {
    ...checkout,
    uid,
    campus: store.campus,
    discountLabel: store.discountLabel,
    items: store.cart.map((line) => ({ name: line.product.sMenu, quantity: line.quantity, price: Number(line.product.payment) })),
    at: new Date(),
  };
  store.cart = [];
  store.lastLookup = null; // its balance is stale after a payment
  state.status = `Paid: ${checkout.buyerName || uid} · ${money(checkout.finalTotal)} · Balance ${money(checkout.remainingBalance)}`;
  // Refresh stock without replacing the payment result message.
  if (!state.demoMode) await loadProducts(storeKey, { quiet: true });
}

async function handleLookup(storeKey, uid) {
  const store = state.stores[storeKey];
  store.lastLookup = null;
  if (state.demoMode) {
    store.lastLookup = { name: "Demo Buyer", uid, campus: store.campus, totalMoney: 1000 };
    state.status = `Found: Demo Buyer · Balance ${money(1000)}`;
    return;
  }
  const person = (await apiPersonByNfc(uid)).person;
  if (!person) {
    state.status = `This card is not registered. (${uid})`;
    return;
  }
  store.lastLookup = person;
  state.status = `Found: ${person.name || uid} · Balance ${money(person.totalMoney)}`;
}

async function handleBuyer(uid) {
  if (state.demoMode) {
    state.buyer = { name: "Demo Buyer", uid, campus: "Pusan Mart", totalMoney: 1000 };
    state.status = "Demo buyer info.";
    return;
  }
  const result = await apiPersonByNfc(uid);
  state.buyer = result.person;
  state.status = result.person ? "Buyer info loaded." : `This card is not registered. (${uid})`;
}

async function handlePusanPay(uid) {
  const totalAmount = Number(state.pusanAmount);
  if (!(totalAmount > 0)) throw new Error("Enter a valid amount first.");
  if (state.demoMode) {
    state.status = `Pusan Pay saved (demo): ${uid} / ${money(totalAmount)}`;
  } else {
    const result = await apiPusanPayment({ uid, totalAmount });
    state.status = `Pusan Pay saved: ${result.payment.name || uid} / ${money(result.payment.allPayments)}`;
  }
  state.pusanAmount = "";
}

async function handleCharge(uid) {
  const store = state.stores.cafe;
  const amount = Number(store.chargeAmount);
  if (!(amount > 0)) throw new Error("Enter the recharge amount first.");
  let charge;
  if (state.demoMode) {
    charge = { uid, buyerName: "Demo Buyer", amount, beforeAmount: 1000, totalMoney: 1000 + amount };
  } else {
    charge = (await apiCharge({
      uid,
      campus: store.campus,
      amount,
    })).charge;
  }
  store.lastCharge = { ...charge, campus: store.campus, at: new Date() };
  store.chargeAmount = "";
  state.status = `Recharged: ${charge.buyerName || uid} · +${money(charge.amount)} · Balance ${money(charge.totalMoney)}`;
}

// ---------- views ----------

function render() {
  const focused = document.activeElement?.dataset?.search ? document.activeElement : null;
  const caret = focused?.selectionStart;
  app.innerHTML = `
    <section class="shell">
      ${state.manager ? nav() : ""}
      <section class="content">
        ${view()}
      </section>
      ${statusBar()}
    </section>
  `;
  bindEvents();
  if (focused) {
    const input = app.querySelector("[data-search]");
    if (input) {
      input.focus();
      if (caret != null) input.setSelectionRange(caret, caret);
    }
  }
}

function view() {
  if (!state.manager || state.route === "login") return loginView();
  if (!allowedRoutes().includes(state.route)) return salesView(homeRoute());
  if (state.route === "buyer") return buyerView();
  if (state.route === "pusan-pay") return pusanPayView();
  if (state.route === "settings") return settingsView();
  if (STORES[state.route]) return salesView(state.route);
  return salesView("mart");
}

function nav() {
  return `
    <nav class="nav">
      ${allowedRoutes().map((route) => navButton(route, NAV_LABELS[route])).join("")}
    </nav>
  `;
}

function navButton(route, label) {
  const count = STORES[route] ? state.stores[route].cart.reduce((n, l) => n + l.quantity, 0) : 0;
  const icon = NAV_ICONS[route] ? `<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${NAV_ICONS[route]}"/></svg>` : "";
  return `<button class="nav-btn ${state.route === route ? "active" : ""}" data-route="${route}">${icon}<span class="nav-label">${escapeHtml(label)}</span>${count ? `<span class="badge">${count}</span>` : ""}</button>`;
}

function loginView() {
  return `
    <form class="panel login" data-form="login">
      <p class="eyebrow">SMEAG CAFE · PUSAN MART</p>
      <h1>POS Login</h1>
      <label>Manager ID<input name="loginId" autocomplete="username" required /></label>
      <button class="primary" type="submit" ${state.busy ? "disabled" : ""}>Log in</button>
      <button class="secondary wide" type="button" data-demo-login>Open demo</button>
    </form>
  `;
}

function salesView(storeKey) {
  const def = STORES[storeKey];
  const store = state.stores[storeKey];
  // Category names in the DB differ only by case in places ("Encanto Cafe" / "ENCANTO CAFE"): merge them.
  const byKey = new Map();
  for (const p of store.products) {
    const key = categoryKey(p.mMenu);
    if (!byKey.has(key)) byKey.set(key, p.mMenu.trim());
  }
  const categories = [ALL, ...[...byKey.values()].sort((a, b) => a.localeCompare(b))];
  const term = store.search.trim().toLowerCase();
  const visible = store.products.filter((p) =>
    (store.category === ALL || categoryKey(p.mMenu) === categoryKey(store.category)) &&
    (!term || String(p.sMenu).toLowerCase().includes(term)),
  );
  // In-stock items first; sold-out ones sink to the bottom (stable within each group).
  visible.sort((a, b) => Number(Number(a.stock) <= 0) - Number(Number(b.stock) <= 0));
  const itemCount = store.cart.reduce((n, l) => n + l.quantity, 0);
  const waiting = state.nfcMode === storeKey;

  return `
    <section class="toolbar">
      <div>
        <p class="eyebrow">${def.eyebrow}</p>
        <h1>${def.title}</h1>
      </div>
      <div class="filters">
        ${campusesFor(storeKey).length > 1 ? selectField("Campus", "campus", campusesFor(storeKey), store.campus) : `<span class="campus-fixed">${escapeHtml(store.campus)}</span>`}
        ${selectField("Category", "category", categories, store.category)}
        <label>Search<input data-search placeholder="Product name" value="${escapeHtml(store.search)}" /></label>
      </div>
    </section>
    <section class="grid-layout">
      <section class="products">
        ${!store.loaded ? emptyProducts("Loading products, or the API is not connected.") : visible.length ? visible.map((p) => productCard(storeKey, p)).join("") : emptyProducts("No matching products.")}
      </section>
      <aside class="cart panel" id="cart">
        ${storeKey === "cafe" && state.access?.canCharge ? panelToggle(store) : ""}
        ${storeKey === "cafe" && state.access?.canCharge && store.panel === "charge" ? chargePanel(store) : salePanel(storeKey, store, waiting)}
      </aside>
    </section>
    <div class="cart-bar">
      <span>${itemCount} items · <strong>${money(cartTotal(store))}</strong></span>
      <button class="primary" data-scroll-cart ${itemCount ? "" : "disabled"}>Cart · Pay</button>
    </div>
  `;
}

// Cafe campuses this account may sell/charge at (a cafe manager only gets their own campus).
function campusesFor(storeKey) {
  if (storeKey !== "cafe") return STORES[storeKey].campuses;
  const allowed = state.access?.cafeCampuses || [];
  return STORES.cafe.campuses.filter((c) => allowed.includes(c));
}

function panelToggle(store) {
  return `
    <div class="segmented">
      <button class="${store.panel === "sale" ? "selected" : ""}" data-panel="sale" ${state.nfcMode !== "idle" ? "disabled" : ""}>Pay</button>
      <button class="${store.panel === "charge" ? "selected" : ""}" data-panel="charge" ${state.nfcMode !== "idle" ? "disabled" : ""}>E-money Recharge</button>
    </div>
  `;
}

function chargePanel(store) {
  const waiting = state.nfcMode === "cafe-charge";
  return `
    <h2>E-money Recharge · ${escapeHtml(store.campus)}</h2>
    <label>Recharge Amount<input data-charge-amount inputmode="decimal" placeholder="0.00" value="${escapeHtml(store.chargeAmount)}" ${waiting ? "disabled" : ""} /></label>
    <div class="discounts">
      ${CHARGE_PRESETS.map((v) => `<button data-charge-preset="${v}" ${waiting ? "disabled" : ""}>+${v}</button>`).join("")}
    </div>
    <div class="total"><span>Recharge</span><strong>${money(store.chargeAmount)}</strong></div>
    ${waiting
      ? `<button class="secondary wide" data-cancel-nfc>Cancel NFC</button>`
      : `<button class="primary" data-nfc="cafe-charge" ${Number(store.chargeAmount) > 0 && !state.busy ? "" : "disabled"}>Tap card to recharge</button>`}
    ${nfcHint()}
    ${manualNfcPanel("cafe-charge", !(Number(store.chargeAmount) > 0))}
    ${store.lastCharge ? chargeCard(store.lastCharge) : ""}
  `;
}

function chargeCard(c) {
  return `
    <article class="receipt">
      <h3>Last Recharge</h3>
      <p>${escapeHtml(c.buyerName || c.uid)} · ${escapeHtml(c.campus)} · ${c.at.toLocaleString()}</p>
      <p>Recharge <strong>+${money(c.amount)}</strong> · ${money(c.beforeAmount)} → <strong>${money(c.totalMoney)}</strong></p>
    </article>
  `;
}

function salePanel(storeKey, store, waiting) {
  return `
        <h2>Cart · ${escapeHtml(store.campus)}</h2>
        ${store.cart.length ? store.cart.map(cartRow).join("") : `<p class="muted">Select products.</p>`}
        <div class="discounts">
          ${DISCOUNTS.map((d) => `<button class="${store.discountLabel === d.label ? "selected" : ""}" data-discount="${d.rate}" data-label="${d.label}">${d.text}</button>`).join("")}
        </div>
        <div class="total"><span>Total</span><strong>${money(cartTotal(store))}</strong></div>
        ${waiting
          ? `<button class="secondary wide" data-cancel-nfc>Cancel NFC</button>`
          : `<button class="primary" data-nfc="${storeKey}" ${state.busy ? "disabled" : ""}>${!store.cart.length ? "Tap card to check balance" : storeKey === "mart" ? "Pay with phone NFC" : "Tap card to pay"}</button>`}
        ${nfcHint()}
        ${manualNfcPanel(storeKey)}
        ${store.lastLookup ? buyerCard(store.lastLookup) : ""}
        ${store.lastReceipt ? receiptCard(store.lastReceipt) : ""}
  `;
}

// Which tap inputs this device offers: phone NFC (native bridge / Web NFC) and keyboard readers.
function nfcHint() {
  const phone = {
    "android-native": "Phone NFC available (app)",
    "web-nfc": "Phone NFC available (Chrome)",
    "web-nfc-insecure": "Phone NFC: HTTPS only",
    none: "Browser has no phone NFC",
  }[phoneNfcSupport()];
  return `<p class="muted nfc-hint">${escapeHtml(phone)} · USB/Bluetooth reader available</p>`;
}

function categoryKey(value) {
  return String(value || "").trim().toUpperCase();
}

function selectField(label, name, options, selected) {
  return `
    <label>${label}
      <select data-select="${name}">
        ${options.map((o) => `<option value="${escapeHtml(o)}" ${o === selected ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
      </select>
    </label>
  `;
}

function productCard(storeKey, product) {
  const inCart = state.stores[storeKey].cart.find((l) => l.product.id === product.id)?.quantity || 0;
  const soldOut = Number(product.stock) <= 0;
  const low = !soldOut && Number(product.stock) <= Number(product.minStock || 0);
  return `
    <button class="product ${soldOut ? "soldout" : ""}" data-product="${product.id}">
      <span class="product-img">${initial(product.sMenu)}${inCart ? `<span class="badge">${inCart}</span>` : ""}</span>
      <strong>${escapeHtml(product.sMenu || "-")}</strong>
      <small>${escapeHtml(product.mMenu || "-")}</small>
      <span class="product-meta">${money(product.payment)} · ${soldOut ? "Sold out" : `Stock ${product.stock}${low ? " (low)" : ""}`}</span>
    </button>
  `;
}

function cartRow(line) {
  return `
    <div class="cart-row">
      <span>${escapeHtml(line.product.sMenu || "-")}<small class="muted"> ${money(line.product.payment * line.quantity)}</small></span>
      <div>
        <button data-qty="${line.product.id}" data-delta="-1">-</button>
        <strong>${line.quantity}</strong>
        <button data-qty="${line.product.id}" data-delta="1" ${line.quantity >= Number(line.product.stock) ? "disabled" : ""}>+</button>
      </div>
    </div>
  `;
}

function receiptCard(r) {
  return `
    <article class="receipt">
      <h3>Last Payment</h3>
      <p>${escapeHtml(r.buyerName || r.uid)} · ${escapeHtml(r.campus)} · ${r.at.toLocaleString()}</p>
      ${r.items.map((i) => `<p>${escapeHtml(i.name)} × ${i.quantity}</p>`).join("")}
      <p>${escapeHtml(r.discountLabel)} · Paid <strong>${money(r.finalTotal)}</strong> · Balance ${money(r.remainingBalance)}</p>
    </article>
  `;
}

function buyerView() {
  return `
    <section class="panel">
      <p class="eyebrow">BUYER INFO</p>
      <h1>Buyer Info</h1>
      ${state.nfcMode === "buyer" ? `<button class="secondary wide" data-cancel-nfc>Cancel NFC</button>` : `<button class="primary" data-nfc="buyer">Tap card to look up</button>`}
      ${manualNfcPanel("buyer")}
      ${state.buyer ? buyerCard(state.buyer) : `<p class="muted">No buyer looked up yet.</p>`}
    </section>
  `;
}

function buyerCard(person) {
  return `
    <article class="buyer-card">
      <h2>${escapeHtml(person.name || "-")}</h2>
      <p>UID ${escapeHtml(person.uid)}</p>
      ${person.studentId ? `<p>Student ID ${escapeHtml(person.studentId)}</p>` : ""}
      <p>Campus ${escapeHtml(person.campus || "-")}</p>
      ${person.endDate ? `<p>Period ${escapeHtml(person.startDate || "-")} ~ ${escapeHtml(person.endDate)}</p>` : ""}
      <p>Balance <strong>${money(person.totalMoney)}</strong></p>
    </article>
  `;
}

function pusanPayView() {
  return `
    <form class="panel" data-form="pusan-pay">
      <p class="eyebrow">PUSAN PAY</p>
      <h1>Pusan Pay</h1>
      <label>Total Amount<input name="amount" inputmode="decimal" value="${escapeHtml(state.pusanAmount)}" placeholder="0.00" required /></label>
      ${state.nfcMode === "pusan-pay" ? `<button class="secondary wide" type="button" data-cancel-nfc>Cancel NFC</button>` : `<button class="primary" data-nfc="pusan-pay" type="button">Tap card to pay</button>`}
      ${manualNfcPanel("pusan-pay")}
    </form>
  `;
}

function settingsView() {
  return `
    <section class="panel">
      <p class="eyebrow">SETTINGS</p>
      <h1>Settings</h1>
      <p class="muted">Logged in: ${escapeHtml(state.manager?.name || state.manager?.login_id || "-")} (${escapeHtml(state.manager?.position || "-")} · ${escapeHtml(state.manager?.campus || "-")})${state.demoMode ? " · Demo mode" : ""}</p>
      <p class="muted">Access: ${escapeHtml(accessSummary())}</p>
      <label>API Base URL<input data-setting="api-base" value="${escapeHtml(getApiBase())}" /></label>
      <button class="secondary wide" data-save-api>Save API URL</button>
      <h2>NFC Reader</h2>
      <p class="muted">Connect a USB/Bluetooth reader in keyboard mode. If a card UID reads differently from the old app, change the format and check it on Buyer Info.</p>
      <label>Reader UID format
        <select data-reader-format>
          ${READER_FORMATS.map((f) => `<option value="${f}" ${getReaderFormat() === f ? "selected" : ""}>${escapeHtml(READER_FORMAT_TEXT[f])}</option>`).join("")}
        </select>
      </label>
      <label>Preview<input data-reader-preview placeholder="Reader output (e.g. 2864434397)" /></label>
      <p class="muted" data-reader-preview-out>&nbsp;</p>
      <button class="secondary wide" data-logout>Log out</button>
    </section>
  `;
}

function manualNfcPanel(mode, disabled = false) {
  return `
    <div class="manual-nfc">
      <input data-manual placeholder="Type a test UID" value="${escapeHtml(state.manualUid)}" />
      <button class="secondary" type="button" data-manual-send="${mode}" ${disabled || state.busy ? "disabled" : ""}>Send UID</button>
    </div>
  `;
}

function emptyProducts(message) {
  return `
    <div class="empty-products">
      <p class="muted">${escapeHtml(message)}</p>
      <button class="secondary wide" data-load-products>Reload products</button>
    </div>
  `;
}

function statusBar() {
  const message = state.busy
    ? "Processing..."
    : state.nfcMode !== "idle"
      ? `Tap the card${state.nfcMode === "cafe-charge" ? " to recharge" : ""} on the back of the phone or the reader...`
      : state.status;
  return `<div class="status ${state.nfcMode !== "idle" || state.busy ? "waiting" : ""}">${escapeHtml(message)}</div>`;
}

// ---------- events ----------

function currentStore() {
  return STORES[state.route] ? state.stores[state.route] : null;
}

function bindEvents() {
  app.querySelectorAll("[data-route]").forEach((button) => {
    button.onclick = () => go(button.dataset.route);
  });

  app.querySelector('[data-form="login"]')?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    state.busy = true;
    state.status = "Logging in...";
    render();
    try {
      const result = await apiLogin(String(form.get("loginId")).trim());
      if (!result.manager) throw new Error("This ID is not registered.");
      setAuthToken(result.token);
      state.manager = result.manager;
      state.access = result.access;
      state.demoMode = false;
      resetStores();
      state.status = `Logged in: ${result.manager.name || result.manager.login_id} · ${accessSummary()}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed";
      state.status = /cannot use the POS/.test(message) ? "This account cannot use the POS. (Admin or store Manager accounts only)" : message;
    } finally {
      state.busy = false;
    }
    if (state.manager) go(homeRoute());
    else render();
  });

  app.querySelector("[data-demo-login]")?.addEventListener("click", enterDemo);

  app.querySelectorAll("[data-select]").forEach((select) => {
    select.onchange = () => {
      const store = currentStore();
      if (!store) return;
      if (select.dataset.select === "campus") {
        if (store.cart.length && !confirm("Changing the campus empties the cart. Continue?")) {
          render();
          return;
        }
        store.campus = select.value;
        store.cart = [];
        store.category = ALL;
        store.loaded = false;
        loadProducts(state.route);
      } else {
        store.category = select.value;
        render();
      }
    };
  });

  app.querySelector("[data-search]")?.addEventListener("input", (event) => {
    const store = currentStore();
    if (store) {
      store.search = event.target.value;
      render();
    }
  });

  app.querySelectorAll("[data-product]").forEach((button) => {
    button.onclick = () => addToCart(Number(button.dataset.product));
  });

  app.querySelectorAll("[data-qty]").forEach((button) => {
    button.onclick = () => changeQty(Number(button.dataset.qty), Number(button.dataset.delta));
  });

  app.querySelectorAll("[data-discount]").forEach((button) => {
    button.onclick = () => {
      const store = currentStore();
      if (!store) return;
      store.discountRate = Number(button.dataset.discount);
      store.discountLabel = button.dataset.label || "No Discount";
      render();
    };
  });

  app.querySelectorAll("[data-nfc]").forEach((button) => {
    button.onclick = async () => {
      const mode = button.dataset.nfc;
      if (mode === "pusan-pay" && !capturePusanAmount()) return;
      // Keep reader keystrokes away from text fields while waiting.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      state.nfcMode = mode;
      render();
      try {
        // Phone NFC is optional: without it the USB/Bluetooth reader still works.
        await startNfcScan();
      } catch (error) {
        state.status = `Phone NFC failed to start: ${error instanceof Error ? error.message : error} (the reader still works)`;
      }
      render();
    };
  });

  app.querySelector("[data-cancel-nfc]")?.addEventListener("click", () => {
    state.nfcMode = "idle";
    stopNfcScan();
    state.status = "NFC cancelled.";
    render();
  });

  app.querySelectorAll("[data-manual]").forEach((input) => {
    input.oninput = () => {
      state.manualUid = input.value;
    };
  });

  app.querySelectorAll("[data-manual-send]").forEach((button) => {
    button.onclick = () => {
      const mode = button.dataset.manualSend;
      if (!state.manualUid.trim()) {
        state.status = "Enter a test UID.";
        render();
        return;
      }
      if (mode === "pusan-pay" && !capturePusanAmount()) return;
      state.nfcMode = mode;
      dispatchManualUid(state.manualUid);
    };
  });

  app.querySelectorAll("[data-panel]").forEach((button) => {
    button.onclick = () => {
      state.stores.cafe.panel = button.dataset.panel;
      render();
    };
  });

  app.querySelector("[data-charge-amount]")?.addEventListener("input", (event) => {
    // Update in place (no re-render) so typing is not interrupted.
    const store = state.stores.cafe;
    store.chargeAmount = event.target.value.trim();
    const valid = Number(store.chargeAmount) > 0;
    const total = app.querySelector(".cart .total strong");
    if (total) total.textContent = money(store.chargeAmount);
    app.querySelectorAll('[data-nfc="cafe-charge"], [data-manual-send="cafe-charge"]').forEach((button) => {
      button.disabled = !valid || state.busy;
    });
  });

  app.querySelectorAll("[data-charge-preset]").forEach((button) => {
    button.onclick = () => {
      const store = state.stores.cafe;
      const input = app.querySelector("[data-charge-amount]");
      const current = Number(input?.value || store.chargeAmount) || 0;
      store.chargeAmount = String(roundMoney(current + Number(button.dataset.chargePreset)));
      render();
    };
  });

  app.querySelector("[data-reader-format]")?.addEventListener("change", (event) => {
    setReaderFormat(event.target.value);
    updateReaderPreview();
    state.status = `Reader format: ${READER_FORMAT_TEXT[getReaderFormat()]}`;
  });

  app.querySelector("[data-reader-preview]")?.addEventListener("input", updateReaderPreview);

  app.querySelector("[data-scroll-cart]")?.addEventListener("click", () => {
    document.getElementById("cart")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  app.querySelector("[data-load-products]")?.addEventListener("click", () => {
    if (STORES[state.route]) loadProducts(state.route);
  });

  app.querySelector("[data-logout]")?.addEventListener("click", () => logout("Logged out."));

  app.querySelector("[data-save-api]")?.addEventListener("click", () => {
    const input = app.querySelector("[data-setting='api-base']");
    if (input) setApiBase(input.value);
    state.status = `API URL saved: ${getApiBase()}`;
    resetStoresLoaded();
    render();
  });
}

function updateReaderPreview() {
  const input = app.querySelector("[data-reader-preview]");
  const out = app.querySelector("[data-reader-preview-out]");
  if (!input || !out) return;
  const raw = input.value.trim();
  out.textContent = raw ? `→ UID ${readerUidToHex(raw)}` : "\u00a0";
}

function capturePusanAmount() {
  const amountInput = app.querySelector('input[name="amount"]');
  state.pusanAmount = amountInput?.value || "";
  if (!(Number(state.pusanAmount) > 0)) {
    state.status = "Enter a valid amount first.";
    render();
    return false;
  }
  return true;
}

function logout(message) {
  if (state.nfcMode !== "idle") stopNfcScan();
  setAuthToken(null);
  state.manager = null;
  state.access = null;
  state.demoMode = false;
  state.nfcMode = "idle";
  state.busy = false;
  state.buyer = null;
  resetStores();
  state.status = message;
  go("login");
}

function accessSummary() {
  const access = state.access;
  if (!access) return "-";
  const parts = [];
  if (access.stores.includes("cafe")) parts.push(`Cafe (${access.cafeCampuses.join("/")})${access.canCharge ? " pay·recharge" : " pay"}`);
  if (access.stores.includes("mart")) parts.push("Pusan Mart pay");
  if (access.canPusanPay) parts.push("Pusan Pay");
  return parts.join(", ");
}

function enterDemo() {
  state.manager = { id: 0, name: "Demo Manager", position: "Admin", campus: "Pusan Mart" };
  state.access = { stores: ["cafe", "mart"], cafeCampuses: [...STORES.cafe.campuses], canCharge: false, canPusanPay: true };
  state.demoMode = true;
  resetStores();
  state.status = "Demo mode. Nothing is saved to the real DB.";
  go(normalizeRoute(location.hash.replace("#/", "")));
}

function resetStores() {
  state.stores = { cafe: newStoreState(STORES.cafe), mart: newStoreState(STORES.mart) };
  const allowed = campusesFor("cafe");
  // mgperson spells Tarlac as 'Talrac'.
  const own = String(state.manager?.campus || "").toUpperCase().replace("TALRAC", "TARLAC");
  const campus = allowed.find((c) => c.toUpperCase() === own) || allowed[0];
  if (campus) state.stores.cafe.campus = campus;
}

function resetStoresLoaded() {
  for (const store of Object.values(state.stores)) store.loaded = false;
}

function addToCart(productId) {
  const store = currentStore();
  if (!store) return;
  const product = store.products.find((item) => item.id === productId);
  if (!product) return;
  const existing = store.cart.find((line) => line.product.id === productId);
  const qty = (existing?.quantity || 0) + 1;
  if (Number(product.stock) <= 0) {
    state.status = "Out of stock";
    render();
    return;
  }
  if (qty > Number(product.stock)) {
    state.status = `Not enough stock: ${product.sMenu} (in stock ${product.stock})`;
    render();
    return;
  }
  if (existing) existing.quantity = qty;
  else store.cart.push({ product, quantity: 1 });
  render();
}

function changeQty(productId, delta) {
  const store = currentStore();
  if (!store) return;
  const line = store.cart.find((item) => item.product.id === productId);
  if (!line) return;
  const next = line.quantity + delta;
  if (next > Number(line.product.stock)) return;
  line.quantity = next;
  store.cart = store.cart.filter((item) => item.quantity > 0);
  render();
}

// Mirrors the server: discount applied per line, rounded to cents.
function cartTotal(store) {
  return store.cart.reduce((total, line) => {
    const lineTotal = Number(line.product.payment) * line.quantity;
    return roundMoney(total + roundMoney(lineTotal - lineTotal * store.discountRate));
  }, 0);
}

function demoProducts(storeKey, campus) {
  if (storeKey === "cafe") {
    return [
      { id: 101, campus, mMenu: `${campus} Cafe`, sMenu: "Ice Americano", payment: 90, stock: 50, minStock: 5 },
      { id: 102, campus, mMenu: `${campus} Cafe`, sMenu: "Cafe Latte", payment: 110, stock: 40, minStock: 5 },
      { id: 103, campus, mMenu: `${campus} Cafe`, sMenu: "Lemon Ade", payment: 95, stock: 3, minStock: 5 },
      { id: 104, campus, mMenu: `${campus} Cafe`, sMenu: "Croffle", payment: 120, stock: 0, minStock: 5 },
    ];
  }
  return [
    { id: 201, campus: "PUSAN MART", mMenu: "Pusan Mart(Ramen)", sMenu: "Shin Ramyun", payment: 100, stock: 30, minStock: 5 },
    { id: 202, campus: "PUSAN MART", mMenu: "Pusan Mart(Drink)", sMenu: "Coke", payment: 70, stock: 42, minStock: 5 },
    { id: 203, campus: "PUSAN MART", mMenu: "Pusan Mart(Cookie)", sMenu: "Choco Pie", payment: 45, stock: 80, minStock: 5 },
    { id: 204, campus: "PUSAN MART", mMenu: "Pusan Mart(Water)", sMenu: "Water 500ml", payment: 30, stock: 100, minStock: 5 },
  ];
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function money(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`;
}

function initial(value) {
  return escapeHtml(String(value || "P").trim().slice(0, 1).toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char] || char);
}
