'use client'

import { z } from 'zod'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ChallengeMethod, SudoTargetType } from '../data/constants'
import { defaultSecurityModuleConfig } from '../lib/security-config'

type TranslateFn = ReturnType<typeof useT>

type SudoFormConfig = {
  defaultTtlSeconds?: number
  maxTtlSeconds?: number
}

export type SudoConfigFormValues = {
  id?: string
  tenantId: string
  organizationId: string
  targetType: SudoTargetType
  targetIdentifier: string
  isEnabled: boolean
  ttlSeconds: number
  challengeMethod: ChallengeMethod
}

export function buildSudoConfigInitialValues(
  value?: Partial<SudoConfigFormValues> | null,
  config?: SudoFormConfig,
): SudoConfigFormValues {
  return {
    id: value?.id,
    tenantId: value?.tenantId ?? '',
    organizationId: value?.organizationId ?? '',
    targetType: value?.targetType ?? SudoTargetType.FEATURE,
    targetIdentifier: value?.targetIdentifier ?? '',
    isEnabled: value?.isEnabled ?? true,
    ttlSeconds: value?.ttlSeconds ?? config?.defaultTtlSeconds ?? defaultSecurityModuleConfig.sudo.defaultTtlSeconds,
    challengeMethod: value?.challengeMethod ?? ChallengeMethod.AUTO,
  }
}

export function createSudoConfigFormSchema(t: TranslateFn, config?: SudoFormConfig) {
  return z.object({
    tenantId: z.string().default(''),
    organizationId: z.string().default(''),
    targetType: z.nativeEnum(SudoTargetType),
    targetIdentifier: z.string().trim().min(1),
    isEnabled: z.boolean().default(true),
    ttlSeconds: z.coerce.number()
      .int()
      .min(defaultSecurityModuleConfig.sudo.minTtlSeconds)
      .max(config?.maxTtlSeconds ?? defaultSecurityModuleConfig.sudo.maxTtlSeconds),
    challengeMethod: z.nativeEnum(ChallengeMethod),
  }).superRefine((values, context) => {
    if (values.organizationId.trim().length > 0 && values.tenantId.trim().length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tenantId'],
        message: t('security.admin.sudo.form.errors.tenantRequired', 'Tenant is required when organization is set.'),
      })
    }
  })
}

export function createSudoConfigFormFields(
  t: TranslateFn,
  options?: { disabled?: boolean },
): CrudField[] {
  const disabled = options?.disabled ?? false

  return [
    {
      id: 'targetType',
      label: t('security.admin.sudo.form.targetType', 'Target type'),
      type: 'select',
      disabled,
      options: [
        { value: SudoTargetType.FEATURE, label: t('security.admin.sudo.targetType.feature', 'Feature') },
        { value: SudoTargetType.ROUTE, label: t('security.admin.sudo.targetType.route', 'Route') },
        { value: SudoTargetType.MODULE, label: t('security.admin.sudo.targetType.module', 'Module') },
        { value: SudoTargetType.PACKAGE, label: t('security.admin.sudo.targetType.package', 'Package') },
      ],
    },
    {
      id: 'targetIdentifier',
      label: t('security.admin.sudo.form.targetIdentifier', 'Target identifier'),
      type: 'text',
      placeholder: t('security.admin.sudo.form.targetIdentifierPlaceholder', 'security.sudo.manage'),
      required: true,
      disabled,
    },
    {
      id: 'tenantId',
      label: t('security.admin.sudo.form.tenantId', 'Tenant ID'),
      type: 'text',
      placeholder: t('security.admin.sudo.form.tenantIdPlaceholder', 'Optional tenant scope'),
      disabled,
    },
    {
      id: 'organizationId',
      label: t('security.admin.sudo.form.organizationId', 'Organization ID'),
      type: 'text',
      placeholder: t('security.admin.sudo.form.organizationIdPlaceholder', 'Optional organization scope'),
      disabled,
    },
    {
      id: 'ttlSeconds',
      label: t('security.admin.sudo.form.ttlSeconds', 'Token TTL (seconds)'),
      type: 'number',
      required: true,
      disabled,
    },
    {
      id: 'challengeMethod',
      label: t('security.admin.sudo.form.challengeMethod', 'Challenge method'),
      type: 'select',
      disabled,
      options: [
        { value: ChallengeMethod.AUTO, label: t('security.admin.sudo.challengeMethod.auto', 'Auto') },
        { value: ChallengeMethod.PASSWORD, label: t('security.admin.sudo.challengeMethod.password', 'Password') },
        { value: ChallengeMethod.MFA, label: t('security.admin.sudo.challengeMethod.mfa', 'MFA only') },
      ],
    },
    {
      id: 'isEnabled',
      label: t('security.admin.sudo.form.isEnabled', 'Enabled'),
      type: 'checkbox',
      disabled,
    },
  ]
}

export function buildSudoConfigPayload(values: SudoConfigFormValues) {
  const tenantId = values.tenantId.trim()
  const organizationId = values.organizationId.trim()

  return {
    tenantId: tenantId || null,
    organizationId: organizationId || null,
    targetType: values.targetType,
    targetIdentifier: values.targetIdentifier.trim(),
    isEnabled: values.isEnabled,
    ttlSeconds: values.ttlSeconds,
    challengeMethod: values.challengeMethod,
  }
}
