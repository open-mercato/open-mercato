'use client'

import * as React from 'react'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import GenericProviderSetup from './GenericProviderSetup'
import GenericProviderVerify from './GenericProviderVerify'
import OtpEmailChallengeVerify from './OtpEmailChallengeVerify'
import OtpEmailProviderDetails from './OtpEmailProviderDetails'
import PasskeyChallengeVerify from './PasskeyChallengeVerify'
import PasskeyProviderDetails from './PasskeyProviderDetails'
import RecoveryCodeChallengeVerify from './RecoveryCodeChallengeVerify'
import TotpChallengeVerify from './TotpChallengeVerify'
import TotpProviderDetails from './TotpProviderDetails'
import type { MfaMethod, MfaProvider } from '../types'
import type { MfaChallengeMethod } from './MfaChallengePanel'
import GenericMfaProviderListItem from './mfa-provider-list-items/GenericMfaProviderListItem'
import OtpEmailProviderListItem from './mfa-provider-list-items/OtpEmailProviderListItem'
import PasskeyProviderListItem from './mfa-provider-list-items/PasskeyProviderListItem'
import TotpProviderListItem from './mfa-provider-list-items/TotpProviderListItem'
import MfaProviderMethodListItem from './MfaProviderMethodListItem'

export type ProviderSetupComponentProps = {
  provider: MfaProvider
  onComplete: (recoveryCodes: string[]) => void
  onCancel: () => void
}

type ProviderSetupComponent = React.ComponentType<ProviderSetupComponentProps>

function TotpProviderSetupComponent() {
  return <TotpProviderDetails />
}

function PasskeyProviderSetupComponent() {
  return <PasskeyProviderDetails />
}

function GenericProviderSetupComponent({
  provider,
  onComplete,
  onCancel,
}: ProviderSetupComponentProps) {
  return (
    <GenericProviderSetup
      providerType={provider.type}
      providerLabel={provider.label}
      onComplete={onComplete}
      onCancel={onCancel}
    />
  )
}

const builtInSetupComponents: Record<string, ProviderSetupComponent> = {
  totp: TotpProviderSetupComponent,
  passkey: PasskeyProviderSetupComponent,
}

export function getProviderSetupComponentId(providerType: string): string {
  return `section:security.mfa.setup.provider:${providerType}`
}

export function useProviderSetupComponent(providerType: string): ProviderSetupComponent {
  const fallback = React.useMemo<ProviderSetupComponent>(() => {
    return builtInSetupComponents[providerType] ?? GenericProviderSetupComponent
  }, [providerType])

  return useRegisteredComponent<ProviderSetupComponentProps>(
    getProviderSetupComponentId(providerType),
    fallback,
  )
}

export type ProviderListComponentProps = {
  provider: MfaProvider
  configuredCount: number
  onClick: () => void
}

type ProviderListComponent = React.ComponentType<ProviderListComponentProps>

const builtInListComponents: Record<string, ProviderListComponent> = {
  otp_email: OtpEmailProviderListItem,
  passkey: PasskeyProviderListItem,
  totp: TotpProviderListItem,
}

export function getProviderListComponentId(providerType: string): string {
  return `section:security.mfa.providers.list-item:${providerType}`
}

export function useProviderListComponent(providerType: string): ProviderListComponent {
  const fallback = React.useMemo<ProviderListComponent>(() => {
    return builtInListComponents[providerType] ?? GenericMfaProviderListItem
  }, [providerType])

  return useRegisteredComponent<ProviderListComponentProps>(
    getProviderListComponentId(providerType),
    fallback,
  )
}

export type ProviderDetailsComponentProps = {
  provider: MfaProvider
  methods: MfaMethod[]
  saving: boolean
  onRemoveMethod: (method: MfaMethod) => Promise<void>
  onMethodsChanged: () => Promise<void>
}

type ProviderDetailsComponent = React.ComponentType<ProviderDetailsComponentProps>

function TotpProviderDetailsComponent() {
  return <TotpProviderDetails />
}

