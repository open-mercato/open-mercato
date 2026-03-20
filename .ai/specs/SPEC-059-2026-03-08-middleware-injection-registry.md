# SPEC-059: Frontend and Backend Middleware Injection Registry

## TLDR
**Key Points:**
- Add a generated, module-driven middleware injection mechanism for page routing, with separate frontend and backend registries.
- Keep existing built-in page checks unchanged (auth, roles, features). Migrate only MFA enrollment redirect logic into injected middleware.
- Phase 1 is page middleware only and supports only two outcomes: `continue` and `redirect`.

**Scope:**
- New module conventions:
  - `frontend/middleware.ts`
  - `backend/middleware.ts`
- New generated registries in `apps/mercato/.mercato/generated/`:
  - `frontend-middleware.generated.ts`
  - `backend-middleware.generated.ts`
- Runtime middleware executors in:
  - `apps/mercato/src/app/(frontend)/[...slug]/page.tsx`
  - `apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx`
  - `apps/mercato/src/app/(backend)/backend/page.tsx` (for parity)
- Enterprise MFA migration from hard-coded call to module middleware registration.

**Explicit Decisions (resolved):**
- Keep existing checks in route files; migrate only this logic into registry middleware:
  - lazy `createRequestContainer()`
  - `resolveMfaEnrollmentRedirect(...)`
  - `redirect(enforcementRedirect)`
- Do not include API `route.ts` middleware in this spec.
- Do not include `notFound`/`forbidden`/`rewrite` outcomes in phase 1.

## Overview
Current page catch-all routes include a mix of baseline access checks and extension-specific logic. The MFA enrollment redirect currently appears directly in app route files, which creates coupling and makes extension behavior less modular.

This spec introduces a generated registration pattern for page middleware that matches existing Open Mercato extension architecture (`api/interceptors.ts`, `notifications.ts`, `message-objects.ts`). The goal is to make redirect-oriented policies pluggable while preserving current baseline guard behavior.

> **Market Reference**: NextAuth/Auth.js middleware and Nuxt route middleware patterns both separate base auth checks from extension guards. We adopt additive guard composition and reject broad first-pass unification of all checks into one new pipeline.

## Problem Statement
- Page routing guard behavior is partially hard-coded in app entry files.
- MFA enrollment enforcement is enterprise-specific policy logic and should be extension-driven.
- There is no generated registry surface for page middleware analogous to other extension points.
- Full guard-pipeline refactoring would increase risk for ACL behavior and is not needed for this use case.

## Proposed Solution
Create two additive middleware registries for page routing:

1. `frontend/middleware.ts` for frontend route guards.
2. `backend/middleware.ts` for backend route guards.

Each module can register middleware entries with path targeting and priority. Route files execute middleware after existing built-in checks. Middleware can only:
- continue processing (`continue`)
- request navigation redirect (`redirect`)

MFA enrollment redirect logic moves from hard-coded calls in page route files to enterprise middleware entries.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Keep built-in auth/role/feature checks in place | Minimizes security regression risk and scope |
| Add separate frontend/backend registries | Matches existing split catch-all execution paths |
| Restrict phase-1 outcomes to `continue`/`redirect` | Covers MFA use case with low complexity |
| Exclude API dispatcher in phase 1 | Avoids mixing browser navigation semantics with API status semantics |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|--------------|
| Move all existing checks into new middleware pipeline now | Higher migration risk for access-control behavior |
| Single unified registry for frontend/backend/API | Different runtime semantics and larger blast radius |
| Add `forbidden`/`notFound`/`rewrite` outcomes immediately | Not required for current MFA redirect objective |

## User Stories / Use Cases
- As an enterprise module author, I want to enforce MFA enrollment redirects on page navigation without editing core app route files.
- As a platform maintainer, I want generated registration and deterministic ordering so extension behavior is predictable.
- As a security maintainer, I want baseline auth and RBAC checks untouched while adding extension redirect logic.

