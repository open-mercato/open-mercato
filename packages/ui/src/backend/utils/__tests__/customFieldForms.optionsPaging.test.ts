/** @jest-environment node */

const apiCall = jest.fn()

jest.mock('../apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCall(...args),
}))

jest.mock('../../fields/registry', () => ({
  FieldRegistry: { getInput: () => null },
  loadGeneratedFieldRegistrations: async () => {},
}))

import { buildFormFieldFromCustomFieldDef } from '../customFieldForms'

const okPage = (payload: Record<string, unknown>) => ({ ok: true, result: payload })

const requestedUrls = () => apiCall.mock.calls.map(([url]) => url as string)

const loadOptionsFor = (def: Parameters<typeof buildFormFieldFromCustomFieldDef>[0]) => {
  const field = buildFormFieldFromCustomFieldDef(def)
  const loadOptions = (field as { loadOptions?: (query?: string) => Promise<Array<{ value: string; label: string }>> })
    .loadOptions
  if (!loadOptions) throw new Error('[internal] expected the field to expose loadOptions')
  return loadOptions
}

/**
 * Guards the review finding on #4175: the entries route caps rows per response,
 * so the generic `optionsUrl` loader behind every select/currency/relation and
 * multi-dictionary custom field must page instead of dropping everything past
 * the first page.
 */
describe('custom field remote options paging', () => {
  beforeEach(() => {
    apiCall.mockReset()
  })

  it('walks every page of a dictionary-backed multi-select', async () => {
    apiCall
      .mockResolvedValueOnce(
        okPage({ items: [{ value: 'a', label: 'Alpha' }], total: 2, hasMore: true }),
      )
      .mockResolvedValueOnce(
        okPage({ items: [{ value: 'b', label: 'Beta' }], total: 2, hasMore: false }),
      )

    const options = await loadOptionsFor({
      key: 'tags',
      kind: 'dictionary',
      multi: true,
      dictionaryId: 'dict-1',
    })()

    expect(requestedUrls()).toEqual([
      '/api/dictionaries/dict-1/entries',
      '/api/dictionaries/dict-1/entries?offset=1',
    ])
    expect(options).toEqual([
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ])
  })

  it('keeps the typeahead query on every page it requests', async () => {
    apiCall
      .mockResolvedValueOnce(okPage({ items: [{ value: 'a', label: 'Alpha' }], hasMore: true }))
      .mockResolvedValueOnce(okPage({ items: [{ value: 'ab', label: 'Able' }], hasMore: false }))

    await loadOptionsFor({ key: 'ref', kind: 'select', optionsUrl: '/api/refs' })('al')

    expect(requestedUrls()[0]).toContain('query=al')
    expect(requestedUrls()[1]).toContain('query=al')
    expect(requestedUrls()[1]).toContain('offset=1')
  })

  it('issues one request for a route that does not report hasMore', async () => {
    apiCall.mockResolvedValueOnce(okPage({ items: [{ value: 'usd', label: 'USD' }] }))

    const options = await loadOptionsFor({ key: 'ref', kind: 'select', optionsUrl: '/api/refs' })()

    expect(apiCall).toHaveBeenCalledTimes(1)
    expect(options).toEqual([{ value: 'usd', label: 'USD' }])
  })

  it('returns no options when a page fails rather than a partial list', async () => {
    apiCall
      .mockResolvedValueOnce(okPage({ items: [{ value: 'a', label: 'Alpha' }], hasMore: true }))
      .mockResolvedValueOnce({ ok: false, result: { error: 'Forbidden' } })

    const options = await loadOptionsFor({ key: 'ref', kind: 'select', optionsUrl: '/api/refs' })()

    expect(options).toEqual([])
  })
})
