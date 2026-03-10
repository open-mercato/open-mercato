'use client'

import * as React from 'react'
import { z } from 'zod'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { ChallengeMethod, SudoTargetType } from '../data/constants'

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

type SudoConfigFormProps = {
  value?: Partial<SudoConfigFormValues> | null
  submitting: boolean
  onSubmit: (value: SudoConfigFormValues) => Promise<void> | void
  onCancel: () => void
}

export default function SudoConfigForm({
  value,
  submitting,
  onSubmit,
  onCancel,
}: SudoConfigFormProps) {
  const t = useT()

  const initialValues = React.useMemo<SudoConfigFormValues>(() => ({
    id: value?.id,
    tenantId: value?.tenantId ?? '',
    organizationId: value?.organizationId ?? '',
    targetType: value?.targetType ?? SudoTargetType.FEATURE,
    targetIdentifier: value?.targetIdentifier ?? '',
    isEnabled: value?.isEnabled ?? true,
    ttlSeconds: value?.ttlSeconds ?? 300,
    challengeMethod: value?.challengeMethod ?? ChallengeMethod.AUTO,
  }), [value])

  const schema = React.useMemo(() => z.object({
    tenantId: z.string().default(''),
    organizationId: z.string().default(''),
    targetType: z.nativeEnum(SudoTargetType),
    targetIdentifier: z.string().min(1),
    isEnabled: z.boolean().default(true),
    ttlSeconds: z.coerce.number().int().min(30).max(1800),
    challengeMethod: z.nativeEnum(ChallengeMethod),
  }).superRefine((values, context) => {
    if (values.organizationId.trim().length > 0 && values.tenantId.trim().length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tenantId'],
        message: t('security.admin.sudo.form.errors.tenantRequired', 'Tenant is required when organization is set.'),
      })
    }
  }), [t])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'targetType',
      label: t('security.admin.sudo.form.targetType', 'Target type'),
      type: 'select',
      disabled: submitting,
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
      disabled: submitting,
    },
    {
      id: 'tenantId',
      label: t('security.admin.sudo.form.tenantId', 'Tenant ID'),
      type: 'text',
      placeholder: t('security.admin.sudo.form.tenantIdPlaceholder', 'Optional tenant scope'),
      disabled: submitting,
    },
    {
      id: 'organizationId',
      label: t('security.admin.sudo.form.organizationId', 'Organization ID'),
      type: 'text',
      placeholder: t('security.admin.sudo.form.organizationIdPlaceholder', 'Optional organization scope'),
      disabled: submitting,
    },
    {
      id: 'ttlSeconds',
      label: t('security.admin.sudo.form.ttlSeconds', 'Token TTL (seconds)'),
      type: 'number',
      min: 30,
      max: 1800,
      required: true,
      disabled: submitting,
    },
    {
      id: 'challengeMethod',
      label: t('security.admin.sudo.form.challengeMethod', 'Challenge method'),
      type: 'select',
      disabled: submitting,
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
      disabled: submitting,
    },
  ], [submitting, t])

  return (
    <CrudForm<SudoConfigFormValues>
      embedded
      title={t('security.admin.sudo.form.title', 'Sudo rule')}
      initialValues={initialValues}
      fields={fields}
      submitLabel={t('ui.actions.save', 'Save')}
      extraActions={(
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          {t('ui.actions.cancel', 'Cancel')}
        </Button>
      )}
      onSubmit={async (values) => {
        const parsed = schema.parse({
          ...values,
          ttlSeconds: Number(values.ttlSeconds),
        })
        await onSubmit({
          id: initialValues.id,
          tenantId: parsed.tenantId,
          organizationId: parsed.organizationId,
          targetType: parsed.targetType,
          targetIdentifier: parsed.targetIdentifier,
          isEnabled: parsed.isEnabled,
          ttlSeconds: parsed.ttlSeconds,
          challengeMethod: parsed.challengeMethod,
        })
      }}
    />
  )
}
