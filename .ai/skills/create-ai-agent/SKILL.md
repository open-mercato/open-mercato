---
name: create-ai-agent
description: Build a typed Open Mercato AI agent (chat or structured-object) using the unified AI framework — declare `ai-agents.ts`, register tool packs via `defineAiTool`, gate mutations through the approval contract, wire ACL features, and embed `<AiChat>` into a backoffice or portal page. Works in both the monorepo (`packages/<x>/src/modules/<module>/`) and standalone projects (`apps/<app>/src/modules/<module>/` or `node_modules/@open-mercato/<package>` consumers). Triggers on "create AI agent", "add AI agent", "build AI assistant", "wire ai-agents.ts", "add ai-tools.ts", "embed AiChat", "agent for module".
---

# Create AI Agent

Build a typed AI agent for an Open Mercato module using the unified AI framework (spec [`2026-04-11-unified-ai-tooling-and-subagents`](../../.ai/specs/implemented/2026-04-11-unified-ai-tooling-and-subagents.md), framework docs `apps/docs/docs/framework/ai-assistant/`).

This is the **only** correct way to add a domain-specific AI assistant. Do NOT register tools through the legacy `registerMcpTool(...)` Code-Mode path — that surface coexists but is reserved for the OpenCode chat palette and never carries the mutation-approval gate.

## When To Use

- Adding a per-module conversational assistant (e.g. `customers.account_assistant`, `catalog.merchandising_assistant`).
- Adding a structured-object agent for one-shot extraction or background enrichment.
- Adding a mutation-capable agent that must go through `ai_pending_actions` + approval cards.
- Adding a tool pack to be reused across multiple agents (`defineAiTool` registry).

If you only need raw `generateText` / `generateObject` without tool whitelisting or tenant scoping, see the docs escape hatches in `apps/docs/docs/framework/ai-assistant/agents.mdx` (§ "Using the Vercel AI SDK natively"). Default to the agent contract — reach for the escape hatch only when you have a specific reason.

## Reference Implementations

Copy patterns directly from these — do not reinvent them:

| What | Where |
|------|-------|
| Read-only chat agent + structured `PromptTemplate` + page context resolver | `packages/core/src/modules/customers/ai-agents.ts` |
| Mixed read + curated single mutation | `packages/core/src/modules/customers/ai-tools.ts` (+ `customers/ai-tools/*-pack.ts`) |
| Object-mode (structured output) demo | `packages/core/src/modules/catalog/ai-agents.ts` |
| Multi-write mutation flow + bulk + media + price suggestion | `packages/core/src/modules/catalog/ai-tools.ts` |
| `<AiChat>` embedded in a list header | `packages/core/src/modules/customers/widgets/injection/ai-assistant-trigger/` |
| `<AiChat>` embedded in a detail page header | `packages/core/src/modules/customers/widgets/injection/ai-deal-detail-trigger/` |

When in doubt, mirror **customers** for chat agents and **catalog** for object/mutation agents.

---

## 1. Pre-Flight

Before writing any code:

1. Confirm the host module exists and has the standard files (`acl.ts`, `setup.ts`, `index.ts`, `events.ts` if relevant). If not, scaffold the module first using `packages/core/AGENTS.md`.
2. Identify the **target environment**:
   - **Monorepo**: module lives under `packages/<package>/src/modules/<module>/` (or `packages/core/src/modules/<module>/`). The generator scans `.ts` source.
   - **Standalone app**: module lives under `apps/<app>/src/modules/<module>/`. Imports come from `@open-mercato/ai-assistant` resolved via `node_modules/`. The generator scans both source and `node_modules/@open-mercato/*/dist/modules/`.
