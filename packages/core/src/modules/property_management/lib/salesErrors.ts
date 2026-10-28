import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ZodError } from 'zod'

export type SalesErrorKind = 'transient' | 'permanent' | 'not_found' | 'unavailable'

export type ClassifiedSalesError = {
  kind: SalesErrorKind
  status: number | null
  code: string | null
  message: string | null
}

export class SalesContractUnavailableError extends Error {
  readonly code = 'sales_contract_unavailable'
  constructor(readonly capability: string) {
    super(`[internal] The sales capability "${capability}" is not available in this installation yet.`)
    this.name = 'SalesContractUnavailableError'
  }
}

const TRANSIENT_PG_CODES = new Set(['40001', '40P01', '55P03', '57014', '57P01', '53300', '53400'])
const TRANSIENT_NODE_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN'])
const STALE_SCHEDULE_PATTERN = /schedule_?version|stale/i

function readBody(err: CrudHttpError): Record<string, unknown> {
  const body = err.body
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.length ? value : null
}

function readErrorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

export function classifySalesError(err: unknown): ClassifiedSalesError {
  if (err instanceof SalesContractUnavailableError) {
    return { kind: 'unavailable', status: null, code: err.code, message: err.message }
  }
  if (err instanceof CrudHttpError) {
    const body = readBody(err)
    const code = readText(body.code)
    const message = readText(body.error) ?? readText(body.message)
    if (err.status === 404) return { kind: 'not_found', status: 404, code, message }
    if (err.status >= 500) return { kind: 'transient', status: err.status, code, message }
    if (err.status === 409 && STALE_SCHEDULE_PATTERN.test(`${code ?? ''} ${message ?? ''}`)) {
      return { kind: 'transient', status: 409, code, message }
    }
    if (err.status === 429 || err.status === 408) return { kind: 'transient', status: err.status, code, message }
    return { kind: 'permanent', status: err.status, code, message }
  }
  if (err instanceof ZodError) {
    return { kind: 'permanent', status: 422, code: 'validation_failed', message: err.issues[0]?.message ?? null }
  }
  const code = readErrorCode(err)
  const message = err instanceof Error ? err.message : null
  if (code && (TRANSIENT_PG_CODES.has(code) || TRANSIENT_NODE_CODES.has(code) || code.startsWith('08'))) {
    return { kind: 'transient', status: null, code, message }
  }
  return { kind: 'transient', status: null, code, message }
}
