"use client"
import * as React from 'react'
import { E } from '#generated/entities.ids.generated'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup, type CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { OrganizationSelect } from '@open-mercato/core/modules/directory/components/OrganizationSelect'
import { TenantSelect } from '@open-mercato/core/modules/directory/components/TenantSelect'
import { fetchRoleOptions } from '@open-mercato/core/modules/auth/backend/users/roleOptions'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { RadioGroup } from '@open-mercato/ui/primitives/radio'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatPasswordRequirements, getPasswordPolicy } from '@open-mercato/shared/lib/auth/passwordPolicy'

type CreateUserFormValues = {
  email: string
  password: string
  tenantId: string | null
  organizationId: string | null
  roles: string[]
} & Record<string, unknown>

type UserListResponse = {
  isSuperAdmin?: boolean
}

type WidgetCatalogResponse = {
  items?: Array<{ id?: string | null; title?: string | null; description?: string | null }>
}

type TenantAwareOrganizationSelectProps = {
  fieldId: string
  value: string | null
  setValue: (value: string | null) => void
  tenantId: string | null
  includeInactiveIds?: Iterable<string | null | undefined>
}

function TenantAwareOrganizationSelectInput({
  fieldId,
  value,
  setValue,
  tenantId,
  includeInactiveIds,
}: TenantAwareOrganizationSelectProps) {
  const prevTenantRef = React.useRef<string | null>(tenantId)
  const hydratedRef = React.useRef(false)
  const handleChange = React.useCallback((next: string | null) => {
    setValue(next ?? null)
  }, [setValue])

  React.useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true
      prevTenantRef.current = tenantId
      return
    }
    if (prevTenantRef.current !== tenantId) {
      prevTenantRef.current = tenantId
      setValue(null)
    }
  }, [tenantId, setValue])

  return (
    <OrganizationSelect
      id={fieldId}
      value={value}
      onChange={handleChange}
      required
      includeEmptyOption
      className="w-full h-9 rounded border px-2 text-sm"
      tenantId={tenantId}
      includeInactiveIds={includeInactiveIds}
    />
  )
}

