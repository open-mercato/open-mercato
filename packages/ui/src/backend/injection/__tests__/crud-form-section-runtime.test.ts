import type { CrudFormProps } from '../../CrudForm'
import { readExplicitCrudFormSectionIdentity } from '../crud-form-section-identity'
import { defineCrudFormSectionRuntime, type CrudFormSectionValues } from '../crud-form-section-runtime'

type Values = { title: string; quantity: string }
type Payload = { title: string; item_quantity: number }

describe('CrudForm section contracts', () => {
  it('keeps heterogeneous validation output paired with its projector', () => {
    const title = defineCrudFormSectionRuntime<CrudFormSectionValues<Values>, string, Payload>({
      id: 'example.title',
      roundTripId: 'example.title@v1',
      group: { id: 'title' },
      ownedFieldPaths: ['title'],
      validate: ({ sectionValues }) => typeof sectionValues.title === 'string'
        ? { success: true, data: sectionValues.title.trim() }
        : { success: false, fieldErrors: { title: 'title.required' } },
      projectPayload: (parsed) => ({ title: parsed.toUpperCase() }),
    })
    const projectQuantity = jest.fn((parsed: number) => ({ item_quantity: parsed + 1 }))
    const quantity = defineCrudFormSectionRuntime<CrudFormSectionValues<Values>, number, Payload>({
      id: 'example.quantity',
      roundTripId: 'example.quantity@v1',
      group: { id: 'quantity' },
      ownedFieldPaths: ['quantity'],
      validate: ({ sectionValues }) => typeof sectionValues.quantity === 'string' && /^\d+$/.test(sectionValues.quantity)
        ? { success: true, data: Number(sectionValues.quantity) }
        : { success: false, fieldErrors: { quantity: 'quantity.invalid' } },
      projectPayload: projectQuantity,
    })
    const props: Pick<CrudFormProps<Values, Payload>, 'sectionDescriptors' | 'compositionValidator'> = {
      sectionDescriptors: [title, quantity],
      compositionValidator: ({ payload }) => ({ success: true, data: payload }),
    }
    const descriptorInputs = [
      { sectionValues: { title: ' first ' }, fullValues: { title: ' first ' } },
      { sectionValues: { quantity: '2' }, fullValues: { quantity: '2' } },
    ]
    expect(props.sectionDescriptors?.map((descriptor, index) => descriptor.validateAndProject(descriptorInputs[index])))
      .toEqual([
        { success: true, data: { parsed: 'first', payload: { title: 'FIRST' } } },
        { success: true, data: { parsed: 2, payload: { item_quantity: 3 } } },
      ])
    projectQuantity.mockClear()
    expect(quantity.validateAndProject({ sectionValues: { quantity: 'invalid' }, fullValues: {} }))
      .toEqual({ success: false, fieldErrors: { quantity: 'quantity.invalid' } })
    expect(projectQuantity).not.toHaveBeenCalled()
  })

  it('requires explicit identity for a selected section policy', () => {
    expect(readExplicitCrudFormSectionIdentity('example.todo', { formVariant: 'showcase', formOperation: 'create' }))
      .toEqual({ hostId: 'example.todo', formVariant: 'showcase', formOperation: 'create' })
    expect(readExplicitCrudFormSectionIdentity('example.todo', {
      formVariant: 'showcase', formOperation: 'update', resourceId: 'todo-1',
    })).toEqual({ hostId: 'example.todo', formVariant: 'showcase', formOperation: 'update', resourceId: 'todo-1' })
    expect(readExplicitCrudFormSectionIdentity('example.todo', { resourceId: 'todo-1' })).toBeNull()
    expect(readExplicitCrudFormSectionIdentity('example.todo', { formVariant: 'showcase', formOperation: 'update' })).toBeNull()
    expect(readExplicitCrudFormSectionIdentity('example.todo', {
      formVariant: 'showcase', formOperation: 'create', resourceId: 'todo-1',
    })).toBeNull()
    expect(readExplicitCrudFormSectionIdentity('example.todo', {
      formVariant: 'showcase', formOperation: 'update', resourceId: ' invalid ',
    })).toBeNull()
  })
})
