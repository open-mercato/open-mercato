"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'

type UserDetail = {
  id: string
  displayName: string
  email: string
  emailVerifiedAt: string | null
  isActive: boolean
  lastLoginAt: string | null
  personEntityId: string | null
  customerEntityId: string | null
  createdAt: string
  updatedAt: string | null
  roles: Array<{ id: string; name: string; slug: string }>
  sessions: Array<{
    id: string
    ipAddress: string | null
    userAgent: string | null
    lastUsedAt: string | null
    createdAt: string
    expiresAt: string
  }>
}

function formatDate(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleString()
}

export default function CustomerUserDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [data, setData] = React.useState<UserDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [editActive, setEditActive] = React.useState<boolean | null>(null)
  const [availableRoles, setAvailableRoles] = React.useState<Array<{ id: string; name: string }>>([])
  const [selectedRoleIds, setSelectedRoleIds] = React.useState<string[]>([])

  React.useEffect(() => {
    if (!id) {
      setError(t('customer_accounts.admin.detail.error.notFound', 'User not found'))
      setIsLoading(false)
      return
    }
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const payload = await readApiResultOrThrow<UserDetail>(
          `/api/customer_accounts/admin/users/${encodeURIComponent(id!)}`,
          undefined,
          { errorMessage: t('customer_accounts.admin.detail.error.load', 'Failed to load user') },
        )
        if (cancelled) return
        setData(payload)
        setEditActive(payload.isActive)
        setSelectedRoleIds(payload.roles.map((role) => role.id))
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : t('customer_accounts.admin.detail.error.load', 'Failed to load user')
        setError(message)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, t])

  React.useEffect(() => {
    let cancelled = false
    async function loadRoles() {
      try {
        const call = await apiCall<{ items?: Array<{ id: string; name: string }> }>(
          '/api/customer_accounts/admin/roles?pageSize=100',
        )
        if (cancelled || !call.ok) return
        const items = Array.isArray(call.result?.items) ? call.result!.items : []
        setAvailableRoles(
          items.filter((item) => typeof item?.id === 'string' && typeof item?.name === 'string'),
        )
      } catch {
        // silently ignore role loading failures
      }
    }
    loadRoles()
    return () => { cancelled = true }
  }, [])

  const handleSave = React.useCallback(async () => {
    if (!data || !id) return
    setIsSaving(true)
    try {
      await apiCall(
        `/api/customer_accounts/admin/users/${encodeURIComponent(id)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            isActive: editActive,
            roleIds: selectedRoleIds,
          }),
        },
      )
      flash(t('customer_accounts.admin.detail.flash.saved', 'User updated'), 'success')
      setData((prev) => prev ? { ...prev, isActive: editActive ?? prev.isActive } : prev)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customer_accounts.admin.detail.error.save', 'Failed to save user')
      flash(message, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [data, editActive, id, selectedRoleIds, t])

  const handleDelete = React.useCallback(async () => {
    if (!data || !id) return
    const confirmed = await confirm({
      title: t('customer_accounts.admin.confirm.delete', 'Delete user "{{name}}"?', {
        name: data.displayName || data.email,
      }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      const call = await apiCall(
        `/api/customer_accounts/admin/users/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      )
      if (!call.ok) {
        flash(t('customer_accounts.admin.error.delete', 'Failed to delete user'), 'error')
        return
      }
      flash(t('customer_accounts.admin.flash.deleted', 'User deleted'), 'success')
      router.push('/backend/customer_accounts')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customer_accounts.admin.error.delete', 'Failed to delete user')
      flash(message, 'error')
    }
  }, [confirm, data, id, router, t])

  const handleRevokeSession = React.useCallback(async (sessionId: string) => {
    if (!id) return
    try {
      const call = await apiCall(
        `/api/customer_accounts/admin/users/${encodeURIComponent(id)}/sessions/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' },
      )
      if (!call.ok) {
        flash(t('customer_accounts.admin.detail.error.revokeSession', 'Failed to revoke session'), 'error')
        return
      }
      flash(t('customer_accounts.admin.detail.flash.sessionRevoked', 'Session revoked'), 'success')
      setData((prev) => {
        if (!prev) return prev
        return { ...prev, sessions: prev.sessions.filter((session) => session.id !== sessionId) }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customer_accounts.admin.detail.error.revokeSession', 'Failed to revoke session')
      flash(message, 'error')
    }
  }, [id, t])

  const handleRoleToggle = React.useCallback((roleId: string) => {
    setSelectedRoleIds((prev) =>
      prev.includes(roleId)
        ? prev.filter((existingId) => existingId !== roleId)
        : [...prev, roleId],
    )
  }, [])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="h-6 w-6" />
            <span>{t('customer_accounts.admin.detail.loading', 'Loading user...')}</span>
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
            <p>{error || t('customer_accounts.admin.detail.error.notFound', 'User not found')}</p>
            <Button asChild variant="outline">
              <Link href="/backend/customer_accounts">
                {t('customer_accounts.admin.detail.actions.backToList', 'Back to list')}
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{data.displayName}</h1>
            <p className="text-sm text-muted-foreground">{data.email}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/backend/customer_accounts">
                {t('customer_accounts.admin.detail.actions.backToList', 'Back to list')}
              </Link>
            </Button>
            <Button variant="destructive" onClick={() => { void handleDelete() }}>
              {t('customer_accounts.admin.detail.actions.delete', 'Delete')}
            </Button>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-lg border p-4 space-y-3">
            <h2 className="text-sm font-semibold">{t('customer_accounts.admin.detail.sections.info', 'User Information')}</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('customer_accounts.admin.detail.fields.email', 'Email')}</dt>
                <dd>{data.email}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('customer_accounts.admin.detail.fields.emailVerified', 'Email Verified')}</dt>
                <dd>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    data.emailVerifiedAt
                      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                      : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                  }`}>
                    {data.emailVerifiedAt
                      ? t('customer_accounts.admin.verified', 'Yes')
                      : t('customer_accounts.admin.unverified', 'No')}
                  </span>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('customer_accounts.admin.detail.fields.lastLogin', 'Last Login')}</dt>
                <dd>{formatDate(data.lastLoginAt, '-')}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('customer_accounts.admin.detail.fields.createdAt', 'Created')}</dt>
                <dd>{formatDate(data.createdAt, '-')}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <h2 className="text-sm font-semibold">{t('customer_accounts.admin.detail.sections.crmLinks', 'CRM Links')}</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('customer_accounts.admin.detail.fields.personEntity', 'Linked Person')}</dt>
                <dd>
                  {data.personEntityId ? (
                    <Link href={`/backend/customers/people/${data.personEntityId}`} className="text-primary hover:underline">
                      {t('customer_accounts.admin.detail.actions.viewPerson', 'View')}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('customer_accounts.admin.detail.fields.customerEntity', 'Linked Company')}</dt>
                <dd>
                  {data.customerEntityId ? (
                    <Link href={`/backend/customers/companies/${data.customerEntityId}`} className="text-primary hover:underline">
                      {t('customer_accounts.admin.detail.actions.viewCompany', 'View')}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="rounded-lg border p-4 space-y-4">
          <h2 className="text-sm font-semibold">{t('customer_accounts.admin.detail.sections.settings', 'Account Settings')}</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium" htmlFor="user-active-toggle">
                {t('customer_accounts.admin.detail.fields.isActive', 'Active')}
              </label>
              <button
                id="user-active-toggle"
                type="button"
                role="switch"
                aria-checked={editActive ?? data.isActive}
                onClick={() => setEditActive((prev) => !(prev ?? data.isActive))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  (editActive ?? data.isActive) ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  (editActive ?? data.isActive) ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t('customer_accounts.admin.detail.fields.roles', 'Roles')}</p>
              <div className="flex flex-wrap gap-2">
                {availableRoles.map((role) => {
                  const isSelected = selectedRoleIds.includes(role.id)
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => handleRoleToggle(role.id)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {role.name}
                    </button>
                  )
                })}
                {availableRoles.length === 0 && (
                  <span className="text-sm text-muted-foreground">
                    {t('customer_accounts.admin.detail.noRolesAvailable', 'No roles available')}
                  </span>
                )}
              </div>
            </div>

            <div className="pt-2">
              <Button onClick={() => { void handleSave() }} disabled={isSaving}>
                {isSaving
                  ? t('customer_accounts.admin.detail.actions.saving', 'Saving...')
                  : t('customer_accounts.admin.detail.actions.save', 'Save Changes')}
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border p-4 space-y-3">
          <h2 className="text-sm font-semibold">
            {t('customer_accounts.admin.detail.sections.sessions', 'Active Sessions')}
            {data.sessions.length > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">({data.sessions.length})</span>
            )}
          </h2>
          {data.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('customer_accounts.admin.detail.noSessions', 'No active sessions')}
            </p>
          ) : (
            <div className="divide-y">
              {data.sessions.map((session) => (
                <div key={session.id} className="flex items-center justify-between py-2 text-sm">
                  <div className="space-y-0.5">
                    <p className="font-medium">
                      {session.ipAddress || t('customer_accounts.admin.detail.unknownIp', 'Unknown IP')}
                    </p>
                    <p className="text-xs text-muted-foreground truncate max-w-xs">
                      {session.userAgent || t('customer_accounts.admin.detail.unknownDevice', 'Unknown device')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('customer_accounts.admin.detail.fields.lastUsed', 'Last used')}: {formatDate(session.lastUsedAt, '-')}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { void handleRevokeSession(session.id) }}
                  >
                    {t('customer_accounts.admin.detail.actions.revoke', 'Revoke')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
