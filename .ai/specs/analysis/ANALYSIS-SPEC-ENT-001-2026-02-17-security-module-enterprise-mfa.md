# Pre-Implementation Analysis: SPEC-ENT-001-2026-02-17-security-module-enterprise-mfa

## Executive Summary
The spec is directionally strong and detailed, but it is **not implementation-ready** without updates. There are critical contract and architecture gaps around auth-login interception semantics, backward compatibility documentation, and API/UI contract consistency. Recommendation: **needs spec updates first** before continuing implementation.

## Backward Compatibility

### Violations Found
| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | API route URLs (7) | Spec changes effective behavior of `POST /api/auth/login` response shape on success (may omit/replace expected fields like `redirect` when MFA is required) without defining compatibility guarantees for existing clients. | Critical | Define compatibility contract: preserve existing fields where possible (`redirect` nullable/additive), document MFA branch schema explicitly in OpenAPI, and add migration notes for API consumers. |
| 2 | Function signatures (3) | `requireSudo` is presented as throwing domain errors handled by a "global error handler", but no stable error contract/function signature is specified for consumers across packages. | Warning | Specify stable exported error type + response contract in shared docs and preserve it as public API; include deprecation plan for any future changes. |
| 3 | Event IDs (5) | Event naming is inconsistent across sections (`security.mfa.method.added` vs `security.mfa.enrolled`; `security.mfa.method.removed` vs `security.mfa.removed`). This creates implicit renames/removals risk. | Critical | Freeze one canonical event set in `events.ts` (`createModuleEvents`) and include alias/dual-emit policy for legacy IDs in a migration subsection. |
| 4 | ACL feature IDs (10) | Feature IDs are inconsistent (`security.admin.mfa-reset`, `security.admin.manage`, `security.admin.mfa.reset` appears in command ID context). Risk of persisted ACL drift. | Critical | Define one frozen feature map in spec appendix; prohibit alternate spellings; if changed later, require DB migration plan. |
| 5 | Import paths (4) | Public export examples use `@open-mercato/enterprise/security` and `@open-mercato/enterprise/security/components`, but spec does not define re-export stability if internal paths change. | Warning | Add explicit "public import surface" section and require re-export bridges for moved files. |
| 6 | Generated file contracts (13) | Spec introduces new auto-discovery assets and mentions bootstrap scanning (`mfaProviders`, `sudoProtected`) but does not define generated contract impact or additive guarantees. | Warning | Add explicit generated-contract compatibility note (additive-only changes to generated registries and bootstrap data). |

### Missing BC Section
The spec does **not** include a dedicated **"Migration & Backward Compatibility"** section required by `BACKWARD_COMPATIBILITY.md`. Add this before implementation continues.

## Spec Completeness

### Missing Sections
| Section | Impact | Recommendation |
|---------|--------|---------------|
| TLDR & Overview | Harder to validate scope quickly; review/approval latency | Add a concise TLDR with goals, non-goals, and success criteria. |
| Problem Statement (explicit) | Context exists but no strict problem framing and constraints | Add explicit problem statement with current-state pain and measurable outcomes. |
| Proposed Solution (explicit) | Design exists across many sections but no single authoritative solution summary | Add one canonical proposed solution section linking to architecture and phases. |
| Final Compliance Report | No checklist closure against AGENTS/BC gates | Add final compliance table with pass/fail and owners. |
| Changelog | No traceability for future updates | Add changelog section with dated entries and rationale. |
| Migration & Backward Compatibility | Required by BC contract for contract-surface changes | Add explicit migration paths for API response branch changes, login extensibility additions, and event ID stabilization. |

### Incomplete Sections
| Section | Gap | Recommendation |
|---------|-----|---------------|
| API Contracts | Interceptor-based login rewrite lacks cookie/header mutation semantics; body-only rewrite is insufficient for auth cookie correctness | Define how token/cookie are synchronized in MFA-required branch; include exact header/cookie behavior. |
| UI/UX | Some examples use raw `fetch` and raw `<button>` contrary to UI package rules | Update examples to `apiCall` and `Button`/`IconButton`; document keyboard shortcuts for dialogs. |
| Commands/Undo | Some endpoints marked undoable/non-undoable, but compensation details are incomplete | Add per-command undo payload and compensation strategy matrix. |
| Testing | Integration scenarios are broad but missing explicit API-path-to-test mapping and failure mode assertions for interception/cookie behavior | Add route-by-route test matrix and acceptance criteria for each phase. |

## AGENTS.md Compliance

