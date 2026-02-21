export type CrudServerFieldErrors = Record<string, string>

export type NormalizedCrudServerError = {
  message?: string
  fieldErrors?: CrudServerFieldErrors
  details?: unknown
  status?: number
  raw?: string | null
  [key: string]: unknown
}

const JSON_FIELD_KEYS = ['fieldErrors', 'fields', 'errors', 'data'] as const
const ISSUE_KEYS = ['details', 'issues', 'errors'] as const

function coerceFieldErrors(input: unknown): CrudServerFieldErrors | null {
  if (!input || typeof input !== 'object') return null
  const result: CrudServerFieldErrors = {}
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = typeof rawKey === 'string' && rawKey.trim().length > 0 ? rawKey.trim() : null
    if (!key) continue
    if (rawValue === undefined || rawValue === null) continue
    const message =
      typeof rawValue === 'string'
        ? rawValue
        : typeof (rawValue as any)?.message === 'string'
          ? (rawValue as any).message
          : String(rawValue)
    if (!message) continue
    result[key] = message
  }
  return Object.keys(result).length ? result : null
}

function mapIssueArray(issues: unknown): CrudServerFieldErrors | null {
  if (!Array.isArray(issues)) return null
  const result: CrudServerFieldErrors = {}
  for (const issue of issues) {
    if (!issue || typeof issue !== 'object') continue
    const pathValue: unknown[] = Array.isArray((issue as any).path) ? (issue as any).path : []
    let field: string | null = null
    for (const part of pathValue) {
      if (typeof part === 'string' && part.trim().length > 0) {
        field = part.trim()
        break
      }
    }
    if (!field && typeof (issue as any).field === 'string') {
      const fromField = ((issue as any).field as string).trim()
      field = fromField.length > 0 ? fromField : null
    }
    if (!field && pathValue.length > 0) {
      const joined = pathValue.map((part) => String(part)).join('.')
      if (joined) field = joined
    }
    if (!field) continue
    const message = typeof (issue as any).message === 'string' ? (issue as any).message : null
    if (!message) continue
    result[field] = message
  }
  return Object.keys(result).length ? result : null
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function collectCandidatePayloads(err: unknown): unknown[] {
  const candidates: unknown[] = []
  if (!err) return candidates
  candidates.push(err)

  if (typeof err === 'string') {
    const parsed = tryParseJson(err)
    if (parsed) candidates.push(parsed)
  } else if (err instanceof Error) {
    if (typeof err.message === 'string' && err.message.trim()) {
      const parsed = tryParseJson(err.message.trim())
      if (parsed) candidates.push(parsed)
    }
    if ((err as any).cause) {
      candidates.push((err as any).cause)
    }
  } else if (typeof err === 'object') {
    const maybeMessage = (err as any)?.message
    if (typeof maybeMessage === 'string') {
      const parsed = tryParseJson(maybeMessage)
      if (parsed) candidates.push(parsed)
    }
    if ((err as any)?.body) candidates.push((err as any).body)
    if ((err as any)?.response) candidates.push((err as any).response)
    if ((err as any)?.data) candidates.push((err as any).data)
  }

  return candidates
}

export function normalizeCrudServerError(err: unknown): NormalizedCrudServerError {
  let message: string | undefined
  let fieldErrors: CrudServerFieldErrors | undefined
  const processed = new Set<unknown>()

  const queue = collectCandidatePayloads(err)
  while (queue.length) {
    const current = queue.shift()
    if (!current || processed.has(current)) continue
    processed.add(current)

    if (typeof current === 'string') {
      if (!message) message = current
      const parsed = tryParseJson(current)
      if (parsed) queue.push(parsed)
      continue
    }

    if (current instanceof Response) {
      const body = (current as any)?._bodyInit
      if (body) queue.push(body)
      continue
    }

    if (typeof current !== 'object') continue

    const candidateMessage =
      typeof (current as any).error === 'string'
        ? (current as any).error
        : typeof (current as any).message === 'string'
          ? (current as any).message
          : undefined
    if (candidateMessage && !message) message = candidateMessage

    for (const key of JSON_FIELD_KEYS) {
      const value = (current as any)[key]
      if (value && typeof value === 'object') {
        const mapped = coerceFieldErrors(value)
        if (mapped) {
          fieldErrors = { ...(fieldErrors || {}), ...mapped }
        }
      }
    }

    for (const key of ISSUE_KEYS) {
      const value = (current as any)[key]
      const mapped = mapIssueArray(value)
      if (mapped) {
        fieldErrors = { ...(fieldErrors || {}), ...mapped }
      }
    }

    const nestedKeys = ['body', 'response', 'data', 'details']
    for (const nestedKey of nestedKeys) {
      const nested = (current as any)[nestedKey]
      if (nested && !processed.has(nested)) queue.push(nested)
    }
  }

  if (!message && fieldErrors && Object.keys(fieldErrors).length === 1) {
    const [, firstMessage] = Object.entries(fieldErrors)[0]
    message = firstMessage
  }

  if (!message && err instanceof Error && err.message) {
    message = err.message
  } else if (!message && typeof err === 'string') {
    message = err
  }

  return { message, fieldErrors }
}

export type FieldNameMapperOptions = {
  customEntity?: boolean
}

export function mapServerFieldNameToFormId(field: string, options?: FieldNameMapperOptions): string {
  const trimmed = field.trim()
  const customEntity = !!options?.customEntity
  if (customEntity) {
    if (trimmed.startsWith('cf_')) return trimmed.slice(3)
    if (trimmed.startsWith('cf:')) return trimmed.slice(3)
    return trimmed
  }
  if (trimmed.startsWith('cf_')) return trimmed
  if (trimmed.startsWith('cf:')) return `cf_${trimmed.slice(3)}`
  return trimmed
}

export function mapCrudServerErrorToFormErrors(
  err: unknown,
  options?: FieldNameMapperOptions,
): { message?: string; fieldErrors?: CrudServerFieldErrors } {
  const normalized = normalizeCrudServerError(err)
  const fieldErrors = normalized.fieldErrors
  if (!fieldErrors) return { message: normalized.message }

  const mapped: CrudServerFieldErrors = {}
  for (const [key, value] of Object.entries(fieldErrors)) {
    const formId = mapServerFieldNameToFormId(key, options)
    if (!formId) continue
    mapped[formId] = value
  }

  let message = normalized.message
  const firstEntry = Object.entries(mapped)[0]
  if (
    firstEntry &&
    (!message || (typeof message === 'string' && message.trim().toLowerCase() === 'invalid input'))
  ) {
    const [, fieldMessage] = firstEntry
    if (typeof fieldMessage === 'string' && fieldMessage.trim().length) {
      message = fieldMessage
    }
  }

  return {
    message,
    fieldErrors: mapped,
  }
}

export function parseServerMessage(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return trimmed
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const text =
        typeof parsed?.error === 'string' && parsed.error.trim()
          ? parsed.error.trim()
          : typeof parsed?.message === 'string' && parsed.message.trim()
            ? parsed.message.trim()
            : null
      if (text) return text
    } catch {
      // ignore JSON parse failure, fall through to trimmed string
    }
  }
  return trimmed
}

