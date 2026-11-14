import {
  createCharge,
  createCheckout,
  createPusanmartPayment,
  findPersonByUid,
  listProducts,
  login,
} from "./repository.mjs";
import {
  mockCreateCharge,
  mockCreateCheckout,
  mockCreatePusanmartPayment,
  mockFindPersonByUid,
  mockListProducts,
  mockLogin,
} from "./mockRepository.mjs";
import * as supabaseRepo from "./supabaseRepository.mjs";
import {
  accessFor,
  assertCanCharge,
  assertCanEditPeople,
  assertCanManageStore,
  assertCanPusanPay,
  assertCanSell,
  assertCanUseOffice,
  activityLogScope,
  issueToken,
  peekSession,
  verifyRequest,
} from "./access.mjs";
import { listActivity, recordActivity, shouldLog } from "./activityLog.mjs";
import * as mysqlBackoffice from "./backoffice.mjs";
import * as supabaseBackoffice from "./backofficeSupabase.mjs";
import { httpError } from "./repository.mjs";
import { checkoutCategory, filterProductsForStore } from "./stores.mjs";
import * as office from "./office.mjs";
import { adminPurchases, purchaseCampuses, studentPurchases } from "./purchases.mjs";

const corsOrigin = process.env.CORS_ORIGIN || "*";
const useMockDb = process.env.USE_MOCK_DB === "true";
// DB_BACKEND=supabase (default) | mysql (legacy server, kept as a fallback during cutover).
const dbBackend = useMockDb ? "mock" : (process.env.DB_BACKEND || "supabase").toLowerCase();
if (!["mock", "supabase", "mysql"].includes(dbBackend)) throw new Error(`Unknown DB_BACKEND: ${dbBackend}`);
// Back-office screens (register/modify/history/report/buyers/pay list/office) follow the same switch.
const backoffice = dbBackend === "supabase" ? supabaseBackoffice : mysqlBackoffice;

const repo = useMockDb
  ? {
      createCharge: mockCreateCharge,
      createCheckout: mockCreateCheckout,
      createPusanmartPayment: mockCreatePusanmartPayment,
      findPersonByUid: mockFindPersonByUid,
      listProducts: mockListProducts,
      login: mockLogin,
    }
  : dbBackend === "supabase"
  ? {
      createCharge: supabaseRepo.createCharge,
      createCheckout: supabaseRepo.createCheckout,
      createPusanmartPayment: supabaseRepo.createPusanmartPayment,
      findPersonByUid: supabaseRepo.findPersonByUid,
      listProducts: supabaseRepo.listProducts,
      login: supabaseRepo.login,
    }
  : {
      createCharge,
      createCheckout,
      createPusanmartPayment,
      findPersonByUid,
      listProducts,
      login,
    };

