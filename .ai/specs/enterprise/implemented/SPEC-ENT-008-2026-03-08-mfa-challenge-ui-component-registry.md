# SPEC-ENT-008: MFA Challenge UI Component Registry

## TLDR
**Key Points:**
- Add a provider-specific MFA challenge UI component registry for login challenge flows.
- Resolve challenge UI components by provider type, with deterministic fallback to generic verification UI when no custom component is registered.

**Scope:**
- New challenge UI registry in `packages/enterprise/src/modules/security/components/`.
- Refactor `MfaChallengePanel` to use the registry instead of hard-coded provider branching.
- Keep all API contracts and challenge payload contracts backward-compatible.

**Concerns:**
- Challenge preparation must stay idempotent for methods that need server-side preflight (passkey, otp email, custom providers).

## Overview
The security module already supports provider-specific setup UI via `mfa-setup-ui-registry.tsx`, but challenge verification UI in login is still hard-coded (`passkey` branch vs generic fallback). This creates coupling and blocks module-level extension for provider-specific challenge UX.

This spec introduces a challenge registry pattern aligned with setup registry behavior: component IDs are derived from provider type, components are resolved through the shared component registry (`useRegisteredComponent`), and a generic verification component is always used when no custom challenge component exists.

> **Market Reference**: Keycloak and Authentik both treat MFA methods as pluggable challenge steps while preserving fallback paths for standard OTP-style methods. We adopt the pluggability/fallback pattern and reject provider-specific hard-coding in the main panel.

## Problem Statement
Current `MfaChallengePanel`:
- hard-codes passkey verification UI in-panel,
- hard-codes generic verify UI for every non-passkey provider,
- has no dedicated extension point for provider-specific challenge rendering.

As a result:
- introducing new provider challenge UX requires editing `MfaChallengePanel`,
- provider-specific challenge logic is not composable through component replacement,
- challenge UI behavior is inconsistent with setup UI architecture.

## Proposed Solution
Implement `mfa-challenge-ui-registry.tsx` with the same pattern as setup:
- `getProviderChallengeComponentId(providerType)` returns stable component handle.
- `useProviderChallengeComponent(providerType)` resolves provider challenge component via `useRegisteredComponent`.
- Built-in map includes passkey challenge component.
- Generic fallback component (`GenericProviderVerify`) is returned when provider-specific component is not implemented.

Refactor `MfaChallengePanel`:
- keep challenge selection/error/loading orchestration in panel,
- delegate provider-specific challenge content rendering to resolved component,
- preserve existing backend API usage (`/api/security/mfa/prepare`, `/api/security/mfa/verify`) and response contracts.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Keep passkey challenge implementation as built-in registered component | Preserves existing behavior while removing hard-coded panel branching |
| Keep generic fallback in registry, not panel | Single resolution path and deterministic behavior for all providers |
| Keep component ID format provider-specific | Enables additive custom overrides per provider type |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Keep hard-coded if/else in `MfaChallengePanel` | Violates extension architecture and duplicates setup registry intent |
| Resolve components from provider interface `VerifyComponent` on client directly | Client challenge method list does not include runtime provider class instances; component registry is current extension mechanism |

## User Stories / Use Cases
- An integrator wants to provide custom challenge UI for `push_notification` so users can approve login from a mobile prompt.
- A provider without custom challenge UI should still work out of the box using generic code-entry verification.
- Enterprise security module maintainers want setup and challenge UI extension points to follow one consistent contract.

## Architecture
### Component flow
1. User selects challenge method in `MfaChallengePanel`.
2. Panel resolves `ChallengeComponent = useProviderChallengeComponent(method.type)`.
3. `ChallengeComponent` receives callback props (`onPrepare`, `onVerify`, `onResend`) and optional `clientData`.
4. If no provider-specific component is registered, `GenericProviderChallengeComponent` renders `GenericProviderVerify`.

### Component IDs
- `section:security.mfa.challenge.provider:<providerType>`

### Commands & Events
- No new commands.
- No new events.

## Data Models
No database/entity changes.

## API Contracts
No route changes.

Existing contracts preserved:
- `POST /api/security/mfa/prepare`
- `POST /api/security/mfa/verify`

Payload/response shape remains additive-compatible and unchanged.

