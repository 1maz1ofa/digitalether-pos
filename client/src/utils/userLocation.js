/** null = all locations (admin / super user with location ALL). */

export function getUserLocationId(user) {
  if (!user || user.location_id == null || user.location_id === "") return null;
  const n = Number(user.location_id);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export function userHasAllLocations(user) {
  return getUserLocationId(user) === null;
}

/** May pick any branch for POS register / inventory context. */
export function canChangeRegisterLocation(user) {
  return userHasAllLocations(user);
}

export function filterLocationsForUser(user, locations) {
  const list = Array.isArray(locations) ? locations : [];
  const userLoc = getUserLocationId(user);
  if (userLoc == null) return list;
  return list.filter((l) => String(l.id) === String(userLoc));
}

/**
 * Preferred default location: user's branch, else POS settings, else first active.
 */
export function resolveDefaultLocationId(user, { settingsLocationId, activeLocations } = {}) {
  const userLoc = getUserLocationId(user);
  if (userLoc != null) return userLoc;

  const active = Array.isArray(activeLocations) ? activeLocations : [];
  const defId = settingsLocationId;
  if (defId != null && active.some((l) => String(l.id) === String(defId))) {
    return Number(defId);
  }
  if (active.length) return Number(active[0].id);
  return null;
}
