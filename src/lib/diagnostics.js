const DIAGNOSTIC_ENDPOINT = "/functions/v1/diagnostic-ingest";
const SLOW_REQUEST_MS = 10000;
const MAX_QUEUE = 60;
const FLUSH_BATCH = 15;
const FLUSH_INTERVAL_MS = 15000;

let initialized = false;
let queue = [];
let flushInProgress = false;
let flushTimer = null;
let diagnosticClient = null;
let originalFetch = null;

const makeId = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
};

const diagnosticId = makeId();

function getSessionId() {
  try {
    const key = "flexar_diag_session";
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = makeId();
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return "session-unavailable";
  }
}

function safePath(value) {
  if (!value) return "";
  try {
    const parsed = new URL(String(value), window.location.origin);
    return parsed.origin === window.location.origin
      ? parsed.pathname.slice(0, 300)
      : parsed.origin + parsed.pathname.slice(0, 200);
  } catch {
    return String(value).split("?")[0].split("#")[0].slice(0, 300);
  }
}

function safeMessage(value) {
  return String(value || "Unknown error")
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => safePath(url))
    .replace(/(token|password|authorization|apikey|api_key|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 1200);
}

function browserFamily() {
  const ua = navigator.userAgent || "";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  return "Other";
}

function record(event) {
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push({
    timestamp: new Date().toISOString(),
    diagnosticId,
    sessionId: getSessionId(),
    level: event.level || "error",
    source: event.source || "client",
    eventName: String(event.eventName || "unknown_event").slice(0, 100),
    message: safeMessage(event.message),
    stack: event.stack ? safeMessage(event.stack).slice(0, 5000) : "",
    pagePath: safePath(window.location.pathname),
    requestPath: event.requestPath ? safePath(event.requestPath) : "",
    httpStatus: Number.isInteger(event.httpStatus) ? event.httpStatus : null,
    durationMs: Number.isFinite(event.durationMs) ? Math.max(0, Math.round(event.durationMs)) : null,
    browserFamily: browserFamily(),
    metadata: event.metadata && typeof event.metadata === "object" ? event.metadata : {},
  });
  if (queue.length >= 5) void flushDiagnostics();
}

async function flushDiagnostics() {
  if (flushInProgress || queue.length === 0 || !diagnosticClient) return;
  flushInProgress = true;
  const batch = queue.splice(0, FLUSH_BATCH);
  try {
    const { error } = await diagnosticClient.functions.invoke("diagnostic-ingest", {
      body: { events: batch },
    });
    if (error) {
      // Re-queue only a bounded number; don't log the logging failure back into itself.
      queue = [...batch, ...queue].slice(-MAX_QUEUE);
    }
  } catch {
    queue = [...batch, ...queue].slice(-MAX_QUEUE);
  } finally {
    flushInProgress = false;
  }
}

function isDiagnosticRequest(url) {
  return String(url || "").includes(DIAGNOSTIC_ENDPOINT);
}

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input && typeof input.url === "string") return input.url;
  return "";
}

export function setDiagnosticClient(client) { diagnosticClient = client || null; }

export async function diagnosticFetch(input, init = {}) {
  const baseFetch = originalFetch || (typeof window !== "undefined" ? window.fetch.bind(window) : fetch);
  const url = requestUrl(input);
  if (!initialized || isDiagnosticRequest(url)) return baseFetch(input, init);
  const started = performance.now();
  const method = String(init.method || input?.method || "GET").toUpperCase();
  try {
    const response = await baseFetch(input, init);
    const durationMs = performance.now() - started;
    if (response.status >= 400) record({ level: response.status >= 500 ? "error" : "warning", source: "network", eventName: "http_request_failed", message: "Request returned HTTP " + response.status, requestPath: url, httpStatus: response.status, durationMs, metadata: { method } });
    else if (durationMs >= SLOW_REQUEST_MS) record({ level: "warning", source: "performance", eventName: "slow_http_request", message: "Request took longer than 10 seconds", requestPath: url, httpStatus: response.status, durationMs, metadata: { method } });
    return response;
  } catch (error) {
    record({ level: "error", source: "network", eventName: "http_request_exception", message: error?.message || "Network request failed", stack: error?.stack || "", requestPath: url, durationMs: performance.now() - started, metadata: { method } });
    throw error;
  }
}

export function initializeDiagnostics() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  record({
    level: "info",
    source: "lifecycle",
    eventName: "app_started",
    message: "FLEXAR page runtime started",
    metadata: {
      online: navigator.onLine,
      language: navigator.language || "unknown",
      viewport: { width: window.innerWidth, height: window.innerHeight },
    },
  });

  window.addEventListener("error", (event) => {
    const target = event.target;
    if (target && target !== window) {
      const resource = target.src || target.href || "";
      record({
        level: "error",
        source: "resource",
        eventName: "resource_load_failed",
        message: "A page resource failed to load",
        requestPath: resource,
        metadata: { element: target.tagName || "unknown" },
      });
      return;
    }
    record({
      level: "error",
      source: "javascript",
      eventName: "uncaught_error",
      message: event.message || "Uncaught JavaScript error",
      stack: event.error?.stack || "",
      metadata: { line: event.lineno || null, column: event.colno || null, file: safePath(event.filename) },
    });
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    record({
      level: "error",
      source: "javascript",
      eventName: "unhandled_promise_rejection",
      message: reason?.message || reason || "Unhandled promise rejection",
      stack: reason?.stack || "",
    });
  });

  window.addEventListener("online", () => record({
    level: "info", source: "network", eventName: "network_online", message: "Browser network connection restored",
  }));
  window.addEventListener("offline", () => record({
    level: "warning", source: "network", eventName: "network_offline", message: "Browser reports no network connection",
  }));

  flushTimer = window.setInterval(() => void flushDiagnostics(), FLUSH_INTERVAL_MS);
  window.addEventListener("pagehide", () => void flushDiagnostics());
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushDiagnostics();
  });

  // Capture initial page-load timing without collecting URL query strings or user content.
  window.addEventListener("load", () => {
    // Navigation timing values can still be zero while the load handler runs.
    // Read them on the next task so loadEventEnd has been populated.
    window.setTimeout(() => {
      const navEntry = performance.getEntriesByType("navigation")[0];
      if (navEntry) {
        const durationMs = Math.max(0, Math.round(navEntry.loadEventEnd - navEntry.startTime));
        record({
          level: durationMs > 12000 ? "warning" : "info",
          source: "performance",
          eventName: "page_load_timing",
          message: "Page load timing captured",
          durationMs,
          metadata: {
            domContentLoadedMs: Math.round(navEntry.domContentLoadedEventEnd - navEntry.startTime),
            responseMs: Math.round(navEntry.responseEnd - navEntry.requestStart),
          },
        });
      }
      void flushDiagnostics();
    }, 0);
  }, { once: true });
}

export function reportDiagnosticError(error, context = "application") {
  record({
    level: "error",
    source: context,
    eventName: "reported_error",
    message: error?.message || error || "Application reported an error",
    stack: error?.stack || "",
  });
}

export function getDiagnosticId() {
  return diagnosticId;
}
