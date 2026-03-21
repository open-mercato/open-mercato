import type { z } from 'zod'
import type React from 'react'

export type MfaMethodRecord = {
  id: string
  type: string
  userId: string
  secret?: string | null
  providerMetadata?: Record<string, unknown> | null
}

export type MfaProviderConfirmResult = {
  metadata: Record<string, unknown>
  secret?: string | null
}

export type MfaVerifyContext = {
  challenge?: Record<string, unknown> | null
}

export type MfaProviderRuntimeContext = {
  request?: Request
}

export type MfaProviderUser = {
  id: string
  email?: string | null
  tenantId: string
  organizationId?: string | null
}

export interface MfaSetupComponentProps {
  clientData: Record<string, unknown>
  onConfirm: (payload: unknown) => Promise<void>
  onCancel: () => void
}

export interface MfaVerifyComponentProps {
  clientData?: Record<string, unknown>
  onVerify: (payload: unknown) => Promise<void>
  onCancel: () => void
  onResend?: () => Promise<void>
}

export interface MfaProviderInterface {
  readonly type: string
  readonly label: string
  readonly icon: string
  readonly allowMultiple: boolean
  readonly setupSchema: z.ZodSchema
  readonly verifySchema: z.ZodSchema

  resolveSetupPayload?(user: MfaProviderUser, payload: unknown): Promise<unknown> | unknown
  setup(
    userId: string,
    payload: unknown,
    context?: MfaProviderRuntimeContext,
  ): Promise<{ setupId: string; clientData: Record<string, unknown> }>
  confirmSetup(
    userId: string,
    setupId: string,
    payload: unknown,
    context?: MfaProviderRuntimeContext,
  ): Promise<MfaProviderConfirmResult>
  prepareChallenge(
    userId: string,
    method: MfaMethodRecord,
    context?: MfaProviderRuntimeContext,
  ): Promise<{ clientData?: Record<string, unknown>; verifyContext?: MfaVerifyContext }>
  verify(
    userId: string,
    method: MfaMethodRecord,
    payload: unknown,
    context?: MfaVerifyContext,
    runtimeContext?: MfaProviderRuntimeContext,
  ): Promise<boolean>
}

export type MfaProviderComponents = {
  setup?: string
  list?: string
  details?: string
  challenge?: string
}

export type MfaProviderSetup = MfaProviderInterface & {
  readonly components?: MfaProviderComponents
}

export function buildMfaProviderComponentHandles(providerType: string): Required<MfaProviderComponents> {
  return {
    setup: `section:security.mfa.setup.provider:${providerType}`,
    list: `section:security.mfa.providers.list-item:${providerType}`,
    details: `section:security.mfa.provider.details:${providerType}`,
    challenge: `section:security.mfa.challenge.provider:${providerType}`,
  }
}

export function createMfaProviderSetup(
  provider: MfaProviderInterface,
  components?: MfaProviderComponents,
): MfaProviderSetup {
  return {
    type: provider.type,
    label: provider.label,
    icon: provider.icon,
    allowMultiple: provider.allowMultiple,
    setupSchema: provider.setupSchema,
    verifySchema: provider.verifySchema,
    resolveSetupPayload: provider.resolveSetupPayload?.bind(provider),
    setup: provider.setup.bind(provider),
    confirmSetup: provider.confirmSetup.bind(provider),
    prepareChallenge: provider.prepareChallenge.bind(provider),
    verify: provider.verify.bind(provider),
    components,
  }
}

export function isMfaProviderSetup(value: unknown): value is MfaProviderSetup {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MfaProviderSetup>
  return typeof candidate.type === 'string'
    && typeof candidate.label === 'string'
    && typeof candidate.icon === 'string'
    && typeof candidate.allowMultiple === 'boolean'
    && typeof candidate.setup === 'function'
    && typeof candidate.confirmSetup === 'function'
    && typeof candidate.prepareChallenge === 'function'
    && typeof candidate.verify === 'function'
}
