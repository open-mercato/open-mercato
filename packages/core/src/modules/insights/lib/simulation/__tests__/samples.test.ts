import { registerExplainConfigEntries, resetExplainRegistryForTests } from '../../explain-registry'
import { confirmSimulationSamples, resolveSimulationSamples, toInternalHref } from '../samples'
import type { SimulationResultGroup } from '../privacy'

const SCOPE = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const visibleIds = new Set(['a', 'b', 'c', 'd'])
const loadCurrent = jest.fn(async (ctx: { scope: { organizationIds: string[] | null } }, id: string) => (
  visibleIds.has(id) && ctx.scope.organizationIds?.[0] === SCOPE.organizationId ? { id } : null
))

const em = { fork: () => em } as never
const container = { resolve: () => { throw new Error('none') } }

function group(cells: SimulationResultGroup['cells'], sampleResourceKind: string | null = 'test.thing'): SimulationResultGroup {
  return { key: 'test.thing.updated', labelKey: null, sampleResourceKind, total: 50, suppressed: false, cells, warnings: [], flags: [] }
}

beforeEach(() => {
  jest.clearAllMocks()
  resetExplainRegistryForTests()
  registerExplainConfigEntries([{
    moduleId: 'test',
    config: {
      version: 1,
      resources: [{
        resourceKind: 'test.thing',
        labelKey: 'test.thing',
        requiredFeatures: ['test.things.view'],
        loadCurrent,
        fields: [],
        recordHref: (id: string) => (id === 'b' ? 'javascript:alert(1)' : `/backend/things/${id}`),
      }],
    },
  }])
})

describe('simulation sample ids (S14)', () => {
  it('keeps at most three ids per visible cell that the scoped loadCurrent confirms for the requester', async () => {
    const confirmed = await confirmSimulationSamples(container, em, SCOPE, 'user-1', async () => true, [
      group([
        { key: 'fires', count: 20, suppressed: null, sampleIds: ['x', 'a', 'b', 'c', 'd'] },
        { key: 'cannot_tell', count: null, suppressed: 'below_k', sampleIds: [] },
      ]),
    ])
    expect(confirmed[0].cells[0].sampleIds).toEqual(['a', 'b', 'c'])
    expect(loadCurrent).toHaveBeenCalledWith(expect.objectContaining({ scope: { tenantId: SCOPE.tenantId, organizationIds: [SCOPE.organizationId] }, userId: 'user-1' }), 'x')
  })

  it('keeps none without the resource features or an explain resource', async () => {
    const denied = await confirmSimulationSamples(container, em, SCOPE, 'user-1', async () => false, [group([{ key: 'fires', count: 20, suppressed: null, sampleIds: ['a'] }])])
    expect(denied[0].cells[0].sampleIds).toEqual([])
    const unknown = await confirmSimulationSamples(container, em, SCOPE, 'user-1', async () => true, [group([{ key: 'fires', count: 20, suppressed: null, sampleIds: ['a'] }], 'other.kind')])
    expect(unknown[0].cells[0].sampleIds).toEqual([])
    expect(loadCurrent).not.toHaveBeenCalled()
  })

  it('resolves stored ids live for the viewer, dropping records they can no longer read', async () => {
    visibleIds.delete('c')
    const samples = await resolveSimulationSamples(container, em, SCOPE, 'user-1', async () => true, 'test.thing', ['a', 'c', 'b'])
    expect(samples).toEqual([{ id: 'a', href: '/backend/things/a' }, { id: 'b', href: null }])
    expect(await resolveSimulationSamples(container, em, SCOPE, 'user-1', async () => false, 'test.thing', ['a'])).toEqual([])
    expect(await resolveSimulationSamples(container, em, SCOPE, 'user-1', async () => true, null, ['a'])).toEqual([])
    visibleIds.add('c')
  })

  it('accepts app-internal paths only', () => {
    expect(toInternalHref('/backend/rules/1?x=1')).toBe('/backend/rules/1?x=1')
    expect(toInternalHref('//evil.example')).toBeNull()
    expect(toInternalHref('https://evil.example')).toBeNull()
    expect(toInternalHref('/back\\slash')).toBeNull()
    expect(toInternalHref(null)).toBeNull()
  })
})
