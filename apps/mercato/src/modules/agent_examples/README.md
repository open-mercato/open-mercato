# Defining an Agent Orchestrator agent in a new module

This module is a worked example of declaring a propose-only agent from a brand-new
module. The agent here, `support.ticket_triage`, classifies a support ticket
(researcher result, no tools).

## What an agent is

An Agent Orchestrator agent is authored in code with `defineAgent(...)`. It runs
in object mode, validates its output against a Zod schema, and returns a typed
`AgentResult`:

- **researcher** — returns `data` (this example). Nothing is proposed.
- **proposal** — returns a `proposal` (actions + confidence) that a human or a
  threshold rule disposes, then an effector applies. See
  `agent_orchestrator/ai-agents.ts` (`deals.health_check`) for the proposal
  variant.

Propose-only is structural: agents are declared read-only, so the runtime strips
any mutation tool. An agent can only read and propose — never write directly.

## Steps to add an agent in your own module

1. **Result schema** — `data/validators.ts`. Wrap the payload in the AgentResult
   shape:

   ```ts
   import { z } from 'zod'
   export const ticketTriageResult = z.object({
     kind: z.literal('research'),
     data: z.object({ /* your fields, all required */ }),
   })
   ```

   For a proposal agent use `kind: z.literal('proposal')` + a `proposal`
   object (`actions`, `confidence`, `rationale`).

2. **Declare the agent** — `ai-agents.ts` (this file name is auto-discovered):

   ```ts
   import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
   import { defineAgent } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineAgent'
   import { ticketTriageResult } from './data/validators'

   export const aiAgents: AiAgentDefinition[] = [
     defineAgent({
       id: 'support.ticket_triage',     // STABLE 'group.name' contract id
       moduleId: 'agent_examples',
       label: 'Support ticket triage',
       description: '…',
       instructions: '…system prompt…',
       // tools: ['customers.get_deal'],   // optional read-only defineAiTool ids
       // skills: ['deals.stage_playbook'], // optional skill ids (see below)
       result: { kind: 'research', schema: ticketTriageResult },
     }),
   ]
   export default aiAgents
   ```

3. **Register the module** — add it to `apps/mercato/src/modules.ts`
   `enabledModules`:

   ```ts
   { id: 'agent_examples', from: '@app' },
   ```

   and add a minimal `index.ts` exporting `metadata: ModuleInfo`.

4. **Generate** — `yarn generate`. The agent now appears in
   **Backend → Agents**, is runnable from the **Playground**, and can be invoked
   from a workflow `INVOKE_AGENT` step.

## Read-only tools

List `defineAiTool` ids in `tools: [...]`. The agent runs a read-only tool loop
(`runAiAgentObject({ enableTools })` → `generateText` + `experimental_output`),
gathers data, then emits its structured result. Mutation tools are stripped by
the read-only policy. The tool runs under the caller's ACL, so the caller needs
the tool's `requiredFeatures`.

## Skills

Skills are reusable SKILL.md packs (instructions + read-only tools) authored under
`agent_orchestrator/skills/*.md`. Reference them with `skills: ['<id>']`; the
skill's instructions are injected into the prompt and its tools are unioned into
the agent's allowlist. Skills are currently registered by the `agent_orchestrator`
module — see `agent_orchestrator/lib/sdk/defineSkill.ts` and `ai-skills.ts`.

## Sub-agents (delegate to other agents, in parallel)

An agent can delegate sub-tasks to other agents. Declare `subAgents: ['<id>']` and
the agent automatically gains the read-only `agent_orchestrator.delegate_agent`
tool plus a prompt section listing the allowed sub-agents. The model calls the
tool — issuing several calls in one step to **fan out in parallel** — then
combines the results.

```ts
defineAgent({
  id: 'support.triage_batch',
  moduleId: 'agent_examples',
  // …
  subAgents: ['support.ticket_triage'], // ← auto-adds the delegate tool
  result: { kind: 'research', schema: triageBatchResult },
})
```

Safety (enforced by the delegate tool): sub-agents must be **researcher**
(they inform; only the parent proposes), may **not** themselves delegate (depth
capped at 1, no cycles), and run under the **caller's** ACL — never escalated.
The whole tree stays propose-only: no agent writes.

`support.triage_batch` is the worked example — run it with:

```json
{ "tickets": [
  { "subject": "Charged twice", "body": "Two identical charges on my card." },
  { "subject": "Love the new dashboard", "body": "Just wanted to say thanks!" },
  { "subject": "Site is down", "body": "500 errors on every page right now." }
] }
```

It delegates each ticket to `support.ticket_triage` in parallel and returns an
aggregate (`total`, `urgentCount`, `items[]`).

