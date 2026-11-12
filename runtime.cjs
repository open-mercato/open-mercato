var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// runtime.ts
var runtime_exports = {};
__export(runtime_exports, {
  TenantDataEncryptionError: () => TenantDataEncryptionError,
  TenantDataEncryptionErrorCode: () => TenantDataEncryptionErrorCode,
  createKmsService: () => createKmsService,
  decryptWithAesGcm: () => decryptWithAesGcm,
  decryptWithAesGcmStrict: () => decryptWithAesGcmStrict,
  encryptWithAesGcm: () => encryptWithAesGcm,
  generateDek: () => generateDek,
  hashForLookup: () => hashForLookup,
  isEncryptedPayloadShape: () => isEncryptedPayloadShape,
  legacyHashForLookup: () => legacyHashForLookup,
  looksLikeEncryptedPayload: () => looksLikeEncryptedPayload,
  lookupHashCandidates: () => lookupHashCandidates
});
module.exports = __toCommonJS(runtime_exports);

// ../../../../private/tmp/om-continue-pr-8377/packages/shared/src/lib/encryption/aes.ts
var import_node_crypto = __toESM(require("node:crypto"), 1);

// ../../../../private/tmp/om-continue-pr-8377/packages/shared/src/lib/boolean.ts
var TRUE_VALUES = /* @__PURE__ */ new Set(["1", "true", "yes", "y", "on", "enable", "enabled"]);
var FALSE_VALUES = /* @__PURE__ */ new Set(["0", "false", "no", "n", "off", "disable", "disabled"]);
function parseBooleanToken(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

// ../../../../private/tmp/om-continue-pr-8377/packages/shared/src/lib/encryption/toggles.ts
function isTenantDataEncryptionEnabled() {
  const rawEnv = process.env.TENANT_DATA_ENCRYPTION;
  if (rawEnv === void 0) return true;
  const trimmed = rawEnv.trim();
  if (!trimmed) return true;
  const parsed = parseBooleanToken(trimmed);
  return parsed === null ? true : parsed;
}
function isEncryptionDebugEnabled() {
  const parsed = parseBooleanToken(process.env.TENANT_DATA_ENCRYPTION_DEBUG ?? "");
  return parsed === true;
}

// ../../../../private/tmp/om-continue-pr-8377/packages/shared/src/lib/logger/level.ts
var OM_LOG_LEVEL_ENV = "OM_LOG_LEVEL";
var LOG_LEVEL_WEIGHTS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};
var VALID_LEVEL_TOKENS = /* @__PURE__ */ new Set(["debug", "info", "warn", "error"]);
function readProcessEnv() {
  return typeof process === "undefined" ? {} : process.env;
}
function defaultLevelFor(env) {
  return env.NODE_ENV === "production" ? "info" : "debug";
}
function resolveLevel(env = readProcessEnv()) {
  const raw = env[OM_LOG_LEVEL_ENV];
  if (typeof raw !== "string" || !raw.trim()) return defaultLevelFor(env);
  const normalized = raw.trim().toLowerCase();
  if (VALID_LEVEL_TOKENS.has(normalized)) return normalized;
  const fallback = defaultLevelFor(env);
  console.warn(`[logger] Unrecognized ${OM_LOG_LEVEL_ENV} value "${raw}"; falling back to "${fallback}"`);
  return fallback;
}
var cachedLevel = null;
function getLogLevel() {
  if (cachedLevel === null) cachedLevel = resolveLevel();
  return cachedLevel;
}
function isLevelEnabled(level) {
  return LOG_LEVEL_WEIGHTS[level] >= LOG_LEVEL_WEIGHTS[getLogLevel()];
}

// ../../../../private/tmp/om-continue-pr-8377/packages/shared/src/lib/logger/transport.console.ts
function formatBindingValue(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
function formatBindings(bindings) {
  return Object.entries(bindings).filter(([, value]) => value !== void 0).map(([key, value]) => `${key}=${formatBindingValue(value)}`).join(" ");
}
function createConsoleLogger(namespace, bindings = {}) {
  const emit = (level, msg, fields) => {
    if (!isLevelEnabled(level)) return;
    const { err, ...rest } = { ...bindings, ...fields };
    const suffix = formatBindings(rest);
    const line = suffix ? `[${namespace}] ${msg} ${suffix}` : `[${namespace}] ${msg}`;
    if (err instanceof Error) console[level](line, err.stack ?? err.message);
    else if (err !== void 0) console[level](line, err);
    else console[level](line);
  };
  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (childBindings) => createConsoleLogger(namespace, { ...bindings, ...childBindings })
  };
}

