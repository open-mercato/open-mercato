import { buildDefinitionPayload, buildMetadataPayload } from '../definition-payload'
import { workflowMetadataSchema } from '../../data/validators'
import { STEP_TYPE_MIN_ENGINE_VERSIONS, TRANSITION_KIND_MIN_ENGINE_VERSIONS } from '../engine-version'
import type { WorkflowContextSchema, WorkflowDefinitionData, WorkflowDefinitionTrigger } from '../../data/entities'

const graphDefinition: WorkflowDefinitionData = {
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ],
  transitions: [{ transitionId: 't1', fromStepId: 'start', toStepId: 'end', trigger: 'AUTO' }],
}

const contextSchema: WorkflowContextSchema = {
  input: {
    fields: [{ name: 'orderId', type: 'text', required: true }],
  },
}

const triggers: WorkflowDefinitionTrigger[] = [
  { triggerId: 'trg_1', name: 'Order created', eventPattern: 'sales.order.created', enabled: true, priority: 0 },
]

const asWirePayload = (value: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(value))

describe('buildDefinitionPayload', () => {
  it('carries contextSchema alongside triggers through a wire round trip', () => {
    const payload = asWirePayload(buildDefinitionPayload({ graphDefinition, triggers, contextSchema }))
    expect(payload.contextSchema).toEqual(contextSchema)
    expect(payload.triggers).toEqual(asWirePayload(triggers))
    expect(payload.steps).toEqual(graphDefinition.steps)
  })

  it('omits contextSchema and triggers from the wire payload when absent', () => {
    const payload = asWirePayload(buildDefinitionPayload({ graphDefinition, triggers: [], contextSchema: undefined }))
    expect(payload).not.toHaveProperty('contextSchema')
    expect(payload).not.toHaveProperty('triggers')
  })

  it('treats null contextSchema the same as absent', () => {
    const payload = asWirePayload(buildDefinitionPayload({ graphDefinition, triggers: [], contextSchema: null }))
    expect(payload).not.toHaveProperty('contextSchema')
  })

  it('carries the io port contract through a wire round trip', () => {
    const io = { inputs: [{ name: 'orderId', type: 'text' as const, label: 'Order', required: true }] }
    const payload = asWirePayload(buildDefinitionPayload({ graphDefinition, triggers: [], contextSchema: undefined, io }))
    expect(payload.io).toEqual(io)
  })

  it('omits io from the wire payload when absent or null', () => {
    const absent = asWirePayload(buildDefinitionPayload({ graphDefinition, triggers: [], contextSchema: undefined }))
    expect(absent).not.toHaveProperty('io')
    const nulled = asWirePayload(buildDefinitionPayload({ graphDefinition, triggers: [], contextSchema: undefined, io: null }))
    expect(nulled).not.toHaveProperty('io')
  })

  it('carries the interpolation mode through a wire round trip', () => {
    const strict = asWirePayload(buildDefinitionPayload({ graphDefinition, triggers: [], interpolation: 'strict' }))
    expect(strict.interpolation).toBe('strict')
    const lenient = asWirePayload(buildDefinitionPayload({ graphDefinition, triggers: [], interpolation: 'lenient' }))
    expect(lenient.interpolation).toBe('lenient')
  })

  it('omits interpolation from the wire payload when absent or null', () => {
    const absent = asWirePayload(buildDefinitionPayload({ graphDefinition, triggers: [] }))
    expect(absent).not.toHaveProperty('interpolation')
    const nulled = asWirePayload(buildDefinitionPayload({ graphDefinition, triggers: [], interpolation: null }))
    expect(nulled).not.toHaveProperty('interpolation')
  })
})

