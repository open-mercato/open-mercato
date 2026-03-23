'use client'

import * as React from 'react'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { OrganizationSelect } from '@open-mercato/core/modules/directory/components/OrganizationSelect'
import { TenantSelect } from '@open-mercato/core/modules/directory/components/TenantSelect'
import { CrudForm, type CrudCustomFieldRenderProps, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'

export type EnforcementScope = 'platform' | 'tenant' | 'organisation'

export type EnforcementPolicyFormValue = {
  id?: string
  scope: EnforcementScope
  tenantId: string
  organizationId: string
  isEnforced: boolean
  allowedMethods: string[]
  enforcementDeadline: string
}
type EnforcementPolicyFormProps = {
  value?: Partial<EnforcementPolicyFormValue> | null
  submitting: boolean
  onSubmit: (value: EnforcementPolicyFormValue) => Promise<void> | void
  onCancel: () => void
  backHref: string
}

const METHOD_OPTIONS = ['totp', 'passkey', 'otp_email'] as const
const METHOD_OPTION_VALUES = [...METHOD_OPTIONS] as [typeof METHOD_OPTIONS[number], ...typeof METHOD_OPTIONS[number][]]
const METHOD_DESCRIPTION_KEYS: Record<typeof METHOD_OPTIONS[number], { key: string; fallback: string }> = {
  totp: {
    key: 'security.admin.enforcement.methods.totpDescription',
    fallback: 'Authenticator app code (TOTP).',
  },
  passkey: {
    key: 'security.admin.enforcement.methods.passkeyDescription',
    fallback: 'Biometric or security key passkey.',
  },
  otp_email: {
    key: 'security.admin.enforcement.methods.otpEmailDescription',
    fallback: 'One-time verification code sent by email.',
  },
}

function toDatetimeLocal(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''

  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  const hours = String(parsed.getHours()).padStart(2, '0')
  const minutes = String(parsed.getMinutes()).padStart(2, '0')

  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function ScopeTenantField({ value, setValue, values, disabled }: CrudCustomFieldRenderProps) {
  const t = useT()
  const scope = values?.scope
  if (scope !== 'tenant' && scope !== 'organisation') return null

  const normalizedValue = typeof value === 'string' && value.trim().length > 0 ? value : null

  return (
    <TenantSelect
      id="enforcement-tenant-id"
      value={normalizedValue}
      onChange={(next) => setValue(next ?? '')}
      disabled={disabled}
      includeEmptyOption
      emptyOptionLabel={t('security.admin.enforcement.form.tenantPlaceholder', 'Select tenant')}
      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
    />
  )
}

function ScopeOrganizationField({ value, setValue, values, disabled }: CrudCustomFieldRenderProps) {
  const t = useT()
  const scope = values?.scope
  const organizationValue = typeof value === 'string' && value.trim().length > 0 ? value : null
  const tenantId = typeof values?.tenantId === 'string' && values?.tenantId?.trim().length > 0 ? values?.tenantId : null
  const previousTenantRef = React.useRef<string | null>(tenantId)
  const hydratedRef = React.useRef(false)

  React.useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true
      previousTenantRef.current = tenantId
      return
    }
    if (previousTenantRef.current !== tenantId) {
      previousTenantRef.current = tenantId
      setValue('')
    }
  }, [setValue, tenantId])

  if (scope !== 'organisation') return null

  return (
    <OrganizationSelect
      id="enforcement-organization-id"
      value={organizationValue}
      onChange={(next) => setValue(next ?? '')}
      disabled={disabled || !tenantId}
      includeEmptyOption
      emptyOptionLabel={t('security.admin.enforcement.form.organizationPlaceholder', 'Select organization')}
      tenantId={tenantId}
      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
    />
  )
}