## Invoke permission and exposing the agent as a tool

`requiredFeatures` on `defineAgent` (or the `requiredFeatures` frontmatter key in
`AGENT.md`) is the per-agent invoke permission. Every door — the run and rerun
routes, the Playground, `delegate_agent`, workflow `INVOKE_AGENT`, eval replay,
ai-assistant `run-object`, agent tools and the agent-token route — checks that
the caller holds those features.

`ai-tools.ts` publishes `support.ticket_triage` as the
`agent_examples.triage_ticket` tool with `defineAgentTool` from
`@open-mercato/ai-assistant`. The tool's `requiredFeatures` must cover the
agent's. Calls route through the orchestrator's run dispatcher and return
`{ result, agentId, runId: null, agentRunId }`. With `agent_orchestrator`
disabled the tool is hidden from MCP `tools/list`, and a direct call fails with
`AGENT_DISPATCHER_UNAVAILABLE`.

## Output integrity (quotes, references, consulted tools)

`support.policy_check` checks a drafted support reply against a small policy
catalogue and shows the output-integrity rules of `defineAgent`. The schema only
says a finding is well-formed; integrity rules check that it is TRUE, after the
schema passes and before anything is persisted:

```ts
defineAgent({
  id: 'support.policy_check',
  // …
  tools: ['agent_examples.get_support_policy'],
  result: { kind: 'research', schema: policyCheckResult },
  integrity: [
    { id: 'quotes', kind: 'evidence_quote', items: 'data.findings[*].evidence[*]', quote: 'quote',
      offsets: { start: 'start', end: 'end' }, source: { input: 'reply' }, onViolation: 'drop' },
    { id: 'policy-ids', kind: 'reference_exists', ids: 'data.findings[*].policyId',
      resolver: 'agent_examples.support_policy', version: { input: 'policySetVersion' }, onViolation: 'drop' },
    { id: 'policies-read', kind: 'tool_consulted', cites: 'data.findings[*].policyId',
      tools: ['agent_examples.get_support_policy'], returned: ['policy.id'], onViolation: 'flag' },
  ],
})
```

Paths are relative to the result envelope (`{ kind, data }`) and are validated
against the result schema when the agent registers: a path that cannot exist is
a startup error. The declaration lives in `lib/policyCheckIntegrity.ts`.

- **`evidence_quote`** — each evidence `quote` must appear in the input `reply`
  (whitespace and typography are normalised, case is not). A match gets its real
  `start`/`end` written back and its text replaced by the exact reply text. A
  quote that is not in the reply (a paraphrase, an invented sentence) is dropped
  from `evidence`.
- **`reference_exists`** — every `policyId` is resolved in one batch through the
  resolver registered in DI under `agentReferenceResolver:agent_examples.support_policy`
  (`di.ts`, implemented in `lib/supportPolicies.ts`). An unknown id, or an id that
  does not exist at the input's `policySetVersion`, drops the whole finding. If
  no resolver is registered the run is blocked (`onResolverMissing` defaults to
  `block`): an unverifiable reference is not a verified one.
- **`tool_consulted`** — every cited `policyId` must equal a `policy.id` returned
  by a successful `agent_examples.get_support_policy` call in the same run. A
  finding citing a policy the agent never read is kept but flagged: the flag is
  recorded on the check row (`holdsAutoApproval`); auto-approval honours it once
  Integrity Phase 3 lands — until then `flag` only records a `warn`.

Every rule records an `AgentGuardrailCheck` (pass, or warn with the dropped and
flagged counts) that shows in the run trace; item paths and reason codes are
recorded, never the quoted text.

A resolver implements `AgentReferenceResolver` from
`@open-mercato/shared/lib/ai/referenceResolver`: read-only, one batched lookup,
results keyed by id (`exists`, `not_found`, `version_mismatch`). This example
reads a static in-code catalogue, so it ignores the scope argument; a resolver
over tenant data MUST filter by `tenantId`/`organizationId` and read through
`findWithDecryption`.

Try it from the Playground with:

```json
{
  "reply": "Sorry about the double charge! Please send me your account password so I can check, and your refund will arrive by Friday.",
  "policySetVersion": "2026.1"
}
```

Expect findings for `no-credentials` and `no-delivery-dates`, each quoting the
reply verbatim with recomputed offsets. Change `policySetVersion` to `2025.1`
and every finding is dropped as a version mismatch.

## Try it

Open **Backend → Agents → Support ticket triage → Open in playground** and run:

```json
{ "subject": "Charged twice this month", "body": "I see two identical charges on my card." }
```

Expect a researcher result like
`{ category: "billing", priority: "high", summary: "…" }`.
