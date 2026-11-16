(() => {
  const IS_LOCAL_PAGE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || location.protocol === "file:";
  // Hosted (Vercel): the API is served from the same domain (/api). Local dev: the Node API on :8787.
  const DEFAULT_API_BASE = IS_LOCAL_PAGE ? "http://localhost:8787" : location.origin;
  const savedApi = (v) => (v && (IS_LOCAL_PAGE || !/\/\/(localhost|127\.0\.0\.1)[:/]?/.test(v)) ? v : "");

  function getApiBase() {
    try {
      return savedApi(localStorage.getItem("pusanApiBase")) || DEFAULT_API_BASE;
    } catch {
      return DEFAULT_API_BASE;
    }
  }

  function setApiBase(value) {
    const cleaned = String(value || "").trim().replace(/\/+$/, "");
    try {
      if (cleaned) localStorage.setItem("pusanApiBase", cleaned);
      else localStorage.removeItem("pusanApiBase");
    } catch {
      // storage unavailable: keep default
    }
  }

  async function apiLogin(loginId) {
    return request("/api/auth/login", {
      method: "POST",
      body: { loginId },
    });
  }

  async function apiProducts(campus) {
    return request(`/api/products?campus=${encodeURIComponent(campus)}`);
  }

  async function apiPersonByNfc(uid) {
    return request(`/api/people/by-nfc/${encodeURIComponent(uid)}`);
  }

  async function apiCheckout(input) {
    return request("/api/checkouts", { method: "POST", body: input });
  }

  async function apiCharge(input) {
    return request("/api/charges", { method: "POST", body: input });
  }

  async function apiPusanPayment(input) {
    return request("/api/pusanmart/payments", { method: "POST", body: input });
  }

  // Session token from /api/auth/login, kept in memory only (logging in again after reload).
  let authToken = null;
  let onUnauthorized = () => undefined;

  function setAuthToken(token) {
    authToken = token || null;
  }

  function setUnauthorizedHandler(handler) {
    onUnauthorized = handler;
  }

  async function request(path, options = {}) {
    let response;
    const headers = {};
    if (options.body) headers["content-type"] = "application/json";
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    try {
      response = await fetch(`${getApiBase()}${path}`, {
        method: options.method || "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch {
      throw new Error(`Cannot reach the API server (${getApiBase()}). Check that the server is running and the API URL in Settings.`);
    }
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 && authToken) onUnauthorized(payload.error);
    if (!response.ok) {
      throw new Error(payload.error || `Request failed: ${response.status}`);
    }
    return payload;
  }

  window.PusanApi = {
    getApiBase,
    setApiBase,
    setAuthToken,
    setUnauthorizedHandler,
    apiCharge,
    apiCheckout,
    apiLogin,
    apiPersonByNfc,
    apiProducts,
    apiPusanPayment,
  };
})();
