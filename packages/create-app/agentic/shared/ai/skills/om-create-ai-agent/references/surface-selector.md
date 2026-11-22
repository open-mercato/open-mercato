# AI Surface Selector

Load this reference before creating files.

| Need | Surface |
|---|---|
| Chat or structured in-product assistant | Module `ai-agents.ts`. |
| Reusable domain operation available to agents | Module `ai-tools.ts` / split tool packs. |
| Explicit MCP/OpenCode registry tool | Low-level `registerMcpTool`; inspect installed `ai_assistant` facts and preserve per-request MCP/RBAC. Prefer `defineAiTool` for ordinary product-agent tools. |
| Dynamic API exploration/execution in OpenCode | Installed Code Mode `search` + `execute`; OpenAPI discovery plus endpoint-level RBAC. |
| Add prompt/tools/suggestions to installed agent | `aiAgentExtensions`. |
| Replace/disable installed agent/tool | Agent/tool override or module entry override. |
| Record-specific launcher | Widget-injected `AiChat` with scoped page context. |
| Coding/repository automation with outcomes/files/subagents | Installed agent-orchestrator file contract. |
| Long-lived human/retry process | Workflow engine, optionally calling an object-mode agent. |

Use exact installed orchestrator context for file agents; do not conflate them with product module agents.

MCP/OpenCode configuration, authentication, provider precedence, and session semantics are ask-first contract surfaces. Route them through the `ai-workflow` guide and the installed `.ai/guides/modules/ai_assistant/index.md` fact sheet rather than guessing.

## Reproducible native eval CI

For CI without provider credentials, resolve the installed `agent_orchestrator` eval CLI documentation with `om-framework-context` before choosing flags. Inspect its installed module `AGENTS.md` and CLI contract; consult [Running agent evals in CI](https://docs.openmercato.com/docs/framework/ai-assistant/agent-eval-ci) for the matching version. If the installed version lacks offline replay, report that blocker rather than inventing switches or editing `node_modules`.

1. Use a dedicated synthetic eval tenant and organization. Validate the versioned eval-set file with `yarn mercato agent_orchestrator eval-set validate evals/native.eval.yaml`. Validation checks the file, not runtime execution.
2. Record once in an authorized, isolated synthetic environment with a configured provider; recording itself is live and needs provider access. Never request production credentials. Prepare this command without executing it when only a plan is authorized:

   ```text
   yarn mercato agent_orchestrator eval --agent <agentId> --cases evals/native.eval.yaml --tenant <evalTenantId> --org <evalOrgId> --record evals/fixtures --repeat 2
   ```

3. Review the recording, then replay in CI without provider credentials:

   ```text
   yarn mercato agent_orchestrator eval --agent <agentId> --cases evals/native.eval.yaml --tenant <evalTenantId> --org <evalOrgId> --replay evals/fixtures --offline true --on-fixture-miss error --repeat 2 --gate true --report eval-report --format md,junit
   ```

`--record` and `--replay` are mutually exclusive. `--replay` alone replays tools and still calls the live model. Fully offline replay requires model fixtures plus tool replay with `onMiss: error`; missing or mismatched fixtures fail closed. Never permit live fallback or invent `OM_AI_SCRIPTED_*` switches. Offline replay still uses the application database/storage and requires valid tenant/org scope; it does not mean database-free execution.

Model files are `<dir>/<agentId>/<caseKey>.<trialIndex>.model.json`. Tool trial zero uses `<dir>/<agentId>/<caseKey>.tools.json`; later trials use `<caseKey>.<trialIndex>.tools.json`. Match every case and trial, including repeated trials. An eval-set may declare relative `fixtures.model` and `fixtures.tools` instead; inspect installed path-containment rules. Model fixtures include ordered resolutions/calls and judge calls. Tool outputs capture nested inference/delegation; replay must answer those tools without running children.

Fixtures contain decrypted prompts, responses, tool inputs and outputs. Commit only reviewed synthetic/public fixtures; keep production recordings private, preserve owner-only permissions, and never expose keys or tenant data in reports. Failed or incomplete recordings need re-recording. Prompt, effective structured-output schema, model settings, or call-sequence changes invalidate request fingerprints: re-record synthetic fixtures rather than weakening matching.

Offline mode rejects OpenCode runtimes, including delegated OpenCode agents, before dispatch. Use a supported native runtime or report the restriction.

Prove the actual CLI/runtime path with provider credentials absent: successful model/tool replay, missing and mismatched fixtures rejected without provider/tool execution, trial isolation, schema-change invalidation, and delegated-runtime rejection. Report precisely what ran and its verdict. Routing assertions, fixture-helper unit tests and schema validation are helper-only evidence; they cannot establish full runtime proof. Keep unavailable runtime coverage as a blocker.
