import { readApiResultOrThrow } from '../../utils/apiCall'
import {
  LookupLoadError,
  createIdsLookupSource,
  lookupLabelWithCode,
  pickLookupString,
  resolveLookupFailureReason,
} from '../lookupSources'

jest.mock('../../utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

const readMock = readApiResultOrThrow as jest.Mock

const source = createIdsLookupSource(
  'widgets',
  '/api/example/widgets',
  (item) => {
    const value = pickLookupString(item, 'id')
    return value ? { value, label: pickLookupString(item, 'name') || value } : null
  },
  { view: 'manage' },
)

function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error('[internal] request failed'), { status })
}

describe('createIdsLookupSource', () => {
  beforeEach(() => readMock.mockReset())

  it('searches with extra params and drops items without an id', async () => {
    readMock.mockResolvedValue({ items: [{ id: 'w-1', name: 'Widget' }, { name: 'no id' }] })
    expect(await source.search(' wid ')).toEqual([{ value: 'w-1', label: 'Widget' }])
    const url = new URL(readMock.mock.calls[0][0] as string, 'http://localhost')
    expect(url.pathname).toBe('/api/example/widgets')
    expect(url.searchParams.get('view')).toBe('manage')
    expect(url.searchParams.get('search')).toBe('wid')
  })

  it('resolves selected ids without issuing a request for an empty list', async () => {
    expect(await source.resolve([])).toEqual([])
    expect(readMock).not.toHaveBeenCalled()
  })

  it('resolves ids in chunks of at most 100 through the ids filter', async () => {
    const ids = Array.from({ length: 250 }, (_, index) => `id-${index}`)
    readMock.mockImplementation(async (path: string) => {
      const requested = new URL(path, 'http://localhost').searchParams.get('ids')?.split(',') ?? []
      return { items: requested.map((id) => ({ id, name: id })) }
    })
    const options = await source.resolve([...ids, 'id-0'])
    expect(options.map((option) => option.value)).toEqual(ids)
    expect(readMock).toHaveBeenCalledTimes(3)
    for (const [path] of readMock.mock.calls) {
      const params = new URL(path as string, 'http://localhost').searchParams
      expect(params.get('ids')?.split(',').length).toBeLessThanOrEqual(100)
      expect(Number(params.get('pageSize'))).toBeLessThanOrEqual(100)
    }
  })

  it('rejects with a forbidden failure when the endpoint denies access', async () => {
    readMock.mockRejectedValue(httpError(403))
    const error = await source.search('x').catch((err: unknown) => err)
    expect(error).toBeInstanceOf(LookupLoadError)
    expect(resolveLookupFailureReason(error)).toBe('forbidden')
  })

  it('rejects with a generic failure when the endpoint is unreachable', async () => {
    readMock.mockRejectedValue(new Error('offline'))
    const error = await source.resolve(['w-1']).catch((err: unknown) => err)
    expect(resolveLookupFailureReason(error)).toBe('failed')
  })
})

describe('lookup helpers', () => {
  it('treats any non-lookup error as a generic failure', () => {
    expect(resolveLookupFailureReason(new Error('boom'))).toBe('failed')
    expect(resolveLookupFailureReason(undefined)).toBe('failed')
  })

  it('appends the code only when it differs from the label', () => {
    expect(lookupLabelWithCode('Retail', 'retail')).toBe('Retail (retail)')
    expect(lookupLabelWithCode('Retail', '')).toBe('Retail')
  })
})