const routes = [
  ["GET", /^\/api\/health$/, async () => ({ ok: true, service: "pusan-mart-api", mode: useMockDb ? "mock" : "live", db: dbBackend })],
  ["POST", /^\/api\/auth\/login$/, async ({ body }) => {
    const manager = await repo.login(body);
    if (!manager) return { manager: null };
    const access = accessFor(manager);
    if (!access) throw httpError(403, "This account cannot use the POS.");
    return { manager, access, token: issueToken(manager) };
  }],
  // Student purchase history: no staff login, the NFC card UID is the key (POST so it stays out of URLs).
  ["POST", /^\/api\/student\/purchases$/, async ({ body }) => {
    supabaseOnly();
    return studentPurchases(body || {});
  }],
  // Everything below needs a login token; sales/charges are checked against the account's access.
  // Store purchase history (receipts + items): Admin = every campus, campus Admin/Manager = own campus only.
  ["GET", /^\/api\/purchases$/, async ({ req, url }) => {
    const { access } = verifyRequest(req);
    supabaseOnly();
    return adminPurchases(query(url, "from", "to", "campus", "store", "search"), purchaseCampuses(access));
  }],
  ["GET", /^\/api\/products$/, async ({ req, url }) => {
    const { access } = verifyRequest(req);
    const campus = url.searchParams.get("campus");
    const store = url.searchParams.get("store");
    if (store) {
      if (store !== "cafe" && store !== "mart") throw httpError(400, "Store must be 'cafe' or 'mart'.");
      if (!campus) throw httpError(400, "Campus is required with store.");
      // A sales screen only gets the products of a store this account may sell at (no other campus).
      assertCanSell(access, store, campus);
    }
    const rows = await repo.listProducts({ campus });
    // ?store=cafe|mart: only this campus, this store + unclassified products (stores.mjs).
    if (!store) return rows;
    return filterProductsForStore(rows, { campus, store });
  }],
  ["GET", /^\/api\/people\/by-nfc\/([^/]+)$/, async ({ req, match }) => {
    verifyRequest(req);
    return { person: await repo.findPersonByUid(decodeURIComponent(match[1])) };
  }],
  ["POST", /^\/api\/checkouts$/, async ({ req, body }) => {
    const { access } = verifyRequest(req);
    assertCanSell(access, body.store || "mart", body.campus);
    return { checkout: await repo.createCheckout(body) };
  }],
  ["POST", /^\/api\/charges$/, async ({ req, body }) => {
    const { session, access } = verifyRequest(req);
    assertCanCharge(access, body.campus);
    // The staff id recorded in bank.`order` comes from the session, not the request body.
    return { charge: await repo.createCharge({ ...body, staffLoginId: session.loginId }) };
  }],
  ["POST", /^\/api\/pusanmart\/payments$/, async ({ req, body }) => {
    const { access } = verifyRequest(req);
    assertCanPusanPay(access);
    return { payment: await repo.createPusanmartPayment(body) };
  }],

  // ----- back-office screens (MySQL or Supabase; the DBSQL mock does not have these tables) -----
  ["GET", /^\/api\/pusanmart\/payments$/, async ({ req, url }) => {
    const { access } = verifyRequest(req);
    assertCanPusanPay(access);
    liveOnly();
    return { payments: await backoffice.listPusanmartPayments(query(url, "from", "to")) };
  }],
  ["GET", /^\/api\/pusanmart\/daily$/, async ({ req, url }) => {
    const { access } = verifyRequest(req);
    assertCanPusanPay(access);
    if (dbBackend !== "supabase") throw httpError(501, "The PusanMart daily summary needs DB_BACKEND=supabase.");
    return supabaseBackoffice.pusanmartDaily(query(url, "from", "to"));
  }],
  ["PUT", /^\/api\/pusanmart\/daily\/(\d{4}-\d{2}-\d{2})$/, async ({ req, match, body }) => {
    const { session, access } = verifyRequest(req);
    assertCanPusanPay(access);
    if (dbBackend !== "supabase") throw httpError(501, "The PusanMart daily summary needs DB_BACKEND=supabase.");
    return { day: await supabaseBackoffice.savePusanmartCost(match[1], body, session.loginId) };
  }],
  ["POST", /^\/api\/products$/, async ({ req, body }) => {
    const { session, access } = verifyRequest(req);
    assertCanManageStore(access, body.campus);
    liveOnly();
    return { product: await backoffice.createProduct(body, session.loginId) };
  }],
  ["PATCH", /^\/api\/products\/(\d+)$/, async ({ req, match, body }) => {
    const { access } = verifyRequest(req);
    liveOnly();
    const current = await backoffice.getProduct(match[1]);
    assertCanManageStore(access, current.campus);
    if (body.campus !== undefined) assertCanManageStore(access, body.campus);
    return { product: await backoffice.updateProduct(match[1], body) };
  }],
  ["DELETE", /^\/api\/products\/(\d+)$/, async ({ req, match }) => {
    const { access } = verifyRequest(req);
    liveOnly();
    const current = await backoffice.getProduct(match[1]);
    assertCanManageStore(access, current.campus);
    return await backoffice.deleteProduct(match[1]);
  }],
  ["GET", /^\/api\/sales$/, async ({ req, url }) => {
    const { access } = verifyRequest(req);
    const filter = query(url, "from", "to", "campus", "category");
    storeSalesFilter(access, filter, url);
    liveOnly();
    return { sales: await backoffice.listSales(filter) };
  }],
  ["GET", /^\/api\/reports\/sales$/, async ({ req, url }) => {
    const { access } = verifyRequest(req);
    const filter = query(url, "from", "to", "campus", "category", "productCampus");
    storeSalesFilter(access, filter, url);
    liveOnly();
    return { report: await backoffice.salesReport(filter) };
  }],
  ["GET", /^\/api\/people$/, async ({ req, url }) => {
    verifyRequest(req);
    liveOnly();
    return { people: await backoffice.searchPeople(query(url, "search")) };
  }],
  ["PATCH", /^\/api\/people\/(\d+)$/, async ({ req, match, body }) => {
    const { access } = verifyRequest(req);
    assertCanEditPeople(access);
    liveOnly();
    return { person: await backoffice.updatePerson(match[1], body) };
  }],
  ["GET", /^\/api\/admin\/activity-log$/, async ({ req, url }) => {
    const { session } = verifyRequest(req);
    activityLogScope(session);
    if (dbBackend !== "supabase") throw httpError(501, "The activity log needs DB_BACKEND=supabase.");
    return listActivity(activityFilter(url));
  }],
  ["GET", /^\/api\/office\/menus$/, async ({ req, url }) => {
    const { access } = verifyRequest(req);
    assertCanUseOffice(access);
    liveOnly();
    return { menus: await backoffice.listOfficeMenus(query(url, "campus")) };
  }],
  ["POST", /^\/api\/office\/transactions$/, async ({ req, body }) => {
    const { session, access } = verifyRequest(req);
    assertCanUseOffice(access);
    liveOnly();
    // bank.`order` = staff login_id, taken from the session like charges.
    return { transaction: await backoffice.createOfficeTransaction(body, session.loginId) };
  }],

  // ----- SMEAG OFFICE tabs (office.mjs, Supabase only) -----
  officeRoute("GET", /^\/api\/office\/people$/, ({ url }) =>
    office.searchPeople(query(url, "uid", "uidLike", "name", "campus", "age", "startFrom", "endTo", "regDate", "endBefore"))),
  officeRoute("POST", /^\/api\/office\/people$/, ({ body }) => office.registerPeople(Array.isArray(body.people) ? body.people : [body])),
  officeRoute("GET", /^\/api\/office\/people\/for-default$/, ({ url }) => office.findPersonForDefault(url.searchParams.get("uid"))),
  officeRoute("PATCH", /^\/api\/office\/people\/(\d+)$/, ({ match, body }) => office.updatePerson(match[1], body)),
  officeRoute("POST", /^\/api\/office\/people\/(\d+)\/default$/, ({ match }) => office.defaultCard(match[1])),
  officeRoute("POST", /^\/api\/office\/photos$/, ({ body }) => office.uploadPhoto(body)),
  officeRoute("POST", /^\/api\/office\/graduates\/backup$/, ({ body }) => office.backupGraduates(body.ids)),
  officeRoute("GET", /^\/api\/office\/menu-list$/, ({ url }) => office.listMenus(query(url, "campus"))),
  officeRoute("POST", /^\/api\/office\/menu-list$/, ({ body }) => office.createMenu(body)),
  officeRoute("PATCH", /^\/api\/office\/menu-list\/(\d+)$/, ({ match, body }) => office.updateMenu(match[1], body)),
  officeRoute("DELETE", /^\/api\/office\/menu-list\/(\d+)$/, ({ match }) => office.deleteMenu(match[1])),
  officeRoute("GET", /^\/api\/office\/bank$/, ({ url }) =>
    office.listBank(query(url, "from", "to", "campus", "name", "age", "category", "subcategory"))),
  officeRoute("PATCH", /^\/api\/office\/bank\/(\d+)$/, ({ match, body }) => office.updateBank(match[1], body)),
  officeRoute("DELETE", /^\/api\/office\/bank\/(\d+)$/, ({ match }) => office.deleteBank(match[1])),
  officeRoute("GET", /^\/api\/office\/bank-categories$/, () => office.bankCategories()),
  officeRoute("GET", /^\/api\/office\/recharge-cashout$/, ({ url }) =>
    office.rechargeCashout(query(url, "campus", "from", "to", "rechargeCategory", "cashoutCategory"))),
  officeRoute("GET", /^\/api\/office\/payments$/, ({ url }) => office.paymentInquiry(query(url, "uid", "name", "campus", "from", "to"))),
  officeRoute("GET", /^\/api\/office\/transdata$/, ({ url }) => office.transDataList(query(url, "from", "to"))),
  officeRoute("POST", /^\/api\/office\/transdata$/, ({ body }) => office.transDataMove(body.ids)),
  officeRoute("GET", /^\/api\/office\/report$/, ({ url }) => office.report(query(url, "campus", "from", "to"))),
  officeRoute("PUT", /^\/api\/office\/report$/, ({ body, session }) => office.saveReport(body, session.loginId)),
  officeRoute("GET", /^\/api\/office\/activity-log$/, ({ url, session }) => {
    activityLogScope(session);
    return listActivity(activityFilter(url));
  }),
];

