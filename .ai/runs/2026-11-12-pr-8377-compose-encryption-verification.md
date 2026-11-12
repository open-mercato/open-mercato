# Execution plan — PR #8377 deployment encryption verification

Origin: adopted by `om-auto-continue-pr` on 2026-11-12; the PR had no tracking plan.
PR: #8377 · Branch: `fix/issue-7231-compose-encryption-key` · Base: `main`

## Goal
Resolve inherited conflicts and review findings, verify the production Compose safety boundary in Docker, publish current-head evidence, and record QA results as requested by the operator.

## Scope
The existing encryption preflight, key generation in monorepo/CLI/standalone setup, their regressions, and deployment migration/recovery guidance.

## Non-goals
No production database changes, live-secret access, runtime crypto changes, release, merge, or automatic installation-wide migration. A human security waiver remains distinct from QA.

## Evidence
- Issue #7231 and `.ai/specs/2026-11-01-7231-compose-encryption-key.md`: reject published active keys before application startup; preserve strong operator keys.
- Reviews 5830733366 and 5873333259: selected-key preservation, main conflicts, and named human Emergency Security Exception acknowledgment.
- CI follow-up on PR #8377 and commit `865ae2130306b4d56bf5ab5c17b7a6ef452c5d42`: standalone fixture dependency and compatibility-context budget fixes.
- Current operator request: Docker verification, a PR evidence comment, and `qa-approved` after successful QA.

## Assumptions
The operator explicitly authorized continuing the existing fix and verification scope; adoption does not require a separate implementation decision. Synthetic isolated recovery rehearsal cannot certify any actual installation or live Vault policy.

## Risks
Published/weak-root deployments must remain in maintenance until all ciphertext and lookup hashes are migrated and recovery is verified. Approval must not imply production data was migrated.

## Progress

### Phase 1: Already landed on this PR

- [x] 1.1 Resolve conflicts, preserve selected encryption roots, and fix standalone setup fixtures and compatibility-context budget — 865ae2130306b4d56bf5ab5c17b7a6ef452c5d42

### Phase 2: Verify and review

- [ ] 2.1 Exercise shipped Compose startup boundaries and key generation in Docker; rehearse synthetic recovery and rollback.
- [ ] 2.2 Inspect the configured gate and perform the authoritative review; publish evidence and record the applicable QA outcome.
- [ ] 2.3 Record named human Emergency Security Exception acknowledgment, or retain its explicit merge blocker.