## Architecture
### New Conventions
- `src/modules/<module>/frontend/middleware.ts`
- `src/modules/<module>/backend/middleware.ts`

Each file exports `middleware` (or default) array with typed entries.

### Shared Types (proposed)
Location: `packages/shared/src/modules/middleware/page.ts` (or equivalent shared path).

```ts
export type PageMiddlewareMode = 'frontend' | 'backend'

export type PageMiddlewareContext = {
  pathname: string
  mode: PageMiddlewareMode
  routeMeta: {
    requireAuth?: boolean
    requireRoles?: string[]
    requireFeatures?: string[]
  }
  auth: AuthContext | null
  ensureContainer: () => Promise<AwilixContainer>
}

export type PageMiddlewareResult =
  | { action: 'continue' }
  | { action: 'redirect'; location: string }

export type PageRouteMiddleware = {
  id: string
  mode: PageMiddlewareMode
  target: string | RegExp
  priority?: number
  run: (ctx: PageMiddlewareContext) => Promise<PageMiddlewareResult> | PageMiddlewareResult
}
```

### Generated Registries
CLI generator (`packages/cli/src/lib/generators/module-registry.ts`) scans convention files and emits:
- `frontend-middleware.generated.ts`
- `backend-middleware.generated.ts`

Generated file shape mirrors existing standalone registries:
- array entries include `moduleId` + contributed middleware entries.

### Runtime Pipeline (Phase 1)
For both page catch-alls:
1. Resolve route match.
2. Run existing built-in checks (auth, role, feature) exactly as today.
3. Execute matching middleware in ascending priority (default priority if missing).
4. First `redirect` short-circuits and calls `redirect(location)`.
5. If all return `continue`, render route component.

### MFA Middleware Example
Enterprise module registers one frontend and one backend middleware entry:
- target paths where `requireAuth` is true
- call `resolveMfaEnrollmentRedirect({ auth, pathname, container: await ensureContainer() })`
- return `redirect` when non-null, otherwise `continue`

This replaces direct calls currently located in:
- `apps/mercato/src/app/(frontend)/[...slug]/page.tsx`
- `apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx`
- `apps/mercato/src/app/(backend)/backend/page.tsx`

## Data Models
No database/entity changes.

## API Contracts
No API route changes in phase 1.

Affected API paths for integration verification: none (no handler contract changes).

## UI/UX
No new visual components in phase 1.
Behavioral effect:
- frontend/backend page navigation can redirect to MFA enrollment via injected middleware.
- redirect destinations remain existing security pages.

## Migration & Compatibility
### Contract Surfaces Affected
- Auto-discovery conventions: additive new optional files (`frontend/middleware.ts`, `backend/middleware.ts`).
- Generated file contracts: additive new generated files imported by app bootstrap/runtime wiring.

### Compatibility Rules
1. Existing page route behavior remains identical when no middleware entries are registered.
2. Existing built-in checks remain in route files (no behavior migration in phase 1).
3. Middleware evaluation order is deterministic via priority.
4. Only additive extension behavior is introduced.
5. No API or DB contract changes.

### Rollout Strategy
- Phase 1 keeps hard-coded MFA logic in place behind temporary dual-path guard during validation.
- After parity tests pass, remove hard-coded calls and rely on middleware registrations.

## Implementation Plan
### Phase 1: Shared Contract + Generator
1. Add shared page middleware types and matcher utilities in `@open-mercato/shared`.
2. Extend module registry generator to scan `frontend/middleware.ts` and `backend/middleware.ts`.
3. Emit `frontend-middleware.generated.ts` and `backend-middleware.generated.ts`.
4. Add checksum outputs and generation tests.

### Phase 2: Runtime Execution in App Routes
1. Add page middleware executor utility (matching + priority sort + first terminal redirect).
2. Wire executor into:
   - `apps/mercato/src/app/(frontend)/[...slug]/page.tsx`
   - `apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx`
   - `apps/mercato/src/app/(backend)/backend/page.tsx`
3. Preserve existing checks and execution order.

