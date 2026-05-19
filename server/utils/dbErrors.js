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
  if (err.code === "23514") {
    const constraint = String(err.constraint || "");
    if (
      constraint === "rights_object_type_chk" ||
      constraint === "rights_object_name_check"
    ) {
      return {
        status: 400,
        message:
          "This permission type is not supported by the database yet. Run server/scripts/rights-menu-permissions.sql on this database, then try again.",
        detail: constraint,
      };
    }
    return {
      status: 400,
      message: "A value did not pass validation.",
      detail: constraint || err.message,
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
