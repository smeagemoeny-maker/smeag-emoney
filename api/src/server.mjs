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
import http from "node:http";
import { accessFor, assertCanCharge, assertCanPusanPay, assertCanSell, issueToken, verifyRequest } from "./access.mjs";
import { httpError } from "./repository.mjs";

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
const corsOrigin = process.env.CORS_ORIGIN || "*";
const useMockDb = process.env.USE_MOCK_DB === "true";

const repo = useMockDb
  ? {
      createCharge: mockCreateCharge,
      createCheckout: mockCreateCheckout,
      createPusanmartPayment: mockCreatePusanmartPayment,
      findPersonByUid: mockFindPersonByUid,
      listProducts: mockListProducts,
      login: mockLogin,
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
  ["GET", /^\/api\/health$/, async () => ({ ok: true, service: "pusan-mart-api", mode: useMockDb ? "mock" : "live" })],
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
];

const server = createNodeHttpServer();
server.listen(port, host, () => {
  console.log(`PUSAN MART API listening on http://${host}:${port}`);
});

function createNodeHttpServer() {
  return http.createServer(async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
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
  });
}

async function readJson(req) {
  if (req.method === "GET" || req.method === "HEAD") return {};
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
