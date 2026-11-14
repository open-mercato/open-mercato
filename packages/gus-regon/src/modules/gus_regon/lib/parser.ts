import { XMLParser } from 'fast-xml-parser'
import type { GusCompany } from './types'

/**
 * Parsing of BIR1 SOAP responses.
 *
 * BIR1 answers with an MTOM-style multipart body (or a bare SOAP 1.2 envelope).
 * Method results such as `DaneSzukajPodmiotyResult` carry a second, escaped XML
 * document (`<root><dane>…</dane></root>`), so parsing happens in two passes.
 */

const envelopeParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
})

/** Keeps every value as a string: NIP, REGON and postal codes must never become numbers. */
const resultParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === 'dane',
})

/** GUS error code for "no entity matches the search criteria". */
export const GUS_ERROR_NOT_FOUND = '4'

export class GusResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GusResponseError'
  }
}

/** Extracts the SOAP envelope from a raw (possibly multipart) BIR1 response body. */
export function extractSoapEnvelope(raw: string): string {
  const start = raw.search(/<(?:[A-Za-z0-9_-]+:)?Envelope[\s>]/)
  if (start < 0) throw new GusResponseError('[internal] GUS response has no SOAP envelope')
  const closing = /<\/(?:[A-Za-z0-9_-]+:)?Envelope>/g
  closing.lastIndex = start
  const match = closing.exec(raw)
  if (!match) throw new GusResponseError('[internal] GUS response has an unterminated SOAP envelope')
  return raw.slice(start, match.index + match[0].length)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/**
 * Returns the text of `<{method}Result>` from a BIR1 response
 * (e.g. `ZalogujResult`, `DaneSzukajPodmiotyResult`). Empty string when the
 * element is present but empty; throws when the envelope is malformed or a
 * SOAP fault is returned.
 */
export function readMethodResult(raw: string, method: string): string {
  const envelope = asRecord(envelopeParser.parse(extractSoapEnvelope(raw))?.Envelope)
  const body = asRecord(envelope?.Body)
  if (!body) throw new GusResponseError('[internal] GUS response has no SOAP body')
  if (body.Fault !== undefined) throw new GusResponseError(`[internal] GUS returned a SOAP fault for ${method}`)
  const response = asRecord(body[`${method}Response`])
  if (!response) throw new GusResponseError(`[internal] GUS response has no ${method}Response`)
  const result = response[`${method}Result`]
  if (result === undefined || result === null) return ''
  return typeof result === 'string' ? result : String(result)
}

function text(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export type ParsedSearchResult =
  | { kind: 'found'; companies: GusCompany[] }
  | { kind: 'not_found' }
  | { kind: 'error'; code: string | null; message: string | null }

/** Maps one `<dane>` record of `DaneSzukajPodmioty` to a `GusCompany`. */
export function mapSearchRecord(record: Record<string, unknown>, requestedNip: string): GusCompany {
  return {
    nip: text(record, 'Nip') ?? requestedNip,
    regon: text(record, 'Regon'),
    name: text(record, 'Nazwa'),
    street: text(record, 'Ulica'),
    buildingNumber: text(record, 'NrNieruchomosci'),
    flatNumber: text(record, 'NrLokalu'),
    postalCode: text(record, 'KodPocztowy'),
    city: text(record, 'Miejscowosc'),
    voivodeship: text(record, 'Wojewodztwo'),
    county: text(record, 'Powiat'),
    commune: text(record, 'Gmina'),
    type: text(record, 'Typ'),
    endDate: text(record, 'DataZakonczeniaDzialalnosci'),
    country: 'PL',
  }
}

/** Parses the inner XML document returned by `DaneSzukajPodmioty`. */
export function parseSearchResult(resultXml: string, requestedNip: string): ParsedSearchResult {
  if (!resultXml.trim()) return { kind: 'error', code: null, message: 'empty result' }
  const parsed = asRecord(resultParser.parse(resultXml))
  const root = asRecord(parsed?.root)
  const records = Array.isArray(root?.dane) ? (root!.dane as unknown[]).map(asRecord).filter(Boolean) as Record<string, unknown>[] : []
  if (records.length === 0) return { kind: 'error', code: null, message: 'no records' }

  const errorRecord = records.find((record) => text(record, 'ErrorCode') !== null)
  if (errorRecord) {
    const code = text(errorRecord, 'ErrorCode')
    if (code === GUS_ERROR_NOT_FOUND) return { kind: 'not_found' }
    return { kind: 'error', code, message: text(errorRecord, 'ErrorMessageEn') ?? text(errorRecord, 'ErrorMessagePl') }
  }

  return { kind: 'found', companies: records.map((record) => mapSearchRecord(record, requestedNip)) }
}

/**
 * Picks the registered entity itself over its local units (LP/LF) and
 * active entities over ones that ceased activity.
 */
export function pickPrimaryCompany(companies: GusCompany[]): GusCompany | null {
  if (companies.length === 0) return null
  const score = (company: GusCompany) =>
    (company.type === 'LP' || company.type === 'LF' ? 0 : 2) + (company.endDate ? 0 : 1)
  return [...companies].sort((a, b) => score(b) - score(a))[0]
}
