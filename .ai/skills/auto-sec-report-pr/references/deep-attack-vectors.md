# Deep Attack Vectors — Paranoid Checklist

This checklist complements the `code-review` security baseline. Use it
during every `auto-sec-report-pr` run. For every section that applies
to the unit under analysis, record an outcome: `covered`, `risk
surfaced`, `not applicable`, or `inconclusive (next step)`.

## Access control & identity

- Wildcard ACL (`__all__`) for non-superadmins in menu items, nav
  sections, notification handlers, mutation guards, command
  interceptors, AI tools. Cross-check `packages/shared`, `packages/ui`,
  `packages/core/src/modules/auth`, and
  `packages/core/src/modules/customer_accounts`.
- Role-name spoofing — verify `requireFeatures` is used instead of
  `requireRoles` on guarded routes. `role` rename without
  ACL-feature-id mapping.
- Feature-flag bypass — expose an ungated code path when the flag is
  off. Confirm the flag gates both the UI and the API.
- Portal / customer auth leaking staff features — customer session
  that can invoke staff-only ACL features via shared endpoints.
- Session fixation and session rotation — was the session id rotated
  after login, password change, MFA enable, privilege escalation?
- JWT algorithm confusion (`alg: none`, HS↔RS key swap), missing
  `iss`/`aud`/`exp` checks, loose `clockTolerance`, token replay
  after password reset. Confirm key material is not read from
  attacker-controlled input.
- Sudo / step-up challenges — rate-limit identifier scope, replayable
  challenge, challenge state tied to tenant.
- Customer auth compound rate-limit identifiers — correct identifier
  tuple (tenant + email + ip) so bucket collisions cannot mask brute
  force.

## Tenant isolation

- `organization_id` and `tenant_id` present on every read and write
  path. Confirm `findWithDecryption`/`findOneWithDecryption` are used,
  not raw `em.find`/`em.findOne`.
- Cache keys include tenant scope — memory / SQLite / Redis. Stale
  cache entries after tenant rename/delete.
- Shared in-memory registries (services, maps, singletons) keyed
  without tenant.
- SSE channels and broadcast events — confirm event ids are
  tenant-scoped. Confirm `clientBroadcast`/`portalBroadcast` do not
  bridge events across tenants.
- Background worker jobs — the payload carries tenant id, the worker
  refuses mismatched tenants, and retries do not replay cross-tenant.
- Public endpoints (quote acceptance, magic link, webhook ingress)
  MUST validate the tenant from the signed token/URL, not from a
  query parameter.

## Cryptography and secrets

- PII fields encrypted at rest by default — check module-registered
  encryption maps and `data/validators.ts` for GDPR-marked fields.
- Password hashing — bcryptjs cost ≥ 10, never logged, constant-time
  compare on login.
- Signing keys rotated, key-id (`kid`) recorded in JWTs, keys not in
  code or `.env` committed to git.
- Timing-safe compare used for signatures, tokens, magic links. No
  `===` or `.startsWith` on secrets.
- TLS required on outbound calls; cert verification not disabled;
  no `NODE_TLS_REJECT_UNAUTHORIZED=0` in production paths.

## Injection and deserialization

- SQL / ORM — parameterized queries; no string concatenation into
  `em.raw`, `em.execute`, migrations.
- Command injection — no `execSync(userInput)`, no `shell: true` with
  attacker-controlled args. Prefer `execa` with args array.
- Template injection — MJML/handlebars/jsx-email rendered from
  attacker-controlled templates.
- XSS — HTML rendering of user input without escaping; `dangerouslySetInnerHTML`;
  unescaped markdown rendering.
- Prototype pollution — `JSON.parse` + object spread into configs;
  `lodash.merge` on attacker input; `qs.parse` default depth; explicit
  rejection of `__proto__`, `constructor`, `prototype` keys.
- Deserialization — `yaml.load` vs `yaml.safeLoad`; `node-serialize`;
  `vm`/`Function`/`eval` sinks; `require()` with dynamic paths.
- ReDoS — user-supplied regex; catastrophic backtracking in zod
  `regex`, email / URL / phone validators, search tokenizers, log
  parsers.
- Log forging / log injection — newline injection into structured
  logs; unescaped user input into log messages that feed downstream
  parsers.

## Upload, attachment, and file handling

- Content-type sniffing — trust actual magic bytes, not the
  `Content-Type` header.
- Path traversal — reject `..`, absolute paths, null bytes, symlink
  escapes. Canonicalize then validate against a safe prefix.
- Archive slip (`zip-slip`) — validate entry paths when extracting
  archives.
- XML attachments — XXE disabled, DTDs disabled, entity expansion
  limited.
- Image pipeline — hardened before `sharp`; reject decompression bombs
  (pixel budget, byte budget).
- PDF text extraction — no shell-out to OCR; sandboxed parser.
- Public vs private partitions — tenant scope enforced on public
  partition access.

## SSRF and outbound HTTP

- Allowlist for outbound URLs (webhooks, preview fetchers, avatar
  loaders, OAuth metadata endpoints).
- Block private, link-local, loopback, metadata (169.254.169.254 and
  IPv6 `fd00::/8`), `file://`, `gopher://`, `dict://`, `data:` where
  inappropriate.
