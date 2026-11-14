import type { ExampleCustomerPriority } from '../../../data/entities'

type CrudOptions = {
  list: { fields: string[]; transformItem: (item: Record<string, unknown>) => Record<string, unknown> }
  create: { response: (entity: ExampleCustomerPriority) => Record<string, unknown> }
  update: { response: (entity: ExampleCustomerPriority) => Record<string, unknown> }
}

let mockOptions: CrudOptions
jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: (options: CrudOptions) => {
    mockOptions = options
    return {}
  },
}))

import '../route'

describe('priority owning API child versions', () => {
  it('includes a child version in list and successful create/update responses', () => {
    const updatedAt = new Date('2026-10-01T10:00:00.000Z')
    const entity = { id: 'priority-1', updatedAt } as ExampleCustomerPriority
    expect(mockOptions.list.fields).toContain('updated_at')
    expect(mockOptions.list.transformItem({ id: 'priority-1', priority: 'high', updated_at: updatedAt.toISOString() })).toMatchObject({ id: 'priority-1', priority: 'high', updatedAt: updatedAt.toISOString() })
    expect(mockOptions.create.response(entity)).toEqual({ id: 'priority-1', updatedAt: updatedAt.toISOString() })
    expect(mockOptions.update.response(entity)).toEqual({ ok: true, id: 'priority-1', updatedAt: updatedAt.toISOString() })
  })
})
