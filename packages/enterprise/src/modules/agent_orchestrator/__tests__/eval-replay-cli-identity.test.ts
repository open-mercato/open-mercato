/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(
    async (em: { findOne: (entity: unknown, where: unknown) => Promise<unknown> }, entity: unknown, where: unknown) =>
      em.findOne(entity, where),
  ),
  findWithDecryption: jest.fn(
    async (em: { find: (entity: unknown, where: unknown) => Promise<unknown> }, entity: unknown, where: unknown) =>
      em.find(entity, where),
  ),
}))

import { defineAgent, getAgentEntry } from '../lib/sdk/defineAgent'
import { executeCaseRun, resetEvalSetManifestCache } from '../lib/eval/evalReplayService'
import { EVAL_CLI_SENTINEL_OPERATOR, parseEvalCliOperator } from '../lib/eval/evalRunSettings'
import { enforceAgentInvocable } from '../lib/access/agentInvokeAccess'
import { resolveEffectiveToolAcl } from '../lib/identity/resolveEffectiveToolAcl'
import type { AgentRunCtx } from '../lib/runtime/persistence'
import { AgentEvalCase, AgentEvalCaseRun, AgentEvalSuiteRun, AgentPrincipal } from '../data/entities'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OPERATOR = '44444444-4444-4444-8444-444444444444'
const PRINCIPAL_USER = '99999999-9999-4999-8999-999999999999'
const API_KEY_OPERATOR = 'api_key:77777777-7777-4777-8777-777777777777'
const AGENT_ID = 'test.eval_cli_identity'
const GATED_FEATURE = 'secret_module.secret_feature'

type Row = Record<string, unknown>

function createFakeEm(seed: Map<unknown, Row[]>) {
  const stores = new Map<unknown, Row[]>(seed)
  const storeFor = (entity: unknown) => {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity) as Row[]
  }
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, value]) => {
      if (value !== null && typeof value === 'object') return true
      return (row[key] ?? null) === value
    })
  const em = {
    fork: () => em,
    async flush() {
      return undefined
    },
    async findOne(entity: unknown, where: Row) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Row) {
      return storeFor(entity).filter((row) => matches(row, where))
    },
  }
  return em as unknown as EntityManager
}

const principalRow: Row = {
  id: 'principal-1',
  tenantId: TENANT,
  organizationId: ORG,
  agentDefinitionId: AGENT_ID,
  userId: PRINCIPAL_USER,
  enabled: true,
  deletedAt: null,
}

const rbacService = {
  loadAcl: jest.fn(async (userId: string) =>
    userId === PRINCIPAL_USER || userId === OPERATOR
      ? { isSuperAdmin: false, features: [GATED_FEATURE] }
      : { isSuperAdmin: false, features: [] },
  ),
}

async function replayOnce(operatorUserId: string, principals: Row[] = [principalRow]) {
  const calls: AgentRunCtx[] = []
  const runtime = {
    run: jest.fn(async (_agentId: string, _input: unknown, ctx: AgentRunCtx) => {
      calls.push(ctx)
      throw new Error('stop after capturing the run ctx')
    }),
  }
  const em = createFakeEm(
    new Map<unknown, Row[]>([
      [AgentEvalCaseRun, [{ id: 'case-run-1', suiteRunId: 'suite-run-1', tenantId: TENANT, organizationId: ORG, evalCaseId: 'case-1', status: 'pending' }]],
      [AgentEvalSuiteRun, [{ id: 'suite-run-1', tenantId: TENANT, organizationId: ORG, agentDefinitionId: AGENT_ID, summary: null }]],
      [AgentEvalCase, [{ id: 'case-1', tenantId: TENANT, organizationId: ORG, agentDefinitionId: AGENT_ID, input: { question: 'q' }, deletedAt: null }]],
      [AgentPrincipal, principals],
    ]),
  )
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'rbacService') return rbacService
      return runtime
    },
  } as unknown as AwilixContainer
  await executeCaseRun(container, 'case-run-1', { tenantId: TENANT, organizationId: ORG }, operatorUserId)
  return { ctx: calls[0], container }
}

