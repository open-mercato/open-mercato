# Setup service choices

## Goal
Make monorepo and standalone setup reuse configured services by default, with explicit or interactive alternatives for isolated Testcontainers services and randomized Compose ports.

## Scope
Shared service-mode helper, monorepo starter and standalone template integration, matching env/URL updates, failure recovery instructions and generated next steps, focused regression tests.

## Non-goals
No migrations on shared services during verification, no registry publishing, no replacement of the integration runner, no changes to production deployment.

## Implementation Plan
### Phase 1: Implementation
1.1 Implement shared mode selection, synchronized configuration, and ephemeral lifecycle.
1.2 Wire monorepo and standalone setup, manual recovery instructions, and generator guidance.
1.3 Verify PostgreSQL queries, every configured Redis consumer and the protected Meilisearch API before database mutation; reject invalid credentials safely.
### Phase 2: Verification
2.1 Add and run focused regression suites and parity checks.
2.2 Review the final diff and publish validation evidence and limitations.

## Risks
Explicit isolated modes replace service endpoints; preserve existing credentials in Compose mode and restore previous configuration after ephemeral service cleanup. Reuse mode must perform zero Docker calls. Do not log URLs containing credentials.

### Phase 3: Security remediation
3.1 Require exact-target acknowledgement before remote database writes while preserving local/default reuse.
3.2 Bind isolated services to loopback, pin setup images, and generate independent owned local credentials.
3.3 Verify security regressions and live isolated services, then request a fresh security review.

## Verification

Package builds, generation, translation sync/usage, typecheck (42 tasks), and the optimized app build pass locally. The full test run passed 49 tasks; after a fixture-local CommonJS manifest corrected sandbox execution of fake runners, the create-app suite passed 1,022 tests with 6 skipped and no failures. The final affected suite passed 179/179, and template parity is clean.

Disposable real-service checks verified Testcontainers and randomized Compose PostgreSQL/Redis/Meilisearch connections. The standalone setup wrapper rejected bad PostgreSQL credentials, an invalid secondary Redis password and a bad Meilisearch API key before the dev/database runner, without printing supplied secrets. Ephemeral database-name persistence and no-update-env cleanup passed. Native macOS listener PID and TTY color diagnostics passed. The actual standalone app scripts and imports were refreshed and checked while its .env remained unchanged.

The automated review has no actionable findings and is recorded at https://github.com/open-mercato/open-mercato/pull/8613#issuecomment-6606293282. GitHub rejected author self-approval; independent approval and final-head CI remain required. No shared database was migrated, initialized, or reinstalled.

## Progress
PR: #8613

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Implementation
- [x] 1.1 Implement shared service modes and ephemeral lifecycle — 598ac65f0
- [x] 1.2 Integrate both setup entrypoints and recovery guidance — 598ac65f0
- [x] 1.3 Verify configured service credentials before database setup — fa33b75b4
### Phase 2: Verification
- [x] 2.1 Validate regression suites and template parity — 92cfee9fe
- [x] 2.2 Review and publish the result — 92cfee9fe

### Phase 3: Security remediation
- [x] 3.1 Guard remote database writes with explicit target acknowledgement — 53d618867
- [x] 3.2 Secure isolated bindings, images and independent local credentials — a9fde8bfb
- [x] 3.3 Verify and publish the security remediation — a9fde8bfb

Security remediation verification: 208 targeted tests pass with no skips; an independent read-only reviewer passed 50 security-focused tests and verified all five multiarch image digests. Real random and ephemeral services were inspected for loopback bindings and digest pins; authenticated connections, negative credential cases, owned-secret random reruns and cleanup passed. Fresh review: https://github.com/open-mercato/open-mercato/pull/8613#issuecomment-6612549442. The original full-gate/CI baseline is green; replacement-head CI remains pending. No further CI watch is claimed.