## Internationalization (i18n)
No new mandatory keys. Existing challenge keys remain in use.

## UI/UX
- Challenge method chips remain unchanged.
- Selected method panel now renders through registry-resolved challenge component.
- Generic fallback remains code input + optional resend.
- Passkey method uses dedicated passkey challenge component with loading and browser support handling.

## Migration & Compatibility
- Backward compatible additive change.
- Contract surfaces preserved:
  - API route URLs unchanged.
  - Existing component override mechanism remains additive.
- New challenge component handle pattern is additive only.

## Implementation Plan
### Phase 1: Spec and registry foundation
1. Add enterprise spec file for challenge UI registry.
2. Add challenge registry component file with provider component ID builder and fallback.

### Phase 2: Panel refactor
1. Add built-in passkey challenge component.
2. Refactor `MfaChallengePanel` to render resolved challenge component and remove hard-coded branches.
3. Preserve current error/loading semantics and prepare/verify calls.

### Phase 3: Validation
1. Run enterprise package typecheck.
2. Run enterprise package tests relevant to security module.

### File Manifest
| File | Action | Purpose |
|------|--------|---------|
| `packages/enterprise/src/modules/security/components/mfa-challenge-ui-registry.tsx` | Create | Provider challenge component registry with generic fallback |
| `packages/enterprise/src/modules/security/components/PasskeyChallengeVerify.tsx` | Create | Built-in passkey challenge UI component |
| `packages/enterprise/src/modules/security/components/MfaChallengePanel.tsx` | Modify | Use registry-driven provider challenge rendering |
| `.ai/specs/enterprise/SPEC-ENT-008-2026-03-08-mfa-challenge-ui-component-registry.md` | Create | Spec record |

## Testing Strategy
- Type safety: `yarn workspace @open-mercato/enterprise typecheck`.
- Runtime safety: `yarn workspace @open-mercato/enterprise test`.
- Manual verification:
  - passkey challenge continues to work,
  - otp_email can resend and verify via generic fallback,
  - unknown/custom method renders generic fallback.

## Risks & Impact Review
#### Provider Component Resolution Mismatch
- **Scenario**: Provider type uses an unexpected identifier and resolves to wrong component ID.
- **Severity**: Medium
- **Affected area**: Login MFA challenge UI
- **Mitigation**: Deterministic ID builder function and generic fallback for missing registrations.
- **Residual risk**: Misnamed third-party registrations still render generic UI; custom UI not applied.

#### Challenge Preparation Race Conditions
- **Scenario**: User rapidly switches methods and submits challenge while preparation is in-flight.
- **Severity**: Medium
- **Affected area**: Challenge step UX, error handling
- **Mitigation**: Keep loading state and method-scoped callbacks in panel, preserve existing selected-method guards.
- **Residual risk**: Fast method toggling may reset error state unexpectedly; acceptable for MVP.

#### Custom Provider Without UI Contract
- **Scenario**: Provider expects richer payload than generic code input but has no custom challenge component.
- **Severity**: High
- **Affected area**: Provider-specific challenge success rate
- **Mitigation**: Explicit fallback behavior in spec; provider authors can register `section:security.mfa.challenge.provider:<type>` component.
- **Residual risk**: Provider may be functionally unusable until custom component is supplied.

## Final Compliance Report — 2026-03-08

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/enterprise/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Minimal impact changes | Compliant | No API or DB surface changes |
| root AGENTS.md | Contract surface BC rules | Compliant | Additive-only UI extension point |
| root AGENTS.md | Use package conventions and module boundaries | Compliant | Changes scoped to enterprise security components |
| `.ai/specs/AGENTS.md` | Non-trivial change should have spec | Compliant | This spec created before implementation |
| `packages/enterprise/AGENTS.md` | Keep enterprise features in enterprise package | Compliant | All implementation files under enterprise security module |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No data model changes |
| API contracts match UI/UX section | Pass | UI continues to call existing prepare/verify routes |
| Risks cover all write operations | Pass | Challenge verification flow risks documented |
| Commands defined for all mutations | Pass | No new mutations introduced |

### Verdict
- **Fully compliant**: Approved — ready for implementation

## Changelog
### 2026-03-08
- Initial specification for provider-specific MFA challenge UI component registry with generic fallback.