beforeAll(() => {
  defineAgent({
    id: AGENT_ID,
    moduleId: 'agent_orchestrator',
    label: 'Feature-gated, principal-bound agent',
    description: 'Gated by a feature and narrowing its tools to the principal.',
    instructions: 'BASE',
    requiredFeatures: [GATED_FEATURE],
    principal: { roleFeatures: [GATED_FEATURE], toolAcl: 'intersect' },
    result: { kind: 'research', schema: z.object({ kind: z.literal('research'), data: z.unknown() }) },
  })
})

beforeEach(() => {
  jest.clearAllMocks()
  resetEvalSetManifestCache()
})

describe('eval replay identity for the CLI gate', () => {
  it("without --user ('ci') a principal-bound case runs as the principal, which passes the invoke gate and keeps its tools", async () => {
    const { ctx, container } = await replayOnce('ci')
    expect(ctx.userId).toBe(PRINCIPAL_USER)
    expect(ctx.invoker).toEqual({ kind: 'user', userId: PRINCIPAL_USER })
    expect(ctx.runAs).toEqual({ agentUserId: PRINCIPAL_USER, onBehalfOfUserId: null })

    const entry = getAgentEntry(AGENT_ID)
    await expect(enforceAgentInvocable(container, entry!, ctx)).resolves.toBeUndefined()
    const acl = await resolveEffectiveToolAcl(container, AGENT_ID, entry, ctx)
    expect(acl.mode).toBe('intersect')
    expect(acl.features).toEqual([GATED_FEATURE])
    expect(rbacService.loadAcl).not.toHaveBeenCalledWith('ci', expect.anything())
  })

  it('with --user the case runs as that operator with the principal bound through runAs', async () => {
    const { ctx } = await replayOnce(OPERATOR)
    expect(ctx.userId).toBe(OPERATOR)
    expect(ctx.invoker).toEqual({ kind: 'user', userId: OPERATOR })
    expect(ctx.runAs).toEqual({ agentUserId: PRINCIPAL_USER, onBehalfOfUserId: OPERATOR })
  })

  it('an API-key operator keeps its own identity and never borrows the principal as caller', async () => {
    const { ctx } = await replayOnce(API_KEY_OPERATOR)
    expect(ctx.userId).toBe(API_KEY_OPERATOR)
    expect(ctx.invoker).toEqual({ kind: 'user', userId: API_KEY_OPERATOR })
    expect(ctx.runAs).toEqual({ agentUserId: PRINCIPAL_USER, onBehalfOfUserId: API_KEY_OPERATOR })
  })

  it("without --user and without a principal the 'ci' identity is kept and nothing is bound", async () => {
    const { ctx } = await replayOnce('ci', [])
    expect(ctx.userId).toBe('ci')
    expect(ctx.runAs).toBeUndefined()
  })
})

describe('parseEvalCliOperator', () => {
  it('returns null when neither the flag nor the env is set', () => {
    expect(parseEvalCliOperator(undefined, undefined)).toEqual({ ok: true, value: null })
    expect(parseEvalCliOperator(undefined, '  ')).toEqual({ ok: true, value: null })
  })

  it('prefers the flag over the env value', () => {
    expect(parseEvalCliOperator(OPERATOR, PRINCIPAL_USER)).toEqual({ ok: true, value: OPERATOR })
    expect(parseEvalCliOperator(undefined, PRINCIPAL_USER)).toEqual({ ok: true, value: PRINCIPAL_USER })
  })

  it('rejects a value that is not a UUID', () => {
    expect(parseEvalCliOperator('ci', undefined)).toEqual({ ok: false, message: expect.stringContaining('--user') })
    expect(parseEvalCliOperator(undefined, 'admin@example.com')).toMatchObject({ ok: false })
  })

  it("keeps the CLI sentinel operator as the literal 'ci'", () => {
    expect(EVAL_CLI_SENTINEL_OPERATOR).toBe('ci')
  })
})
