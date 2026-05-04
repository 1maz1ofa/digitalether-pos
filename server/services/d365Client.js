/**
 * Dataverse Web API (Dynamics 365) using Azure AD client credentials.
 * Env: D365_TENANT_ID, D365_CLIENT_ID, D365_CLIENT_SECRET, D365_BASE_URL (org root, e.g. https://org.crm.dynamics.com)
 * Optional: D365_CREDIT_ENTITY_SET (default htb365_creditapplications), D365_CREDIT_STATUS_LABEL (default FINAL APPROVED),
 *           D365_CREDIT_STATUS_VALUE (skip metadata if set — integer for htb365_status; pair with D365_CREDIT_STATUS_LABEL for display),
 *           D365_CREDIT_CUSTOMER_EXPAND (full OData $expand segment if metadata/default $select is wrong),
 *           D365_CREDIT_CUSTOMER_SELECT (comma list for $select inside each expand; used with metadata-resolved nav names),
 *           D365_BRANCH_NAME (branch display name — filters htb365_branch/htb365_name, preferred over GUID),
 *           D365_CREDIT_BRANCH_NAV (navigation property for branch lookup; if unset, resolved from metadata — often htb365_Branch vs logical htb365_branch),
 *           D365_CREDIT_BRANCH_ATTRIBUTE (referencing attribute logical name on credit app for branch lookup; default htb365_branch — used only when resolving nav from metadata),
 *           D365_BRANCH_NAME_COLUMN (name column on branch table; default htb365_name),
 *           D365_BRANCH_ID (legacy: GUID — _htb365_branch_value eq guid when D365_BRANCH_NAME is unset),
 *           D365_CREDIT_BRANCH_LOOKUP (legacy OData FK; default _htb365_branch_value),
 *           D365_BRANCH_ENTITY_SET (Web API set for branch row lookup by id; default htb365_branches; falls back to htb365_branch on 404),
 *           D365_CREDIT_CUSTOMER_LOOKUP (OData FK attribute for customer GUID on credit app; default _htb365_customer_value)
 */

const DATAVERSE_API_VERSION = "v9.2";

let cachedToken = { accessToken: null, expiresAt: 0 };
let cachedStatusValue = { key: null, value: null, label: null };
let cachedCustomerExpand = { key: null, expandInner: null, navNames: null };
let cachedBranchNav = { key: null, navName: null };

function requireEnv(name) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === "") {
    return null;
  }
  return String(v).trim();
}

function getOrgRoot() {
  const raw = requireEnv("D365_BASE_URL");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return `${u.origin}`;
  } catch {
    return null;
  }
}

function getWebApiBase() {
  const root = getOrgRoot();
  if (!root) return null;
  return `${root}/api/data/${DATAVERSE_API_VERSION}`;
}

function d365Configured() {
  return Boolean(
    requireEnv("D365_TENANT_ID") &&
      requireEnv("D365_CLIENT_ID") &&
      requireEnv("D365_CLIENT_SECRET") &&
      getOrgRoot()
  );
}

function d365ConfigError() {
  return "D365 is not configured. Set D365_TENANT_ID, D365_CLIENT_ID, D365_CLIENT_SECRET, and D365_BASE_URL (organization URL).";
}

