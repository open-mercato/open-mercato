"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import type { CrudField, CrudFormGroup, CrudFormGroupComponentProps } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { RecordNotFoundState, ErrorMessage } from '@open-mercato/ui/backend/detail'

type RoleDetail = {
  id: string
  name: string
  slug: string
  description: string | null
  isDefault: boolean
  isSystem: boolean
  customerAssignable: boolean
  features: string[]
  updatedAt?: string | null
  updated_at?: string | null
}

const PORTAL_FEATURES = [
  { id: 'portal.profile.view', labelKey: 'customer_accounts.admin.portalFeatures.profile.view', fallback: 'View profile', descriptionKey: 'customer_accounts.admin.portalFeatures.profile.view.description', descriptionFallback: 'Allows viewing own profile information and account details' },
  { id: 'portal.profile.edit', labelKey: 'customer_accounts.admin.portalFeatures.profile.edit', fallback: 'Edit profile', descriptionKey: 'customer_accounts.admin.portalFeatures.profile.edit.description', descriptionFallback: 'Allows editing display name and other profile settings' },
  { id: 'portal.orders.view', labelKey: 'customer_accounts.admin.portalFeatures.orders.view', fallback: 'View orders', descriptionKey: 'customer_accounts.admin.portalFeatures.orders.view.description', descriptionFallback: 'Allows viewing order history and order details' },
  { id: 'portal.orders.create', labelKey: 'customer_accounts.admin.portalFeatures.orders.create', fallback: 'Create orders', descriptionKey: 'customer_accounts.admin.portalFeatures.orders.create.description', descriptionFallback: 'Allows placing new orders through the portal' },
  { id: 'portal.invoices.view', labelKey: 'customer_accounts.admin.portalFeatures.invoices.view', fallback: 'View invoices', descriptionKey: 'customer_accounts.admin.portalFeatures.invoices.view.description', descriptionFallback: 'Allows viewing invoices and payment history' },
  { id: 'portal.quotes.view', labelKey: 'customer_accounts.admin.portalFeatures.quotes.view', fallback: 'View quotes', descriptionKey: 'customer_accounts.admin.portalFeatures.quotes.view.description', descriptionFallback: 'Allows viewing received quotes and their details' },
  { id: 'portal.quotes.request', labelKey: 'customer_accounts.admin.portalFeatures.quotes.request', fallback: 'Request quotes', descriptionKey: 'customer_accounts.admin.portalFeatures.quotes.request.description', descriptionFallback: 'Allows requesting new quotes from the company' },
  { id: 'portal.addresses.view', labelKey: 'customer_accounts.admin.portalFeatures.addresses.view', fallback: 'View addresses', descriptionKey: 'customer_accounts.admin.portalFeatures.addresses.view.description', descriptionFallback: 'Allows viewing saved shipping and billing addresses' },
  { id: 'portal.addresses.manage', labelKey: 'customer_accounts.admin.portalFeatures.addresses.manage', fallback: 'Manage addresses', descriptionKey: 'customer_accounts.admin.portalFeatures.addresses.manage.description', descriptionFallback: 'Allows adding, editing, and removing addresses' },
  { id: 'portal.users.view', labelKey: 'customer_accounts.admin.portalFeatures.users.view', fallback: 'View team members', descriptionKey: 'customer_accounts.admin.portalFeatures.users.view.description', descriptionFallback: 'Allows viewing other team members in the organization' },
  { id: 'portal.users.invite', labelKey: 'customer_accounts.admin.portalFeatures.users.invite', fallback: 'Invite team members', descriptionKey: 'customer_accounts.admin.portalFeatures.users.invite.description', descriptionFallback: 'Allows sending portal invitations to new team members' },
  { id: 'portal.users.manage', labelKey: 'customer_accounts.admin.portalFeatures.users.manage', fallback: 'Manage team members', descriptionKey: 'customer_accounts.admin.portalFeatures.users.manage.description', descriptionFallback: 'Allows editing roles and removing team members' },
]

const FEATURE_GROUPS: Array<{ id: string; labelKey: string; fallback: string; features: string[] }> = (() => {
  const groups = new Map<string, string[]>()
  for (const feature of PORTAL_FEATURES) {
    const parts = feature.id.split('.')
    const groupKey = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : parts[0]
    const existing = groups.get(groupKey)
    if (existing) {
      existing.push(feature.id)
    } else {
      groups.set(groupKey, [feature.id])
    }
  }
  return Array.from(groups.entries()).map(([groupId, features]) => {
    const scope = groupId.split('.').slice(1).join('')
    const fallback = scope.replace(/^\w/, (ch) => ch.toUpperCase())
    return {
      id: groupId,
      labelKey: `customer_accounts.admin.portalFeatures.groups.${scope}`,
      fallback,
      features,
    }
  })
})()

