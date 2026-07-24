export const CALL_API_IDENTITY_ERROR_MARKER =
  'no traceable user roles could be resolved from the workflow instance or definition'

export function isCallApiIdentityResolutionError(errorMessage: string | null | undefined): boolean {
  return typeof errorMessage === 'string' && errorMessage.includes(CALL_API_IDENTITY_ERROR_MARKER)
}