// ../../../../private/tmp/om-continue-pr-8377/packages/shared/src/lib/logger/transport.server.ts
var REDACT_PATHS = [
  "password",
  "*.password",
  "token",
  "*.token",
  "secret",
  "*.secret",
  "authorization",
  "*.authorization",
  "headers.authorization",
  "req.headers.authorization"
];
var REDACT_CENSOR = "[Redacted]";
var OM_LOG_DESTINATION_ENV = "OM_LOG_DESTINATION";
function isStderrDestinationToken(raw) {
  return typeof raw === "string" && raw.trim().toLowerCase() === "stderr";
}
function resolveDestinationStream(nodeProcess) {
  return isStderrDestinationToken(nodeProcess.env?.[OM_LOG_DESTINATION_ENV]) ? nodeProcess.stderr : void 0;
}
var cachedRoot;
var rootGeneration = 0;
function loadPinoRoot() {
  if (cachedRoot !== void 0) return cachedRoot;
  try {
    const nodeProcess = typeof process === "undefined" ? void 0 : process;
    const moduleBuiltin = nodeProcess?.getBuiltinModule?.("node:module");
    if (!nodeProcess || !moduleBuiltin) {
      cachedRoot = null;
      return cachedRoot;
    }
    const requireFromApp = moduleBuiltin.createRequire(`${nodeProcess.cwd()}/package.json`);
    const pinoExport = requireFromApp("pino");
    const pinoFactory = typeof pinoExport === "function" ? pinoExport : pinoExport.default;
    const destination = resolveDestinationStream(nodeProcess);
    const options = {
      level: getLogLevel(),
      redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR }
    };
    cachedRoot = destination ? pinoFactory(options, destination) : pinoFactory(options);
  } catch {
    cachedRoot = null;
  }
  return cachedRoot;
}
function wrapPinoLogger(pinoLogger) {
  return {
    debug: (msg, fields) => pinoLogger.debug(fields ?? {}, msg),
    info: (msg, fields) => pinoLogger.info(fields ?? {}, msg),
    warn: (msg, fields) => pinoLogger.warn(fields ?? {}, msg),
    error: (msg, fields) => pinoLogger.error(fields ?? {}, msg),
    child: (childBindings) => wrapPinoLogger(pinoLogger.child(childBindings))
  };
}
function createServerLogger(namespace, bindings = {}) {
  let delegate = null;
  let delegateGeneration = -1;
  const resolveDelegate = () => {
    if (delegate && delegateGeneration === rootGeneration) return delegate;
    delegateGeneration = rootGeneration;
    const root = loadPinoRoot();
    delegate = root ? wrapPinoLogger(root.child({ name: namespace, ...bindings })) : createConsoleLogger(namespace, bindings);
    return delegate;
  };
  return {
    debug: (msg, fields) => resolveDelegate().debug(msg, fields),
    info: (msg, fields) => resolveDelegate().info(msg, fields),
    warn: (msg, fields) => resolveDelegate().warn(msg, fields),
    error: (msg, fields) => resolveDelegate().error(msg, fields),
    child: (childBindings) => createServerLogger(namespace, { ...bindings, ...childBindings })
  };
}

