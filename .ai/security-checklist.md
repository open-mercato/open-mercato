# Security Hotspot Checklist — Open Mercato

Repository-specific security hotspots for Open Mercato. Wired through `securityChecklist` in `.ai/agentic.config.json` and read by the shared `om-auto-sec-report-pr` skill (Pass A and Pass B) on top of its built-in OWASP baseline and deep-vector checklist — it names the scope keys, guarded helpers, permission model, encrypted fields, money/stock flows, and framework sinks that the generic checklist refers to. The general review baseline stays in `.ai/review-checklist.md` (`reviewChecklist`); this file adds the paranoid, security-only angle and does not repeat it.

Sections follow the order of the shared deep-vector checklist so each item maps to the vector it specializes.

## Access control and identity

- Permission model: guards use `requireFeatures` (ACL feature ids declared in the module's `acl.ts`), not `requireRoles`; a role rename without an ACL-feature-id mapping is a spoofing risk.
- Wildcard ACL `__all__` must not reach non-superadmins through menu items, nav sections, notification handlers, mutation guards, command interceptors, or AI tools. Cross-check `packages/shared`, `packages/ui`, `packages/core/src/modules/auth`, and `packages/core/src/modules/customer_accounts`.
- Portal / customer auth (`customer_accounts`) must not reach staff-only ACL features through shared endpoints.
- Customer-auth and step-up (sudo) rate limits use the compound identifier (tenant + email + ip) so buckets cannot collide and mask brute force; sudo challenge state is tied to the tenant.
- JWTs record the key id (`kid`); key material is never read from attacker-controlled input.

## Tenant isolation

- Scope keys are `organization_id` **and** `tenant_id` — present on every read and write path; handlers derive scope from trusted context, never from same-named payload fields.
- Guarded data access: `findWithDecryption` / `findOneWithDecryption` (with `tenantId` and `organizationId`), never raw `em.find` / `em.findOne` on tenant data.
- Cache keys carry the tenant (`tenantId` in the key or `runWithCacheTenant()`) across the memory, SQLite, and Redis strategies; no stale entries after a tenant rename or delete.
- SSE and broadcast events: event ids are tenant-scoped, and `clientBroadcast` / `portalBroadcast` never bridge events across tenants.
- Workers: the job payload carries trusted tenant + organization, the worker refuses a mismatch, and retries never replay cross-tenant.
- Public endpoints (quote acceptance, magic links, webhook ingress) validate the tenant from the signed token or URL, never from a query parameter.

## Cryptography and secrets

- PII fields encrypted at rest by default — check the module-registered encryption maps and GDPR-marked fields in `data/validators.ts`; no hand-rolled AES/KMS (use `TenantDataEncryptionService`).
- Password hashing with `bcryptjs`, cost ≥ 10.
- No `NODE_TLS_REJECT_UNAUTHORIZED=0` on production paths.

## Injection and deserialization

- Raw ORM sinks: no string concatenation into `em.raw`, `em.execute`, or migrations.
- Command execution: no `execSync(userInput)` or `shell: true` with attacker-controlled args; prefer `execa` with an argument array.
- Template engines for email and documents (MJML, handlebars, jsx-email) never render attacker-controlled templates.
- XSS: `dangerouslySetInnerHTML` and unescaped markdown rendering of user input.
- Prototype pollution: `lodash.merge` on attacker input, `qs.parse` default depth, `JSON.parse` spread into configs.
- Deserialization: `yaml.load` without a safe schema, `node-serialize`.
- ReDoS: zod `regex` on user-facing schemas.

## Upload, attachment, and file handling

- Image pipeline hardened before `sharp` (pixel and byte budgets against decompression bombs).
- PDF text extraction: no shell-out to OCR; sandboxed parser.
- Attachments: tenant scope enforced on the public partition.

## SSRF and outbound HTTP

- Block cloud metadata (`169.254.169.254`, IPv6 `fd00::/8`) alongside private and loopback ranges.

## Webhooks and integrations

- Inbound webhook secrets per tenant or per integration, never one global secret; nonce cache keyed by (tenant, nonce).
- Idempotency: unique constraint on (tenant, idempotency_key) or (tenant, provider_event_id).
- Outbound webhooks use Standard Webhooks signing with secret rotation, delivery dedup, targeted retries, and a dead-letter audit.

## Money, orders, and workflows

- TOCTOU on quote acceptance → order creation, including the public quote endpoints.
- Overshipment on concurrent shipment creation.
- Double credit on concurrent return → credit memo.
- Double charge on repeated payment submit or refund.
- Workflow failures halt the workflow by default, and failed activities surface in the list and detail views; compensation sagas are correct on partial failure.
- Money: half-even rounding applied consistently; never `number` for money (`Decimal`, `bigint`, or string); cross-currency totals require FX.

## API hygiene

- `openApi` exported on every route.
- zod schemas `.strict()` on write operations — no `.passthrough()` mass assignment.
- Pagination cap: `pageSize` ≤ 100.
- UUIDs in URLs; numeric ids on public endpoints invite IDOR.

## AI tool surfaces

- AI tools (`ai-tools.ts`, MCP tools) honor the same `acl.ts` features as the equivalent API route.

## Supply chain and dependencies

- Internal `@open-mercato/*` package names cannot be shadowed by public registry packages.
- Transitive `vm2` and other deprecated sandbox packages removed.
- Dependency audit: the CI `audit` job (`scripts/audit-ci.mjs`, allowlist `scripts/audit-ci-allowlist.json`) is the repo's documented audit — read its result as data.

## Observability and forensics

- Sensitive actions (login, password reset, role change, permission grant, export) are logged with actor, tenant, target, timestamp, and IP.

## Spec targets

When the unit is a spec under `.ai/specs/` (including `.ai/specs/enterprise/`):

- Apply section 3 "Data Integrity & Security" of `.ai/skills/om-spec-writing/references/spec-checklist.md` and the compliance matrix of `.ai/skills/om-spec-writing/references/compliance-review.md`.
- Every new route declares an explicit `requireFeatures` / `requireAuth` guard with the ACL feature id named in the spec.
- Every new entity lists its PII/encrypted and indexed fields so `fieldPolicy.excluded` covers sensitive columns.
- Every new event id is tenant-scoped by default; `clientBroadcast` / `portalBroadcast` usage states the tenant boundary.
- A Migration & Backward Compatibility section exists for any change to a contract surface category in `BACKWARD_COMPATIBILITY.md` (cross-check as `om-pre-implement-spec` does).
