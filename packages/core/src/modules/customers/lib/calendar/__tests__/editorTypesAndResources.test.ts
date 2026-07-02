import {
  buildEditorTypeOptions,
  buildInteractionPayload,
  createDefaultFormState,
  parseItemToFormState,
  parseLinkedEntities,
  RESOURCE_LINK_TYPE,
  type EditorFormState,
  type EditorKind,
} from '../editorPayload'
import { mapInteractionToCalendarItem } from '../mapItem'
import { makePayload } from './fixtures'

const KIND_LABELS: Record<EditorKind, string> = {
  meeting: 'Meeting',
  call: 'Call',
  email: 'Email',
  note: 'Note',
  event: 'Event',
  task: 'Task',
}

function makeState(overrides: Partial<EditorFormState> = {}): EditorFormState {
  return {
    ...createDefaultFormState(new Date(2026, 5, 12, 0, 0, 0), new Date(2026, 5, 12, 14, 12, 0)),
    title: 'Customer visit',
    relatedTo: { id: '11111111-1111-4111-8111-111111111111', kind: 'person', label: 'Sarah Mitchell' },
    ...overrides,
  }
}

describe('buildEditorTypeOptions (#3552 — dictionary-driven type switcher)', () => {
  const typeLabels = {
    meeting: 'Meeting',
    call: 'Call',
    'customer-visit': 'Customer visit',
  }

  it('renders every dictionary entry, including tenant-added custom types', () => {
    const options = buildEditorTypeOptions({
      typeLabels,
      typeIcons: { meeting: 'lucide:users', 'customer-visit': 'lucide:map-pin' },
      selectedValue: 'meeting',
      kindLabels: KIND_LABELS,
    })
    expect(options).toEqual([
      { value: 'meeting', label: 'Meeting', icon: 'lucide:users' },
      // No dictionary icon — falls back to the seeded icon of the mapped kind.
      { value: 'call', label: 'Call', icon: 'lucide:phone-call' },
      { value: 'customer-visit', label: 'Customer visit', icon: 'lucide:map-pin' },
    ])
  })

  it('falls back to the built-in kinds when the dictionary is empty', () => {
    const options = buildEditorTypeOptions({ typeLabels: {}, selectedValue: 'meeting', kindLabels: KIND_LABELS })
    expect(options.map((option) => option.value)).toEqual(['meeting', 'call', 'email', 'note', 'event', 'task'])
    expect(options.every((option) => typeof option.icon === 'string' && option.icon.startsWith('lucide:'))).toBe(true)
  })

  it('prepends a selected value missing from the dictionary (e.g. a deleted type on an old event)', () => {
    const options = buildEditorTypeOptions({ typeLabels, selectedValue: 'webinar', kindLabels: KIND_LABELS })
    expect(options[0]).toEqual({ value: 'webinar', label: 'Event', icon: 'lucide:calendar' })
    expect(options).toHaveLength(4)
  })
})

describe('parseLinkedEntities', () => {
  it('splits resource links from other linked entities and tolerates malformed rows', () => {
    const { resources, preservedLinkedEntities } = parseLinkedEntities([
      { id: 'res-1', type: RESOURCE_LINK_TYPE, label: 'Meeting room A' },
      { id: 'res-2', type: RESOURCE_LINK_TYPE, label: '' },
      { id: 'doc-1', type: 'sales:order', label: 'Order #42' },
      { id: '', type: RESOURCE_LINK_TYPE, label: 'broken' },
      'garbage',
      null,
    ])
    expect(resources).toEqual([
      { id: 'res-1', label: 'Meeting room A' },
      { id: 'res-2', label: 'res-2' },
    ])
    expect(preservedLinkedEntities).toEqual([{ id: 'doc-1', type: 'sales:order', label: 'Order #42' }])
  })

  it('returns empty sets for non-array input', () => {
    expect(parseLinkedEntities(null)).toEqual({ resources: [], preservedLinkedEntities: [] })
    expect(parseLinkedEntities(undefined)).toEqual({ resources: [], preservedLinkedEntities: [] })
  })
})

describe('buildInteractionPayload — resources gating', () => {
  it('omits linkedEntities entirely when the resources module is not enabled', () => {
    const state = makeState({ resources: [{ id: 'res-1', label: 'Meeting room A' }] })
    const payload = buildInteractionPayload(state, { mode: 'create' })
    expect('linkedEntities' in payload).toBe(false)
  })

  it('writes resource links merged with preserved non-resource links when enabled', () => {
    const state = makeState({
      resources: [{ id: 'res-1', label: 'Meeting room A' }],
      preservedLinkedEntities: [{ id: 'doc-1', type: 'sales:order', label: 'Order #42' }],
    })
    const payload = buildInteractionPayload(state, { mode: 'create', resourcesEnabled: true })
    expect(payload.linkedEntities).toEqual([
      { id: 'doc-1', type: 'sales:order', label: 'Order #42' },
      { id: 'res-1', type: RESOURCE_LINK_TYPE, label: 'Meeting room A' },
    ])
  })

  it('clears linkedEntities to null when enabled and every assignment was removed', () => {
    const state = makeState({ resources: [], preservedLinkedEntities: [] })
    const payload = buildInteractionPayload(state, { mode: 'edit', id: 'item-1', resourcesEnabled: true })
    expect(payload.linkedEntities).toBeNull()
  })
})

describe('buildInteractionPayload — staff gating', () => {
  it('omits ownerUserId for a task when the staff module is absent (edit keeps the stored owner)', () => {
    const state = makeState({ kind: 'task', assigneeUserId: 'user-7' })
    const payload = buildInteractionPayload(state, { mode: 'edit', id: 'item-1', staffEnabled: false })
    expect('ownerUserId' in payload).toBe(false)
  })

  it('keeps the assignee as ownerUserId when staff is enabled (and by default)', () => {
    const state = makeState({ kind: 'task', assigneeUserId: 'user-7' })
    expect(buildInteractionPayload(state, { mode: 'create', staffEnabled: true }).ownerUserId).toBe('user-7')
    expect(buildInteractionPayload(state, { mode: 'create' }).ownerUserId).toBe('user-7')
  })
})

describe('parseItemToFormState — linked resources', () => {
  it('hydrates resources and preserved links from raw linkedEntities', () => {
    const mapped = mapInteractionToCalendarItem(
      makePayload({
        id: 'item-1',
        interactionType: 'customer-visit',
        title: 'Visit',
        status: 'planned',
        scheduledAt: '2026-06-12T10:00:00.000Z',
        linkedEntities: [
          { id: 'res-1', type: RESOURCE_LINK_TYPE, label: 'Company car' },
          { id: 'doc-1', type: 'sales:order', label: 'Order #42' },
        ],
      } as never),
      {},
    )
    if (!mapped) throw new Error('[internal] fixture payload did not map to a calendar item')
    const state = parseItemToFormState(mapped)
    expect(state.resources).toEqual([{ id: 'res-1', label: 'Company car' }])
    expect(state.preservedLinkedEntities).toEqual([{ id: 'doc-1', type: 'sales:order', label: 'Order #42' }])
    expect(state.category).toBe('customer-visit')
    expect(state.kind).toBe('meeting')
  })
})