- DNS rebinding protection — resolve once and reuse the IP, or
  re-check against the allowlist after resolution.
- Redirect chain — follow at most N hops, re-validate each hop against
  the allowlist. Reject cross-protocol redirects.
- Host header handling — reflected Host never used to construct
  outbound URLs.

## Redirect and origin handling

- Open redirect — validate relative vs absolute, reject `//evil.com`,
  unicode/RTL, protocol-relative, newline-in-URL, control characters.
- CORS — `Access-Control-Allow-Origin: *` not used with credentials;
  origin allowlist is exact-match (no suffix match vulnerability);
  no echoing of attacker-supplied origin.
- CSRF — state-changing endpoints require same-site cookies or
  explicit token; no state mutation on `GET`.

## Webhooks and integrations

- Inbound webhooks — signature verification enforced, timing-safe
  compare, secret derived per tenant or per integration, not a shared
  global secret.
- Replay protection — monotonic timestamp window, nonce cache keyed
  (tenant, nonce), TTL aligned with allowable clock skew.
- Signature-scheme downgrade — reject older scheme versions once a
  newer one is expected. Never accept unsigned deliveries.
- Idempotency — unique constraint on (tenant, idempotency_key) or
  (tenant, provider_event_id). Exactly-once semantics on side-effects.
- Outbound webhooks — Standard Webhooks signing, secret rotation,
  delivery attempt dedup, targeted retries, dead-letter queue audit.

## Money, orders, and workflows

- TOCTOU on quote acceptance → order creation, public quote endpoints.
- Overshipment on concurrent shipment creation.
- Double-credit on concurrent return → credit memo.
- Double-charge on repeated payment submit / refund.
- Workflow failure visibility — failures halt the workflow by default;
  failed activities surface in the list and detail views.
- Compensation saga correctness on partial failures.
- Currency rounding direction (half-even) used consistently; no
  `number` for money (use `Decimal`/`bigint`/string); cross-currency
  totals require FX.

## Rate limiting and abuse

- Rate-limit identifier tuple — (tenant, user/email, ip) with a
  bucket size that survives distribution. IP-only is insufficient
  behind a proxy.
- Burst vs sustained — token-bucket with refill that matches the
  endpoint sensitivity. Account lockouts are time-bounded and
  observable.
- Captcha / MFA fallback on suspicious thresholds.

## Cookies, headers, and CSP

- Cookie flags: `HttpOnly`, `Secure`, `SameSite=Lax` (or `Strict` for
  admin), `Path` scoped, `Domain` minimal.
- `X-Frame-Options: DENY` or `Content-Security-Policy:
  frame-ancestors 'none'` to defeat clickjacking on sensitive views.
- CSP free of `unsafe-inline` and `unsafe-eval`; `object-src 'none'`;
  `base-uri 'none'` where possible; nonces/hashes for inline scripts.
- HSTS with `includeSubDomains` and adequate `max-age`.
- Referrer-Policy tight enough to avoid leaking cross-origin referers.
- `X-Content-Type-Options: nosniff`, `Permissions-Policy` for camera/
  microphone/geolocation if embedded.

## API hygiene

- `openApi` exported on every route (required for docs/discovery).
- zod schemas use `.strict()` by default — no mass assignment via
  `.passthrough()` on write operations.
- Error shape is minimal — no stack traces, no internal module
  paths, no tenant ids to unauthenticated callers.
- Pagination caps (`pageSize` ≤ 100) to prevent data exfiltration
  via large lists.
- IDs in URLs use UUIDs; numeric ids on public endpoints invite IDOR.

## Supply chain and dependencies

- Dependencies pinned in lockfiles; Renovate/Dependabot drift
  reviewed.
- No post-install scripts from untrusted packages.
- Transitive `vm2` / deprecated sandbox packages — removed.
- Internal package paths (`@open-mercato/*`) cannot be shadowed by
  public packages.
- `yarn audit` / `npm audit` surface triaged.

## Observability and forensics

- Sensitive actions (login, password reset, role change, permission
  grant, export) logged with actor, tenant, target, timestamp, IP.
- Failure paths logged, not swallowed. `catch { }` is a red flag.
- Log PII policy — redact emails/phones/addresses where appropriate.
- Secrets never logged (check bearer tokens, API keys, private keys).

## Infrastructure and environments

- Environment variables documented and fail-closed at boot when
  missing. No default secrets.
- Separate credentials per environment; no prod secrets in dev
  images.
- CORS, CSP, and cookie flags have production profiles, not just
  dev defaults.
- Build artifacts exclude `.env`, test fixtures, and demo seeds.

## Spec-specific (when target is a spec)

When the unit under analysis is a spec file, also verify:

- Every new route has an explicit `requireFeatures`/`requireAuth`
  guard, with the ACL feature id declared in the spec.
- Every new entity lists which fields are PII/encrypted and which
  are indexed, so that `fieldPolicy.excluded` covers sensitive
  columns.
- Every new event id is tenant-scoped by default; `clientBroadcast`/
  `portalBroadcast` calls out tenant boundary.
- Every new worker declares idempotency (unique key, retry strategy).
- Every new external integration declares allowlist and signature
  verification.
- Migration & Backward Compatibility section exists for any changes
  to the 13 contract surfaces (`BACKWARD_COMPATIBILITY.md`).
