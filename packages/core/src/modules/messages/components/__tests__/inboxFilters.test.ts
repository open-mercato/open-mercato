import {
  buildMessagesInboxFilters,
  buildMessagesListParams,
  normalizeMessagesSinceValue,
} from '../inboxFilters'

const identityT = (_key: string, fallback?: string) => fallback ?? _key

describe('buildMessagesInboxFilters', () => {
  it('exposes "Has related records" / "Has attachments" / "Has action requests" labels so users understand the Yes/No semantics', () => {
    const filters = buildMessagesInboxFilters({
      t: identityT,
      typeOptions: [],
      senderOptions: [],
      loadSenderOptions: async () => [],
    })

    const hasObjects = filters.find((f) => f.id === 'hasObjects')
    const hasAttachments = filters.find((f) => f.id === 'hasAttachments')
    const hasActions = filters.find((f) => f.id === 'hasActions')

    expect(hasObjects?.label).toBe('Has related records')
    expect(hasAttachments?.label).toBe('Has attachments')
    expect(hasActions?.label).toBe('Has action requests')
  })

  it('exposes tooltip text for hasObjects and hasActions filters', () => {
    const filters = buildMessagesInboxFilters({
      t: identityT,
      typeOptions: [],
      senderOptions: [],
      loadSenderOptions: async () => [],
    })

    const hasObjects = filters.find((f) => f.id === 'hasObjects')
    const hasAttachments = filters.find((f) => f.id === 'hasAttachments')
    const hasActions = filters.find((f) => f.id === 'hasActions')

    expect(hasObjects?.tooltip).toBe('Shows messages that have Open Mercato records attached — such as orders, quotes, or customers.')
    expect(hasAttachments?.tooltip).toBeUndefined()
    expect(hasActions?.tooltip).toBe('Shows messages where one or more attached records require a response (approval, rejection, or review).')
  })

  it('produces a sender filter that defers to loadOptions instead of a static "All" placeholder', () => {
    const senderOptions = [{ value: 'user-1', label: 'Jane', description: 'jane@example.com' }]
    const filters = buildMessagesInboxFilters({
      t: identityT,
      typeOptions: [],
      senderOptions,
      loadSenderOptions: async () => senderOptions,
    })

    const sender = filters.find((f) => f.id === 'senderId')
    expect(sender?.type).toBe('combobox')
    expect(sender?.options).toEqual(senderOptions)
    expect(typeof sender?.loadOptions).toBe('function')
    expect(sender?.formatValue?.('user-1')).toBe('Jane')
    expect(sender?.formatValue?.('missing')).toBe('missing')
  })

  it('emits the simplified YYYY-MM-DD placeholder for the "Sent after" filter', () => {
    const filters = buildMessagesInboxFilters({
      t: identityT,
      typeOptions: [],
      senderOptions: [],
      loadSenderOptions: async () => [],
    })

    const since = filters.find((f) => f.id === 'since')
    expect(since?.placeholder).toBe('YYYY-MM-DD')
  })

  it('forwards localized message type options into the type filter', () => {
    const filters = buildMessagesInboxFilters({
      t: identityT,
      typeOptions: [
        { value: 'staff.leave_request_approval', label: 'Leave request approval' },
      ],
      senderOptions: [],
      loadSenderOptions: async () => [],
    })

    const type = filters.find((f) => f.id === 'type')
    expect(type?.options).toEqual([
      { value: '', label: 'All' },
      { value: 'staff.leave_request_approval', label: 'Leave request approval' },
    ])
  })
})

describe('normalizeMessagesSinceValue', () => {
  it('converts a plain YYYY-MM-DD value to an ISO datetime', () => {
    expect(normalizeMessagesSinceValue('2026-05-18')).toBe('2026-05-18T00:00:00.000Z')
  })

  it('passes through valid ISO datetime values unchanged', () => {
    const iso = '2026-05-18T12:34:56.000Z'
    expect(normalizeMessagesSinceValue(iso)).toBe(iso)
  })

  it('returns null for empty or invalid inputs', () => {
    expect(normalizeMessagesSinceValue('')).toBeNull()
    expect(normalizeMessagesSinceValue('   ')).toBeNull()
    expect(normalizeMessagesSinceValue('not-a-date')).toBeNull()
    expect(normalizeMessagesSinceValue('2026-02-31')).toBeNull()
  })
})

describe('buildMessagesListParams', () => {
  it('serializes filter values and normalizes the since date', () => {
    const params = buildMessagesListParams({
      folder: 'inbox',
      page: 2,
      pageSize: 20,
      search: '  hello  ',
      filterValues: {
        status: 'unread',
        type: 'staff.leave_request_approval',
        hasObjects: 'true',
        hasAttachments: 'false',
        hasActions: 'true',
        senderId: 'user-1',
        since: '2026-05-18',
      },
    })

    expect(params.get('folder')).toBe('inbox')
    expect(params.get('page')).toBe('2')
    expect(params.get('pageSize')).toBe('20')
    expect(params.get('search')).toBe('hello')
    expect(params.get('status')).toBe('unread')
    expect(params.get('type')).toBe('staff.leave_request_approval')
    expect(params.get('hasObjects')).toBe('true')
    expect(params.get('hasAttachments')).toBe('false')
    expect(params.get('hasActions')).toBe('true')
    expect(params.get('senderId')).toBe('user-1')
    expect(params.get('since')).toBe('2026-05-18T00:00:00.000Z')
  })

  it('omits invalid since values rather than sending an invalid datetime to the API', () => {
    const params = buildMessagesListParams({
      folder: 'inbox',
      page: 1,
      pageSize: 20,
      search: '',
      filterValues: { since: 'invalid' },
    })

    expect(params.has('since')).toBe(false)
  })

  it('omits empty filters', () => {
    const params = buildMessagesListParams({
      folder: 'inbox',
      page: 1,
      pageSize: 20,
      search: '',
      filterValues: {},
    })

    expect(params.has('status')).toBe(false)
    expect(params.has('senderId')).toBe(false)
    expect(params.has('since')).toBe(false)
    expect(params.has('search')).toBe(false)
  })
})
