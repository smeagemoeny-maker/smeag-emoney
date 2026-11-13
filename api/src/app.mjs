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
  issueToken,
  verifyRequest,
} from "./access.mjs";
import * as mysqlBackoffice from "./backoffice.mjs";
import * as supabaseBackoffice from "./backofficeSupabase.mjs";
import { httpError } from "./repository.mjs";

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
  // Everything below needs a login token; sales/charges are checked against the account's access.
  ["GET", /^\/api\/products$/, async ({ req, url }) => {
    verifyRequest(req);
    return repo.listProducts({ campus: url.searchParams.get("campus") });
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
    assertCanManageStore(access, filter.campus);
    liveOnly();
    return { sales: await backoffice.listSales(filter) };
  }],
  ["GET", /^\/api\/reports\/sales$/, async ({ req, url }) => {
    const { access } = verifyRequest(req);
    const filter = query(url, "from", "to", "campus", "category", "productCampus");
    assertCanManageStore(access, filter.campus);
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
];

function liveOnly() {
  if (useMockDb) throw httpError(501, "This screen needs the MySQL database (USE_MOCK_DB=false).");
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

  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (pathname) url.pathname = pathname;
    const route = routes.find(([method, pattern]) => method === req.method && pattern.test(url.pathname));
    if (!route) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const [, pattern, handler] = route;
    const match = url.pathname.match(pattern);
    const body = await readJson(req);
    const result = await handler({ req, url, match, body });
    sendJson(res, 200, result);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    sendJson(res, status, { error: error.message || "Internal server error" });
  }
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
  res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
}
