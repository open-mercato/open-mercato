/**
 * Module-root AI tool pack for the `example` module.
 *
 * The generator walks every module root for `ai-tools.ts` and folds the
 * default / `aiTools` export into `ai-tools.generated.ts`, which the
 * ai-assistant runtime loads into the MCP tool registry. Both tools here are
 * read-only, so the agent in `ai-agents.ts` stays `read-only` and nothing in
 * this module needs the pending-action approval contract.
 *
 * Three things are worth copying:
 *
 * 1. **Scope never comes from the model.** `requireToolScope` reads tenant and
 *    organization off the runtime-supplied `McpToolContext` and throws when
 *    either is missing. A `tenantId` input field would let a prompt-injected
 *    model address another tenant's rows.
 * 2. **`requiredFeatures` names features that already exist in `acl.ts`.** The
 *    runtime runs the wildcard-aware ACL matcher before the handler, so an
 *    operator without the feature never reaches the query.
 * 3. **Handlers take `unknown` and parse.** The declared `inputSchema` is what
 *    the model is shown; re-parsing inside the handler is what makes the
 *    handler safe when it is invoked from anywhere else (tool test runner,
 *    MCP server, pending-action executor).
 *
 * `example.get_todo_summary` deliberately goes through the module's own DI
 * service rather than counting rows itself: that is the same cache-aside read
 * `api/todos/summary/route.ts` performs, so the tool and the HTTP route cannot
 * drift, and the AI path picks up the same tag invalidation.
 */
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import type { AiToolOverridesMap } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-overrides'
import type {
  AiToolDefinition,
  McpToolContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { EXAMPLE_TODO_SUMMARY_SERVICE } from './di'
import type { TodoSummaryService } from './lib/todoSummaryCache'
import { ExampleCustomerPriority } from './data/entities'

export type ExampleToolScope = {
  tenantId: string
  organizationId: string
}

export type ExampleTodoSummaryToolResult = {
  total: number
  done: number
  open: number
  cacheHit: boolean
}

export type ExampleCustomerPriorityToolResult = {
  customerId: string
  priority: 'low' | 'normal' | 'high' | 'critical' | null
}

/**
 * Fail-closed scope resolution shared by every tool in this pack.
 *
 * Exported so `__tests__/ai-tools.test.ts` can pin the closed branch directly
 * instead of reaching through a handler closure.
 */
export function requireToolScope(
  context: Pick<McpToolContext, 'tenantId' | 'organizationId'>,
): ExampleToolScope {
  const tenantId = typeof context.tenantId === 'string' ? context.tenantId.trim() : ''
  const organizationId = typeof context.organizationId === 'string' ? context.organizationId.trim() : ''
  if (!tenantId || !organizationId) {
    throw new Error('[internal] example AI tools require a tenant- and organization-scoped context')
  }
  return { tenantId, organizationId }
}

export const customerPriorityInputSchema = z.object({
  customerId: z.string().uuid(),
})

const todoSummaryTool: AiToolDefinition = defineAiTool<unknown, ExampleTodoSummaryToolResult>({
  name: 'example.get_todo_summary',
  displayName: 'Example — todo summary',
  description:
    'Return open/done/total todo counts for the caller tenant and organization. Read-only, and takes no arguments because the scope comes from the session rather than from the model.',
  tags: ['read', 'example'],
  isMutation: false,
  requiredFeatures: ['example.todos.view'],
  inputSchema: z.object({}),
  async handler(_input, context) {
    const scope = requireToolScope(context)
    const service = context.container.resolve<TodoSummaryService>(EXAMPLE_TODO_SUMMARY_SERVICE)
    const { summary, cacheHit } = await service.read(scope)
    return {
      total: summary.total,
      done: summary.done,
      open: summary.open,
      cacheHit,
    }
  },
})

const customerPriorityTool: AiToolDefinition = defineAiTool<unknown, ExampleCustomerPriorityToolResult>({
  name: 'example.get_customer_priority',
  displayName: 'Example — customer priority',
  description:
    'Return the priority this module records for one customer person id, or null when the module has never scored that customer. Read-only.',
  tags: ['read', 'example', 'customers'],
  isMutation: false,
  requiredFeatures: ['example.view'],
  inputSchema: customerPriorityInputSchema,
  async handler(input, context) {
    const scope = requireToolScope(context)
    const { customerId } = customerPriorityInputSchema.parse(input)
    const em = context.container.resolve<EntityManager>('em')
    const record = await em.findOne(ExampleCustomerPriority, {
      customerId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    return {
      customerId,
      priority: record?.priority ?? null,
    }
  },
})

export const aiTools: AiToolDefinition[] = [customerPriorityTool, todoSummaryTool]

/**
 * Feature id the file-tier override raises `example.get_todo_summary` to.
 *
 * Exported so the test asserts against one constant rather than repeating a string
 * that could drift away from `acl.ts`.
 */
export const TODO_SUMMARY_OVERRIDE_FEATURE = 'example.todos.manage'

/**
 * File-tier tool override — the second mechanism this file carries.
 *
 * The generator reads `aiToolOverrides` separately from `aiTools` and emits it as
 * `aiToolOverrideEntries` in `ai-tools.generated.ts`; the runtime folds it in through
 * `composeToolOverrideMap` → `applyToolOverrideMap`. `null` removes a tool by name; a
 * definition replaces it, and `applyToolOverrideMap` drops any replacement whose
 * `name` does not equal its key, so the key and the definition cannot drift apart.
 *
 * Three things decide whether an override you write is correct:
 *
 * 1. **Where it sits.** File-tier overrides are tier 3 of four: programmatic
 *    (`applyAiToolOverrides`) > `modules.ts` `entry.overrides.ai.tools` > this file >
 *    the base `aiTools` export. A module therefore ships a *default*, never a final
 *    word — an app tightens or lifts it without editing module source.
 * 2. **What it may safely name.** A real module names a tool it does NOT own — that is
 *    the whole point of the surface. This one names its own, on purpose: enabling the
 *    canonical reference module for inspection must not silently change a shipped
 *    assistant's behaviour in the app you are inspecting. Read the shape here, then
 *    put a foreign tool name in the key when you copy it.
 * 3. **What it changes.** The base declaration above states the capability at its
 *    natural read permission (`example.todos.view`); the override ships the stricter
 *    default this module wants in a deployment, so cached aggregates only reach the
 *    model for an operator who can also manage the backlog. The handler is reused by
 *    spread, so the tool cannot fork into two implementations.
 *
 * The override is LIVE — the generator folds it into `ai-tools.generated.ts` — but the
 * narrowing it demonstrates has no observable effect in a seeded app, because
 * `setup.ts` grants `example.*` to superadmin, admin and employee alike. Read it as a
 * shape, not as a demonstration that a gate closed.
 */
export const aiToolOverrides: AiToolOverridesMap = {
  'example.get_todo_summary': {
    ...todoSummaryTool,
    requiredFeatures: [TODO_SUMMARY_OVERRIDE_FEATURE],
  },
}

export default aiTools
