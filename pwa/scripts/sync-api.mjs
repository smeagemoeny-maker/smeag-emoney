// Copies the Node API source (../api/src) into pwa/api/_lib so the Vercel function can import it.
// Run automatically by `npm run deploy`. Files under api/_lib are not exposed as routes (underscore prefix).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pwaRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.resolve(pwaRoot, "../api/src");
const dest = path.join(pwaRoot, "api/_lib");
// server.mjs only starts the local listener; the mock repository needs the local DBSQL dumps.
const skip = new Set(["server.mjs"]);

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const name of fs.readdirSync(src)) {
  if (!name.endsWith(".mjs") || skip.has(name)) continue;
  fs.copyFileSync(path.join(src, name), path.join(dest, name));
}
console.log(`Synced API source -> ${path.relative(pwaRoot, dest)}`);
