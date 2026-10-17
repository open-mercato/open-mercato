const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silent = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn(), child: () => silent }
  return { ...actual, createLogger: () => silent }
})

const supersedeProcessSuggestionsMock = jest.fn(async (..._args: unknown[]) => 1)
const clearSuggestionPassMock = jest.fn(async (..._args: unknown[]) => undefined)

jest.mock('../../suggestions/store', () => ({ supersedeProcessSuggestions: (...args: unknown[]) => supersedeProcessSuggestionsMock(...args) }))
jest.mock('../../suggestions/passes', () => ({ clearSuggestionPass: (...args: unknown[]) => clearSuggestionPassMock(...args) }))
jest.mock('../pseudonym', () => {
  const actual = jest.requireActual('../pseudonym')
  return { ...actual, createActorPseudonymizer: async () => ({ mode: 'tenant_key', fingerprint: 'tk1:test', pseudonymize: (id: string) => `tk1:${id}` }) }
})

import type { ProcessActorDimensionContext, ProcessModuleConfig } from '@open-mercato/shared/modules/insights/process'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createActorDimensionResolver, createXrayIngestDeps, resolveRedactedFields } from '../runtime'
import { valueCapScope } from '../../process/values'
import { buildProcessRegistrySnapshot } from '../../process/registry'
import { ORG_ID, OTHER_USER_ID, TENANT_ID, USER_ID, testRegistry } from '../../process/__tests__/processTestSupport'

const ROLE_LOW = '88888888-0000-4000-8000-000000000001'
const ROLE_HIGH = '88888888-0000-4000-8000-00000000000b'
const TEAM_LOW = '99999999-0000-4000-8000-000000000001'
const TEAM_HIGH = '99999999-0000-4000-8000-00000000000a'

const context = { em: {}, tenantId: TENANT_ID, organizationId: ORG_ID } as unknown as ProcessActorDimensionContext

function registryWith(resolveRoles: (ctx: ProcessActorDimensionContext, ids: string[]) => Promise<Record<string, string[]>>) {
  const config: ProcessModuleConfig = {
    version: 1,
    actorDimensions: [
      { kind: 'role', resolve: resolveRoles },
      { kind: 'team', resolve: async (_ctx, ids) => Object.fromEntries(ids.map((id) => [id, [TEAM_HIGH, TEAM_LOW, 'not-a-uuid']])) },
    ],
  }
  return buildProcessRegistrySnapshot([{ moduleId: 'test', config }], [{ moduleId: 'test', maps: [] }])
}

describe('createActorDimensionResolver', () => {
  beforeEach(() => reportErrorMock.mockClear())

  it('keeps UUID dimensions only, sorted, and attributes the lowest team id', async () => {
    const resolve = createActorDimensionResolver(registryWith(async (_ctx, ids) => Object.fromEntries(ids.map((id) => [id, [ROLE_HIGH, ROLE_LOW.toUpperCase()]]))), context)
    const resolved = await resolve([USER_ID, OTHER_USER_ID, 'nope'])
    expect(resolved.get(USER_ID)).toEqual({ roleIds: [ROLE_LOW, ROLE_HIGH], teamId: TEAM_LOW })
    expect(resolved.has('nope')).toBe(false)
  })

  it('fails the slice (reported once) when a dimension provider fails, so events are never written without their dimensions', async () => {
    const failure = new Error('roles lookup failed')
    const resolve = createActorDimensionResolver(registryWith(async () => {
      throw failure
    }), context)
    await expect(resolve([USER_ID])).rejects.toBe(failure)
    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(failure, expect.objectContaining({ module: 'insights', code: 'insights.xray_dimension_failed', attributes: { kind: 'role' } }))
  })
})

describe('resolveRedactedFields', () => {
  const scope = { tenantId: TENANT_ID, organizationId: ORG_ID }

  it('redacts declared fields the tenant encrypts, root and milestone', async () => {
    const lookup = {
      getEncryptedFieldNames: jest.fn(async (entityId: string) => (entityId === 'test:deal' ? ['priority'] : entityId === 'test:payment' ? ['Status'] : [])),
    }
    const redacted = await resolveRedactedFields(testRegistry(), lookup, scope, {} as EntityManager)
    expect(redacted).toEqual(new Set([valueCapScope('test.deal', 'priority'), valueCapScope('test.deal', 'payment.status')]))
  })

  it('fails closed when the tenant encryption service is unavailable', async () => {
    await expect(resolveRedactedFields(testRegistry(), undefined, scope, {} as EntityManager)).rejects.toThrow('[internal]')
  })
})

describe('createXrayIngestDeps — suggestions of rebuilt processes', () => {
  const scope = { tenantId: TENANT_ID, organizationId: ORG_ID }
  const kysely = { kind: 'kysely' }
  const container = {
    resolve: (name: string): unknown => {
      if (name === 'em') return { fork: () => ({ getKysely: () => kysely }) }
      if (name === 'actionLogService') return {}
      if (name === 'tenantEncryptionService') return { getEncryptedFieldNames: async () => [] }
      throw new Error(`[internal] unexpected ${name}`)
    },
  }

  beforeEach(() => {
    supersedeProcessSuggestionsMock.mockClear()
    clearSuggestionPassMock.mockClear()
    reportErrorMock.mockClear()
  })

  it('supersedes the open suggestions of the cleared processes and forgets the mining pass', async () => {
    const { deps } = await createXrayIngestDeps(container, scope, testRegistry())
    await deps.onProcessRebuild?.(scope, ['test.deal'])
    expect(supersedeProcessSuggestionsMock).toHaveBeenCalledWith(kysely, scope, ['test.deal'])
    expect(clearSuggestionPassMock).toHaveBeenCalledWith(kysely, scope)
  })

  it('never fails the projection slice when the suggestions cannot be superseded (logged and reported)', async () => {
    const { deps } = await createXrayIngestDeps(container, scope, testRegistry())
    supersedeProcessSuggestionsMock.mockRejectedValueOnce(new Error('lock timeout'))
    await expect(deps.onProcessRebuild?.(scope, ['test.deal'])).resolves.toBeUndefined()
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ code: 'insights.xray_suggestions_supersede_failed' }))
  })
})