3. Confirm at least one provider key is set: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`. The factory throws `AiModelFactoryError` with `code: 'no_provider_configured'` otherwise.
4. Decide the agent's posture **up front**:
   - `executionMode`: `chat` (default — multi-turn UI) vs `object` (single-shot validated JSON).
   - `mutationPolicy`:
     - **Agent ships ANY `isMutation: true` tool → default `confirm-required`.** Every write goes through the pending-action approval card. Per-tenant override can downgrade to `read-only` later. Reach for `destructive-confirm-required` only when the agent's writes include irreversible deletes / bulk cascades and you want operators to see "Destructive — confirm" framing.
     - **Agent ships NO mutation tools → `read-only`.** The runtime will strip any future write tools you add until you flip both flags.
   - `readOnly`: pair with `mutationPolicy`. `readOnly: true` ⇔ `read-only`. `readOnly: false` ⇔ `confirm-required` or `destructive-confirm-required`. Mismatched pairs are a code-review red flag.
5. Identify the **ACL features** the agent and tools require. Every feature MUST exist in the module's `acl.ts` and be granted in `setup.ts` `defaultRoleFeatures` before merge.

---

## 2. File Layout

A complete agent contribution is **two files at the module root** plus one optional helper:

```
packages/<pkg>/src/modules/<module>/         (or apps/<app>/src/modules/<module>/)
├── ai-agents.ts                              # Agent definition(s) — REQUIRED
├── ai-tools.ts                               # Tool pack registry — REQUIRED for any non-shared tool
├── ai-agents-context.ts                      # Optional: resolvePageContext implementation
├── ai-tools/                                 # Optional: split big tool packs
│   ├── types.ts
│   └── <surface>-pack.ts
├── acl.ts                                    # MUST contain every feature listed in requiredFeatures
└── setup.ts                                  # MUST grant features in defaultRoleFeatures
```

Path rules:
- `ai-agents.ts` and `ai-tools.ts` MUST live at the **module root** (sibling of `index.ts`). The generator only scans these exact filenames.
- Sub-files (`ai-tools/*-pack.ts`, `ai-agents-context.ts`) are imported from the root files — they are **not** auto-discovered.

---

## 3. Write `ai-tools.ts` (Tool Pack)

Tools are typed handlers registered with `defineAiTool`. Every tool that reads or writes tenant data MUST set `requiredFeatures` and MUST use a Zod `inputSchema`.

```ts
// src/modules/<module>/ai-tools.ts
import { defineAiTool } from '@open-mercato/ai-assistant'
import { z } from 'zod'

const listThings = defineAiTool({
  name: '<module>.list_things',
  description: 'Search things by name. Returns up to `limit` records scoped to the caller tenant.',
  isMutation: false,
  requiredFeatures: ['<module>.thing.view'],
  inputSchema: z.object({
    q: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  async handler(args, ctx) {
    // ctx: { container, tenantId, organizationId, userId, userFeatures, isSuperAdmin }
    const em = ctx.container.resolve('em')
    // ...load via tenant-scoped query, return a serializable object
    return { records: [] }
  },
})

export const aiTools = [listThings]
export default aiTools
```

### MUST rules for tools

- MUST set `requiredFeatures` for every data-touching tool. The wildcard-aware ACL matcher runs before the handler.
- MUST use Zod for `inputSchema`. Never raw JSON Schema.
- MUST set `isMutation: true` on any write tool. The runtime strips these from `readOnly: true` agents and from tenant overrides that resolve to read-only.
- MUST route every mutation through `prepareMutation(...)` — see Section 5. Writing directly inside the handler bypasses the approval gate; the runtime fails closed.
- MUST keep handler results serializable (no class instances, no functions).
- MUST NOT call other modules' DB tables directly — go through their service layer or events.

### Splitting big packs

When one module owns many tools, split into `ai-tools/<surface>-pack.ts` files (one per UX surface) and re-export the union from `ai-tools.ts`:

```ts
// src/modules/customers/ai-tools.ts
import peoplePack from './ai-tools/people-pack'
import dealsPack from './ai-tools/deals-pack'
export const aiTools = [...peoplePack, ...dealsPack]
export default aiTools
```

Reference: `packages/core/src/modules/customers/ai-tools.ts` and the six packs alongside it.

---

## 4. Write `ai-agents.ts`

The agent definition is the contract the runtime uses to dispatch a model call. The required and most-used fields:

```ts
// src/modules/<module>/ai-agents.ts
import type { AiAgentDefinition } from '@open-mercato/ai-assistant'

const accountAssistant: AiAgentDefinition = {
  id: '<module>.<agent>',                    // MUST be `<moduleId>.<snake_case_name>`
  moduleId: '<module>',                      // MUST match the module folder (also drives <MODULE>_AI_MODEL env)
  label: 'Account Assistant',
  description: 'Read-only assistant exploring people, companies, deals.',
  systemPrompt: '...',                       // See Section 4.1 — prefer compiled PromptTemplate
  allowedTools: [
    '<module>.list_things',
    '<module>.get_thing',
    'search.hybrid_search',                  // shared pack
    'search.get_record_context',
    'attachments.list_record_attachments',
    'attachments.read_attachment',
    'meta.describe_agent',
  ],
  executionMode: 'chat',                     // 'chat' (default) | 'object'
  readOnly: true,                            // hard-filters isMutation tools when true
  mutationPolicy: 'read-only',               // 'read-only' | 'confirm-required' | 'destructive-confirm-required'
  requiredFeatures: ['<module>.thing.view'], // gated at the dispatcher
  acceptedMediaTypes: ['image', 'pdf', 'file'],
  defaultModel: 'claude-haiku-4-5',          // optional — see provider docs
  domain: '<module>',
  keywords: ['<module>', '...'],
  // resolvePageContext: optional; see Section 4.2
}

export const aiAgents: AiAgentDefinition[] = [accountAssistant]
export default aiAgents
```

### 4.1 Structured `PromptTemplate` (recommended)

Mirror the customers reference: declare a `PromptTemplate` with the seven named sections (`role`, `scope`, `data`, `tools`, `attachments`, `mutationPolicy`, `responseStyle`) and compile it into `systemPrompt`. This lets the Phase 5 prompt-override system address sections by name.

```ts
const promptSections = [
  { name: 'role',           order: 1, content: 'ROLE\n...' },
  { name: 'scope',          order: 2, content: 'SCOPE\n...' },
  { name: 'data',           order: 3, content: 'DATA\n...' },
  { name: 'tools',          order: 4, content: 'TOOLS\n...' },
  { name: 'attachments',    order: 5, content: 'ATTACHMENTS\n...' },
  { name: 'mutationPolicy', order: 6, content: 'MUTATION POLICY\n...' },
  { name: 'responseStyle',  order: 7, content: 'RESPONSE STYLE\n...' },
]

const systemPrompt = promptSections
  .slice()
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  .map(section => section.content.trim())
  .join('\n\n')
```

Copy the literal section bodies from `packages/core/src/modules/customers/ai-agents.ts` and adapt the wording — never invent new section names.

### 4.2 Optional: `resolvePageContext`

When `<AiChat>` is mounted with a `pageContext={{ entityType, recordId }}` prop, the runtime calls `resolvePageContext` and appends the returned string to `systemPrompt`. Use it to hydrate record-specific context (e.g. "the operator is looking at deal #42").

Put the implementation in a separate `ai-agents-context.ts` so the agent file stays declarative. Reference: `packages/core/src/modules/customers/ai-agents-context.ts`.

```ts
async function resolvePageContext(input) {
  return hydrateAccountContext(input) // delegate; swallow errors and return null on failure
}
```

### 4.3 Object mode (structured output)

For one-shot structured extraction set `executionMode: 'object'` and declare a Zod `output.schema`:

```ts
import { z } from 'zod'

const extractor: AiAgentDefinition = {
  id: '<module>.attribute_extractor',
  moduleId: '<module>',
  // ...
  executionMode: 'object',
  output: {
    schemaName: '<Module>AttributeExtraction',
    schema: z.object({
      recordId: z.string().uuid(),
      attributes: z.array(z.object({ key: z.string(), value: z.string() })),
    }),
  },
}
```

Reference: `packages/core/src/modules/catalog/ai-agents.ts`.

---

## 5. Mutations & Approval Flow

If the agent ships any tool with `isMutation: true`:

1. Set `readOnly: false` AND a non-`read-only` `mutationPolicy` on the agent. Otherwise the runtime strips the tool before the model sees it.
2. Inside the mutation tool's handler, **never write directly**. Call `prepareMutation(...)` which:
   - Inserts a row into `ai_pending_actions` with `status: 'pending'`.
   - Returns metadata the runtime renders as a `mutation-preview-card` / `field-diff-card`.
3. The operator confirms via the approval card. The runtime then dispatches the actual write through the registered `executor` callback registered with `prepareMutation`. After execution, `ai.action.confirmed` (or `ai.action.cancelled` / `ai.action.expired`) fires.
4. The TTL-driven `ai_assistant:pending-action-cleanup` worker (5-minute interval, `AI_PENDING_ACTION_TTL_SECONDS`, default 900) flips expired rows to `expired`.

Skeleton:

```ts
import { defineAiTool, prepareMutation } from '@open-mercato/ai-assistant'

const updateThingStatus = defineAiTool({
  name: '<module>.update_thing_status',
  description: 'Move a thing between statuses. Goes through the approval card.',
  isMutation: true,
  requiredFeatures: ['<module>.thing.update'],
  inputSchema: z.object({ id: z.string().uuid(), status: z.enum(['open', 'closed']) }),
  async handler(args, ctx) {
    return prepareMutation({
      ctx,
      kind: 'update',
      entityType: '<module>:thing',
      entityId: args.id,
      preview: { /* mutation-preview-card payload */ },
      execute: async ({ container, tenantId, organizationId }) => {
        const em = container.resolve('em')
        // ...perform the actual write
        return { ok: true }
      },
    })
  },
})
```

Read the full contract in `apps/docs/docs/framework/ai-assistant/mutation-approvals.mdx` before implementing — partial-success handling, stale-version detection, and `failedRecords` reporting all live there.

The mutation-policy override table (`ai_agent_mutation_policy_overrides`) lets tenant admins downgrade — but **never escalate** — the policy declared in code. The runtime re-checks on every confirm call. To unlock a code-declared `read-only` agent, ship it with `readOnly: false` from day one and rely on the override path to keep it conservative per tenant.

---

## 6. Wire ACL and Setup

Every feature listed in `requiredFeatures` (agent or tool) MUST exist in `acl.ts` and be granted in `setup.ts`.

```ts
// src/modules/<module>/acl.ts
export const features = [
  '<module>.thing.view',
  '<module>.thing.update',
  // ...
]

