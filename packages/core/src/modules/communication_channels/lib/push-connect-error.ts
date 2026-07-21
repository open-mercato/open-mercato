export type PushConnectErrorBody = {
  code?: string | null
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
