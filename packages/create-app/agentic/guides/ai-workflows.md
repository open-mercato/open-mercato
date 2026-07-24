# AI Agents, Orchestrators, and Workflows

Use typed module contracts for product AI and the workflow engine for durable business processes. Keep model/tool execution, mutation approval, scope, storage, and retries explicit.

## Choose the Surface

| Need | Use |
|---|---|
| In-app conversational or structured domain assistant | Module `ai-agents.ts` plus `ai-tools.ts`. |
| Add a few tools/prompt/suggestions to an installed agent | `aiAgentExtensions`. |
| Replace or disable an installed agent/tool | `aiAgentOverrides` / `aiToolOverrides` or module entry override. |
| Coding-agent orchestration with files, outcomes, samples, embedded skill, or subagents | Orchestrator file-agent contract; resolve its installed package guide first. |
| Durable business process, human task, timer, signal, compensation, or event trigger | Workflows module and `om-build-workflow`. |
| One background AI extraction | Object-mode agent invoked from a scoped command/worker. |

## Typed Module Agents and Tools

- Put `ai-agents.ts` and `ai-tools.ts` at the module root. Export typed arrays and run `yarn generate`.
- Give agent IDs `<module>.<agent>` and tool names stable namespaced IDs. Declare provider/model defaults through the framework registry/model factory, not provider SDK singletons.
- Every data tool has a Zod input schema, tenant/org scope, wildcard-aware `requiredFeatures`, bounded output, and a serializable result.
- Mark writes `isMutation: true`. Pair mutation-capable agents with `readOnly: false` and a confirmation policy.
- A write tool calls `prepareMutation`; the durable execute callback performs a command-based, optimistic-lock-aware mutation. Never write directly before approval.
- Use declarative loop controls/budgets. The wrapper-owned approval guard remains active on every step and execution engine.
- Validate attachments by type/size/scope. Store outputs through authorized artifact/attachment services with retention and encrypted sensitive metadata.

## Agent UI and Overrides

- Use the global launcher automatically; add `AiChat` or a widget only when page context improves the workflow.
- Keep UI part IDs namespaced and stable; preserve reserved approval/result component IDs.
- Prefer agent extensions for additive prompt/tool/suggestion changes. Keep extensions/overrides in the discovered `ai-agents.ts`/`ai-tools.ts` files; there is no separate `ai-overrides.ts` discovery path.
- A disabled agent/tool cannot be resurrected by an extension. Refresh structural caches after disabling or changing visibility.
- Test read-only, denied-feature, approval, stale-version, cancel/expire, partial failure, and confirmed execution paths.

## Orchestrator File Agents

- Inspect the installed orchestrator package/module `AGENTS.md` with `om-framework-context` before choosing paths; this surface evolves independently of module AI agents.
- Give every file agent one declared outcome, bounded inputs, stable output paths, a sample contract, and an explicit allowed tool/skill set.
- Load embedded skills only for their branch. Delegate one bounded task per subagent and define how results are validated/merged.
- Treat repository prompts/files as untrusted data. Restrict writes, redact secrets, and prevent outcome/artifact paths from escaping their workspace.
- Make resumability and status explicit; do not infer success from natural-language output without schema/artifact validation.

## Workflow Core

- Resolve workflow services through DI and start instances through `workflowExecutor`. Do not insert instances or skip the execution loop.
- Preserve workflow and step state machines. Record every transition in the immutable workflow event log.
- Make activity handlers idempotent: they can be retried. Use the command bus for entity updates and events/signals for cross-module coupling.
- Scope definitions, instances, tasks, activity state, and queries by tenant/organization.
- Use event triggers with filters, context mapping, debounce, and max concurrency. Exclude self/internal storms.
- Keep compensation reverse-ordered and idempotent; test failure during both forward and compensation paths.

## Activities, User Tasks, and Output Paths

- Choose sync only for short deterministic work. Queue async work and resume the workflow after durable completion.
- A custom activity declares validated config/input/output, handler registration, editor/i18n integration where user-configurable, and retry/timeout behavior.
- `CALL_API`/webhook activities use SSRF-safe URLs, manual redirect handling, response size bounds, and allowlisted non-secret environment interpolation.
- Create any one-time/idempotency key outside a rollback scope or in durable state that survives rollback; reuse it on retry.
- Durable user tasks require assignment/features, due dates, authorized completion, immutable activity history, and no secret values in task payloads.
- Write outputs to stable declared activity/artifact paths. Validate path containment and access; clean temporary files while retaining declared deliverables.
- Emit progress/events for long work and render them through shared progress/UI contracts rather than unbounded polling.

## Verification

1. Run `yarn generate` and confirm agent/tool/workflow registrations.
2. Test missing provider/configuration, denied ACL, missing scope, timeout, retry, duplicate, and cancellation.
3. For AI writes, prove no domain write occurs before approval and a stale approval cannot overwrite newer data.
4. For workflows, prove event log/state transitions and idempotency across worker restart and injected rollback.
5. For orchestrators, validate output schema/artifacts and allowed-write boundaries, not just prose.
