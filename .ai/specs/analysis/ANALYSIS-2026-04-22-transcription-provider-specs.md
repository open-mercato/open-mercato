# Spec Review: CRM Call Transcriptions + Zoom + tl;dv Adapters

## Scope

- `.ai/specs/2026-04-21-crm-call-transcriptions.md`
- `.ai/specs/2026-04-22-transcription-zoom-adapter.md`
- `.ai/specs/2026-04-22-transcription-tldv-adapter.md`

## Findings

1. **[Critical] tl;dv assumes per-user integration credentials, but the actual integrations foundation is tenant-scoped only**
   - Spec: `.ai/specs/2026-04-22-transcription-tldv-adapter.md:19`, `:151-173`, `:189-215`
   - Current code: `packages/shared/src/modules/integrations/types.ts:1-4`, `packages/core/src/modules/integrations/data/entities.ts:45-62`
   - The tl;dv adapter is built around one API key and webhook secret per OM user, plus polling per `(user, tenant)`. But the real integrations scope only has `{ organizationId, tenantId }`, and the credentials table has no `user_id` dimension. As written, the spec cannot store or resolve multiple tl;dv user connections within one tenant without first extending the integrations contract and schema.

2. **[Critical] Zoom webhook URL-validation routing is based on an impossible “scan and know which secret matched” flow**
   - Spec: `.ai/specs/2026-04-22-transcription-zoom-adapter.md:295-299`, `:358-371`
   - The spec says the handler can iterate tenant secrets and respond with whichever one “matches” Zoom’s URL-validation request. But the request contains only `plainToken`, and the server can send only one response; it has no oracle that tells it which tenant secret Zoom would accept before the response is sent. This means the proposed no-extra-routing handshake is not implementable as written.

3. **[High] Zoom real-event routing contradicts the credential uniqueness rule and can duplicate or leak ingest across tenants**
   - Spec: `.ai/specs/2026-04-22-transcription-zoom-adapter.md:217-219`, `:301-305`, `:369`
   - The adapter says credentials are unique on `(account_id, tenantId)`, explicitly allowing the same Zoom account to be connected in multiple OM tenants. But webhook events only carry `account_id`, and the spec says the dispatcher may “fan out.” That breaks the earlier claim that account_id maps 1:1 to a tenant and risks cross-tenant duplicate ingest unless the uniqueness/routing model is redesigned.

4. **[Medium] The parent spec promises transcript-hit filtering by `customers.call_transcripts.view`, but the current search stack has no feature-aware result filter**
   - Spec: `.ai/specs/2026-04-21-crm-call-transcriptions.md:657`
   - Current code: `packages/shared/src/modules/search.ts:64-83`, `packages/search/src/service.ts:78-120`, `packages/search/src/lib/field-policy.ts:23-30`
   - The spec says transcript-derived search hits will be filtered out at result time for users lacking `customers.call_transcripts.view`. The current search service only searches by tenant/org and field policy; it does not receive or apply feature-level ACL context during result merging. So this privacy guarantee is not backed by an existing mechanism yet.

5. **[Medium] The new `call_transcripts` marketplace category/hub is only partially wired in the specs**
   - Spec: `.ai/specs/2026-04-21-crm-call-transcriptions.md:173-183`, `.ai/specs/2026-04-22-transcription-zoom-adapter.md:225-243`, `.ai/specs/2026-04-22-transcription-tldv-adapter.md:41`
   - Current code: `packages/core/src/modules/integrations/backend/integrations/filters.ts:4-13`, `packages/core/src/modules/integrations/i18n/en.json:150-157`
   - `IntegrationHubId` can accept a new string, so `hub: 'call_transcripts'` itself is fine. But the marketplace UI still hardcodes the known category list and translations, and the specs do not say to update those surfaces. As written, these provider cards would land in the marketplace with missing category treatment in filters/i18n.

6. **[Low] The parent ingest schema regresses to `z.record(z.unknown())` even though the shared contract was cleaned up to `JsonValue`**
   - Spec: `.ai/specs/2026-04-21-crm-call-transcriptions.md:155`, `:698`
   - The shared provider contract now correctly types `providerMetadata` as `Record<string, JsonValue>`, but the ingest route schema still uses `z.record(z.unknown())`. This is smaller than the issues above because it is route-local, not a shared public type, but it reintroduces a looser contract than the rest of the revised spec.

