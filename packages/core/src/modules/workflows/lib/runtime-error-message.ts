import type { IssueMessageTranslator } from './definition-error-body'

/**
 * A runtime failure persists English text (`errorMessage`, `errorData.error`)
 * because logs and failure grouping read it. An error a user must read in their
 * own locale also carries its key and arguments in its details, and the
 * render boundary localizes from those. Without them, or without a dictionary,
 * the persisted English text is what shows.
 */
export type RuntimeErrorMessageRef = { key: string; params: Record<string, string> }

const RUNTIME_ERROR_MESSAGE_DETAIL = 'i18n'

export function buildRuntimeErrorMessageDetail(key: string, params: Record<string, string>) {
  return { [RUNTIME_ERROR_MESSAGE_DETAIL]: { key, params } satisfies RuntimeErrorMessageRef }
}

export function formatRuntimeErrorFallback(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => params[name] ?? placeholder)
}

export function readRuntimeErrorMessageRef(details: unknown): RuntimeErrorMessageRef | null {
  if (!details || typeof details !== 'object') return null
  const ref = (details as Record<string, unknown>)[RUNTIME_ERROR_MESSAGE_DETAIL]
  if (!ref || typeof ref !== 'object') return null
  const { key, params } = ref as Record<string, unknown>
  if (typeof key !== 'string' || key.length === 0) return null
  if (!params || typeof params !== 'object') return { key, params: {} }
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  )
  return { key, params: Object.fromEntries(entries) }
}

export function localizeRuntimeErrorMessage(
  message: string,
  details: unknown,
  translate: IssueMessageTranslator,
): string {
  const ref = readRuntimeErrorMessageRef(details)
  return ref ? translate(ref.key, message, ref.params) : message
}

/** A step's persisted `errorData`, with `error` in the reader's locale. */
export function localizeStepErrorData(errorData: unknown, translate: IssueMessageTranslator): unknown {
  if (!errorData || typeof errorData !== 'object') return errorData
  const { error, details } = errorData as { error?: unknown; details?: unknown }
  if (typeof error !== 'string') return errorData
  return { ...errorData, error: localizeRuntimeErrorMessage(error, details, translate) }
}