async function getAccessToken() {
  const tenantId = requireEnv("D365_TENANT_ID");
  const clientId = requireEnv("D365_CLIENT_ID");
  const clientSecret = requireEnv("D365_CLIENT_SECRET");
  const orgRoot = getOrgRoot();
  if (!tenantId || !clientId || !clientSecret || !orgRoot) {
    const err = new Error(d365ConfigError());
    err.statusCode = 503;
    throw err;
  }

  const now = Date.now();
  if (cachedToken.accessToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.accessToken;
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(
    tenantId
  )}/oauth2/v2.0/token`;
  const scope = `${orgRoot}/.default`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json.error_description ||
      json.error ||
      `Token request failed (${res.status})`;
    const err = new Error(msg);
    err.statusCode = res.status === 401 || res.status === 403 ? 502 : 502;
    throw err;
  }
  const expiresIn = Number(json.expires_in) || 3600;
  cachedToken = {
    accessToken: json.access_token,
    expiresAt: now + expiresIn * 1000,
  };
  return cachedToken.accessToken;
}

async function dataverseRequest(pathWithLeadingSlash, { method = "GET", headers = {} } = {}) {
  const base = getWebApiBase();
  if (!base) {
    const err = new Error(d365ConfigError());
    err.statusCode = 503;
    throw err;
  }
  const token = await getAccessToken();
  const url = `${base}${pathWithLeadingSlash.startsWith("/") ? "" : "/"}${pathWithLeadingSlash}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
      ...headers,
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      `Dataverse request failed (${res.status})`;
    const err = new Error(msg);
    err.statusCode = res.status >= 400 && res.status < 500 ? res.status : 502;
    err.details = data;
    throw err;
  }
  return data;
}

function optionLabelText(opt) {
  const labels = opt?.Label?.LocalizedLabels || opt?.label?.LocalizedLabels;
  if (!Array.isArray(labels) || !labels.length) return "";
  return String(labels[0]?.Label || labels[0]?.label || "").trim();
}

/**
 * Resolve choice/picklist value for htb365_status (OData still uses integer) and human label for filters/UI.
 * @returns {Promise<{ value: number, label: string | null }>}
 */
async function resolveFinalApprovedStatus() {
  const entityLogical = "htb365_creditapplication";
  const attributeLogical = "htb365_status";
  const labelTarget = (
    requireEnv("D365_CREDIT_STATUS_LABEL") || "FINAL APPROVED"
  ).trim();
  const override = requireEnv("D365_CREDIT_STATUS_VALUE");
  if (override !== null && override !== "") {
    const n = Number(override);
    if (!Number.isFinite(n)) {
      const err = new Error("D365_CREDIT_STATUS_VALUE must be a number.");
      err.statusCode = 400;
      throw err;
    }
    const labelOnly = requireEnv("D365_CREDIT_STATUS_LABEL")?.trim() || null;
    return { value: n, label: labelOnly };
  }

  const cacheKey = `${entityLogical}|${attributeLogical}|${labelTarget}`;
  if (
    cachedStatusValue.key === cacheKey &&
    cachedStatusValue.value != null
  ) {
    return {
      value: cachedStatusValue.value,
      label: cachedStatusValue.label,
    };
  }

  const path =
    `/EntityDefinitions(LogicalName='${entityLogical}')` +
    `/Attributes(LogicalName='${attributeLogical}')` +
    `/Microsoft.Dynamics.CRM.PicklistAttributeMetadata` +
    `?$select=LogicalName&$expand=OptionSet`;

  let meta;
  try {
    meta = await dataverseRequest(path);
  } catch (e) {
    const err = new Error(
      `Could not read picklist metadata for ${attributeLogical}. ` +
        `If this column is not a Choice/Picklist in the API, set D365_CREDIT_STATUS_VALUE to the option integer. ` +
        `Original: ${e.message}`
    );
    err.statusCode = e.statusCode || 502;
    throw err;
  }

  const options = meta?.OptionSet?.Options || meta?.optionSet?.Options || [];
  const normalizedTarget = labelTarget.toLowerCase();
  for (const opt of options) {
    const text = optionLabelText(opt);
    if (text && text.toLowerCase() === normalizedTarget) {
      const val = opt.Value ?? opt.value;
      if (val !== undefined && val !== null) {
        const resolvedLabel = text || labelTarget;
        cachedStatusValue = {
          key: cacheKey,
          value: Number(val),
          label: resolvedLabel,
        };
        return { value: cachedStatusValue.value, label: resolvedLabel };
      }
    }
  }

  const err = new Error(
    `No picklist option found with label "${labelTarget}" on ${attributeLogical}. ` +
      `Set D365_CREDIT_STATUS_LABEL or D365_CREDIT_STATUS_VALUE in .env.`
  );
  err.statusCode = 422;
  throw err;
}

