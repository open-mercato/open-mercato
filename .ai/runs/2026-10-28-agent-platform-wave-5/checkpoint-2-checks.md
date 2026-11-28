# Checkpoint 2 — Steps 2.1..2.7 (Identity P2 + tool ACL) — safety stop

- **When:** 2026-10-28T04:42:57Z
- **Steps:** 2.1–2.7 + 2.7-review-fix (`233d80418`..`70928a467`)
- **Why now:** ~20 consecutive Steps since the run start → safety checkpoint for user review.

| Check | Result |
|---|---|
| `yarn typecheck` | pass |
| `npx jest src/modules/agent_orchestrator` | pass — 238 suites, 2604 tests |
| `npx jest src/security` (shared) | pass — 48 tests |
| core auth + guards (`src/modules/auth`, `optimistic-lock-command-coverage`, `feature-policy-authorization-coverage`, `acl-feature-catalog.i18n`) | fail → fixed in **2.7-review-fix** → pass (964 tests) |
| `yarn build:app --force` | pass |
| Integration on a fresh ephemeral app: `TC-AGENT-INT-*`, `TC-AGENT-ACC-*`, OAuth/token specs | 14 passed, 2 skipped (need an LLM provider) |

Findings:
- **Core guard violations (fixed in 2.7-review-fix):** `authorizationStateWriterCoverage` required `lockAuthorizationState` in `agentPrincipalService.ts`; after Step 2.3 neither it nor `syncAgentPrincipals.ts` writes authorization state (they delegate to core `provisionExecutionPrincipal`, which locks) — guard retargeted with a no-direct-ACL-imports assertion. `feature-policy-authorization-coverage` flagged `resolveEffectiveToolAcl.ts` → pure intersection moved to `toolAclGrantIntersection.ts` (allowlisted as grant computation).
- **1.11-review-fix verified visually:** `checkpoint-2-artifacts/screenshot-trace-integrity-review-hold-fixed.png` — guardrail rows wrap, labels readable.
- Behavior changes to note for the PR: identity OAuth routes public (they authenticate and rate-limit themselves); runs of agents with a principal act as the principal on behalf of the human; eval replay tools run on the operator's grants in `caller` mode; legacy shared `agent:<id>` role ACL org list follows the last provisioning org.
