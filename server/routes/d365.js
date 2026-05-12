const express = require("express");
const {
  d365Configured,
  d365ConfigError,
  listFinalApprovedCreditApplications,
  postLoanTransaction,
  validatePostLoanTransactionParams,
  buildPostLoanTransactionBody,
} = require("../services/d365Client");

const router = express.Router();

/**
 * GET /api/d365/credit-applications/final-approved?top=200&branch_d365_id=<guid>
 * Lists htb365_creditapplication rows where htb365_status matches label FINAL APPROVED (metadata lookup)
 * or D365_CREDIT_STATUS_VALUE when set.
 * Optional branch_d365_id: Dynamics branch row id (same as location.d365_id on the POS store); filters
 * credit applications to that branch. When omitted, branch filter falls back to D365_BRANCH_NAME /
 * D365_BRANCH_ID env if set, otherwise no branch filter.
 */
router.get("/credit-applications/final-approved", async (req, res) => {
  if (!d365Configured()) {
    return res.status(503).json({ error: d365ConfigError() });
  }
  try {
    const top = req.query.top !== undefined ? Number(req.query.top) : 200;
    const rawBranch = req.query.branch_d365_id;
    let branchD365Id;
    if (rawBranch !== undefined && rawBranch !== null && String(rawBranch).trim() !== "") {
      const t = String(rawBranch).trim();
      const guidRe =
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      if (!guidRe.test(t)) {
        return res.status(400).json({
          error: "branch_d365_id must be a valid GUID (Dynamics branch id for the POS location).",
        });
      }
      branchD365Id = t.toLowerCase();
    }
    const {
      statusValue,
      statusLabel,
      branchId,
      branchName,
      branchLookupKey,
      records,
    } = await listFinalApprovedCreditApplications({
      top,
      branchD365Id,
    });
    res.json({
      statusValue,
      statusLabel: statusLabel ?? null,
      branchId: branchId ?? null,
      branchName: branchName ?? null,
      branchLookupKey: branchLookupKey ?? null,
      count: records.length,
      records,
    });
  } catch (err) {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    console.error("[d365] credit-applications:", err.message);
    res.status(status).json({ error: err.message || "Dataverse request failed" });
  }
});

/**
 * POST /api/d365/post-loan-transaction
 * Body: poreference, grandtotal, documentno, dateinvoiced, currency, payments[{ amount, payment_method }]
 * Forwards to Dataverse unbound action with { transactionJson: "<stringified invoice+payments>" }.
 * Optional query: ?dryRun=1 — validate only and return the payload without calling Dataverse.
 */
router.post("/post-loan-transaction", async (req, res) => {
  if (!d365Configured()) {
    return res.status(503).json({ error: d365ConfigError() });
  }
  const validationErrors = validatePostLoanTransactionParams(req.body);
  if (validationErrors.length) {
    return res.status(400).json({ error: "Invalid body", details: validationErrors });
  }
  const transactionPayload = buildPostLoanTransactionBody(req.body);
  if (req.query.dryRun === "1" || req.query.dryRun === "true") {
    return res.json({
      dryRun: true,
      transactionPayload,
    });
  }
  try {
    const data = await postLoanTransaction(req.body);
    res.status(200).json({ ok: true, data: data ?? null, transactionPayload });
  } catch (err) {
    const status =
      err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    console.error("[d365] post-loan-transaction:", err.message);
    res.status(status).json({
      error: err.message || "Dataverse request failed",
      details: err.details,
      transactionPayload,
    });
  }
});

module.exports = router;