function entitySetName() {
  return requireEnv("D365_CREDIT_ENTITY_SET") || "htb365_creditapplications";
}

/** @returns {string | null} lowercase canonical GUID or null */
function parseGuidEnv(value) {
  if (value === undefined || value === null) return null;
  const t = String(value).trim();
  const re =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!re.test(t)) return null;
  return t.toLowerCase();
}

function escapeODataString(s) {
  return String(s).replace(/'/g, "''");
}

/**
 * Branch filter: prefer D365_BRANCH_NAME (navigation …/htb365_name), else D365_BRANCH_ID (lookup FK).
 * @param {string | null} branchNavResolved OData navigation property from metadata (or env override).
 * @returns {{ mode: 'name', navProperty: string, nameColumn: string, branchName: string } | { mode: 'lookup', branchId: string, lookupFilterKey: string } | null}
 */
function resolveBranchFilterForQuery(branchNavResolved = null) {
  const nameRaw = requireEnv("D365_BRANCH_NAME");
  if (nameRaw) {
    const branchName = String(nameRaw).trim();
    if (!branchName) return null;
    const navProperty =
      branchNavResolved ||
      requireEnv("D365_CREDIT_BRANCH_NAV") ||
      "htb365_branch";
    const nameColumn = requireEnv("D365_BRANCH_NAME_COLUMN") || "htb365_name";
    return { mode: "name", navProperty, nameColumn, branchName };
  }

  const raw = requireEnv("D365_BRANCH_ID");
  if (!raw) return null;
  const branchId = parseGuidEnv(raw);
  if (!branchId) {
    const err = new Error(
      "D365_BRANCH_ID must be a valid GUID (htb365_branch record id), or set D365_BRANCH_NAME instead."
    );
    err.statusCode = 400;
    throw err;
  }
  const lookupFilterKey =
    requireEnv("D365_CREDIT_BRANCH_LOOKUP") || "_htb365_branch_value";
  return { mode: "lookup", branchId, lookupFilterKey };
}

/**
 * Load branch display name (e.g. htb365_name) for a branch record id when filtering by GUID.
 * @param {string} branchId lowercase canonical GUID
 * @returns {Promise<string | null>}
 */
function pickBranchNameFromDataverseRow(data, nameColumn) {
  if (!data || typeof data !== "object") return null;
  const fvKey = `${nameColumn}@OData.Community.Display.V1.FormattedValue`;
  const v = data[nameColumn] ?? data[fvKey];
  if (v !== undefined && v !== null && String(v).trim() !== "") {
    return String(v).trim();
  }
  return null;
}

async function fetchBranchNameById(branchId) {
  const configured = (requireEnv("D365_BRANCH_ENTITY_SET") || "").trim();
  const nameColumn =
    requireEnv("D365_BRANCH_NAME_COLUMN") || "htb365_name";
  const defaults = ["htb365_branches", "htb365_branch"];
  const candidates = configured
    ? [
        configured,
        ...defaults.filter(
          (s) => s.toLowerCase() !== configured.toLowerCase()
        ),
      ]
    : defaults;
  for (const set of candidates) {
    try {
      const path = `/${set}(${branchId})?$select=${nameColumn}`;
      const data = await dataverseRequest(path);
      const picked = pickBranchNameFromDataverseRow(data, nameColumn);
      if (picked) return picked;
    } catch {
      /* try next entity set or leave null */
    }
  }
  return null;
}

/**
 * The lookup column logical name (e.g. htb365_customer) is not always the OData $expand
 * navigation property name. That name comes from relationship metadata
 * (ReferencingEntityNavigationPropertyName), including multi-table lookups
 * (e.g. …_account / …_contact) when the column uses the Customer type instead of a single table.
 * Related table logical name here is htb365_customer; the UI label "Customer" is only display text.
 *
 * @returns {Promise<{ expandInner: string, navNames: string[] | null }>}
 */
async function resolveCustomerExpandParts() {
  const override = requireEnv("D365_CREDIT_CUSTOMER_EXPAND");
  const selectList =
    requireEnv("D365_CREDIT_CUSTOMER_SELECT") ||
    "htb365_firstname,htb365_lastname,htb365_nationalid,htb365_address";
  const entityLogical = "htb365_creditapplication";
  const attrLogical = "htb365_customer";

  if (override) {
    return { expandInner: override, navNames: null };
  }

  const cacheKey = `${entityLogical}|${attrLogical}|${selectList}`;
  if (
    cachedCustomerExpand.key === cacheKey &&
    cachedCustomerExpand.expandInner != null
  ) {
    return {
      expandInner: cachedCustomerExpand.expandInner,
      navNames: cachedCustomerExpand.navNames,
    };
  }

  const path =
    `/EntityDefinitions(LogicalName='${entityLogical}')/ManyToOneRelationships` +
    `?$select=ReferencingAttribute,ReferencingEntityNavigationPropertyName`;
  let data;
  try {
    data = await dataverseRequest(path);
  } catch (e) {
    const err = new Error(
      `Could not read Many-to-One metadata to resolve customer expand. ` +
        `Set D365_CREDIT_CUSTOMER_EXPAND to a valid OData expand (see maker portal / $metadata). ` +
        `Original: ${e.message}`
    );
    err.statusCode = e.statusCode || 502;
    throw err;
  }

  const rels = Array.isArray(data?.value) ? data.value : [];
  const attrLower = attrLogical.toLowerCase();
  const navNames = [
    ...new Set(
      rels
        .filter((r) => {
          const ref =
            r.ReferencingAttribute ?? r.referencingattribute ?? "";
          return String(ref).toLowerCase() === attrLower;
        })
        .map(
          (r) =>
            r.ReferencingEntityNavigationPropertyName ??
            r.referencingentitynavigationpropertyname
        )
        .filter(Boolean)
    ),
  ];

  if (!navNames.length) {
    const err = new Error(
      `No Many-to-One relationship found for attribute "${attrLogical}" on ${entityLogical}. ` +
        `Confirm the column logical name, or set D365_CREDIT_CUSTOMER_EXPAND manually.`
    );
    err.statusCode = 422;
    throw err;
  }

  const expandInner = navNames
    .map((n) => `${n}($select=${selectList})`)
    .join(",");
  cachedCustomerExpand = { key: cacheKey, expandInner, navNames };
  return { expandInner, navNames };
}

/**
 * OData $expand / $filter navigation segment for a lookup is ReferencingEntityNavigationPropertyName,
 * which can differ in casing from the attribute logical name (e.g. htb365_Branch vs htb365_branch).
 * @returns {Promise<string>}
 */
async function resolveCreditApplicationBranchNavName() {
  const override = requireEnv("D365_CREDIT_BRANCH_NAV");
  if (override) return override;

  const entityLogical = "htb365_creditapplication";
  const attrLogical =
    requireEnv("D365_CREDIT_BRANCH_ATTRIBUTE") || "htb365_branch";
  const cacheKey = `${entityLogical}|${attrLogical}`;
  if (
    cachedBranchNav.key === cacheKey &&
    cachedBranchNav.navName != null
  ) {
    return cachedBranchNav.navName;
  }

  const path =
    `/EntityDefinitions(LogicalName='${entityLogical}')/ManyToOneRelationships` +
    `?$select=ReferencingAttribute,ReferencingEntityNavigationPropertyName`;
  let data;
  try {
    data = await dataverseRequest(path);
  } catch (e) {
    const err = new Error(
      `Could not read Many-to-One metadata to resolve branch navigation property. ` +
        `Set D365_CREDIT_BRANCH_NAV to the OData name from $metadata (often htb365_Branch). ` +
        `Original: ${e.message}`
    );
    err.statusCode = e.statusCode || 502;
    throw err;
  }

  const rels = Array.isArray(data?.value) ? data.value : [];
  const attrLower = attrLogical.toLowerCase();
  const match = rels.find((r) => {
    const ref = r.ReferencingAttribute ?? r.referencingattribute ?? "";
    return String(ref).toLowerCase() === attrLower;
  });
  const nav =
    match?.ReferencingEntityNavigationPropertyName ??
    match?.referencingentitynavigationpropertyname;

  if (!nav || !String(nav).trim()) {
    const err = new Error(
      `No Many-to-One relationship found for branch attribute "${attrLogical}" on ${entityLogical}. ` +
        `Set D365_CREDIT_BRANCH_NAV manually (see maker portal Advanced options or org $metadata).`
    );
    err.statusCode = 422;
    throw err;
  }

  const navName = String(nav).trim();
  cachedBranchNav = { key: cacheKey, navName };
  return navName;
}

/**
 * @returns {Promise<{ value: object[] }>}
 */
async function listCreditApplicationsByStatusValue(
  statusValue,
  top = 200,
  expandInner = null,
  branchFilter = null,
  branchNavResolved = null
) {
  const set = entitySetName();
  const safeTop = Math.min(Math.max(Number(top) || 200, 1), 5000);
  const parts = [`htb365_status eq ${statusValue}`];
  if (branchFilter) {
    if (branchFilter.mode === "name") {
      const esc = escapeODataString(branchFilter.branchName);
      parts.push(
        `${branchFilter.navProperty}/${branchFilter.nameColumn} eq '${esc}'`
      );
    } else {
      parts.push(
        `${branchFilter.lookupFilterKey} eq ${branchFilter.branchId}`
      );
    }
  }
  const filter = encodeURIComponent(parts.join(" and "));
  const inner =
    expandInner ?? (await resolveCustomerExpandParts()).expandInner;
  let expandCombined = inner;
  if (branchFilter) {
    const branchNav =
      branchNavResolved ||
      requireEnv("D365_CREDIT_BRANCH_NAV") ||
      "htb365_branch";
    const nameCol = requireEnv("D365_BRANCH_NAME_COLUMN") || "htb365_name";
    expandCombined = `${branchNav}($select=${nameCol}),${inner}`;
  }
  const expand = encodeURIComponent(expandCombined);
  const path = `/${set}?$filter=${filter}&$orderby=modifiedon desc&$top=${safeTop}&$expand=${expand}`;
  return dataverseRequest(path);
}

function pickBranchNameFromCreditRow(row, branchNavResolved = null) {
  if (!row || typeof row !== "object") return null;
  const branchNav =
    branchNavResolved ||
    requireEnv("D365_CREDIT_BRANCH_NAV") ||
    "htb365_branch";
  const nameCol = requireEnv("D365_BRANCH_NAME_COLUMN") || "htb365_name";
  const br = row[branchNav];
  if (!br || typeof br !== "object" || Array.isArray(br)) return null;
  return pickBranchNameFromDataverseRow(br, nameCol);
}

function isDataverseGuidString(s) {
  return (
    typeof s === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      s.trim()
    )
  );
}

