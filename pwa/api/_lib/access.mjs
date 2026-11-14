import crypto from "node:crypto";
import "./env.mjs";
import { httpError } from "./repository.mjs";
import { PUSAN_MART } from "./stores.mjs";

// mgperson.campus enum uses the typo 'Talrac'; store_menus / the PWA use 'Tarlac'.
const CAFE_CAMPUS_BY_ACCOUNT = { CAPITAL: "Capital", ENCANTO: "Encanto", TALRAC: "Tarlac", TARLAC: "Tarlac" };
export const ALL_CAFE_CAMPUSES = ["Capital", "Encanto", "Tarlac"];

// What a manager account may do in the POS.
//   Admin/Manager @ Pusan Mart       -> Pusan Mart sales, buyer lookup, PusanMart pay (no cafe, no charge)
//   Admin/Manager @ Capital/Encanto/Talrac -> ONLY the own campus: cafe AND mart sales, buyer lookup, office program
//                                        (Admin also keeps PusanMart pay)
//   Admin @ a campus that is none of the above -> every campus (incl. the office program)
//   martCampuses = campuses whose mart the account may sell at (each campus has its own mart).
//   E-money is charged ONLY in the office program (OFFICE MENU -> + INCREASE), never at a POS: canCharge is false for all.
//   anything else (Baydream Manager, Security, StoreOrder) -> no POS access
export function accessFor(manager) {
  const position = String(manager?.position || "");
  const campus = String(manager?.campus || "").toUpperCase();

  if ((position === "Admin" || position === "Manager") && campus === "PUSAN MART") {
    return { stores: ["mart"], cafeCampuses: [], martCampuses: [PUSAN_MART], canCharge: false, canPusanPay: true, office: false };
  }
  if ((position === "Admin" || position === "Manager") && CAFE_CAMPUS_BY_ACCOUNT[campus]) {
    const own = CAFE_CAMPUS_BY_ACCOUNT[campus];
    return { stores: ["cafe", "mart"], cafeCampuses: [own], martCampuses: [own], canCharge: false, canPusanPay: position === "Admin", office: true };
  }
  if (position === "Admin") {
    return { stores: ["cafe", "mart"], cafeCampuses: ALL_CAFE_CAMPUSES, martCampuses: [...ALL_CAFE_CAMPUSES, PUSAN_MART], canCharge: false, canPusanPay: true, office: true };
  }
  return null;
}

// ---------- signed session token (HMAC, no extra dependency) ----------

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const secret = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.TOKEN_SECRET) {
  console.warn("TOKEN_SECRET is not set: using a random secret, so logins expire when the API restarts.");
}

function sign(data) {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

export function issueToken(manager) {
  const payload = {
    id: manager.id,
    loginId: manager.login_id,
    position: manager.position,
    campus: manager.campus,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data)}`;
}

export function verifyRequest(req) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const [data, signature] = token.split(".");
  if (!data || !signature) throw httpError(401, "Login required.");
  const expected = sign(data);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw httpError(401, "Invalid login session. Please log in again.");
  }
  const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  if (!(payload.exp > Date.now())) throw httpError(401, "Login session expired. Please log in again.");
  const access = accessFor(payload);
  if (!access) throw httpError(403, "This account cannot use the POS.");
  return { session: payload, access };
}

export function assertCanSell(access, store, campus) {
  if (!access.stores.includes(store)) throw httpError(403, `This account cannot sell at the ${store === "cafe" ? "cafe" : "mart"}.`);
  if (store === "cafe" && !access.cafeCampuses.some((c) => c.toUpperCase() === String(campus || "").toUpperCase())) {
    throw httpError(403, `This account cannot sell at the ${campus} cafe.`);
  }
  if (store === "mart" && !(access.martCampuses || []).some((c) => c.toUpperCase() === String(campus || "").toUpperCase())) {
    throw httpError(403, `This account cannot sell at the ${campus} mart.`);
  }
}

export function assertCanCharge(access, campus) {
  if (!access.canCharge) throw httpError(403, "E-money can only be charged in the SMEAG Office program (OFFICE MENU > + INCREASE).");
  if (!access.cafeCampuses.some((c) => c.toUpperCase() === String(campus || "").toUpperCase())) {
    throw httpError(403, `This account cannot charge at the ${campus} cafe.`);
  }
}

export function assertCanPusanPay(access) {
  if (!access.canPusanPay) throw httpError(403, "This account cannot record PusanMart payments.");
}

// Products/history/report belong to one store: "PUSAN MART" is the mart, every other campus a cafe.
export function storeForCampus(campus) {
  return String(campus || "").toUpperCase() === "PUSAN MART" ? "mart" : "cafe";
}

export function assertCanManageStore(access, campus) {
  assertCanSell(access, storeForCampus(campus), campus);
}

// Editing buyer profiles: office staff (Admin / campus Managers).
export function assertCanEditPeople(access) {
  if (!access.canCharge && !access.office) throw httpError(403, "This account cannot edit buyers.");
}

export function assertCanUseOffice(access) {
  if (!access.office) throw httpError(403, "This account cannot use the office program.");
}
