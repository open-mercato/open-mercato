"use client"

import React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { EmailInput } from '@open-mercato/ui/primitives/email-input'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

interface AccountStatusData {
  id: string
  email: string
  isActive: boolean
  emailVerified: boolean
  lastLoginAt: string | null
}

interface PendingInvitationData {
  id: string
  email: string
  expiresAt: string
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

async function fetchPendingInvitation(filter: string): Promise<PendingInvitationData | null> {
  const result = await apiCall(`/api/customer_accounts/admin/users-invite?${filter}&pageSize=1`)
  if (!result.ok) return null
  const json = result.result as Record<string, unknown> | null
  const items = json?.items as PendingInvitationData[] | undefined
  return items?.[0] || null
}

function InviteForm({
  personEntityId,
  personData,
  isLoadingPerson,
  onSuccess,
}: {
  personEntityId: string
  personData: PersonData | null
  isLoadingPerson: boolean
  onSuccess: () => void
}) {
  const t = useT()
  const [email, setEmail] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [selectedRoleIds, setSelectedRoleIds] = React.useState<string[]>([])
  const [availableRoles, setAvailableRoles] = React.useState<RoleOption[]>([])
  const [isLoadingRoles, setIsLoadingRoles] = React.useState(true)
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const { runMutation } = useGuardedMutation<{ entityType: string }>({
    contextId: 'customer_accounts:account-status-invite',
  })

  React.useEffect(() => {
    if (!personData) return
    const person = personData.person
    const profile = personData.profile
    if (person?.primaryEmail) {
      setEmail(person.primaryEmail)
    }
    const nameParts = [profile?.firstName, profile?.lastName].filter(Boolean)
    if (nameParts.length > 0) {
      setDisplayName(nameParts.join(' '))
    } else if (person?.displayName) {
      setDisplayName(person.displayName)
    }
  }, [personData])

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

  async function handleSubmit() {
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
      await runMutation({
        context: { entityType: 'customer_accounts:user' },
        mutationPayload: { personEntityId, roleIds: selectedRoleIds },
        operation: async () => {
          // optimistic-lock-exempt: creates a new portal invitation, not a concurrent record edit
          const call = await apiCall<{ ok: boolean; error?: string }>(
            '/api/customer_accounts/admin/users-invite',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                email: trimmedEmail,
                roleIds: selectedRoleIds,
                displayName: displayName.trim() || undefined,
                personEntityId,
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
        },
      })
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
    <div className="space-y-3 mt-2">
      <div>
        <label htmlFor="invite-email" className="block text-xs font-medium text-muted-foreground mb-1">
          {t('common.email', 'Email')}
        </label>
        <EmailInput
          id="invite-email"
          size="sm"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          disabled={isSubmitting}
        />
      </div>

      <div>
        <label htmlFor="invite-display-name" className="block text-xs font-medium text-muted-foreground mb-1">
          {t('customer_accounts.widgets.invite.displayName', 'Display Name')}
        </label>
        <Input
          id="invite-display-name"
          type="text"
          size="sm"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
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
          type="button"
          size="sm"
          onClick={handleSubmit}
          disabled={isSubmitting || !email.trim() || selectedRoleIds.length === 0}
        >
          {isSubmitting
            ? t('common.loading', 'Loading...')
            : t('customer_accounts.widgets.invite.submit', 'Send Invitation')}
        </Button>
      </div>
    </div>
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

  // The person record backs both the pending-invitation email fallback below and
  // the invite form defaults, so it is fetched once here and shared.
  const { data: personData, isLoading: isLoadingPerson } = useQuery({
    queryKey: ['customer-account-person', personEntityId],
    queryFn: async (): Promise<PersonData | null> => {
      if (!personEntityId) return null
      const result = await apiCall<PersonData>(
        `/api/customers/people/${encodeURIComponent(personEntityId)}`,
      )
      if (!result.ok) return null
      return (result.result as PersonData | null) || null
    },
    enabled: !!personEntityId && !isLoading && !data,
  })

  const personEmail = personData?.person?.primaryEmail?.trim() || null

  // A portal account only exists once the invitation is accepted, so the users
  // query above stays empty right after a successful invite. Without this the
  // widget renders the identical "no account" state and the invite looks like a
  // no-op (#4950).
  const { data: pendingInvitation, isLoading: isLoadingInvitation } = useQuery({
    queryKey: ['customer-account-pending-invitation', personEntityId, personEmail],
    queryFn: async (): Promise<PendingInvitationData | null> => {
      if (!personEntityId) return null
      const byPerson = await fetchPendingInvitation(
        `personEntityId=${encodeURIComponent(personEntityId)}`,
      )
      if (byPerson) return byPerson
      // person_entity_id is optional on an invitation: the portal invite route
      // only ever knows the company, and rows written before the entity-ownership
      // guard landed the person id in customer_entity_id instead. The recipient
      // address is the one identity every invitation carries, so match on it
      // before reporting "no account" for someone who was already invited (#5499).
      if (!personEmail) return null
      return fetchPendingInvitation(`email=${encodeURIComponent(personEmail)}`)
    },
    enabled: !!personEntityId && !isLoading && !data && !isLoadingPerson,
  })

  // A disabled React Query reports isLoading === false, so isLoadingInvitation is
  // false for the whole person fetch the email fallback waits on. Rendering off
  // that alone would show "no portal account linked" with a live invite button
  // during that window — the double-invite #5499 exists to prevent.
  const isResolvingInvitation = isLoadingPerson || isLoadingInvitation

  function handleInviteSuccess() {
    setShowInviteForm(false)
    queryClient.invalidateQueries({ queryKey: ['customer-account-status', personEntityId] })
    queryClient.invalidateQueries({ queryKey: ['customer-account-pending-invitation', personEntityId] })
  }

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</div>
  }

  if (!data) {
    return (
      <div className="rounded-md border p-3">
        <div className="text-sm font-medium mb-1">{t('customer_accounts.widgets.accountStatus', 'Portal Account')}</div>
        {isResolvingInvitation ? (
          <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</div>
        ) : pendingInvitation ? (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('common.status', 'Status')}</span>
              <StatusBadge variant="warning" dot>
                {t('customer_accounts.widgets.invitationPending', 'Invitation pending')}
              </StatusBadge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('common.email', 'Email')}</span>
              <span>{pendingInvitation.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('customer_accounts.widgets.invitationExpires', 'Invitation expires')}</span>
              <span>{new Date(pendingInvitation.expiresAt).toLocaleDateString()}</span>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">{t('customer_accounts.widgets.noAccount', 'No portal account linked')}</div>
        )}
        {!showInviteForm && personEntityId && !isResolvingInvitation && (
          <div className="mt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowInviteForm(true)}
            >
              {pendingInvitation
                ? t('customer_accounts.widgets.invite.resend', 'Resend invitation')
                : t('customer_accounts.widgets.invite.button', 'Invite to Portal')}
            </Button>
          </div>
        )}
        {showInviteForm && personEntityId && (
          <InviteForm
            personEntityId={personEntityId}
            personData={personData ?? null}
            isLoadingPerson={isLoadingPerson}
            onSuccess={handleInviteSuccess}
          />
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
          <StatusBadge variant={data.isActive ? 'success' : 'error'} dot>
            {data.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')}
          </StatusBadge>
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
