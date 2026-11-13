// Which store (cafe / mart) a product and a sale belong to, per campus.
//
// store_menus has no store column: m_menu holds "Capital Cafe", "Tarlac Store", "ENCANTO MART",
// "Pusan Mart(Drink)", but also bare names like "WATER" or "ENCANTO MINI CAKES".
//   - m_menu mentions CAFE / AMERICANO  -> cafe
//   - m_menu mentions MART / STORE      -> mart
//   - anything else (unclassified)      -> shown in BOTH the cafe and the mart of its campus
// Campuses are never mixed: a product only shows for its own campus.
// If a store column is added later, set it on the product (`store: "cafe" | "mart"`) and it wins.

export const PUSAN_MART = "Pusan Mart";
export const CAMPUS_STORES = ["Capital", "Encanto", "Tarlac"]; // campuses with both a cafe and a mart

// bank.category written by each campus store terminal today, so reports keep working.
const LEGACY_CATEGORY = {
  cafe: { CAPITAL: "Capital Cafe", ENCANTO: "ENCANTO CAFE", TARLAC: "Tarlac Cafe" },
  mart: { CAPITAL: "Capital Mart", ENCANTO: "ENCANTO MART", TARLAC: "Tarlac Store" },
};

const upper = (value) => String(value ?? "").trim().toUpperCase();

export function checkoutCategory(store, campus) {
  const legacy = LEGACY_CATEGORY[store]?.[upper(campus)];
  if (legacy) return legacy;
  // Pusan Mart and anything else keep the Android format.
  return store === "cafe" ? `${campus} Cafe` : `${campus} Mart`;
}

// m_menu for a product registered from a store screen (so it is classified from the start).
export function storeMenuName(store, campus) {
  return LEGACY_CATEGORY[store]?.[upper(campus)] || campus;
}

export function productStore(product) {
  if (product?.store === "cafe" || product?.store === "mart") return product.store;
  const menu = upper(product?.mMenu);
  if (/CAFE|CAFÉ|AMERICANO/.test(menu)) return "cafe";
  if (/MART|STORE/.test(menu)) return "mart";
  return null;
}

// Rows with Campus 'ALL' belong to the campus their m_menu names ("All | Encanto Mart").
export function productCampusMatches(product, campus) {
  const wanted = upper(campus);
  const rowCampus = upper(product?.campus);
  if (rowCampus === wanted) return true;
  return rowCampus === "ALL" && upper(product?.mMenu).startsWith(wanted);
}

export function filterProductsForStore(products, { campus, store }) {
  return products.filter((p) => {
    if (!productCampusMatches(p, campus)) return false;
    const own = productStore(p);
    return own === null || own === store;
  });
}