### Phase 3: MFA Migration to Middleware
1. Add enterprise middleware entries for MFA enforcement redirect.
2. Validate parity against current redirect behavior.
3. Remove direct `resolveMfaEnrollmentRedirect(...)` calls from app route files.

### Phase 4: Verification and Hardening
1. Add integration tests for frontend/backend redirect branches.
2. Add negative cases (non-authenticated and non-MFA users unchanged behavior).
3. Document convention in relevant AGENTS/docs.

### File Manifest
| File | Action | Purpose |
|------|--------|---------|
| `packages/shared/src/modules/middleware/page.ts` | Create | Shared page middleware types/contracts |
| `packages/shared/src/lib/middleware/page-executor.ts` | Create | Matcher + executor runtime utility |
| `packages/cli/src/lib/generators/module-registry.ts` | Modify | Scan and emit middleware registries |
| `apps/mercato/.mercato/generated/frontend-middleware.generated.ts` | Generate | Frontend middleware registry |
| `apps/mercato/.mercato/generated/backend-middleware.generated.ts` | Generate | Backend middleware registry |
| `apps/mercato/src/app/(frontend)/[...slug]/page.tsx` | Modify | Execute frontend middleware after built-in checks |
| `apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx` | Modify | Execute backend middleware after built-in checks |
| `apps/mercato/src/app/(backend)/backend/page.tsx` | Modify | Execute backend-index middleware for parity |
| `packages/enterprise/src/modules/security/frontend/middleware.ts` | Create/Modify | Register frontend MFA redirect middleware |
| `packages/enterprise/src/modules/security/backend/middleware.ts` | Create/Modify | Register backend MFA redirect middleware |

## Integration Test Coverage
### API Paths
- None changed in phase 1.

### UI Paths
- `/backend`
- `/backend/*` protected pages
- `/*` frontend protected pages resolved via catch-all

### Required Cases
1. Authenticated user requiring MFA enrollment is redirected by frontend middleware.
2. Authenticated user requiring MFA enrollment is redirected by backend middleware.
3. Authenticated user not requiring MFA is not redirected.
4. Unauthenticated flow remains governed by existing built-in checks.
5. Route role/feature checks still run unchanged when middleware returns `continue`.

## Risks & Impact Review
#### Middleware Ordering Conflict
- **Scenario**: Multiple middleware entries match the same path and request different redirect targets.
- **Severity**: High
- **Affected area**: Frontend/backend navigation
- **Mitigation**: Deterministic priority ordering, first-terminal-wins, explicit docs for priority policy.
- **Residual risk**: Module authors can still assign conflicting priorities.

#### Access-Control Regression
- **Scenario**: Middleware insertion accidentally alters existing auth/role/feature gate behavior.
- **Severity**: Critical
- **Affected area**: Security and authorization
- **Mitigation**: Keep built-in checks intact in phase 1, add regression tests for unchanged behavior.
- **Residual risk**: Low after parity tests; medium before complete regression suite.

#### Container Lifecycle Misuse
- **Scenario**: Middleware creates containers unnecessarily on hot paths.
- **Severity**: Medium
- **Affected area**: Request performance
- **Mitigation**: `ensureContainer()` lazily invoked only by middleware that needs DI.
- **Residual risk**: Low; depends on module middleware quality.

#### Silent Middleware Failure
- **Scenario**: Middleware throws and blocks page rendering or causes generic 500.
- **Severity**: High
- **Affected area**: Navigation availability
- **Mitigation**: Define executor error policy (fail-closed with explicit logging) and test behavior.
- **Residual risk**: Medium if extension middleware is poorly implemented.

#### API/Page Semantics Drift
- **Scenario**: Developers expect route API middleware support in this feature and misuse page middleware for API concerns.
- **Severity**: Medium
- **Affected area**: Developer experience
- **Mitigation**: Explicitly scope phase 1 to page catch-alls only; document API phase as future work.
- **Residual risk**: Low with clear docs.

