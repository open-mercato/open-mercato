# Pre-Implementation Analysis: Inbound Webhook Handlers — Module-Level Consumption System

**Spec**: `.ai/specs/2026-03-23-inbound-webhook-handlers.md` (Status: Draft)
**Analyzed**: 2026-06-17
**Analyst**: AI-assisted (om-pre-implement-spec)
**Verified against**: `develop` @ live codebase (not spec text alone)

## Executive Summary

The spec is architecturally sound and mirrors a proven platform pattern (event subscribers), but it was written as if the inbound surface were greenfield. It is **not** — `@open-mercato/webhooks` already ships an inbound receiver, an entity, an event, an adapter registry, a subscriber, and rate-limit/dedup logic at the *exact same route path* the spec proposes. There is **one Critical blocker** (route-path collision with the live `POST /api/webhooks/inbound/[endpointId]` route) and several Warning-level BC items around superseding `WebhookEndpointAdapter`. Phase 4's `inbox_ops` premise is partly **inaccurate** (it already has per-tenant encrypted secrets, contradicting the "global env vars, no tenant scoping" framing). **Recommendation: Needs spec updates before implementation** — primarily a route/compatibility decision and a corrected Phase 4 baseline.

---

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | **API Route URLs (#7)** | The spec's `POST /api/webhooks/inbound/:sourceKey` is the **same Next.js dynamic-segment path** as the live route at `packages/webhooks/src/modules/webhooks/api/inbound/[endpointId]/route.ts` (→ `POST /api/webhooks/inbound/{endpointId}`). Two route files cannot coexist at one path, and the existing param means *adapter providerKey*, not *sourceKey*. Silently re-pointing it changes the meaning/contract of a shipped route. | **Critical** | Pick one: **(a)** mount the new system on a distinct path (e.g. `POST /api/webhooks/in/:sourceKey` or `…/inbound/source/:sourceKey`); or **(b)** *unify* — keep `[endpointId]` as the single entry, resolve the segment first against the new `webhookSourceRegistry`, then fall back to the legacy adapter registry. (b) is cleaner long-term and preserves the URL. Spec MUST state which, with a migration note. |
| 2 | **Type Definitions (#2) + Function Signatures (#3)** | Spec supersedes the public `WebhookEndpointAdapter` interface and the `registerWebhookEndpointAdapter()` / `getWebhookEndpointAdapter()` / `listWebhookEndpointAdapters()` registry (`lib/adapter-registry.ts`). §14 acknowledges this but the bridge is described only as "a compatibility shim." | **Warning** | Keep the adapter interface + registry exported and functional for ≥1 minor version with `@deprecated` JSDoc. Provide a concrete adapter→`WebhookSourceConfig` wrapper so registered adapters keep receiving inbound traffic through the unified dispatch. Document in `RELEASE_NOTES.md`. |
| 3 | **Auto-discovery conventions (#1, FROZEN-on-release) + Generated file contracts (#14)** | Two NEW conventions (`webhook-sources.ts`, `webhook-handlers/*.ts`) and two new generated registries. Adding them is allowed (additive), but once released they are frozen, and they require extending the `Module` type with new (optional) arrays + new generated exports. | **Warning (additive)** | Land as **optional** `Module` fields and **new** generated exports (never change existing export names / `BootstrapData` required fields). Mirror in `packages/create-app/template/src/bootstrap.ts` (see lessons.md: standalone bootstrap drift). Treat the file conventions as frozen from day one — name them deliberately. |
| 4 | **Event flow continuity** | The live inbound path emits `webhooks.inbound.received` (persistent) and is consumed by subscriber `webhooks:inbound-process`, which calls `adapter.processInbound()`. The new worker-based dispatch must not silently strip this. | **Warning** | During the bridge, keep emitting `webhooks.inbound.received` and keep `webhooks:inbound-process` working for legacy adapters. New events `webhooks.inbound.processed` / `webhooks.inbound.handler_failed` are additive — OK. |

### Confirmed Non-Issues (verified additive)

- New events `webhooks.inbound.processed`, `webhooks.inbound.handler_failed` — do **not** exist today. Additive ✓
- ACL: spec uses `webhooks.view` / `webhooks.manage` — **both already exist** (`acl.ts` also has `webhooks.secrets`, `webhooks.test`). No new feature IDs required ✓
- Entities `WebhookIngestion` / `InboundEndpointConfig` (+ tables `webhook_ingestions`, `webhook_inbound_configs`) — do not exist. New tables are additive ✓
- DI key `integrationCredentialsService` — **exists** with the exact `save/resolve/getRaw/saveField` signatures the spec assumes ✓

### BC Section Present

§14 exists but is incomplete — it omits the route collision (#1) entirely and under-specifies the adapter bridge (#2). Must be expanded.

---

## Spec Completeness

### Incomplete / Inaccurate Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| §1 / §11 (problem framing) | Treats inbound as missing "auto-discovery / unified routing." A working inbound receiver, dedup (DB unique constraint on `webhook_inbound_receipts`), rate limiting, and an adapter registry **already exist**. | Reframe as "replace the per-provider adapter registry with a module-level handler convention," referencing the live files. Acknowledge the existing receiver. |
| §13 Phase 4 (inbox_ops "current state") | **Inaccurate.** Claims inbox_ops uses only global `process.env` secrets with "no tenant scoping." In reality `InboxSettings.webhookSecret` is an **encrypted per-tenant column** already, and the route already does per-tenant secret resolution + HMAC **and** Svix. | Correct the baseline. The migration is "env fallback → encrypted credentials store," not "global → tenant-scoped" (tenant scoping exists). Preserve both HMAC and Svix paths and the existing `inbox_ops.email.received` / `inbox_ops.email.deduplicated` events. |
| §10.3 Deduplication | Code sample `cache.set(dedupeKey, '1', { ttl: 86400 })` comments "24h TTL" but cache TTL is in **milliseconds** — 86400 ms ≈ 86 s. Also: existing receiver dedups via a **DB unique constraint**, not cache. | Fix to `ttl: 86400_000`. Decide one source of truth for dedup: reuse the durable `webhook_inbound_receipts` unique-constraint approach (survives cache eviction) rather than introducing a parallel cache-only mechanism, or document why both. |
| §11.4 Source credential UI | Assumes a credential **schema** to render fields dynamically, but `WebhookSourceConfig` declares no credential schema. And `integrationCredentialsService.getSchema()` returns a schema only for **registered integrations** — `webhook_source_*` keys are not registered providers. | Add an optional `credentialFields` descriptor to `WebhookSourceConfig`, OR register each source as an integration. Note: the integrations *credentials API route* 404s on unregistered `integrationId`, so the UI must POST through a webhooks-owned route calling the **service** directly (the service itself does not validate the id). |
| §11 UI mocks | "color-coded badge — green/red/yellow," "syntax-highlighted JSON" described generically. | Specify `<StatusBadge>` + `text-status-*` / `bg-status-*` semantic tokens (no `text-green-*`/`bg-red-*`), `<DataTable>`/`<CrudForm>` for list/forms, `apiCall` for reads, lucide-react icons. No hardcoded status colors or arbitrary text sizes. |
| i18n | No section. New UI strings (4 pages) and any user-facing errors are unplanned. | Add an i18n key plan; route user-facing strings through `useT()` / `resolveTranslations()`, prefix internal throws with `[internal]`. |

### Sections present & adequate

TLDR, Architecture diagram, Data Models, API contracts, Phasing, Integration test coverage (TC-WH-IN-001..023), Risks, Changelog, Final Compliance Report — all present.

---

## AGENTS.md Compliance

| Rule | Location | Fix |
|------|----------|-----|
| External providers live in their own package, never `packages/core` (lessons.md + root AGENTS.md) | §13 Phase 3 places Stripe handlers in `packages/gateway-stripe` | Correct intent — **but verify `packages/gateway-stripe` exists** before Phase 3 (not confirmed in this repo). If absent, Phase 3 must scaffold it first or pick an existing provider package as the reference. inbox_ops staying in core is fine (it is pre-existing, not a new external provider). |
| `findWithDecryption` / `findOneWithDecryption` for entity reads | Worker + route read `WebhookIngestion` | New entity has no encrypted fields, but per the integration-package lesson default to the decryption-aware helpers anyway. |
| Reuse existing encryption map; don't hand-roll | §10.1 "each webhook source credential entity MUST have an EncryptionMap entry" | Over-specified. Credentials persist in `integration_credentials`, whose `credentials` JSON column is **already** in `integrations` `defaultEncryptionMaps`. No new map needed when reusing `CredentialsService`. |
| Queue worker contract | §7 worker | `WorkerMeta { queue, id?, concurrency }` and `createModuleQueue(name).enqueue({ name, payload })` match the real contract ✓. Keep the worker idempotent (re-check ingestion status — spec already does). |
| Backend writes via `CrudForm`/guarded mutations, no raw fetch | §11 replay/config actions | Route replay/rotate/test through `apiCall` + `useGuardedMutation` (or `CrudForm`). No ad-hoc fetch (webhooks AGENTS.md explicitly forbids it). |
| `rateLimiterService` is optionally registered | §10.2 | Resolve via `tryResolve`/optional, as the existing route does — do not hard-require it. |

---

## Risk Assessment

### High

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Route collision (BC#1)** ships a broken/ambiguous endpoint | Two route files at one path → build/route failure, or silent contract change for existing adapter consumers | Resolve path strategy in spec **before** coding (prefer unify-on-`[endpointId]`). |
| **Multi-tenant disambiguation by trying every tenant's credentials** (§3.4, §8) | O(#tenants-using-source) signature verifications per inbound call; CPU/timing side-channel; DoS amplification | Prefer endpoint-config or payload `scopeExtractor` to pin tenant first; only iterate credentials as a last resort, with a hard cap + constant-time discipline. Document the bound. |
| **Handler→event→outbound-webhook loop** (§15) | Inbound handler emits domain event → `webhooks:outbound-dispatch` (`event: '*'`) fires → external round-trip | Mitigation requires editing the **existing** `outbound-dispatch` subscriber to skip `_inboundIngestionId`-tagged events. Call this out as a change to shipped code, with a test. |

### Medium

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Dual dedup mechanisms (cache vs DB unique constraint) | Divergent "duplicate" semantics, cache-eviction false negatives | Single durable source of truth (reuse receipt-row unique constraint). |
| Generator changes touch `scanner.ts` + `module-registry.ts` + `Module` type + generated bootstrap | Build breaks; standalone-template drift | Land additively; mirror `create-app` bootstrap; run `yarn generate && yarn build:app`. |
| Adapter-bridge regressions | Existing registered adapters stop receiving inbound traffic | Keep `webhooks.inbound.received` + `inbound-process` alive; add a bridge test. |
| `cache.set` TTL unit bug copied into impl | 86 s dedup window instead of 24 h | Fix unit in spec sample. |

### Low

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `handlerResults` JSON unbounded | Row bloat | Cap 50 entries / truncate errors (spec already notes). |
| Large-payload DoS | Memory | 1 MB body cap per source (spec already notes). |

---

## Gap Analysis

### Critical (block implementation)
- **Route strategy decision** (BC#1) — must be settled in the spec before any code.
- **Phase 4 baseline correction** — inbox_ops already has encrypted per-tenant secrets + Svix; the migration scope and "backward compatibility contract" table must be rewritten against reality.

### Important (should address)
- **`WebhookSourceConfig` credential-schema** field for §11.4 dynamic UI + the route that persists creds (integrations API 404s on unregistered ids).
- **Adapter→source bridge** concrete shape + deprecation note in `RELEASE_NOTES.md`.
- **Outbound-loop mitigation** specified as a concrete edit to `subscribers/outbound-dispatch.ts` with a test.
- **i18n key plan** for the 4 new pages.
- **`packages/gateway-stripe` existence** confirmation for Phase 3 (else scaffold/relocate reference impl).

### Nice-to-have
- DS token specifics in §11 mocks (StatusBadge, semantic tokens, lucide icons).
- Decide `persistent: false` handler behavior (sync vs queued dispatch).

---

## Remediation Plan

### Before Implementation (Must Do)
1. **Decide the route model** — recommend unifying on the existing `api/inbound/[endpointId]` route: resolve segment against `webhookSourceRegistry` first, fall back to the legacy adapter registry. Update §3, §5.1, §14.
2. **Rewrite Phase 4 current-state + BC table** against the real inbox_ops (encrypted `InboxSettings.webhookSecret`, HMAC+Svix, events `inbox_ops.email.received` / `.deduplicated`). Migration = "env fallback → encrypted store," preserving existing tenant scoping.
3. **Add an adapter-deprecation subsection** to §14 with the concrete `WebhookEndpointAdapter`→`WebhookSourceConfig` bridge and a removal target version.

### During Implementation (Add to Spec / honor)
1. Extend `Module` type + generated registries **additively**; mirror standalone bootstrap.
2. Reuse `integration_credentials` encryption (drop the "new EncryptionMap per source" requirement); add `WebhookSourceConfig.credentialFields` for the UI.
3. Single durable dedup path; fix cache TTL unit.
4. Edit `outbound-dispatch` subscriber for inbound-loop suppression; add test.
5. UI: `DataTable`/`CrudForm`/`apiCall`/`StatusBadge`/semantic tokens/lucide + i18n keys.

### Post-Implementation (Follow Up)
1. `RELEASE_NOTES.md` entries for the new conventions + adapter deprecation.
2. After the bridge minor, plan `WebhookEndpointAdapter` removal.
3. Move spec to `.ai/specs/implemented/` once all phases ship; update changelog.

## Recommendation

**Needs spec updates first.** The pattern is good and the platform primitives all exist exactly as assumed (`integrationCredentialsService`, `rateLimiterService`, `cache`, queue/worker, encryption maps, generator hooks). But the spec must (1) resolve the route collision with the live inbound receiver, (2) specify the `WebhookEndpointAdapter` deprecation bridge concretely, and (3) correct the Phase 4 inbox_ops baseline. Once those three land, Phase 1 is ready to implement.
