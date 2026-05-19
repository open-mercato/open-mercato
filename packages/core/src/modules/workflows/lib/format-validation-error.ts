type ZodIssueLite = {
  path?: Array<string | number>
  message?: string
}

type ApiErrorBody = {
  error?: string
  details?: ZodIssueLite[]
}

/**
 * Format an API validation error body into a user-readable message.
 *
 * The workflow definitions API returns `{ error: 'Validation failed', details: ZodIssue[] }`
 * for schema failures. The generic `error` string is useless to the user — the actionable
 * information lives in `details[0].path` and `details[0].message`. This helper mirrors the
 * visual editor's `Schema error: <path> - <message>` format so both editors surface the
 * same diagnostic.
 */
export function formatWorkflowValidationError(
  body: ApiErrorBody | null | undefined,
  fallback: string,
): string {
  const issue = body?.details?.[0]
  if (issue?.message) {
    const path = (issue.path ?? []).join('.')
    return path ? `${path} - ${issue.message}` : issue.message
  }
  return body?.error || fallback
}
