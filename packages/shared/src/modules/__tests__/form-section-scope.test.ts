import { ComponentReplacementHandles, crudFormSectionScope } from '../widgets/component-registry'

describe('CrudForm section handles', () => {
  it('preserves legacy handles and qualifies new handles by form variant and operation', () => {
    const address = { hostId: 'crud-form:example.todo', formVariant: 'showcase', formOperation: 'update' } as const
    const scope = crudFormSectionScope(address)

    expect(ComponentReplacementHandles.section('example.todo', 'details')).toBe('section:example.todo.details')
    expect(ComponentReplacementHandles.section('orders/sub', 'field.row')).toBe('section:orders/sub.field.row')
    expect(scope).toBe('crud-form:example.todo/showcase/update')
    expect(ComponentReplacementHandles.section(scope, 'details')).toBe('section:crud-form:example.todo/showcase/update.details')
    expect(crudFormSectionScope({ ...address, formOperation: 'create' })).toBe('crud-form:example.todo/showcase/create')
    expect(crudFormSectionScope({ ...address, formVariant: 'default' })).toBe('crud-form:example.todo/default/update')
  })

  it('keeps delimiter-like segments distinct', () => {
    const operation = 'update'
    expect(crudFormSectionScope({ hostId: 'catalog/product', formVariant: 'edit', formOperation: operation }))
      .toBe('catalog%2Fproduct/edit/update')
    expect(crudFormSectionScope({ hostId: 'catalog', formVariant: 'product/edit', formOperation: operation }))
      .toBe('catalog/product%2Fedit/update')
    expect(crudFormSectionScope({ hostId: 'catalog%2Fproduct', formVariant: 'edit', formOperation: operation }))
      .toBe('catalog%252Fproduct/edit/update')
  })
})
