const STORAGE_KEY = "digitalether_pos_workstation_v1";

/**
 * @returns {{ locationId: number, terminalId: number } | null}
 */
export function readPosWorkstation() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const locationId = Number(parsed?.locationId);
    const terminalId = Number(parsed?.terminalId);
    if (!Number.isInteger(locationId) || locationId < 1) return null;
    if (!Number.isInteger(terminalId) || terminalId < 1) return null;
    return { locationId, terminalId };
  } catch {
    return null;
  }
}

/** @param {{ locationId: number, terminalId: number }} ws */
export function writePosWorkstation(ws) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ locationId: ws.locationId, terminalId: ws.terminalId })
    );
  } catch {
    /* ignore */
  }
}

export function clearPosWorkstation() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
