'use client'

import * as React from 'react'
import { Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Button } from '@open-mercato/ui/primitives/button'
import { loadDictionaryEntriesByKey, type DictionaryEntryOption } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'
import { RoleAssignmentRow, type RoleAssignment } from './RoleAssignmentRow'
import { AssignRoleDialog } from './AssignRoleDialog'

interface RolesSectionProps {
  entityType: 'company' | 'person'
  entityId: string
  entityName?: string | null
}

type GuardedMutationRunner = <T,>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

export function RolesSection({ entityType, entityId, entityName }: RolesSectionProps) {
  const t = useT()
  const [roles, setRoles] = React.useState<RoleAssignment[]>([])
  const [roleTypes, setRoleTypes] = React.useState<DictionaryEntryOption[]>([])
  const [loading, setLoading] = React.useState(true)
  const [dialogOpen, setDialogOpen] = React.useState(false)

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

  const assignedRoleTypes = React.useMemo(
    () => new Set(roles.map((role) => role.roleType)),
    [roles],
  )

  const handleDialogAssign = React.useCallback(async (roleType: string, userId: string) => {
    await runMutationWithContext(
      () =>
        apiCallOrThrow(`/api/customers/${basePath}/${entityId}/roles`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ roleType, userId }),
        }),
      { roleType, userId },
    )
    flash(t('customers.roles.assigned', 'Role assigned'), 'success')
    await loadRoles()
  }, [basePath, entityId, loadRoles, runMutationWithContext, t])

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
      {roles.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t('customers.roles.subtitle', 'Multi-role assignment for this entity')}
        </p>
      )}
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

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setDialogOpen(true)}
      >
        <Plus className="mr-1 size-3.5" />
        {t('customers.roles.addRole', 'Add role')}
      </Button>

      <AssignRoleDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onAssign={handleDialogAssign}
        roleTypes={roleTypes}
        entityName={
          entityName && entityName.trim().length
            ? entityName
            : entityType === 'company'
              ? t('customers.roles.dialog.defaultEntity.company', 'this company')
              : t('customers.roles.dialog.defaultEntity.person', 'this person')
        }
        existingRoleTypes={assignedRoleTypes}
      />
    </div>
  )
}
