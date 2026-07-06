# Pre-Implementation Analysis: Entra ID token authentication for the Open Mercato API

Spec: `.ai/specs/enterprise/2026-06-23-entra-token-api-authentication.md`
Date: 2026-06-23 · Mode: analysis only (no code, no spec edits)

## Executive summary

The spec is architecturally sound and unusually well-grounded: the seam choice, the multi-tenant validation rules, and the eleven security invariants (INV-1..11) address the real cross-tenant, takeover, and revocation hazards. The backward-compatibility profile is fully additive — no contract-surface violations. It is **not** ready to implement verbatim: four accuracy/consistency corrections and a handful of additive-detail gaps should be fixed first. None require a major revision. Recommendation: **needs minor spec updates, then implement.**

## Backward compatibility

Audited against all 14 contract-surface categories in `BACKWARD_COMPATIBILITY.md`.

### Violations found

| # | Surface | Issue | Severity | Proposed fix |
|---|---------|-------|----------|--------------|
| — | (1) Auto-discovery files | Adds to existing `acl.ts` / `setup.ts` / `data/validators.ts` / `data/entities.ts` / `di.ts` — all additive; no rename/removal | None | — |
| — | (3) Function signatures | Internal branch in `resolveAuthFromRequestDetailed`; new `registerExternalAuthStrategy` export. Not in the frozen-signature table; no existing signature changes | None | Keep the explicit "no existing export changes shape" assertion (already in spec) |
| — | (8) Database schema | New tables + additive nullable columns on `sso_configs` + additive `tid` on `sso_identities` | None | Give the two new boolean columns (`multi_tenant`, `entra_api_auth_enabled`) plain `false` defaults (lessons: MikroORM string/boolean defaults must be plain values, not pre-quoted SQL) |
| — | (9) DI names / (10) ACL IDs / (7) API routes | New DI registration, new feature IDs, new admin routes — all additive; collision scan confirms `sso.entra_tenant_mapping.*`, `sso.entra_service_principal_link.*`, the entity ids, and `/api/sso/entra*` are all free | None | Finalize the ACL IDs now — they are FROZEN once shipped |

**No BC violations.** One **behavioral** change to flag (not a contract surface): INV-11 narrows `clearStaffAuthCookies` (`apps/mercato/src/app/api/[...slug]/route.ts:371-374,414-415`) to cookie-origin failures. Verified this is a **pre-existing footgun** — today a junk `Authorization: Bearer` sent alongside a valid `auth_token` cookie clears the victim's cookie (`server.ts:307-331` reads the header before the cookie and sets `hadInvalidInteractiveToken` for any failed Bearer). The fix is correct and required for the feature, but it changes existing behavior, so it needs a RELEASE_NOTES line and a dedicated regression test.

### Missing BC section

Present and accurate. The spec's "Backward compatibility" section satisfies the deprecation-protocol requirement; because everything is additive, no migration/bridge is needed beyond preserving the no-strategy-registered default.

## Spec completeness

### Missing / thin sections

| Section | Impact | Recommendation |
|---------|--------|----------------|
| Risks & Impact Review (technical/integration/dependency) | The threat model covers security risks but not implementation/integration risk (regression blast radius on the shared chokepoint, jose supply chain, CRUD-pattern inconsistency) | Add a short "Risks & Impact" section, or fold this analysis's Risk Assessment into the spec |
| API contracts for the two admin CRUD surfaces | Endpoint shapes are named by mechanism but not sketched | One request/response sketch per entity is enough (avoid CRUD-boilerplate bloat) |
| i18n key plan for admin UI | Admin pages need `useT()`/`resolveTranslations()`; not mentioned | Add a line: locale keys under `sso.entra.*`, no hardcoded labels |

Everything else required (TLDR, Overview, Problem, User stories, Architecture, Data model, ACL, Threat model, BC, Phasing, Integration coverage, Final Compliance Report, Changelog) is present.

## AGENTS.md compliance

