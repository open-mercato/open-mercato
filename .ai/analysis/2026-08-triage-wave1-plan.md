# Triage Plan: Wave 1 Batched PRs (Aug 2026)

**Source Issue:** Triage: core-team & partner open issues, grouped thematically for batched PRs (Aug 2026)

**Scope:** 573 priority issues (407 core-team, 166 partner) → 266 bugs · 225 features · 51 tech-debt · 187 high-value

---

## 🌊 Wave 1 — First PRs (batched related issues)

Each cluster bundles tightly-related high-value issues sharing a root cause or single code surface.

| # | PR Theme | Issues to Close | Rationale |
|---|----------|-----------------|-----------|
| 1 | **api_docs lockdown + fix empty export** | #2270, #3808, #3810, #3116 | Same module: add `requireAuth`/`requireFeatures` + ACL features to api_docs routes, and fix the empty OpenAPI/markdown export |
| 2 | **Secrets & PII written/served in plaintext** | #2253, #3876, #3837 | Same pattern: enforce encryption helpers (`findWithDecryption` / encrypted writes) and mask secrets on read |
| 3 | **Cross-tenant scoping guards** | #2250, #3820, #3629 | Same pattern: id-only loads and null-tenant paths missing organization/tenant filters |
| 4 | **MFA hardening sweep** | #3852, #3856, #5212, #5011 | One security review of the MFA/passkey flow: bypassable fallback, emergency-flag scope, pending-token gating + broken verification screen |
| 5 | **AI tool authorization gate** | #3805, #5173, #5211, #1777 | One authorization seam: mutation-approval and per-user/per-entity ACL enforced at tool-execution level |
| 6 | **Order totals & lifecycle guards** | #4060, #2397, #3530, #4521, #4056 | Extends existing umbrellas #4059/#4060: totals recalculation + status guards in the same command layer |
| 7 | **OAuth/session token hygiene** | #3836, #3828, #4034 | Token/cache lifecycle: single-use OAuth state, legacy client fallback removal, API-key cache eviction on delete |
| 8 | **Feature-gated runtime helpers honor tenant features** | #2085, #2144, #2151, #2157, #2163, #2165, #2166, #2167 | The whole "declare ACL feature dependencies" series + the missing `tenantHasFeature` in RbacService |

---

## 🔐 Auth & RBAC — 65 issues (30 high-value)

### High-value (do first):

- [ ] #966 🟦 (pat-lewczuk, bug/M) — enterprise security module isn't installed but bootstrap.ts
- [ ] #2253 🟦 (pkarw, bug/M) — GET credentials endpoint returns fully decrypted secrets (no masking / write
- [ ] #2270 🟦 (pkarw, bug/M) — unauthenticated OpenAPI/markdown endpoints expose full internal API surface + ACL feature
- [ ] #2676 🟦 (pat-lewczuk, bug/M) — OCR pipeline lacks resource bounds — no page cap, timeout/abort, concurrency
- [ ] #3116 🟦 (Kapsik89, bug/M) — api_docs openapi/markdown export and explorer return an empty document
- [ ] #5011 🟦 (alinadivante, bug/M) — MFA verification screen — "Zweryfikuj" and "Wyślij ponownie kod" buttons have
- [ ] #1777 🟦 (pkarw, feature/S) — Phase 5c — AI tool-authorship hardening (post-#1593 follow-up)
- [ ] #2085 🟨 (mat-kruk, bug/S) — feature-gated scheduler jobs are skipped because RbacService lacks tenantHasFeature
- [ ] #3828 🟨 (haxiorz, bug/S) — remove legacy `credentials._client` OAuth-client fallback in adapter
- [ ] #3852 🟨 (haxiorz, bug/S) — passkey MFA second factor bypassable via non-cryptographic fallback (PasskeyProvider.ts:47-55)
- [ ] #2407 🟦 (pkarw, feature/M) — Add sanctions / restricted-jurisdiction screening to self-service onboarding (demo mode)
- [ ] #2573 🟦 (pkarw, feature/M) — qa(undo): TC-UNDO-001 integration tests — auth undoable commands (#2468)
- [ ] #2929 🟨 (haxiorz, bug/M) — public quote endpoints fall back to raw (unhashed) acceptance token
- [ ] #3808 🟨 (haxiorz, bug/M) — full OpenAPI spec served with no authentication (api/docs/openapi/route.ts:10)
- [ ] #3810 🟨 (haxiorz, bug/M) — backend docs page has requireAuth but no requireFeatures; module declares zero
- [ ] #3820 🟨 (haxiorz, bug/M) — user-consents GET returns cross-tenant rows for null-tenant super admin (route.ts:60)
- [ ] #3823 🟨 (haxiorz, bug/M) — `getNestedValue` walks arbitrary field paths including prototype keys (value-resolver.ts:33)
- [ ] #3836 🟨 (haxiorz, bug/M) — OAuth state cookie is not single-use (replayable within 5-min TTL) (lib/oauth-state.ts:170)
- [ ] #3882 🟨 (haxiorz, bug/M) — persisted pageSize allows up to 500 in a saved view (data/validators.ts:12)
- [ ] #4034 🟨 (haxiorz, bug/M) — CRUD deletion does not evict the API-key authentication cache
- [ ] #5183 🟦 (pkarw, feature/M) — Add row-aware authorization for polymorphic search results
- [ ] #5211 🟨 (haxiorz, bug/M) — enforce per-entity acl in the legacy ai search tool

---

## Process

1. Pick a **theme** above (each "High-value" block is sized to be one PR, or a small PR series on one theme).
2. Claim it by commenting on the source issue + assigning yourself on the member issues.
3. One PR should reference all issues it closes (`fixes #a, fixes #b, …`).
4. Tick the checkbox when the PR merges.

**Ordering** = descending count of high-value issues. 🟦 = core team, 🟨 = certified partner.

---

## Next Waves

After Wave 1, repeat the same batching inside the next themes down the list (Catalog, Customers, CrudForm/DataTable polish).
