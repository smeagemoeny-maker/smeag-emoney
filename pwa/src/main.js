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
    title: "카페 판매",
    campuses: ["Capital", "Encanto", "Tarlac"],
    defaultCampus: "Capital",
  },
  mart: {
    key: "mart",
    navLabel: "PUSAN Mart",
    eyebrow: "PUSAN MART",
    title: "마트 판매",
    campuses: ["Pusan Mart"],
    defaultCampus: "Pusan Mart",
  },
};

const NAV_LABELS = {
  cafe: STORES.cafe.navLabel,
  mart: STORES.mart.navLabel,
  buyer: "구매자",
  "pusan-pay": "부산페이",
  settings: "설정",
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
  { label: "No Discount", text: "할인 없음", rate: 0 },
  { label: "Teacher 10%", text: "Teacher 10%", rate: 0.1 },
  { label: "Manager 15%", text: "Manager 15%", rate: 0.15 },
];

const ALL = "전체";
const CHARGE_PRESETS = [100, 500, 1000, 2000];
const READER_FORMAT_TEXT = {
  auto: "자동 (10자리 숫자는 10진수·역순, 그 외 HEX)",
  hex: "HEX 그대로",
  "dec-reversed": "10진수 (바이트 역순)",
  dec: "10진수 (바이트 순서 그대로)",
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
  status: "로그인하거나 데모 화면을 여세요.",
  buyer: null,
  pusanAmount: "",
  manualUid: "",
  busy: false,
};

const app = document.querySelector("#app");
if (!app) throw new Error("Missing app root");

listenForNfc(async ({ uid, source }) => {
  if (state.nfcMode === "idle" || state.busy) return;
  const mode = state.nfcMode;
  state.busy = true;
  state.status = `NFC 수신: ${source} / ${uid}`;
  render();

  try {
    if (mode === "buyer") await handleBuyer(uid);
    else if (mode === "pusan-pay") await handlePusanPay(uid);
    else if (mode === "cafe-charge") await handleCharge(uid);
    else if (STORES[mode]) await handleCheckout(mode, uid);
  } catch (error) {
    state.status = error instanceof Error ? error.message : "NFC 작업에 실패했습니다.";
  } finally {
    state.busy = false;
    state.nfcMode = "idle";
    stopNfcScan();
    render();
  }
});

// USB/Bluetooth readers (keyboard mode) are only listened to while a tap is expected.
enableKeyboardReader(() => state.nfcMode !== "idle" && !state.busy);

window.addEventListener("nfc-error", (event) => {
  if (state.nfcMode === "idle") return;
  state.status = event.detail?.message || "카드를 읽지 못했습니다.";
  render();
});