// Office-program route: login + office access, Supabase backend only.
function officeRoute(method, pattern, handler) {
  return [method, pattern, async (ctx) => {
    const { session, access } = verifyRequest(ctx.req);
    assertCanUseOffice(access);
    if (dbBackend !== "supabase") throw httpError(501, "The office program needs DB_BACKEND=supabase.");
    return handler({ ...ctx, session, access });
  }];
}

function activityFilter(url) {
  return { ...query(url, "from", "to", "loginId", "action", "campus"), onlyWrites: url.searchParams.get("writes") === "1" };
}

function supabaseOnly() {
  if (dbBackend !== "supabase") throw httpError(501, "Purchase history needs DB_BACKEND=supabase.");
}

function liveOnly() {
  if (useMockDb) throw httpError(501, "This screen needs the MySQL database (USE_MOCK_DB=false).");
}

// ?store=cafe|mart narrows history/report to that campus store's bank.category.
function storeSalesFilter(access, filter, url) {
  const store = url.searchParams.get("store");
  if (!store) {
    assertCanManageStore(access, filter.campus);
    return;
  }
  if (store !== "cafe" && store !== "mart") throw httpError(400, "Store must be 'cafe' or 'mart'.");
  assertCanSell(access, store, filter.campus);
  if (!filter.category) filter.category = checkoutCategory(store, filter.campus);
}

