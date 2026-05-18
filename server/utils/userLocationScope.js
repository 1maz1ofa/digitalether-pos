/** null on user = all locations (admin / super user). */

function getUserLocationId(user) {
  if (!user || user.location_id == null || user.location_id === "") return null;
  const n = Number(user.location_id);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function userHasAllLocations(user) {
  return getUserLocationId(user) === null;
}

function parseRequestedLocationId(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * Resolve which location id applies for a request.
 * Branch users are always pinned to their location; mismatches return forbidden.
 */
function resolveLocationAccess(user, requestedRaw) {
  const userLoc = getUserLocationId(user);
  const requested = parseRequestedLocationId(requestedRaw);

  if (userLoc != null) {
    if (requested != null && requested !== userLoc) {
      return { ok: false, status: 403, error: "You may only access your assigned location." };
    }
    return { ok: true, locationId: userLoc };
  }

  return { ok: true, locationId: requested };
}

function sendLocationForbidden(res, message) {
  return res
    .status(403)
    .json({ error: message || "You may only access your assigned location." });
}

/** Returns false after sending 403 when access is denied. */
function enforceLocationAccess(user, locationId, res) {
  const access = resolveLocationAccess(user, locationId);
  if (!access.ok) {
    sendLocationForbidden(res, access.error);
    return false;
  }
  return true;
}

/**
 * Resolved location filter for list endpoints.
 * Branch users always get their location id; admins may pass an optional filter.
 */
function resolveListLocationFilter(user, requestedRaw, res) {
  const access = resolveLocationAccess(user, requestedRaw);
  if (!access.ok) {
    sendLocationForbidden(res, access.error);
    return null;
  }
  return access.locationId;
}

module.exports = {
  getUserLocationId,
  userHasAllLocations,
  parseRequestedLocationId,
  resolveLocationAccess,
  sendLocationForbidden,
  enforceLocationAccess,
  resolveListLocationFilter,
};
