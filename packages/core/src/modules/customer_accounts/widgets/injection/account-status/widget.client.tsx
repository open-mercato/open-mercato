"use client"

import React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

interface AccountStatusData {
  id: string
  email: string
  isActive: boolean
  emailVerified: boolean
  lastLoginAt: string | null
}

interface AccountStatusProps {
  context?: {
    entityId?: string
    recordId?: string
  }
}

interface RoleOption {
  id: string
  name: string
}

interface PersonData {
  person?: {
    primaryEmail?: string | null
    displayName?: string | null
  }
  profile?: {
    firstName?: string | null
    lastName?: string | null
  } | null
}

function InviteForm({ personEntityId, onSuccess }: { personEntityId: string; onSuccess: () => void }) {
  const t = useT()
  const [isLoadingPerson, setIsLoadingPerson] = React.useState(true)
  const [email, setEmail] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [selectedRoleIds, setSelectedRoleIds] = React.useState<string[]>([])
  const [availableRoles, setAvailableRoles] = React.useState<RoleOption[]>([])
  const [isLoadingRoles, setIsLoadingRoles] = React.useState(true)
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function loadPerson() {
      try {
        const call = await apiCall<PersonData>(
          `/api/customers/people/${encodeURIComponent(personEntityId)}`,
        )
        if (cancelled) return
        if (call.ok && call.result) {
          const person = call.result.person
          const profile = call.result.profile
          if (person?.primaryEmail) {
            setEmail(person.primaryEmail)
          }
          const nameParts = [profile?.firstName, profile?.lastName].filter(Boolean)
          if (nameParts.length > 0) {
            setDisplayName(nameParts.join(' '))
          } else if (person?.displayName) {
            setDisplayName(person.displayName)
          }
        }
      } catch {
        /* ignore - fields will remain empty for manual entry */
      } finally {
        if (!cancelled) setIsLoadingPerson(false)
      }
    }
    loadPerson()
    return () => { cancelled = true }
  }, [personEntityId])

  React.useEffect(() => {
    let cancelled = false
    async function loadRoles() {
      try {
        const call = await apiCall<{ items?: RoleOption[] }>(
          '/api/customer_accounts/admin/roles?pageSize=100',
        )
        if (cancelled) return
        if (call.ok && call.result) {
          const items = Array.isArray(call.result.items) ? call.result.items : []
          setAvailableRoles(items.map((role) => ({ id: role.id, name: role.name })))
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setIsLoadingRoles(false)
      }
    }
    loadRoles()
    return () => { cancelled = true }
  }, [])

  function toggleRole(roleId: string) {
    setSelectedRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
    )
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      flash(t('customer_accounts.widgets.invite.error.emailRequired', 'Email is required'), 'error')
      return
    }
    if (selectedRoleIds.length === 0) {
      flash(t('customer_accounts.widgets.invite.error.roleRequired', 'At least one role must be selected'), 'error')
      return
    }

    setIsSubmitting(true)
    try {
      const call = await apiCall<{ ok: boolean; error?: string }>(
        '/api/customer_accounts/admin/users-invite',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: trimmedEmail,
            roleIds: selectedRoleIds,
            displayName: displayName.trim() || undefined,
            customerEntityId: personEntityId,
          }),
        },
      )

      if (!call.ok) {
        const errorMessage = (call.result as Record<string, unknown> | null)?.error as string | undefined
        flash(errorMessage || t('customer_accounts.widgets.invite.error.failed', 'Failed to send invitation'), 'error')
        return
      }

      flash(t('customer_accounts.widgets.invite.success', 'Invitation sent successfully'), 'success')
      onSuccess()
    } catch {
      flash(t('customer_accounts.widgets.invite.error.failed', 'Failed to send invitation'), 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const isLoading = isLoadingPerson || isLoadingRoles

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground py-2">
        {t('common.loading', 'Loading...')}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 mt-2">
      <div>
        <label htmlFor="invite-email" className="block text-xs font-medium text-muted-foreground mb-1">
          {t('common.email', 'Email')}
        </label>
        <input
          id="invite-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          required
          disabled={isSubmitting}
        />
      </div>

      <div>
        <label htmlFor="invite-display-name" className="block text-xs font-medium text-muted-foreground mb-1">
          {t('customer_accounts.widgets.invite.displayName', 'Display Name')}
        </label>
        <input
          id="invite-display-name"
          type="text"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          disabled={isSubmitting}
        />
      </div>

      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1.5">
          {t('customer_accounts.widgets.invite.roles', 'Roles')}
        </div>
        {availableRoles.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            {t('customer_accounts.widgets.invite.noRoles', 'No roles available')}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {availableRoles.map((role) => (
              <Button
                key={role.id}
                type="button"
                variant={selectedRoleIds.includes(role.id) ? 'default' : 'outline'}
                size="sm"
                onClick={() => toggleRole(role.id)}
                disabled={isSubmitting}
                className="text-xs h-7"
              >
                {role.name}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="submit"
          size="sm"
          disabled={isSubmitting || !email.trim() || selectedRoleIds.length === 0}
        >
          {isSubmitting
            ? t('common.loading', 'Loading...')
            : t('customer_accounts.widgets.invite.submit', 'Send Invitation')}
        </Button>
      </div>
    </form>
  )
}

export default function AccountStatusWidget({ context }: AccountStatusProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const personEntityId = context?.recordId
  const [showInviteForm, setShowInviteForm] = React.useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['customer-account-status', personEntityId],
    queryFn: async (): Promise<AccountStatusData | null> => {
      if (!personEntityId) return null
      const result = await apiCall(`/api/customer_accounts/admin/users?personEntityId=${personEntityId}&pageSize=1`)
      if (!result.ok) return null
      const json = result.result as Record<string, unknown> | null
      const items = json?.items as AccountStatusData[] | undefined
      return items?.[0] || null
    },
    enabled: !!personEntityId,
  })

  function handleInviteSuccess() {
    setShowInviteForm(false)
    queryClient.invalidateQueries({ queryKey: ['customer-account-status', personEntityId] })
  }

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</div>
  }

  if (!data) {
    return (
      <div className="rounded-md border p-3">
        <div className="text-sm font-medium mb-1">{t('customer_accounts.widgets.accountStatus', 'Portal Account')}</div>
        <div className="text-sm text-muted-foreground">{t('customer_accounts.widgets.noAccount', 'No portal account linked')}</div>
        {!showInviteForm && personEntityId && (
          <div className="mt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowInviteForm(true)}
            >
              {t('customer_accounts.widgets.invite.button', 'Invite to Portal')}
            </Button>
          </div>
        )}
        {showInviteForm && personEntityId && (
          <InviteForm personEntityId={personEntityId} onSuccess={handleInviteSuccess} />
        )}
      </div>
    )
  }

  return (
    <div className="rounded-md border p-3">
      <div className="text-sm font-medium mb-2">{t('customer_accounts.widgets.accountStatus', 'Portal Account')}</div>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('common.status', 'Status')}</span>
          <span className={data.isActive ? 'text-green-600' : 'text-red-600'}>
            {data.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('common.email', 'Email')}</span>
          <span>{data.email}</span>
        </div>
        {data.emailVerified !== undefined && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('customer_accounts.widgets.emailVerified', 'Email Verified')}</span>
            <span>{data.emailVerified ? '✓' : '✗'}</span>
          </div>
        )}
        {data.lastLoginAt && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('customer_accounts.widgets.lastLogin', 'Last Login')}</span>
            <span>{new Date(data.lastLoginAt).toLocaleDateString()}</span>
          </div>
        )}
      </div>
      <div className="mt-2">
        <a
          href={`/backend/customer_accounts/users/${data.id}`}
          className="text-xs text-primary hover:underline"
        >
          {t('customer_accounts.widgets.viewAccount', 'View account details →')}
        </a>
      </div>
    </div>
  )
}
