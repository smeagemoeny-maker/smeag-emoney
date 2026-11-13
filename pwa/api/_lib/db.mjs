import "./env.mjs";

let pool;

export async function getPool() {
  if (pool) return pool;

  const mysql = await import("mysql2/promise");
  pool = mysql.createPool({
    host: requiredEnv("DB_HOST"),
    port: Number(process.env.DB_PORT || 3306),
    user: requiredEnv("DB_USER"),
    password: requiredEnv("DB_PASSWORD"),
    database: requiredEnv("DB_NAME"),
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
    decimalNumbers: false,
  });

  return pool;
}

export function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Card UIDs are stored like the old Android app wrote them: lowercase hex, no separators.
// Web NFC reports "04:D0:98:..." so strip separators and lowercase.
export function normalizeUid(uid) {
  return String(uid || "").trim().replace(/[\s:-]/g, "").toLowerCase();
}
