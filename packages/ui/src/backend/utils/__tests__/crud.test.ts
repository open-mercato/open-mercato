jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(),
}))
jest.mock('../../utils/serverErrors', () => ({
  raiseCrudError: jest.fn().mockResolvedValue(undefined),
}))

import { apiCall } from '../../utils/apiCall'
import { raiseCrudError } from '../../utils/serverErrors'
import { createCrud, deleteCrud, updateCrud } from '../crud'

const response = new Response('ok', { status: 200 })

describe('crud helpers', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('createCrud resolves with parsed result', async () => {
    const payload = { id: '123' }
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: true,
      status: 201,
      result: payload,
      response,
    })

    const result = await createCrud<{ id: string }>('example/todos', { title: 'Test' })
    expect(result.result).toEqual(payload)
    expect(apiCall).toHaveBeenCalledWith(
      '/api/example/todos',
      expect.objectContaining({ method: 'POST' }),
      expect.any(Object),
    )
  })

  it('createCrud delegates error handling when request fails', async () => {
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      result: null,
      response,
    })
    const rejection = new Error('fail')
    ;(raiseCrudError as jest.Mock).mockRejectedValue(rejection)
    await expect(createCrud('example/todos', { title: 'Test' })).rejects.toThrow('fail')
    expect(raiseCrudError).toHaveBeenCalledWith(response, 'Failed to create')
  })

  it('updateCrud uses PUT and returns ApiCallResult', async () => {
    const callResult = { ok: true, status: 200, result: { updated: true }, response }
    ;(apiCall as jest.Mock).mockResolvedValue(callResult)
    const result = await updateCrud<{ updated: boolean }>('example/todos', { id: '1' })
    expect(result).toBe(callResult)
    expect(apiCall).toHaveBeenLastCalledWith(
      '/api/example/todos',
      expect.objectContaining({ method: 'PUT' }),
      expect.any(Object),
    )
  })

  it('deleteCrud supports id parameter', async () => {
    const callResult = { ok: true, status: 200, result: null, response }
    ;(apiCall as jest.Mock).mockResolvedValue(callResult)
    const result = await deleteCrud('example/todos', '123')
    expect(result).toBe(callResult)
    expect(apiCall).toHaveBeenCalledWith(
      '/api/example/todos?id=123',
      expect.objectContaining({ method: 'DELETE' }),
      expect.any(Object),
    )
  })

  it('deleteCrud supports JSON body payload', async () => {
    const callResult = { ok: true, status: 200, result: null, response }
    ;(apiCall as jest.Mock).mockResolvedValue(callResult)
    await deleteCrud('example/todos', { body: { id: 'abc' } })
    expect(apiCall).toHaveBeenCalledWith(
      '/api/example/todos',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ id: 'abc' }),
      }),
      expect.any(Object),
    )
  })
})