| Rule | Location in spec | Finding / fix |
|------|------------------|---------------|
| Table names plural snake_case (root AGENTS + checklist §3/§14) | Data model | **Fix:** spec uses singular table names (`entra_tenant_mapping`, `entra_service_principal_link`). House convention is plural — existing sso tables are `sso_configs`, `sso_identities`, `sso_user_deactivations`, `sso_role_grants`. Rename tables to `entra_tenant_mappings` / `entra_service_principal_links`. Entity **class** names stay singular PascalCase. |
| Canonical CRUD (`makeCrudRoute`/`CrudForm`/`DataTable`) | Phasing 2.2/2.3, Data model | **Decision needed:** the sso module today is **hand-rolled** (service-backed routes + bespoke React pages + `useGuardedMutation`); it uses `makeCrudRoute`/`CrudForm` nowhere. The spec prescribes `makeCrudRoute`+`CrudForm`+`DataTable`. Recommend `makeCrudRoute` for the new simple allowlist entities (it is the AGENTS-preferred primitive and yields optimistic-lock + query-index coverage for free), and note the deliberate divergence from the module's existing hand-rolled SsoConfig wizard (which is multi-step for a reason). If instead you mirror the hand-rolled pattern, the spec must add manual `buildOptimisticLockHeader`/`useGuardedMutation` wiring. |
| Optimistic locking default-ON | Data model | Verified: auto-registers for `makeCrudRoute` entities **that ship an `updated_at` column** (`factory.ts:945-964`, `optimistic-lock.ts:77-92`). New entities list `updated_at` ✓. If hand-rolled (above), the auto-reader does not apply. Opt-out token is `OM_OPTIMISTIC_LOCK=off` (+ synonyms `false/0/no/disabled/none`). |
| `defaultRoleFeatures` mirrors `acl.ts` (setup.ts) | ACL section | Add: mirror the new `manage` features into `sso/setup.ts` `defaultRoleFeatures` for the admin role (superadmin already covered by the existing `sso.*` wildcard). |
| Reads via `findWithDecryption` even when unencrypted | Data model | Add: reads of the new entities should default to `findWithDecryption`/`findOneWithDecryption` (lessons: integration/module reads default to decryption-aware helpers to avoid silent regressions). |
| MikroORM PK assignment before reference | Phase 2.4 resolution | Note: if the resolver creates rows that reference each other before flush, assign `id: randomUUID()` explicitly (lessons: MikroORM 6 does not generate UUIDs client-side). |
| DS compliance for admin UI | Phasing 2.2/2.3 | No UI mocks given; flag that the `is_active` column should render via `<StatusBadge>`, states via `LoadingMessage`/`ErrorMessage`, dialogs with `Cmd/Ctrl+Enter`/`Escape`, lucide icons — per `.ai/ds-rules.md`. |
| `@open-mercato/shared` zero domain deps | Architecture (Seam A) | Compliant — interface/registry in shared, Entra impl in enterprise. Keep it that way; jose goes on `@open-mercato/enterprise`, not shared. |
| Encryption maps | Data model | Compliant (N/A) — new columns hold non-secret identifiers; `client_secret_enc` never read on the hot path. Verified accurate. |

## Risk assessment

### High

| Risk | Impact | Mitigation |
|------|--------|------------|
| Multi-tenant validation correctness (INV-1/2/3) | A mistake = cross-tenant or confused-deputy auth | Implement exactly per invariants; the Phase-1.2 matrix must include a validly-signed-but-non-allowlisted-tenant vector and the alg-confusion vectors; take `tid`/`iss` from the jose-verified payload only |
| App-only tenant/org drift (INV-4) | `tid`→orgA / key→orgB cross-tenant escalation; `resolveApiKeyAuth` integrity checks are bypassed on this path | Derive scope from the api-key, assert equality with the `tid` mapping, fail closed; integration test the drift case |
| Regression blast radius on the shared chokepoint | `resolveAuthFromRequestDetailed` gates ALL API auth | Fail-open default + "existing auth tests pass unchanged" gate; INV-11 regression test |

### Medium