// src/modules/<module>/setup.ts
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['<module>.*'],
    admin: ['<module>.*'],
    employee: ['<module>.thing.view'],
  },
  // onTenantCreated / seedDefaults / seedExamples as needed
}
```

If you skip this step the dispatcher returns `403` for all callers — including the playground.

---

## 7. Run the Generator

After adding or changing `ai-agents.ts` / `ai-tools.ts`:

```bash
yarn generate
```

The generator aggregates contributions into:

- `apps/<app>/.mercato/generated/ai-agents.generated.ts` — agent registry
- `apps/<app>/.mercato/generated/ai-tools.generated.ts` — tool registry

Then refresh the structural cache so existing tenants pick up the new agent and any new ACL features:

```bash
yarn mercato configs cache structural --all-tenants
```

### Standalone projects

In a standalone app (consuming `@open-mercato/<package>` from `node_modules`), the generator scans both your app's source modules **and** the compiled `dist/modules/<module>/ai-agents.js` files inside published packages. If you publish a package that ships an agent, ensure:

1. `packages/<pkg>/build.mjs` (or `tsconfig.json`) emits `ai-agents.js` and `ai-tools.js` to `dist/modules/<module>/`.
2. The package is listed in the consumer app's `package.json` and rebuilt before running `yarn generate` in the consumer app.
3. The consumer app's `src/modules.ts` registers the module (see `packages/cli/AGENTS.md` → "Standalone App Considerations").

Run order in standalone mode:

```bash
yarn build:packages
yarn generate
yarn build:packages
```

---

## 7.5 Ship UI Parts (Optional)

UI parts are typed inline widgets the agent streams into the chat (record cards, mutation diffs, custom dashboards). Two paths:

### 7.5.1 Record cards (the easy path)

Five kinds ship out of the box: `product`, `deal`, `person`, `company`, `activity`. Have the model emit a fenced Markdown block whose info string is `open-mercato:<kind>` and whose body is one JSON object — the chat composer replaces the fence with a typed React component automatically (no registration needed).

You only have to do two things:

1. **Add a `responseStyle` rule to the prompt** — copy the example from `packages/core/src/modules/customers/ai-agents.ts` (CRM cards) or `packages/core/src/modules/catalog/ai-agents.ts` (product cards). Without the rule the model will not emit the fence.
2. **Make tool outputs card-friendly** — return field names that map cleanly onto the card payload (e.g. catalog `list_products` exposes `imageUrl` as an alias of `defaultMediaUrl` so the model passes the field through verbatim).

Card payload shapes live in `packages/ui/src/ai/records/types.ts`. To add a brand-new card kind, see `apps/docs/docs/framework/ai-assistant/ui-parts.mdx` § "Adding a new record-card kind".

### 7.5.2 Custom server-emitted parts

For widgets that need server-only state (one-time signed URLs, action handlers, server-computed snapshots), register a custom component id and have your tool handler enqueue the part:

```ts
// 1. component
import { registerAiUiPart } from '@open-mercato/ui/ai'
registerAiUiPart('<module>:<kind>', YourComponent)

