/**
 * Login form injection contract.
 *
 * Defines types that the login page exposes to widgets injected via
 * the `auth.login:form` InjectionSpot. This allows enterprise modules
 * (or any future auth provider) to extend the login flow without the
 * core auth module knowing about specific providers.
 */

/**
 * Describes an alternative authentication method that has claimed the
 * current login flow. When set, the login form hides the password field
 * and delegates submission to the provider.
 */
export type AuthOverride = {
  /** Stable identifier for the provider (e.g., 'sso', 'social') */
  providerId: string
  /** Label shown on the submit button (e.g., 'Continue with SSO') */
  providerLabel: string
  /** Called instead of the normal password-based submit */
  onSubmit: () => void
  /** Whether to hide the password field */
  hidePassword: boolean
  /** Whether to hide the "Remember me" checkbox */
  hideRememberMe: boolean
  /** Whether to hide the "Forgot password?" link */
  hideForgotPassword: boolean
}

/**
 * Context passed to widgets injected into the login form.
 * Widgets use these values and callbacks to participate in the login flow.
 */
export type LoginFormWidgetContext = {
  /** Current value of the email input */
  email: string
  /** Current tenant ID (from URL param or localStorage) */
  tenantId: string | null
  /** URL search params — widgets can read provider-specific error codes */
  searchParams: URLSearchParams
  /** Set or clear an alternative auth provider for the current email */
  setAuthOverride: (override: AuthOverride | null) => void
  /** Display an error message in the login form's error area */
  setError: (error: string | null) => void
}
