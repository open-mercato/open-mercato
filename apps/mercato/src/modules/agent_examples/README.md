# Defining an Agent Orchestrator agent in a new module

This module is a worked example of declaring a propose-only agent from a brand-new
module. The agent here, `support.ticket_triage`, classifies a support ticket
(informative result, no tools).

## What an agent is

An Agent Orchestrator agent is authored in code with `defineAgent(...)`. It runs
in object mode, validates its output against a Zod schema, and returns a typed
`AgentResult`:

- **informative** — returns `data` (this example). Nothing is proposed.
- **actionable** — returns a `proposal` (actions + confidence) that a human or a
  threshold rule disposes, then an effector applies. See
  `agent_orchestrator/ai-agents.ts` (`deals.health_check`) for the actionable
  variant.

Propose-only is structural: agents are declared read-only, so the runtime strips
any mutation tool. An agent can only read and propose — never write directly.

## Steps to add an agent in your own module

1. **Result schema** — `data/validators.ts`. Wrap the payload in the AgentResult
   shape:

   ```ts
   import { z } from 'zod'
   export const ticketTriageResult = z.object({
     kind: z.literal('informative'),
     data: z.object({ /* your fields, all required */ }),
   })
   ```

   For an actionable agent use `kind: z.literal('actionable')` + a `proposal`
   object (`actions`, `confidence`, `rationale`).

2. **Declare the agent** — `ai-agents.ts` (this file name is auto-discovered):

   ```ts
   import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
   import { defineAgent } from '@open-mercato/core/modules/agent_orchestrator/lib/sdk/defineAgent'
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
       result: { kind: 'informative', schema: ticketTriageResult },
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

## Try it

Open **Backend → Agents → Support ticket triage → Open in playground** and run:

```json
{ "subject": "Charged twice this month", "body": "I see two identical charges on my card." }
```

Expect an informative result like
`{ category: "billing", priority: "high", summary: "…" }`.
