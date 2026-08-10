import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'

const TODOS_API = '/api/example/todos'
const TOOLS_API = '/api/ai_assistant/tools'
const TOOLS_EXECUTE_API = '/api/ai_assistant/tools/execute'
const AGENTS_API = '/api/ai_assistant/ai/agents'

const SUMMARY_TOOL = 'example.get_todo_summary'
const PRIORITY_TOOL = 'example.get_customer_priority'
const EXAMPLE_AGENT_ID = 'example.todo_assistant'
const CUSTOMERS_AGENT_ID = 'customers.account_assistant'
/** What the file-tier override in `ai-tools.ts` / `ai-agents.ts` raises the gate to. */
const OVERRIDE_FEATURE = 'example.todos.manage'
/** The user-create route enforces a password policy; the seeded demo password does not pass it. */
const LIMITED_USER_PASSWORD = 'Tc-Example-014!Secret'

type ToolSummary = { name: string; description: string; module: string; inputSchema: Record<string, unknown> }
type AgentSummary = {
  id: string
  moduleId: string
  readOnly: boolean
  mutationPolicy: string
  allowedTools: string[]
  requiredFeatures: string[]
  systemPrompt: string
  suggestions: unknown[]
  tools: Array<{ name: string; isMutation: boolean; registered: boolean }>
}
type ExecuteResult = { success?: boolean; result?: Record<string, unknown>; error?: string }

async function listTools(request: APIRequestContext, token: string): Promise<ToolSummary[]> {
  const response = await apiRequest(request, 'GET', TOOLS_API, { token })
  expect(response.ok(), `list tools failed: ${response.status()}`).toBeTruthy()
  return ((await response.json()) as { tools?: ToolSummary[] }).tools ?? []
}

async function listAgents(request: APIRequestContext, token: string): Promise<AgentSummary[]> {
  const response = await apiRequest(request, 'GET', AGENTS_API, { token })
  expect(response.ok(), `list agents failed: ${response.status()}`).toBeTruthy()
  return ((await response.json()) as { agents?: AgentSummary[] }).agents ?? []
}

async function executeTool(
  request: APIRequestContext,
  token: string,
  toolName: string,
  args: Record<string, unknown> = {},
) {
  return apiRequest(request, 'POST', TOOLS_EXECUTE_API, { token, data: { toolName, args } })
}

/**
 * Milestone B coverage for the module's AI surfaces.
 *
 * Four distinct mechanisms live in two files and are read by four different generator paths:
 * the tool pack (`aiTools`), the read-only agent (`aiAgents`), the keyed file-tier overrides
 * (`aiToolOverrides` / `aiAgentOverrides`), and the unkeyed additive extension
 * (`aiAgentExtensions`) that patches an agent the customers module owns. They are easy to
 * confuse on paper and behave completely differently at runtime, so each is exercised at its own
 * call site.
 *
 * No model and no provider are involved. `POST /api/ai_assistant/tools/execute` is the real
 * dispatch path the MCP transport uses, minus the LLM — which makes the ACL gate and the scope
 * boundary assertable as facts rather than as prompt behaviour. That matters most for the scope
 * boundary: the tools take no tenant or organization argument precisely so a prompt-injected
 * model cannot address another scope, and the only way to prove it is to put a row in another
 * organization and watch the tool refuse to count it.
 */
