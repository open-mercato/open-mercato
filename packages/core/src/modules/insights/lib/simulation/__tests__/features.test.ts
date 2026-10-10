import { z } from 'zod'
import { defineSimulationKind } from '@open-mercato/shared/modules/insights/simulate'
import { simulationRunFeatures, storedRunFeatures } from '../features'
import { registerSimulateConfigEntries, resetSimulationRegistryForTests } from '../registry'

function kind(inputFeatures?: (input: { entity: string }) => string[]) {
  return defineSimulationKind<{ entity: string }, unknown>({
    kind: 'test_module.backtest',
    artifactKind: 'test_module.thing',
    labelKey: 'label',
    requiredFeatures: ['test_module.view'],
    inputSchema: z.object({ entity: z.string() }),
    version: 1,
    cellKeys: ['fires'],
    readArtifactVersion: async () => null,
    fingerprintProposal: () => 'fp',
    ...(inputFeatures ? { inputFeatures } : {}),
    run: async () => ({ status: 'done', recordsProcessed: 0, result: { groups: [], coverage: {}, caveats: [], fidelity: 'none', truncated: false } }),
  })
}

describe('simulation run features', () => {
  beforeEach(() => resetSimulationRegistryForTests())

  it('adds the proposal features to the kind features', () => {
    expect(simulationRunFeatures(kind((input) => [`${input.entity}.view`, '']), { entity: 'customers.deals' })).toEqual(['test_module.view', 'customers.deals.view'])
    expect(simulationRunFeatures(kind(), { entity: 'x' })).toEqual(['test_module.view'])
  })

  it('hands the registered adapters to inputFeatures', () => {
    registerSimulateConfigEntries([{ moduleId: 'm', config: { version: 1, eventAdapters: [{ eventId: 'm.thing.created', logResourceKinds: ['m.thing'], actionTypes: ['create'], requiredFeatures: ['m.things.view'], payloadFrom: () => null }] } }])
    const definition = defineSimulationKind<{ entity: string }, unknown>({
      ...kind(),
      inputFeatures: (_input, ctx) => ctx.eventAdapters.flatMap((adapter) => adapter.requiredFeatures),
    } as never)
    expect(simulationRunFeatures(definition, { entity: 'm.thing' })).toEqual(['test_module.view', 'm.things.view'])
  })

  it('fails closed when inputFeatures throws and falls back to the kind features for an unparsable stored proposal', () => {
    const throwing = kind(() => { throw new Error('boom') })
    expect(simulationRunFeatures(throwing, { entity: 'x' })).toContain('__simulation_input_features_unavailable__')
    expect(storedRunFeatures(kind((input) => [`${input.entity}.view`]), { entity: 'orders' })).toEqual(['test_module.view', 'orders.view'])
    expect(storedRunFeatures(kind((input) => [`${input.entity}.view`]), { nope: true })).toEqual(['test_module.view'])
  })
})
