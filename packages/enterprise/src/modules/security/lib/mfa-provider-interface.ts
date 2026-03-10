import type { z } from 'zod'
import type React from 'react'

export type MfaMethodRecord = {
  id: string
  type: string
  userId: string
  providerMetadata?: Record<string, unknown> | null
}

export type MfaVerifyContext = {
  challenge?: Record<string, unknown> | null
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

  setup(userId: string, payload: unknown): Promise<{ setupId: string; clientData: Record<string, unknown> }>
  confirmSetup(userId: string, setupId: string, payload: unknown): Promise<{ metadata: Record<string, unknown> }>
  prepareChallenge(
    userId: string,
    method: MfaMethodRecord,
  ): Promise<{ clientData?: Record<string, unknown>; verifyContext?: MfaVerifyContext }>
  verify(userId: string, method: MfaMethodRecord, payload: unknown, context?: MfaVerifyContext): Promise<boolean>

  SetupComponent?: React.ComponentType<MfaSetupComponentProps>
  VerifyComponent?: React.ComponentType<MfaVerifyComponentProps>
}