## Recommendation

The overall direction is still solid, but I would mark the three-spec set as **needs spec updates first**.

The biggest blockers are:
- redesign tl;dv around the current tenant-scoped integrations model, or explicitly extend that model first
- redesign Zoom URL-validation and webhook tenant resolution so it is deterministic without impossible secret scanning
- define a real search-ACL enforcement mechanism instead of assuming the current search stack can do result-time feature filtering

## Resolution (2026-04-22)

All six findings addressed across the three specs. Summary:

| # | Severity | Resolution | Where |
|---|---|---|---|
| F1 | Critical | tl;dv vault stores only a tenant-level `TldvVaultConfig { enabled: true }` marker; per-user credentials live in a new provider-owned table `transcription_tldv_user_credentials` with column-level encryption. Webhook tenant/user resolution switches from `?u=<signedToken>` URL param to fingerprint-indexed lookup (`sha256Hex(X-OM-Webhook-Secret)` → one indexed row read → decrypt + constant-time compare). | `.ai/specs/2026-04-22-transcription-tldv-adapter.md` §Authentication & credentials, §Ingestion, §Data Models (delta), §Risks, §Implementation Phases, §Tests, §Changelog |
| F2 | Critical | Webhook URL now carries a mandatory signed tenant token `?t=base64url(tenantId).hex(HMAC-SHA256(tenantId, OM_INTERNAL_WEBHOOK_KEY))`. URL-validation handshake and real events both resolve tenant deterministically from the token. No scanning, no caching, no rate-limit gymnastics. | `.ai/specs/2026-04-22-transcription-zoom-adapter.md` §Tenant routing, §Ingestion webhook steps, §Authentication & credentials, §API Contracts, §Tests, §Changelog |
| F3 | High | Follows from F2: URL decides tenant; `payload.account_id` is a consistency check (reject with 409 on mismatch). `(accountId, tenantId)` UNIQUE in the vault is preserved without fan-out. | same Zoom sub-spec |
| F4 | Medium | Search-ACL mechanism doesn't exist; v1 does not index transcript body. Search indexes only `title` + `source` for call interactions; transcript content remains ACL-gated via the dedicated read route. Users find calls by title/provider. Full-text transcript search deferred to a follow-up spec that will extend `packages/search` with user-feature-aware filtering. Parent spec's §Search configuration rewritten; TC-CRM-CT-019 updated. | `.ai/specs/2026-04-21-crm-call-transcriptions.md` §Search configuration, §Integration Test Coverage, §Changelog |
| F5 | Medium | Parent Phase 1 gains step 16: register `'call_transcripts'` in `INTEGRATION_MARKETPLACE_CATEGORIES`, i18n bundles, icon mapping, and hub descriptor. | `.ai/specs/2026-04-21-crm-call-transcriptions.md` §Implementation Phases Phase 1 step 16, §Changelog |
| F6 | Low | Parent §Proposed Solution.1 exports `jsonValueSchema` / `providerMetadataSchema` (recursive zod); ingest route's schema uses `providerMetadataSchema` instead of `z.record(z.unknown())`. | `.ai/specs/2026-04-21-crm-call-transcriptions.md` §Proposed Solution.1, §API Contracts (ingest), §Changelog |

No outstanding findings. Three-spec set is ready for review and can move forward to the Implementation Orchestrator pipeline step.

---

## Re-Review (2026-04-22, later pass)

The earlier structural blockers are mostly fixed, but one cleanup pass is still needed across the parent spec and the tl;dv sub-spec.

### Findings

1. **[Medium] The parent spec still contains stale search promises that contradict the narrowed v1 search scope**
   - Spec: `.ai/specs/2026-04-21-crm-call-transcriptions.md:32`, `:78`, `:93`
   - Corrected scope elsewhere: `.ai/specs/2026-04-21-crm-call-transcriptions.md:608-663`, `:1111`, `:1335`
   - The current search section now correctly says v1 indexes only interaction `title` and `source`, not transcript body. But earlier summary/overview text still says transcripts are searchable/fulltext-indexed. The doc should be normalized so it makes one consistent v1 promise.

