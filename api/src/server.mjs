import http from "node:http";
import { handleRequest } from "./app.mjs";

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";

http.createServer((req, res) => handleRequest(req, res)).listen(port, host, () => {
  console.log(`PUSAN MART API listening on http://${host}:${port}`);
});
