'use client'

import * as React from 'react'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { buildMfaProviderComponentHandles } from '../lib/mfa-provider-interface'
import GenericProviderSetup from './GenericProviderSetup'
import GenericProviderVerify from './GenericProviderVerify'
import type { MfaMethod, MfaProvider } from '../types'
import type { MfaChallengeMethod } from './MfaChallengePanel'
import GenericMfaProviderListItem from './mfa-provider-list-items/GenericMfaProviderListItem'
import MfaProviderMethodListItem from './MfaProviderMethodListItem'

export type ProviderSetupComponentProps = {
  provider: MfaProvider
  onComplete: (recoveryCodes: string[]) => void
  onCancel: () => void
}

type ProviderSetupComponent = React.ComponentType<ProviderSetupComponentProps>

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

export function useProviderSetupComponent(provider: {
  type: string
  label: string
  components?: MfaProvider['components']
}): ProviderSetupComponent {
  const fallback = React.useMemo<ProviderSetupComponent>(() => GenericProviderSetupComponent, [])

  return useRegisteredComponent<ProviderSetupComponentProps>(
    provider.components?.setup ?? buildMfaProviderComponentHandles(provider.type).setup,
    fallback,
  )
}

export type ProviderListComponentProps = {
  provider: MfaProvider
  configuredCount: number
  onClick: () => void
}

type ProviderListComponent = React.ComponentType<ProviderListComponentProps>

export function useProviderListComponent(provider: MfaProvider): ProviderListComponent {
  const fallback = React.useMemo<ProviderListComponent>(() => GenericMfaProviderListItem, [])

  return useRegisteredComponent<ProviderListComponentProps>(
    provider.components?.list ?? buildMfaProviderComponentHandles(provider.type).list,
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

export function useProviderDetailsComponent(provider: MfaProvider): ProviderDetailsComponent {
  const fallback = React.useMemo<ProviderDetailsComponent>(() => GenericProviderDetailsComponent, [])

  return useRegisteredComponent<ProviderDetailsComponentProps>(
    provider.components?.details ?? buildMfaProviderComponentHandles(provider.type).details,
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

export function useProviderChallengeComponent(method: { type: string; components?: MfaProvider['components'] }): ProviderChallengeComponent {
  const fallback = React.useMemo<ProviderChallengeComponent>(() => GenericProviderChallengeComponent, [])

  return useRegisteredComponent<ProviderChallengeComponentProps>(
    method.components?.challenge ?? buildMfaProviderComponentHandles(method.type).challenge,
    fallback,
  )
}