function AllowedMethodsField({ value, setValue, disabled }: CrudCustomFieldRenderProps) {
  const t = useT()
  const selectedMethods = React.useMemo(() => {
    if (!Array.isArray(value)) return []
    return value
      .filter((item): item is typeof METHOD_OPTIONS[number] => typeof item === 'string' && METHOD_OPTIONS.includes(item as typeof METHOD_OPTIONS[number]))
  }, [value])
  const [mode, setMode] = React.useState<'all' | 'restricted'>(() => (selectedMethods.length > 0 ? 'restricted' : 'all'))

  React.useEffect(() => {
    setMode(selectedMethods.length > 0 ? 'restricted' : 'all')
  }, [selectedMethods.length])

  const setAllMethods = React.useCallback(() => {
    if (disabled) return
    setMode('all')
    setValue([])
  }, [disabled, setValue])

  const setRestrictedMethods = React.useCallback(() => {
    if (disabled) return
    setMode('restricted')
    if (selectedMethods.length === 0) {
      setValue([METHOD_OPTIONS[0]])
    }
  }, [disabled, selectedMethods.length, setValue])

  const toggleMethod = React.useCallback((method: typeof METHOD_OPTIONS[number], checked: boolean) => {
    if (disabled) return
    if (!checked) {
      if (selectedMethods.length <= 1) return
      setValue(selectedMethods.filter((item) => item !== method))
      return
    }
    if (selectedMethods.includes(method)) return
    setValue([...selectedMethods, method])
  }, [disabled, selectedMethods, setValue])

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === 'all' ? 'default' : 'outline'}
          onClick={setAllMethods}
          disabled={disabled}
        >
          {t('security.admin.enforcement.form.allowedMethodsAll', 'Allow all methods')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === 'restricted' ? 'default' : 'outline'}
          onClick={setRestrictedMethods}
          disabled={disabled}
        >
          {t('security.admin.enforcement.form.allowedMethodsRestricted', 'Restrict to selected methods')}
        </Button>
      </div>

      {mode === 'restricted' ? (
        <div className="space-y-2">
          {METHOD_OPTIONS.map((method) => {
            const isChecked = selectedMethods.includes(method)
            const isLastSelected = isChecked && selectedMethods.length === 1
            return (
              <label
                key={method}
                className="flex items-start gap-3 rounded-md border bg-background px-3 py-2"
              >
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={(checked) => toggleMethod(method, checked === true)}
                  disabled={disabled || isLastSelected}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {t(`security.admin.enforcement.methods.${method}`, method)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(METHOD_DESCRIPTION_KEYS[method].key, METHOD_DESCRIPTION_KEYS[method].fallback)}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t(
            'security.admin.enforcement.form.allowedMethodsHint',
            'If no methods are selected, all available methods are allowed.',
          )}
        </p>
      )}
    </div>
  )
}

export default function EnforcementPolicyForm({
  value,
  backHref,
  submitting = false,
  onSubmit,
  onCancel,
}: EnforcementPolicyFormProps) {
  const t = useT()
  const formId = 'security-enforcement-policy-form'

  const initialValues = React.useMemo<EnforcementPolicyFormValue>(
    () => ({
      id: value?.id,
      scope: value?.scope === 'tenant' || value?.scope === 'organisation' ? value.scope : 'platform',
      tenantId: value?.tenantId ?? '',
      organizationId: value?.organizationId ?? '',
      isEnforced: value?.isEnforced ?? true,
      enforcementDeadline: toDatetimeLocal(value?.enforcementDeadline),
      allowedMethods: Array.isArray(value?.allowedMethods) ? value.allowedMethods : [],
    }),
    [value],
  )
  const [selectedScope, setSelectedScope] = React.useState<EnforcementScope>(initialValues.scope)

  React.useEffect(() => {
    setSelectedScope(initialValues.scope)
  }, [initialValues.scope])

  const schema = React.useMemo(
    () =>
      z
        .object({
          scope: z.enum(['platform', 'tenant', 'organisation']),
          tenantId: z.string().optional().default(''),
          organizationId: z.string().optional().default(''),
          isEnforced: z.boolean().default(true),
          allowedMethods: z.array(z.enum(METHOD_OPTION_VALUES)).default([]),
          enforcementDeadline: z.string().optional().default(''),
        })
        .superRefine((values, context) => {
          const tenantId = values.tenantId.trim()
          const organizationId = values.organizationId.trim()

          if (values.scope !== 'platform' && !tenantId) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: t(
                'security.admin.enforcement.form.errors.tenantRequired',
                'Tenant ID is required for tenant and organisation scopes.',
              ),
              path: ['tenantId'],
            })
          }

          if (values.scope === 'organisation' && !organizationId) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: t(
                'security.admin.enforcement.form.errors.organizationRequired',
                'Organization ID is required for organisation scope.',
              ),
              path: ['organizationId'],
            })
          }
        }),
    [t],
  )

  type EnforcementPolicyCrudValues = z.infer<typeof schema>

  const fields = React.useMemo<CrudField[]>(
    () => {
      const baseFields: CrudField[] = [
        {
          id: 'scope',
          label: t('security.admin.enforcement.form.scope', 'Scope'),
          type: 'custom',
          required: true,
          disabled: submitting,
          layout: 'half',
          component: ({ value, setValue, disabled, autoFocus }) => {
            const resolvedScope = value === 'tenant' || value === 'organisation' ? value : 'platform'
            return (
              <select
                className="w-full h-9 rounded border px-2 text-sm"
                value={resolvedScope}
                onChange={(event) => {
                  const next = event.target.value === 'tenant' || event.target.value === 'organisation'
                    ? event.target.value
                    : 'platform'
                  setValue(next)
                  setSelectedScope(next)
                }}
                autoFocus={autoFocus}
                disabled={disabled}
                data-crud-focus-target=""
              >
                <option value="platform">{t('security.admin.enforcement.scope.platform', 'Platform')}</option>
                <option value="tenant">{t('security.admin.enforcement.scope.tenant', 'Tenant')}</option>
                <option value="organisation">{t('security.admin.enforcement.scope.organisation', 'Organisation')}</option>
              </select>
            )
          },
        },
        {
          id: 'enforcementDeadline',
          label: t('security.admin.enforcement.form.deadline', 'Enforcement deadline'),
          type: 'datetime-local',
          disabled: submitting,
          layout: 'half',
        },
      ]

      if (selectedScope !== 'platform') {
        baseFields.push({
          id: 'tenantId',
          label: t('security.admin.enforcement.form.tenant', 'Tenant'),
          type: 'custom',
          component: ScopeTenantField,
          disabled: submitting,
        })
      }

      if (selectedScope === 'organisation') {
        baseFields.push({
          id: 'organizationId',
          label: t('security.admin.enforcement.form.organization', 'Organization'),
          type: 'custom',
          component: ScopeOrganizationField,
          disabled: submitting,
        })
      }

      baseFields.push(
        {
          id: 'isEnforced',
          label: t('security.admin.enforcement.form.enabled', 'Policy enforced'),
          type: 'checkbox',
          disabled: submitting,
        },
        {
          id: 'allowedMethods',
          label: t('security.admin.enforcement.form.allowedMethods', 'Allowed methods'),
          type: 'custom',
          component: AllowedMethodsField,
          disabled: submitting,
        },
      )

      return baseFields
    },
    [selectedScope, submitting, t],
  )

  const handleSubmit = React.useCallback(
    async (values: EnforcementPolicyCrudValues) => {
      const tenantId = values.tenantId.trim()
      const organizationId = values.organizationId.trim()

      await onSubmit({
        id: value?.id,
        scope: values.scope as EnforcementScope,
        tenantId,
        organizationId,
        isEnforced: values.isEnforced,
        enforcementDeadline: values.enforcementDeadline,
        allowedMethods: values.allowedMethods,
      })
    },
    [onSubmit, value?.id],
  )

  return (
      <CrudForm<EnforcementPolicyCrudValues>
        title={
          value?.id
            ? t('security.admin.enforcement.form.titleEdit', 'Edit enforcement policy')
            : t('security.admin.enforcement.form.titleCreate', 'Create enforcement policy')
        }
        backHref={backHref}
        schema={schema}
        formId={formId}
        fields={fields}
        initialValues={initialValues as Partial<EnforcementPolicyCrudValues>}
        hideFooterActions
        embedded={false}
        onSubmit={handleSubmit}
        extraActions={(
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            {t('ui.actions.cancel', 'Cancel')}
          </Button>
        )}
      />
  )
}
