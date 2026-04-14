'use client'

import * as React from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Button } from '@open-mercato/ui/primitives/button'
import type { DictionaryEntryOption } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'
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
  const [initialRoleType, setInitialRoleType] = React.useState<string | null>(null)
  const hasConfiguredRoleTypes = roleTypes.length > 0

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
    let active = true

    readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
      '/api/customers/dictionaries/person-company-roles',
    )
      .then((payload) => {
        if (!active) return
        const entries = (Array.isArray(payload?.items) ? payload.items : [])
          .map((item) => {
            const id = typeof item.id === 'string' ? item.id : null
            const value = typeof item.value === 'string' ? item.value.trim() : ''
            if (!id || value.length === 0) return null
            return {
              id,
              value,
              label:
                typeof item.label === 'string' && item.label.trim().length > 0
                  ? item.label.trim()
                  : value,
              color: typeof item.color === 'string' ? item.color : null,
              icon: typeof item.icon === 'string' ? item.icon : null,
            } satisfies DictionaryEntryOption
          })
          .filter((entry): entry is DictionaryEntryOption => entry !== null)

        setRoleTypes(entries)
      })
      .catch((error) => {
        if (!active) return
        console.error('customers.roles.roleTypes failed', error)
        setRoleTypes([])
      })

    return () => {
      active = false
    }
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

  const cards = React.useMemo(() => {
    const roleByType = new Map(roles.map((role) => [role.roleType, role]))
    const configuredCards = roleTypes.map((roleType) => ({
      roleType: roleType.value,
      roleTypeLabel: roleType.label,
      role: roleByType.get(roleType.value) ?? null,
    }))
    const configuredRoleTypes = new Set(roleTypes.map((roleType) => roleType.value))
    const extraAssignedCards = roles
      .filter((role) => !configuredRoleTypes.has(role.roleType))
      .map((role) => ({
        roleType: role.roleType,
        roleTypeLabel: getRoleTypeLabel(role.roleType),
        role,
      }))

    return [...configuredCards, ...extraAssignedCards]
  }, [getRoleTypeLabel, roleTypes, roles])

  const openDialog = React.useCallback((roleType?: string | null) => {
    if (!hasConfiguredRoleTypes) return
    setInitialRoleType(roleType ?? null)
    setDialogOpen(true)
  }, [hasConfiguredRoleTypes])

  if (loading) {
    return (
      <div className="py-2 text-sm text-muted-foreground">
        {t('customers.roles.loading', 'Loading roles...')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="text-sm font-semibold">{t('customers.roles.groupTitle', 'Roles')}</div>
        <p className="text-xs text-muted-foreground">
          {entityType === 'company'
            ? t('customers.roles.subtitle.company', 'Who is responsible for this company on your side')
            : t('customers.roles.subtitle.person', 'Who owns the relationship on your side')}
        </p>
      </div>

      {cards.length > 0 ? (
        <div
          className="grid items-start gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 18rem), 1fr))' }}
        >
          {cards.map((entry) =>
            entry.role ? (
              <RoleAssignmentRow
                key={entry.role.id}
                role={entry.role}
                roleTypeLabel={entry.roleTypeLabel}
                runMutationWithContext={runMutationWithContext}
                entityType={entityType}
                entityId={entityId}
                onRemoved={loadRoles}
                onUpdated={loadRoles}
              />
            ) : (
              <div key={entry.roleType} className="flex h-full min-w-0 flex-col rounded-xl border border-dashed bg-muted/20 p-4">
                <div className="break-words text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {entry.roleTypeLabel}
                </div>
                <div className="mt-4 text-sm font-medium text-foreground">
                  {t('customers.roles.emptySlot', 'Not assigned')}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('customers.roles.emptyState', 'No roles assigned yet. Click below to assign a person.')}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4 self-start"
                  onClick={() => openDialog(entry.roleType)}
                >
                  {t('customers.roles.choosePerson', 'Choose person')}
                </Button>
              </div>
            ),
          )}
        </div>
      ) : hasConfiguredRoleTypes ? (
        <div className="rounded-lg border border-dashed p-4 text-center">
          <p className="text-xs text-muted-foreground">
            {t('customers.roles.emptyState', 'No roles assigned yet. Click below to assign a person.')}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => openDialog(null)}
          >
            {t('customers.roles.choosePerson', 'Choose person')}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-4 text-center">
          <div className="text-sm font-medium text-foreground">
            {t('customers.roles.noRoleTypesTitle', 'No role types configured')}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t(
              'customers.roles.noRoleTypesDescription',
              'Create role types in Customers config before assigning owners here.',
            )}
          </p>
          <Button asChild type="button" variant="outline" size="sm" className="mt-3">
            <Link href="/backend/config/customers">
              {t('customers.roles.configureRoleTypes', 'Configure role types')}
            </Link>
          </Button>
        </div>
      )}

      {hasConfiguredRoleTypes ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => openDialog(null)}
        >
          <Plus className="mr-1 size-3.5" />
          {t('customers.roles.addRole', 'Add role')}
        </Button>
      ) : (
        <Button asChild type="button" variant="ghost" size="sm">
          <Link href="/backend/config/customers">
            {t('customers.roles.configureRoleTypes', 'Configure role types')}
          </Link>
        </Button>
      )}

      <AssignRoleDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false)
          setInitialRoleType(null)
        }}
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
        existingAssignments={roles}
        initialRoleType={initialRoleType}
      />
    </div>
  )
}
