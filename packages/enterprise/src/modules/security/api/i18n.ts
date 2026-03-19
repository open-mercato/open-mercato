import { NextResponse } from 'next/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

type TranslateParams = Record<string, string | number>

type MessageDescriptor = {
  key: string
  fallback: string
  params?: TranslateParams
}

const exactMessageMap = new Map<string, MessageDescriptor>([
  ['Not implemented', { key: 'security.api.errors.notImplemented', fallback: 'Not implemented.' }],
  ['Unauthorized', { key: 'api.errors.unauthorized', fallback: 'Unauthorized' }],
  ['Invalid payload', { key: 'api.errors.invalidPayload', fallback: 'Invalid payload.' }],
  ['Invalid query parameters', { key: 'security.api.errors.invalidQueryParameters', fallback: 'Invalid query parameters.' }],
  ['Invalid route parameters', { key: 'security.api.errors.invalidRouteParameters', fallback: 'Invalid route parameters.' }],
  ['Invalid policy id.', { key: 'security.api.errors.invalidPolicyId', fallback: 'Invalid policy id.' }],
  ['Invalid user id.', { key: 'security.api.errors.invalidUserId', fallback: 'Invalid user id.' }],
  ['Invalid provider type.', { key: 'security.api.errors.invalidProviderType', fallback: 'Invalid provider type.' }],
  ['Invalid method id.', { key: 'security.api.errors.invalidMethodId', fallback: 'Invalid method id.' }],
  ['Sudo config not found', { key: 'security.api.errors.sudoConfigurationNotFound', fallback: 'Sudo configuration not found.' }],
  ['Sudo configuration not found', { key: 'security.api.errors.sudoConfigurationNotFound', fallback: 'Sudo configuration not found.' }],
  ['Tenant context is required.', { key: 'security.api.errors.tenantContextRequired', fallback: 'Tenant context is required.' }],
  ['MFA pending token is required.', { key: 'security.api.errors.mfaPendingTokenRequired', fallback: 'MFA pending token is required.' }],
  ['challengeId and methodType are required.', { key: 'security.api.errors.challengeIdAndMethodTypeRequired', fallback: 'challengeId and methodType are required.' }],
  ['setupId is required.', { key: 'security.api.errors.setupIdRequired', fallback: 'setupId is required.' }],
  ['code is required.', { key: 'security.api.errors.codeRequired', fallback: 'code is required.' }],
  ['Invalid MFA verification code.', { key: 'security.api.errors.invalidMfaVerificationCode', fallback: 'Invalid MFA verification code.' }],
  ['Invalid recovery code.', { key: 'security.api.errors.invalidRecoveryCode', fallback: 'Invalid recovery code.' }],
  ['Failed to process MFA request.', { key: 'security.api.errors.mfaRequestFailed', fallback: 'Failed to process MFA request.' }],
  ['Failed to process enforcement request.', { key: 'security.api.errors.enforcementRequestFailed', fallback: 'Failed to process enforcement request.' }],
  ['Failed to process user security request.', { key: 'security.api.errors.userSecurityRequestFailed', fallback: 'Failed to process user security request.' }],
  ['Failed to process sudo request.', { key: 'security.api.errors.sudoRequestFailed', fallback: 'Failed to process sudo request.' }],
  ['User not found', { key: 'auth.users.form.errors.notFound', fallback: 'User not found' }],
  ['Admin ID is required', { key: 'security.api.errors.adminIdRequired', fallback: 'Admin ID is required.' }],
  ['User ID is required', { key: 'security.api.errors.userIdRequired', fallback: 'User ID is required.' }],
  ['Reset reason is required', { key: 'security.api.errors.resetReasonRequired', fallback: 'Reset reason is required.' }],
  ['Tenant ID is required', { key: 'security.api.errors.tenantIdRequired', fallback: 'Tenant ID is required.' }],
  ['MFA setup session not found', { key: 'security.api.errors.mfaSetupSessionNotFound', fallback: 'MFA setup session not found.' }],
  ['MFA setup session does not match the requested provider', { key: 'security.api.errors.mfaSetupSessionProviderMismatch', fallback: 'MFA setup session does not match the requested provider.' }],
  ['MFA method not found', { key: 'security.api.errors.mfaMethodNotFound', fallback: 'MFA method not found.' }],
  ['No MFA methods configured', { key: 'security.api.errors.noMfaMethodsConfigured', fallback: 'No MFA methods configured.' }],
  ['No registered MFA providers are available for the configured methods', { key: 'security.api.errors.noRegisteredMfaProviders', fallback: 'No registered MFA providers are available for the configured methods.' }],
  ['MFA challenge not found', { key: 'security.api.errors.mfaChallengeNotFound', fallback: 'MFA challenge not found.' }],
  ['MFA challenge already verified', { key: 'security.api.errors.mfaChallengeAlreadyVerified', fallback: 'MFA challenge was already verified.' }],
  ['MFA challenge expired', { key: 'security.api.errors.mfaChallengeExpired', fallback: 'MFA challenge expired.' }],
  ['Enforcement policy not found', { key: 'security.api.errors.enforcementPolicyNotFound', fallback: 'Enforcement policy not found.' }],
  ['Enforcement policy already exists for this scope', { key: 'security.api.errors.enforcementPolicyAlreadyExistsForScope', fallback: 'An enforcement policy already exists for this scope.' }],
  ['scopeId is required for tenant and organisation scopes', { key: 'security.api.errors.enforcementScopeIdRequired', fallback: 'scopeId is required for tenant and organisation scopes.' }],
  ["organisation scopeId must use '<tenantId>:<organizationId>' format", { key: 'security.api.errors.enforcementOrganizationScopeFormat', fallback: "Organisation scopeId must use '<tenantId>:<organizationId>' format." }],
  ['tenantId is required for tenant scope', { key: 'security.api.errors.enforcementTenantIdRequired', fallback: 'tenantId is required for tenant scope.' }],
  ['tenantId and organizationId are required for organisation scope', { key: 'security.api.errors.enforcementOrganizationScopeIdsRequired', fallback: 'tenantId and organizationId are required for organisation scope.' }],
  ['This sudo session does not require MFA', { key: 'security.api.errors.sudoSessionDoesNotRequireMfa', fallback: 'This sudo session does not require MFA.' }],
  ['Sudo protection is not configured for this target', { key: 'security.api.errors.sudoProtectionNotConfigured', fallback: 'Sudo protection is not configured for this target.' }],
  ['Unable to verify sudo challenge', { key: 'security.api.errors.sudoVerifyFailed', fallback: 'Unable to verify the sudo challenge.' }],
  ['A sudo configuration for this target and scope already exists', { key: 'security.api.errors.sudoConfigurationAlreadyExists', fallback: 'A sudo configuration for this target and scope already exists.' }],
  ['Organization-scoped sudo config requires a tenant', { key: 'security.api.errors.sudoOrganizationScopeRequiresTenant', fallback: 'An organization-scoped sudo configuration requires a tenant.' }],
  ['This sudo target requires MFA, but no MFA methods are configured', { key: 'security.api.errors.sudoMfaRequiredButUnavailable', fallback: 'This sudo target requires MFA, but no MFA methods are configured.' }],
  ['Sudo challenge session not found', { key: 'security.api.errors.sudoSessionNotFound', fallback: 'Sudo challenge session not found.' }],
  ['Sudo challenge session expired', { key: 'security.api.errors.sudoSessionExpired', fallback: 'Sudo challenge session expired.' }],
  ['Password is required', { key: 'security.api.errors.passwordRequired', fallback: 'Password is required.' }],
  ['TOTP setup session not found', { key: 'security.api.errors.totpSetupSessionNotFound', fallback: 'TOTP setup session not found.' }],
  ['TOTP setup session expired', { key: 'security.api.errors.totpSetupSessionExpired', fallback: 'TOTP setup session expired.' }],
  ['Invalid TOTP code', { key: 'security.api.errors.invalidTotpCode', fallback: 'Invalid TOTP code.' }],
  ['Invalid empty TOTP secret', { key: 'security.api.errors.invalidTotpSecret', fallback: 'Invalid TOTP secret.' }],
  ['Unable to configure Email OTP without a destination email', { key: 'security.api.errors.emailOtpDestinationRequired', fallback: 'Unable to configure email OTP without a destination email address.' }],
  ['Email OTP setup session not found', { key: 'security.api.errors.emailOtpSetupSessionNotFound', fallback: 'Email OTP setup session not found.' }],
  ['Email OTP setup session expired', { key: 'security.api.errors.emailOtpSetupSessionExpired', fallback: 'Email OTP setup session expired.' }],
  ['MFA method does not belong to user', { key: 'security.api.errors.mfaMethodOwnership', fallback: 'The MFA method does not belong to this user.' }],
  ['Email OTP method is missing a destination email address', { key: 'security.api.errors.emailOtpDestinationMissing', fallback: 'The email OTP method is missing a destination email address.' }],
  ['Passkey setup session not found', { key: 'security.api.errors.passkeySetupSessionNotFound', fallback: 'Passkey setup session not found.' }],
  ['Passkey setup session expired', { key: 'security.api.errors.passkeySetupSessionExpired', fallback: 'Passkey setup session expired.' }],
  ['Passkey registration verification failed', { key: 'security.api.errors.passkeyRegistrationVerificationFailed', fallback: 'Passkey registration verification failed.' }],
  ['Passkey registration did not return credential data', { key: 'security.api.errors.passkeyRegistrationCredentialMissing', fallback: 'Passkey registration did not return credential data.' }],
  ['Invalid passkey setup challenge', { key: 'security.api.errors.invalidPasskeySetupChallenge', fallback: 'Invalid passkey setup challenge.' }],
  ['Passkey credential is not configured', { key: 'security.api.errors.passkeyCredentialNotConfigured', fallback: 'The passkey credential is not configured.' }],
])

