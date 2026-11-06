import type { AwilixContainer } from 'awilix'
import { onBehalfOfUserIdForInvoker, resolveRunAsForAgent } from '../lib/identity/resolveRunAsForAgent'
import { withAgentActor } from '../lib/identity/agentWriteScope'
import { AgentPrincipalMissingError } from '../lib/runtime/errors'

const TENANT = 'tenant-1'
const ORG = 'org-1'
const HUMAN = 'human-1'
const AGENT_USER = 'agent-user-1'
const AGENT_ID = 'resolver_test.agent'

type Where = Record<string, unknown>

function containerWith(findOne: (entity: unknown, where: Where) => Promise<unknown>): AwilixContainer {
  const em = { fork: () => ({ findOne }) }
  return { resolve: (token: string) => (token === 'em' ? em : undefined) } as unknown as AwilixContainer
}

const enabledPrincipal = { userId: AGENT_USER, enabled: true }
const ctx = { tenantId: TENANT, organizationId: ORG, userId: HUMAN }

describe('onBehalfOfUserIdForInvoker', () => {
  it('reads the human behind every invoker kind', () => {
    expect(onBehalfOfUserIdForInvoker({ kind: 'user', userId: HUMAN })).toBe(HUMAN)
    expect(onBehalfOfUserIdForInvoker({ kind: 'api_key', apiKeyId: 'key-1', ownerUserId: HUMAN })).toBe(HUMAN)
    expect(onBehalfOfUserIdForInvoker({ kind: 'api_key', apiKeyId: 'key-1', ownerUserId: null })).toBeNull()
    expect(onBehalfOfUserIdForInvoker({ kind: 'workflow', actingUserId: HUMAN })).toBe(HUMAN)
    expect(
      onBehalfOfUserIdForInvoker({ kind: 'agent_token', agentUserId: AGENT_USER, onBehalfOfUserId: HUMAN, grantId: 'g-1' }),
    ).toBe(HUMAN)
    expect(onBehalfOfUserIdForInvoker(null)).toBeNull()
  })
})

describe('resolveRunAsForAgent', () => {
  it('looks the principal up by tenant, organization, agent, enabled and not deleted', async () => {
    const wheres: Where[] = []
    const container = containerWith(async (_entity, where) => {
      wheres.push(where)
      return enabledPrincipal
    })

    const runAs = await resolveRunAsForAgent(container, { agentId: AGENT_ID, entry: null, ctx })

    expect(runAs).toEqual({ agentUserId: AGENT_USER, onBehalfOfUserId: HUMAN })
    expect(wheres).toEqual([
      { tenantId: TENANT, organizationId: ORG, agentDefinitionId: AGENT_ID, enabled: true, deletedAt: null },
    ])
  })

  it('records no human for a system run without a user', async () => {
    const container = containerWith(async () => enabledPrincipal)
    const runAs = await resolveRunAsForAgent(container, { agentId: AGENT_ID, entry: null, ctx: { ...ctx, userId: '' } })
    expect(runAs).toEqual({ agentUserId: AGENT_USER, onBehalfOfUserId: null })
  })

  it("inherits the parent run's human inside a principal-bound parent", async () => {
    const container = containerWith(async () => enabledPrincipal)
    const runAs = await withAgentActor({ agentUserId: 'parent-agent', onBehalfOfUserId: HUMAN }, () =>
      resolveRunAsForAgent(container, { agentId: AGENT_ID, entry: null, ctx: { ...ctx, userId: 'parent-agent' } }),
    )
    expect(runAs).toEqual({ agentUserId: AGENT_USER, onBehalfOfUserId: HUMAN })
  })

  it('returns null for a missing or disabled principal unless the agent requires one', async () => {
    const missing = containerWith(async () => null)
    const disabled = containerWith(async () => ({ ...enabledPrincipal, enabled: false }))
    expect(await resolveRunAsForAgent(missing, { agentId: AGENT_ID, entry: null, ctx })).toBeNull()
    expect(await resolveRunAsForAgent(disabled, { agentId: AGENT_ID, entry: null, ctx })).toBeNull()

    const required = { id: AGENT_ID, principal: { roleFeatures: [], required: true } }
    await expect(resolveRunAsForAgent(missing, { agentId: AGENT_ID, entry: required, ctx })).rejects.toBeInstanceOf(
      AgentPrincipalMissingError,
    )
  })

  it('treats a failed lookup as no principal, and as missing when one is required', async () => {
    const failing = containerWith(async () => {
      throw new Error('[internal] database unavailable')
    })
    expect(await resolveRunAsForAgent(failing, { agentId: AGENT_ID, entry: null, ctx })).toBeNull()
    const required = { id: AGENT_ID, principal: { roleFeatures: [], required: true } }
    await expect(resolveRunAsForAgent(failing, { agentId: AGENT_ID, entry: required, ctx })).rejects.toMatchObject({
      code: 'agent_principal_missing',
    })
  })
})