2. **[Medium] The parent spec still has stale generic wording about provider credentials and webhook tenant resolution**
   - Spec: `.ai/specs/2026-04-21-crm-call-transcriptions.md:187`, `:209-214`
   - Corrected generic contract elsewhere: `.ai/specs/2026-04-21-crm-call-transcriptions.md:796-800`, `:1243`
   - The intro still implies every provider registers credentials in the integrations vault and resolves them per tenant. That no longer fits the tl;dv redesign, where per-user credentials live in a provider-owned table because `IntegrationScope` is tenant-scoped only.

3. **[Medium] The tl;dv sub-spec still contains stale pre-redesign wording in visible sections**
   - Spec: `.ai/specs/2026-04-22-transcription-tldv-adapter.md:19`, `:102`, `:224`
   - Corrected model elsewhere: `.ai/specs/2026-04-22-transcription-tldv-adapter.md:144-159`, `:163-185`, `:582-586`
   - The TLDR still says per-user credentials live in the existing integrations vault, the architecture block still says “per-user secret from vault,” and the connect flow still says “personal integrations page.” Those all conflict with the newer provider-owned per-user credentials table and the `/backend/integrations` UI story.

4. **[Low] The tl;dv fingerprint lookup and declared index shape do not fully match**
   - Spec: `.ai/specs/2026-04-22-transcription-tldv-adapter.md:168`, `:257`, `:302`, `:548`
   - The spec describes webhook resolution as a single lookup by `webhookSecretFingerprint`, but the declared index is `(organizationId, tenantId, webhookSecretFingerprint)`. That index shape does not quite match the described global fingerprint-first lookup. Either the index or the lookup description should be adjusted.

### Updated Recommendation

The Zoom and tl;dv architecture is much healthier than in the first review. At this point I would call the remaining work **consistency cleanup**, not architectural redesign. One more pass to remove stale wording should make the three-spec set internally consistent.

### Re-Review Resolution (2026-04-22)

All four re-review findings resolved.

| # | Resolution | Where |
|---|---|---|
| R1 | Parent §Architectural Review Response row #5, §Overview attachment-content paragraph, and §Research closing line rewritten to match the narrowed v1 search scope (title + source only; transcript body deferred to follow-up spec that extends `packages/search` with user-feature-aware filtering). | `.ai/specs/2026-04-21-crm-call-transcriptions.md` §Architectural Review Response, §Overview, §Research, §Changelog |
| R2 | Parent §Proposed Solution.1 credential-storage paragraph generalized to cover both the tenant-scoped vault pattern (Zoom) and the provider-owned per-user table pattern (tl;dv). §Proposed Solution.3 "Ingest triggers" webhook bullet rewritten to cite the auto-discovered file-path convention and the three families of tenant/user resolution (URL token, payload field, signed-secret fingerprint). | `.ai/specs/2026-04-21-crm-call-transcriptions.md` §Proposed Solution.1, §Proposed Solution.3, §Changelog |
| R3 | tl;dv TLDR auth line, architecture diagram webhook-steps block, and connect-flow step 1 all rewritten to match the current model (fingerprint-indexed lookup via `transcription_tldv_user_credentials`; shared `/backend/integrations` surface, no "personal integrations page"). | `.ai/specs/2026-04-22-transcription-tldv-adapter.md` §TLDR, §Architecture, §Connect flow, §Changelog |
| R4 | tl;dv `TldvUserCredentials` index shape aligned with the webhook lookup: replaced the `(organizationId, tenantId, webhookSecretFingerprint)` composite with a global `UNIQUE (webhook_secret_fingerprint)` constraint. Added an index-rationale block listing why the three indexes exist (fingerprint for webhook lookup, tenant+user for connect uniqueness, org+tenant composite for polling iteration). §Ingestion lookup description updated accordingly. | `.ai/specs/2026-04-22-transcription-tldv-adapter.md` §Authentication & credentials, §Ingestion, §Changelog |

No outstanding findings across both review passes. Three-spec set is internally consistent and ready for the Implementation Orchestrator pipeline step.