export default function CreateUserPage() {
  const t = useT()
  const [widgetCatalog, setWidgetCatalog] = React.useState<Array<{ id: string; title: string; description: string | null }>>([])
  const [widgetLoading, setWidgetLoading] = React.useState(true)
  const [widgetError, setWidgetError] = React.useState<string | null>(null)
  const [widgetMode, setWidgetMode] = React.useState<'inherit' | 'override'>('inherit')
  const [selectedWidgets, setSelectedWidgets] = React.useState<string[]>([])
  const [selectedTenantId, setSelectedTenantId] = React.useState<string | null>(null)
  const [actorIsSuperAdmin, setActorIsSuperAdmin] = React.useState(false)
  const [actorResolved, setActorResolved] = React.useState(false)
  const [sendInviteEmail, setSendInviteEmail] = React.useState(false)
  const passwordPolicy = React.useMemo(() => getPasswordPolicy(), [])
  const passwordRequirements = React.useMemo(
    () => formatPasswordRequirements(passwordPolicy, t),
    [passwordPolicy, t],
  )
  const passwordDescription = React.useMemo(() => (
    passwordRequirements
      ? t('auth.password.requirements.help', 'Password requirements: {requirements}', { requirements: passwordRequirements })
      : undefined
  ), [passwordRequirements, t])

  React.useEffect(() => {
    let cancelled = false
    async function loadCatalog() {
      setWidgetLoading(true)
      setWidgetError(null)
      try {
        const { ok, result } = await apiCall<WidgetCatalogResponse>('/api/dashboards/widgets/catalog')
        if (!ok) throw new Error('request_failed')
        if (!cancelled) {
          const rawItems: unknown[] = Array.isArray(result?.items) ? result?.items ?? [] : []
          const normalized = rawItems
            .map((item: unknown) => {
              if (!item || typeof item !== 'object') return null
              const entry = item as Record<string, unknown>
              const idValue = entry.id
              const titleValue = entry.title
              const descriptionValue = entry.description
              const id = typeof idValue === 'string' ? idValue : null
              if (!id || !id.length) return null
              const title = typeof titleValue === 'string' && titleValue.length > 0 ? titleValue : id
              const description = typeof descriptionValue === 'string' && descriptionValue.length > 0 ? descriptionValue : null
              return { id, title, description }
            })
            .filter((item): item is { id: string; title: string; description: string | null } => item !== null)
          setWidgetCatalog(normalized)
        }
      } catch (err) {
        console.error('Failed to load dashboard widget catalog', err)
        if (!cancelled) {
          setWidgetError(t(
            'auth.users.widgets.errors.load',
            'Unable to load dashboard widgets. You can configure them later from the user page.',
          ))
        }
      } finally {
        if (!cancelled) setWidgetLoading(false)
      }
    }
    loadCatalog()
    return () => { cancelled = true }
  }, [t])

  React.useEffect(() => {
    let cancelled = false
    async function loadActor() {
      try {
        const { ok, result } = await apiCall<UserListResponse>('/api/auth/users?page=1&pageSize=1')
        if (!cancelled && ok) setActorIsSuperAdmin(Boolean(result?.isSuperAdmin))
      } catch (err) {
        console.error('Failed to resolve actor super admin flag', err)
      } finally {
        if (!cancelled) setActorResolved(true)
      }
    }
    loadActor()
    return () => { cancelled = true }
  }, [])

  const toggleWidget = React.useCallback((id: string) => {
    setSelectedWidgets((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]))
  }, [])

  // Block role loading until we know whether the actor is a super admin. Without this guard the
  // initial (non-super-admin) branch fires before the flag resolves and the server returns roles
  // from other tenants because the real caller is a super admin without tenantId scoping.
  const loadRoleOptions = React.useCallback(async (query?: string): Promise<CrudFieldOption[]> => {
    if (!actorResolved) return []
    if (actorIsSuperAdmin) {
      if (!selectedTenantId) return []
      return fetchRoleOptions(query, { tenantId: selectedTenantId })
    }
    return fetchRoleOptions(query)
  }, [actorIsSuperAdmin, actorResolved, selectedTenantId])

  const fields: CrudField[] = React.useMemo(() => {
    const items: CrudField[] = [
      { id: 'email', label: t('auth.users.form.field.email', 'Email'), type: 'text', required: true },
      {
        id: 'sendInviteEmail',
        label: t('auth.users.form.field.sendInviteEmail', 'Send password setup link via email'),
        type: 'custom',
        component: () => (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={sendInviteEmail}
              onChange={(e) => setSendInviteEmail(e.target.checked)}
            />
            {t('auth.users.form.field.sendInviteEmailHint', 'Invite user to set their own password via a secure email link')}
          </label>
        ),
      },
      ...(!sendInviteEmail ? [{
        id: 'password',
        label: t('auth.users.form.field.password', 'Password'),
        type: 'password' as const,
        required: true,
        description: passwordDescription,
      }] : []),
    ]
    if (actorIsSuperAdmin) {
      items.push({
        id: 'tenantId',
        label: t('auth.users.form.field.tenant', 'Tenant'),
        type: 'custom',
        required: true,
        component: ({ value, setValue }) => {
          const normalizedValue = typeof value === 'string'
            ? value
            : (typeof selectedTenantId === 'string' ? selectedTenantId : null)
          return (
            <TenantSelect
              id="tenantId"
              value={normalizedValue}
              onChange={(next) => {
                const resolved = next ?? null
                setValue(resolved)
                setSelectedTenantId(resolved)
              }}
              includeEmptyOption
              className="w-full h-9 rounded border px-2 text-sm"
              required
            />
          )
        },
      })
    }
    items.push({
      id: 'organizationId',
      label: t('auth.users.form.field.organization', 'Organization'),
      type: 'custom',
      required: true,
      component: ({ id, value, setValue }) => {
        const normalizedValue = typeof value === 'string' ? value : null
        return (
          <TenantAwareOrganizationSelectInput
            fieldId={id}
            value={normalizedValue}
            setValue={(next) => setValue(next ?? null)}
            tenantId={selectedTenantId}
          />
        )
      },
    })
    items.push({ id: 'roles', label: t('auth.users.form.field.roles', 'Roles'), type: 'tags', loadOptions: loadRoleOptions })
    return items
  }, [actorIsSuperAdmin, loadRoleOptions, passwordDescription, selectedTenantId, sendInviteEmail, t])

  const detailFieldIds = React.useMemo(() => {
    const base: string[] = sendInviteEmail
      ? ['email', 'sendInviteEmail', 'organizationId', 'roles']
      : ['email', 'sendInviteEmail', 'password', 'organizationId', 'roles']
    if (actorIsSuperAdmin) {
      const orgIdx = base.indexOf('organizationId')
      base.splice(orgIdx, 0, 'tenantId')
    }
    return base
  }, [actorIsSuperAdmin, sendInviteEmail])

  const groups: CrudFormGroup[] = React.useMemo(() => [
    { id: 'details', title: t('auth.users.form.group.details', 'Details'), column: 1, fields: detailFieldIds },
    {
      id: 'acl',
      title: t('auth.users.form.group.access', 'Access'),
      column: 1,
      component: () => (
        <div className="text-sm text-muted-foreground">
          {t('auth.users.form.aclHint', 'ACL can be edited after creating the user.')}
        </div>
      ),
    },
    { id: 'custom', title: t('auth.users.form.group.customFields', 'Custom Data'), column: 2, kind: 'customFields' },
    {
      id: 'dashboardWidgets',
      title: t('auth.users.form.group.widgets', 'Dashboard Widgets'),
      column: 2,
      component: () => (
        <DashboardWidgetSelector
          catalog={widgetCatalog}
          loading={widgetLoading}
          error={widgetError}
          mode={widgetMode}
          onModeChange={setWidgetMode}
          selected={selectedWidgets}
          onToggle={toggleWidget}
        />
      ),
    },
  ], [detailFieldIds, t, widgetCatalog, widgetError, widgetLoading, widgetMode, selectedWidgets, toggleWidget])

  const initialValues = React.useMemo<Partial<CreateUserFormValues>>(
    () => ({
      email: '',
      password: '',
      tenantId: null,
      organizationId: null,
      roles: [],
    }),
    [],
  )

  return (
    <Page>
      <PageBody>
        <CrudForm<CreateUserFormValues>
          title={t('auth.users.form.title.create', 'Create User')}
          backHref="/backend/users"
          fields={fields}
          groups={groups}
          entityId={E.auth.user}
          initialValues={initialValues}
          submitLabel={t('auth.users.form.action.create', 'Create')}
          cancelHref="/backend/users"
          successRedirect={`/backend/users?flash=${encodeURIComponent(
            sendInviteEmail
              ? t('auth.users.flash.createdWithInvite', 'User created and invitation sent')
              : t('auth.users.flash.created', 'User created')
          )}&type=success`}
          onSubmit={async (values) => {
            const customFields = collectCustomFieldValues(values)
            const payload: Record<string, unknown> = {
              email: values.email,
              organizationId: values.organizationId ? values.organizationId : null,
              roles: Array.isArray(values.roles) ? values.roles : [],
              ...(Object.keys(customFields).length ? { customFields } : {}),
            }
            if (sendInviteEmail) {
              payload.sendInviteEmail = true
            } else {
              payload.password = values.password
            }
            if (actorIsSuperAdmin) {
              const rawTenant = typeof values.tenantId === 'string' ? values.tenantId.trim() : null
              payload.tenantId = rawTenant && rawTenant.length ? rawTenant : null
            }
            const { result: created } = await createCrud<{ id?: string; _warning?: string }>('auth/users', payload)
            const newUserId = typeof created?.id === 'string' ? created.id : null
            if (created?._warning === 'invite_email_failed') {
              const msg = t('auth.users.flash.createdEmailFailed', 'User created but invitation email could not be sent. You can resend it from the user page.')
              window.location.href = `/backend/users?flash=${encodeURIComponent(msg)}&type=warning`
              return
            }

            if (widgetMode === 'override' && newUserId) {
              await updateCrud('dashboards/users/widgets', {
                userId: newUserId,
                mode: 'override',
                widgetIds: selectedWidgets,
                organizationId: values.organizationId ? values.organizationId : null,
                tenantId: actorIsSuperAdmin
                  ? (typeof values.tenantId === 'string' && values.tenantId.length ? values.tenantId : null)
                  : null,
              }, {
                errorMessage: t('auth.users.form.errors.widgetsAssign', 'Failed to assign dashboard widgets to the new user'),
              })
            }
          }}
        />
      </PageBody>
    </Page>
  )
}

