"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'

type RoleDetail = {
  id: string
  name: string
  slug: string
  description: string | null
  isDefault: boolean
  isSystem: boolean
  customerAssignable: boolean
  features: string[]
}

const PORTAL_FEATURES = [
  { id: 'portal.profile.view', labelKey: 'customer_accounts.admin.portalFeatures.profile.view', fallback: 'View profile' },
  { id: 'portal.profile.edit', labelKey: 'customer_accounts.admin.portalFeatures.profile.edit', fallback: 'Edit profile' },
  { id: 'portal.orders.view', labelKey: 'customer_accounts.admin.portalFeatures.orders.view', fallback: 'View orders' },
  { id: 'portal.orders.create', labelKey: 'customer_accounts.admin.portalFeatures.orders.create', fallback: 'Create orders' },
  { id: 'portal.invoices.view', labelKey: 'customer_accounts.admin.portalFeatures.invoices.view', fallback: 'View invoices' },
  { id: 'portal.quotes.view', labelKey: 'customer_accounts.admin.portalFeatures.quotes.view', fallback: 'View quotes' },
  { id: 'portal.quotes.request', labelKey: 'customer_accounts.admin.portalFeatures.quotes.request', fallback: 'Request quotes' },
  { id: 'portal.addresses.view', labelKey: 'customer_accounts.admin.portalFeatures.addresses.view', fallback: 'View addresses' },
  { id: 'portal.addresses.manage', labelKey: 'customer_accounts.admin.portalFeatures.addresses.manage', fallback: 'Manage addresses' },
  { id: 'portal.users.view', labelKey: 'customer_accounts.admin.portalFeatures.users.view', fallback: 'View team members' },
  { id: 'portal.users.invite', labelKey: 'customer_accounts.admin.portalFeatures.users.invite', fallback: 'Invite team members' },
  { id: 'portal.users.manage', labelKey: 'customer_accounts.admin.portalFeatures.users.manage', fallback: 'Manage team members' },
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

export default function CustomerRoleDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [data, setData] = React.useState<RoleDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)

  const [editName, setEditName] = React.useState('')
  const [editDescription, setEditDescription] = React.useState('')
  const [editIsDefault, setEditIsDefault] = React.useState(false)
  const [editCustomerAssignable, setEditCustomerAssignable] = React.useState(false)
  const [editFeatures, setEditFeatures] = React.useState<string[]>([])

  const mutationContextId = `customer_accounts:role:${id ?? 'pending'}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    entityType: string
    entityId?: string
  }>({
    contextId: mutationContextId,
  })

  const runMutationWithContext = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload?: Record<string, unknown>): Promise<T> => {
      return runMutation({
        operation,
        mutationPayload,
        context: { entityType: 'customer_accounts:role', entityId: id },
      })
    },
    [id, runMutation],
  )

  React.useEffect(() => {
    if (!id) {
      setError(t('customer_accounts.admin.roleDetail.error.notFound', 'Role not found'))
      setIsLoading(false)
      return
    }
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const payload = await readApiResultOrThrow<RoleDetail>(
          `/api/customer_accounts/admin/roles/${encodeURIComponent(id!)}`,
          undefined,
          { errorMessage: t('customer_accounts.admin.roleDetail.error.load', 'Failed to load role') },
        )
        if (cancelled) return
        setData(payload)
        setEditName(payload.name)
        setEditDescription(payload.description || '')
        setEditIsDefault(payload.isDefault)
        setEditCustomerAssignable(payload.customerAssignable)
        setEditFeatures(Array.isArray(payload.features) ? payload.features : [])
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : t('customer_accounts.admin.roleDetail.error.load', 'Failed to load role')
        setError(message)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, t])

  const handleFeatureToggle = React.useCallback((featureId: string) => {
    setEditFeatures((prev) =>
      prev.includes(featureId)
        ? prev.filter((existingId) => existingId !== featureId)
        : [...prev, featureId],
    )
  }, [])

  const handleGroupToggle = React.useCallback((featureIds: string[]) => {
    setEditFeatures((prev) => {
      const allSelected = featureIds.every((featureId) => prev.includes(featureId))
      if (allSelected) {
        return prev.filter((featureId) => !featureIds.includes(featureId))
      }
      const next = [...prev]
      for (const featureId of featureIds) {
        if (!next.includes(featureId)) next.push(featureId)
      }
      return next
    })
  }, [])

  const handleSave = React.useCallback(async () => {
    if (!data || !id) return
    setIsSaving(true)
    try {
      await runMutationWithContext(async () => {
        const call = await apiCall(
          `/api/customer_accounts/admin/roles/${encodeURIComponent(id)}`,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name: editName.trim(),
              description: editDescription.trim() || null,
              isDefault: editIsDefault,
              customerAssignable: editCustomerAssignable,
              features: editFeatures,
            }),
          },
        )
        if (!call.ok) {
          flash(t('customer_accounts.admin.roleDetail.error.save', 'Failed to save role'), 'error')
          return
        }
        flash(t('customer_accounts.admin.roleDetail.flash.saved', 'Role updated'), 'success')
        setData((prev) => prev ? {
          ...prev,
          name: editName.trim(),
          description: editDescription.trim() || null,
          isDefault: editIsDefault,
          customerAssignable: editCustomerAssignable,
          features: editFeatures,
        } : prev)
      }, { name: editName, description: editDescription, isDefault: editIsDefault, customerAssignable: editCustomerAssignable, features: editFeatures })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customer_accounts.admin.roleDetail.error.save', 'Failed to save role')
      flash(message, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [data, editCustomerAssignable, editDescription, editFeatures, editIsDefault, editName, id, runMutationWithContext, t])

  const handleDelete = React.useCallback(async () => {
    if (!data || !id) return
    if (data.isSystem) {
      flash(t('customer_accounts.admin.roles.error.deleteSystem', 'System roles cannot be deleted'), 'error')
      return
    }
    const confirmed = await confirm({
      title: t('customer_accounts.admin.roles.confirm.delete', 'Delete role "{{name}}"?', { name: data.name }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutationWithContext(async () => {
        const call = await apiCall(
          `/api/customer_accounts/admin/roles/${encodeURIComponent(id)}`,
          { method: 'DELETE' },
        )
        if (!call.ok) {
          flash(t('customer_accounts.admin.roles.error.delete', 'Failed to delete role'), 'error')
          return
        }
        flash(t('customer_accounts.admin.roles.flash.deleted', 'Role deleted'), 'success')
        router.push('/backend/customer_accounts/roles')
      }, { id })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customer_accounts.admin.roles.error.delete', 'Failed to delete role')
      flash(message, 'error')
    }
  }, [confirm, data, id, router, runMutationWithContext, t])

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

  if (error || !data) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <p>{error || t('customer_accounts.admin.roleDetail.error.notFound', 'Role not found')}</p>
            <Button asChild variant="outline">
              <Link href="/backend/customer_accounts/roles">
                {t('customer_accounts.admin.roleDetail.actions.backToList', 'Back to roles')}
              </Link>
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody className="space-y-6">
        <FormHeader
          mode="detail"
          backHref="/backend/customer_accounts/roles"
          backLabel={t('customer_accounts.admin.roleDetail.actions.backToList', 'Back to roles')}
          title={data.name}
          subtitle={data.slug}
          statusBadge={data.isSystem ? (
            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              {t('customer_accounts.admin.roles.system', 'System')}
            </span>
          ) : undefined}
          onDelete={!data.isSystem ? (() => { void handleDelete() }) : undefined}
          deleteLabel={t('customer_accounts.admin.roleDetail.actions.delete', 'Delete')}
        />

        <div className="rounded-lg border p-4 space-y-4">
          <h2 className="text-sm font-semibold">{t('customer_accounts.admin.roleDetail.sections.details', 'Role Details')}</h2>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium" htmlFor="role-name">
                {t('customer_accounts.admin.roleDetail.fields.name', 'Name')}
              </label>
              <input
                id="role-name"
                type="text"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                disabled={data.isSystem}
                className="mt-1 block w-full rounded border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="role-description">
                {t('customer_accounts.admin.roleDetail.fields.description', 'Description')}
              </label>
              <textarea
                id="role-description"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                rows={3}
                className="mt-1 block w-full rounded border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editIsDefault}
                  onChange={(event) => setEditIsDefault(event.target.checked)}
                  className="rounded border-border"
                />
                {t('customer_accounts.admin.roleDetail.fields.isDefault', 'Default role (auto-assigned to new users)')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editCustomerAssignable}
                  onChange={(event) => setEditCustomerAssignable(event.target.checked)}
                  className="rounded border-border"
                />
                {t('customer_accounts.admin.roleDetail.fields.customerAssignable', 'Customers can self-assign')}
              </label>
            </div>
          </div>
        </div>

        <div className="rounded-lg border p-4 space-y-4">
          <h2 className="text-sm font-semibold">{t('customer_accounts.admin.roleDetail.sections.permissions', 'Portal Permissions')}</h2>
          <div className="space-y-4">
            {FEATURE_GROUPS.map((group) => {
              const groupFeatures = group.features
              const allSelected = groupFeatures.every((featureId) => editFeatures.includes(featureId))
              const someSelected = groupFeatures.some((featureId) => editFeatures.includes(featureId))
              return (
                <div key={group.id} className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
                      onChange={() => handleGroupToggle(groupFeatures)}
                      className="rounded border-border"
                    />
                    {t(group.labelKey, group.fallback)}
                  </label>
                  <div className="ml-6 grid gap-1 sm:grid-cols-2">
                    {groupFeatures.map((featureId) => {
                      const feature = PORTAL_FEATURES.find((portalFeature) => portalFeature.id === featureId)
                      return (
                        <label key={featureId} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={editFeatures.includes(featureId)}
                            onChange={() => handleFeatureToggle(featureId)}
                            className="rounded border-border"
                          />
                          {feature ? t(feature.labelKey, feature.fallback) : featureId}
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={() => { void handleSave() }} disabled={isSaving}>
            {isSaving
              ? t('customer_accounts.admin.roleDetail.actions.saving', 'Saving...')
              : t('customer_accounts.admin.roleDetail.actions.save', 'Save Changes')}
          </Button>
          <Button variant="outline" asChild>
            <Link href="/backend/customer_accounts/roles">
              {t('customer_accounts.admin.roleDetail.actions.cancel', 'Cancel')}
            </Link>
          </Button>
        </div>
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
