jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => null,
}))

import { submitCustomEntityRecord } from '../[entityId]/records/create/page'
import { submitCustomEntityRecordUpdate } from '../[entityId]/records/[recordId]/page'

describe('submitCustomEntityRecord', () => {
  it('throws a CrudFormError when entity id is missing', async () => {
    const error = await submitCustomEntityRecord({
      entityId: '',
      values: {},
      createRecord: async () => {},
  }).catch((err) => err as Error)
  expect(error).toBeInstanceOf(Error)
  expect(error).toMatchObject({
    message: 'Entity identifier is required',
    fieldErrors: { entityId: 'Entity identifier is required' },
  })
})

  it('calls provided createRecord implementation with normalized payload', async () => {
    const createRecord = jest.fn(async () => {})
    await submitCustomEntityRecord({
      entityId: 'example:custom',
      values: { foo: 'bar' },
      createRecord,
    })
    expect(createRecord).toHaveBeenCalledWith({
      entityId: 'example:custom',
      values: { foo: 'bar' },
    })
  })

  it('rethrows errors from createRecord', async () => {
    const error = new Error('boom')
    const createRecord = jest.fn(async () => {
      throw error
    })
    await expect(
      submitCustomEntityRecord({
        entityId: 'example:custom',
        values: {},
        createRecord,
      }),
    ).rejects.toBe(error)
  })
})

describe('submitCustomEntityRecordUpdate', () => {
  it('throws a CrudFormError when entity or record id is missing', async () => {
    const entityError = await submitCustomEntityRecordUpdate({
      entityId: '',
      recordId: '1',
      values: {},
      updateRecord: async () => {},
    }).catch((err) => err as Error)
    expect(entityError).toMatchObject({
      message: 'Entity identifier is required',
      fieldErrors: { entityId: 'Entity identifier is required' },
    })

    const recordError = await submitCustomEntityRecordUpdate({
      entityId: 'example:custom',
      recordId: '',
      values: {},
      updateRecord: async () => {},
    }).catch((err) => err as Error)
    expect(recordError).toMatchObject({
      message: 'Record identifier is required',
      fieldErrors: { recordId: 'Record identifier is required' },
    })
  })

  it('calls provided updateRecord implementation with normalized payload', async () => {
    const updateRecord = jest.fn(async () => {})
    await submitCustomEntityRecordUpdate({
      entityId: 'example:custom',
      recordId: '123',
      values: { foo: 'bar' },
      updateRecord,
    })
    expect(updateRecord).toHaveBeenCalledWith({
      entityId: 'example:custom',
      recordId: '123',
      values: { foo: 'bar' },
    })
  })

  it('rethrows errors from updateRecord', async () => {
    const error = new Error('boom')
    const updateRecord = jest.fn(async () => {
      throw error
    })
    await expect(
      submitCustomEntityRecordUpdate({
        entityId: 'example:custom',
        recordId: '1',
        values: {},
        updateRecord,
      }),
    ).rejects.toBe(error)
  })
})