setUnauthorizedHandler((message) => {
  logout(message || "로그인이 만료되었습니다. 다시 로그인하세요.");
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
    state.status = "상품을 불러오는 중입니다...";
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
    if (!quiet) state.status = `${STORES[storeKey].navLabel} · ${store.campus}: 상품 ${store.products.length}개`;
  } catch (error) {
    if (store.requestId !== requestId) return;
    state.status = `상품 조회 실패: ${error instanceof Error ? error.message : error}`;
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
  if (!store.cart.length) throw new Error("장바구니가 비어 있습니다.");
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
  state.status = `결제 완료: ${checkout.buyerName || uid} · ${money(checkout.finalTotal)} · 잔액 ${money(checkout.remainingBalance)}`;
  // Refresh stock without replacing the payment result message.
  if (!state.demoMode) await loadProducts(storeKey, { quiet: true });
}

async function handleBuyer(uid) {
  if (state.demoMode) {
    state.buyer = { name: "Demo Buyer", uid, campus: "Pusan Mart", totalMoney: 1000 };
    state.status = "데모 구매자 정보입니다.";
    return;
  }
  const result = await apiPersonByNfc(uid);
  state.buyer = result.person;
  state.status = result.person ? "구매자 정보를 불러왔습니다." : `등록되지 않은 카드입니다. (${uid})`;
}

async function handlePusanPay(uid) {
  const totalAmount = Number(state.pusanAmount);
  if (!(totalAmount > 0)) throw new Error("먼저 유효한 금액을 입력하세요.");
  if (state.demoMode) {
    state.status = `부산페이 저장(데모): ${uid} / ${money(totalAmount)}`;
  } else {
    const result = await apiPusanPayment({ uid, totalAmount });
    state.status = `부산페이 저장 완료: ${result.payment.name || uid} / ${money(result.payment.allPayments)}`;
  }
  state.pusanAmount = "";
}

async function handleCharge(uid) {
  const store = state.stores.cafe;
  const amount = Number(store.chargeAmount);
  if (!(amount > 0)) throw new Error("먼저 충전 금액을 입력하세요.");
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
  state.status = `충전 완료: ${charge.buyerName || uid} · +${money(charge.amount)} · 잔액 ${money(charge.totalMoney)}`;
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
      <h1>POS 로그인</h1>
      <label>매니저 ID<input name="loginId" autocomplete="username" required /></label>
      <button class="primary" type="submit" ${state.busy ? "disabled" : ""}>로그인</button>
      <button class="secondary wide" type="button" data-demo-login>데모 화면 보기</button>
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
        ${campusesFor(storeKey).length > 1 ? selectField("캠퍼스", "campus", campusesFor(storeKey), store.campus) : `<span class="campus-fixed">${escapeHtml(store.campus)}</span>`}
        ${selectField("분류", "category", categories, store.category)}
        <label>검색<input data-search placeholder="상품명" value="${escapeHtml(store.search)}" /></label>
      </div>
    </section>
    <section class="grid-layout">
      <section class="products">
        ${!store.loaded ? emptyProducts("상품을 불러오는 중이거나 API에 연결되지 않았습니다.") : visible.length ? visible.map((p) => productCard(storeKey, p)).join("") : emptyProducts("조건에 맞는 상품이 없습니다.")}
      </section>
      <aside class="cart panel" id="cart">
        ${storeKey === "cafe" && state.access?.canCharge ? panelToggle(store) : ""}
        ${storeKey === "cafe" && state.access?.canCharge && store.panel === "charge" ? chargePanel(store) : salePanel(storeKey, store, waiting)}
      </aside>
    </section>
    <div class="cart-bar">
      <span>${itemCount}개 · <strong>${money(cartTotal(store))}</strong></span>
      <button class="primary" data-scroll-cart ${itemCount ? "" : "disabled"}>장바구니 · 결제</button>
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
      <button class="${store.panel === "sale" ? "selected" : ""}" data-panel="sale" ${state.nfcMode !== "idle" ? "disabled" : ""}>결제</button>
      <button class="${store.panel === "charge" ? "selected" : ""}" data-panel="charge" ${state.nfcMode !== "idle" ? "disabled" : ""}>이머니 충전</button>
    </div>
  `;
}

function chargePanel(store) {
  const waiting = state.nfcMode === "cafe-charge";
  return `
    <h2>이머니 충전 · ${escapeHtml(store.campus)}</h2>
    <label>충전 금액<input data-charge-amount inputmode="decimal" placeholder="0.00" value="${escapeHtml(store.chargeAmount)}" ${waiting ? "disabled" : ""} /></label>
    <div class="discounts">
      ${CHARGE_PRESETS.map((v) => `<button data-charge-preset="${v}" ${waiting ? "disabled" : ""}>+${v}</button>`).join("")}
    </div>
    <div class="total"><span>충전액</span><strong>${money(store.chargeAmount)}</strong></div>
    ${waiting
      ? `<button class="secondary wide" data-cancel-nfc>NFC 대기 취소</button>`
      : `<button class="primary" data-nfc="cafe-charge" ${Number(store.chargeAmount) > 0 && !state.busy ? "" : "disabled"}>카드 태그로 충전</button>`}
    ${nfcHint()}
    ${manualNfcPanel("cafe-charge", !(Number(store.chargeAmount) > 0))}
    ${store.lastCharge ? chargeCard(store.lastCharge) : ""}
  `;
}

function chargeCard(c) {
  return `
    <article class="receipt">
      <h3>최근 충전</h3>
      <p>${escapeHtml(c.buyerName || c.uid)} · ${escapeHtml(c.campus)} · ${c.at.toLocaleString()}</p>
      <p>충전 <strong>+${money(c.amount)}</strong> · ${money(c.beforeAmount)} → <strong>${money(c.totalMoney)}</strong></p>
    </article>
  `;
}

function salePanel(storeKey, store, waiting) {
  return `
        <h2>장바구니 · ${escapeHtml(store.campus)}</h2>
        ${store.cart.length ? store.cart.map(cartRow).join("") : `<p class="muted">상품을 선택하세요.</p>`}
        <div class="discounts">
          ${DISCOUNTS.map((d) => `<button class="${store.discountLabel === d.label ? "selected" : ""}" data-discount="${d.rate}" data-label="${d.label}">${d.text}</button>`).join("")}
        </div>
        <div class="total"><span>합계</span><strong>${money(cartTotal(store))}</strong></div>
        ${waiting
          ? `<button class="secondary wide" data-cancel-nfc>NFC 대기 취소</button>`
          : `<button class="primary" data-nfc="${storeKey}" ${store.cart.length && !state.busy ? "" : "disabled"}>${storeKey === "mart" ? "폰 NFC로 이머니 결제" : "카드 태그로 결제"}</button>`}
        ${nfcHint()}
        ${manualNfcPanel(storeKey, !store.cart.length)}
        ${store.lastReceipt ? receiptCard(store.lastReceipt) : ""}
  `;
}

// Which tap inputs this device offers: phone NFC (native bridge / Web NFC) and keyboard readers.
function nfcHint() {
  const phone = {
    "android-native": "폰 NFC 사용 가능 (앱)",
    "web-nfc": "폰 NFC 사용 가능 (Chrome)",
    "web-nfc-insecure": "폰 NFC: HTTPS 주소에서만 동작",
    none: "폰 NFC 미지원 브라우저",
  }[phoneNfcSupport()];
  return `<p class="muted nfc-hint">${escapeHtml(phone)} · USB/블루투스 리더기 사용 가능</p>`;
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
    <button class="product ${soldOut ? "soldout" : ""}" data-product="${product.id}" ${soldOut ? "disabled" : ""}>
      <span class="product-img">${initial(product.sMenu)}${inCart ? `<span class="badge">${inCart}</span>` : ""}</span>
      <strong>${escapeHtml(product.sMenu || "-")}</strong>
      <small>${escapeHtml(product.mMenu || "-")}</small>
      <span class="product-meta">${money(product.payment)} · ${soldOut ? "품절" : `재고 ${product.stock}${low ? " (부족)" : ""}`}</span>
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
      <h3>최근 결제</h3>
      <p>${escapeHtml(r.buyerName || r.uid)} · ${escapeHtml(r.campus)} · ${r.at.toLocaleString()}</p>
      ${r.items.map((i) => `<p>${escapeHtml(i.name)} × ${i.quantity}</p>`).join("")}
      <p>${escapeHtml(r.discountLabel)} · 결제 <strong>${money(r.finalTotal)}</strong> · 잔액 ${money(r.remainingBalance)}</p>
    </article>
  `;
}

function buyerView() {
  return `
    <section class="panel">
      <p class="eyebrow">BUYER INFO</p>
      <h1>구매자 조회</h1>
      ${state.nfcMode === "buyer" ? `<button class="secondary wide" data-cancel-nfc>NFC 대기 취소</button>` : `<button class="primary" data-nfc="buyer">NFC 태그로 조회</button>`}
      ${manualNfcPanel("buyer")}
      ${state.buyer ? buyerCard(state.buyer) : `<p class="muted">아직 조회된 구매자가 없습니다.</p>`}
    </section>
  `;
}

function buyerCard(person) {
  return `
    <article class="buyer-card">
      <h2>${escapeHtml(person.name || "-")}</h2>
      <p>UID ${escapeHtml(person.uid)}</p>
      ${person.studentId ? `<p>학번 ${escapeHtml(person.studentId)}</p>` : ""}
      <p>캠퍼스 ${escapeHtml(person.campus || "-")}</p>
      ${person.endDate ? `<p>기간 ${escapeHtml(person.startDate || "-")} ~ ${escapeHtml(person.endDate)}</p>` : ""}
      <p>잔액 <strong>${money(person.totalMoney)}</strong></p>
    </article>
  `;
}

function pusanPayView() {
  return `
    <form class="panel" data-form="pusan-pay">
      <p class="eyebrow">PUSAN PAY</p>
      <h1>부산페이 결제 기록</h1>
      <label>총 결제 금액<input name="amount" inputmode="decimal" value="${escapeHtml(state.pusanAmount)}" placeholder="0.00" required /></label>
      ${state.nfcMode === "pusan-pay" ? `<button class="secondary wide" type="button" data-cancel-nfc>NFC 대기 취소</button>` : `<button class="primary" data-nfc="pusan-pay" type="button">NFC 태그로 저장</button>`}
      ${manualNfcPanel("pusan-pay")}
    </form>
  `;
}

function settingsView() {
  return `
    <section class="panel">
      <p class="eyebrow">SETTINGS</p>
      <h1>연결 설정</h1>
      <p class="muted">로그인: ${escapeHtml(state.manager?.name || state.manager?.login_id || "-")} (${escapeHtml(state.manager?.position || "-")} · ${escapeHtml(state.manager?.campus || "-")})${state.demoMode ? " · 데모 모드" : ""}</p>
      <p class="muted">사용 가능: ${escapeHtml(accessSummary())}</p>
      <label>API Base URL<input data-setting="api-base" value="${escapeHtml(getApiBase())}" /></label>
      <button class="secondary wide" data-save-api>API URL 저장</button>
      <h2>NFC 리더기</h2>
      <p class="muted">USB/블루투스 리더기는 키보드 모드로 연결하세요. 카드 UID가 기존 앱과 다르게 읽히면 형식을 바꾸고 구매자 조회 화면에서 확인하세요.</p>
      <label>리더기 UID 형식
        <select data-reader-format>
          ${READER_FORMATS.map((f) => `<option value="${f}" ${getReaderFormat() === f ? "selected" : ""}>${escapeHtml(READER_FORMAT_TEXT[f])}</option>`).join("")}
        </select>
      </label>
      <label>변환 미리보기<input data-reader-preview placeholder="리더기 출력값 (예: 2864434397)" /></label>
      <p class="muted" data-reader-preview-out>&nbsp;</p>
      <button class="secondary wide" data-logout>로그아웃</button>
    </section>
  `;
}

function manualNfcPanel(mode, disabled = false) {
  return `
    <div class="manual-nfc">
      <input data-manual placeholder="테스트 UID 직접 입력" value="${escapeHtml(state.manualUid)}" />
      <button class="secondary" type="button" data-manual-send="${mode}" ${disabled || state.busy ? "disabled" : ""}>UID 전송</button>
    </div>
  `;
}

function emptyProducts(message) {
  return `
    <div class="empty-products">
      <p class="muted">${escapeHtml(message)}</p>
      <button class="secondary wide" data-load-products>상품 다시 불러오기</button>
    </div>
  `;
}

function statusBar() {
  const message = state.busy
    ? "처리 중..."
    : state.nfcMode !== "idle"
      ? `${state.nfcMode === "cafe-charge" ? "충전할" : ""} 카드를 폰 뒷면이나 리더기에 대주세요...`.trim()
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
    state.status = "로그인 중...";
    render();
    try {
      const result = await apiLogin(String(form.get("loginId")).trim());
      if (!result.manager) throw new Error("등록되지 않은 아이디입니다.");
      setAuthToken(result.token);
      state.manager = result.manager;
      state.access = result.access;
      state.demoMode = false;
      resetStores();
      state.status = `${result.manager.name || result.manager.login_id}님 로그인 · ${accessSummary()}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "로그인 실패";
      state.status = /cannot use the POS/.test(message) ? "이 계정은 POS를 사용할 수 없습니다. (Admin 또는 매장 Manager 계정만 가능)" : message;
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
        if (store.cart.length && !confirm("캠퍼스를 바꾸면 장바구니가 비워집니다. 계속할까요?")) {
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
        state.status = `폰 NFC 시작 실패: ${error instanceof Error ? error.message : error} (리더기는 계속 사용 가능)`;
      }
      render();
    };
  });

  app.querySelector("[data-cancel-nfc]")?.addEventListener("click", () => {
    state.nfcMode = "idle";
    stopNfcScan();
    state.status = "NFC 대기를 취소했습니다.";
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
        state.status = "테스트 UID를 입력하세요.";
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
    state.status = `리더기 형식: ${READER_FORMAT_TEXT[getReaderFormat()]}`;
  });

  app.querySelector("[data-reader-preview]")?.addEventListener("input", updateReaderPreview);

  app.querySelector("[data-scroll-cart]")?.addEventListener("click", () => {
    document.getElementById("cart")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  app.querySelector("[data-load-products]")?.addEventListener("click", () => {
    if (STORES[state.route]) loadProducts(state.route);
  });

  app.querySelector("[data-logout]")?.addEventListener("click", () => logout("로그아웃했습니다."));

  app.querySelector("[data-save-api]")?.addEventListener("click", () => {
    const input = app.querySelector("[data-setting='api-base']");
    if (input) setApiBase(input.value);
    state.status = `API URL 저장: ${getApiBase()}`;
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
    state.status = "먼저 유효한 금액을 입력하세요.";
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
  if (access.stores.includes("cafe")) parts.push(`카페(${access.cafeCampuses.join("/")})${access.canCharge ? " 결제·충전" : " 결제"}`);
  if (access.stores.includes("mart")) parts.push("부산마트 결제");
  if (access.canPusanPay) parts.push("부산페이");
  return parts.join(", ");
}

function enterDemo() {
  state.manager = { id: 0, name: "Demo Manager", position: "Admin", campus: "Pusan Mart" };
  state.access = { stores: ["cafe", "mart"], cafeCampuses: [...STORES.cafe.campuses], canCharge: false, canPusanPay: true };
  state.demoMode = true;
  resetStores();
  state.status = "데모 모드입니다. 실제 DB에는 저장되지 않습니다.";
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
  if (qty > Number(product.stock)) {
    state.status = `재고 부족: ${product.sMenu} (재고 ${product.stock})`;
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
