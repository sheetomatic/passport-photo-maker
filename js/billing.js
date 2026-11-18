/**
 * billing.js — email/password PPM accounts, export licensing, Razorpay
 * subscriptions and invoices.
 *
 * The app talks to the Sheetomatic Workspace API already running on GCP:
 * same-origin /api/ppm on ppm.sheetomatic.com (Caddy proxies it to the
 * sheetomatic container). Billing only activates on the production PPM host,
 * keeping the GitHub Pages preview and automated tests free.
 */

const SESSION_KEY = "ppm.billing.session.v1";
const DEFAULT_API = "/api/ppm";
const PRODUCTION_HOSTS = new Set([
  "ppm.sheetomatic.com",
  "ppm.8.234.99.111.sslip.io",
]);

const $ = (id) => document.getElementById(id);

export function createBilling({ toast = () => {} } = {}) {
  const els = {
    account: $("btnAccount"),
    strip: $("billingStrip"),
    stripText: $("billingStripText"),
    openBilling: $("btnOpenBilling"),
    dialog: $("billingDialog"),
    close: $("btnCloseBilling"),
    title: $("billingTitle"),
    sub: $("billingSub"),
    price: $("billingPrice"),
    period: $("billingPeriod"),
    error: $("billingError"),
    auth: $("billingAuth"),
    tabLogin: $("tabLogin"),
    tabRegister: $("tabRegister"),
    loginForm: $("billingLoginForm"),
    loginEmail: $("loginEmail"),
    loginPassword: $("loginPassword"),
    registerForm: $("billingRegisterForm"),
    registerName: $("registerName"),
    registerEmail: $("registerEmail"),
    registerPassword: $("registerPassword"),
    registerTerms: $("registerTerms"),
    signedIn: $("billingSignedIn"),
    accountLabel: $("billingAccount"),
    status: $("billingStatus"),
    subscribe: $("btnSubscribe"),
    noInvoices: $("billingNoInvoices"),
    invoiceList: $("billingInvoiceList"),
    cancel: $("btnCancelSubscription"),
    signOut: $("btnSignOut"),
  };

  const state = {
    initialized: false,
    eligible: false,
    enabled: false,
    config: null,
    token: null,
    account: null,
    access: null,
    invoices: [],
    authMode: "login",
    busy: false,
  };

  let razorpayScript = null;

  const apiBase = () => window.__PPM_BILLING_API__ || DEFAULT_API;

  function eligibleHost() {
    const force =
      window.__PPM_BILLING_FORCE__ === true ||
      new URLSearchParams(window.location.search).get("ppm_billing") === "on";
    return force || PRODUCTION_HOSTS.has(window.location.hostname);
  }

  function readToken() {
    try {
      return window.localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  }

  function writeToken(token) {
    try {
      if (token) window.localStorage.setItem(SESSION_KEY, token);
      else window.localStorage.removeItem(SESSION_KEY);
    } catch {
      /* storage can be unavailable in private modes */
    }
  }

  function setError(message) {
    if (!els.error) return;
    els.error.textContent = message || "";
    els.error.hidden = !message;
  }

  async function api(path, { method = "GET", body, auth = true } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;

    const response = await fetch(`${apiBase()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      if (response.status === 401 && state.token && path !== "/auth/login") {
        clearSession();
      }
      const error = new Error(
        (data && typeof data.error === "string" && data.error) ||
          "The subscription service could not complete that request.",
      );
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async function loadConfig() {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(`${apiBase()}/config`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data && data.enabled === true ? data : null;
    } catch {
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function clearSession() {
    state.token = null;
    state.account = null;
    state.access = null;
    state.invoices = [];
    writeToken(null);
    render();
  }

  async function restoreSession() {
    if (!state.token) return;
    try {
      const data = await api("/me");
      state.account = data.account ?? null;
      state.access = data.access ?? null;
      await loadInvoices();
    } catch (error) {
      if (error.status === 401) clearSession();
    }
    render();
  }

  async function loadInvoices() {
    if (!state.token) {
      state.invoices = [];
      renderInvoices();
      return;
    }
    try {
      const data = await api("/billing/invoices");
      state.invoices = Array.isArray(data.invoices) ? data.invoices : [];
    } catch {
      state.invoices = [];
    }
    renderInvoices();
  }

  function planLabel() {
    const amount = state.config?.price?.amountPaise;
    return typeof amount === "number" && Number.isFinite(amount)
      ? `₹${Math.round(amount / 100)}`
      : "₹100";
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      : "";
  }

  function formatAmount(paise, currency = "INR") {
    return `${currency === "INR" ? "₹" : `${currency} `}${(paise / 100).toFixed(2)}`;
  }

  function setAuthMode(mode) {
    state.authMode = mode === "register" ? "register" : "login";
    if (els.tabLogin) {
      els.tabLogin.classList.toggle("is-active", state.authMode === "login");
      els.tabLogin.setAttribute("aria-selected", String(state.authMode === "login"));
    }
    if (els.tabRegister) {
      els.tabRegister.classList.toggle("is-active", state.authMode === "register");
      els.tabRegister.setAttribute("aria-selected", String(state.authMode === "register"));
    }
    if (els.loginForm) els.loginForm.hidden = state.authMode !== "login";
    if (els.registerForm) els.registerForm.hidden = state.authMode !== "register";
    setError("");
    const field = state.authMode === "login" ? els.loginEmail : els.registerName;
    window.setTimeout(() => field?.focus(), 60);
  }

  function renderInvoices() {
    if (!els.invoiceList || !els.noInvoices) return;
    if (!state.invoices.length) {
      els.noInvoices.hidden = false;
      els.invoiceList.replaceChildren();
      return;
    }
    els.noInvoices.hidden = true;
    const items = state.invoices.map((invoice) => {
      const li = document.createElement("li");
      li.className = "billing-invoice";
      const copy = document.createElement("div");
      copy.className = "billing-invoice-copy";
      const title = document.createElement("strong");
      title.textContent = `${formatAmount(invoice.amountPaise, invoice.currency)} · ${invoice.invoiceNumber}`;
      const meta = document.createElement("span");
      meta.textContent = `${formatDate(invoice.paidAt || invoice.createdAt)} · ${invoice.status}`;
      copy.append(title, meta);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Invoice PDF";
      button.addEventListener("click", () => downloadInvoice(invoice));
      li.append(copy, button);
      return li;
    });
    els.invoiceList.replaceChildren(...items);
  }

  function render() {
    if (!state.enabled) {
      if (els.account) els.account.hidden = true;
      if (els.strip) els.strip.hidden = true;
      return;
    }

    if (els.price) els.price.textContent = planLabel();
    if (els.period) els.period.textContent = "/ month";

    if (els.account) {
      els.account.hidden = false;
      els.account.textContent = state.access?.isPro
        ? "Pro"
        : state.token
          ? "Account"
          : "Sign in";
      els.account.classList.toggle("is-pro", Boolean(state.access?.isPro));
    }

    if (els.strip) {
      els.strip.hidden = false;
      els.strip.classList.toggle("is-pro", Boolean(state.access?.isPro));
      if (els.stripText) {
        if (!state.token) {
          els.stripText.textContent = "Sign in or create an account to export";
        } else if (!state.access) {
          els.stripText.textContent = "Loading your account…";
        } else if (state.access.isPro) {
          els.stripText.textContent = "Unlimited exports · subscription active";
        } else if ((state.access.freeExportsRemaining ?? 0) > 0) {
          els.stripText.textContent = "1 free export remaining";
        } else {
          els.stripText.textContent = "Free export used · subscribe to keep exporting";
        }
      }
      if (els.openBilling) {
        els.openBilling.textContent = state.access?.isPro ? "Manage" : "₹100/month";
      }
    }

    if (els.auth) els.auth.hidden = Boolean(state.token);
    if (els.signedIn) els.signedIn.hidden = !state.token;
    if (els.loginForm) els.loginForm.hidden = state.authMode !== "login";
    if (els.registerForm) els.registerForm.hidden = state.authMode !== "register";

    if (state.token && els.accountLabel) {
      els.accountLabel.textContent =
        state.account?.name && state.account?.email
          ? `${state.account.name} · ${state.account.email}`
          : state.account?.email || "Signed in";

      const isPro = Boolean(state.access?.isPro);
      const cancelAtPeriodEnd = Boolean(state.access?.subscription?.cancelAtPeriodEnd);
      if (isPro) {
        const end = state.access?.subscription?.currentEnd
          ? new Date(state.access.subscription.currentEnd)
          : null;
        els.status.textContent = cancelAtPeriodEnd
          ? `Subscription cancels on ${end ? formatDate(end) : "the next billing date"}.`
          : end && Number.isFinite(end.getTime())
            ? `Subscription active · renews ${formatDate(end)}`
            : "Subscription active · unlimited exports";
      } else if (!state.access) {
        els.status.textContent = "Loading your account…";
      } else if ((state.access.freeExportsRemaining ?? 0) > 0) {
        els.status.textContent = "Your one free export is available.";
      } else {
        els.status.textContent = "Your free export has been used.";
      }

      if (els.subscribe) {
        els.subscribe.hidden = isPro;
        els.subscribe.textContent = `Subscribe for ${planLabel()}/month`;
      }
      if (els.cancel) {
        els.cancel.hidden = !isPro || cancelAtPeriodEnd;
      }
      if (els.signOut) els.signOut.hidden = false;
      renderInvoices();
    }

    if (els.title && els.sub) {
      if (!state.token) {
        els.title.textContent = "Sign in to export";
        els.sub.textContent = "Create an account for one free export, then ₹100/month.";
      } else if (state.access?.isPro) {
        els.title.textContent = "Your account";
        els.sub.textContent = "Subscription, payment and invoices.";
      } else if ((state.access?.freeExportsRemaining ?? 0) > 0) {
        els.title.textContent = "Use your free export";
        els.sub.textContent = "One export is included, then ₹100/month.";
      } else {
        els.title.textContent = "Keep exporting";
        els.sub.textContent = "Your free export has been used. Subscribe for unlimited exports.";
      }
    }
  }

  function openDialog() {
    if (!state.enabled || !els.dialog) return;
    setError("");
    render();
    if (state.token) void loadInvoices();
    if (!els.dialog.open) {
      if (typeof els.dialog.showModal === "function") els.dialog.showModal();
      else els.dialog.setAttribute("open", "");
    }
    if (!state.token) {
      window.setTimeout(() => {
        (state.authMode === "login" ? els.loginEmail : els.registerName)?.focus();
      }, 80);
    }
  }

  function closeDialog() {
    if (!els.dialog) return;
    if (els.dialog.open) els.dialog.close();
    else els.dialog.removeAttribute("open");
  }

  function finishAuth(data, message) {
    state.token = data.token;
    state.account = data.account ?? null;
    state.access = data.access ?? null;
    state.authMode = "login";
    state.busy = false;
    writeToken(state.token);
    render();
    void loadInvoices();
    toast(message, "success", 4500);
  }

  async function login(event) {
    event?.preventDefault();
    setError("");
    if (state.busy) return;
    const email = els.loginEmail?.value?.trim() ?? "";
    const password = els.loginPassword?.value ?? "";
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    state.busy = true;
    const button = $("btnLogin");
    if (button) {
      button.disabled = true;
      button.textContent = "Signing in…";
    }
    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: { email, password },
        auth: false,
      });
      finishAuth(data, "Signed in.");
    } catch (error) {
      setError(error.message || "Could not sign in.");
    } finally {
      state.busy = false;
      if (button) {
        button.disabled = false;
        button.textContent = "Sign in";
      }
    }
  }

  async function register(event) {
    event?.preventDefault();
    setError("");
    if (state.busy) return;
    const name = els.registerName?.value?.trim() ?? "";
    const email = els.registerEmail?.value?.trim() ?? "";
    const password = els.registerPassword?.value ?? "";
    const acceptTerms = Boolean(els.registerTerms?.checked);
    if (!name || !email || !password) {
      setError("Fill in your name, email and password.");
      return;
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError("Use at least 8 characters with a letter and a number.");
      return;
    }
    if (!acceptTerms) {
      setError("Accept the terms to create an account.");
      return;
    }
    state.busy = true;
    const button = $("btnRegister");
    if (button) {
      button.disabled = true;
      button.textContent = "Creating account…";
    }
    try {
      const data = await api("/auth/register", {
        method: "POST",
        body: { name, email, password, acceptTerms },
        auth: false,
      });
      finishAuth(data, "Account created. You can use your free export.");
    } catch (error) {
      if (error.status === 409) {
        setAuthMode("login");
        if (els.loginEmail) els.loginEmail.value = email;
        setError("That email already has an account. Sign in instead.");
      } else {
        setError(error.message || "Could not create the account.");
      }
    } finally {
      state.busy = false;
      if (button) {
        button.disabled = false;
        button.textContent = "Create account";
      }
    }
  }

  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve(window.Razorpay);
    if (razorpayScript) return razorpayScript;
    razorpayScript = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => resolve(window.Razorpay);
      script.onerror = () => {
        razorpayScript = null;
        reject(new Error("Razorpay checkout could not load. Check your connection."));
      };
      document.head.appendChild(script);
    });
    return razorpayScript;
  }

  async function verifyCheckout(response) {
    try {
      await api("/billing/verify", {
        method: "POST",
        body: {
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_subscription_id: response.razorpay_subscription_id,
          razorpay_signature: response.razorpay_signature,
        },
      });
      await restoreSession();
      await loadInvoices();
      render();
      closeDialog();
      toast("Subscription active. Your invoice is in the account panel.", "success", 6500);
    } catch (error) {
      setError(error.message || "Payment could not be verified yet.");
      toast("Payment received, but verification failed. Contact support.", "error", 7000);
    }
  }

  async function subscribe() {
    if (!state.token) {
      openDialog();
      return;
    }
    setError("");
    if (state.busy) return;
    state.busy = true;
    if (els.subscribe) {
      els.subscribe.disabled = true;
      els.subscribe.textContent = "Opening Razorpay…";
    }
    try {
      const data = await api("/billing/subscribe", { method: "POST" });
      const Razorpay = await loadRazorpay();
      const checkout = new Razorpay({
        key: data.keyId,
        subscription_id: data.subscriptionId,
        name: data.name || "Passport Photo Maker",
        description: data.description || "₹100/month",
        prefill: data.prefill,
        theme: { color: "#1d1d1f" },
        handler: verifyCheckout,
        modal: {
          ondismiss: () => {
            state.busy = false;
            if (els.subscribe) {
              els.subscribe.disabled = false;
              els.subscribe.textContent = `Subscribe for ${planLabel()}/month`;
            }
          },
        },
      });
      checkout.open();
    } catch (error) {
      setError(error.message || "Checkout could not start.");
    } finally {
      state.busy = false;
      if (els.subscribe) {
        els.subscribe.disabled = false;
        els.subscribe.textContent = `Subscribe for ${planLabel()}/month`;
      }
    }
  }

  async function cancelSubscription() {
    if (!state.token || !state.access?.isPro) return;
    if (!window.confirm("Cancel the subscription at the end of the current billing period?")) {
      return;
    }
    setError("");
    const button = els.cancel;
    if (button) {
      button.disabled = true;
      button.textContent = "Cancelling…";
    }
    try {
      const data = await api("/billing/cancel", { method: "POST" });
      state.access = data.access ?? state.access;
      render();
      toast("Subscription will cancel at the end of the current period.", "success", 6000);
    } catch (error) {
      setError(error.message || "Could not cancel the subscription.");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Cancel subscription";
      }
    }
  }

  function downloadInvoice(invoice) {
    const JsPDF = window.jspdf?.jsPDF;
    if (!JsPDF) {
      toast("The invoice PDF library is unavailable.", "error");
      return;
    }
    const doc = new JsPDF({ unit: "mm", format: "a4" });
    const left = 18;
    let y = 20;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Passport Photo Maker", left, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text("A product of Sheetomatic · sheetomatic.com", left, y);
    y += 12;
    doc.setTextColor(30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Payment receipt / invoice", left, y);
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Invoice: ${invoice.invoiceNumber}`, left, y);
    doc.text(`Date: ${formatDate(invoice.paidAt || invoice.createdAt)}`, left + 95, y);
    y += 6;
    doc.text(`Status: ${invoice.status}`, left, y);
    doc.text(`Currency: ${invoice.currency}`, left + 95, y);
    y += 12;
    doc.setFont("helvetica", "bold");
    doc.text("Billed to", left, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.text(state.account?.name || "Customer", left, y);
    y += 5;
    doc.text(state.account?.email || "", left, y);
    y += 12;
    doc.setDrawColor(220);
    doc.line(left, y, 192, y);
    y += 7;
    doc.setFont("helvetica", "bold");
    doc.text("Description", left, y);
    doc.text("Amount", 160, y, { align: "right" });
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.text(invoice.description || "Passport Photo Maker subscription — monthly", left, y, {
      maxWidth: 125,
    });
    doc.text(formatAmount(invoice.amountPaise, invoice.currency), 160, y, { align: "right" });
    y += 12;
    doc.line(left, y, 192, y);
    y += 7;
    doc.setFont("helvetica", "bold");
    doc.text("Total paid", left, y);
    doc.text(formatAmount(invoice.amountPaise, invoice.currency), 160, y, { align: "right" });
    y += 18;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(
      "This is a computer-generated payment receipt. GST/tax treatment is as applicable.",
      left,
      y,
    );
    y += 4;
    doc.text("For billing support: founder@sheetomatic.com", left, y);
    doc.save(`ppm-invoice-${invoice.invoiceNumber}.pdf`);
  }

  async function authorizeExport() {
    if (!state.enabled) return true;
    if (!state.token) {
      openDialog();
      toast("Sign in or create an account to use your free export.", "success", 5000);
      return false;
    }
    if (!state.access) await restoreSession();
    if (!state.access?.canExport) {
      openDialog();
      toast("Your free export has been used. Subscribe for unlimited exports.", "error", 6000);
      return false;
    }
    if (state.busy) return false;
    state.busy = true;
    try {
      const data = await api("/exports/claim", { method: "POST" });
      state.access = data.access ?? state.access;
      render();
      if (data.kind === "free") {
        toast("Free export used. Subscribe for unlimited exports.", "success", 5000);
      }
      return true;
    } catch (error) {
      if (error.status === 402) {
        state.access = error.data?.access ?? state.access;
        render();
        openDialog();
        toast("Your free export has been used. Subscribe for ₹100/month.", "error", 6000);
      } else {
        toast(error.message || "The export could not be authorised.", "error", 6000);
      }
      return false;
    } finally {
      state.busy = false;
    }
  }

  async function signOut() {
    clearSession();
    closeDialog();
    toast("Signed out.", "success", 3000);
  }

  function bind() {
    els.account?.addEventListener("click", openDialog);
    els.openBilling?.addEventListener("click", openDialog);
    els.close?.addEventListener("click", closeDialog);
    els.tabLogin?.addEventListener("click", () => setAuthMode("login"));
    els.tabRegister?.addEventListener("click", () => setAuthMode("register"));
    els.loginForm?.addEventListener("submit", login);
    els.registerForm?.addEventListener("submit", register);
    els.subscribe?.addEventListener("click", () => void subscribe());
    els.cancel?.addEventListener("click", () => void cancelSubscription());
    els.signOut?.addEventListener("click", () => void signOut());
    els.dialog?.addEventListener("click", (event) => {
      if (event.target === els.dialog) closeDialog();
    });
    els.dialog?.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialog();
    });
  }

  async function init() {
    if (state.initialized) return;
    state.initialized = true;
    state.eligible = eligibleHost();
    if (!state.eligible) return;
    bind();
    const config = await loadConfig();
    if (!config) return;
    state.config = config;
    state.enabled = true;
    state.token = readToken();
    render();
    if (state.token) await restoreSession();
  }

  return {
    init,
    authorizeExport,
    openDialog,
    refresh: restoreSession,
  };
}
