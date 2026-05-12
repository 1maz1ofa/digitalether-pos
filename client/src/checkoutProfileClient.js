/**
 * Client-side timing for POS checkout. Turn on in the browser console:
 *   localStorage.setItem("digitalether_pos_checkout_profile", "1");
 *   location.reload()
 * Turn off:
 *   localStorage.removeItem("digitalether_pos_checkout_profile");
 *   location.reload()
 */

const LS_KEY = "digitalether_pos_checkout_profile";

export function isCheckoutProfileEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LS_KEY) === "1";
  } catch {
    return false;
  }
}

/** @param {boolean} on */
export function setCheckoutProfileEnabled(on) {
  if (typeof window === "undefined") return;
  try {
    if (on) window.localStorage.setItem(LS_KEY, "1");
    else window.localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * @param {boolean} enabled
 * @returns {{
 *   markStart: () => void,
 *   lap: (name: string) => void,
 *   done: () => null | {
 *     totalMs: number,
 *     steps: Array<{ step: string; ms: number; pctOfTotal: number }>,
 *     slowestFirst: Array<{ step: string; ms: number; pctOfTotal: number }>,
 *     source: string,
 *   },
 * }}
 */
export function createClientCheckoutProfiler(enabled) {
  if (!enabled) {
    return {
      markStart() {},
      lap() {},
      done() {
        return null;
      },
    };
  }

  let startMs = 0;
  let lastMs = 0;
  /** @type {Array<{ step: string; ms: number }>} */
  const laps = [];

  return {
    markStart() {
      const now = performance.now();
      startMs = now;
      lastMs = now;
    },
    lap(name) {
      const now = performance.now();
      const ms = Math.round((now - lastMs) * 100) / 100;
      laps.push({ step: name, ms });
      lastMs = now;
    },
    done() {
      const endMs = performance.now();
      const totalMs = Math.round((endMs - startMs) * 100) / 100;
      const steps = laps.map((l) => ({
        ...l,
        pctOfTotal: totalMs > 0 ? Math.round((l.ms / totalMs) * 1000) / 10 : 0,
      }));
      const slowestFirst = [...steps].sort((a, b) => b.ms - a.ms);
      return {
        totalMs,
        steps,
        slowestFirst,
        source: "client",
      };
    },
  };
}

/**
 * Prints a readable breakdown to the devtools console (slowest steps first).
 * @param {ReturnType<ReturnType<typeof createClientCheckoutProfiler>["done"]>} clientSummary
 * @param {unknown} serverSummary
 */
export function presentCheckoutProfileReport(clientSummary, serverSummary) {
  if (!clientSummary && !serverSummary) return { client: null, server: null };

  // eslint-disable-next-line no-console
  console.groupCollapsed("[POS checkout timing]");
  if (clientSummary?.slowestFirst?.length) {
    // eslint-disable-next-line no-console
    console.log("Client (browser) — slowest first");
    // eslint-disable-next-line no-console
    console.table(
      clientSummary.slowestFirst.map((r) => ({
        step: r.step,
        ms: r.ms,
        pct: `${r.pctOfTotal}%`,
      }))
    );
    // eslint-disable-next-line no-console
    console.log("Client total ms:", clientSummary.totalMs);
  }
  if (serverSummary?.slowestFirst?.length) {
    // eslint-disable-next-line no-console
    console.log("Server (API /api/pos/checkout) — slowest first");
    // eslint-disable-next-line no-console
    console.table(
      serverSummary.slowestFirst.map((r) => ({
        step: r.step,
        ms: r.ms,
        pct: `${r.pctOfTotal}%`,
      }))
    );
    // eslint-disable-next-line no-console
    console.log("Server total ms:", serverSummary.totalMs);
  }
  if (clientSummary && serverSummary) {
    // eslint-disable-next-line no-console
    console.log(
      "Note: client total includes network + server work inside the checkout request; server rows are internal only."
    );
  }
  // eslint-disable-next-line no-console
  console.groupEnd();

  return { client: clientSummary ?? null, server: serverSummary ?? null };
}
