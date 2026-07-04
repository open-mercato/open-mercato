# Step 4 — Final Verification, Subagent Strategy & Rules

## Verification

After all targeted phases are complete:

1. **Generate check**: `yarn generate` — must complete without errors
2. **Type check**: `yarn typecheck` — must pass (if available)
3. **Build check**: `yarn build` — must pass
4. **Unit test check**: `yarn test` — must pass
5. **Integration test check**: run any new integration tests — must pass
6. **Migration check**: `yarn db:generate` — if any entities changed (verify the resulting SQL is scoped correctly; manual SQL is acceptable only when avoiding unrelated churn, and the touched `.snapshot-open-mercato.json` must match)

Report results to the user. If any check fails, fix and re-verify.

## Subagent Strategy

| Task | Agent Type | When |
|------|-----------|------|
| Research existing patterns | Explore | Before implementing unfamiliar patterns |
| Implement independent files | general-purpose | When files have no dependencies on each other |
| Run tests | Bash | After each phase |
| Self-review | general-purpose | After each phase, against checklist |
| Integration tests | general-purpose | After phases with API/UI changes |

**Concurrency rule**: Launch parallel subagents only for truly independent work. Sequential for dependent files.

## Rules

- MUST read the full spec before starting implementation
- MUST read all guides and skills listed in the Task → Context Map before coding
- MUST pass every applicable code-review checklist item before marking a phase done
- MUST update the spec with implementation progress after each phase
- MUST run `yarn build` after final phase to verify no build breaks
- MUST create unit tests for all new behavioral code
- MUST create or propose integration tests for phases with API endpoints or UI flows
- MUST NOT skip the self-review step — it is the quality gate
- MUST NOT introduce `any` types, hardcoded strings, raw `fetch`, or other anti-patterns
- MUST keep subagents focused — one task per subagent, clear boundaries
- MUST report blockers to the user immediately rather than working around them silently
- MUST run `yarn generate` after creating or modifying module convention files
- MUST run `yarn db:generate` after creating or modifying entities (and confirm migration with user before applying)
