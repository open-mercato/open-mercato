jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

import { lookupPhoneDuplicate } from '../phoneDuplicates'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

const mockedApiCall = apiCall as jest.MockedFunction<typeof apiCall>

const createResponse = (payload: unknown, ok = true) => {
  return {
    ok,
    status: ok ? 200 : 500,
    result: payload,
    response: {} as Response,
  }
}

describe('customers utils - phone duplicate lookup', () => {
  beforeEach(() => {
    mockedApiCall.mockReset()
  })

  it('returns null when no digits are provided', async () => {
    const result = await lookupPhoneDuplicate(' (   ) ')
    expect(result).toBeNull()
    expect(mockedApiCall).not.toHaveBeenCalled()
  })

  it('returns first matching duplicate and builds link', async () => {
    mockedApiCall.mockResolvedValueOnce(
      createResponse({
        items: [
          { id: 'c1', display_name: 'Ada Lovelace', primary_phone: '+1 (555) 123-4567' },
        ],
        total: 1,
      })
    )
    const result = await lookupPhoneDuplicate('+1 555 123-4567')
    expect(result).toEqual({
      id: 'c1',
      label: 'Ada Lovelace',
      href: '/backend/customers/people/c1',
    })
    expect(mockedApiCall).toHaveBeenCalledWith(
      '/api/customers/people?hasPhone=true&page=1&pageSize=50&sortField=createdAt&sortDir=desc'
    )
  })

  it('skips current record and continues scanning subsequent pages', async () => {
    mockedApiCall
      .mockResolvedValueOnce(
        createResponse({
          items: [
            { id: 'current', display_name: 'Keep', primary_phone: '+1 555 123-4567' },
          ],
          total: 120,
        })
      )
      .mockResolvedValueOnce(
        createResponse({
          items: [
            { id: 'duplicate', display_name: 'Grace Hopper', primary_phone: '+1 555 123-4567' },
          ],
          total: 120,
        })
      )
      .mockResolvedValue(createResponse({ items: [], total: 120 }))

    const result = await lookupPhoneDuplicate('+1 555 123-4567', { recordId: 'current' })
    expect(result).toEqual({
      id: 'duplicate',
      label: 'Grace Hopper',
      href: '/backend/customers/people/duplicate',
    })
    expect(mockedApiCall).toHaveBeenCalledTimes(2)
  })

  it('ignores failed requests and returns null when nothing matches', async () => {
    mockedApiCall
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(
        createResponse({
          items: [
            { id: 'c1', display_name: 'Incomplete', primary_phone: '+1 555 000-0000' },
            { id: 'c2', display_name: null, primary_phone: '+1 555 123-4567' },
          ],
          total: 200,
        })
      )
      .mockResolvedValue(createResponse({ items: [], total: 200 }))

    const result = await lookupPhoneDuplicate('+1 555 999-9999')
    expect(result).toBeNull()
    expect(mockedApiCall).toHaveBeenCalledTimes(3)
  })
})