| Risk | Impact | Mitigation |
|------|--------|------------|
| INV-11 behavioral change | Could alter legitimate expired-cookie clearing if mis-scoped | Clear only on cookie-origin failure; preserve the genuine expired-cookie path; regression test both |
| No hot-path deactivation precedent | INV-9's `SsoUserDeactivation` check is net-new (today only SCIM reads it; `scimService.ts`, `scim-mapper.ts:30`) | Wire it explicitly; reuse the `(userId, ssoConfigId)` lookup + the `reactivatedAt == null ⇒ active` derivation |
| jose as a new direct dependency | Supply-chain + version drift (currently transitive only) | Pin an exact version on `@open-mercato/enterprise`; do not rely on the transitive copy |
| CRUD-pattern inconsistency | Divergence from the sso module's hand-rolled style | Settle the makeCrudRoute decision before coding |

### Low

| Risk | Impact | Mitigation |
|------|--------|------------|
| Table-naming correction | Cosmetic schema churn if caught late | Fix to plural before the migration is authored |
| api_keys has no `is_active` | INV-4 liveness must be precise | Liveness = `deleted_at IS NULL AND (expires_at IS NULL OR expires_at > now())`; revocation of an app-only principal is via the link's `is_active`/soft-delete, not the key |

## Gap analysis

### Important gaps (address before implementation)

- **Table naming**: switch to plural (`entra_tenant_mappings`, `entra_service_principal_links`).
- **CRUD mechanism decision**: `makeCrudRoute` (recommended) vs the module's hand-rolled precedent — settle and write it into the spec, because optimistic-lock + indexer behavior depends on it.
- **Correct the "zero RS256/JWKS anywhere" claim**: an RS256 verifier already exists — `packages/core/src/modules/communication_channels/lib/gmail-pubsub-jwt.ts` (hand-rolled `node:crypto`, x509-cert-by-kid, not jose/JWKS). The "jose only transitive" claim is accurate. Reframe to: no JWKS-based jose verifier exists; the closest precedent is the cert-based Gmail Pub/Sub verifier, and the unit-test scaffold to copy is real (`communication_channels/lib/__tests__/gmail-pubsub-jwt.test.ts` — `generateKeyPairSync` + fetch-mocked keys + valid/tampered/expired/wrong-aud/wrong-iss matrix). Decide explicitly: use jose for JWKS rotation rather than extending the hand-rolled verifier (recommended).
- **INV-9 framing**: state it is net-new wiring (no existing hot-path deactivation check to reuse).
- **`defaultRoleFeatures` + i18n + DS** for the admin UI (above).

### Nice-to-have gaps

- API contract sketches for the two admin endpoints.
- A short Risks & Impact section (or import this analysis's risk table).

### Non-blocking open questions (already tracked in the spec)

- App-only principal model: link to `api_keys` (default) vs a first-class `EntraServicePrincipal` entity.
- Delegated role reconciliation: first-link only vs periodic background sync.

## Remediation plan

### Before implementation (must do)

1. Rename the two tables to plural.
2. Settle the CRUD mechanism (recommend `makeCrudRoute`) and reflect optimistic-lock/indexer consequences.
3. Correct the RS256/JWKS-precedent claim; reference the real Gmail verifier + test scaffold; confirm jose-for-rotation decision.
4. Finalize (freeze) the ACL feature IDs.
5. Clarify INV-9 as net-new.

### During implementation (add to spec / honor)

1. `defaultRoleFeatures` mirror, `sso.entra.*` i18n keys, DS-compliant admin UI.
2. `findWithDecryption` for new-entity reads; plain boolean defaults; explicit UUID assignment where PKs are referenced pre-flush.
3. INV-11 RELEASE_NOTES behavior note + regression test (valid cookie + bogus Entra Bearer ⇒ cookie preserved).
4. Phase-1.2 test vectors: validly-signed non-allowlisted tenant, `alg:none`, HS256-signed-with-RSA-public-key, RS384/PS256, attacker-hosted `kid`.

### Post-implementation (follow up)

1. Consider adding `is_active` to `api_keys` for cleaner revocation than soft-delete (separate, optional).
2. Revisit the two open questions once usage patterns are known.

## Recommendation

**Needs minor spec updates first, then ready to implement.** The architecture and the security model are approved; the corrections are accuracy and consistency (table naming, RS256-precedent wording, CRUD-mechanism choice) plus additive implementation detail (setup/i18n/DS, INV-9 framing, jose pin, test vectors). No Critical/High architectural or BC blockers. After the "before implementation" list, proceed via `om-implement-spec`.