## Final Compliance Report — 2026-03-08

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/cli/AGENTS.md`
- `.ai/specs/AGENTS.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Simplicity first and minimal impact | Compliant | Keeps existing checks unchanged; migrates only MFA redirect logic |
| root AGENTS.md | No direct ORM relationships between modules | Compliant | No data model changes |
| root AGENTS.md | Backward compatibility on contract surfaces | Compliant | Additive conventions and generated files only |
| packages/core/AGENTS.md | Auto-discovery conventions and module-driven extension | Compliant | Adds optional convention files with generator discovery |
| packages/shared/AGENTS.md | Shared package must remain domain-agnostic | Compliant | Shared additions are generic middleware contracts/utilities |
| packages/cli/AGENTS.md | Generator changes must emit to `.mercato/generated/` | Compliant | New generated outputs follow existing pattern and checksums |
| .ai/specs/AGENTS.md | Required non-trivial spec sections present | Compliant | Includes TLDR, architecture, risks, compliance, changelog |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No data/API schema changes |
| API contracts match UI/UX section | Pass | API untouched; UX change is page redirect behavior |
| Risks cover all write operations | Pass | No new write path; runtime risks documented |
| Commands defined for all mutations | Pass | No mutation command scope in this feature |
| Cache strategy covers all read APIs | N/A | No read API contract changes |

### Non-Compliant Items
- None.

### Verdict
- **Fully compliant**: Approved - ready for implementation.

## Changelog
### 2026-03-08
- Created initial skeleton with open questions.
- Resolved decisions:
  - keep existing built-in checks in page routes
  - migrate only MFA enrollment redirect logic to middleware registry
  - scope phase 1 to page middleware only
  - support only `continue`/`redirect` outcomes
- Expanded to full implementation-ready specification.

### Review - 2026-03-08
- **Reviewer**: Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed (N/A scope)
- **Commands**: Passed (N/A scope)
- **Risks**: Passed
- **Verdict**: Approved

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1: Shared Contract + Generator | Done | 2026-03-08 | Added shared middleware contracts/executor, CLI discovery for `frontend/backend/middleware.ts`, and generated frontend/backend middleware registries with checksums |
| Phase 2: Runtime Execution in App Routes | Done | 2026-03-08 | Wired middleware execution into frontend/backend catch-all routes and backend index route after existing built-in checks |
| Phase 3: MFA Migration to Middleware | Done | 2026-03-08 | Added enterprise security middleware registrations and removed hardcoded MFA redirect calls from route files |
| Phase 4: Verification and Hardening | In Progress | 2026-03-08 | Added unit tests for executor and generator coverage; integration tests for page redirects are pending |

### Phase 1 — Detailed Progress
- [x] Step 1: Add shared page middleware types and matcher/executor utilities
- [x] Step 2: Extend module registry generator for frontend/backend middleware conventions
- [x] Step 3: Emit `frontend-middleware.generated.ts` and `backend-middleware.generated.ts`
- [x] Step 4: Add generator test coverage for new middleware registries

### Phase 2 — Detailed Progress
- [x] Step 1: Add middleware executor calls in frontend catch-all
- [x] Step 2: Add middleware executor calls in backend catch-all
- [x] Step 3: Add middleware executor calls in backend index route
- [x] Step 4: Keep existing built-in auth/roles/features checks intact

### Phase 3 — Detailed Progress
- [x] Step 1: Add enterprise frontend middleware entry for MFA redirect
- [x] Step 2: Add enterprise backend middleware entry for MFA redirect
- [x] Step 3: Remove direct MFA enforcement redirect calls from route files
- [x] Step 4: Keep lazy `createRequestContainer()` behavior via `ensureContainer()`

### Phase 4 — Detailed Progress
- [x] Step 1: Add shared unit tests for matcher/executor ordering and failure behavior
- [x] Step 2: Update backend route unit test to validate MFA redirect through middleware registry
- [x] Step 3: Run targeted package tests (`shared`, `cli`, `app`) and `yarn generate`
- [ ] Step 4: Add/execute Playwright integration tests for frontend/backend redirect parity scenarios
