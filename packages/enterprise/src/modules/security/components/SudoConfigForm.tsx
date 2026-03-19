'use client'

import * as React from 'react'
import { z } from 'zod'
import type { CrudCustomFieldRenderProps, CrudField } from '@open-mercato/ui/backend/CrudForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TenantSelect } from '@open-mercato/core/modules/directory/components/TenantSelect'
import { OrganizationSelect } from '@open-mercato/core/modules/directory/components/OrganizationSelect'
import { ChallengeMethod } from '../data/constants'
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
  label: string
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
    label: value?.label ?? '',
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
    label: z.string().max(200).default(''),
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

function SudoTenantField({ value, setValue, disabled }: CrudCustomFieldRenderProps) {
  const t = useT()
  const normalized = typeof value === 'string' && value.trim().length > 0 ? value : null
  return (
    <TenantSelect
      id="sudo-config-tenant-id"
      value={normalized}
      onChange={(next) => setValue(next ?? '')}
      disabled={disabled}
      includeEmptyOption
      emptyOptionLabel={t('security.admin.sudo.form.tenantPlaceholder', 'Any tenant (platform-wide)')}
      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
    />
  )
}

function SudoOrganizationField({ value, setValue, values, disabled }: CrudCustomFieldRenderProps) {
  const t = useT()
  const tenantId = typeof values?.tenantId === 'string' && values.tenantId.trim().length > 0
    ? values.tenantId : null
  const normalized = typeof value === 'string' && value.trim().length > 0 ? value : null
  const prevTenantRef = React.useRef<string | null>(tenantId)
  const hydratedRef = React.useRef(false)

  React.useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true
      prevTenantRef.current = tenantId
      return
    }
    if (prevTenantRef.current !== tenantId) {
      prevTenantRef.current = tenantId
      setValue('')
    }
  }, [setValue, tenantId])

  return (
    <OrganizationSelect
      id="sudo-config-organization-id"
      value={normalized}
      onChange={(next) => setValue(next ?? '')}
      disabled={disabled || !tenantId}
      includeEmptyOption
      emptyOptionLabel={t('security.admin.sudo.form.organizationPlaceholder', 'Any organization')}
      tenantId={tenantId}
      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
    />
  )
}

export function createSudoConfigFormFields(
  t: TranslateFn,
  options?: { disabled?: boolean },
): CrudField[] {
  const disabled = options?.disabled ?? false

  return [
    {
      id: 'targetIdentifier',
      label: t('security.admin.sudo.form.targetIdentifier', 'Target identifier'),
      type: 'text',
      required: true,
      disabled,
    },
    {
      id: 'label',
      label: t('security.admin.sudo.form.label', 'Label (optional)'),
      type: 'text',
      disabled,
    },
    {
      id: 'tenantId',
      label: t('security.admin.sudo.form.tenantId', 'Tenant'),
      type: 'custom',
      disabled,
      component: SudoTenantField,
    },
    {
      id: 'organizationId',
      label: t('security.admin.sudo.form.organizationId', 'Organization'),
      type: 'custom',
      disabled,
      component: SudoOrganizationField,
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
    label: values.label.trim() || null,
    targetIdentifier: values.targetIdentifier.trim(),
    isEnabled: values.isEnabled,
    ttlSeconds: values.ttlSeconds,
    challengeMethod: values.challengeMethod,
  }
}