function query(url, ...names) {
  return Object.fromEntries(names.map((name) => [name, url.searchParams.get(name) || undefined]));
}

// Shared request handler: used by the local Node server (server.mjs) and the Vercel function (pwa/api).
// `pathname` overrides the URL path when a platform rewrite changed req.url.
export async function handleRequest(req, res, pathname) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const startedAt = Date.now();
  // Fixed base: a bad Host header must not throw before the try block.
  const url = new URL(req.url || "/", "http://localhost");
  if (pathname) url.pathname = pathname;
  let body = {};
  let result = null;
  let status = 200;
  let errorMessage = null;
  try {
    const route = routes.find(([method, pattern]) => method === req.method && pattern.test(url.pathname));
    if (!route) throw httpError(404, "Not found");

    const [, pattern, handler] = route;
    const match = url.pathname.match(pattern);
    body = await readJson(req);
    result = await handler({ req, url, match, body });
  } catch (error) {
    status = error.status || 500;
    errorMessage = error.message || "Internal server error";
    if (status >= 500) console.error(error);
  }

  // Staff activity log (activityLog.mjs). Awaited before replying: a serverless function may stop after the response.
  if (shouldLog(req.method, url.pathname)) {
    await recordActivity({
      req, url, method: req.method, pathname: url.pathname, body, result, status,
      error: errorMessage, actor: peekSession(req), startedAt,
    });
  }
  if (errorMessage) sendJson(res, status, { error: errorMessage });
  else sendJson(res, 200, result);
}

async function readJson(req) {
  if (req.method === "GET" || req.method === "HEAD") return {};
  // Some hosts hand over an already-read stream; fall back to a pre-parsed body if there is one.
  if (req.readableEnded) return req.body && typeof req.body === "object" ? req.body : {};
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Invalid JSON body.");
    error.status = 400;
    throw error;
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function setCors(res) {
  res.setHeader("access-control-allow-origin", corsOrigin);
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
}