// 2. push from a tool
async handler(args, ctx) {
  ctx.uiParts?.enqueue({
    componentId: '<module>:<kind>',
    props: { /* serializable */ },
  })
  return { ok: true }
}
```

Use namespaced ids (`<module>:<kind>`). Reserved ids (`mutation-preview-card`, `field-diff-card`, `confirmation-card`, `mutation-result-card`) are FROZEN and owned by the framework — never reuse.

Full reference: `apps/docs/docs/framework/ai-assistant/ui-parts.mdx`.

---

## 8. Embed the Agent UI

### 8.0 Global launcher (automatic)

Once the agent is in `ai-agents.generated.ts` and the user has its `requiredFeatures`, the topbar **AI** pill (`<AiAssistantLauncher>`, mounted in `AppShell`) automatically lists it in the **Cmd/Ctrl+L** dialog. No registration step needed. This is the always-on entry point — per-page triggers are additive.

If you publish a standalone app with custom chrome, mount the launcher in your header:

```tsx
import { AiAssistantLauncher } from '@open-mercato/ui/ai'
<AiAssistantLauncher />
```

It self-hides when AI is not configured (no provider key, or the user has access to no agents). Full reference: `apps/docs/docs/framework/ai-assistant/launcher.mdx`.

### 8.1 `<AiChat>` embed (chat agents)

Mount the chat sheet wherever the operator should be able to talk to the agent. Use a widget injection (preferred) or drop the component directly into a page.

```tsx
import { AiChat } from '@open-mercato/ui/ai'

