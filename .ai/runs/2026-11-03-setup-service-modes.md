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

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Implementation
- [x] 1.1 Implement shared service modes and ephemeral lifecycle — 598ac65f0
- [x] 1.2 Integrate both setup entrypoints and recovery guidance — 598ac65f0
- [ ] 1.3 Verify configured service credentials before database setup
### Phase 2: Verification
- [ ] 2.1 Validate regression suites and template parity
- [ ] 2.2 Review and publish the result
