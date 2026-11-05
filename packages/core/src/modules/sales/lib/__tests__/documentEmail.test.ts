import {
  documentEmailForCustomerChange,
  readDocumentEmail,
  resolveSavedContactEmail,
  syncDocumentEmailWithSnapshot,
} from '../documentEmail'

describe('readDocumentEmail', () => {
  it('trims the address and treats a blank value as none', () => {
    expect(readDocumentEmail({ customerEmail: '  a@example.test ' })).toBe('a@example.test')
    expect(readDocumentEmail({ customerEmail: '   ' })).toBeNull()
    expect(readDocumentEmail(null)).toBeNull()
  })
})

describe('syncDocumentEmailWithSnapshot', () => {
  it('moves a create-time copy along with an edited snapshot e-mail (#8459)', () => {
    expect(
      syncDocumentEmailWithSnapshot({ customerEmail: 'Old@example.test', other: 1 }, 'old@example.test', 'new@example.test'),
    ).toEqual({ customerEmail: 'new@example.test', other: 1 })
  })

  it('drops the copy when the snapshot e-mail is cleared', () => {
    expect(syncDocumentEmailWithSnapshot({ customerEmail: 'old@example.test' }, 'old@example.test', null)).toBeNull()
    expect(
      syncDocumentEmailWithSnapshot({ customerEmail: 'old@example.test', other: 1 }, 'old@example.test', ''),
    ).toEqual({ other: 1 })
  })

  it('keeps an explicit Send to that differs from the snapshot', () => {
    expect(
      syncDocumentEmailWithSnapshot({ customerEmail: 'buyer@example.test' }, 'old@example.test', 'new@example.test'),
    ).toBeUndefined()
  })

  it('changes nothing when the snapshot e-mail did not change or there is no copy', () => {
    expect(syncDocumentEmailWithSnapshot({ customerEmail: 'old@example.test' }, 'old@example.test', 'OLD@example.test')).toBeUndefined()
    expect(syncDocumentEmailWithSnapshot({ other: 1 }, 'old@example.test', 'new@example.test')).toBeUndefined()
    expect(syncDocumentEmailWithSnapshot({ customerEmail: 'old@example.test' }, null, 'new@example.test')).toBeUndefined()
  })
})

describe('documentEmailForCustomerChange', () => {
  it('uses a given e-mail and keeps the other metadata', () => {
    expect(documentEmailForCustomerChange({ customerEmail: 'old@example.test', other: 1 }, ' new@example.test ', true)).toEqual({
      customerEmail: 'new@example.test',
      other: 1,
    })
  })

  it('removes the previous customer address when the new customer brings none', () => {
    expect(documentEmailForCustomerChange({ customerEmail: 'old@example.test' }, null, true)).toBeNull()
    expect(documentEmailForCustomerChange({ customerEmail: 'old@example.test', other: 1 }, '', true)).toEqual({ other: 1 })
  })

  it('leaves the metadata alone when the customer stays and no e-mail is given', () => {
    expect(documentEmailForCustomerChange({ customerEmail: 'old@example.test' }, null, false)).toBeUndefined()
    expect(documentEmailForCustomerChange({ other: 1 }, null, true)).toBeUndefined()
  })
})

describe('resolveSavedContactEmail', () => {
  it('uses the address the server reports over the fallback', () => {
    expect(resolveSavedContactEmail({ contactEmail: 'new@example.test' }, 'old@example.test')).toBe('new@example.test')
  })

  it('honors an explicit null instead of keeping the old address', () => {
    expect(resolveSavedContactEmail({ contactEmail: null }, 'old@example.test')).toBeNull()
  })

  it('falls back only when the response has no contactEmail field', () => {
    expect(resolveSavedContactEmail({ id: 'quote-1' }, 'old@example.test')).toBe('old@example.test')
    expect(resolveSavedContactEmail(null, 'old@example.test')).toBe('old@example.test')
    expect(resolveSavedContactEmail(undefined, null)).toBeNull()
  })
})