<AiChat
  agent="<module>.<agent>"
  pageContext={{ entityType: '<module>:thing', recordId: id }} // optional
/>
```

Common injection spots:

| Spot ID | When to use |
|---------|-------------|
| `data-table:<module>.<entity>.list:header` | List page header trigger |
| `detail:<module>.<entity>:header` | Detail page header trigger |
| `crud-form:<module>.<entity>` | Form-side helper |

Reference: `packages/core/src/modules/customers/widgets/injection/ai-assistant-trigger/` (list header) and `ai-deal-detail-trigger/` (detail header).

### 8.2 Object-mode agents

Object-mode agents are usually invoked from server code, not from a chat sheet. Call:

```ts
import { runAiAgentObject } from '@open-mercato/ai-assistant'

const { object } = await runAiAgentObject({
  agentId: '<module>.<agent>',
  container,
  authContext,
  prompt: '...input...',
})
// object is parsed and validated against output.schema
```

Use this from workers, background enrichment jobs, or HTTP routes that need a structured payload back.

### 8.3 Playground smoke test

Before merging, verify the agent shows up and runs:

1. Visit `/backend/config/ai-assistant/playground`.
2. Pick `<module>.<agent>` from the dropdown.
3. Send a representative prompt that exercises one tool and (if applicable) one mutation.
4. For mutation agents: confirm the approval card renders and that `ai.action.confirmed` fires after approval.

---

## 9. Per-Module Model Override (Optional)

To pin the agent to a specific provider/model without editing code, set an env variable named after the module id (uppercased, snake_case preserved):

```
CUSTOMERS_AI_MODEL=claude-opus-4-20250514
INBOX_OPS_AI_MODEL=gpt-4o
CATALOG_AI_MODEL=claude-haiku-4-5
```

Resolution order (highest precedence first):

1. `callerOverride` (`runAiAgentText({ modelOverride })`)
2. `<MODULE>_AI_MODEL` env variable
3. `agentDefaultModel` (`AiAgentDefinition.defaultModel`)
4. The configured provider's default

All callers MUST go through `createModelFactory(container)` from `@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory`. Never inline `createAnthropic` / `createOpenAI` / `createGoogleGenerativeAI`.

---

## 10. Verification Checklist

Before opening a PR, verify each item:

- [ ] `ai-agents.ts` and `ai-tools.ts` exist at the module root, not nested under `data/` or `lib/`.
- [ ] Every tool has `requiredFeatures`, a Zod `inputSchema`, and the right `isMutation` flag.
- [ ] Every mutation tool routes through `prepareMutation(...)` — grep the module: `grep -n "isMutation: true" -- ai-tools*.ts && grep -n "prepareMutation" -- ai-tools*.ts`.
- [ ] `acl.ts` lists every feature referenced by the agent or its tools.
- [ ] `setup.ts` grants those features in `defaultRoleFeatures` for the appropriate roles.
- [ ] `yarn generate` completed without warnings; the new agent appears in `apps/<app>/.mercato/generated/ai-agents.generated.ts`.
- [ ] `yarn mercato configs cache structural --all-tenants` ran (so existing tenants see the new ACL features).
- [ ] At least one provider env var is set; the playground returns a real response.
- [ ] If the agent ships writes: the playground produced an approval card AND the post-approval result reflects the actual DB change.
- [ ] Backend page (or widget) embeds `<AiChat agent="<module>.<agent>" />` exactly once and uses a stable injection spot ID.
- [ ] Module's AGENTS.md (or its parent's) documents the new agent in the AI Agents table — copy the customers AGENTS.md format.

---

## 11. Backward Compatibility Reminders

The agent contract crosses several FROZEN / STABLE surfaces from `BACKWARD_COMPATIBILITY.md`:

- Agent IDs, tool names, ACL feature IDs, and event IDs are FROZEN once shipped — never rename.
- New tool fields, new agent metadata fields, and new prompt sections are additive-only.
- Removing a tool from `allowedTools` is a breaking change for any tenant whose mutation-policy override referenced it. Deprecate first per the `BACKWARD_COMPATIBILITY.md` protocol.

When in doubt, add new — don't rename or remove.

---

## 12. Common Pitfalls

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Agent missing from playground dropdown | `yarn generate` not run, or `ai-agents.ts` not at module root | Move file to module root; rerun `yarn generate` |
| Tool never appears to model | Not in agent's `allowedTools`, or tool name typo | Whitelist explicitly; tool names are case-sensitive |
| `403` at dispatcher | `requiredFeatures` not in user's ACL | Add feature to `acl.ts` + grant in `setup.ts`, then refresh structural cache |
| Mutation tool stripped silently | Agent has `readOnly: true` or `mutationPolicy: 'read-only'` | Set `readOnly: false` AND a non-`read-only` policy |
| Mutation runs without approval card | Handler wrote directly instead of calling `prepareMutation` | Move the write inside `prepareMutation({ execute })` |
| `AiModelFactoryError code: 'no_provider_configured'` | No `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` | Set at least one |
| Standalone app doesn't pick up package agent | `dist/modules/<module>/ai-agents.js` not emitted, or package not rebuilt | `yarn build:packages && yarn generate` from app root |
| Approval card never confirms | Pending action expired (TTL = 900s default) | Increase `AI_PENDING_ACTION_TTL_SECONDS`, or ensure cleanup worker isn't racing |

---

## 13. Overriding Another Module's Agent or Tool

Use this when the module you are working on needs to **replace** or **disable** an agent / tool that another module already shipped — for example, swapping `catalog.merchandising_assistant` for a tenant-specific variant or hiding `catalog.catalog_assistant` from the launcher.

**Path A — `<module>/ai-overrides.ts` (per-module file, generator-driven):**

```ts
// src/modules/<module>/ai-overrides.ts
import type { AiAgentOverrides } from '@open-mercato/ai-assistant'
import myMerchandisingAgent from './ai-agents/my-merchandising-agent'

