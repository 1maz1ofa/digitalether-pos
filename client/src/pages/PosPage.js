import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Modal } from "../components/Modal";

const MULTI_STORE_STORAGE_KEY = "de-pos-multi-store";
const HTB_CREDIT_SELECTION_STORAGE_KEY = "de-pos-htb-credit-selection";

function readStoredHtbCreditSelection() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(HTB_CREDIT_SELECTION_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object" || o.creditApplicationId == null || o.creditApplicationId === "") {
      return null;
    }
    return {
      creditApplicationId: String(o.creditApplicationId),
      customer365Guid: o.customer365Guid != null && String(o.customer365Guid).trim() !== ""
        ? String(o.customer365Guid).trim()
        : null,
      customerDisplayName:
        o.customerDisplayName != null && String(o.customerDisplayName).trim() !== ""
          ? String(o.customerDisplayName).trim()
          : "Customer",
      capNumber:
        o.capNumber != null && String(o.capNumber).trim() !== ""
          ? String(o.capNumber).trim()
          : null,
      retailPrice:
        o.retailPrice === "" || o.retailPrice === undefined ? null : o.retailPrice,
      installmentAmount:
        o.installmentAmount === "" || o.installmentAmount === undefined ? null : o.installmentAmount,
      numberOfInstallmentsMonths:
        o.numberOfInstallmentsMonths === "" || o.numberOfInstallmentsMonths === undefined
          ? null
          : o.numberOfInstallmentsMonths,
      insuranceRate:
        o.insuranceRate === "" || o.insuranceRate === undefined ? null : o.insuranceRate,
      interestRate:
        o.interestRate === "" || o.interestRate === undefined ? null : o.interestRate,
      funeralRate:
        o.funeralRate === "" || o.funeralRate === undefined ? null : o.funeralRate,
    };
  } catch {
    return null;
  }
}

function persistHtbCreditSelection(sel) {
  try {
    if (!sel) {
      window.localStorage.removeItem(HTB_CREDIT_SELECTION_STORAGE_KEY);
    } else {
      window.localStorage.setItem(HTB_CREDIT_SELECTION_STORAGE_KEY, JSON.stringify(sel));
    }
  } catch {
    /* ignore */
  }
}

function formatHtbCreditCustomerName(row) {
  const parts = [row.customerFirstName, row.customerLastName]
    .filter((x) => x != null && String(x).trim() !== "")
    .map((x) => String(x).trim());
  const joined = parts.join(" ").trim();
  return joined || "Customer";
}

