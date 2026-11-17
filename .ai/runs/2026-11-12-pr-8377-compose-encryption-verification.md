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

- [x] 2.1 Exercise shipped Compose startup boundaries and key generation in Docker; rehearse synthetic recovery and rollback. — 7854878b9d755bd8f3d36940f027fff3b4db7dd8
- [x] 2.2 Inspect the configured gate and perform the authoritative review; publish evidence and record the applicable QA outcome. — 7854878b9d755bd8f3d36940f027fff3b4db7dd8
- [ ] 2.3 Record named human Emergency Security Exception acknowledgment, or retain its explicit merge blocker.

## 2026-11-12 verification and handoff

- Docker evidence: 212 passed, 0 failed, 0 skipped. Node 24.22.2 arm64; Compose 5.6.1. Includes six real Compose startup cases, helper/starter/CLI/standalone regressions, runtime KMS/lookup checks, and six synthetic recovery scenarios with an isolated PostgreSQL fixture. All fixture containers/networks were removed.
- Durable verification: https://github.com/open-mercato/open-mercato/pull/8377#issuecomment-6823649248
- Pinned evidence source/logs: https://github.com/open-mercato/open-mercato/tree/6eae2b06cb0404c0113d91426003e52c4987b4cb
- Authoritative re-review: https://github.com/open-mercato/open-mercato/pull/8377#issuecomment-6823664795. GitHub rejects formal self-review; the verdict is recorded as a comment. An independent read-only reviewer found no new blocking implementation defect.
- Application source remains exactly 865ae2130306b4d56bf5ab5c17b7a6ef452c5d42; this continuation commits tracking documentation only. Its exact implementation CI 43210358561 passed. CI for documentation commits is separate and must settle before merge; scoped skips (including app build) are not passes.
- `qa-approved` and `qa-self-verified` were applied after evidence under the explicit operator request and repository self-QA exception. The synthetic rehearsal is not a certification of a live installation, complete production inventory, rotation CLI, full login, real dump/restore tools or Vault connectivity. Operators still must rehearse their own migration and recovery.
- First remaining step: 2.3. Named human Emergency Security Exception acknowledgment is still pending; `changes-requested` remains. Resume with `/om-auto-continue-pr 8377` after the acknowledgment is recorded. No merge or production database change occurred.
