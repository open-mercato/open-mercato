import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { loadDeviceUserOptions, resolveDeviceUserOptions } from '../backend/devices/userOptions'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const apiCallMock = apiCall as unknown as jest.Mock

function okWith(items: unknown[]) {
  return { ok: true, status: 200, result: { items } }
}

function lastUrl(): URL {
  const [url] = apiCallMock.mock.calls[apiCallMock.mock.calls.length - 1]
  return new URL(url as string, 'https://example.test')
}

// Real UUIDs, so a fixture stays valid if the client ever validates ids before sending them.
function uuidsFor(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `44444444-4444-4444-8444-${index.toString(16).padStart(12, '0')}`)
}

beforeEach(() => {
  apiCallMock.mockReset()
})

describe('loadDeviceUserOptions', () => {
  it('carries the email in the suggestion label, because the combobox drops descriptions', async () => {
    apiCallMock.mockResolvedValue(okWith([
      { id: '11111111-1111-4111-8111-111111111111', name: ' Ada Lovelace ', email: 'ada@example.test' },
    ]))

    const options = await loadDeviceUserOptions()

    expect(options).toEqual([
      {
        value: '11111111-1111-4111-8111-111111111111',
        label: 'Ada Lovelace — ada@example.test',
      },
    ])
  })

  it('falls back to the email, then the id, when a user has no display name', async () => {
    apiCallMock.mockResolvedValue(okWith([
      { id: '11111111-1111-4111-8111-111111111111', name: '  ', email: 'ada@example.test' },
      { id: '22222222-2222-4222-8222-222222222222', name: null, email: null },
    ]))

    const options = await loadDeviceUserOptions()

    expect(options[0].label).toBe('ada@example.test')
    expect(options[1].label).toBe('22222222-2222-4222-8222-222222222222')
  })

  it('sends the trimmed query as ?search= and omits it when blank', async () => {
    apiCallMock.mockResolvedValue(okWith([]))

    await loadDeviceUserOptions('  ada  ')
    expect(lastUrl().searchParams.get('search')).toBe('ada')

    await loadDeviceUserOptions('   ')
    expect(lastUrl().searchParams.has('search')).toBe(false)
  })

  it('suppresses the forbidden redirect so a devices admin without auth.users.list keeps the page', async () => {
    apiCallMock.mockResolvedValue(okWith([]))

    await loadDeviceUserOptions()

    const [, init] = apiCallMock.mock.calls[0]
    expect((init as RequestInit).headers).toMatchObject({ 'x-om-forbidden-redirect': '0' })
  })

  it('degrades to no options when the lookup is forbidden or throws', async () => {
    apiCallMock.mockResolvedValueOnce({ ok: false, status: 403, result: null })
    await expect(loadDeviceUserOptions()).resolves.toEqual([])

    apiCallMock.mockRejectedValueOnce(new Error('network down'))
    await expect(loadDeviceUserOptions()).resolves.toEqual([])
  })

  it('drops entries with no usable id', async () => {
    apiCallMock.mockResolvedValue(okWith([null, { id: '   ' }, { id: 42 }]))

    await expect(loadDeviceUserOptions()).resolves.toEqual([])
  })
})

describe('resolveDeviceUserOptions', () => {
  it('labels a resolved owner compactly, without repeating the email next to the device', async () => {
    apiCallMock.mockResolvedValue(okWith([
      { id: '11111111-1111-4111-8111-111111111111', name: 'Ada Lovelace', email: 'ada@example.test' },
    ]))

    const { options } = await resolveDeviceUserOptions(['11111111-1111-4111-8111-111111111111'])

    expect(options[0].label).toBe('Ada Lovelace')
  })

  it('does not call the API for an empty id set', async () => {
    await expect(resolveDeviceUserOptions([])).resolves.toEqual({ options: [], resolvedIds: [] })
    await expect(resolveDeviceUserOptions(['  ', ''])).resolves.toEqual({ options: [], resolvedIds: [] })
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('reports an id the server answered for as resolved even when it matched no row', async () => {
    // A deleted user is a real answer: caching it stops a pointless lookup on every render.
    apiCallMock.mockResolvedValue(okWith([]))
    const id = '11111111-1111-4111-8111-111111111111'

    const { options, resolvedIds } = await resolveDeviceUserOptions([id])

    expect(options).toEqual([])
    expect(resolvedIds).toEqual([id])
  })

  it('reports nothing as resolved when the lookup itself fails, so a caller can retry', async () => {
    const id = '11111111-1111-4111-8111-111111111111'

    apiCallMock.mockResolvedValueOnce({ ok: false, status: 403, result: null })
    await expect(resolveDeviceUserOptions([id])).resolves.toEqual({ options: [], resolvedIds: [] })

    apiCallMock.mockRejectedValueOnce(new Error('network down'))
    await expect(resolveDeviceUserOptions([id])).resolves.toEqual({ options: [], resolvedIds: [] })
  })

  it('keeps the batches that answered when another batch fails', async () => {
    const ids = uuidsFor(150)
    apiCallMock
      .mockResolvedValueOnce({ ok: false, status: 500, result: null })
      .mockResolvedValueOnce(okWith([{ id: ids[100], name: 'Grace Hopper' }]))

    const { options, resolvedIds } = await resolveDeviceUserOptions(ids)

    expect(options).toEqual([{ value: ids[100], label: 'Grace Hopper' }])
    expect(resolvedIds).toEqual(ids.slice(100))
  })

  it('deduplicates ids and asks for exactly as many rows as it needs', async () => {
    apiCallMock.mockResolvedValue(okWith([]))
    const id = '11111111-1111-4111-8111-111111111111'

    await resolveDeviceUserOptions([id, ` ${id} `, '22222222-2222-4222-8222-222222222222'])

    const url = lastUrl()
    expect(url.searchParams.get('ids')).toBe(`${id},22222222-2222-4222-8222-222222222222`)
    expect(url.searchParams.get('pageSize')).toBe('2')
    expect(apiCallMock).toHaveBeenCalledTimes(1)
  })

  it('chunks past the 100-id request cap instead of silently truncating', async () => {
    apiCallMock.mockResolvedValue(okWith([]))
    const ids = uuidsFor(150)

    await resolveDeviceUserOptions(ids)

    expect(apiCallMock).toHaveBeenCalledTimes(2)
    const firstBatch = new URL(apiCallMock.mock.calls[0][0] as string, 'https://example.test')
    expect(firstBatch.searchParams.get('ids')!.split(',')).toHaveLength(100)
    expect(lastUrl().searchParams.get('ids')!.split(',')).toHaveLength(50)
  })
})