### Violations
| Rule | Location | Fix |
|------|----------|-----|
| Use `apiCall`/`apiCallOrThrow`, never raw `fetch` for backend/UI flows | Section 15.5 frontend example uses `fetch` | Replace examples and implementation guidance with `apiCall` wrappers. |
| MUST use `Button`/`IconButton`, never raw `<button>` | Section 15.5 example uses raw `<button>` | Update all UI snippets/patterns to approved primitives. |
| Events should use `createModuleEvents()` typed config | Section 12.4 shows plain object map style | Replace with canonical `createModuleEvents({ moduleId, events })` shape and frozen IDs. |
| Interceptor route matching convention (`targetRoute` normalized path, no ambiguity) | Section 14.1 uses `targetRoute: '/api/auth/login'` while platform examples use normalized route keys (e.g. `auth/login`) | Normalize and document one accepted pattern; enforce via spec examples/tests. |
| No `any` types in implementation guidance | Sections 6, 12.3 include `z.any()` and `container: any` examples | Replace with typed payload schemas and concrete Awilix types. |
| Tenant/org encrypted query guidance (`findWithDecryption`) missing for sensitive queries | Service/data access sections do not consistently mandate decryption helpers | Add explicit query rules per service and examples with tenant/org scope. |

## Risk Assessment

### High Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Login interception semantics are underspecified for cookie/token issuance | MFA bypass or immediate full login despite challenge requirement | Specify and test response+cookie behavior for MFA branch; include regression tests for `auth_token` values and redirects. |
| Event/feature ID inconsistency across spec sections | Persistent contract drift (ACL/event subscribers break) | Freeze canonical IDs in one appendix and lint/check against it during implementation. |
| Cross-surface auth changes without explicit BC migration section | Third-party modules/clients may break silently | Add migration chapter + release-note obligations before merge. |

### Medium Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Over-reliance on interceptor pattern for non-CRUD/custom API routes | Behavior differs by route type and can be missed | Define one global interception execution model (CRUD + custom) and test both. |
| Pluggable provider metadata schema is open-ended JSONB | Validation/security variance across providers | Require provider-level Zod schemas + runtime validation and audit logging gates. |
| Sudo UX and security token handling complexity | User friction or accidental lockouts | Add explicit fallback flows, retry limits, and operator recovery playbook. |

### Low Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Additional dependencies (`qrcode`, WebAuthn libs) | Build/runtime footprint increase | Pin versions, add compatibility tests and browser capability checks. |
| Expanded admin surfaces | Operational complexity | Provide concise admin docs and guard rails in UI. |

## Gap Analysis

### Critical Gaps (Block Implementation)
- Migration & backward compatibility section missing: required by repository BC contract.
- Login interception contract incomplete: no authoritative spec for cookie/header mutation behavior in MFA branch.
- Canonical frozen IDs missing: events/features are inconsistent across sections.

### Important Gaps (Should Address)
- API path normalization for interceptors is ambiguous (`/api/auth/login` vs `auth/login`).
- AGENTS compliance mismatches in UI/API examples (`fetch`, raw buttons, `any` usage).
- Missing explicit cache invalidation/search-index impact notes for security entities/events.
- Missing queue/scheduler operational details for cleanup jobs (sudo sessions, challenge expiry housekeeping).

### Nice-to-Have Gaps
- Add sequence diagrams for login-MFA and sudo flows.
- Add observability section (structured logs/metrics per challenge state).
- Add rate-limit storage/failure-mode notes (Redis unavailable behavior).

## Remediation Plan

### Before Implementation (Must Do)
1. Add **Migration & Backward Compatibility** section: cover API branch changes, event/feature ID freeze, and compatibility bridge expectations.
2. Define canonical IDs table: event IDs, ACL features, injection IDs, public import paths.
3. Finalize login contract: exact response schema + cookie behavior for MFA-required and non-MFA paths.
4. Normalize interceptor routing convention in spec and examples.

### During Implementation (Add to Spec)
1. Add per-endpoint command/undo matrix with compensation details and non-undoable rationale.
2. Add explicit encrypted-query guidance (`findWithDecryption`) per security service.
3. Add route-by-route integration matrix (API + UI) with expected status/body/cookie assertions.

### Post-Implementation (Follow Up)
1. Publish release notes for any contract-surface additions (new event IDs, injection handles, auth response branch behavior).
2. Add regression tests protecting frozen IDs and login interception semantics.
3. Run code-review checklist audit and record final compliance in spec changelog.

## Recommendation
**Needs spec updates first.**
Proceed only after BC/migration documentation, canonical contract IDs, and login interception/cookie semantics are explicitly resolved in the spec.