function PortalPermissionsEditor({ values, setValue }: CrudFormGroupComponentProps) {
  const t = useT()
  const features = React.useMemo(
    () => Array.isArray(values.features) ? values.features as string[] : [],
    [values.features],
  )

  const handleFeatureToggle = React.useCallback((featureId: string) => {
    const next = features.includes(featureId)
      ? features.filter((existingId) => existingId !== featureId)
      : [...features, featureId]
    setValue('features', next)
  }, [features, setValue])

  const handleGroupToggle = React.useCallback((featureIds: string[]) => {
    const allSelected = featureIds.every((featureId) => features.includes(featureId))
    let next: string[]
    if (allSelected) {
      next = features.filter((featureId) => !featureIds.includes(featureId))
    } else {
      next = [...features]
      for (const featureId of featureIds) {
        if (!next.includes(featureId)) next.push(featureId)
      }
    }
    setValue('features', next)
  }, [features, setValue])

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {FEATURE_GROUPS.map((group) => {
        const groupFeatures = group.features
        const allSelected = groupFeatures.every((featureId) => features.includes(featureId))
        const someSelected = groupFeatures.some((featureId) => features.includes(featureId))
        return (
          <div key={group.id} className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">{t(group.labelKey, group.fallback)}</span>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
                  onChange={() => handleGroupToggle(groupFeatures)}
                  className="rounded border-border"
                />
                {t('customer_accounts.admin.roleDetail.selectAll', 'Select all')}
              </label>
            </div>
            <div className="divide-y">
              {groupFeatures.map((featureId) => {
                const feature = PORTAL_FEATURES.find((portalFeature) => portalFeature.id === featureId)
                return (
                  <label key={featureId} className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={features.includes(featureId)}
                      onChange={() => handleFeatureToggle(featureId)}
                      className="mt-0.5 rounded border-border"
                    />
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">{feature ? t(feature.labelKey, feature.fallback) : featureId}</div>
                      {feature && (
                        <div className="text-xs text-muted-foreground">{t(feature.descriptionKey, feature.descriptionFallback)}</div>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function CustomerRoleDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const router = useRouter()
  const [data, setData] = React.useState<RoleDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  React.useEffect(() => {
    if (!id) {
      setIsNotFound(true)
      setIsLoading(false)
      return
    }
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const payload = await readApiResultOrThrow<RoleDetail>(
          `/api/customer_accounts/admin/roles/${encodeURIComponent(id!)}`,
          undefined,
          { errorMessage: t('customer_accounts.admin.roleDetail.error.load', 'Failed to load role') },
        )
        if (cancelled) return
        setData(payload)
      } catch (err) {
        if (cancelled) return
        if ((err as { status?: number }).status === 404) {
          setIsNotFound(true)
        } else {
          const message = err instanceof Error ? err.message : t('customer_accounts.admin.roleDetail.error.load', 'Failed to load role')
          setError(message)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, t])

  const fields = React.useMemo<CrudField[]>(() => {
    if (!data) return []
    return [
      {
        id: 'name',
        type: 'text' as const,
        label: t('customer_accounts.admin.roleDetail.fields.name', 'Name'),
        required: true,
        disabled: data.isSystem,
      },
      {
        id: 'description',
        type: 'textarea' as const,
        label: t('customer_accounts.admin.roleDetail.fields.description', 'Description'),
      },
      {
        id: 'isDefault',
        type: 'checkbox' as const,
        label: t('customer_accounts.admin.roleDetail.fields.isDefault', 'Default role (auto-assigned to new users)'),
      },
      {
        id: 'customerAssignable',
        type: 'checkbox' as const,
        label: t('customer_accounts.admin.roleDetail.fields.customerAssignable', 'Customers can self-assign'),
      },
    ]
  }, [data, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      title: t('customer_accounts.admin.roleDetail.sections.details', 'Role Details'),
      column: 1,
      fields: ['name', 'description'],
    },
    {
      id: 'options',
      title: t('customer_accounts.admin.roleDetail.sections.options', 'Options'),
      column: 1,
      fields: ['isDefault', 'customerAssignable'],
    },
    {
      id: 'permissions',
      title: t('customer_accounts.admin.roleDetail.sections.permissions', 'Portal Permissions'),
      column: 1,
      component: PortalPermissionsEditor,
    },
  ], [t])

  const initialValues = React.useMemo(() => {
    if (!data) return {}
    return {
      name: data.name,
      description: data.description || '',
      isDefault: data.isDefault,
      customerAssignable: data.customerAssignable,
      features: data.features,
      updatedAt: data.updatedAt ?? data.updated_at ?? null,
    }
  }, [data])

  const handleSubmit = React.useCallback(async (values: Record<string, unknown>) => {
    if (!id) return
    const headers = buildOptimisticLockHeader(data?.updatedAt ?? data?.updated_at ?? null)
    const roleCall = await withScopedApiRequestHeaders(headers, () => (
      apiCall(
        `/api/customer_accounts/admin/roles/${encodeURIComponent(id)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: (values.name as string)?.trim(),
            description: (values.description as string)?.trim() || null,
            isDefault: values.isDefault,
            customerAssignable: values.customerAssignable,
          }),
        },
      )
    ))
    if (!roleCall.ok) {
      if (surfaceRecordConflict({ status: roleCall.status, body: roleCall.result }, t)) return
      flash(t('customer_accounts.admin.roleDetail.error.save', 'Failed to save role'), 'error')
      return
    }
    const features = Array.isArray(values.features) ? values.features : []
    // The role PUT just bumped the aggregate's `updatedAt`; the ACL write guards
    // the SAME role aggregate, so send its NEW version (not the stale pre-edit one)
    // to avoid a false 409 while still blocking a concurrent overwrite (#3194).
    const roleResult = (roleCall.result ?? null) as { updatedAt?: string | null } | null
    const aclHeaders = buildOptimisticLockHeader(roleResult?.updatedAt ?? data?.updatedAt ?? data?.updated_at ?? null)
    const aclCall = await withScopedApiRequestHeaders(aclHeaders, () => (
      apiCall(
        `/api/customer_accounts/admin/roles/${encodeURIComponent(id)}/acl`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features }),
        },
      )
    ))
    if (!aclCall.ok) {
      if (surfaceRecordConflict({ status: aclCall.status, body: aclCall.result }, t)) return
      flash(t('customer_accounts.admin.roleDetail.error.saveAcl', 'Failed to save permissions'), 'error')
      return
    }
    flash(t('customer_accounts.admin.roleDetail.flash.saved', 'Role updated'), 'success')
    router.push('/backend/customer_accounts/roles')
  }, [data?.updatedAt, data?.updated_at, id, router, t])

  const handleDelete = React.useCallback(async () => {
    if (!id) return
    const headers = buildOptimisticLockHeader(data?.updatedAt ?? data?.updated_at ?? null)
    const call = await withScopedApiRequestHeaders(headers, () => (
      apiCall(
        `/api/customer_accounts/admin/roles/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      )
    ))
    if (!call.ok) {
      if (surfaceRecordConflict({ status: call.status, body: call.result }, t)) return
      flash(t('customer_accounts.admin.roles.error.delete', 'Failed to delete role'), 'error')
      return
    }
    flash(t('customer_accounts.admin.roles.flash.deleted', 'Role deleted'), 'success')
    router.push('/backend/customer_accounts/roles')
  }, [data?.updatedAt, data?.updated_at, id, router, t])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="h-6 w-6" />
            <span>{t('customer_accounts.admin.roleDetail.loading', 'Loading role...')}</span>
          </div>
        </PageBody>
      </Page>
    )
  }

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('customer_accounts.admin.roleDetail.error.notFound', 'Role not found')}
            backHref="/backend/customer_accounts/roles"
            backLabel={t('customer_accounts.admin.roleDetail.actions.backToList', 'Back to roles')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !data) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={error ?? t('customer_accounts.admin.roleDetail.error.notFound', 'Role not found')}
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/backend/customer_accounts/roles">
                  {t('customer_accounts.admin.roleDetail.actions.backToList', 'Back to roles')}
                </Link>
              </Button>
            }
          />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={data.name}
          backHref="/backend/customer_accounts/roles"
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          optimisticLockUpdatedAt={data.updatedAt ?? data.updated_at ?? null}
          entityId="customer_accounts:customer_role"
          onSubmit={handleSubmit}
          onDelete={!data.isSystem ? handleDelete : undefined}
          cancelHref="/backend/customer_accounts/roles"
        />
      </PageBody>
    </Page>
  )
}
