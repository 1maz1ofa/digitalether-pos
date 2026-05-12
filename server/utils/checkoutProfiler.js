/**
 * Optional per-request timing for POST /api/pos/checkout.
 *
 * Enable with any of:
 * - Environment: POS_CHECKOUT_PROFILE=1 (or "true")
 * - Request header: X-POS-Checkout-Profile: 1
 */

function truthyHeader(val) {
  if (val === undefined || val === null) return false;
  const s = String(val).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function isPosCheckoutProfilingEnabled(req) {
  const env = process.env.POS_CHECKOUT_PROFILE;
  if (truthyHeader(env)) return true;
  const h =
    req.get?.("x-pos-checkout-profile") ?? req.headers?.["x-pos-checkout-profile"];
  return truthyHeader(h);
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
function createCheckoutProfiler(enabled) {
  if (!enabled) {
    return {
      markStart() {},
      lap() {},
      done() {
        return null;
      },
    };
  }

  /** @type {bigint | null} */
  let startNs = null;
  /** @type {bigint | null} */
  let lastNs = null;
  /** @type {Array<{ step: string; ms: number }>} */
  const laps = [];

  function nsToMs(ns) {
    return Math.round((Number(ns) / 1e6) * 100) / 100;
  }

  return {
    markStart() {
      const now = process.hrtime.bigint();
      startNs = now;
      lastNs = now;
    },
    lap(name) {
      const now = process.hrtime.bigint();
      if (lastNs === null || startNs === null) {
        startNs = now;
        lastNs = now;
        return;
      }
      const ms = nsToMs(now - lastNs);
      laps.push({ step: name, ms });
      lastNs = now;
    },
    done() {
      if (startNs === null) return null;
      const endNs = process.hrtime.bigint();
      const totalMs = nsToMs(endNs - startNs);
      const steps = laps.map((l) => ({
        ...l,
        pctOfTotal: totalMs > 0 ? Math.round((l.ms / totalMs) * 1000) / 10 : 0,
      }));
      const slowestFirst = [...steps].sort((a, b) => b.ms - a.ms);
      return {
        totalMs,
        steps,
        slowestFirst,
        source: "server",
      };
    },
  };
}

module.exports = {
  isPosCheckoutProfilingEnabled,
  createCheckoutProfiler,
};
