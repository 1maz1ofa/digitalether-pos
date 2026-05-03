/**
 * Map PostgreSQL errors to HTTP responses for consistent API errors.
 */
function mapPgError(err) {
  if (err.code === "23505") {
    return {
      status: 409,
      message: "A record with this unique value already exists.",
      detail: err.detail,
    };
  }
  if (err.code === "23503") {
    return {
      status: 409,
      message:
        "This record is still referenced elsewhere. Remove dependent records first.",
      detail: err.detail,
    };
  }
  if (err.code === "23502") {
    return {
      status: 400,
      message: "A required field is missing.",
      detail: err.column,
    };
  }
  return {
    status: 500,
    message: err.message || "Database error",
  };
}

function sendPgError(res, err) {
  const { status, message, detail } = mapPgError(err);
  res.status(status).json({ error: message, detail: detail || undefined });
}

module.exports = { mapPgError, sendPgError };
