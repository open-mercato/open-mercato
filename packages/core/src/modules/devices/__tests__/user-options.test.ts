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
        description: 'ada@example.test',
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
    // The email is already the label, so repeating it as the description would be noise.
    expect(options[0].description).toBeNull()
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

    const options = await resolveDeviceUserOptions(['11111111-1111-4111-8111-111111111111'])

    expect(options[0].label).toBe('Ada Lovelace')
  })

  it('does not call the API for an empty id set', async () => {
    await expect(resolveDeviceUserOptions([])).resolves.toEqual([])
    await expect(resolveDeviceUserOptions(['  ', ''])).resolves.toEqual([])
    expect(apiCallMock).not.toHaveBeenCalled()
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
    const ids = Array.from({ length: 150 }, (_, index) => `1111111${index.toString().padStart(1, '0')}`)

    await resolveDeviceUserOptions(ids)

    expect(apiCallMock).toHaveBeenCalledTimes(2)
    const firstBatch = new URL(apiCallMock.mock.calls[0][0] as string, 'https://example.test')
    expect(firstBatch.searchParams.get('ids')!.split(',')).toHaveLength(100)
    expect(lastUrl().searchParams.get('ids')!.split(',')).toHaveLength(50)
  })
})