// ../../../../private/tmp/om-continue-pr-8377/packages/shared/src/lib/logger/transport.pretty.ts
var OM_LOG_PRETTY_ENV = "OM_LOG_PRETTY";
function readProcessEnv2() {
  return typeof process === "undefined" ? {} : process.env;
}
function resolvePrettyMode(env = readProcessEnv2()) {
  const parsed = parseBooleanToken(env[OM_LOG_PRETTY_ENV]);
  if (parsed !== null) return parsed;
  return env.NODE_ENV !== "production";
}
var cachedPrettyMode = null;
function isPrettyModeEnabled() {
  if (cachedPrettyMode === null) cachedPrettyMode = resolvePrettyMode();
  return cachedPrettyMode;
}
var LEVEL_LABELS = {
  debug: "DEBUG",
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR"
};
var ANSI_RESET = "\x1B[0m";
var ANSI_DIM = "\x1B[2m";
var LEVEL_COLORS = {
  debug: ANSI_DIM,
  info: "\x1B[36m",
  warn: "\x1B[33m",
  error: "\x1B[31m"
};
function resolveStream() {
  const useStderr = isStderrDestinationToken(readProcessEnv2()[OM_LOG_DESTINATION_ENV]);
  return useStderr ? process.stderr : process.stdout;
}
function formatTimestamp(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const millis = String(date.getMilliseconds()).padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${millis}`;
}
var STACK_INDENT = "    ";
function indentStack(stack) {
  return stack.split("\n").map((stackLine) => `${STACK_INDENT}${stackLine}`).join("\n");
}
function createPrettyLogger(namespace, bindings = {}) {
  const emit = (level, msg, fields) => {
    if (!isLevelEnabled(level)) return;
    const stream = resolveStream();
    const { err, ...rest } = { ...bindings, ...fields };
    let scope = namespace;
    if (typeof rest.component === "string" && rest.component) {
      scope = `${namespace}:${rest.component}`;
      delete rest.component;
    }
    const tail = formatBindings(err instanceof Error || err === void 0 ? rest : { ...rest, err });
    const colored = stream.isTTY === true;
    const timestamp = formatTimestamp(/* @__PURE__ */ new Date());
    const timestampPart = colored ? `${ANSI_DIM}${timestamp}${ANSI_RESET}` : timestamp;
    const label = LEVEL_LABELS[level];
    const levelPart = colored ? `${LEVEL_COLORS[level]}${label}${ANSI_RESET}` : label;
    let line = `${timestampPart} ${levelPart} [${scope}] ${msg}`;
    if (tail) line += ` ${tail}`;
    if (err instanceof Error) line += `
${indentStack(err.stack ?? err.message)}`;
    stream.write(`${line}
`);
  };
  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (childBindings) => createPrettyLogger(namespace, { ...bindings, ...childBindings })
  };
}

// ../../../../private/tmp/om-continue-pr-8377/packages/shared/src/lib/logger/transport.ts
function isNodeServerRuntime() {
  if (typeof window !== "undefined") return false;
  if (typeof process === "undefined") return false;
  if (process.env.NEXT_RUNTIME === "edge") return false;
  return true;
}
function selectTransport(namespace) {
  if (!isNodeServerRuntime()) return createConsoleLogger(namespace);
  return isPrettyModeEnabled() ? createPrettyLogger(namespace) : createServerLogger(namespace);
}

// ../../../../private/tmp/om-continue-pr-8377/packages/shared/src/lib/logger/extension.ts
var GLOBAL_KEY = /* @__PURE__ */ Symbol.for("@open-mercato/shared.loggerExtension");
function store() {
  const globalStore = globalThis;
  let current = globalStore[GLOBAL_KEY];
  if (!current) {
    current = {};
    globalStore[GLOBAL_KEY] = current;
  }
  return current;
}
function getLoggerExtension() {
  return store().active;
}

// ../../../../private/tmp/om-continue-pr-8377/packages/shared/src/lib/logger/index.ts
var loggerRegistry = /* @__PURE__ */ new Map();
function createExtendedLogger(namespace, transport, bindings = {}) {
  const emit = (level, msg, fields) => {
    if (!isLevelEnabled(level)) return;
    const extension = getLoggerExtension();
    let context = {};
    try {
      context = extension?.enrich?.() ?? {};
    } catch {
    }
    const mergedFields = { ...fields, ...context };
    transport[level](msg, mergedFields);
    try {
      extension?.emit?.({
        level,
        namespace,
        message: msg,
        fields: { ...bindings, ...mergedFields },
        time: Date.now()
      });
    } catch {
    }
  };
  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (childBindings) => createExtendedLogger(
      namespace,
      transport.child(childBindings),
      { ...bindings, ...childBindings }
    )
  };
}
function createLogger(namespace) {
  const existing = loggerRegistry.get(namespace);
  if (existing) return existing;
  const created = createExtendedLogger(namespace, selectTransport(namespace));
  loggerRegistry.set(namespace, created);
  return created;
}

// ../../../../private/tmp/om-continue-pr-8377/packages/shared/src/lib/encryption/aes.ts
var logger = createLogger("shared").child({ component: "encryption" });
var TenantDataEncryptionErrorCode = /* @__PURE__ */ ((TenantDataEncryptionErrorCode2) => {
  TenantDataEncryptionErrorCode2["AUTH_FAILED"] = "AUTH_FAILED";
  TenantDataEncryptionErrorCode2["MALFORMED_PAYLOAD"] = "MALFORMED_PAYLOAD";
  TenantDataEncryptionErrorCode2["KMS_UNAVAILABLE"] = "KMS_UNAVAILABLE";
  TenantDataEncryptionErrorCode2["WRONG_KEY"] = "WRONG_KEY";
  TenantDataEncryptionErrorCode2["DECRYPT_INTERNAL"] = "DECRYPT_INTERNAL";
  return TenantDataEncryptionErrorCode2;
})(TenantDataEncryptionErrorCode || {});
var TenantDataEncryptionError = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TenantDataEncryptionError";
    this.code = code;
  }
};
var BASE64_PART = /^[A-Za-z0-9+/]+={0,2}$/;
function looksLikeEncryptedPayload(value) {
  if (typeof value !== "string") return false;
  const parts = value.split(":");
  if (parts.length !== 4 || parts[3] !== "v1") return false;
  const [iv, ciphertext, tag] = parts;
  return iv.length === 16 && tag.length === 24 && ciphertext.length > 0 && BASE64_PART.test(iv) && BASE64_PART.test(ciphertext) && BASE64_PART.test(tag);
}
function generateDek() {
  return import_node_crypto.default.randomBytes(32).toString("base64");
}
function logDebug(event, payload) {
  if (!isEncryptionDebugEnabled()) return;
  try {
    logger.debug(event, payload);
  } catch {
  }
}
function encryptWithAesGcm(value, dekBase64) {
  const dek = Buffer.from(dekBase64, "base64");
  const iv = import_node_crypto.default.randomBytes(12);
  const cipher = import_node_crypto.default.createCipheriv("aes-256-gcm", dek, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = [
    iv.toString("base64"),
    ciphertext.toString("base64"),
    tag.toString("base64"),
    "v1"
  ].join(":");
  logDebug("encrypt", { length: ciphertext.length });
  return { value: payload, raw: payload, version: "v1" };
}
var AES_GCM_IV_BYTES = 12;
var AES_GCM_TAG_BYTES = 16;
function isEncryptedPayloadShape(value) {
  if (typeof value !== "string") return false;
  const parts = value.split(":");
  if (parts.length !== 4 || parts[3] !== "v1") return false;
  const [ivB64, ciphertextB64, tagB64] = parts;
  try {
    return Buffer.from(ivB64, "base64").length === AES_GCM_IV_BYTES && Buffer.from(tagB64, "base64").length === AES_GCM_TAG_BYTES && Buffer.from(ciphertextB64, "base64").length > 0;
  } catch {
    return false;
  }
}
function runAesGcmDecrypt(dek, iv, ciphertext, tag) {
  const decipher = import_node_crypto.default.createDecipheriv("aes-256-gcm", dek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
function decryptWithAesGcm(payload, dekBase64) {
  if (!payload) return null;
  const parts = payload.split(":");
  if (parts.length !== 4) return null;
  const [ivB64, ciphertextB64, tagB64, version] = parts;
  if (version !== "v1") return null;
  const dek = Buffer.from(dekBase64, "base64");
  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  try {
    const result = runAesGcmDecrypt(dek, iv, ciphertext, tag);
    logDebug("decrypt", { iv: ivB64, tag: tagB64 });
    return result;
  } catch (err) {
    logDebug("decrypt_error", { message: err?.message || String(err) });
    return null;
  }
}
var LOOKUP_HASH_V2_PREFIX = "v2:";
function normalizeLookupValue(value) {
  return value.toLowerCase().trim();
}
function legacyHashForLookup(value) {
  return import_node_crypto.default.createHash("sha256").update(normalizeLookupValue(value)).digest("hex");
}
function resolveLookupPepper() {
  const candidates = [
    process.env.LOOKUP_HASH_PEPPER,
    process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY,
    process.env.TENANT_DATA_ENCRYPTION_KEY
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.trim().replace(/(?:^['"]|['"]$)/g, "");
    if (normalized) return normalized;
  }
  return null;
}
function hashForLookup(value, context) {
  const pepper = resolveLookupPepper();
  const normalized = normalizeLookupValue(value);
  if (!pepper) {
    return legacyHashForLookup(value);
  }
  const message = context ? `${context}:${normalized}` : normalized;
  const digest = import_node_crypto.default.createHmac("sha256", pepper).update(message).digest("hex");
  return `${LOOKUP_HASH_V2_PREFIX}${digest}`;
}
function lookupHashCandidates(value, context) {
  const primary = hashForLookup(value, context);
  const legacy = legacyHashForLookup(value);
  return primary === legacy ? [primary] : [primary, legacy];
}
function decryptWithAesGcmStrict(payload, dekBase64) {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[3] !== "v1") {
    throw new TenantDataEncryptionError(
      "AUTH_FAILED" /* AUTH_FAILED */,
      "Value is not an encrypted payload (format mismatch)"
    );
  }
  const [ivB64, ciphertextB64, tagB64] = parts;
  let dek, iv, ciphertext, tag;
  try {
    dek = Buffer.from(dekBase64, "base64");
    iv = Buffer.from(ivB64, "base64");
    ciphertext = Buffer.from(ciphertextB64, "base64");
    tag = Buffer.from(tagB64, "base64");
  } catch {
    throw new TenantDataEncryptionError(
      "MALFORMED_PAYLOAD" /* MALFORMED_PAYLOAD */,
      "Failed to decode base64 components"
    );
  }
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new TenantDataEncryptionError(
      "MALFORMED_PAYLOAD" /* MALFORMED_PAYLOAD */,
      "Invalid AES-GCM payload: unexpected IV, tag, or ciphertext size"
    );
  }
  try {
    return runAesGcmDecrypt(dek, iv, ciphertext, tag);
  } catch {
    throw new TenantDataEncryptionError(
      "AUTH_FAILED" /* AUTH_FAILED */,
      "AES-GCM authentication tag verification failed"
    );
  }
}

// ../../../../private/tmp/om-continue-pr-8377/packages/shared/src/lib/encryption/kms.ts
var import_node_crypto2 = __toESM(require("node:crypto"), 1);

// ../../../../private/tmp/om-continue-pr-8377/packages/shared/src/lib/http/fetchWithTimeout.ts
var FetchTimeoutError = class extends Error {
  constructor(url, timeoutMs) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = "FetchTimeoutError";
    this.timeoutMs = timeoutMs;
    this.url = url;
  }
};
var DEFAULT_TIMEOUT_MS = 15e3;
function resolveTimeoutMs(value, fallback = DEFAULT_TIMEOUT_MS) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  return fallback;
}
async function fetchWithTimeout(input, init = {}) {
  const { timeoutMs, signal, ...rest } = init;
  const effectiveTimeout = resolveTimeoutMs(timeoutMs);
  const controller = new AbortController();
  const urlForError = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const timer = setTimeout(() => {
    controller.abort(new FetchTimeoutError(urlForError, effectiveTimeout));
  }, effectiveTimeout);
  const onExternalAbort = () => {
    controller.abort(signal?.reason);
  };
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      throw signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
    }
    signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") {
      const reason = controller.signal.reason;
      if (reason instanceof FetchTimeoutError) throw reason;
      if (reason instanceof Error) throw reason;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  }
}

// ../../../../private/tmp/om-continue-pr-8377/packages/shared/src/lib/encryption/kms.ts
var logger2 = createLogger("shared").child({ component: "kms" });
var DEFAULT_VAULT_REQUEST_TIMEOUT_MS = 1e3;
var DEFAULT_VAULT_RECOVERY_COOLDOWN_MS = 3e4;
function resolveVaultRequestTimeoutMs() {
  const raw = process.env.VAULT_REQUEST_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : void 0;
  return resolveTimeoutMs(parsed, DEFAULT_VAULT_REQUEST_TIMEOUT_MS);
}
function resolveVaultRecoveryCooldownMs() {
  const raw = process.env.VAULT_RECOVERY_COOLDOWN_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : void 0;
  return resolveTimeoutMs(parsed, DEFAULT_VAULT_RECOVERY_COOLDOWN_MS);
}
var FallbackKmsService = class {
  constructor(primary, fallback, onFallback) {
    this.primary = primary;
    this.fallback = fallback;
    this.onFallback = onFallback;
    this.notified = false;
  }
  isHealthy() {
    return this.primary.isHealthy() || Boolean(this.fallback?.isHealthy?.());
  }
  notifyFallback() {
    if (this.notified) return;
    this.notified = true;
    this.onFallback?.();
  }
  async fromPrimary(op) {
    try {
      return await op();
    } catch (err) {
      logger2.warn("Primary KMS failed, will try fallback", { err });
      return null;
    }
  }
  async getTenantDek(tenantId) {
    if (this.primary.isHealthy()) {
      const dek = await this.fromPrimary(() => this.primary.getTenantDek(tenantId));
      if (dek) return dek;
    }
    if (this.fallback?.isHealthy()) {
      this.notifyFallback();
      return this.fallback.getTenantDek(tenantId);
    }
    return null;
  }
  async createTenantDek(tenantId) {
    if (this.primary.isHealthy()) {
      const dek = await this.fromPrimary(() => this.primary.createTenantDek(tenantId));
      if (dek) return dek;
    }
    if (this.fallback?.isHealthy()) {
      this.notifyFallback();
      return this.fallback.createTenantDek(tenantId);
    }
    return null;
  }
  invalidateDek(tenantId) {
    this.primary.invalidateDek?.(tenantId);
    this.fallback?.invalidateDek?.(tenantId);
  }
};
function normalizeEnv(value) {
  if (!value) return "";
  return value.trim().replace(/(?:^['"]|['"]$)/g, "");
}
function resolveDerivedKeySecret() {
  const candidates = [
    { value: process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY ?? null, envName: "TENANT_DATA_ENCRYPTION_FALLBACK_KEY" },
    { value: process.env.TENANT_DATA_ENCRYPTION_KEY ?? null, envName: "TENANT_DATA_ENCRYPTION_KEY" }
  ];
  for (const raw of candidates) {
    const normalized = normalizeEnv(raw.value ?? void 0);
    if (normalized) return { secret: normalized, source: "explicit", envName: raw.envName };
  }
  if (process.env.NODE_ENV !== "production" && parseBooleanToken(process.env.ALLOW_DERIVED_KMS_FALLBACK) === true) {
    return { secret: "om-dev-tenant-encryption", source: "dev-default", envName: "DEV_DEFAULT" };
  }
  return null;
}
var NoopKmsService = class {
  isHealthy() {
    return !isTenantDataEncryptionEnabled();
  }
  async getTenantDek() {
    return null;
  }
  async createTenantDek() {
    return null;
  }
};
var DerivedKmsService = class {
  constructor(secret) {
    this.root = import_node_crypto2.default.createHash("sha256").update(secret).digest();
  }
  isHealthy() {
    return true;
  }
  deriveKey(tenantId) {
    const iterations = 31e4;
    const keyLength = 32;
    const derived = import_node_crypto2.default.pbkdf2Sync(this.root, tenantId, iterations, keyLength, "sha512");
    return derived.toString("base64");
  }
  async getTenantDek(tenantId) {
    if (!tenantId) return null;
    return { tenantId, key: this.deriveKey(tenantId), fetchedAt: Date.now() };
  }
  async createTenantDek(tenantId) {
    return this.getTenantDek(tenantId);
  }
};
var HashicorpVaultKmsService = class _HashicorpVaultKmsService {
  constructor(opts = {}) {
    this.cache = /* @__PURE__ */ new Map();
    this.healthy = true;
    // Sticky terminal failure (missing VAULT_ADDR/VAULT_TOKEN): no amount of
    // re-probing fixes a misconfiguration, so this never self-heals — only a
    // restart with corrected config does.
    this.misconfigured = false;
    // Timestamp of the last transient failure (timeout / network blip / 5xx).
    // Drives the half-open circuit breaker in isHealthy(): after the cooldown the
    // instance reports healthy again so the next call re-probes Vault.
    this.lastTransientFailureAt = null;
    this.vaultAddr = normalizeEnv(opts.vaultAddr || process.env.VAULT_ADDR || "");
    this.vaultToken = normalizeEnv(opts.vaultToken || process.env.VAULT_TOKEN || "");
    this.mountPath = (opts.mountPath || process.env.VAULT_KV_PATH || "secret/data").replace(/\/+$/, "");
    this.ttlMs = opts.ttlMs ?? 15 * 60 * 1e3;
    this.requestTimeoutMs = resolveTimeoutMs(opts.requestTimeoutMs, resolveVaultRequestTimeoutMs());
    this.recoveryCooldownMs = resolveTimeoutMs(opts.recoveryCooldownMs, resolveVaultRecoveryCooldownMs());
    this.debugEnabled = isEncryptionDebugEnabled();
    if (!this.vaultAddr || !this.vaultToken) {
      this.healthy = false;
      this.misconfigured = true;
      if (this.debugEnabled) {
        logger2.warn("Vault misconfigured (missing VAULT_ADDR or VAULT_TOKEN)");
      }
    }
    if (this.healthy && !_HashicorpVaultKmsService.loggedInit && this.debugEnabled) {
      _HashicorpVaultKmsService.loggedInit = true;
      if (this.debugEnabled) {
        logger2.info("Hashicorp Vault KMS enabled");
      }
    }
  }
  static {
    this.loggedInit = false;
  }
  isHealthy() {
    if (this.misconfigured) return false;
    if (this.healthy) return true;
    if (this.lastTransientFailureAt === null) return false;
    return this.now() - this.lastTransientFailureAt >= this.recoveryCooldownMs;
  }
  now() {
    return Date.now();
  }
  // Vault responded successfully (or is provably reachable): close the breaker.
  markHealthy() {
    this.healthy = true;
    this.lastTransientFailureAt = null;
  }
  // Transient infra failure (timeout / network blip / 5xx): open the breaker and
  // start the recovery cooldown so a later call can re-probe and self-heal.
  markTransientFailure() {
    this.healthy = false;
    this.lastTransientFailureAt = this.now();
  }
  cacheHit(tenantId) {
    const entry = this.cache.get(tenantId);
    if (!entry) return null;
    if (this.now() - entry.fetchedAt > this.ttlMs) {
      this.cache.delete(tenantId);
      return null;
    }
    return entry;
  }
  async readVault(path) {
    if (!this.vaultAddr || !this.vaultToken) {
      this.healthy = false;
      this.misconfigured = true;
      return null;
    }
    try {
      const res = await fetchWithTimeout(`${this.vaultAddr}/v1/${path}`, {
        method: "GET",
        headers: { "X-Vault-Token": this.vaultToken },
        timeoutMs: this.requestTimeoutMs
      });
      if (!res.ok) {
        if (res.status >= 500) this.markTransientFailure();
        else this.markHealthy();
        logger2.warn("Vault read failed", { path, status: res.status });
        return null;
      }
      this.markHealthy();
      if (this.debugEnabled) {
        logger2.info("Vault read ok", { path });
      }
      return await res.json();
    } catch (err) {
      this.markTransientFailure();
      logger2.warn("Vault read error", { path, err, timeoutMs: this.requestTimeoutMs });
      return null;
    }
  }
  async writeVault(path, key, opts) {
    if (!this.vaultAddr || !this.vaultToken) {
      this.healthy = false;
      this.misconfigured = true;
      return "error";
    }
    const body = { data: { key } };
    if (typeof opts?.cas === "number") body.options = { cas: opts.cas };
    try {
      const res = await fetchWithTimeout(`${this.vaultAddr}/v1/${path}`, {
        method: "POST",
        headers: {
          "X-Vault-Token": this.vaultToken,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        timeoutMs: this.requestTimeoutMs
      });
      if (res.ok) {
        this.markHealthy();
        return "ok";
      }
      if (typeof opts?.cas === "number" && res.status === 400) {
        this.markHealthy();
        logger2.warn("Vault write CAS conflict (concurrent DEK create)", { path, status: res.status });
        return "conflict";
      }
      this.markTransientFailure();
      logger2.warn("Vault write failed", { path, status: res.status });
      return "error";
    } catch (err) {
      this.markTransientFailure();
      logger2.warn("Vault write error", { path, err, timeoutMs: this.requestTimeoutMs });
      return "error";
    }
  }
  buildKeyPath(tenantId) {
    const suffix = `tenant_key_${tenantId}`;
    const normalizedMount = this.mountPath.replace(/^\/+/, "");
    return `${normalizedMount}/${suffix}`;
  }
  remember(entry) {
    this.cache.set(entry.tenantId, entry);
    return entry;
  }
  async getTenantDek(tenantId) {
    const cached = this.cacheHit(tenantId);
    if (cached) return cached;
    const path = this.buildKeyPath(tenantId);
    const res = await this.readVault(path);
    const key = res?.data?.data?.key;
    if (!key) {
      logger2.warn("No tenant DEK found in Vault", { tenantId, path });
      return null;
    }
    const dek = { tenantId, key, fetchedAt: this.now() };
    return this.remember(dek);
  }
  async createTenantDek(tenantId) {
    const path = this.buildKeyPath(tenantId);
    const existing = await this.readVault(path);
    const existingKey = existing?.data?.data?.key;
    if (existingKey) {
      return this.remember({ tenantId, key: existingKey, fetchedAt: this.now() });
    }
    if (!this.healthy) return null;
    const key = generateDek();
    const outcome = await this.writeVault(path, key, { cas: 0 });
    if (outcome === "ok") {
      logger2.info("Stored tenant DEK in Vault", { tenantId, path });
      return this.remember({ tenantId, key, fetchedAt: this.now() });
    }
    if (outcome === "conflict") {
      const winner = await this.readVault(path);
      const winnerKey = winner?.data?.data?.key;
      if (winnerKey) {
        logger2.info("Adopted concurrently-created tenant DEK", { tenantId, path });
        return this.remember({ tenantId, key: winnerKey, fetchedAt: this.now() });
      }
    }
    logger2.warn("Failed to store tenant DEK in Vault", { tenantId, path });
    return null;
  }
  invalidateDek(tenantId) {
    this.cache.delete(tenantId);
  }
};
var loggedDerivedKeyFallbackBanner = false;
function buildDerivedKeyFallbackBannerLines(opts) {
  const sourceLine = opts.source === "explicit" ? `Source: ${opts.envName}` : "Source: dev default secret (do NOT use in production)";
  return [
    "\u{1F6A8} Using derived tenant encryption keys (Vault unavailable / no DEK)",
    sourceLine,
    "Persist this secret securely. Without it, encrypted tenant data cannot be recovered after restart."
  ];
}
function logDerivedKeyFallbackBanner(opts) {
  if (process.env.NODE_ENV === "test" || loggedDerivedKeyFallbackBanner) return;
  loggedDerivedKeyFallbackBanner = true;
  const redBg = "\x1B[41m";
  const white = "\x1B[97m";
  const reset = "\x1B[0m";
  const width = 110;
  const border = `${redBg}${white}${"\u2501".repeat(width)}${reset}`;
  const body = buildDerivedKeyFallbackBannerLines(opts);
  const bannerLines = [
    border,
    ...body.map((line) => `${redBg}${white} ${line.padEnd(width - 2, " ")} ${reset}`),
    border
  ];
  process.stderr.write(bannerLines.join("\n") + "\n");
  logger2.warn("Using derived tenant encryption keys (Vault unavailable / no DEK)", {
    fallbackSource: opts.envName
  });
}
function createKmsService() {
  if (!isTenantDataEncryptionEnabled()) return new NoopKmsService();
  const primary = new HashicorpVaultKmsService();
  const derived = resolveDerivedKeySecret();
  const fallback = derived ? new DerivedKmsService(derived.secret) : null;
  const notifyFallback = derived ? () => {
    logDerivedKeyFallbackBanner(derived);
  } : void 0;
  if (!primary.isHealthy()) {
    if (fallback) {
      notifyFallback?.();
      return fallback;
    }
    logger2.warn("Vault not healthy or misconfigured (missing VAULT_ADDR/VAULT_TOKEN) and no fallback secret provided; falling back to noop KMS");
    return new NoopKmsService();
  }
  if (fallback) {
    return new FallbackKmsService(primary, fallback, notifyFallback);
  }
  return primary;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TenantDataEncryptionError,
  TenantDataEncryptionErrorCode,
  createKmsService,
  decryptWithAesGcm,
  decryptWithAesGcmStrict,
  encryptWithAesGcm,
  generateDek,
  hashForLookup,
  isEncryptedPayloadShape,
  legacyHashForLookup,
  looksLikeEncryptedPayload,
  lookupHashCandidates
});
