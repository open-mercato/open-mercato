# Step 3 — Self-Review Gate & Progress Tracking

## Self-Review (Code-Review Gate)

Before marking a phase complete, run a self-review against the checklist (`.ai/skills/om-code-review/references/review-checklist.md`):

1. **Architecture & Module Independence** (section 1)
2. **Security** (section 2)
3. **Data Integrity & ORM** (section 3)
4. **API Routes** (section 4) — if applicable
5. **Events & Commands** (section 5) — if applicable
6. **UI & Backend Pages** (section 6) — if applicable
7. **Naming Conventions** (section 7)
8. **Anti-Patterns** (section 8)

Fix any violations before proceeding to the next phase.

## Update Spec with Progress

After completing each phase, update the spec file:

- Add an `## Implementation Status` section at the bottom (or update it if it exists)
- Use this format:

```markdown
## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase A — Foundation | Done | 2026-02-20 | All steps implemented, tests passing |
| Phase B — Menu Injection | Done | 2026-02-21 | 3/3 steps complete |
| Phase C — Events Bridge | In Progress | 2026-02-22 | Step 1-2 done, step 3 pending |
| Phase D — Enrichers | Not Started | — | — |
```

- For the current phase, mark individual steps:

```markdown
### Phase C — Detailed Progress
- [x] Step 1: Create event definitions
- [x] Step 2: Implement SSE bridge
- [ ] Step 3: Add client-side hooks
```

Loop back to `step-1-preflight-and-plan.md` → Plan the Phase for the next phase. When all targeted phases are done, proceed to `step-4-verify-and-finish.md`.
