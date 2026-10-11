# Checkpoint 2 — after steps 1.7–1.13 (Phase 2b complete)

- Date: 2026-07-28 (UTC)
- Window: commits `3be9dc527`..`19314c3b4` (7 steps + 1 docs repair)
- Runner: local

## Steps covered

| Step | Commit | Summary |
|------|--------|---------|
| 1.7 | 3be9dc527 | Additive `payloadSchema` on `EventDefinition`, exposed through `getDeclaredEvents()` + `GET /api/events` |
| 1.8 | 383c5580f | Trigger editor: payload-path filter builder + mapping pickers, free-text + warning chip for schema-less/wildcard events, safe-default copy for `debounceMs`/`maxConcurrentInstances` |
| 1.9 | 84ad36361 | `buildTriggerPayloadContracts` pre-resolves event schemas as plain data at both call sites; typed `contextMapping` targets in the ledger (lib stays pure) |
| 1.10 | 0b20806c5 | Agent OUTCOME schemas exposed on the enterprise agents API (file agents verbatim; in-process converted via the platform zod→JSON-Schema helper) |
| 1.11 | f7c9b6dd0 | INVOKE_AGENT `outputContract` via `bindAgentOutcomeSchemaResolver`; typed ledger mapping targets |
| 1.12 | 00c16381f | Typed agent input/output mapping pickers; unknown source path = author-time error |
| 1.13 | e521512be | `InputDataPanel` + drag-to-insert (`text/plain` + `application/x-om-ledger-path`) |
| — | 19314c3b4 | Docs repair: PLAN.md Tasks table truncated by an executor's row-flip script, restored without history rewrite |

## Checks

- Workflows-scoped unit suite: **1104 suites / 8629 tests passed** (checkpoint 1 was 1099/8573).
- `yarn typecheck`: green (22/22 turbo tasks).
- `yarn lint`: 0 errors (pre-existing warnings only).
- `yarn i18n:check-sync`: all translation files in sync.
- Enterprise suite: 1351 passed / **7 failed — independently verified pre-existing and environmental**, not caused by this window. All 7 come from `agent-token-usage`, `agent-source-files`, and `webSearchEgress`, which read `docker/opencode/opencode.jsonc` and the baked file-agent source tree. Verified: `docker/opencode/opencode.jsonc` is **not tracked on `origin/feat/agent-orchestrator-mvp`** and is **absent from the main worktree too** (`git cat-file -e` → path does not exist; `ls` → no such file). The tracked manifest `packages/enterprise/src/modules/agent_orchestrator/generated/file-agents.generated.ts` is present and unmodified in this worktree. These suites fail on any checkout lacking the local enterprise/opencode mirrors.

## Notes / decisions in window

- **New shared surface (flagged):** `zodToJsonSchema` + the `JsonSchema` type are now exported from `@open-mercato/shared/lib/openapi` (previously private). Purely additive, needed by 1.10 to convert in-process agent result schemas. Worth a reviewer's eye as a contract-surface addition.
- **Core↔enterprise seam for 1.11:** an additive OPTIONAL method `listAgentOutcomeContracts()` on the EXISTING `agentWorkflowBridge` DI service, read duck-typed by core (`typeof bridge.listAgentOutcomeContracts === 'function'`). No new DI key, no import from core into enterprise, and the peer being absent degrades every contract to `unknown` rather than throwing.
- **`subject` field names:** the plan said `{ entityType, entityId }`; the executor used `subjectType`/`subjectId`/`subjectLabel` — the keys the enterprise `agentProcessSubjectSchema` actually validates — so the mini-form writes real data instead of ignored keys. Correct deviation.
- **Author-time mapping error is non-blocking:** renders as a destructive `role="alert"` on the row rather than failing CrudForm submit, consistent with the module's "warnings never block save" stance and so authors editing legacy definitions aren't trapped when the peer is unreachable.
- HANDOFF.md's generated-file warning named the wrong path (`apps/mercato/src/modules/file-agents.generated.ts`); the real tracked artifact is `packages/enterprise/src/modules/agent_orchestrator/generated/file-agents.generated.ts`. Corrected in HANDOFF.md this checkpoint.
- UI browser verification still deferred to the integration batch (3.15) + final gate, per PLAN rule 7.