/**
 * Customer record id in D365 (htb365_customer or related), for POS / downstream use.
 */
function pickCustomer365Guid(row, customer) {
  if (!row || typeof row !== "object") return null;
  const configured = requireEnv("D365_CREDIT_CUSTOMER_LOOKUP");
  if (configured && isDataverseGuidString(String(row[configured] ?? ""))) {
    return String(row[configured]).trim();
  }
  const defaultFk = "_htb365_customer_value";
  if (row[defaultFk] && isDataverseGuidString(String(row[defaultFk]))) {
    return String(row[defaultFk]).trim();
  }
  const fkKey = Object.keys(row).find(
    (k) =>
      k.endsWith("_value") &&
      /customer/i.test(k) &&
      isDataverseGuidString(String(row[k] ?? ""))
  );
  if (fkKey) return String(row[fkKey]).trim();

  if (customer && typeof customer === "object" && !Array.isArray(customer)) {
    for (const k of Object.keys(customer)) {
      if (k.includes("@")) continue;
      const v = customer[k];
      if (typeof v === "string" && isDataverseGuidString(v) && /id$/i.test(k)) {
        return v.trim();
      }
    }
  }
  return null;
}

function pickExpandedCustomer(row, navNames) {
  if (!row || typeof row !== "object") return null;
  if (Array.isArray(navNames) && navNames.length) {
    for (const n of navNames) {
      const v = row[n];
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    }
    return null;
  }
  const direct = row.htb365_customer;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct;
  }
  const key = Object.keys(row).find((k) => {
    if (k.includes("@") || k.endsWith("_value")) return false;
    const v = row[k];
    return (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      ("htb365_firstname" in v || "firstname" in v || "name" in v)
    );
  });
  return key ? row[key] : null;
}

