'use client'

import * as React from 'react'
import { z } from 'zod'
import type {
  ProviderChallengeComponentProps,
  ProviderDetailsComponentProps,
  ProviderSetupComponentProps,
} from './mfa-ui-registry'
import OtpEmailChallengeVerify from './OtpEmailChallengeVerify'
import OtpEmailProviderDetails from './OtpEmailProviderDetails'
import PasskeyChallengeVerify from './PasskeyChallengeVerify'
import PasskeyProviderDetails from './PasskeyProviderDetails'
import RecoveryCodeChallengeVerify from './RecoveryCodeChallengeVerify'
import TotpChallengeVerify from './TotpChallengeVerify'
import TotpProviderDetails from './TotpProviderDetails'
import OtpEmailProviderListItem from './mfa-provider-list-items/OtpEmailProviderListItem'
import PasskeyProviderListItem from './mfa-provider-list-items/PasskeyProviderListItem'
import TotpProviderListItem from './mfa-provider-list-items/TotpProviderListItem'
import type { ProviderListComponentProps } from './mfa-ui-registry'

export const passthroughPropsSchema = z.object({}).passthrough()

export function TotpProviderSetupComponent(_props: ProviderSetupComponentProps) {
  return <TotpProviderDetails />
}

export function PasskeyProviderSetupComponent(_props: ProviderSetupComponentProps) {
  return <PasskeyProviderDetails />
}

export const TotpProviderListComponent = TotpProviderListItem
export const PasskeyProviderListComponent = PasskeyProviderListItem
export const OtpEmailProviderListComponent = OtpEmailProviderListItem

export function TotpProviderDetailsComponent({
  methods,
  saving,
  onRemoveMethod,
  onMethodsChanged,
}: ProviderDetailsComponentProps) {
  return (
    <TotpProviderDetails
      methods={methods}
      saving={saving}
      onRemoveMethod={onRemoveMethod}
      onMethodsChanged={onMethodsChanged}
    />
  )
}

export function PasskeyProviderDetailsComponent({
  methods,
  saving,
  onRemoveMethod,
  onMethodsChanged,
}: ProviderDetailsComponentProps) {
  return (
    <PasskeyProviderDetails
      methods={methods}
      saving={saving}
      onRemoveMethod={onRemoveMethod}
      onMethodAdded={onMethodsChanged}
    />
  )
}

export function OtpEmailProviderDetailsComponent({
  methods,
  saving,
  onRemoveMethod,
  onMethodsChanged,
}: ProviderDetailsComponentProps) {
  return (
    <OtpEmailProviderDetails
      methods={methods}
      saving={saving}
      onRemoveMethod={onRemoveMethod}
      onMethodsChanged={onMethodsChanged}
    />
  )
}

export function PasskeyProviderChallengeComponent({
  loading,
  onPrepare,
  onVerify,
}: ProviderChallengeComponentProps) {
  return <PasskeyChallengeVerify loading={loading} onPrepare={onPrepare} onVerify={onVerify} />
}

export function TotpProviderChallengeComponent({
  onVerify,
  submitLabel,
}: ProviderChallengeComponentProps) {
  return <TotpChallengeVerify onVerify={onVerify} submitLabel={submitLabel} />
}

export function OtpEmailProviderChallengeComponent({
  onVerify,
  onResend,
  submitLabel,
}: ProviderChallengeComponentProps) {
  return <OtpEmailChallengeVerify onVerify={onVerify} onResend={onResend} submitLabel={submitLabel} />
}

export function RecoveryCodeProviderChallengeComponent({
  onVerify,
  submitLabel,
}: ProviderChallengeComponentProps) {
  return <RecoveryCodeChallengeVerify onVerify={onVerify} submitLabel={submitLabel} />
}

export type {
  ProviderChallengeComponentProps,
  ProviderDetailsComponentProps,
  ProviderListComponentProps,
  ProviderSetupComponentProps,
}
