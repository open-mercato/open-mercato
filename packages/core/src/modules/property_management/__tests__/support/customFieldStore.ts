import type { CustomFieldDefinitionIndex } from '@open-mercato/shared/lib/crud/custom-field-definition-index'
import { FakeEm } from './fakeEm'

export type CustomFieldWrite = {
  entityId: string
  recordId: string
  values: Record<string, unknown>
  inTransaction: boolean
}

export const customFieldStore = {
  values: new Map<string, Record<string, unknown>>(),
  writes: [] as CustomFieldWrite[],
}

function storeKey(entityId: string, recordId: string): string {
  return `${entityId}:${recordId}`
}

export function resetCustomFieldStore(): void {
  customFieldStore.values.clear()
  customFieldStore.writes.length = 0
}

export function storedCustomFields(entityId: string, recordId: string): Record<string, unknown> {
  return { ...(customFieldStore.values.get(storeKey(entityId, recordId)) ?? {}) }
}

export class TransactionalFakeEm extends FakeEm {
  inTransaction = false

  async transactional<T>(callback: (em: FakeEm) => Promise<T>): Promise<T> {
    this.inTransaction = true
    try {
      return await callback(this)
    } finally {
      this.inTransaction = false
    }
  }
}

type SetCustomFieldsInput = {
  entityId: string
  recordId: string
  values: Record<string, unknown>
}

class RecordingDataEngine {
  constructor(private readonly em: { inTransaction?: boolean }) {}

  async setCustomFields(input: SetCustomFieldsInput): Promise<void> {
    customFieldStore.writes.push({
      entityId: input.entityId,
      recordId: input.recordId,
      values: { ...input.values },
      inTransaction: this.em.inTransaction === true,
    })
    const next = { ...storedCustomFields(input.entityId, input.recordId), ...input.values }
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) delete next[key]
    }
    customFieldStore.values.set(storeKey(input.entityId, input.recordId), next)
  }
}

export function dataEngineMock() {
  const actual = jest.requireActual('@open-mercato/shared/lib/data/engine')
  return { ...actual, DefaultDataEngine: RecordingDataEngine }
}

export function customFieldSnapshotsMock() {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/customFieldSnapshots')
  return {
    ...actual,
    loadCustomFieldSnapshot: async (_em: unknown, options: { entityId: string; recordId: string }) =>
      storedCustomFields(options.entityId, options.recordId),
  }
}

export function textFieldDefinitions(key: string, scope: { tenantId: string; organizationId: string }): CustomFieldDefinitionIndex {
  return new Map([[key, [{ key, label: key, kind: 'text', multi: false, organizationId: scope.organizationId, tenantId: scope.tenantId, priority: 0, updatedAt: 0 }]]])
}