function mapRecord(row, { customerNavNames } = {}) {
  if (!row || typeof row !== "object") return row;
  const idKey = Object.keys(row).find(
    (k) => k.toLowerCase() === "htb365_creditapplicationid" || /_creditapplicationid$/i.test(k)
  );
  const nameKey = Object.keys(row).find(
    (k) =>
      /^htb365_[a-z0-9_]*name$/i.test(k) &&
      !k.includes("@") &&
      !k.endsWith("_value")
  );
  const statusLabelKey = Object.keys(row).find((k) =>
    k.includes("htb365_status@OData.Community.Display.V1.FormattedValue")
  );
  const customer = pickExpandedCustomer(row, customerNavNames);
  return {
    id: idKey ? row[idKey] : null,
    name: nameKey ? row[nameKey] : null,
    status: row.htb365_status,
    statusLabel: statusLabelKey ? row[statusLabelKey] : null,
    approvedDate: row.htb365_approveddate ?? null,
    customerFirstName:
      customer?.htb365_firstname ?? customer?.firstname ?? null,
    customerLastName:
      customer?.htb365_lastname ?? customer?.lastname ?? null,
    customerNationalId: customer?.htb365_nationalid ?? null,
    customerAddress: customer?.htb365_address ?? null,
    customer365Guid: pickCustomer365Guid(row, customer),
    minimumDeposit: row.htb365_minimumdeposit ?? null,
    installmentAmount: row.htb365_approvedcredit ?? null,
    fields: row,
  };
}