export const aiOverrides: AiAgentOverrides = {
  agents: {
    'catalog.merchandising_assistant': myMerchandisingAgent, // replace
    'catalog.catalog_assistant': null,                       // disable
  },
  tools: {
    'inbox_ops_accept_action': null,                         // disable a default tool
  },
}

export default aiOverrides
```

**Path B — programmatic API (app-level / dynamic):**

```ts
import {
  applyAiAgentOverrides,
  applyAiToolOverrides,
} from '@open-mercato/ai-assistant'

// In src/bootstrap.ts or an equivalent boot-time entry point.
applyAiAgentOverrides({ 'catalog.catalog_assistant': null })
applyAiToolOverrides({ 'inbox_ops_accept_action': null })
```

MUST rules:

- MUST place `ai-overrides.ts` at the **module root**. Sub-files are not auto-discovered.
- MUST keep map keys consistent with `value.id` (agent) / `value.name` (tool); mismatches log a warning and are skipped.
- MUST NOT use overrides to patch your own module — author the canonical definition in `ai-agents.ts` / `ai-tools.ts` instead.
- MUST run `yarn generate` after editing any `ai-overrides.ts` file.
- MUST run `yarn mercato configs cache structural --all-tenants` after disabling an agent so existing tenants drop stale caches.

Resolution order (highest precedence first): programmatic → file-based (`ai-overrides.ts`) → base (`ai-agents.ts` / `ai-tools.ts`). Last entry per id wins. `null` disables.

Full reference: `apps/docs/docs/framework/ai-assistant/overrides.mdx`.

---

## See Also

- `packages/ai-assistant/AGENTS.md` — runtime internals, model factory, mutation contract.
- `apps/docs/docs/framework/ai-assistant/architecture.mdx` — system map, request flow, persistence, generators.
- `apps/docs/docs/framework/ai-assistant/developer-guide.mdx` — public companion to this skill.
- `apps/docs/docs/framework/ai-assistant/overrides.mdx` — cross-module replace + disable.
- `apps/docs/docs/framework/ai-assistant/agents.mdx` — agent contract reference, escape hatches.
- `apps/docs/docs/framework/ai-assistant/ui-parts.mdx` — record cards + custom inline widgets.
- `apps/docs/docs/framework/ai-assistant/attachments.mdx` — file upload contract + base64 inline encoding.
- `apps/docs/docs/framework/ai-assistant/mutation-approvals.mdx` — full approval contract + partial-success handling.
- `apps/docs/docs/framework/ai-assistant/launcher.mdx` — global topbar launcher + Cmd/Ctrl+L.
- `apps/docs/docs/framework/ai-assistant/settings.mdx` — per-tenant prompt and policy override UI.
- `apps/docs/docs/framework/ai-assistant/playground.mdx` — smoke-test surface.
- `apps/docs/docs/user-guide/ai-assistant.mdx` — operator-facing walkthrough (use this when designing copy / suggestions).
- `packages/core/src/modules/customers/ai-agents.ts` + `ai-tools.ts` — canonical chat agent reference.
- `packages/core/src/modules/catalog/ai-agents.ts` + `ai-tools.ts` — canonical mutation + object-mode reference.
