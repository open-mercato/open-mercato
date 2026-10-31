import type { z } from 'zod'

export type DefinitionValidationIssue = {
  path: Array<string | number>
  code: string
  message: string
  expected?: string
  got?: string
}

/**
 * A schema issue may name the translation of its own message: a custom zod
 * issue carrying `params.i18nKey`, whose `message` is the English fallback.
 */
export const ISSUE_I18N_KEY_PARAM = 'i18nKey'

export type IssueMessageTranslator = (key: string, fallback: string, params: Record<string, string>) => string

type IssueWithMessage = { message: string; params?: unknown }

export function readIssueMessageKey(issue: IssueWithMessage): string | null {
  const params = issue.params
  if (!params || typeof params !== 'object') return null
  const key = (params as Record<string, unknown>)[ISSUE_I18N_KEY_PARAM]
  return typeof key === 'string' && key.length > 0 ? key : null
}

/**
 * The issue's message in the caller's locale. Without a translator, or for an
 * issue that names no key, it is the issue's own (English) message unchanged.
 */
export function resolveIssueMessage(issue: IssueWithMessage, translate?: IssueMessageTranslator): string {
  const key = translate ? readIssueMessageKey(issue) : null
  return key && translate ? translate(key, issue.message, {}) : issue.message
}

const RECEIVED_MESSAGE_PATTERN = /received (.+)$/

function normalizeIssuePath(path: ReadonlyArray<PropertyKey>): Array<string | number> {
  return path.map((segment) => (typeof segment === 'number' ? segment : String(segment)))
}

function resolveExpected(issue: z.core.$ZodIssue): string | undefined {
  if ('expected' in issue && typeof issue.expected === 'string') return issue.expected
  if ('values' in issue && Array.isArray(issue.values)) {
    return issue.values.map((value) => JSON.stringify(value)).join(' | ')
  }
  return undefined
}

function resolveGot(issue: z.core.$ZodIssue): string | undefined {
  if (issue.code !== 'invalid_type') return undefined
  const match = RECEIVED_MESSAGE_PATTERN.exec(issue.message)
  return match ? match[1] : undefined
}

/**
 * `translate` is optional: the definition routes pass the request locale's
 * translator so keyed messages reach API clients localized; agent tools and
 * evaluators omit it and keep the English text.
 */
export function normalizeDefinitionValidationIssues(
  error: z.ZodError,
  translate?: IssueMessageTranslator,
): DefinitionValidationIssue[] {
  return error.issues.map((issue) => {
    const expected = resolveExpected(issue)
    const got = resolveGot(issue)
    return {
      path: normalizeIssuePath(issue.path),
      code: typeof issue.code === 'string' ? issue.code : 'custom',
      message: resolveIssueMessage(issue, translate),
      ...(expected !== undefined ? { expected } : {}),
      ...(got !== undefined ? { got } : {}),
    }
  })
}