async function listFinalApprovedCreditApplications(options = {}) {
  const { top } = options;
  const { expandInner, navNames } = await resolveCustomerExpandParts();
  const { value: statusValue, label: statusLabel } =
    await resolveFinalApprovedStatus();
  const needsBranchNav = Boolean(
    requireEnv("D365_BRANCH_NAME") || requireEnv("D365_BRANCH_ID")
  );
  const branchNavResolved = needsBranchNav
    ? await resolveCreditApplicationBranchNavName()
    : null;
  const branchFilter = resolveBranchFilterForQuery(branchNavResolved);
  const branchNamePromise =
    branchFilter?.mode === "lookup"
      ? fetchBranchNameById(branchFilter.branchId)
      : Promise.resolve(
          branchFilter?.mode === "name" ? branchFilter.branchName : null
        );
  const [result, branchName] = await Promise.all([
    listCreditApplicationsByStatusValue(
      statusValue,
      top,
      expandInner,
      branchFilter,
      branchNavResolved
    ),
    branchNamePromise,
  ]);
  const rows = Array.isArray(result?.value) ? result.value : [];
  let resolvedBranchName = branchName;
  if (
    !resolvedBranchName &&
    branchFilter &&
    rows.length > 0
  ) {
    resolvedBranchName = pickBranchNameFromCreditRow(
      rows[0],
      branchNavResolved
    );
  }
  return {
    statusValue,
    statusLabel,
    branchId:
      branchFilter && branchFilter.mode === "lookup"
        ? branchFilter.branchId
        : null,
    branchName: resolvedBranchName,
    branchLookupKey:
      branchFilter && branchFilter.mode === "lookup"
        ? branchFilter.lookupFilterKey
        : null,
    records: rows.map((row) => mapRecord(row, { customerNavNames: navNames })),
  };
}

module.exports = {
  d365Configured,
  d365ConfigError,
  listFinalApprovedCreditApplications,
};
