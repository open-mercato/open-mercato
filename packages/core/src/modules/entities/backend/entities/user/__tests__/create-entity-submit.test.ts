jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => null,
}))

import { submitCreateEntity } from '../create/page'

describe('submitCreateEntity', () => {
  it('throws a CrudFormError when entity id is missing', async () => {
    const error = await submitCreateEntity({ values: { entityId: '   ' }, fetchEntities: async () => [] }).catch(
      (err) => err as Error,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      message: 'Entity ID is required',
      fieldErrors: { entityId: 'Entity ID is required' },
    })
  })

  it('throws a CrudFormError when entity id already exists', async () => {
    const error = await submitCreateEntity({
      values: { entityId: 'custom:example' },
      fetchEntities: async () => [{ entityId: 'custom:example', source: 'custom' }],
    }).catch((err) => err as Error)

    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      message: 'Entity ID already exists',
      fieldErrors: { entityId: 'Entity ID already exists' },
    })
  })

  it('invokes createEntity with normalized payload and returns entity id', async () => {
    const createEntity = jest.fn(async () => {})
    const entityId = await submitCreateEntity({
      values: { entityId: 'custom:example', defaultEditor: '', description: 'Test' },
      fetchEntities: async () => [],
      createEntity,
    })
    expect(entityId).toBe('custom:example')
    expect(createEntity).toHaveBeenCalledWith({
      entityId: 'custom:example',
      defaultEditor: undefined,
      description: 'Test',
      labelField: 'name',
    })
  })
})
