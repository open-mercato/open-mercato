'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'

interface RoleAssignment {
  id: string
  roleType: string
  userId: string
  userName?: string
  userEmail?: string
}

interface RoleAssignmentRowProps {
  role: RoleAssignment
  roleTypeLabel: string
  runMutationWithContext: <T,>(
    operation: () => Promise<T>,
    mutationPayload?: Record<string, unknown>,
  ) => Promise<T>
  entityType: 'company' | 'person'
  entityId: string
  onRemoved: () => void
  onUpdated: () => void
}

export function RoleAssignmentRow({
  role,
  roleTypeLabel,
  runMutationWithContext,
  entityType,
  entityId,
  onRemoved,
  onUpdated,
}: RoleAssignmentRowProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [removing, setRemoving] = React.useState(false)

  const searchUsers = React.useCallback(async (query: string): Promise<LookupSelectItem[]> => {
    try {
      const data = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
        `/api/staff/team-members?search=${encodeURIComponent(query)}&pageSize=20&isActive=true`,
      )
      const rawItems = Array.isArray(data?.items) ? data.items : []
      const deduped = new Map<string, LookupSelectItem>()
      for (const item of rawItems) {
        const userId =
          typeof item?.userId === 'string'
            ? item.userId
            : typeof item?.user_id === 'string'
              ? item.user_id
              : null
        if (!userId || deduped.has(userId)) continue
        const displayName =
          typeof item?.displayName === 'string' && item.displayName.trim().length
            ? item.displayName
            : typeof item?.display_name === 'string' && item.display_name.trim().length
              ? item.display_name
              : null
        const user =
          item?.user && typeof item.user === 'object'
            ? (item.user as Record<string, unknown>)
            : null
        const email =
          user && typeof user.email === 'string' && user.email.trim().length
            ? user.email
            : null
        deduped.set(userId, {
          id: userId,
          title: displayName ?? email ?? userId,
          subtitle: displayName && email ? email : null,
        })
      }
      return Array.from(deduped.values())
    } catch (error) {
      console.error('customers.roles.searchUsers failed', error)
      return []
    }
  }, [])

  const handleUserChange = React.useCallback(async (userId: string | null) => {
    if (!userId || userId === role.userId) return
    const basePath = entityType === 'company' ? 'companies' : 'people'
    try {
      await runMutationWithContext(
        () =>
          apiCallOrThrow(`/api/customers/${basePath}/${entityId}/roles?roleId=${role.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ userId }),
          }),
        { roleId: role.id, userId },
      )
      onUpdated()
    } catch (error) {
      console.error('customers.roles.update failed', error)
    }
  }, [entityId, entityType, onUpdated, role.id, role.userId, runMutationWithContext])

  const handleRemove = React.useCallback(async () => {
    const confirmed = await confirm({
      title: t('customers.roles.removeConfirm', 'Remove this role assignment?'),
      variant: 'default',
    })
    if (!confirmed) return

    setRemoving(true)
    const basePath = entityType === 'company' ? 'companies' : 'people'
    try {
      await runMutationWithContext(
        () =>
          apiCallOrThrow(`/api/customers/${basePath}/${entityId}/roles?roleId=${role.id}`, {
            method: 'DELETE',
          }),
        { roleId: role.id },
      )
      onRemoved()
    } catch (error) {
      console.error('customers.roles.remove failed', error)
    }
    setRemoving(false)
  }, [confirm, entityId, entityType, onRemoved, role.id, runMutationWithContext, t])

  const currentUserOptions = React.useMemo<LookupSelectItem[]>(
    () =>
      role.userId
        ? [{
            id: role.userId,
            title: role.userName ?? role.userEmail ?? role.userId,
            subtitle: role.userName && role.userEmail ? role.userEmail : null,
          }]
        : [],
    [role.userEmail, role.userId, role.userName],
  )

  return (
    <>
      {ConfirmDialogElement}
      <div className="flex items-center gap-3">
        <span className="min-w-[120px] shrink-0 text-sm text-muted-foreground">
          {roleTypeLabel}:
        </span>
        <div className="min-w-0 flex-1">
          <LookupSelect
            value={role.userId}
            options={currentUserOptions}
            fetchItems={searchUsers}
            onChange={handleUserChange}
            searchPlaceholder={t('customers.roles.assignPlaceholder', 'Search staff...')}
          />
        </div>
        <IconButton
          type="button"
          variant="ghost"
          size="xs"
          onClick={handleRemove}
          disabled={removing}
          aria-label={t('customers.roles.remove', 'Remove role')}
        >
          <X className="size-3.5" />
        </IconButton>
      </div>
    </>
  )
}

export type { RoleAssignment }
