'use client'

import * as React from 'react'
import { buildMfaProviderComponentHandles } from '../lib/mfa-provider-interface'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import {
  OtpEmailProviderChallengeComponent,
  OtpEmailProviderDetailsComponent,
  OtpEmailProviderListComponent,
  PasskeyProviderChallengeComponent,
  PasskeyProviderDetailsComponent,
  PasskeyProviderListComponent,
  PasskeyProviderSetupComponent,
  passthroughPropsSchema,
  RecoveryCodeProviderChallengeComponent,
  TotpProviderChallengeComponent,
  TotpProviderDetailsComponent,
  TotpProviderListComponent,
  TotpProviderSetupComponent,
} from '../components/mfa-provider-components'
import MfaChallengePanel, { type MfaChallengeMethod } from '../components/MfaChallengePanel'

type LoginResponseDetail = {
  mfa_required?: unknown
  challenge_id?: unknown
  challengeId?: unknown
  available_methods?: unknown
  availableMethods?: unknown
  token?: unknown
}

type MfaRequiredState = {
  challengeId: string
  availableMethods: MfaChallengeMethod[]
}

type LoginFormSectionProps = {
  children?: React.ReactNode
}

function createSecurityReplacementOverride<TProps>(
  componentId: string,
  replacement: React.ComponentType<TProps>,
): ComponentOverride {
  return {
    target: { componentId },
    priority: 50,
    metadata: { module: 'security' },
    replacement: replacement as React.ComponentType<unknown>,
    propsSchema: passthroughPropsSchema,
  }
}

function parseMfaRequiredState(detail: unknown): MfaRequiredState | null {
  if (!detail || typeof detail !== 'object') return null
  const payload = detail as LoginResponseDetail
  if (payload.mfa_required !== true) return null

  const challengeIdRaw = payload.challenge_id ?? payload.challengeId
  const tokenRaw = payload.token
  const methodsRaw = payload.available_methods ?? payload.availableMethods

  if (typeof challengeIdRaw !== 'string' || challengeIdRaw.length === 0) return null
  if (typeof tokenRaw !== 'string' || tokenRaw.length === 0) return null

  const availableMethods = Array.isArray(methodsRaw)
    ? methodsRaw
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      .map((entry) => ({
        type: typeof entry.type === 'string' ? entry.type : 'unknown',
        label: typeof entry.label === 'string' ? entry.label : (typeof entry.type === 'string' ? entry.type : ''),
        icon: typeof entry.icon === 'string' ? entry.icon : '',
      }))
    : []

  return {
    challengeId: challengeIdRaw,
    availableMethods,
  }
}

function createMfaLoginFormWrapper(
  Original: React.ComponentType<unknown>,
): React.ComponentType<unknown> {
  const OriginalTyped = Original as React.ComponentType<LoginFormSectionProps>

  const WrappedLoginFormSection = (props: LoginFormSectionProps) => {
    const [mfaRequiredState, setMfaRequiredState] = React.useState<MfaRequiredState | null>(null)

    React.useEffect(() => {
      const onLoginResponse = (event: Event) => {
        const customEvent = event as CustomEvent<unknown>
        const parsed = parseMfaRequiredState(customEvent.detail)
        if (!parsed) return
        setMfaRequiredState(parsed)
      }
      window.addEventListener('om:auth:login-response', onLoginResponse as EventListener)
      return () => {
        window.removeEventListener('om:auth:login-response', onLoginResponse as EventListener)
      }
    }, [])

    if (mfaRequiredState) {
      return React.createElement(MfaChallengePanel, {
        challengeId: mfaRequiredState.challengeId,
        availableMethods: mfaRequiredState.availableMethods,
        onBack: () => setMfaRequiredState(null),
      })
    }

    return React.createElement(OriginalTyped, props)
  }

  WrappedLoginFormSection.displayName = 'SecurityMfaLoginFormWrapper'
  return WrappedLoginFormSection as React.ComponentType<unknown>
}

export const componentOverrides: ComponentOverride[] = [
  {
    target: { componentId: 'section:auth.login.form' },
    priority: 50,
    metadata: { module: 'security' },
    wrapper: createMfaLoginFormWrapper,
  },
  createSecurityReplacementOverride(
    buildMfaProviderComponentHandles('totp').setup,
    TotpProviderSetupComponent,
  ),
  createSecurityReplacementOverride(
    buildMfaProviderComponentHandles('passkey').setup,
    PasskeyProviderSetupComponent,
  ),
  createSecurityReplacementOverride(
    buildMfaProviderComponentHandles('totp').list,
    TotpProviderListComponent,
  ),
  createSecurityReplacementOverride(
    buildMfaProviderComponentHandles('passkey').list,
    PasskeyProviderListComponent,
  ),
  createSecurityReplacementOverride(
    buildMfaProviderComponentHandles('otp_email').list,
    OtpEmailProviderListComponent,
  ),
  createSecurityReplacementOverride(
    buildMfaProviderComponentHandles('totp').details,
    TotpProviderDetailsComponent,
  ),
  createSecurityReplacementOverride(
    buildMfaProviderComponentHandles('passkey').details,
    PasskeyProviderDetailsComponent,
  ),
  createSecurityReplacementOverride(
    buildMfaProviderComponentHandles('otp_email').details,
    OtpEmailProviderDetailsComponent,
  ),
  createSecurityReplacementOverride(
    buildMfaProviderComponentHandles('totp').challenge,
    TotpProviderChallengeComponent,
  ),
  createSecurityReplacementOverride(
    buildMfaProviderComponentHandles('passkey').challenge,
    PasskeyProviderChallengeComponent,
  ),
  createSecurityReplacementOverride(
    buildMfaProviderComponentHandles('otp_email').challenge,
    OtpEmailProviderChallengeComponent,
  ),
  createSecurityReplacementOverride(
    buildMfaProviderComponentHandles('recovery_code').challenge,
    RecoveryCodeProviderChallengeComponent,
  ),
]

export default componentOverrides
