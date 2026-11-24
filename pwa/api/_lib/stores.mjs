// Which store (cafe / mart) a product and a sale belong to, per campus.
//
// store_menus has no store column: m_menu holds "Capital Cafe", "Tarlac Store", "ENCANTO MART",
// "Pusan Mart(Drink)", but also bare names like "WATER" or "ENCANTO MINI CAKES".
//   - m_menu mentions CAFE / AMERICANO  -> cafe
//   - m_menu mentions MART / STORE      -> mart
//   - anything else (unclassified)      -> shown in BOTH the cafe and the mart of its campus
//   - mart cakes and drinks (isCafeItem) -> also shown in the cafe
// Campuses are never mixed: a product only shows for its own campus.
// If a store column is added later, set it on the product (`store: "cafe" | "mart"`) and it wins.

export const PUSAN_MART = "Pusan Mart";                  // the Pusan Mart in the Capital campus (store_menus Campus 'PUSAN MART')
export const PUSAN_MART_ENCANTO = "Pusan Mart Encanto";  // second Pusan Mart, Encanto campus, opened 2026-11-25
                                                         // (store_menus Campus 'PUSAN MART ENCANTO': own products, stock and sales)
export const PUSAN_MARTS = [PUSAN_MART, PUSAN_MART_ENCANTO];
export const isPusanMart = (campus) => PUSAN_MARTS.some((c) => c.toUpperCase() === String(campus ?? "").trim().toUpperCase());
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

// Cakes and drinks are registered under the mart menus ("Capital Mart: Cake Tiramisu", "ENCANTO MART: COLA",
// "Tarlac Store: Pocari Sweat"), but the cafe sells them too. They stay in the mart and also show in the cafe.
// The NOT_* lists keep out ice cream ("Water Melon", "Milk Melon"), tissue and fish-cake snacks.
const CAKE = /CAKE|MUFFIN|BROWNIE|BOWNIE/;
const NOT_CAKE = /FISH CAKE|CAKE BAR/;
const DRINK = /\bCOKE\b|\bCOLA\b|PEPSI|SPRITE|MOUNT DEW|POCARI|GATORADE|\bC2\b|JUICE|SODA|LEMONADE|YAKULT|DUTCH MILK|MILK SEOUL|SAMDASOO|\bWATER\b|\bTEA\b/;
const NOT_DRINK = /MELON|TISSUE/;

export function isCafeItem(product) {
  const name = upper(product?.sMenu);
  return (CAKE.test(name) && !NOT_CAKE.test(name)) || (DRINK.test(name) && !NOT_DRINK.test(name));
}

// Campuses whose cafe counter also sells the whole mart (the old SMEAG Mobile Mart terminal sold
// Capital Cafe and Capital Mart items together; Encanto and Tarlac too): their cafe shows every mart product, ice cream included.
const CAFE_SELLS_WHOLE_MART = new Set(["CAPITAL", "ENCANTO", "TARLAC"]);

export function filterProductsForStore(products, { campus, store }) {
  const wholeMart = store === "cafe" && CAFE_SELLS_WHOLE_MART.has(upper(campus));
  return products.filter((p) => {
    if (!productCampusMatches(p, campus)) return false;
    const own = productStore(p);
    if (own === null || own === store) return true;
    return store === "cafe" && (wholeMart || isCafeItem(p));
  });
}
