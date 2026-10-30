/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { captureLogs } from './support/captureLogs'
import {
  resetToolAclModeWarning,
  resolveEffectiveToolAcl,
  resolveToolAclMode,
} from '../lib/identity/resolveEffectiveToolAcl'
import { AgentPrincipalMissingError } from '../lib/runtime/errors'
import type { AgentRunCtx } from '../lib/runtime/persistence'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const HUMAN = '33333333-3333-4333-8333-333333333333'
const AGENT_USER = '44444444-4444-4444-8444-444444444444'
const AGENT_ID = 'acl_test.researcher'

type Grants = { features: string[]; isSuperAdmin: boolean }

function containerWith(grantsByUser: Record<string, Grants | Error>) {
  const loadAcl = jest.fn(async (userId: string, _scope: { tenantId: string | null; organizationId: string | null }) => {
    const grants = grantsByUser[userId]
    if (grants instanceof Error) throw grants
    return grants ?? { features: [], isSuperAdmin: false }
  })
  const container = {
    resolve: (name: string) => {
      if (name === 'rbacService') return { loadAcl }
      throw new Error(`[internal] unexpected resolve("${name}")`)
    },
  } as unknown as AwilixContainer
  return { container, loadAcl }
}

const callerCtx: AgentRunCtx = { tenantId: TENANT, organizationId: ORG, userId: HUMAN }
const boundCtx: AgentRunCtx = { ...callerCtx, runAs: { agentUserId: AGENT_USER, onBehalfOfUserId: HUMAN } }
const intersectEntry = { principal: { roleFeatures: ['customers.deals.view'], toolAcl: 'intersect' as const } }
const callerGrants: Grants = { features: ['customers.deals.view', 'customers.people.view'], isSuperAdmin: false }
const principalGrants: Grants = { features: ['customers.deals.*', 'sales.orders.view'], isSuperAdmin: false }

afterEach(() => {
  delete process.env.OM_AGENT_TOOL_ACL_MODE
  resetToolAclModeWarning()
})

describe('resolveToolAclMode', () => {
  it('defaults to caller', () => {
    expect(resolveToolAclMode(undefined)).toBe('caller')
    expect(resolveToolAclMode({ principal: { roleFeatures: [] } })).toBe('caller')
  })

  it('uses OM_AGENT_TOOL_ACL_MODE when the agent declares no mode', () => {
    process.env.OM_AGENT_TOOL_ACL_MODE = 'intersect'
    expect(resolveToolAclMode({ principal: { roleFeatures: [] } })).toBe('intersect')
  })

  it("prefers the agent's declared mode over the environment", () => {
    process.env.OM_AGENT_TOOL_ACL_MODE = 'intersect'
    expect(resolveToolAclMode({ principal: { roleFeatures: [], toolAcl: 'caller' } })).toBe('caller')
  })

  it('falls back to caller on a malformed value and warns once', () => {
    process.env.OM_AGENT_TOOL_ACL_MODE = 'narrow'
    const logs = captureLogs()
    try {
      expect(resolveToolAclMode(undefined)).toBe('caller')
      expect(resolveToolAclMode(undefined)).toBe('caller')
      expect(logs.at('warn').filter((record) => record.message.includes('OM_AGENT_TOOL_ACL_MODE'))).toHaveLength(1)
    } finally {
      logs.restore()
    }
  })
})

describe('resolveEffectiveToolAcl', () => {
  it("caller mode returns the caller's ACL unchanged and never loads the principal's", async () => {
    const { container, loadAcl } = containerWith({ [HUMAN]: callerGrants, [AGENT_USER]: principalGrants })

    const acl = await resolveEffectiveToolAcl(container, AGENT_ID, undefined, boundCtx)

    expect(acl).toEqual({ features: callerGrants.features, isSuperAdmin: false, mode: 'caller' })
    expect(loadAcl).toHaveBeenCalledTimes(1)
    expect(loadAcl).toHaveBeenCalledWith(HUMAN, { tenantId: TENANT, organizationId: ORG })
  })

  it('caller mode keeps the fail-closed fallback when RBAC is unavailable', async () => {
    const { container } = containerWith({ [HUMAN]: new Error('rbac down') })

    const acl = await resolveEffectiveToolAcl(container, AGENT_ID, undefined, callerCtx)

    expect(acl).toEqual({ features: [], isSuperAdmin: false, mode: 'caller' })
  })

  it('intersect mode keeps only the grants both the principal and the caller hold', async () => {
    const { container, loadAcl } = containerWith({ [HUMAN]: callerGrants, [AGENT_USER]: principalGrants })

    const acl = await resolveEffectiveToolAcl(container, AGENT_ID, intersectEntry, boundCtx)

    expect(acl).toEqual({
      features: ['customers.deals.view'],
      isSuperAdmin: false,
      mode: 'intersect',
      callerAcl: callerGrants,
    })
    expect(loadAcl).toHaveBeenCalledWith(AGENT_USER, { tenantId: TENANT, organizationId: ORG })
  })

  it("a super-admin caller collapses to the principal's grants", async () => {
    const { container } = containerWith({
      [HUMAN]: { features: [], isSuperAdmin: true },
      [AGENT_USER]: principalGrants,
    })

    const acl = await resolveEffectiveToolAcl(container, AGENT_ID, intersectEntry, boundCtx)

    expect(acl).toEqual({
      features: ['customers.deals.*', 'sales.orders.view'],
      isSuperAdmin: false,
      mode: 'intersect',
      callerAcl: { features: [], isSuperAdmin: true },
    })
  })

  it("fails closed when the principal's ACL cannot be loaded", async () => {
    const { container } = containerWith({ [HUMAN]: callerGrants, [AGENT_USER]: new Error('rbac down') })

    const acl = await resolveEffectiveToolAcl(container, AGENT_ID, intersectEntry, boundCtx)

    expect(acl).toEqual({ features: [], isSuperAdmin: false, mode: 'intersect', callerAcl: callerGrants })
  })

  it("uses the caller's ACL when no principal is bound", async () => {
    const { container } = containerWith({ [HUMAN]: callerGrants })

    const acl = await resolveEffectiveToolAcl(container, AGENT_ID, intersectEntry, callerCtx)

    expect(acl).toEqual({ features: callerGrants.features, isSuperAdmin: false, mode: 'intersect' })
  })

  it('refuses when no principal is bound and the agent requires one', async () => {
    const { container } = containerWith({ [HUMAN]: callerGrants })
    const requiredEntry = { principal: { ...intersectEntry.principal, required: true } }

    await expect(resolveEffectiveToolAcl(container, AGENT_ID, requiredEntry, callerCtx)).rejects.toBeInstanceOf(
      AgentPrincipalMissingError,
    )
  })
})
