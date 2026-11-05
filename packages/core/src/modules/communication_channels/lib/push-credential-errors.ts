/**
 * Stable field-error codes for push credential validation (fcm/apns/expo).
 *
 * Push credential schemas emit one of these codes as the zod issue `message`
 * instead of prose. {@link BasePushChannelAdapter.validateCredentials} then
 * splits each issue into two channels:
 *
 *   - `errors[field]`     — English prose from {@link PUSH_CREDENTIAL_ERROR_MESSAGES},
 *                           reserved for logs and API consumers.
 *   - `errorCodes[field]` — the code, which the connect widgets map to
 *                           `communication_channels.push.connect.errors.fields.<code>`
 *                           so operators see a localized message.
 *
 * This mirrors the route-level split already used by `push-connect-error.ts`.
 * An issue whose message is not a known code degrades to {@link PUSH_CREDENTIAL_ERROR_INVALID}
 * with the raw zod message kept in `errors`, so a schema change can never leak
 * an untranslated internal string into the UI.
 */

export const PUSH_CREDENTIAL_ERROR_REQUIRED = 'required'
export const PUSH_CREDENTIAL_ERROR_INVALID = 'invalid'
export const PUSH_CREDENTIAL_ERROR_INVALID_JSON = 'invalid_json'
export const PUSH_CREDENTIAL_ERROR_MISSING_FIELDS = 'missing_fields'
export const PUSH_CREDENTIAL_ERROR_INVALID_P8 = 'invalid_p8'
export const PUSH_CREDENTIAL_ERROR_INVALID_KEY_ID = 'invalid_key_id'
export const PUSH_CREDENTIAL_ERROR_INVALID_TEAM_ID = 'invalid_team_id'
export const PUSH_CREDENTIAL_ERROR_INVALID_BUNDLE_ID = 'invalid_bundle_id'

/**
 * English prose per code. Kept as the `errors` payload so existing API
 * consumers and log readers still get a human-readable string.
 */
export const PUSH_CREDENTIAL_ERROR_MESSAGES: Record<string, string> = {
  [PUSH_CREDENTIAL_ERROR_REQUIRED]: 'This field is required.',
  [PUSH_CREDENTIAL_ERROR_INVALID]: 'This value is invalid.',
  [PUSH_CREDENTIAL_ERROR_INVALID_JSON]: 'This is not valid JSON. Paste the service account file exactly as Firebase generated it.',
  [PUSH_CREDENTIAL_ERROR_MISSING_FIELDS]: 'The service account JSON is missing required fields (project_id, client_email, private_key).',
  [PUSH_CREDENTIAL_ERROR_INVALID_P8]: 'This is not a readable APNs .p8 signing key. Paste the whole file including the BEGIN and END lines.',
  [PUSH_CREDENTIAL_ERROR_INVALID_KEY_ID]: 'An APNs Key ID is 10 alphanumeric characters.',
  [PUSH_CREDENTIAL_ERROR_INVALID_TEAM_ID]: 'An Apple Team ID is 10 alphanumeric characters.',
  [PUSH_CREDENTIAL_ERROR_INVALID_BUNDLE_ID]: 'A Bundle ID looks like com.example.app.',
}

export function isPushCredentialErrorCode(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(PUSH_CREDENTIAL_ERROR_MESSAGES, value)
}

/**
 * Split a zod issue message into `{ code, message }`. Known codes resolve to
 * their English prose; anything else is reported as {@link PUSH_CREDENTIAL_ERROR_INVALID}
 * while preserving the original text for logs.
 */
export function resolvePushCredentialIssue(issueMessage: string): { code: string; message: string } {
  if (isPushCredentialErrorCode(issueMessage)) {
    return { code: issueMessage, message: PUSH_CREDENTIAL_ERROR_MESSAGES[issueMessage] }
  }
  return { code: PUSH_CREDENTIAL_ERROR_INVALID, message: issueMessage }
}
