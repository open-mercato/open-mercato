import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type Translate = (key: string, fallback?: string) => string

/**
 * Staff validators report some issues as translation keys (for example
 * `staff.validation.nonNegativeAmount`). Resolves each issue message in the
 * request locale; a message without a dictionary entry stays as written.
 */
export function localizeValidationIssues<T extends { message: string }>(issues: readonly T[], translate: Translate): T[] {
  return issues.map((issue) => ({ ...issue, message: translate(issue.message, issue.message) }))
}

/**
 * Runs `parse` and rethrows a `ZodError` as the same 400 the CRUD factory answers
 * with, its issue messages localized.
 */
export function parseWithLocalizedIssues<T>(parse: () => T, translate: Translate): T {
  try {
    return parse()
  } catch (err) {
    if (!(err instanceof z.ZodError)) throw err
    throw new CrudHttpError(400, { error: 'Invalid input', details: localizeValidationIssues(err.issues, translate) })
  }
}