function buildHttpError(
  message: string,
  extras?: Record<string, unknown>,
): Error & Record<string, unknown> {
  const error = new Error(message) as Error & Record<string, unknown>
  if (!extras) return error
  for (const [key, value] of Object.entries(extras)) {
    error[key] = value
  }
  return error
}

export async function raiseCrudError(res: Response, fallbackMessage?: string): Promise<never> {
  let raw: string | null = null
  try {
    raw = await res.text()
  } catch {
    raw = null
  }

  const trimmed = raw && raw.trim() ? raw.trim() : null
  const parsed = trimmed ? tryParseJson(trimmed) : null

  if (parsed && typeof parsed === 'object') {
    const data = parsed as Record<string, unknown>
    const rawMessage =
      typeof data.error === 'string' && data.error.trim()
        ? data.error.trim()
        : typeof data.message === 'string' && data.message.trim()
          ? data.message.trim()
          : fallbackMessage ?? `Request failed (${res.status})`
    const message = parseServerMessage(rawMessage)
    throw buildHttpError(message, {
      ...data,
      status: res.status,
      raw: trimmed ?? null,
    })
  }

  const message = parseServerMessage(fallbackMessage ?? `Request failed (${res.status})`)
  throw buildHttpError(message, { status: res.status, raw: trimmed ?? null })
}

export type CrudFormError = Error & {
  status?: number
  fieldErrors?: CrudServerFieldErrors
  details?: unknown
}

export function createCrudFormError(
  message: string,
  fieldErrors?: CrudServerFieldErrors,
  extras?: Partial<Pick<CrudFormError, 'status' | 'details'>>,
): CrudFormError {
  const error = new Error(message) as CrudFormError
  if (fieldErrors && Object.keys(fieldErrors).length) error.fieldErrors = fieldErrors
  if (extras?.status !== undefined) error.status = extras.status
  if (extras?.details !== undefined) error.details = extras.details
  return error
}

export async function readJsonSafe<T>(res: Response, fallback: T | null = null): Promise<T | null> {
  try {
    const text = await res.text()
    if (!text) return fallback
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}
