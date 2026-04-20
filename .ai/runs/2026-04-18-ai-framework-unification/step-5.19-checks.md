# Step 5.19 — Verification Log

**Step:** 5.19 — Spec Phase 3 WS-D, docs + operator rollout notes (release notes, migration guide, OpenCode coexistence). **FINAL STEP of the spec.**
**Code commit:** `4fd867e41`
**Timestamp:** 2026-04-19T22:30:00Z

## Purpose

Close out the spec with operator-facing documentation. No code changes; docs-only.

## Deliverables landed

- **Spec moved** from `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md` to `.ai/specs/implemented/` via `git mv` (history preserved).
- **Release notes** updated (or created) at `RELEASE_NOTES.md` with workstream-grouped entries crediting @peter.
- **CHANGELOG.md** entry appended under the next-release section in the house emoji format.
- **AGENTS.md (ai-assistant)** extended with an "Upgrading / Operator rollout notes" section covering: new env vars (`AI_PENDING_ACTION_TTL_SECONDS`, `<MODULE>_AI_MODEL`), new tables (`ai_pending_actions`, `ai_agent_prompt_overrides`, `ai_agent_mutation_policy_overrides`), cleanup worker registration, BC posture around `inbox_ops/lib/llmProvider.ts`.
- **OpenCode coexistence** subsection in the AGENTS.md doc: original `/api/chat`, `/api/tools*`, `mcp:serve*` routes untouched; new framework adds `/api/ai_assistant/ai/chat?agent=...` + pending-action routes + playground/settings UI + D18 demo.
- **Cross-references updated** after the `git mv`: root `AGENTS.md` Task Router, `.ai/specs/AGENTS.md`, PLAN.md, and any other live pointer now references `.ai/specs/implemented/2026-04-11-unified-ai-tooling-and-subagents.md`. Historical step-checks files and NOTIFY entries left untouched (they're frozen audit trail).

## Verification

| Check | Outcome |
|-------|---------|
| `yarn turbo run typecheck --filter=@open-mercato/ai-assistant --filter=@open-mercato/core --filter=@open-mercato/app` | ✅ clean (docs-only change) |
| `yarn generate` | ✅ no drift |
| `yarn i18n:check-sync` | ✅ green (no new strings) |

## Spec status

All 19 rows in PLAN.md's Tasks table are `done`. Phase 1 foundation (1.1–1.2) ✅. Phase 2 / spec Phase 0 Alignment (2.1–2.5) ✅. Phase 3 / spec Phase 1 Runtime + Tools (3.1–3.13) ✅. Phase 4 / spec Phase 2 Playground + Agents (4.1–4.11) ✅. Phase 5 / spec Phase 3 Production + Mutation Gate + Rollout (5.1–5.19) ✅.