describe('buildMetadataPayload', () => {
  it('preserves unknown loaded-metadata keys while overlaying the edited fields', () => {
    const loadedMetadata = {
      category: 'Sales',
      tags: ['old'],
      icon: 'ShoppingCart',
      editor: { samples: { step_1: { pinnedAt: '2026-07-27T00:00:00Z', source: 'manual', data: { orderId: '42' } } } },
    }
    const payload = buildMetadataPayload({ loadedMetadata, category: 'Fulfillment', tags: ['new'], icon: 'Truck' })
    expect(payload).toEqual({
      category: 'Fulfillment',
      tags: ['new'],
      icon: 'Truck',
      editor: loadedMetadata.editor,
    })
  })

  it('removes fields the user cleared in the editor', () => {
    const loadedMetadata = { category: 'Sales', tags: ['old'], icon: 'ShoppingCart', editor: { samples: {} } }
    const payload = buildMetadataPayload({ loadedMetadata, category: '', tags: [], icon: '' })
    expect(payload).toEqual({ editor: { samples: {} } })
  })

  it('round-trips loaded metadata unchanged when edits mirror the loaded values', () => {
    const loadedMetadata = { category: 'Sales', tags: ['a', 'b'], icon: 'ShoppingCart', editor: { samples: {} } }
    const payload = buildMetadataPayload({ loadedMetadata, category: 'Sales', tags: ['a', 'b'], icon: 'ShoppingCart' })
    expect(payload).toEqual(loadedMetadata)
  })

  it('returns null when nothing is set', () => {
    expect(buildMetadataPayload({ loadedMetadata: null, category: '', tags: [], icon: '' })).toBeNull()
    expect(buildMetadataPayload({ loadedMetadata: {}, category: '', tags: [], icon: '' })).toBeNull()
  })

  it('starts from a clean slate when no loaded metadata is carried (template or blank canvas)', () => {
    const payload = buildMetadataPayload({ loadedMetadata: null, category: 'E-Commerce', tags: [], icon: 'ShoppingCart' })
    expect(payload).toEqual({ category: 'E-Commerce', icon: 'ShoppingCart' })
  })

  it('survives the server-side metadata parse with editor.samples intact', () => {
    const loadedMetadata = {
      category: 'Sales',
      editor: {
        samples: {
          step_1: { pinnedAt: '2026-07-27T00:00:00.000Z', source: 'manual', data: { orderId: '42' } },
        },
      },
    }
    const payload = buildMetadataPayload({ loadedMetadata, category: 'Sales', tags: [], icon: '' })
    const parsed = workflowMetadataSchema.parse(asWirePayload(payload))
    expect(parsed.editor).toEqual(loadedMetadata.editor)
  })

  it('stamps minEngineVersion when the definition uses a branching step type', () => {
    const branchingDefinition: WorkflowDefinitionData = {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'branch', stepName: 'Branch', stepType: 'IF_ELSE' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: graphDefinition.transitions,
    }
    const payload = buildMetadataPayload({
      loadedMetadata: null,
      category: '',
      tags: [],
      icon: '',
      definition: branchingDefinition,
    })
    expect(payload).toEqual({ minEngineVersion: STEP_TYPE_MIN_ENGINE_VERSIONS.IF_ELSE })
  })

  it('stamps the WAIT_FOR_CONDITION engine version when the definition uses that step type', () => {
    const conditionDefinition: WorkflowDefinitionData = {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'wait', stepName: 'Wait', stepType: 'WAIT_FOR_CONDITION' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: graphDefinition.transitions,
    }
    const payload = buildMetadataPayload({
      loadedMetadata: null,
      category: '',
      tags: [],
      icon: '',
      definition: conditionDefinition,
    })
    expect(payload).toEqual({ minEngineVersion: STEP_TYPE_MIN_ENGINE_VERSIONS.WAIT_FOR_CONDITION })
  })

  it('stamps the outcome-transition engine version when the definition uses agent disposition routing', () => {
    const outcomeDefinition: WorkflowDefinitionData = {
      steps: graphDefinition.steps,
      transitions: [
        {
          transitionId: 't1',
          fromStepId: 'agent',
          toStepId: 'end',
          trigger: 'AUTO',
          kind: 'outcome',
          outcomeKind: 'approved',
        },
      ],
    }
    const payload = buildMetadataPayload({
      loadedMetadata: null,
      category: '',
      tags: [],
      icon: '',
      definition: outcomeDefinition,
    })
    expect(payload).toEqual({ minEngineVersion: TRANSITION_KIND_MIN_ENGINE_VERSIONS.outcome })
  })

  it('stamps the highest engine version required across steps and transitions', () => {
    const mixedDefinition: WorkflowDefinitionData = {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'branch', stepName: 'Branch', stepType: 'IF_ELSE' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        {
          transitionId: 't1',
          fromStepId: 'branch',
          toStepId: 'end',
          trigger: 'AUTO',
          kind: 'outcome',
          outcomeKind: 'approved',
        },
      ],
    }
    const payload = buildMetadataPayload({
      loadedMetadata: null,
      category: '',
      tags: [],
      icon: '',
      definition: mixedDefinition,
    })
    expect(payload).toEqual({ minEngineVersion: TRANSITION_KIND_MIN_ENGINE_VERSIONS.outcome })
  })

  it('leaves baseline definitions without a minEngineVersion key', () => {
    const payload = buildMetadataPayload({
      loadedMetadata: { category: 'Sales', minEngineVersion: 2 },
      category: 'Sales',
      tags: [],
      icon: '',
      definition: graphDefinition,
    })
    expect(payload).toEqual({ category: 'Sales' })
  })

  it('writes editor annotations through every persistence path', () => {
    const annotations = {
      notes: [{ id: 'note_1', markdown: '## Why', position: { x: 1, y: 2 }, size: { width: 220, height: 140 } }],
      groups: [{ id: 'group_1', name: 'Ops', rect: { x: 0, y: 0, width: 360, height: 260 }, collapsed: true }],
    }
    const payload = buildMetadataPayload({ loadedMetadata: null, category: '', tags: [], icon: '', annotations })
    const parsed = workflowMetadataSchema.parse(asWirePayload(payload))
    expect(parsed.editor?.annotations).toEqual(annotations)
  })

  it('keeps pinned samples when annotations are written alongside them', () => {
    const samples = { step_1: { pinnedAt: '2026-07-27T00:00:00.000Z', source: 'manual' as const, data: { orderId: '42' } } }
    const payload = buildMetadataPayload({
      loadedMetadata: { editor: { samples } },
      category: '',
      tags: [],
      icon: '',
      annotations: { notes: [{ id: 'n', markdown: 'x', position: { x: 0, y: 0 }, size: { width: 220, height: 140 } }], groups: [] },
    })
    expect((payload?.editor as Record<string, unknown>).samples).toEqual(samples)
  })

  it('drops the annotations key when the canvas carries none', () => {
    const payload = buildMetadataPayload({
      loadedMetadata: { editor: { annotations: { notes: [{ id: 'n', markdown: 'x', position: { x: 0, y: 0 }, size: { width: 1, height: 1 } }] } } },
      category: '',
      tags: [],
      icon: '',
      annotations: { notes: [], groups: [] },
    })
    expect(payload).toBeNull()
  })

  it('leaves loaded annotations untouched when no annotations argument is supplied', () => {
    const loadedMetadata = { editor: { annotations: { notes: [{ id: 'n', markdown: 'x', position: { x: 0, y: 0 }, size: { width: 1, height: 1 } }] } } }
    const payload = buildMetadataPayload({ loadedMetadata, category: '', tags: [], icon: '' })
    expect(payload).toEqual(loadedMetadata)
  })

  it('does not mutate the carried loaded-metadata object', () => {
    const loadedMetadata = { category: 'Sales', editor: { samples: {} } }
    const snapshot = JSON.parse(JSON.stringify(loadedMetadata))
    buildMetadataPayload({ loadedMetadata, category: '', tags: ['x'], icon: 'Truck' })
    expect(loadedMetadata).toEqual(snapshot)
  })
})