const patternMessageMap: Array<{
  pattern: RegExp
  resolve: (match: RegExpMatchArray) => MessageDescriptor
}> = [
  {
    pattern: /^Sudo authentication required for: (.+)$/,
    resolve: (match) => ({
      key: 'security.api.errors.sudoRequiredForTarget',
      fallback: 'Sudo authentication is required for: {target}',
      params: { target: match[1] ?? '' },
    }),
  },
  {
    pattern: /^MFA provider '(.+)' is not registered$/,
    resolve: (match) => ({
      key: 'security.api.errors.mfaProviderNotRegistered',
      fallback: 'MFA provider "{provider}" is not registered.',
      params: { provider: match[1] ?? '' },
    }),
  },
  {
    pattern: /^MFA provider '(.+)' is already configured$/,
    resolve: (match) => ({
      key: 'security.api.errors.mfaProviderAlreadyConfigured',
      fallback: 'MFA provider "{provider}" is already configured.',
      params: { provider: match[1] ?? '' },
    }),
  },
  {
    pattern: /^MFA method '(.+)' not found$/,
    resolve: (match) => ({
      key: 'security.api.errors.mfaMethodByTypeNotFound',
      fallback: 'MFA method "{method}" was not found.',
      params: { method: match[1] ?? '' },
    }),
  },
]

function resolveMessageDescriptor(message: string): MessageDescriptor | null {
  const exact = exactMessageMap.get(message)
  if (exact) return exact

  for (const entry of patternMessageMap) {
    const match = message.match(entry.pattern)
    if (match) return entry.resolve(match)
  }

  return null
}

export async function translateSecurityApiMessage(message: string): Promise<string> {
  const descriptor = resolveMessageDescriptor(message)
  if (!descriptor) return message

  const { translate } = await resolveTranslations()
  return translate(descriptor.key, descriptor.fallback, descriptor.params)
}

export async function localizeSecurityApiBody<T extends Record<string, unknown>>(body: T): Promise<T> {
  const nextBody: Record<string, unknown> = { ...body }

  if (typeof nextBody.error === 'string') {
    nextBody.error = await translateSecurityApiMessage(nextBody.error)
  }

  if (typeof nextBody.message === 'string') {
    nextBody.message = await translateSecurityApiMessage(nextBody.message)
  }

  return nextBody as T
}

export async function securityApiError(
  status: number,
  message: string,
  extra?: Record<string, unknown>,
): Promise<NextResponse> {
  const body = await localizeSecurityApiBody({
    error: message,
    ...(extra ?? {}),
  })
  return NextResponse.json(body, { status })
}
