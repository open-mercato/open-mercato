'use client'

import * as React from 'react'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import MfaComplianceBadge from './MfaComplianceBadge'

export type SecurityUserMethod = {
  type: string
  label?: string
  lastUsed?: string
}

export type SecurityUserFormValue = {
  userId: string
  email: string
  enrolled: boolean
  recoveryCodesRemaining: number
  compliant: boolean
  methods: SecurityUserMethod[]
  resetReason: string
}

type SecurityUserFormProps = {
  value: SecurityUserFormValue
  submitting: boolean
  onSubmit: (value: SecurityUserFormValue) => Promise<void> | void
  onCancel: () => void
}

function formatMethodLastUsed(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return fallback
  return parsed.toLocaleString()
}

function UserSummarySection({ value }: { value: SecurityUserFormValue }) {
  const t = useT()
  return (
    <div className="grid gap-2 md:grid-cols-4">
      <div className="rounded border bg-muted/30 px-3 py-2">
        <p className="text-xs text-muted-foreground">{t('security.admin.users.table.email', 'Email')}</p>
        <p className="text-sm font-medium break-all">{value.email}</p>
      </div>
      <div className="rounded border bg-muted/30 px-3 py-2">
        <p className="text-xs text-muted-foreground">{t('security.admin.users.detail.recoveryCodes', 'Recovery codes remaining')}</p>
        <p className="text-sm font-medium">{String(value.recoveryCodesRemaining)}</p>
      </div>
      <div className="rounded border bg-muted/30 px-3 py-2">
        <p className="text-xs text-muted-foreground">{t('security.admin.users.table.compliance', 'Compliance')}</p>
        <div className="pt-1">
          <MfaComplianceBadge enrolled={value.enrolled} compliant={value.compliant} />
        </div>
      </div>
    </div>
  )
}

function MethodsSection({ methods }: { methods: SecurityUserMethod[] }) {
  const t = useT()
  if (!methods.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('security.admin.users.detail.noMethods', 'No active methods.')}
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {methods.map((method, index) => (
        <div key={`${method.type}-${index}`} className="rounded border bg-background px-3 py-2">
          <div className="grid gap-2 md:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">
                {t('security.admin.users.detail.methodType', 'Type')}
              </p>
              <p className="text-sm font-medium">{method.type}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                {t('security.admin.users.detail.methodLabel', 'Label')}
              </p>
              <p className="text-sm font-medium">{method.label ?? '-'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                {t('security.admin.users.detail.methodLastUsed', 'Last used')}
              </p>
              <p className="text-sm font-medium">
                {formatMethodLastUsed(
                  method.lastUsed,
                  t('security.admin.users.lastLogin.unknown', 'Unknown'),
                )}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function SecurityUserForm({
  value,
  submitting,
  onSubmit,
  onCancel,
}: SecurityUserFormProps) {
  const t = useT()
  const formId = 'security-user-form'

  const schema = React.useMemo(
    () => z.object({
      resetReason: z
        .string()
        .trim()
        .min(1, t('security.admin.users.errors.reasonRequired', 'Reset reason is required.')),
    }),
    [t],
  )

  type SecurityUserCrudValues = z.infer<typeof schema>

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'resetReason',
      label: t('security.admin.users.reset.reason', 'Reset reason'),
      type: 'textarea',
      required: true,
      disabled: submitting,
      description: t('security.admin.users.reset.reasonPlaceholder', 'Enter reason for audit trail'),
    },
  ], [submitting, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'summary',
      column: 1,
      component: () => <UserSummarySection value={value} />,
    },
    {
      id: 'methods',
      column: 1,
      component: () => <MethodsSection methods={value.methods} />,
    },
    {
      id: 'reset',
      column: 1,
      fields: ['resetReason'],
    },
  ], [value])

  const handleSubmit = React.useCallback(async (values: SecurityUserCrudValues) => {
    await onSubmit({
      ...value,
      resetReason: values.resetReason.trim(),
    })
  }, [onSubmit, value])

  return (
    <CrudForm<SecurityUserCrudValues>
      title={t('security.admin.users.detail.title', 'User MFA detail')}
      backHref="/backend/security/users"
      schema={schema}
      formId={formId}
      fields={fields}
      groups={groups}
      initialValues={{ resetReason: '' }}
      embedded={false}
      submitLabel={t('security.admin.users.actions.resetMfa', 'Reset MFA')}
      onSubmit={handleSubmit}
      extraActions={(
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          {t('ui.actions.cancel', 'Cancel')}
        </Button>
      )}
    />
  )
}
