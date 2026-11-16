import {
  extractSoapEnvelope,
  GusResponseError,
  parseSearchResult,
  pickPrimaryCompany,
  readMethodResult,
} from '../lib/parser'
import {
  LOGIN_EMPTY,
  LOGIN_OK,
  SEARCH_FOUND_INNER,
  SEARCH_MULTIPLE_INNER,
  SEARCH_NOT_FOUND_INNER,
  SEARCH_SESSION_ERROR_INNER,
  SOAP_FAULT,
  searchResponse,
} from './fixtures/bir'

describe('extractSoapEnvelope', () => {
  it('extracts the envelope from an MTOM multipart body', () => {
    const envelope = extractSoapEnvelope(LOGIN_OK)
    expect(envelope.startsWith('<s:Envelope')).toBe(true)
    expect(envelope.endsWith('</s:Envelope>')).toBe(true)
  })

  it('accepts a bare envelope', () => {
    expect(extractSoapEnvelope(SOAP_FAULT)).toBe(SOAP_FAULT)
  })

  it('throws when there is no envelope', () => {
    expect(() => extractSoapEnvelope('<html>Service unavailable</html>')).toThrow(GusResponseError)
  })
})

describe('readMethodResult', () => {
  it('reads the Zaloguj session id', () => {
    expect(readMethodResult(LOGIN_OK, 'Zaloguj')).toBe('p0o9i8u7y6t5r4e3w2q1')
  })

  it('returns an empty string for an empty result (invalid key)', () => {
    expect(readMethodResult(LOGIN_EMPTY, 'Zaloguj')).toBe('')
  })

  it('decodes the escaped inner XML of DaneSzukajPodmiotyResult', () => {
    const inner = readMethodResult(searchResponse(SEARCH_FOUND_INNER), 'DaneSzukajPodmioty')
    expect(inner).toContain('<root>')
    expect(inner).toContain('<Nip>5252344078</Nip>')
  })

  it('throws on a SOAP fault', () => {
    expect(() => readMethodResult(SOAP_FAULT, 'Zaloguj')).toThrow(/SOAP fault/)
  })

  it('throws when the expected response element is missing', () => {
    expect(() => readMethodResult(LOGIN_OK, 'DaneSzukajPodmioty')).toThrow(/DaneSzukajPodmiotyResponse/)
  })
})

describe('parseSearchResult', () => {
  it('maps a found record (captured test-registry payload)', () => {
    const result = parseSearchResult(SEARCH_FOUND_INNER, '5252344078')
    expect(result).toEqual({
      kind: 'found',
      companies: [
        {
          nip: '5252344078',
          regon: '140182840',
          name: 'GOOGLE POLAND SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
          street: 'ul. Test-Krucza',
          buildingNumber: '53',
          flatNumber: null,
          postalCode: '00-113',
          city: 'Warszawa',
          voivodeship: 'MAZOWIECKIE',
          county: 'm. st. Warszawa',
          commune: 'Śródmieście',
          type: 'P',
          endDate: null,
          country: 'PL',
        },
      ],
    })
  })

  it('keeps identifiers as strings (no numeric coercion, leading zeros preserved)', () => {
    const inner = SEARCH_FOUND_INNER.replace('<Regon>140182840</Regon>', '<Regon>012345678</Regon>')
    const result = parseSearchResult(inner, '5252344078')
    expect(result.kind === 'found' && result.companies[0].regon).toBe('012345678')
  })

  it('recognises "not found" (ErrorCode 4)', () => {
    expect(parseSearchResult(SEARCH_NOT_FOUND_INNER, '7261012312')).toEqual({ kind: 'not_found' })
  })

  it('reports other GUS error codes as errors', () => {
    expect(parseSearchResult(SEARCH_SESSION_ERROR_INNER, '5252344078')).toEqual({
      kind: 'error',
      code: '7',
      message: 'No session. Session has expired or an invalid session identifier was passed.',
    })
  })

  it('treats an empty result as an error (e.g. an expired session)', () => {
    expect(parseSearchResult('', '5252344078').kind).toBe('error')
    expect(parseSearchResult('<root></root>', '5252344078').kind).toBe('error')
  })

  it('returns every record for multi-record responses', () => {
    const result = parseSearchResult(SEARCH_MULTIPLE_INNER, '5252344078')
    expect(result.kind === 'found' && result.companies.map((c) => c.type)).toEqual(['LP', 'P'])
  })
})

describe('pickPrimaryCompany', () => {
  it('prefers the registered entity over its local units', () => {
    const result = parseSearchResult(SEARCH_MULTIPLE_INNER, '5252344078')
    if (result.kind !== 'found') throw new Error('expected found')
    expect(pickPrimaryCompany(result.companies)?.regon).toBe('140182840')
  })

  it('prefers active entities over ones that ceased activity', () => {
    const base = parseSearchResult(SEARCH_FOUND_INNER, '5252344078')
    if (base.kind !== 'found') throw new Error('expected found')
    const active = { ...base.companies[0], regon: 'active' }
    const ceased = { ...base.companies[0], regon: 'ceased', endDate: '2020-01-01' }
    expect(pickPrimaryCompany([ceased, active])?.regon).toBe('active')
  })

  it('returns null for an empty list', () => {
    expect(pickPrimaryCompany([])).toBeNull()
  })
})