function money(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function normalizedVatPercentage(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function lineSubTotal(line) {
  const price = Number(line.unit_price);
  const qty = Number(line.quantity);
  if (!Number.isFinite(price) || !Number.isFinite(qty)) return 0;
  return price * qty;
}

function lineVatAmount(line) {
  const totalIncludingVat = lineSubTotal(line);
  const vatPercentage = normalizedVatPercentage(line.vat_percentage);
  if (totalIncludingVat <= 0 || vatPercentage <= 0) return 0;
  return (totalIncludingVat * vatPercentage) / (100 + vatPercentage);
}

function lineTotalWithVat(line) {
  return lineSubTotal(line);
}

function calculateHtbInstallmentFromDeposit({
  totalInvoiceAmount,
  depositAmount,
  numberOfInstallmentsMonths,
  interestRate,
  insuranceRate,
  funeralRate,
}) {
  const retailPrice = Number(totalInvoiceAmount);
  const deposit = Number(depositAmount);
  const nper = Number(numberOfInstallmentsMonths);
  const annualInterest = Number(interestRate);
  const insurance = Number(insuranceRate);
  const funeral = Number(funeralRate);
  if (
    !Number.isFinite(retailPrice) ||
    retailPrice < 0 ||
    !Number.isFinite(deposit) ||
    deposit < 0 ||
    !Number.isFinite(nper) ||
    nper <= 0 ||
    !Number.isFinite(annualInterest) ||
    annualInterest < 0 ||
    !Number.isFinite(insurance) ||
    insurance < 0 ||
    !Number.isFinite(funeral) ||
    funeral < 0
  ) {
    return null;
  }
  const monthlyRate = annualInterest / 12;
  const funeralCost = funeral * nper;
  const insuranceCost = (retailPrice * insurance * nper) / 12;
  const totalCost = retailPrice + funeralCost + insuranceCost;
  let loanTotal = totalCost - deposit;
  loanTotal = Math.max(0, loanTotal);
  let installment;
  if (monthlyRate === 0) {
    installment = loanTotal / nper;
  } else {
    installment = (loanTotal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -nper));
  }
  if (!Number.isFinite(installment)) return null;
  return Number(installment.toFixed(2));
}

function calculateHtbTotalCost({
  totalInvoiceAmount,
  numberOfInstallmentsMonths,
  insuranceRate,
  funeralRate,
}) {
  const retailPrice = Number(totalInvoiceAmount);
  const nper = Number(numberOfInstallmentsMonths);
  const insurance = Number(insuranceRate);
  const funeral = Number(funeralRate);
  if (
    !Number.isFinite(retailPrice) ||
    retailPrice < 0 ||
    !Number.isFinite(nper) ||
    nper <= 0 ||
    !Number.isFinite(insurance) ||
    insurance < 0 ||
    !Number.isFinite(funeral) ||
    funeral < 0
  ) {
    return null;
  }
  const funeralCost = funeral * nper;
  const insuranceCost = (retailPrice * insurance * nper) / 12;
  return retailPrice + funeralCost + insuranceCost;
}

function solveLoanTotalFromInstallment({
  installmentAmount,
  numberOfInstallmentsMonths,
  interestRate,
}) {
  const installment = Number(installmentAmount);
  const nper = Number(numberOfInstallmentsMonths);
  const annualInterest = Number(interestRate);
  if (
    !Number.isFinite(installment) ||
    installment < 0 ||
    !Number.isFinite(nper) ||
    nper <= 0 ||
    !Number.isFinite(annualInterest) ||
    annualInterest < 0
  ) {
    return null;
  }
  const monthlyRate = annualInterest / 12;
  if (monthlyRate === 0) {
    return installment * nper;
  }
  return installment * ((1 - Math.pow(1 + monthlyRate, -nper)) / monthlyRate);
}

function selectRoundedHtbDeposit({
  totalInvoiceAmount,
  installmentAmount,
  numberOfInstallmentsMonths,
  interestRate,
  insuranceRate,
  funeralRate,
}) {
  const totalInvoice = Number(totalInvoiceAmount);
  const allowedInstallment = Number(installmentAmount);
  if (!Number.isFinite(totalInvoice) || totalInvoice <= 0 || !Number.isFinite(allowedInstallment) || allowedInstallment < 0) {
    return null;
  }
  const totalCost = calculateHtbTotalCost({
    totalInvoiceAmount: totalInvoice,
    numberOfInstallmentsMonths,
    insuranceRate,
    funeralRate,
  });
  const targetLoanTotal = solveLoanTotalFromInstallment({
    installmentAmount: allowedInstallment,
    numberOfInstallmentsMonths,
    interestRate,
  });
  if (!Number.isFinite(totalCost) || !Number.isFinite(targetLoanTotal)) return null;

  const theoreticalDeposit = totalCost - targetLoanTotal;
  const minDeposit = 0;
  const maxDeposit = totalInvoice;
  const roundedCenter = Math.round(theoreticalDeposit);
  let best = null;

  for (let delta = 0; delta <= 250; delta += 1) {
    const candidates = delta === 0 ? [roundedCenter] : [roundedCenter - delta, roundedCenter + delta];
    for (const candidateRaw of candidates) {
      const candidate = Math.min(maxDeposit, Math.max(minDeposit, candidateRaw));
      const roundedCandidate = Number(candidate.toFixed(2));
      const resultingInstallment = calculateHtbInstallmentFromDeposit({
        totalInvoiceAmount: totalInvoice,
        depositAmount: roundedCandidate,
        numberOfInstallmentsMonths,
        interestRate,
        insuranceRate,
        funeralRate,
      });
      if (!Number.isFinite(resultingInstallment)) continue;
      const diff = Math.abs(Number((resultingInstallment - allowedInstallment).toFixed(2)));
      const isWithinAllowed = resultingInstallment <= allowedInstallment;
      const score = {
        matches: diff === 0 ? 1 : 0,
        withinAllowed: isWithinAllowed ? 1 : 0,
        diff,
        distanceFromTheoretical: Math.abs(candidate - theoreticalDeposit),
        candidate,
      };
      if (
        !best ||
        score.matches > best.matches ||
        (score.matches === best.matches && score.withinAllowed > best.withinAllowed) ||
        (score.matches === best.matches &&
          score.withinAllowed === best.withinAllowed &&
          score.diff < best.diff) ||
        (score.matches === best.matches &&
          score.withinAllowed === best.withinAllowed &&
          score.diff === best.diff &&
          score.distanceFromTheoretical < best.distanceFromTheoretical)
      ) {
        best = score;
      }
      if (best?.matches === 1 && best?.withinAllowed === 1) {
        return Number(best.candidate.toFixed(2));
      }
    }
  }
  return best ? Number(best.candidate.toFixed(2)) : null;
}

function isCashPaymentMethod(method) {
  const code = String(method?.code || "").trim().toUpperCase();
  const name = String(method?.name || "").trim().toUpperCase();
  return code === "CASH" || name === "CASH";
}

function toPositiveInt(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function resolveDefaultCustomerId(customers) {
  const activeCustomers = Array.isArray(customers) ? customers : [];
  const defaultCustomer = activeCustomers.find((c) => c.is_default);
  if (defaultCustomer?.id != null) return String(defaultCustomer.id);
  const firstCustomer = activeCustomers[0];
  return firstCustomer?.id != null ? String(firstCustomer.id) : "";
}

function cartKey(productId, locationId, multiStore) {
  if (multiStore && locationId != null && locationId !== "") {
    const loc = Number(locationId);
    if (Number.isInteger(loc) && loc >= 1) {
      return `${productId}::${loc}`;
    }
  }
  return String(productId);
}

const UNCATEGORIZED_KEY = "__none__";

const DEFAULT_SALE_TYPES = [
  { value: "cash", label: "Cash" },
  { value: "laybye", label: "Laybye" },
  { value: "htb", label: "HTB" },
];

function normalizeSaleTypes(rows) {
  if (!Array.isArray(rows)) return DEFAULT_SALE_TYPES;
  const normalized = rows
    .map((row) => ({
      value: String(row?.code ?? "").trim().toLowerCase(),
      label: String(row?.name ?? "").trim(),
      position: Number(row?.position),
    }))
    .filter((row) => row.value !== "" && row.label !== "")
    .sort((a, b) => {
      const ap = Number.isFinite(a.position) ? a.position : Number.MAX_SAFE_INTEGER;
      const bp = Number.isFinite(b.position) ? b.position : Number.MAX_SAFE_INTEGER;
      if (ap !== bp) return ap - bp;
      return a.value.localeCompare(b.value);
    })
    .map(({ value, label }) => ({ value, label }));
  return normalized.length ? normalized : DEFAULT_SALE_TYPES;
}

function saleTypeLabel(value, saleTypes) {
  return saleTypes.find((t) => t.value === value)?.label ?? value;
}

function categoryKey(product) {
  return product.category_id == null || product.category_id === ""
    ? UNCATEGORIZED_KEY
    : String(product.category_id);
}

function categoryLabel(product) {
  if (product.category_id == null || product.category_id === "") {
    return "Uncategorized";
  }
  const n = product.category_name?.trim();
  return n || `Category #${product.category_id}`;
}

function readMultiStorePreference() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MULTI_STORE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function d365CreditRecordMatchesQuery(row, raw) {
  const q = String(raw).trim().toLowerCase();
  if (!q) return true;
  const hay = [row.customerFirstName, row.customerLastName, row.customerNationalId]
    .filter((x) => x != null && String(x).trim() !== "")
    .map((x) => String(x).toLowerCase())
    .join(" ");
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.every((t) => hay.includes(t));
}

export function PosPage() {
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [posSettings, setPosSettings] = useState(null);
  const [nextDocumentNumber, setNextDocumentNumber] = useState(null);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [currencyId, setCurrencyId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [multiStore, setMultiStore] = useState(() => readMultiStorePreference());
  const [cart, setCart] = useState(() => new Map());
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [missingCheckoutInfoOpen, setMissingCheckoutInfoOpen] = useState(false);
  const [lastReceipt, setLastReceipt] = useState(null);
  const [pickProduct, setPickProduct] = useState(null);
  const [pickStoreId, setPickStoreId] = useState("");
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentAmountsByMethod, setPaymentAmountsByMethod] = useState({});
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [saleType, setSaleType] = useState("cash");
  const [saleTypes, setSaleTypes] = useState(DEFAULT_SALE_TYPES);
  const [completedSaleTypeLabel, setCompletedSaleTypeLabel] = useState(null);
  const [d365Records, setD365Records] = useState([]);
  const [d365CreditSearch, setD365CreditSearch] = useState("");
  const [d365Loading, setD365Loading] = useState(false);
  const [d365Error, setD365Error] = useState("");
  const [d365Meta, setD365Meta] = useState(null);
  const [htbCreditSelection, setHtbCreditSelection] = useState(null);
  /** When false, search + table are hidden so the catalog gets vertical space; user can reopen via the header toggle. */
  const [d365CreditAppsListExpanded, setD365CreditAppsListExpanded] = useState(true);

  const filteredD365CreditRecords = useMemo(
    () => d365Records.filter((row) => d365CreditRecordMatchesQuery(row, d365CreditSearch)),
    [d365Records, d365CreditSearch]
  );

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const [p, loc, cust, settings, methods, currencyRows, saleTypeRows] = await Promise.all([
        api.products.list(),
        api.locations.list(),
        api.customers.list(),
        api.pos.settings(),
        api.pos.paymentMethods(),
        api.currencies.list(),
        api.pos.saleTypes(),
      ]);
      setProducts(p);
      setLocations(loc.filter((l) => l.is_active !== false));
      setCustomers(cust);
      const activeCustomers = Array.isArray(cust) ? cust : [];
      setCustomerId((prev) => {
        if (prev && activeCustomers.some((c) => String(c.id) === String(prev))) {
          return String(prev);
        }
        return resolveDefaultCustomerId(activeCustomers);
      });
      setPosSettings(settings);
      setNextDocumentNumber(
        settings?.nextDocumentNumber != null && String(settings.nextDocumentNumber).trim() !== ""
          ? String(settings.nextDocumentNumber).trim()
          : null
      );
      setPaymentMethods(Array.isArray(methods) ? methods : []);
      const activeCurrencies = Array.isArray(currencyRows)
        ? currencyRows.filter((c) => c && c.is_active !== false)
        : [];
      setCurrencies(activeCurrencies);
      setCurrencyId((prev) => {
        if (prev && activeCurrencies.some((c) => String(c.id) === String(prev))) {
          return String(prev);
        }
        const defaultCurrency = activeCurrencies.find((c) => c.is_default);
        if (defaultCurrency?.id != null) return String(defaultCurrency.id);
        const firstActive = activeCurrencies[0];
        return firstActive?.id != null ? String(firstActive.id) : "";
      });
      const normalizedSaleTypes = normalizeSaleTypes(saleTypeRows);
      setSaleTypes(normalizedSaleTypes);
      setSaleType((prev) => {
        if (normalizedSaleTypes.some((x) => x.value === prev)) return prev;
        return normalizedSaleTypes[0]?.value ?? "cash";
      });
    } catch (e) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadD365CreditApps = useCallback(async () => {
    setD365Error("");
    setD365Loading(true);
    try {
      const data = await api.d365.finalApprovedCreditApplications(200);
      setD365Records(Array.isArray(data.records) ? data.records : []);
      setD365Meta({
        statusValue: data.statusValue,
        statusLabel: data.statusLabel ?? null,
        count: data.count,
        branchName: data.branchName ?? null,
      });
    } catch (e) {
      setD365Records([]);
      setD365Meta(null);
      setD365Error(e.message || "Could not load D365 credit applications");
    } finally {
      setD365Loading(false);
    }
  }, []);

  useEffect(() => {
    if (saleType !== "htb") return;
    loadD365CreditApps();
  }, [saleType, loadD365CreditApps]);

  useEffect(() => {
    if (saleType !== "htb") {
      setHtbCreditSelection(null);
      setD365CreditAppsListExpanded(true);
      return;
    }
    const stored = readStoredHtbCreditSelection();
    if (stored) {
      setHtbCreditSelection(stored);
      setD365CreditAppsListExpanded(false);
    } else {
      setD365CreditAppsListExpanded(true);
    }
  }, [saleType]);

  useEffect(() => {
    if (saleType !== "htb" || !d365Records.length) return;
    setHtbCreditSelection((prev) => {
      if (!prev?.creditApplicationId) return prev;
      const row = d365Records.find((r) => String(r?.id) === String(prev.creditApplicationId));
      if (!row) return prev;
      const customerDisplayName = formatHtbCreditCustomerName(row);
      const next = {
        ...prev,
        customerDisplayName,
        capNumber:
          row.capNumber != null && String(row.capNumber).trim() !== ""
            ? String(row.capNumber).trim()
            : prev.capNumber ?? null,
        retailPrice: row.retailPrice ?? prev.retailPrice,
        installmentAmount: row.installmentAmount ?? prev.installmentAmount,
        numberOfInstallmentsMonths:
          row.numberOfInstallmentsMonths ?? prev.numberOfInstallmentsMonths,
        customer365Guid: row.customer365Guid ?? prev.customer365Guid,
        insuranceRate: row.insuranceRate ?? prev.insuranceRate,
        interestRate: row.interestRate ?? prev.interestRate,
        funeralRate: row.funeralRate ?? prev.funeralRate,
      };
      if (
        next.customerDisplayName === prev.customerDisplayName &&
        next.capNumber === prev.capNumber &&
        next.retailPrice === prev.retailPrice &&
        next.installmentAmount === prev.installmentAmount &&
        next.numberOfInstallmentsMonths === prev.numberOfInstallmentsMonths &&
        next.customer365Guid === prev.customer365Guid &&
        next.insuranceRate === prev.insuranceRate &&
        next.interestRate === prev.interestRate &&
        next.funeralRate === prev.funeralRate
      ) {
        return prev;
      }
      persistHtbCreditSelection(next);
      return next;
    });
  }, [saleType, d365Records]);

  useEffect(() => {
    if (saleType === "htb") {
      setCustomerId("");
      return;
    }
    setCustomerId((prev) => {
      const activeCustomers = Array.isArray(customers) ? customers : [];
      if (prev && activeCustomers.some((c) => String(c.id) === String(prev))) {
        return String(prev);
      }
      return resolveDefaultCustomerId(activeCustomers);
    });
  }, [saleType, customers]);

  const locationNameById = useMemo(() => {
    const m = new Map();
    for (const l of locations) {
      m.set(l.id, l.name || l.code || `Store #${l.id}`);
    }
    return m;
  }, [locations]);

  const headerBranchName = useMemo(() => {
    const fromEnv =
      posSettings?.branchName != null && String(posSettings.branchName).trim() !== ""
        ? String(posSettings.branchName).trim()
        : null;
    if (fromEnv) return fromEnv;
    const locId = toPositiveInt(posSettings?.defaultLocationId);
    if (locId != null) {
      const fromList = locationNameById.get(locId);
      if (fromList) return fromList;
    }
    const fromD365 =
      d365Meta?.branchName != null && String(d365Meta.branchName).trim() !== ""
        ? String(d365Meta.branchName).trim()
        : null;
    return fromD365;
  }, [posSettings, locationNameById, d365Meta]);

  const headerTerminalName = useMemo(() => {
    if (posSettings?.terminalName != null && String(posSettings.terminalName).trim() !== "") {
      return String(posSettings.terminalName).trim();
    }
    return null;
  }, [posSettings]);

  function applyMultiStore(nextMulti) {
    try {
      window.localStorage.setItem(MULTI_STORE_STORAGE_KEY, nextMulti ? "1" : "0");
    } catch {
      /* ignore */
    }
    setMultiStore(nextMulti);
    setPickProduct(null);
    const fallbackLoc = (locations[0] && locations[0].id) || null;

    setCart((prev) => {
      if (nextMulti) {
        if (!fallbackLoc) return prev;
        const next = new Map();
        for (const line of prev.values()) {
          const loc = line.location_id ?? fallbackLoc;
          const key = cartKey(line.product_id, loc, true);
          const existing = next.get(key);
          if (existing) {
            next.set(key, {
              ...existing,
              quantity: existing.quantity + line.quantity,
            });
          } else {
            next.set(key, {
              ...line,
              cart_key: key,
              location_id: loc,
              location_label: locationNameById.get(loc) || `Store #${loc}`,
            });
          }
        }
        return next;
      }
      const next = new Map();
      for (const line of prev.values()) {
        const key = cartKey(line.product_id, null, false);
        const existing = next.get(key);
        const { location_id: _lid, location_label: _ll, cart_key: _ck, ...rest } = line;
        if (existing) {
          next.set(key, {
            ...existing,
            quantity: existing.quantity + line.quantity,
          });
        } else {
          next.set(key, {
            ...rest,
            cart_key: key,
          });
        }
      }
      return next;
    });
  }

  const activeProducts = useMemo(
    () => products.filter((p) => p.is_active && p.unit_price != null && Number(p.unit_price) >= 0),
    [products]
  );

  const categoryOptions = useMemo(() => {
    const byKey = new Map();
    for (const p of activeProducts) {
      const key = categoryKey(p);
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          label: categoryLabel(p),
          sortLabel: key === UNCATEGORIZED_KEY ? "\uffff" : (categoryLabel(p) || "").toLowerCase(),
        });
      }
    }
    return Array.from(byKey.values()).sort((a, b) =>
      a.sortLabel.localeCompare(b.sortLabel, undefined, { sensitivity: "base" })
    );
  }, [activeProducts]);

  const categoryFilteredProducts = useMemo(() => {
    if (!categoryFilter) return activeProducts;
    return activeProducts.filter((p) => categoryKey(p) === categoryFilter);
  }, [activeProducts, categoryFilter]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categoryFilteredProducts;
    return categoryFilteredProducts.filter((p) => {
      const hay = `${p.code || ""} ${p.name || ""} ${p.barcode || ""} ${categoryLabel(p)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [categoryFilteredProducts, search]);

  const productGroups = useMemo(() => {
    if (categoryFilter) return null;
    const order = [];
    const map = new Map();
    for (const p of filteredProducts) {
      const key = categoryKey(p);
      let g = map.get(key);
      if (!g) {
        g = { key, title: categoryLabel(p), items: [] };
        map.set(key, g);
        order.push(g);
      }
      g.items.push(p);
    }
    order.sort((a, b) => {
      if (a.key === UNCATEGORIZED_KEY) return 1;
      if (b.key === UNCATEGORIZED_KEY) return -1;
      return (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" });
    });
    for (const g of order) {
      g.items.sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" })
      );
    }
    return order;
  }, [filteredProducts, categoryFilter]);

  const cartLines = useMemo(() => Array.from(cart.values()), [cart]);

  const htbNeedsCustomerSelection =
    saleType === "htb" && !htbCreditSelection?.creditApplicationId;
  const hasSelectedCurrency =
    currencyId !== "" && currencies.some((c) => String(c.id) === String(currencyId));
  const hasSelectedCustomer =
    saleType === "htb" ||
    (customerId !== "" && customers.some((c) => String(c.id) === String(customerId)));
  const defaultLocationId = toPositiveInt(posSettings?.defaultLocationId);
  const hasActiveDefaultLocation =
    defaultLocationId != null &&
    locations.some((l) => l.is_active !== false && String(l.id) === String(defaultLocationId));

  const missingCheckoutItems = useMemo(() => {
    const missing = [];
    if (cartLines.length === 0) missing.push("Add at least one item to the cart.");
    if (loading) missing.push("Wait for products and settings to finish loading.");
    if (checkoutLoading) missing.push("Checkout is already in progress.");
    if (
      !multiStore &&
      !hasActiveDefaultLocation
    ) {
      missing.push(
        "Configure an active default branch on the server (D365_BRANCH_ID GUID mapped to an active location.d365_id)."
      );
    }
    if (htbNeedsCustomerSelection) missing.push("Select an HTB customer (credit application).");
    if (!hasSelectedCurrency) missing.push("Select a currency for this sale.");
    if (!hasSelectedCustomer) missing.push("Select a customer for this sale.");
    return missing;
  }, [
    cartLines.length,
    checkoutLoading,
    hasSelectedCurrency,
    hasSelectedCustomer,
    hasActiveDefaultLocation,
    htbNeedsCustomerSelection,
    loading,
    multiStore,
  ]);

  const checkoutDebugInfo = useMemo(
    () => ({
      multiStore,
      loading,
      checkoutLoading,
      cartCount: cartLines.length,
      posDefaultLocationId: posSettings?.defaultLocationId ?? null,
      posBranchName:
        posSettings?.branchName != null && String(posSettings.branchName).trim() !== ""
          ? String(posSettings.branchName).trim()
          : null,
      posTerminalId: posSettings?.terminalId ?? null,
      posTerminalName:
        posSettings?.terminalName != null && String(posSettings.terminalName).trim() !== ""
          ? String(posSettings.terminalName).trim()
          : null,
      hasActiveDefaultLocation,
      selectedCurrencyId: currencyId || null,
      hasSelectedCurrency,
      selectedCustomerId: saleType === "htb" ? null : customerId || null,
      hasSelectedCustomer,
      saleType,
      htbNeedsCustomerSelection,
      missingCheckoutItems,
    }),
    [
      multiStore,
      loading,
      checkoutLoading,
      cartLines.length,
      posSettings,
      hasActiveDefaultLocation,
      currencyId,
      hasSelectedCurrency,
      saleType,
      customerId,
      hasSelectedCustomer,
      htbNeedsCustomerSelection,
      missingCheckoutItems,
    ]
  );

  const checkoutDisabled = missingCheckoutItems.length > 0;

  const subtotal = useMemo(
    () => cartLines.reduce((sum, line) => sum + lineTotalWithVat(line), 0),
    [cartLines]
  );
  const vatTotal = useMemo(
    () => cartLines.reduce((sum, line) => sum + lineVatAmount(line), 0),
    [cartLines]
  );
  const subTotalBeforeVat = useMemo(
    () => Number((subtotal - vatTotal).toFixed(2)),
    [subtotal, vatTotal]
  );

  const displayPaymentMethods = useMemo(
    () => paymentMethods.filter((m) => String(m.code || "").trim().toUpperCase() !== "LOAN"),
    [paymentMethods]
  );

  const totalPaymentsApplied = useMemo(() => {
    return displayPaymentMethods.reduce((sum, method) => {
      const raw = paymentAmountsByMethod[String(method.id)];
      if (raw == null || raw === "") return sum;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return sum;
      return sum + n;
    }, 0);
  }, [paymentAmountsByMethod, displayPaymentMethods]);

  const paymentShortfall = useMemo(() => {
    const roundedSubtotal = Number(subtotal.toFixed(2));
    const roundedPaid = Number(totalPaymentsApplied.toFixed(2));
    return Math.max(0, Number((roundedSubtotal - roundedPaid).toFixed(2)));
  }, [subtotal, totalPaymentsApplied]);

  const paymentChangeDue = useMemo(() => {
    const roundedSubtotal = Number(subtotal.toFixed(2));
    const roundedPaid = Number(totalPaymentsApplied.toFixed(2));
    return Math.max(0, Number((roundedPaid - roundedSubtotal).toFixed(2)));
  }, [subtotal, totalPaymentsApplied]);

  const loanApplied = useMemo(() => {
    if (saleType !== "htb") return 0;
    const roundedSubtotal = Number(subtotal.toFixed(2));
    const roundedPaid = Number(totalPaymentsApplied.toFixed(2));
    return Math.max(0, Number((roundedSubtotal - roundedPaid).toFixed(2)));
  }, [saleType, subtotal, totalPaymentsApplied]);

  const roundedTotalPaymentsApplied = useMemo(
    () => Number(totalPaymentsApplied.toFixed(2)),
    [totalPaymentsApplied]
  );
  const htbAllowedInstallmentAmount = useMemo(() => {
    if (saleType !== "htb") return null;
    const amount = Number(htbCreditSelection?.installmentAmount);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Number(amount.toFixed(2));
  }, [saleType, htbCreditSelection]);
  const htbResultingInstallmentAmount = useMemo(() => {
    if (saleType !== "htb") return null;
    return calculateHtbInstallmentFromDeposit({
      totalInvoiceAmount: subtotal,
      depositAmount: roundedTotalPaymentsApplied,
      numberOfInstallmentsMonths: htbCreditSelection?.numberOfInstallmentsMonths,
      interestRate: htbCreditSelection?.interestRate,
      insuranceRate: htbCreditSelection?.insuranceRate,
      funeralRate: htbCreditSelection?.funeralRate,
    });
  }, [saleType, subtotal, roundedTotalPaymentsApplied, htbCreditSelection]);
  const htbInstallmentOutOfRange =
    saleType === "htb" &&
    Number.isFinite(htbAllowedInstallmentAmount) &&
    Number.isFinite(htbResultingInstallmentAmount) &&
    htbResultingInstallmentAmount > htbAllowedInstallmentAmount;

  useEffect(() => {
    if (!paymentModalOpen) return;
    const next = {};
    let cashMethodId = null;
    for (const method of displayPaymentMethods) {
      next[String(method.id)] = "0";
      if (cashMethodId == null && isCashPaymentMethod(method)) {
        cashMethodId = String(method.id);
      }
    }
    if (saleType === "htb" && cashMethodId != null) {
      const suggestedDeposit = selectRoundedHtbDeposit({
        totalInvoiceAmount: subtotal,
        installmentAmount: htbCreditSelection?.installmentAmount,
        numberOfInstallmentsMonths: htbCreditSelection?.numberOfInstallmentsMonths,
        interestRate: htbCreditSelection?.interestRate,
        insuranceRate: htbCreditSelection?.insuranceRate,
        funeralRate: htbCreditSelection?.funeralRate,
      });
      if (Number.isFinite(suggestedDeposit) && suggestedDeposit > 0) {
        next[cashMethodId] = String(suggestedDeposit.toFixed(2));
      }
    }
    setPaymentAmountsByMethod(next);
  }, [paymentModalOpen, displayPaymentMethods, saleType, subtotal, htbCreditSelection]);

  function addToCart(product) {
    setLastReceipt(null);
    const key = cartKey(product.id, null, false);
    setCart((prev) => {
      const next = new Map(prev);
      const existing = next.get(key);
      const unitPrice = Number(product.unit_price);
      const vatPercentage = normalizedVatPercentage(product.vat_percentage);
      if (existing) {
        next.set(key, {
          ...existing,
          vat_percentage: vatPercentage,
          quantity: existing.quantity + 1,
        });
      } else {
        next.set(key, {
          cart_key: key,
          product_id: product.id,
          code: product.code,
          name: product.name,
          unit_price: unitPrice,
          vat_percentage: vatPercentage,
          quantity: 1,
        });
      }
      return next;
    });
  }

  function addToCartAtLocation(product, locId) {
    setLastReceipt(null);
    const key = cartKey(product.id, locId, true);
    const locLabel = locationNameById.get(locId) || `Store #${locId}`;
    setCart((prev) => {
      const next = new Map(prev);
      const existing = next.get(key);
      const unitPrice = Number(product.unit_price);
      const vatPercentage = normalizedVatPercentage(product.vat_percentage);
      if (existing) {
        next.set(key, {
          ...existing,
          vat_percentage: vatPercentage,
          quantity: existing.quantity + 1,
        });
      } else {
        next.set(key, {
          cart_key: key,
          product_id: product.id,
          code: product.code,
          name: product.name,
          unit_price: unitPrice,
          vat_percentage: vatPercentage,
          quantity: 1,
          location_id: locId,
          location_label: locLabel,
        });
      }
      return next;
    });
  }

  function beginAddProduct(product) {
    if (htbNeedsCustomerSelection) {
      setError("Select an HTB customer (credit application) before adding products.");
      return;
    }
    if (multiStore) {
      setError("");
      setPickStoreId("");
      setPickProduct(product);
    } else {
      addToCart(product);
    }
  }

  function confirmPickStore() {
    if (htbNeedsCustomerSelection) {
      setPickProduct(null);
      setError("Select an HTB customer (credit application) before adding products.");
      return;
    }
    if (!pickProduct) return;
    const loc = parseInt(pickStoreId, 10);
    if (!Number.isInteger(loc) || loc < 1) {
      setError("Select a store for this product.");
      return;
    }
    setError("");
    addToCartAtLocation(pickProduct, loc);
    setPickProduct(null);
  }

  function setLineQuantity(lineKey, qty) {
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      setCart((prev) => {
        const next = new Map(prev);
        next.delete(lineKey);
        return next;
      });
      return;
    }
    setCart((prev) => {
      const next = new Map(prev);
      const line = next.get(lineKey);
      if (!line) return prev;
      next.set(lineKey, { ...line, quantity: n });
      return next;
    });
  }

  function removeLine(lineKey) {
    setCart((prev) => {
      const next = new Map(prev);
      next.delete(lineKey);
      return next;
    });
  }

  function clearCart() {
    setCart(new Map());
  }

  async function handleCheckout(paymentPayload) {
    const fromPaymentModal = Boolean(paymentPayload);
    setError("");
    setPaymentError("");
    setLastReceipt(null);
    setCompletedSaleTypeLabel(null);
    if (!multiStore && !hasActiveDefaultLocation) {
      const msg =
        "Default branch is not configured as an active location on the server (D365_BRANCH_ID GUID mapped to active location.d365_id).";
      if (fromPaymentModal) setPaymentError(msg);
      else setError(msg);
      return;
    }
    if (htbNeedsCustomerSelection) {
      const msg = "Select an HTB customer (credit application) before checkout.";
      if (fromPaymentModal) setPaymentError(msg);
      else setError(msg);
      return;
    }
    if (cartLines.length === 0) {
      const msg = "Add at least one item to the cart.";
      if (fromPaymentModal) setPaymentError(msg);
      else setError(msg);
      return;
    }
    if (multiStore && cartLines.some((l) => l.location_id == null || !Number.isInteger(l.location_id))) {
      const msg = "Each cart line needs a store. Try toggling multiple stores off and on to refresh lines.";
      if (fromPaymentModal) setPaymentError(msg);
      else setError(msg);
      return;
    }
    setCheckoutLoading(true);
    try {
      const payload = {
        customer_id:
          saleType === "htb"
            ? null
            : customerId === ""
              ? null
              : parseInt(customerId, 10),
        currency_id: parseInt(currencyId, 10),
        sale_type: saleType,
        ...(!multiStore && hasActiveDefaultLocation
          ? { location_id: defaultLocationId }
          : {}),
        items: cartLines.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          ...(multiStore ? { location_id: l.location_id } : {}),
        })),
        ...(saleType === "htb" && htbCreditSelection?.creditApplicationId
          ? {
              d365_credit_application_id: htbCreditSelection.creditApplicationId,
              d365_customer_guid: htbCreditSelection.customer365Guid,
            }
          : {}),
        ...(paymentPayload || {}),
      };
      const result = await api.pos.checkout(payload);
      setCompletedSaleTypeLabel(saleTypeLabel(saleType, saleTypes));
      setLastReceipt(result);
      setNextDocumentNumber(
        result?.nextDocumentNumber != null && String(result.nextDocumentNumber).trim() !== ""
          ? String(result.nextDocumentNumber).trim()
          : null
      );
      setPaymentModalOpen(false);
      setPaymentAmountsByMethod({});
      setPaymentReference("");
      clearCart();
      setHtbCreditSelection(null);
      persistHtbCreditSelection(null);
      setD365CreditSearch("");
      setD365CreditAppsListExpanded(true);
      setCustomerId(saleType === "cash" ? resolveDefaultCustomerId(customers) : "");
    } catch (e) {
      const msg = e.message || "Checkout failed";
      if (fromPaymentModal) setPaymentError(msg);
      else setError(msg);
    } finally {
      setCheckoutLoading(false);
    }
  }

  function handlePayClick() {
    if (checkoutDisabled) {
      // Emit detailed diagnostics immediately on click so operators can capture
      // the exact blocker even if the UI state changes right after.
      try {
        console.error("[POS checkout blocked]", {
          at: new Date().toISOString(),
          checkoutDebugInfo,
        });
      } catch {
        /* ignore */
      }
      setMissingCheckoutInfoOpen(true);
      return;
    }
    if (!displayPaymentMethods.length) {
      setPaymentError("No active payment methods found. Add at least one active method in payment_methods.");
      setPaymentModalOpen(true);
      return;
    }
    setError("");
    setPaymentError("");
    setPaymentModalOpen(true);
  }

  function closePaymentModal() {
    setPaymentModalOpen(false);
    setPaymentError("");
  }

  function submitPaymentAndCheckout() {
    const payments = [];
    for (const method of displayPaymentMethods) {
      const methodId = Number(method.id);
      if (!Number.isInteger(methodId) || methodId < 1) continue;
      const raw = paymentAmountsByMethod[String(method.id)];
      if (raw == null || String(raw).trim() === "") continue;
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount < 0) {
        setPaymentError(`Enter a valid amount for ${method.name}.`);
        return;
      }
      if (amount === 0) continue;
      payments.push({
        payment_method_id: methodId,
        amount: Number(amount.toFixed(2)),
        reference: paymentReference.trim() || null,
      });
    }
    if (!payments.length) {
      setPaymentError("Enter at least one payment amount greater than zero.");
      return;
    }
    const roundedAmount = Number(payments.reduce((s, p) => s + p.amount, 0).toFixed(2));
    const roundedSubtotal = Number(subtotal.toFixed(2));
    if (saleType === "htb" && roundedAmount > roundedSubtotal) {
      setPaymentError("HTB deposit cannot exceed invoice total. No change can be given on HTB sales.");
      return;
    }
    if (
      saleType === "htb" &&
      Number.isFinite(htbAllowedInstallmentAmount) &&
      Number.isFinite(htbResultingInstallmentAmount) &&
      htbResultingInstallmentAmount > htbAllowedInstallmentAmount
    ) {
      setPaymentError(
        `Resulting installment (${money(htbResultingInstallmentAmount)}) exceeds allowed installment (${money(
          htbAllowedInstallmentAmount
        )}). Increase the deposit amount.`
      );
      return;
    }
    if (saleType !== "htb" && roundedAmount < roundedSubtotal) {
      const remaining = Number((roundedSubtotal - roundedAmount).toFixed(2));
      setPaymentError(`Payments are short by ${money(remaining)}. Add more to complete this sale.`);
      return;
    }
    handleCheckout(payments.length === 1 ? { payment: payments[0] } : { payments });
  }

  return (
    <div className="page pos-page">
      <header className="page-header">
        <div className="pos-page-header-block">
          <div className="pos-page-header-title-row">
            <h1>Point of sale</h1>
            {headerBranchName || headerTerminalName ? (
              <span className="pos-header-location" title="Location and terminal">
                {headerBranchName ? <span className="pos-header-branch">{headerBranchName}</span> : null}
                {headerTerminalName ? (
                  <span className="pos-header-terminal-code">{headerTerminalName}</span>
                ) : null}
              </span>
            ) : null}
          </div>
          <p className="page-lead">Ring up sales; totals use catalog prices at checkout.</p>
        </div>
      </header>

      {error && !paymentModalOpen ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}
      {missingCheckoutInfoOpen ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>Checkout debug</h3>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {JSON.stringify(checkoutDebugInfo, null, 2)}
          </pre>
        </div>
      ) : null}

      {lastReceipt?.invoices?.length ? (
        <div className="alert pos-receipt" role="status">
          <strong>Sale recorded</strong>
          {completedSaleTypeLabel ? (
            <>
              {" "}
              (<span className="pos-receipt-sale-type">{completedSaleTypeLabel}</span>)
            </>
          ) : null}
          .{" "}
          {lastReceipt.invoices.length === 1 ? (
            <>
              Invoice <code>{lastReceipt.invoices[0].invoice?.invoice_number}</code> — total{" "}
              {money(lastReceipt.invoices[0].invoice?.total)}
            </>
          ) : (
            <>
              {lastReceipt.invoices.length} invoices (one per store):{" "}
              {lastReceipt.invoices.map((pack, i) => (
                <span key={pack.invoice?.id ?? i}>
                  {i > 0 ? "; " : null}
                  <code>{pack.invoice?.invoice_number}</code> ({money(pack.invoice?.total)})
                </span>
              ))}
              . Combined total{" "}
              <strong>
                {money(
                  lastReceipt.invoices.reduce(
                    (s, pack) => s + Number(pack.invoice?.total || 0),
                    0
                  )
                )}
              </strong>
            </>
          )}
        </div>
      ) : null}

      <div className="pos-shell">
        <div className="card pos-sale-type-row">
          <fieldset className="pos-sale-type pos-sale-type--bar">
            <legend className="pos-sale-type-bar-legend">Sale type</legend>
            <div className="pos-sale-type-radios">
              {saleTypes.map((opt) => (
                <label key={opt.value} className="pos-sale-type-option">
                  <input
                    type="radio"
                    name="pos-sale-type"
                    value={opt.value}
                    checked={saleType === opt.value}
                    onChange={() => setSaleType(opt.value)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
            <div className="pos-sale-type-current" aria-live="polite" aria-atomic="true">
              <span className="pos-sale-type-current-kicker">Selected</span>
              <span className="pos-sale-type-current-label">{saleTypeLabel(saleType, saleTypes)}</span>
            </div>
          </fieldset>
        </div>

        {saleType === "htb" ? (
        <section className="card pos-d365-credit" aria-labelledby="pos-d365-credit-heading">
          {d365Records.length > 0 ? (
            <button
              type="button"
              className="pos-d365-credit-collapse-tab"
              aria-expanded={d365CreditAppsListExpanded}
              aria-controls="pos-d365-credit-apps-panel"
              aria-label={
                d365CreditAppsListExpanded ? "Hide credit applications list" : "Show credit applications list"
              }
              title={
                d365CreditAppsListExpanded ? "Hide credit applications list" : "Show credit applications list"
              }
              onClick={() => setD365CreditAppsListExpanded((v) => !v)}
            >
              <span className="pos-d365-credit-collapse-tab-icon" aria-hidden>
                {d365CreditAppsListExpanded ? (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M6 15l6-6 6 6"
                      stroke="currentColor"
                      strokeWidth="2.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M6 9l6 6 6-6"
                      stroke="currentColor"
                      strokeWidth="2.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
            </button>
          ) : null}
          <div className="pos-d365-credit-head">
            <h2 id="pos-d365-credit-heading" className="pos-d365-credit-title">
              Credit applications
            </h2>
            <div className="pos-d365-credit-head-actions">
              <button
                type="button"
                className="btn btn-secondary pos-d365-refresh"
                onClick={() => loadD365CreditApps()}
                disabled={d365Loading}
              >
                {d365Loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>
          {d365Meta ? (
            <p className="muted pos-d365-meta">
              Filter: STATUS ={" "}
              {d365Meta.statusLabel ? (
                <strong>{d365Meta.statusLabel}</strong>
              ) : (
                <span>option {d365Meta.statusValue}</span>
              )}
              {d365Meta.branchName ? (
                <>
                  {" "}
                  · BRANCH = <strong>{d365Meta.branchName}</strong>
                </>
              ) : null}{" "}
              · {d365Meta.count} record{d365Meta.count === 1 ? "" : "s"}
            </p>
          ) : null}
          {d365Error ? (
            <p className="pos-d365-error" role="status">
              {d365Error}
            </p>
          ) : null}
          {!d365Error && !d365Loading && d365Records.length === 0 ? (
            <p className="muted">No matching credit applications.</p>
          ) : null}
          {d365Loading && !d365Records.length ? (
            <p className="muted">Loading from Dynamics 365…</p>
          ) : null}
          {!d365CreditAppsListExpanded && htbCreditSelection?.creditApplicationId ? (
            <p className="muted pos-d365-collapse-hint" role="status">
              Application list is hidden. Use the chevron at the top of this section to show the list and pick a
              different application.
            </p>
          ) : null}
          {d365Records.length > 0 ? (
            <div id="pos-d365-credit-apps-panel" hidden={!d365CreditAppsListExpanded}>
              <div className="pos-d365-toolbar">
                <input
                  className="input pos-search pos-d365-search"
                  type="search"
                  placeholder="Find by first name, last name, or national ID…"
                  value={d365CreditSearch}
                  onChange={(e) => setD365CreditSearch(e.target.value)}
                  aria-label="Filter credit applications by first name, last name, or national ID"
                />
              </div>
              {filteredD365CreditRecords.length === 0 ? (
                <p className="muted pos-d365-filter-empty">No applications match your search.</p>
              ) : (
                <div className="pos-d365-table-wrap">
                  <table className="pos-d365-table">
                    <thead>
                      <tr>
                        <th scope="col">Cap Number</th>
                        <th scope="col">First name</th>
                        <th scope="col">Last name</th>
                        <th scope="col">National ID</th>
                        <th scope="col">Address</th>
                        <th scope="col">Retail price</th>
                        <th scope="col">Maximum installment amount</th>
                        <th scope="col">number of installments (months)</th>
                        <th scope="col">Status</th>
                        <th scope="col">Approved date</th>
                        <th scope="col" className="pos-d365-col-actions">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredD365CreditRecords.map((row) => {
                        const selected =
                          htbCreditSelection &&
                          row.id != null &&
                          String(htbCreditSelection.creditApplicationId) === String(row.id);
                        return (
                        <tr
                          key={row.id || JSON.stringify(row.fields)}
                          className={selected ? "pos-d365-row--selected" : undefined}
                        >
                          <td>{row.capNumber != null && row.capNumber !== "" ? String(row.capNumber) : "—"}</td>
                          <td>{row.customerFirstName != null && row.customerFirstName !== "" ? String(row.customerFirstName) : "—"}</td>
                          <td>{row.customerLastName != null && row.customerLastName !== "" ? String(row.customerLastName) : "—"}</td>
                          <td>{row.customerNationalId != null && row.customerNationalId !== "" ? String(row.customerNationalId) : "—"}</td>
                          <td className="pos-d365-address">
                            {row.customerAddress != null && row.customerAddress !== "" ? String(row.customerAddress) : "—"}
                          </td>
                          <td>{money(row.retailPrice)}</td>
                          <td>{money(row.installmentAmount)}</td>
                          <td>{row.numberOfInstallmentsMonths ?? "—"}</td>
                          <td>{row.statusLabel ?? String(row.status ?? "—")}</td>
                          <td className="pos-d365-date">
                            {row.approvedDate
                              ? new Date(row.approvedDate).toLocaleString()
                              : "—"}
                          </td>
                          <td className="pos-d365-col-actions">
                            <button
                              type="button"
                              className={
                                selected
                                  ? "btn btn-sm pos-d365-select-btn pos-d365-select-btn--selected"
                                  : "btn btn-sm pos-d365-select-btn"
                              }
                              onClick={() => {
                                const sel = {
                                  creditApplicationId: String(row.id),
                                  customer365Guid:
                                    row.customer365Guid != null && String(row.customer365Guid).trim() !== ""
                                      ? String(row.customer365Guid).trim()
                                      : null,
                                  customerDisplayName: formatHtbCreditCustomerName(row),
                                  capNumber:
                                    row.capNumber != null && String(row.capNumber).trim() !== ""
                                      ? String(row.capNumber).trim()
                                      : null,
                                  retailPrice: row.retailPrice ?? null,
                                  installmentAmount: row.installmentAmount ?? null,
                                  numberOfInstallmentsMonths: row.numberOfInstallmentsMonths ?? null,
                                  insuranceRate: row.insuranceRate ?? null,
                                  interestRate: row.interestRate ?? null,
                                  funeralRate: row.funeralRate ?? null,
                                };
                                setHtbCreditSelection(sel);
                                persistHtbCreditSelection(sel);
                                setD365CreditAppsListExpanded(false);
                              }}
                            >
                              {selected ? "Selected" : "Select"}
                            </button>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </section>
        ) : null}

        <div className="pos-main-columns">
          <section className="card pos-catalog">
          <div className="pos-catalog-toolbar">
            <input
              className="input pos-search"
              type="search"
              placeholder="Search code, name, barcode, or category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search products"
            />
            <label className="pos-multi-store-toggle">
              <input
                type="checkbox"
                checked={multiStore}
                onChange={(e) => applyMultiStore(e.target.checked)}
              />
              <span>Multiple stores</span>
            </label>
          </div>
          {!loading && categoryOptions.length > 0 ? (
            <div className="pos-category-bar" role="toolbar" aria-label="Filter by category">
              <button
                type="button"
                className={`pos-category-chip${categoryFilter === "" ? " pos-category-chip--active" : ""}`}
                onClick={() => setCategoryFilter("")}
              >
                All
              </button>
              {categoryOptions.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`pos-category-chip${
                    categoryFilter === opt.key ? " pos-category-chip--active" : ""
                  }`}
                  onClick={() => setCategoryFilter(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : null}
          {loading ? (
            <p className="muted">Loading…</p>
          ) : filteredProducts.length === 0 ? (
            <p className="muted pos-grid-empty">No matching products with a price.</p>
          ) : productGroups ? (
            <div className="pos-product-groups">
              {productGroups.map((g) => (
                <div key={g.key} className="pos-product-group">
                  <h3 className="pos-product-group-title">{g.title}</h3>
                  <div className="pos-product-grid pos-product-grid--section">
                    {g.items.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="pos-product-tile"
                        disabled={htbNeedsCustomerSelection}
                        onClick={() => beginAddProduct(p)}
                      >
                        <span className="pos-product-name">{p.name}</span>
                        <span className="pos-product-meta">
                          <code>{p.code}</code>
                          <span className="pos-product-price">{money(p.unit_price)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="pos-product-grid">
              {filteredProducts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="pos-product-tile"
                  disabled={htbNeedsCustomerSelection}
                  onClick={() => beginAddProduct(p)}
                >
                  <span className="pos-product-name">{p.name}</span>
                  <span className="pos-product-meta">
                    <code>{p.code}</code>
                    <span className="pos-product-price">{money(p.unit_price)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

          <aside className="card pos-cart">
            <h2 className="pos-cart-title">Current sale</h2>
            <div className="pos-next-doc" aria-live="polite">
              <span className="pos-next-doc-label">Next document no.</span>
              <code className="pos-next-doc-value">{nextDocumentNumber || "—"}</code>
            </div>
            {saleType === "htb" ? (
              <div
                className={`pos-htb-selection${htbCreditSelection ? " pos-htb-selection--active" : ""}`}
                aria-live="polite"
              >
                <div className="pos-htb-selection-head">
                  <span className="pos-htb-selection-label">HTB customer</span>
                  {htbCreditSelection ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm pos-htb-selection-clear"
                      onClick={() => {
                        setHtbCreditSelection(null);
                        persistHtbCreditSelection(null);
                        setD365CreditAppsListExpanded(true);
                      }}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                {htbCreditSelection ? (
                  <div className="pos-htb-selection-body">
                    <dl className="pos-htb-selection-meta">
                      <div>
                        <dt>ID</dt>
                        <dd>
                          {htbCreditSelection.customer365Guid ? (
                            <code className="pos-htb-guid" title={htbCreditSelection.customer365Guid}>
                              {htbCreditSelection.customer365Guid}
                            </code>
                          ) : (
                            <span className="muted">Not available from API</span>
                          )}
                        </dd>
                      </div>
                    </dl>
                    <p className="pos-htb-selection-name">{htbCreditSelection.customerDisplayName}</p>
                    <dl className="pos-htb-selection-meta pos-htb-selection-meta--amounts">
                      <div>
                        <dt>Cap number</dt>
                        <dd>{htbCreditSelection.capNumber ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Number of installments (months)</dt>
                        <dd>{htbCreditSelection.numberOfInstallmentsMonths ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Retail price</dt>
                        <dd>{money(htbCreditSelection.retailPrice)}</dd>
                      </div>
                      <div>
                        <dt>Maximum installment amount</dt>
                        <dd>{money(htbCreditSelection.installmentAmount)}</dd>
                      </div>
                    </dl>
                  </div>
                ) : (
                  <p className="muted pos-htb-selection-empty">
                    Select a credit application above to attach this sale to a D365 customer.
                  </p>
                )}
              </div>
            ) : null}
            <label className="field">
              <span className="field-label">Currency</span>
              <select
                className="input"
                value={currencyId}
                onChange={(e) => setCurrencyId(e.target.value)}
                required
              >
                <option value="">— Select currency —</option>
                {currencies.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.code}
                    {c.symbol ? ` (${c.symbol})` : ""}
                    {c.is_default ? " · default" : ""}
                  </option>
                ))}
              </select>
            </label>
            {saleType !== "htb" ? (
              <label className="field">
                <span className="field-label">Customer</span>
                <select
                  className="input"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  required
                >
                  <option value="">— Select customer —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name || `Customer #${c.id}`}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="pos-cart-lines">
              {cartLines.length === 0 ? (
                <p className="muted">
                  {htbNeedsCustomerSelection
                    ? "Select an HTB customer above, then add products from the catalog."
                    : "Cart is empty. Tap a product to add."}
                </p>
              ) : (
                cartLines.map((line) => (
                  <div key={line.cart_key} className="pos-line">
                    <div className="pos-line-info">
                      <div className="pos-line-name">{line.name}</div>
                      <div className="pos-line-sub">
                        <code>{line.code}</code> × {money(line.unit_price)}
                        {multiStore && line.location_label ? (
                          <>
                            {" "}
                            · <span className="pos-line-store">{line.location_label}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="pos-line-actions">
                      <input
                        className="input pos-qty"
                        type="number"
                        min="1"
                        step="1"
                        value={line.quantity}
                        onChange={(e) => setLineQuantity(line.cart_key, e.target.value)}
                        aria-label={`Quantity for ${line.name}`}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => removeLine(line.cart_key)}
                        aria-label={`Remove ${line.name}`}
                      >
                        ×
                      </button>
                    </div>
                    <div className="pos-line-total">{money(lineTotalWithVat(line))}</div>
                  </div>
                ))
              )}
            </div>

            <div className="pos-cart-footer">
              <div className="pos-subtotal">
                <span>Subtotal</span>
                <strong>{money(subTotalBeforeVat)}</strong>
              </div>
              <div className="pos-subtotal">
                <span>VAT</span>
                <strong>{money(vatTotal)}</strong>
              </div>
              <div className="pos-subtotal">
                <span>Total</span>
                <strong>{money(subtotal)}</strong>
              </div>
              <div className="pos-cart-buttons">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={cartLines.length === 0 || checkoutLoading}
                  onClick={clearCart}
                >
                  Clear
                </button>
                <span
                  className="pos-pay-wrap"
                >
                  <button
                    type="button"
                    className="btn btn-primary pos-pay"
                    disabled={checkoutLoading}
                    aria-disabled={checkoutDisabled}
                    onClick={handlePayClick}
                    aria-label={
                      checkoutDisabled
                        ? "Complete sale (disabled). Show missing information."
                        : "Complete sale"
                    }
                    title={
                      checkoutDisabled
                        ? "Click to see what's missing"
                        : undefined
                    }
                  >
                    {checkoutLoading ? "Processing…" : "Complete sale"}
                  </button>
                </span>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <Modal
        title="Can't complete sale yet"
        isOpen={missingCheckoutInfoOpen}
        onClose={() => setMissingCheckoutInfoOpen(false)}
        footer={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setMissingCheckoutInfoOpen(false)}
          >
            OK
          </button>
        }
      >
        {missingCheckoutItems.length ? (
          <>
            <p style={{ marginTop: 0 }}>
              Please complete the following before checkout:
            </p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {missingCheckoutItems.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </>
        ) : (
          <p style={{ margin: 0 }}>All required information is present.</p>
        )}
      </Modal>

      <Modal
        title="Select store"
        isOpen={Boolean(pickProduct)}
        onClose={() => setPickProduct(null)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setPickProduct(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={htbNeedsCustomerSelection}
              onClick={confirmPickStore}
            >
              Add to cart
            </button>
          </>
        }
      >
        {pickProduct ? (
          <div className="form-grid">
            <p className="muted" style={{ margin: 0 }}>
              Choose which store this product is picked from.
            </p>
            <p style={{ margin: 0 }}>
              <strong>{pickProduct.name}</strong> <code>{pickProduct.code}</code>
            </p>
            <label className="field">
              <span className="field-label">Store</span>
              <select
                className="input"
                value={pickStoreId}
                onChange={(e) => setPickStoreId(e.target.value)}
              >
                <option value="">— Select —</option>
                {locations.map((l) => (
                  <option key={l.id} value={String(l.id)}>
                    {l.name || l.code || `Location #${l.id}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </Modal>

      <Modal
        title={saleType === "htb" ? "Take a deposit" : "Take payment"}
        isOpen={paymentModalOpen}
        onClose={closePaymentModal}
        panelClassName="modal-panel--payment"
        footer={
          <>
            <button
              type="button"
              className="btn btn-danger pos-payment-cancel"
              onClick={closePaymentModal}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary pos-payment-confirm"
              disabled={checkoutLoading || htbInstallmentOutOfRange}
              onClick={submitPaymentAndCheckout}
            >
              {checkoutLoading ? "Processing…" : "Confirm payment"}
            </button>
          </>
        }
      >
        <div className="form-grid pos-payment-modal">
          {paymentError ? (
            <div className="alert alert-error" role="alert">
              {paymentError}
            </div>
          ) : null}
          <p className="muted pos-payment-modal-intro" style={{ margin: 0 }}>
            {saleType === "htb"
              ? "Record one or more deposit amounts before completing the sale. Confirming is allowed only when the resulting installment is within the approved installment amount."
              : "Record one or more payment amounts before completing the sale."}
          </p>
          <div className="pos-payment-grid" role="table" aria-label="Payment method amounts">
            <div className="pos-payment-grid-head" role="row">
              <span role="columnheader">Payment method</span>
              <span role="columnheader">Amount</span>
            </div>
            {displayPaymentMethods.map((method) => (
              <label key={method.id} className="pos-payment-grid-row" role="row">
                <span className="pos-payment-grid-method" role="cell">
                  {method.name}
                </span>
                <span role="cell">
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={paymentAmountsByMethod[String(method.id)] ?? ""}
                    onChange={(e) =>
                      setPaymentAmountsByMethod((prev) => ({
                        ...prev,
                        [String(method.id)]: e.target.value,
                      }))
                    }
                    placeholder="0.00"
                    aria-label={`${method.name} amount`}
                  />
                </span>
              </label>
            ))}
          </div>
          <label className="field">
            <span className="field-label">Reference (optional)</span>
            <input
              className="input"
              type="text"
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              placeholder="Receipt / transaction id"
            />
          </label>
          <div className="pos-payment-summary" aria-live="polite">
            <p className="muted" style={{ margin: 0 }}>
              Invoice value: <strong>{money(subtotal)}</strong>
            </p>
            {saleType === "htb" ? (
              <p className="muted" style={{ margin: 0 }}>
                Approved installment amount: <strong>{money(htbAllowedInstallmentAmount)}</strong>
              </p>
            ) : null}
            {saleType === "htb" ? (
              <p
                className={`muted${htbInstallmentOutOfRange ? " pos-payment-summary-alert" : ""}`}
                style={{ margin: 0 }}
              >
                Actual installment amount: <strong>{money(htbResultingInstallmentAmount)}</strong>
              </p>
            ) : null}
            <p
              className={`muted${htbInstallmentOutOfRange ? " pos-payment-summary-alert" : ""}`}
              style={{ margin: 0 }}
            >
              {saleType === "htb" ? "Actual deposit" : "Total payments applied"}:{" "}
              <strong>{money(totalPaymentsApplied)}</strong>
            </p>
            {saleType === "htb" ? (
              <p className="muted" style={{ margin: 0 }}>
                Loan applied: <strong>{money(loanApplied)}</strong>
              </p>
            ) : null}
            {saleType !== "htb" && paymentShortfall > 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Amount remaining: <strong>{money(paymentShortfall)}</strong>
              </p>
            ) : null}
            {saleType !== "htb" && paymentChangeDue > 0 ? (
              <p className="muted pos-payment-summary-change" style={{ margin: 0 }}>
                Change due: <strong>{money(paymentChangeDue)}</strong>
              </p>
            ) : null}
          </div>
        </div>
      </Modal>
    </div>
  );
}
