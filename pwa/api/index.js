// Vercel serverless entry for the PUSAN MART API (same code as ../../api/src, copied into api/_lib
// by scripts/sync-api.mjs before each deploy). vercel.json rewrites /api/<path> -> /api?__path=<path>.
import { handleRequest } from "./_lib/app.mjs";

export default async function handler(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  const rewritten = url.searchParams.get("__path");
  // Prefer the original path if the platform kept it in req.url; else rebuild it from the rewrite param.
  const pathname = url.pathname.startsWith("/api/") ? url.pathname : rewritten != null ? `/api/${rewritten}` : "/api";
  return handleRequest(req, res, pathname);
}
