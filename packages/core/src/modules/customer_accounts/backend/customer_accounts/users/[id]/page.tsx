"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'

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

function ResetPasswordDialog({
  open,
  onOpenChange,
  userId,
  onRunMutation,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  userId: string
  onRunMutation: <T>(operation: () => Promise<T>) => Promise<T>
}) {
  const t = useT()
  const [newPassword, setNewPassword] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const handleSubmit = React.useCallback(async (event: React.FormEvent) => {
    event.preventDefault()
    if (!newPassword.trim() || newPassword.length < 8) {
      flash(t('customer_accounts.admin.detail.resetPassword.error.minLength', 'Password must be at least 8 characters'), 'error')
      return
    }
    setIsSubmitting(true)
    try {
      await onRunMutation(async () => {
        const call = await apiCall<{ ok: boolean; error?: string }>(
          `/api/customer_accounts/admin/users/${encodeURIComponent(userId)}/reset-password`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ newPassword }),
          },
        )
        if (!call.ok) {
          flash(call.result?.error || t('customer_accounts.admin.detail.resetPassword.error.save', 'Failed to reset password'), 'error')
          return
        }
        flash(t('customer_accounts.admin.detail.resetPassword.flash.success', 'Password reset successfully'), 'success')
        setNewPassword('')
        onOpenChange(false)
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customer_accounts.admin.detail.resetPassword.error.save', 'Failed to reset password')
      flash(message, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [newPassword, onOpenChange, onRunMutation, t, userId])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      const form = (event.target as HTMLElement).closest('form')
      if (form) form.requestSubmit()
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) setNewPassword(''); onOpenChange(next) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('customer_accounts.admin.detail.resetPassword.title', 'Reset Password')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(event) => { void handleSubmit(event) }} onKeyDown={handleKeyDown} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="reset-password">
              {t('customer_accounts.admin.detail.resetPassword.fields.newPassword', 'New Password')}
            </label>
            <input
              id="reset-password"
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder={t('customer_accounts.admin.detail.resetPassword.fields.placeholder', 'Min. 8 characters')}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => { setNewPassword(''); onOpenChange(false) }}>
              {t('customer_accounts.admin.detail.resetPassword.actions.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? t('customer_accounts.admin.detail.resetPassword.actions.resetting', 'Resetting...')
                : t('customer_accounts.admin.detail.resetPassword.actions.reset', 'Reset Password')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
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
  const [editDisplayName, setEditDisplayName] = React.useState('')
  const [availableRoles, setAvailableRoles] = React.useState<Array<{ id: string; name: string }>>([])
  const [selectedRoleIds, setSelectedRoleIds] = React.useState<string[]>([])
  const [resetPasswordOpen, setResetPasswordOpen] = React.useState(false)
  const [isVerifying, setIsVerifying] = React.useState(false)
  const [editPersonEntityId, setEditPersonEntityId] = React.useState<string | null>(null)
  const [editCustomerEntityId, setEditCustomerEntityId] = React.useState<string | null>(null)
  const [personSearchQuery, setPersonSearchQuery] = React.useState('')
  const [companySearchQuery, setCompanySearchQuery] = React.useState('')
  const [personResults, setPersonResults] = React.useState<Array<{ id: string; label: string }>>([])
  const [companyResults, setCompanyResults] = React.useState<Array<{ id: string; label: string }>>([])
  const [personName, setPersonName] = React.useState<string | null>(null)
  const [companyName, setCompanyName] = React.useState<string | null>(null)
  const [isSendingResetLink, setIsSendingResetLink] = React.useState(false)
  const [resetLinkUrl, setResetLinkUrl] = React.useState<string | null>(null)

  const mutationContextId = `customer_accounts:user:${id ?? 'pending'}`
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
        context: { entityType: 'customer_accounts:user', entityId: id },
      })
    },
    [id, runMutation],
  )

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
        setEditDisplayName(payload.displayName)
        setSelectedRoleIds(payload.roles.map((role) => role.id))
        setEditPersonEntityId(payload.personEntityId)
        setEditCustomerEntityId(payload.customerEntityId)
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

  React.useEffect(() => {
    if (!data) return
    let cancelled = false
    async function loadCrmNames() {
      if (data!.personEntityId) {
        try {
          const call = await apiCall<{ id?: string; firstName?: string; lastName?: string }>(`/api/customers/people/${encodeURIComponent(data!.personEntityId)}`)
          if (!cancelled && call.ok && call.result) {
            setPersonName([call.result.firstName, call.result.lastName].filter(Boolean).join(' ') || call.result.id || null)
          }
        } catch { /* ignore */ }
      }
      if (data!.customerEntityId) {
        try {
          const call = await apiCall<{ id?: string; name?: string }>(`/api/customers/${encodeURIComponent(data!.customerEntityId)}`)
          if (!cancelled && call.ok && call.result) {
            setCompanyName(call.result.name || call.result.id || null)
          }
        } catch { /* ignore */ }
      }
    }
    loadCrmNames()
    return () => { cancelled = true }
  }, [data])

  const handleSearchPeople = React.useCallback(async (query: string) => {
    setPersonSearchQuery(query)
    if (query.trim().length < 2) { setPersonResults([]); return }
    try {
      const call = await apiCall<{ items?: Array<{ id: string; firstName?: string; lastName?: string; email?: string }> }>(
        `/api/customers/people?search=${encodeURIComponent(query.trim())}&pageSize=10`,
      )
      if (call.ok && Array.isArray(call.result?.items)) {
        setPersonResults(call.result!.items.map((person) => ({
          id: person.id,
          label: [person.firstName, person.lastName].filter(Boolean).join(' ') || person.email || person.id,
        })))
      }
    } catch { /* ignore */ }
  }, [])

  const handleSearchCompanies = React.useCallback(async (query: string) => {
    setCompanySearchQuery(query)
    if (query.trim().length < 2) { setCompanyResults([]); return }
    try {
      const call = await apiCall<{ items?: Array<{ id: string; name?: string }> }>(
        `/api/customers?search=${encodeURIComponent(query.trim())}&pageSize=10`,
      )
      if (call.ok && Array.isArray(call.result?.items)) {
        setCompanyResults(call.result!.items.map((company) => ({
          id: company.id,
          label: company.name || company.id,
        })))
      }
    } catch { /* ignore */ }
  }, [])

  const handleSendResetLink = React.useCallback(async () => {
    if (!id) return
    setIsSendingResetLink(true)
    try {
      await runMutationWithContext(async () => {
        const call = await apiCall<{ ok: boolean; resetLink?: string; error?: string }>(
          `/api/customer_accounts/admin/users/${encodeURIComponent(id)}/send-reset-link`,
          { method: 'POST' },
        )
        if (!call.ok || !call.result?.resetLink) {
          flash(call.result?.error || t('customer_accounts.admin.detail.sendResetLink.error', 'Failed to generate reset link'), 'error')
          return
        }
        setResetLinkUrl(call.result.resetLink)
        flash(t('customer_accounts.admin.detail.sendResetLink.flash.success', 'Reset link generated'), 'success')
      }, { id })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customer_accounts.admin.detail.sendResetLink.error', 'Failed to generate reset link')
      flash(message, 'error')
    } finally {
      setIsSendingResetLink(false)
    }
  }, [id, runMutationWithContext, t])

  const handleSave = React.useCallback(async () => {
    if (!data || !id) return
    setIsSaving(true)
    try {
      await runMutationWithContext(async () => {
        const call = await apiCall<{ ok: boolean; error?: string }>(
          `/api/customer_accounts/admin/users/${encodeURIComponent(id)}`,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              displayName: editDisplayName.trim() || undefined,
              isActive: editActive,
              roleIds: selectedRoleIds,
              personEntityId: editPersonEntityId,
              customerEntityId: editCustomerEntityId,
            }),
          },
        )
        if (!call.ok) {
          flash(call.result?.error || t('customer_accounts.admin.detail.error.save', 'Failed to save user'), 'error')
          return
        }
        flash(t('customer_accounts.admin.detail.flash.saved', 'User updated'), 'success')
        setData((prev) => prev ? {
          ...prev,
          isActive: editActive ?? prev.isActive,
          displayName: editDisplayName.trim() || prev.displayName,
          personEntityId: editPersonEntityId,
          customerEntityId: editCustomerEntityId,
        } : prev)
      }, { displayName: editDisplayName, isActive: editActive, roleIds: selectedRoleIds, personEntityId: editPersonEntityId, customerEntityId: editCustomerEntityId })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customer_accounts.admin.detail.error.save', 'Failed to save user')
      flash(message, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [data, editActive, editCustomerEntityId, editDisplayName, editPersonEntityId, id, runMutationWithContext, selectedRoleIds, t])

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
      await runMutationWithContext(async () => {
        const call = await apiCall(
          `/api/customer_accounts/admin/users/${encodeURIComponent(id)}`,
          { method: 'DELETE' },
        )
        if (!call.ok) {
          flash(t('customer_accounts.admin.error.delete', 'Failed to delete user'), 'error')
          return
        }
        flash(t('customer_accounts.admin.flash.deleted', 'User deleted'), 'success')
        router.push('/backend/customer_accounts/users')
      }, { id })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customer_accounts.admin.error.delete', 'Failed to delete user')
      flash(message, 'error')
    }
  }, [confirm, data, id, router, runMutationWithContext, t])

  const handleVerifyEmail = React.useCallback(async () => {
    if (!data || !id) return
    const confirmed = await confirm({
      title: t('customer_accounts.admin.detail.verifyEmail.confirm', 'Mark email as verified for "{{name}}"?', {
        name: data.displayName || data.email,
      }),
    })
    if (!confirmed) return
    setIsVerifying(true)
    try {
      await runMutationWithContext(async () => {
        const call = await apiCall<{ ok: boolean; error?: string }>(
          `/api/customer_accounts/admin/users/${encodeURIComponent(id)}/verify-email`,
          { method: 'POST' },
        )
        if (!call.ok) {
          flash(call.result?.error || t('customer_accounts.admin.detail.verifyEmail.error', 'Failed to verify email'), 'error')
          return
        }
        flash(t('customer_accounts.admin.detail.verifyEmail.flash.success', 'Email marked as verified'), 'success')
        setData((prev) => prev ? { ...prev, emailVerifiedAt: new Date().toISOString() } : prev)
      }, { id })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customer_accounts.admin.detail.verifyEmail.error', 'Failed to verify email')
      flash(message, 'error')
    } finally {
      setIsVerifying(false)
    }
  }, [confirm, data, id, runMutationWithContext, t])

  const handleRevokeSession = React.useCallback(async (sessionId: string) => {
    if (!id) return
    try {
      await runMutationWithContext(async () => {
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
      }, { sessionId })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customer_accounts.admin.detail.error.revokeSession', 'Failed to revoke session')
      flash(message, 'error')
    }
  }, [id, runMutationWithContext, t])

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
              <Link href="/backend/customer_accounts/users">
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
        <FormHeader
          mode="detail"
          backHref="/backend/customer_accounts/users"
          backLabel={t('customer_accounts.admin.detail.actions.backToList', 'Back to list')}
          title={data.displayName}
          subtitle={data.email}
          onDelete={() => { void handleDelete() }}
          deleteLabel={t('customer_accounts.admin.detail.actions.delete', 'Delete')}
        />

        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-950/50">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <h3 className="text-sm font-medium text-blue-900 dark:text-blue-100">
                {t('customer_accounts.admin.detail.portalAccess.title', 'Customer Portal Access')}
              </h3>
              <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">
                {t('customer_accounts.admin.detail.portalAccess.description', 'This user can access the customer portal at the URL below. The portal provides self-service access to orders, invoices, quotes, and account management.')}
              </p>
              <p className="mt-2 text-xs text-blue-600 dark:text-blue-400">
                {t('customer_accounts.admin.detail.portalAccess.url', 'Portal URL: {url}', {
                  url: `${typeof window !== 'undefined' ? window.location.origin : ''}/[org-slug]/portal`,
                })}
              </p>
            </div>
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
              <div className="flex justify-between items-center">
                <dt className="text-muted-foreground">{t('customer_accounts.admin.detail.fields.emailVerified', 'Email Verified')}</dt>
                <dd className="flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    data.emailVerifiedAt
                      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                      : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                  }`}>
                    {data.emailVerifiedAt
                      ? t('customer_accounts.admin.verified', 'Yes')
                      : t('customer_accounts.admin.unverified', 'No')}
                  </span>
                  {!data.emailVerifiedAt && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { void handleVerifyEmail() }}
                      disabled={isVerifying}
                    >
                      {isVerifying
                        ? t('customer_accounts.admin.detail.verifyEmail.actions.verifying', 'Verifying...')
                        : t('customer_accounts.admin.detail.verifyEmail.actions.verify', 'Mark Verified')}
                    </Button>
                  )}
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
            <div className="space-y-3 text-sm">
              <div className="space-y-1.5">
                <p className="text-muted-foreground">{t('customer_accounts.admin.detail.fields.personEntity', 'Linked Person')}</p>
                {editPersonEntityId ? (
                  <div className="flex items-center gap-2">
                    <Link href={`/backend/customers/people/${editPersonEntityId}`} className="text-primary hover:underline">
                      {personName || editPersonEntityId}
                    </Link>
                    <Button type="button" variant="outline" size="sm" onClick={() => { setEditPersonEntityId(null); setPersonName(null) }}>
                      {t('customer_accounts.admin.detail.actions.unlink', 'Unlink')}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="relative">
                      <input
                        type="text"
                        value={personSearchQuery}
                        onChange={(event) => { void handleSearchPeople(event.target.value) }}
                        placeholder={t('customer_accounts.admin.detail.fields.searchPerson', 'Search people by name...')}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                      {personResults.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg max-h-40 overflow-y-auto">
                          {personResults.map((person) => (
                            <button
                              key={person.id}
                              type="button"
                              className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                              onClick={() => {
                                setEditPersonEntityId(person.id)
                                setPersonName(person.label)
                                setPersonSearchQuery('')
                                setPersonResults([])
                              }}
                            >
                              {person.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <p className="text-muted-foreground">{t('customer_accounts.admin.detail.fields.customerEntity', 'Linked Company')}</p>
                {editCustomerEntityId ? (
                  <div className="flex items-center gap-2">
                    <Link href={`/backend/customers/companies/${editCustomerEntityId}`} className="text-primary hover:underline">
                      {companyName || editCustomerEntityId}
                    </Link>
                    <Button type="button" variant="outline" size="sm" onClick={() => { setEditCustomerEntityId(null); setCompanyName(null) }}>
                      {t('customer_accounts.admin.detail.actions.unlink', 'Unlink')}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="relative">
                      <input
                        type="text"
                        value={companySearchQuery}
                        onChange={(event) => { void handleSearchCompanies(event.target.value) }}
                        placeholder={t('customer_accounts.admin.detail.fields.searchCompany', 'Search companies by name...')}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                      {companyResults.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg max-h-40 overflow-y-auto">
                          {companyResults.map((company) => (
                            <button
                              key={company.id}
                              type="button"
                              className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                              onClick={() => {
                                setEditCustomerEntityId(company.id)
                                setCompanyName(company.label)
                                setCompanySearchQuery('')
                                setCompanyResults([])
                              }}
                            >
                              {company.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t('customer_accounts.admin.detail.crmLinks.hint', 'Changes to CRM links are saved when you click Save Changes below.')}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border p-4 space-y-4">
          <h2 className="text-sm font-semibold">{t('customer_accounts.admin.detail.sections.settings', 'Account Settings')}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="user-display-name">
                  {t('customer_accounts.admin.detail.fields.displayName', 'Display Name')}
                </label>
                <input
                  id="user-display-name"
                  type="text"
                  value={editDisplayName}
                  onChange={(event) => setEditDisplayName(event.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

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
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t('customer_accounts.admin.detail.fields.roles', 'Roles')}</p>
              <div className="flex flex-wrap gap-2">
                {availableRoles.map((role) => {
                  const isSelected = selectedRoleIds.includes(role.id)
                  return (
                    <Button
                      key={role.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleRoleToggle(role.id)}
                      className={`rounded-full ${
                        isSelected
                          ? 'border-primary bg-primary/10 text-primary'
                          : ''
                      }`}
                    >
                      {role.name}
                    </Button>
                  )
                })}
                {availableRoles.length === 0 && (
                  <span className="text-sm text-muted-foreground">
                    {t('customer_accounts.admin.detail.noRolesAvailable', 'No roles available')}
                  </span>
                )}
              </div>
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

        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t('customer_accounts.admin.detail.sections.security', 'Security')}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setResetPasswordOpen(true)}>
              {t('customer_accounts.admin.detail.resetPassword.actions.open', 'Reset Password')}
            </Button>
            <Button
              variant="outline"
              onClick={() => { void handleSendResetLink() }}
              disabled={isSendingResetLink}
            >
              {isSendingResetLink
                ? t('customer_accounts.admin.detail.sendResetLink.actions.sending', 'Generating...')
                : t('customer_accounts.admin.detail.sendResetLink.actions.send', 'Send Reset Link')}
            </Button>
          </div>
          {resetLinkUrl && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
              <p className="mb-1.5 text-sm font-medium text-blue-900 dark:text-blue-100">
                {t('customer_accounts.admin.detail.sendResetLink.linkLabel', 'Password reset link (valid for 60 minutes):')}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-blue-100 px-2 py-1 text-xs text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                  {resetLinkUrl}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(resetLinkUrl)
                    flash(t('customer_accounts.admin.detail.sendResetLink.flash.copied', 'Link copied to clipboard'), 'success')
                  }}
                >
                  {t('customer_accounts.admin.detail.sendResetLink.actions.copy', 'Copy')}
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-blue-700 dark:text-blue-300">
                {t('customer_accounts.admin.detail.sendResetLink.hint', 'Share this link with the customer to let them set a new password.')}
              </p>
            </div>
          )}
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

        <ResetPasswordDialog
          open={resetPasswordOpen}
          onOpenChange={setResetPasswordOpen}
          userId={id!}
          onRunMutation={runMutationWithContext}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