test.describe('TC-EXAMPLE-014: the example AI tool pack, agent, overrides and extension', () => {
  test('discovers a read-only agent whose whitelist resolves to registered, non-mutating tools', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')

    const tools = await listTools(request, token)
    const byName = new Map(tools.map((tool) => [tool.name, tool]))
    expect(byName.has(SUMMARY_TOOL), 'the summary tool must be discoverable').toBe(true)
    expect(byName.has(PRIORITY_TOOL), 'the customer-priority tool must be discoverable').toBe(true)
    expect(byName.get(SUMMARY_TOOL)!.module).toBe('example')

    // The summary tool takes NO arguments — that is the security property, not an omission:
    // a `tenantId` input would let the model address another tenant's rows.
    const summarySchema = byName.get(SUMMARY_TOOL)!.inputSchema
    expect(Object.keys((summarySchema.properties as Record<string, unknown>) ?? {})).toEqual([])
    const prioritySchema = byName.get(PRIORITY_TOOL)!.inputSchema
    expect(Object.keys((prioritySchema.properties as Record<string, unknown>) ?? {})).toEqual(['customerId'])

    const agents = await listAgents(request, token)
    const agent = agents.find((candidate) => candidate.id === EXAMPLE_AGENT_ID)
    expect(agent, 'the example agent must be registered').toBeTruthy()
    expect(agent!.moduleId).toBe('example')
    expect(agent!.readOnly).toBe(true)
    expect(agent!.mutationPolicy).toBe('read-only')
    expect([...agent!.allowedTools].sort()).toEqual([PRIORITY_TOOL, SUMMARY_TOOL])

    // A whitelisted name that resolves to nothing would leave the agent advertising a tool the
    // runtime cannot call — the registry reports that per entry, so it is checked per entry.
    for (const tool of agent!.tools) {
      expect(tool.registered, `${tool.name} must resolve in the tool registry`).toBe(true)
      expect(tool.isMutation, `${tool.name} must be read-only, like the agent`).toBe(false)
    }
  })

  test('the keyed file-tier overrides raise the published gate on the agent and the tool alike', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')

    // `aiAgentOverrides` is keyed replace-or-disable: the replacement is derived from the base
    // by spread, so only the gate moves. What the registry publishes is the overridden value,
    // which is the observable difference between "the override is declared" and "it is applied".
    const agent = (await listAgents(request, token)).find((candidate) => candidate.id === EXAMPLE_AGENT_ID)
    expect(agent, 'the example agent must be registered').toBeTruthy()
    expect(agent!.requiredFeatures).toEqual([OVERRIDE_FEATURE])
    // Everything else is inherited from the base, not re-declared.
    expect([...agent!.allowedTools].sort()).toEqual([PRIORITY_TOOL, SUMMARY_TOOL])
    expect(agent!.readOnly).toBe(true)

    // The tool override is a separate mechanism read by a separate generator path, and it is
    // proved separately: the tool is reachable for a caller who has the raised feature.
    const executed = await executeTool(request, token, SUMMARY_TOOL)
    expect(executed.status(), 'admin carries example.* and must reach the raised tool').toBe(200)
  })

  test('the unkeyed extension lends this module\'s tool to an agent the customers module owns', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const agents = await listAgents(request, token)

    const customersAgent = agents.find((candidate) => candidate.id === CUSTOMERS_AGENT_ID)
    expect(customersAgent, 'the customers agent must be registered for the extension to patch').toBeTruthy()
    // Additive, not a replacement: the target still belongs to `customers`, and it now carries
    // this module's read tool alongside its own.
    expect(customersAgent!.moduleId).toBe('customers')
    expect(customersAgent!.allowedTools).toContain(PRIORITY_TOOL)
    expect(
      customersAgent!.allowedTools.some((name) => name.startsWith('customers.')),
      'the extension must not displace the agent\'s own tools',
    ).toBe(true)
    expect(customersAgent!.tools.find((tool) => tool.name === PRIORITY_TOOL)?.registered).toBe(true)

    // The prompt line that tells the assistant when to reach for the lent tool is appended, not
    // substituted — the upstream prompt has to survive.
    expect(customersAgent!.systemPrompt.length).toBeGreaterThan(0)
    expect(customersAgent!.systemPrompt).toContain('priority')
  })

  test('a real tool dispatch counts only the caller organization, never a sibling of the same tenant', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(token)
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    let otherOrgId: string | null = null
    let otherTodoId: string | null = null
    let homeTodoId: string | null = null

    try {
      const before = await executeTool(request, token, SUMMARY_TOOL)
      expect(before.status()).toBe(200)
      const baseline = ((await before.json()) as ExecuteResult).result as { total: number; open: number }
      expect(typeof baseline.total).toBe('number')

      otherOrgId = await createOrganizationFixture(request, token, {
        name: `TC-EXAMPLE-014 org ${suffix}`,
        tenantId,
      })
      const foreign = await apiRequestWithSelectedOrg(request, 'POST', TODOS_API, {
        token,
        selectedOrgId: otherOrgId,
        data: { title: `TC-EXAMPLE-014 foreign ${suffix}`, cf_priority: 1, cf_severity: 'low' },
      })
      expect(foreign.ok(), `create foreign todo failed: ${foreign.status()}`).toBeTruthy()
      otherTodoId = ((await foreign.json()) as { id?: string }).id ?? null
      expect(otherTodoId).toBeTruthy()

      // The tool takes no scope argument, so this is the whole isolation proof: a row created
      // in a sibling organization of the SAME tenant must not move the caller's counts.
      const afterForeign = await executeTool(request, token, SUMMARY_TOOL)
      expect(afterForeign.status()).toBe(200)
      const foreignCounts = ((await afterForeign.json()) as ExecuteResult).result as { total: number }
      expect(foreignCounts.total, 'a sibling organization\'s row must be invisible here').toBe(baseline.total)

      // ...and a row in the caller's own organization does move them, so the read is live
      // rather than merely constant.
      const home = await apiRequest(request, 'POST', TODOS_API, {
        token,
        data: { title: `TC-EXAMPLE-014 home ${suffix}`, cf_priority: 1, cf_severity: 'low' },
      })
      expect(home.ok()).toBeTruthy()
      homeTodoId = ((await home.json()) as { id?: string }).id ?? null

      await expect
        .poll(async () => {
          const response = await executeTool(request, token, SUMMARY_TOOL)
          if (response.status() !== 200) return -1
          return (((await response.json()) as ExecuteResult).result as { total: number }).total
        }, { timeout: 20_000 })
        .toBe(baseline.total + 1)
    } finally {
      await deleteEntityIfExists(request, token, TODOS_API, homeTodoId)
      if (otherTodoId && otherOrgId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', TODOS_API, {
          token,
          selectedOrgId: otherOrgId,
          data: { id: otherTodoId },
        }).catch(() => undefined)
      }
      await deleteOrganizationIfExists(request, token, otherOrgId)
    }
  })

  test('an operator without the tool\'s feature can neither see nor execute it', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenScope(adminToken)
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const email = `tc-example-014-${suffix}@example.test`
    let roleId: string | null = null
    let userId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, {
        name: `tc-example-014-${suffix}`,
        tenantId,
      })
      // Enough to reach the AI surface at all, and deliberately nothing from `example.*`:
      // the ACL gate has to be what stops the caller, not a missing session.
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['ai_assistant.view'],
      })
      userId = await createUserFixture(request, adminToken, {
        email,
        password: LIMITED_USER_PASSWORD,
        organizationId,
        roles: [roleId],
        name: 'QA TC-EXAMPLE-014 limited operator',
      })

      const limitedToken = await getAuthToken(request, email, LIMITED_USER_PASSWORD)

      // Discovery is ACL-filtered, so an inaccessible tool is absent rather than listed and
      // then refused — a UI that rendered it would be advertising a dead button.
      const visible = await listTools(request, limitedToken)
      expect(visible.map((tool) => tool.name)).not.toContain(SUMMARY_TOOL)
      expect(visible.map((tool) => tool.name)).not.toContain(PRIORITY_TOOL)

      // And the gate is enforced at dispatch too, not only in the listing: the listing is a
      // convenience, the executor is the boundary.
      const refused = await executeTool(request, limitedToken, SUMMARY_TOOL)
      expect(refused.status(), 'the executor must refuse a caller without the feature').toBe(403)

      const agents = await listAgents(request, limitedToken)
      expect(agents.map((agent) => agent.id)).not.toContain(EXAMPLE_AGENT_ID)
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('the customer-priority tool answers null for a customer this module never scored', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')

    // A well-formed id the module has no row for. `null` is the honest answer; a throw here
    // would make "no opinion recorded" indistinguishable from "the tool is broken".
    const response = await executeTool(request, token, PRIORITY_TOOL, { customerId: randomUUID() })
    expect(response.status()).toBe(200)
    const body = (await response.json()) as ExecuteResult
    expect(body.success).toBe(true)
    expect((body.result as { priority: unknown }).priority).toBeNull()

    // The declared input schema is re-parsed inside the handler, so an invalid argument is
    // refused wherever the tool is invoked from — not only where the model was shown a schema.
    const invalid = await executeTool(request, token, PRIORITY_TOOL, { customerId: 'not-a-uuid' })
    expect(invalid.status(), 'a malformed argument must be refused, not coerced').toBe(400)
  })
})
