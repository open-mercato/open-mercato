'use client'

import * as React from 'react'
import { Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Button } from '@open-mercato/ui/primitives/button'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { loadDictionaryEntriesByKey, type DictionaryEntryOption } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'
import { RoleAssignmentRow, type RoleAssignment } from './RoleAssignmentRow'

interface RolesSectionProps {
  entityType: 'company' | 'person'
  entityId: string
}

type GuardedMutationRunner = <T,>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

export function RolesSection({ entityType, entityId }: RolesSectionProps) {
  const t = useT()
  const [roles, setRoles] = React.useState<RoleAssignment[]>([])
  const [roleTypes, setRoleTypes] = React.useState<DictionaryEntryOption[]>([])
  const [loading, setLoading] = React.useState(true)
  const [adding, setAdding] = React.useState(false)
  const [newRoleType, setNewRoleType] = React.useState('')
  const [newUserId, setNewUserId] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const basePath = entityType === 'company' ? 'companies' : 'people'
  const resourceKind = entityType === 'company' ? 'customers.company' : 'customers.person'
  const mutationContextId = React.useMemo(
    () => `customer-roles:${entityType}:${entityId}`,
    [entityId, entityType],
  )
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    entityType: 'company' | 'person'
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = React.useMemo(
    () => ({
      formId: mutationContextId,
      resourceKind,
      resourceId: entityId,
      entityType,
      retryLastMutation,
    }),
    [entityId, entityType, mutationContextId, resourceKind, retryLastMutation],
  )
  const runMutationWithContext = React.useCallback<GuardedMutationRunner>(
    async <T,>(operation: () => Promise<T>, mutationPayload?: Record<string, unknown>) => {
      return runMutation({
        operation,
        mutationPayload,
        context: mutationContext,
      })
    },
    [mutationContext, runMutation],
  )

  const loadRoles = React.useCallback(async () => {
    try {
      const data = await readApiResultOrThrow<{ items?: RoleAssignment[] }>(
        `/api/customers/${basePath}/${entityId}/roles`,
      )
      setRoles(Array.isArray(data?.items) ? data.items : [])
    } catch (error) {
      console.error('customers.roles.load failed', error)
      setRoles([])
    }
    setLoading(false)
  }, [basePath, entityId])

  React.useEffect(() => {
    loadRoles()
  }, [loadRoles])

  React.useEffect(() => {
    loadDictionaryEntriesByKey('customer-role-types')
      .then((entries) => {
        setRoleTypes(entries)
      })
      .catch((error) => {
        console.error('customers.roles.roleTypes failed', error)
        setRoleTypes([])
      })
  }, [])

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

  const assignedRoleTypes = React.useMemo(
    () => new Set(roles.map((role) => role.roleType)),
    [roles],
  )

  const availableRoleTypes = React.useMemo(
    () => roleTypes.filter((roleType) => !assignedRoleTypes.has(roleType.value)),
    [assignedRoleTypes, roleTypes],
  )

  const handleAdd = React.useCallback(async () => {
    if (!newRoleType || !newUserId) return
    setSaving(true)
    try {
      await runMutationWithContext(
        () =>
          apiCallOrThrow(`/api/customers/${basePath}/${entityId}/roles`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ roleType: newRoleType, userId: newUserId }),
          }),
        { roleType: newRoleType, userId: newUserId },
      )
      flash(t('customers.roles.assigned', 'Role assigned'), 'success')
      setAdding(false)
      setNewRoleType('')
      setNewUserId(null)
      await loadRoles()
    } catch (error) {
      console.error('customers.roles.assign failed', error)
      flash(t('customers.roles.assignError', 'Failed to assign role'), 'error')
    }
    setSaving(false)
  }, [basePath, entityId, loadRoles, newRoleType, newUserId, runMutationWithContext, t])

  const getRoleTypeLabel = React.useCallback(
    (value: string) => roleTypes.find((roleType) => roleType.value === value)?.label ?? value,
    [roleTypes],
  )

  if (loading) {
    return (
      <div className="py-2 text-sm text-muted-foreground">
        {t('customers.roles.loading', 'Loading roles...')}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {roles.map((role) => (
        <RoleAssignmentRow
          key={role.id}
          role={role}
          roleTypeLabel={getRoleTypeLabel(role.roleType)}
          runMutationWithContext={runMutationWithContext}
          entityType={entityType}
          entityId={entityId}
          onRemoved={loadRoles}
          onUpdated={loadRoles}
        />
      ))}

      {adding ? (
        <div className="space-y-2 rounded-md border border-dashed p-3">
          <div>
            <label className="text-xs text-muted-foreground">
              {t('customers.roles.roleTypeLabel', 'Role type')}
            </label>
            <select
              value={newRoleType}
              onChange={(event) => setNewRoleType(event.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">
                {t('customers.roles.selectRoleType', 'Select role type...')}
              </option>
              {availableRoleTypes.map((roleType) => (
                <option key={roleType.id} value={roleType.value}>
                  {roleType.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">
              {t('customers.roles.userLabel', 'Assign to')}
            </label>
            <div className="mt-1">
              <LookupSelect
                value={newUserId}
                fetchItems={searchUsers}
                onChange={setNewUserId}
                searchPlaceholder={t('customers.roles.searchUser', 'Search staff...')}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAdding(false)
                setNewRoleType('')
                setNewUserId(null)
              }}
            >
              {t('customers.roles.cancelAdd', 'Cancel')}
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleAdd}
              disabled={saving || !newRoleType || !newUserId}
            >
              {saving
                ? t('customers.roles.assigning', 'Assigning...')
                : t('customers.roles.assign', 'Assign')}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setAdding(true)}
          disabled={availableRoleTypes.length === 0}
        >
          <Plus className="mr-1 size-3.5" />
          {t('customers.roles.addRole', 'Add role')}
        </Button>
      )}
    </div>
  )
}
