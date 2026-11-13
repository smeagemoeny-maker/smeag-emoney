// Dev only: expose a local PostgREST (default :3000) under /rest/v1 like Supabase does,
// so the API can use SUPABASE_URL=http://127.0.0.1:3001 against load-local-supabase.sh.
import http from "node:http";

const target = new URL(process.env.POSTGREST_URL || "http://127.0.0.1:3000");
const port = Number(process.env.PROXY_PORT || 3001);

http.createServer((req, res) => {
  if (!req.url.startsWith("/rest/v1/")) {
    res.writeHead(404).end();
    return;
  }
  const headers = { ...req.headers, host: target.host };
  delete headers.apikey;
  const upstream = http.request(
    { host: target.hostname, port: target.port, method: req.method, path: req.url.slice("/rest/v1".length), headers },
    (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    },
  );
  upstream.on("error", (e) => res.writeHead(502).end(String(e)));
  req.pipe(upstream);
}).listen(port, "127.0.0.1", () => console.log(`PostgREST ${target.href} -> http://127.0.0.1:${port}/rest/v1`));
