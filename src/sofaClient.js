/**
 * SofaScore upstream client backed by a real Chromium process.
 *
 * WHY a real browser is required
 * ───────────────────────────────
 * SofaScore's CDN (Varnish + WAF) blocks requests based on the TLS fingerprint
 * (JA3/JA4 hash).  curl, Node's built-in fetch, and undici all use OpenSSL with
 * a predictable, easily-detected TLS ClientHello, so they receive a 403
 * regardless of HTTP headers.  A Chromium process uses Chrome's BoringSSL stack
 * with the exact JA3 hash that Varnish whitelists.
 *
 * Performance strategy — persistent browser pool
 * ────────────────────────────────────────────────
 * Launching a new browser per request would be catastrophically slow (~1-2 s).
 * Instead we keep ONE Chromium instance and ONE browser context alive for the
 * lifetime of the server process and route each API call through it using
 * Playwright's `page.evaluate(() => fetch(…))` — which runs the fetch inside
 * Chrome's JS engine with Chrome's TLS stack.
 *
 * Concurrency
 * ───────────
 * Playwright pages are not concurrency-safe for simultaneous navigations, but
 * we never navigate — we only call `page.evaluate`.  Multiple concurrent
 * `evaluate` calls on the same page are serialised by V8 inside Chrome and are
 * perfectly safe.  We use a single persistent page for all requests.
 */

import { chromium } from "playwright-core";

const SOFA_BASE = "https://www.sofascore.com/api/v1";

// The headers that make the XHR look legitimate from inside the SofaScore SPA
const SPOOF_HEADERS = {
  "x-requested-with": "XMLHttpRequest",
  "accept": "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  "referer": "https://www.sofascore.com/",
  "origin": "https://www.sofascore.com",
};

/** @type {import('playwright-core').Browser | null} */
let browser = null;
/** @type {import('playwright-core').Page | null} */
let page = null;

/**
 * Lazily initialise (and cache) the browser + page singleton.
 * Called once at first request; subsequent calls return immediately.
 */
async function getPage() {
  if (page) return page;

  // Use the system-installed Google Chrome for maximum TLS fingerprint fidelity
  const executablePath =
    process.env.CHROME_PATH ??
    "/usr/bin/google-chrome";

  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",   // avoid /dev/shm exhaustion on small systems
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    // Navigate to SofaScore once so the page origin is correct
    baseURL: "https://www.sofascore.com/api/v1/sport/football",
  });

  page = await context.newPage();

  // Open the SofaScore home page so subsequent fetch() calls share its origin
  // and session cookies (if any).  We ignore errors (e.g. JS exceptions on the
  // page) because we only care about the network layer.
  await page.goto("https://www.sofascore.com/api/v1/sport/football", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  }).catch(() => {/* ignore page-level errors */});

  return page;
}

/**
 * Fetch a SofaScore API path using the Chrome browser.
 *
 * @param {string} path   e.g. "/sport/football/events/live"
 * @returns {Promise<{ data: any, status: number }>}
 */
export async function sofaFetch(path) {
  const url = `${SOFA_BASE}${path}`;
  const pg = await getPage();

  // Run the fetch inside Chrome's JS runtime — this uses Chrome's BoringSSL
  // TLS stack, so Varnish sees a genuine Chrome fingerprint.
  return pg.evaluate(
    async ({ url, headers }) => {
      const res = await fetch(url, { method: "GET", headers });
      const contentType = res.headers.get("content-type") ?? "";
      const data = contentType.includes("application/json")
        ? await res.json()
        : await res.text();

      return { data, status: res.status };
    },
    { url, headers: SPOOF_HEADERS }
  );
}

/**
 * Cleanly close the browser.  Call this on process shutdown.
 */
export async function closeBrowser() {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
    page = null;
  }
}