function DashboardWidgetSelector({
  catalog,
  loading,
  error,
  mode,
  onModeChange,
  selected,
  onToggle,
}: {
  catalog: Array<{ id: string; title: string; description: string | null }>
  loading: boolean
  error: string | null
  mode: 'inherit' | 'override'
  onModeChange: (mode: 'inherit' | 'override') => void
  selected: string[]
  onToggle: (id: string) => void
}) {
  const t = useT()
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner size="sm" /> {t('auth.users.widgets.loading', 'Loading widgets…')}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}
      {!error && (
        <>
          <RadioGroup
            className="flex flex-row items-center gap-3 rounded-md border bg-muted/30 px-3 py-2"
            value={mode}
            onValueChange={(next) => onModeChange(next as 'inherit' | 'override')}
          >
            <RadioField
              value="inherit"
              label={t('auth.users.widgets.mode.inherit', 'Inherit from roles')}
            />
            <RadioField
              value="override"
              label={t('auth.users.widgets.mode.override', 'Override for this user')}
            />
          </RadioGroup>
          {mode === 'override' && (
            <div className="space-y-2">
              {catalog.map((widget) => (
                <label key={widget.id} className="flex items-start gap-3 rounded-md border px-3 py-2 hover:border-primary/40">
                  <input
                    type="checkbox"
                    className="mt-1 size-4"
                    checked={selected.includes(widget.id)}
                    onChange={() => onToggle(widget.id)}
                  />
                  <div>
                    <div className="text-sm font-medium leading-none">{widget.title}</div>
                    {widget.description ? <div className="text-xs text-muted-foreground">{widget.description}</div> : null}
                  </div>
                </label>
              ))}
            </div>
          )}
          {mode === 'inherit' && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {t('auth.users.widgets.mode.hint', 'New users inherit widgets from their assigned roles. Override to pick a custom set.')}
            </div>
          )}
        </>
      )}
    </div>
  )
}
