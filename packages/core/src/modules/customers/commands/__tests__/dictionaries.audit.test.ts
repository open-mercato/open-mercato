type BuildLog = (input: unknown) => Promise<Record<string, unknown> | null>

const registeredCommands = new Map<string, { buildLog?: BuildLog }>()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: (command: { id: string; buildLog?: BuildLog }) => {
    registeredCommands.set(command.id, command)
  },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

import '../dictionaries'

const behavior = {
  schemaVersion: 1,
  baseKind: 'meeting',
  selectable: true,
  order: 10,
  fields: {
    endTime: true,
    allDay: true,
    recurrence: true,
    location: 'location',
    people: 'attendees',
    priority: false,
    resources: false,
  },
  customFieldsetIds: [],
}

const snapshot = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  organizationId: '33333333-3333-4333-8333-333333333333',
  kind: 'activity_type',
  value: 'meeting',
  normalizedValue: 'meeting',
  label: 'Meeting',
  color: null,
  icon: null,
  behavior,
}

describe('dictionary audit changes', () => {
  it('does not report structurally equal behavior on a label-only update', async () => {
    const buildLog = registeredCommands.get('customers.dictionaryEntries.update')?.buildLog
    expect(buildLog).toBeDefined()

    const log = await buildLog!({
      result: { changed: true },
      snapshots: {
        before: snapshot,
        after: { ...snapshot, label: 'Customer meeting', behavior: structuredClone(behavior) },
      },
    })

    expect(log?.changes).toEqual({ label: { from: 'Meeting', to: 'Customer meeting' } })
  })

  it('reports behavior when its value actually changes', async () => {
    const buildLog = registeredCommands.get('customers.dictionaryEntries.update')?.buildLog
    const nextBehavior = { ...behavior, order: 20 }

    const log = await buildLog!({
      result: { changed: true },
      snapshots: { before: snapshot, after: { ...snapshot, behavior: nextBehavior } },
    })

    expect(log?.changes).toEqual({ behavior: { from: behavior, to: nextBehavior } })
  })
})
