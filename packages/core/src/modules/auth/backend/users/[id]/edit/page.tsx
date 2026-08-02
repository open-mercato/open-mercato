"use client"
import * as React from 'react'
import { usePathname } from 'next/navigation'
import { E } from '#generated/entities.ids.generated'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup, type CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { AclEditor, type AclData } from '@open-mercato/core/modules/auth/components/AclEditor'
import { OrganizationSelect } from '@open-mercato/core/modules/directory/components/OrganizationSelect'
import { TenantSelect } from '@open-mercato/core/modules/directory/components/TenantSelect'
import { fetchRoleOptions } from '@open-mercato/core/modules/auth/backend/users/roleOptions'
import { WidgetVisibilityEditor, type WidgetVisibilityEditorHandle } from '@open-mercato/core/modules/dashboards/components/WidgetVisibilityEditor'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { extractCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields-client'
import { formatPasswordRequirements, getPasswordPolicy } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { UserConsentsPanel } from '@open-mercato/core/modules/auth/components/UserConsentsPanel'
import { RecordNotFoundState, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { buildRecordInjectionContext, useSetCurrentRecordInjectionContext } from '@open-mercato/ui/backend/injection/recordContext'
import { normalizeDisplayNameInput } from '@open-mercato/core/modules/auth/lib/displayName'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('auth').child({ component: 'users-edit-page' })

type EditUserFormValues = {
  email: string
  name: string
  password: string
  tenantId: string | null
  organizationId: string | null
  roles: string[]
  updatedAt?: string | null
} & Record<string, unknown>

type LoadedUser = {
  id: string
  email: string
  name: string | null
  organizationId: string | null
  tenantId: string | null
  tenantName: string | null
  organizationName: string | null
  roles: string[]
  roleIds: string[]
  hasPassword: boolean
  updatedAt: string | null
}

type UserApiItem = {
  id?: string | null
  email?: string | null
  name?: string | null
  organizationId?: string | null
  tenantId?: string | null
  tenantName?: string | null
  organizationName?: string | null
  roles?: unknown
  roleIds?: unknown
  hasPassword?: boolean
  updatedAt?: string | null
  updated_at?: string | null
}

type UserListResponse = {
  items?: UserApiItem[]
  isSuperAdmin?: boolean
}

type RoleLookupResponse = {
  items?: Array<{ id?: string | null; name?: string | null }>
}

type FeatureCheckResponse = {
  ok?: boolean
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
      className="w-full h-9 rounded border pl-2 pr-7 text-sm truncate"
      includeInactiveIds={includeInactiveIds}
      tenantId={tenantId}
    />
  )
}

export default function EditUserPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const pathname = usePathname()
  const tRef = React.useRef(t)
  tRef.current = t
  const [initialUser, setInitialUser] = React.useState<LoadedUser | null>(null)
  const [selectedTenantId, setSelectedTenantId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const [canEditOrgs, setCanEditOrgs] = React.useState(false)
  const [aclData, setAclData] = React.useState<AclData>({ isSuperAdmin: false, features: [], organizations: null })
  const [aclUpdatedAt, setAclUpdatedAt] = React.useState<string | null>(null)
  const [customFieldValues, setCustomFieldValues] = React.useState<Record<string, unknown>>({})
  const [actorIsSuperAdmin, setActorIsSuperAdmin] = React.useState(false)
  const [actorResolved, setActorResolved] = React.useState(false)
  const [initialRoleOptions, setInitialRoleOptions] = React.useState<CrudFieldOption[]>([])
  const widgetEditorRef = React.useRef<WidgetVisibilityEditorHandle | null>(null)
  const [resendingInvite, setResendingInvite] = React.useState(false)

  const handleResendInvite = React.useCallback(async () => {
    if (!id) return
    setResendingInvite(true)
    try {
      const { ok, result } = await apiCall<{ ok?: boolean; warning?: string }>('/api/auth/users/resend-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (ok) {
        if (result?.warning === 'invite_email_failed') {
          flash(tRef.current('auth.users.flash.inviteEmailFailed', 'Invite token created but the email could not be sent. Please check your email provider configuration.'), 'warning')
        } else {
          flash(tRef.current('auth.users.flash.inviteSent', 'Invitation email sent'), 'success')
        }
      }
    } catch (err) {
      logger.error('Failed to resend invite', { err })
      flash(tRef.current('auth.users.form.errors.inviteResend', 'Failed to send invitation email'), 'error')
    } finally {
      setResendingInvite(false)
    }
  }, [id])
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
    if (!initialUser) {
      setInitialRoleOptions([])
      return
    }
    const roleIds = initialUser.roleIds
      .map((roleId) => (typeof roleId === 'string' ? roleId.trim() : ''))
      .filter((roleId) => roleId.length > 0)
    const seedOptions = roleIds.map((roleId, index) => {
      const label = typeof initialUser.roles[index] === 'string' && initialUser.roles[index].trim().length
        ? initialUser.roles[index]
        : roleId
      return { value: roleId, label }
    })
    setInitialRoleOptions(seedOptions)
    if (!roleIds.length) return
    let cancelled = false
    Promise.all(roleIds.map(async (roleId) => {
      const response = await apiCall<RoleLookupResponse>(
        `/api/auth/roles?id=${encodeURIComponent(roleId)}&page=1&pageSize=1`,
        undefined,
        { fallback: { items: [] } },
      )
      if (!response.ok || !Array.isArray(response.result?.items)) return null
      const item = response.result.items.find((entry) => entry?.id === roleId) ?? response.result.items[0]
      const name = typeof item?.name === 'string' && item.name.trim().length ? item.name.trim() : null
      return name ? { value: roleId, label: name } : null
    }))
      .then((fetched) => {
        if (cancelled) return
        const byId = new Map(seedOptions.map((option) => [option.value, option]))
        fetched.forEach((option) => {
          if (option) byId.set(option.value, option)
        })
        setInitialRoleOptions(roleIds.map((roleId) => byId.get(roleId) ?? { value: roleId, label: roleId }))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [initialUser])

  React.useEffect(() => {
    if (!id) {
      setLoading(false)
      setError(tRef.current('auth.users.form.errors.noId', 'No user ID provided'))
      return
    }
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      setCustomFieldValues({})
      try {
        const { ok, result } = await apiCall<UserListResponse>(
          `/api/auth/users?id=${encodeURIComponent(String(id))}&page=1&pageSize=1`,
        )
        if (!ok) throw new Error(tRef.current('auth.users.form.errors.load', 'Failed to load user data'))
        const item = Array.isArray(result?.items) ? result?.items?.[0] : undefined
        if (!cancelled) {
          setActorIsSuperAdmin(Boolean(result?.isSuperAdmin))
          setActorResolved(true)
          if (!item) {
            setIsNotFound(true)
            setCustomFieldValues({})
            setInitialUser(null)
            setSelectedTenantId(null)
          } else {
            const roleNames = Array.isArray(item.roles)
              ? item.roles
                  .map((role) => (typeof role === 'string' ? role : role == null ? '' : String(role)))
                  .filter((role) => role.trim().length > 0)
              : []
            const roleIds = Array.isArray(item.roleIds)
              ? (item.roleIds as string[]).filter((rid) => typeof rid === 'string' && rid.trim().length > 0)
              : []
            setInitialUser({
              id: item.id ? String(item.id) : String(id),
              email: item.email ? String(item.email) : '',
              name: item.name ? String(item.name) : null,
              organizationId: item.organizationId ? String(item.organizationId) : null,
              tenantId: item.tenantId ? String(item.tenantId) : null,
              tenantName: item.tenantName ? String(item.tenantName) : null,
              organizationName: item.organizationName ? String(item.organizationName) : null,
              roles: roleNames,
              roleIds: roleIds.length > 0 ? roleIds : roleNames,
              hasPassword: item.hasPassword !== false,
              updatedAt: typeof item.updatedAt === 'string'
                ? item.updatedAt
                : typeof item.updated_at === 'string'
                  ? item.updated_at
                  : null,
            })
            setSelectedTenantId(item.tenantId ? String(item.tenantId) : null)
            const custom = extractCustomFieldEntries(item as Record<string, unknown>)
            setCustomFieldValues(custom)
          }
        }
      } catch (err) {
        logger.error('Failed to load user', { err })
        if (!cancelled) setError(tRef.current('auth.users.form.errors.load', 'Failed to load user data'))
        if (!cancelled) setCustomFieldValues({})
        if (!cancelled) setActorResolved(true)
      }
      if (!cancelled) setLoading(false)
      try {
        const featureCheck = await apiCall<FeatureCheckResponse>(
          '/api/auth/feature-check',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ features: ['directory.organizations.view'] }),
          },
          { fallback: { ok: false } },
        )
        if (!cancelled) setCanEditOrgs(Boolean(featureCheck.result?.ok))
      } catch (err) {
        logger.error('Failed to check features', { err })
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  const selectedOrgId = initialUser?.organizationId ? String(initialUser.organizationId) : null
  const preloadedTenants = React.useMemo(() => {
    if (!selectedTenantId) return null
    const name = initialUser?.tenantId === selectedTenantId
      ? (initialUser?.tenantName ?? selectedTenantId)
      : selectedTenantId
    return [{ id: selectedTenantId, name, isActive: true }]
  }, [initialUser, selectedTenantId])

  // Block role loading until we know whether the actor is a super admin. Without this guard the
  // initial (non-super-admin) branch fires before the flag resolves and the server returns roles
  // from other tenants because the real caller is a super admin without tenantId scoping.
  const loadRoleOptions = React.useCallback(async (query?: string): Promise<CrudFieldOption[]> => {
    if (!actorResolved) return []
    if (actorIsSuperAdmin) {
      if (!selectedTenantId) return []
      return fetchRoleOptions(query, { tenantId: selectedTenantId, includeSuperAdmin: true })
    }
    return fetchRoleOptions(query)
  }, [actorIsSuperAdmin, actorResolved, selectedTenantId])

  const userHasPassword = initialUser?.hasPassword !== false
  const fields: CrudField[] = React.useMemo(() => {
    const items: CrudField[] = [
      { id: 'email', label: t('auth.users.form.field.email', 'Email'), type: 'text', required: true },
      { id: 'name', label: t('auth.users.form.field.name', 'Display name'), type: 'text' },
      {
        id: 'password',
        label: userHasPassword
          ? t('auth.users.form.field.newPassword', 'New Password')
          : t('auth.users.form.field.setPassword', 'Set Password'),
        type: 'password' as const,
        description: [
          userHasPassword
            ? t('auth.users.form.field.passwordChangeHint', 'Leave blank to keep current password')
            : t('auth.users.form.field.passwordInviteHint', 'Optionally set a password for this user (they were invited via email)'),
          passwordDescription,
        ].filter(Boolean).join('. '),
      },
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
                setAclData({ isSuperAdmin: false, features: [], organizations: null })
              }}
              includeEmptyOption
              className="w-full h-9 rounded border pl-2 pr-7 text-sm truncate"
              required
              tenants={preloadedTenants}
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
        const normalizedValue = typeof value === 'string' ? (value.length > 0 ? value : null) : null
        return (
          <TenantAwareOrganizationSelectInput
            fieldId={id}
            value={normalizedValue}
            setValue={(next) => setValue(next ?? null)}
            tenantId={selectedTenantId}
            includeInactiveIds={selectedOrgId ? [selectedOrgId] : undefined}
          />
        )
      },
    })
    items.push({
      id: 'roles',
      label: t('auth.users.form.field.roles', 'Roles'),
      type: 'tags',
      options: initialRoleOptions,
      loadOptions: loadRoleOptions,
    })
    return items
  }, [actorIsSuperAdmin, initialRoleOptions, loadRoleOptions, passwordDescription, preloadedTenants, selectedOrgId, selectedTenantId, t, userHasPassword])

  const detailFieldIds = React.useMemo(() => {
    const base: string[] = ['email', 'name', 'password', 'organizationId', 'roles']
    if (actorIsSuperAdmin) base.splice(2, 0, 'tenantId')
    return base
  }, [actorIsSuperAdmin])

  const groups: CrudFormGroup[] = React.useMemo(() => [
    { id: 'details', title: t('auth.users.form.group.details', 'Details'), column: 1, fields: detailFieldIds },
    { id: 'custom', title: t('auth.users.form.group.customFields', 'Custom Data'), column: 2, kind: 'customFields' },
    {
      id: 'acl',
      title: t('auth.users.form.group.access', 'Access'),
      column: 1,
      component: () => (id
        ? (
          <AclEditor
            kind="user"
            targetId={String(id)}
            canEditOrganizations={canEditOrgs}
            value={aclData}
            onChange={setAclData}
            onVersionChange={setAclUpdatedAt}
            userRoles={initialUser?.roles || []}
            currentUserIsSuperAdmin={actorIsSuperAdmin}
            tenantId={selectedTenantId ?? null}
          />
        )
        : null),
    },
    {
      id: 'dashboardWidgets',
      title: t('auth.users.form.group.widgets', 'Dashboard Widgets'),
      column: 2,
      component: () => (id && initialUser
        ? (
          <WidgetVisibilityEditor
            kind="user"
            targetId={String(id)}
            tenantId={selectedTenantId ?? null}
            organizationId={initialUser?.organizationId ?? null}
            ref={widgetEditorRef}
          />
        ) : null
      ),
    },
    {
      id: 'consents',
      title: t('auth.users.form.group.consents', 'Consents'),
      column: 2,
      component: () => (id ? <UserConsentsPanel userId={String(id)} /> : null),
    },
  ], [aclData, actorIsSuperAdmin, canEditOrgs, detailFieldIds, id, initialUser, selectedTenantId, t])

  const initialValues = React.useMemo(() => {
    if (initialUser) {
      return {
        email: initialUser.email,
        name: initialUser.name ?? '',
        password: '',
        tenantId: initialUser.tenantId,
        organizationId: initialUser.organizationId,
        roles: initialUser.roleIds,
        updatedAt: initialUser.updatedAt,
        ...customFieldValues,
      }
    }
    return {
      email: '',
      name: '',
      password: '',
      tenantId: selectedTenantId ?? null,
      organizationId: null,
      roles: [],
      ...customFieldValues,
    }
  }, [initialUser, customFieldValues, selectedTenantId])

  // Publish page-load record context to the AppShell-owned `backend:record:current`
  // mount so the enterprise record_locks widget resolves `auth.user` + id explicitly.
  // The resourceKind mirrors the CrudForm `versionHistory` so the held lock matches
  // the save-time conflict surface for the same user.
  useSetCurrentRecordInjectionContext(
    buildRecordInjectionContext({
      resourceKind: 'auth.user',
      resourceId: id || null,
      updatedAt: initialUser?.updatedAt ?? null,
      data: initialUser as Record<string, unknown> | null,
      path: pathname,
    }),
  )

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('auth.users.form.errors.notFound', 'User not found')}
            backHref="/backend/users"
            backLabel={t('auth.users.form.actions.backToList', 'Back to users')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error && !loading) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<EditUserFormValues>
          title={t('auth.users.form.title.edit', 'Edit User')}
          backHref="/backend/users"
          versionHistory={{ resourceKind: 'auth.user', resourceId: id ? String(id) : '' }}
          fields={fields}
          groups={groups}
          entityId={E.auth.user}
          initialValues={initialValues}
          isLoading={loading}
          loadingMessage={t('auth.users.form.loading', 'Loading user data...')}
          submitLabel={t('auth.users.form.action.save', 'Save')}
          cancelHref="/backend/users"
          extraActions={id && !userHasPassword ? (
            <Button
              type="button"
              variant="outline"
              disabled={resendingInvite}
              onClick={handleResendInvite}
            >
              {resendingInvite
                ? t('auth.users.form.action.resendingInvite', 'Sending...')
                : t('auth.users.form.action.resendInvite', 'Resend Invite')}
            </Button>
          ) : undefined}
          successRedirect={`/backend/users?flash=${encodeURIComponent(t('auth.users.flash.updated', 'User saved'))}&type=success`}
          onSubmit={async (values) => {
            if (!id) return
            const customFields = collectCustomFieldValues(values)
            const payload = {
              id: id ? String(id) : '',
              email: values.email,
              name: normalizeDisplayNameInput(values.name),
              password: values.password && values.password.trim() ? values.password : undefined,
              organizationId: values.organizationId ? values.organizationId : undefined,
              roles: Array.isArray(values.roles) ? values.roles : [],
              ...(Object.keys(customFields).length ? { customFields } : {}),
            }
            const userOptimisticLockHeader = buildOptimisticLockHeader(initialUser?.updatedAt)
            if (Object.keys(userOptimisticLockHeader).length > 0) {
              await withScopedApiRequestHeaders(userOptimisticLockHeader, () => updateCrud('auth/users', payload))
            } else {
              await updateCrud('auth/users', payload)
            }
            // Optimistic lock the ACL save against the loaded UserAcl version so a
            // concurrent permission edit cannot silently overwrite (#2055). CrudForm
            // surfaces the 409 as the unified conflict bar.
            const aclLockHeader = buildOptimisticLockHeader(aclUpdatedAt)
            const saveUserAcl = () => updateCrud('auth/users/acl', { userId: id, ...aclData }, {
              errorMessage: t('auth.users.form.errors.aclUpdate', 'Failed to update user access control'),
            })
            if (Object.keys(aclLockHeader).length > 0) {
              await withScopedApiRequestHeaders(aclLockHeader, saveUserAcl)
            } else {
              await saveUserAcl()
            }
            await widgetEditorRef.current?.save()
            try { window.dispatchEvent(new Event('om:refresh-sidebar')) } catch {}
          }}
          onDelete={async () => {
            const userOptimisticLockHeader = buildOptimisticLockHeader(initialUser?.updatedAt)
            const deleteUser = () => deleteCrud('auth/users', String(id), {
              errorMessage: t('auth.users.form.errors.delete', 'Failed to delete user'),
            })
            if (Object.keys(userOptimisticLockHeader).length > 0) {
              await withScopedApiRequestHeaders(userOptimisticLockHeader, deleteUser)
            } else {
              await deleteUser()
            }
          }}
          deleteRedirect={`/backend/users?flash=${encodeURIComponent(t('auth.users.flash.deleted', 'User deleted'))}&type=success`}
        />
      </PageBody>
    </Page>
  )
}
