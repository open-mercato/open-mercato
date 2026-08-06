export type PushConnectErrorBody = {
  code?: string | null
  fieldErrors?: Record<string, string> | null
  fieldErrorCodes?: Record<string, string> | null
}

export type PushConnectTranslate = (key: string, fallback: string) => string

/**
 * Map a push connect route's structured error `code`
 * (`provider_not_tenant_scoped`, `mailbox_already_connected`,
 * `wrong_scope_for_route`, …) to a localized
 * `communication_channels.push.connect.errors.<code>` message, falling back to
 * the generic `push.connect.failed` when the response carries no code or no
 * matching translation exists. The raw English `error` string the route also
 * returns stays reserved for logs/API consumers so the shipped locale files
 * apply on the failure path.
 */
export function resolvePushConnectErrorMessage(
  translate: PushConnectTranslate,
  body: PushConnectErrorBody | undefined,
): string {
  const fallback = translate('communication_channels.push.connect.failed', 'Could not connect push provider.')
  if (!body?.code) return fallback
  return translate(`communication_channels.push.connect.errors.${body.code}`, fallback)
}

/**
 * Localize the per-field credential-validation errors a 422 connect response
 * carries. Each field's `fieldErrorCodes` entry maps to
 * `communication_channels.push.connect.errors.fields.<code>`; when a field has
 * no code (an adapter that predates the code contract) or the locale ships no
 * matching key, the raw English `fieldErrors` string is used so the operator
 * still sees something actionable rather than a blank field.
 *
 * Returns a map ready for a widget's `setFieldErrors`.
 */
export function resolvePushConnectFieldErrors(
  translate: PushConnectTranslate,
  body: PushConnectErrorBody | undefined,
): Record<string, string> {
  const fieldErrors = body?.fieldErrors ?? {}
  const fieldErrorCodes = body?.fieldErrorCodes ?? {}
  const resolved: Record<string, string> = {}
  for (const [field, message] of Object.entries(fieldErrors)) {
    const code = fieldErrorCodes[field]
    resolved[field] = code
      ? translate(`communication_channels.push.connect.errors.fields.${code}`, message)
      : message
  }
  return resolved
}
