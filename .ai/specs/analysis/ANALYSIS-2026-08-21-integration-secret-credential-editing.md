# Pre-Implementation Analysis: Integration Secret Credential Editing

## Executive Summary

The revised specification is ready to implement. The first draft would have changed the stable full-blob PUT contract by treating every omitted secret as unchanged; the audited design removes that blocker by adding a bounded, optional `unchangedSecretFields` intent list, retaining default clear/full-replacement semantics, preserving the raw masked widget context, and covering both direct and bundle credential editors.

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
| --- | --- | --- | --- | --- |
| — | None in the revised design | No public surface is removed, renamed, narrowed, or given a new required input. | — | Implement the additive request field and trailing optional helper argument exactly as specified. |

### Missing BC Section

None. The spec audits every protected surface and explicitly preserves route/method/response keys, the GET sentinel, exact-sentinel PUT compatibility, plain omission/full replacement, `{ credentials: {} }` clear-all, explicit empty-string clear, DI/ACL/event/widget IDs, schema, imports, and generated contracts.

### Compatibility Evidence

- `TC-INT-004.spec.ts` documents and tests `{ credentials: {} }` as a valid clear-all request.
- `TC-INTEG-CRUDFORM-001.spec.ts` documents credentials PUT as a full-blob upsert, although its claim that every credential is returned decrypted verbatim is stale after issue #2253 and must be corrected.
- The direct detail page publishes raw masked `credentialValues` in the `integrations.detail.v1` injection context. The revised spec keeps that value unchanged and derives separate form initial values.
- `storage_s3` deliberately deletes access-key credentials when switching to ambient mode. The revised explicit list lets that omission continue clearing instead of being restored.

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
| --- | --- | --- |
| None | All required sections are present or marked N/A with rationale. | No change. |

### Incomplete Sections

| Section | Gap | Recommendation |
| --- | --- | --- |
| None | Acceptance, architecture/extension mode, data, API, permissions, UI/i18n, failure behavior, rollout/BC, frontend contract, test coverage, risks, phasing, compliance, status, and changelog are implementation-ready. | No change. |

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
| --- | --- | --- |
| None in the revised design | — | Apply the implementation plan without broad page refactors or provider-specific core branches. |

### Key Compliance Decisions

- Core placement is justified because generic host/form/server behavior cannot be repaired by a provider extension.
- Existing auth, feature guards, organization resolution, tenant scope, encryption service, mutation guards, optimistic locking, event emission, `CrudForm`, `PasswordInput`, `apiCall`, and `useGuardedMutation` remain in place.
- No entity, migration, encryption map, cache, search, event, ACL, DI, notification, CLI, or generated-file change is proposed.
- All new request data is Zod-validated and bounded.
- All new copy is planned for `de`, `en`, `es`, `ko`, and `pl`.
- The bundle page's touched secret control moves to `PasswordInput`; touched DS violations must be corrected under the Boy Scout rule without expanding into a full page rewrite.

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Plain omission semantics accidentally change | Existing clients could fail to clear credentials. | Preserve full replacement by default; preserve only schema-declared secrets named in the optional unchanged list. |
| Raw widget context changes | Third-party integration-detail widgets could receive empty values instead of the existing sentinel map. | Keep raw masked `credValues` for `integrations.detail.v1`; derive separate `CrudForm` values. |
| `storage_s3` ambient switch retains access-key secrets | Health checks can reject the configuration and stored secrets remain unexpectedly. | Exclude deliberate clear fields from `unchangedSecretFields`; verify the branch in regression tests. |
| Existing hybrid-corrupted values remain | Affected integrations continue failing auth until rotation. | Provide an obvious replacement path and configured hint; do not pattern-delete arbitrary encrypted secrets that cannot be distinguished safely. |
| Bundle editor remains vulnerable | Shared bundle secrets can still expose/edit the sentinel. | Include the duplicate bundle form in the same capability and shared helper contract. |

### Medium Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Forged unchanged names retain unrelated data | A caller might try to preserve undeclared/non-secret fields. | Bound the list and intersect it with trusted provider schema secret types; explicit values win. |
| Stale configured-state response | UI validation could treat a concurrently cleared secret as configured. | Existing optimistic lock rejects the stale save; test the conflict path remains intact. |
| Provider help text is replaced | Operators lose setup guidance. | Append the configured hint to existing descriptions instead of replacing them. |
| Existing integration tests restore masked data unsafely | Tests can overwrite meaningful credentials. | Prefer deterministic API interception/disposable fixtures and correct stale test descriptions/assertions. |

### Low Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Page size/client blob grows slightly | Existing client roots remain large. | Add no dependency/provider and keep pure transformations in one small shared helper. |
| Password managers autofill replacement fields | Unintended secret changes. | Use `autoComplete="new-password"` on touched secret inputs. |

## Gap Analysis

### Critical Gaps (Block Implementation)

None after the spec revision.

### Important Gaps (Should Address)

- Correct stale integration-test descriptions that claim provider-declared secrets are returned verbatim or that omission always means unchanged.
- Explore the live page before finalizing Playwright selectors, then keep the executable browser test module-local and deterministic.
- Cover direct detail, bundle detail, helper, validator, route, clear-all, sentinel compatibility, explicit clear, replacement, widget-context stability, and `storage_s3` deliberate clear behavior.

### Nice-to-Have Gaps

- A future separate UX could add an explicit “Clear stored secret” control. It is not required for #5421 because the existing API clear contract remains available and this change is scoped to safe replacement.
- A future migration may retire the GET sentinel after a deprecation window; this fix intentionally preserves it.

## Remediation Plan

### Before Implementation (Must Do)

1. Use the revised additive unchanged-field intent rather than global omission preservation.
2. Keep raw masked direct-page credentials separate from sanitized form values.
3. Include the bundle credential editor in the change.

### During Implementation (Add to Spec)

1. Record exact changed files and focused validation evidence in implementation status.
2. Update test comments/assertions where the preserved full-replacement contract makes current prose inaccurate.
3. Apply the DS Boy Scout rule to every touched bundle-page line.

### Post-Implementation (Follow Up)

1. Run required checks, configured gate, live browser regression, DS review, and fresh exact-diff review.
2. Do not attempt automatic cleanup of pre-existing hybrid secrets; report manual rotation as residual operational risk.

## Recommendation

**Ready to implement.** The revised spec closes the sentinel-editing defect without a breaking API/default behavior change and includes the necessary compatibility, security, UI, and regression-test gates.