function PasskeyProviderDetailsComponent({
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

function OtpEmailProviderDetailsComponent({
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

function GenericProviderDetailsComponent({
  provider,
  methods,
  saving,
  onRemoveMethod,
  onMethodsChanged,
}: ProviderDetailsComponentProps) {
  return (
    <section className="space-y-4">
      <GenericProviderSetup
        providerType={provider.type}
        providerLabel={provider.label}
        onComplete={() => {
          void onMethodsChanged()
        }}
      />
      {methods.length > 0 ? (
        <section className="space-y-2 rounded-md border p-3">
          {methods.map((method) => (
            <MfaProviderMethodListItem
              key={method.id}
              method={method}
              deleting={saving}
              onDelete={(entry) => {
                void onRemoveMethod(entry)
              }}
            />
          ))}
        </section>
      ) : null}
    </section>
  )
}

const builtInProviderDetailsComponents: Record<string, ProviderDetailsComponent> = {
  otp_email: OtpEmailProviderDetailsComponent,
  totp: TotpProviderDetailsComponent,
  passkey: PasskeyProviderDetailsComponent,
}

export function getProviderDetailsComponentId(providerType: string): string {
  return `section:security.mfa.provider.details:${providerType}`
}

export function useProviderDetailsComponent(providerType: string): ProviderDetailsComponent {
  const fallback = React.useMemo<ProviderDetailsComponent>(() => {
    return builtInProviderDetailsComponents[providerType] ?? GenericProviderDetailsComponent
  }, [providerType])

  return useRegisteredComponent<ProviderDetailsComponentProps>(
    getProviderDetailsComponentId(providerType),
    fallback,
  )
}

export type ProviderChallengeComponentProps = {
  method: MfaChallengeMethod
  loading: boolean
  onVerify: (payload: Record<string, unknown>) => Promise<void>
  onPrepare: () => Promise<Record<string, unknown> | undefined>
  onResend?: () => Promise<unknown>
  submitLabel: string
}

type ProviderChallengeComponent = React.ComponentType<ProviderChallengeComponentProps>

function PasskeyProviderChallengeComponent({
  loading,
  onPrepare,
  onVerify,
}: ProviderChallengeComponentProps) {
  return <PasskeyChallengeVerify loading={loading} onPrepare={onPrepare} onVerify={onVerify} />
}

function TotpProviderChallengeComponent({
  onVerify,
  submitLabel,
}: ProviderChallengeComponentProps) {
  return <TotpChallengeVerify onVerify={onVerify} submitLabel={submitLabel} />
}

function RecoveryCodeProviderChallengeComponent({
  onVerify,
  submitLabel,
}: ProviderChallengeComponentProps) {
  return <RecoveryCodeChallengeVerify onVerify={onVerify} submitLabel={submitLabel} />
}

function OtpEmailProviderChallengeComponent({
  onVerify,
  onResend,
  submitLabel,
}: ProviderChallengeComponentProps) {
  return (
    <OtpEmailChallengeVerify
      onVerify={onVerify}
      onResend={onResend}
      submitLabel={submitLabel}
    />
  )
}

function GenericProviderChallengeComponent({
  onVerify,
  onResend,
  submitLabel,
}: ProviderChallengeComponentProps) {
  return (
    <GenericProviderVerify
      onVerify={onVerify}
      onResend={onResend}
      submitLabel={submitLabel}
    />
  )
}

const builtInChallengeComponents: Record<string, ProviderChallengeComponent> = {
  otp_email: OtpEmailProviderChallengeComponent,
  passkey: PasskeyProviderChallengeComponent,
  totp: TotpProviderChallengeComponent,
  recovery_code: RecoveryCodeProviderChallengeComponent,
}

export function getProviderChallengeComponentId(providerType: string): string {
  return `section:security.mfa.challenge.provider:${providerType}`
}

export function useProviderChallengeComponent(providerType: string): ProviderChallengeComponent {
  const fallback = React.useMemo<ProviderChallengeComponent>(() => {
    return builtInChallengeComponents[providerType] ?? GenericProviderChallengeComponent
  }, [providerType])

  return useRegisteredComponent<ProviderChallengeComponentProps>(
    getProviderChallengeComponentId(providerType),
    fallback,
  )
}
