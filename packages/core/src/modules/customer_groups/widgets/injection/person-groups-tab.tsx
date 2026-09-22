"use client"

import * as React from 'react'
import { Plus, Trash2, Users } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { createCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import {
  StatusBadge,
  type StatusBadgeVariant,
  type StatusMap,
} from '@open-mercato/ui/primitives/status-badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { mapListItemsToSummaries, type CustomerGroupSummary } from '../../components/customerGroupTree'
import { PersonGroupsExplainTerms } from './person-groups-explain-terms'

const PERSON_GROUPS_RESOURCE_KINDS = new Set(['customers.person', 'customers.company'])

type PersonGroupsTabContext = {
  resourceKind: string
  resourceId: string
}

type MembershipRow = {
  id: string
  groupId: string
  validFrom: string | null
  validUntil: string | null
  updatedAt: string | null
}

type MembershipStatus = 'current' | 'upcoming' | 'expired'

type AssignFormValues = {
  groupId: string
  validFrom: string
  validUntil: string
}

const MEMBERSHIP_STATUS_BADGE_VARIANTS: StatusMap<MembershipStatus> = {
  current: 'success',
  upcoming: 'info',
  expired: 'neutral',
}

function isValidContext(ctx: unknown): ctx is PersonGroupsTabContext {
  if (!ctx || typeof ctx !== 'object') return false
  const candidate = ctx as { resourceKind?: unknown; resourceId?: unknown }
  if (typeof candidate.resourceKind !== 'string' || !PERSON_GROUPS_RESOURCE_KINDS.has(candidate.resourceKind)) return false
  return typeof candidate.resourceId === 'string' && candidate.resourceId.trim().length > 0
}

// The `/api/customer_groups/customer-groups/memberships` list route returns the query-index column
// projection (snake_case keys, e.g. `group_id`, `valid_from`) rather than a camelCase
// shape — see `api/customer-groups/memberships/crud.ts` `customerGroupMembershipListFields`.
// Accept both spellings so this keeps working if that ever changes, mirroring
// `components/customerGroupTree.ts`'s `readNullableId`/`readBoolean` helpers.
function readStringField(record: Record<string, unknown>, camelKey: string, snakeKey: string): string {
  const camel = record[camelKey]
  if (typeof camel === 'string' && camel.length) return camel
  const snake = record[snakeKey]
  if (typeof snake === 'string' && snake.length) return snake
  return ''
}

function readNullableStringField(record: Record<string, unknown>, camelKey: string, snakeKey: string): string | null {
  const camel = record[camelKey]
  if (typeof camel === 'string' && camel.length) return camel
  const snake = record[snakeKey]
  if (typeof snake === 'string' && snake.length) return snake
  return null
}

function mapMembershipItem(item: unknown): MembershipRow | null {
  if (!item || typeof item !== 'object') return null
  const record = item as Record<string, unknown>
  const id = readStringField(record, 'id', 'id')
  if (!id) return null
  const groupId = readStringField(record, 'groupId', 'group_id')
  if (!groupId) return null
  return {
    id,
    groupId,
    validFrom: readNullableStringField(record, 'validFrom', 'valid_from'),
    validUntil: readNullableStringField(record, 'validUntil', 'valid_until'),
    updatedAt: readNullableStringField(record, 'updatedAt', 'updated_at'),
  }
}

function mapMembershipItems(items: unknown): MembershipRow[] {
  if (!Array.isArray(items)) return []
  return items.reduce<MembershipRow[]>((acc, item) => {
    const row = mapMembershipItem(item)
    if (row) acc.push(row)
    return acc
  }, [])
}

// current: now falls within [validFrom, validUntil] (or either/both are unset).
// upcoming: validFrom is in the future.
// expired: validUntil is in the past. Checked before `upcoming` so a row with an
// inconsistent/legacy validFrom-in-future + validUntil-in-past pair still reads
// as expired (a membership that has ended can never be "upcoming" again).
function computeMembershipStatus(row: MembershipRow, now: Date): MembershipStatus {
  const validFrom = row.validFrom ? new Date(row.validFrom) : null
  const validUntil = row.validUntil ? new Date(row.validUntil) : null
  if (validUntil && validUntil.getTime() < now.getTime()) return 'expired'
  if (validFrom && validFrom.getTime() > now.getTime()) return 'upcoming'
  return 'current'
}

const MEMBERSHIP_STATUS_RANK: Record<MembershipStatus, number> = {
  current: 0,
  upcoming: 1,
  expired: 2,
}

function MembershipRowItem({
  row,
  status,
  groupLabel,
  onRemove,
}: {
  row: MembershipRow
  status: MembershipStatus
  groupLabel: string
  onRemove: (row: MembershipRow, groupLabel: string) => void
}) {
  const t = useT()
  const statusLabel = t(`customer_groups.groups.personTab.status.${status}`, status)
  const statusVariant: StatusBadgeVariant = MEMBERSHIP_STATUS_BADGE_VARIANTS[status]
  const validFromLabel = formatDateTime(row.validFrom)
  const validUntilLabel = formatDateTime(row.validUntil)
  const rangeLabel = validFromLabel && validUntilLabel
    ? t('customer_groups.groups.personTab.validRange', '{from} – {until}', { from: validFromLabel, until: validUntilLabel })
    : validFromLabel
      ? t('customer_groups.groups.personTab.validFromOnly', 'From {from}', { from: validFromLabel })
      : validUntilLabel
        ? t('customer_groups.groups.personTab.validUntilOnly', 'Until {until}', { until: validUntilLabel })
        : t('customer_groups.groups.personTab.noExpiration', 'No expiration')

  return (
    <li className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{groupLabel}</span>
            <StatusBadge variant={statusVariant} dot>{statusLabel}</StatusBadge>
          </div>
          <div className="text-xs text-muted-foreground">{rangeLabel}</div>
        </div>
        {status !== 'expired' ? (
          <IconButton
            type="button"
            variant="ghost"
            size="xs"
            aria-label={t('customer_groups.groups.personTab.remove', 'Remove from group')}
            onClick={() => onRemove(row, groupLabel)}
          >
            <Trash2 className="size-4" aria-hidden />
          </IconButton>
        ) : null}
      </div>
    </li>
  )
}

export function PersonGroupsTabWidget({
  context,
}: InjectionWidgetComponentProps<unknown, unknown>) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [groups, setGroups] = React.useState<CustomerGroupSummary[]>([])
  const [memberships, setMemberships] = React.useState<MembershipRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [assignDialogOpen, setAssignDialogOpen] = React.useState(false)
  const [formInstanceKey, setFormInstanceKey] = React.useState(0)

  const customerId = isValidContext(context) ? context.resourceId : null

  const load = React.useCallback(async () => {
    if (!customerId) return
    setLoading(true)
    setError(null)
    try {
      const [groupsRes, membershipsRes] = await Promise.all([
        apiCall<{ items?: unknown[] }>('/api/customer_groups/customer-groups?pageSize=100'),
        apiCall<{ items?: unknown[] }>(`/api/customer_groups/customer-groups/memberships?customerId=${encodeURIComponent(customerId)}&pageSize=100`),
      ])
      if (groupsRes.ok && groupsRes.result) {
        setGroups(mapListItemsToSummaries(groupsRes.result.items))
      } else if (groupsRes.status === 403) {
        setGroups([])
      } else {
        throw new Error('groups')
      }
      if (membershipsRes.ok && membershipsRes.result) {
        setMemberships(mapMembershipItems(membershipsRes.result.items))
      } else if (membershipsRes.status === 403) {
        setMemberships([])
      } else {
        throw new Error('memberships')
      }
    } catch {
      setError(t('customer_groups.groups.personTab.errors.load', 'Failed to load group memberships.'))
    } finally {
      setLoading(false)
    }
  }, [customerId, t])

  React.useEffect(() => {
    load()
  }, [load])

  React.useEffect(() => {
    if (assignDialogOpen) setFormInstanceKey((current) => current + 1)
  }, [assignDialogOpen])

  const groupsById = React.useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups])
  const memberGroupIds = React.useMemo(() => new Set(memberships.map((row) => row.groupId)), [memberships])

  const rows = React.useMemo(() => {
    const now = new Date()
    return memberships
      .map((row) => ({ row, status: computeMembershipStatus(row, now) }))
      .sort((a, b) => MEMBERSHIP_STATUS_RANK[a.status] - MEMBERSHIP_STATUS_RANK[b.status])
  }, [memberships])

  const groupLabelFor = React.useCallback(
    (groupId: string) => {
      const group = groupsById.get(groupId)
      return group ? `${group.name} (${group.code})` : groupId
    },
    [groupsById],
  )

  const assignFields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'groupId',
        label: t('customer_groups.groups.personTab.form.group', 'Group'),
        type: 'combobox',
        allowCustomValues: false,
        options: groups.map((group) => ({ value: group.id, label: `${group.name} (${group.code})` })),
        placeholder: t('customer_groups.groups.personTab.form.groupPlaceholder', 'Select a group…'),
      },
      {
        id: 'validFrom',
        label: t('customer_groups.groups.personTab.form.validFrom', 'Valid from'),
        type: 'datetime',
        layout: 'half',
      },
      {
        id: 'validUntil',
        label: t('customer_groups.groups.personTab.form.validUntil', 'Valid until'),
        type: 'datetime',
        layout: 'half',
        description: t('customer_groups.groups.personTab.form.validUntilHelp', 'Leave empty for no expiration.'),
      },
    ],
    [groups, t],
  )

  const assignInitialValues = React.useMemo<Partial<AssignFormValues>>(
    () => ({
      groupId: '',
      validFrom: new Date().toISOString(),
      validUntil: '',
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute the "now" default
    // whenever the dialog is (re)opened, keyed by the remount counter below.
    [formInstanceKey],
  )

  const handleAssignSubmit = React.useCallback(
    async (values: AssignFormValues) => {
      if (!customerId) return
      const groupId = typeof values.groupId === 'string' ? values.groupId.trim() : ''
      if (!groupId) {
        const message = t('customer_groups.groups.personTab.errors.groupRequired', 'Select a group.')
        throw createCrudFormError(message, { groupId: message })
      }
      if (memberGroupIds.has(groupId)) {
        const message = t(
          'customer_groups.groups.personTab.errors.duplicateMembership',
          'This customer is already a member of this group.',
        )
        throw createCrudFormError(message, { groupId: message })
      }
      const payload: Record<string, unknown> = {
        groupId,
        customerId,
        validFrom: values.validFrom && values.validFrom.trim().length ? values.validFrom : undefined,
        validUntil: values.validUntil && values.validUntil.trim().length ? values.validUntil : undefined,
      }
      try {
        await createCrud('customer_groups/customer-groups/memberships', payload, {
          errorMessage: t('customer_groups.groups.personTab.errors.assignFailed', 'Failed to assign group.'),
        })
      } catch (err) {
        const status = err && typeof err === 'object' ? (err as { status?: unknown }).status : undefined
        if (status === 409) {
          const message = t(
            'customer_groups.groups.personTab.errors.duplicateMembership',
            'This customer is already a member of this group.',
          )
          throw createCrudFormError(message, { groupId: message })
        }
        throw err
      }
      setAssignDialogOpen(false)
      flash(t('customer_groups.groups.personTab.assignSuccess', 'Group assigned.'), 'success')
      await load()
    },
    [customerId, load, memberGroupIds, t],
  )

  const handleRemove = React.useCallback(
    async (row: MembershipRow, groupLabel: string) => {
      const approved = await confirm({
        title: t('customer_groups.groups.personTab.removeConfirmTitle', 'Remove from group?'),
        description: t(
          'customer_groups.groups.personTab.removeConfirmDescription',
          'Remove this customer from {group}?',
          { group: groupLabel },
        ),
        confirmText: t('customer_groups.groups.personTab.removeConfirmAction', 'Remove'),
        cancelText: t('customer_groups.groups.personTab.removeCancelAction', 'Cancel'),
        variant: 'destructive',
      })
      if (!approved) return
      try {
        await withScopedApiRequestHeaders(
          buildOptimisticLockHeader(row.updatedAt),
          () => deleteCrud('customer_groups/customer-groups/memberships', row.id),
        )
      } catch (err) {
        if (!surfaceRecordConflict(err, t)) {
          flash(
            err instanceof Error && err.message.trim().length > 0
              ? err.message
              : t('customer_groups.groups.personTab.errors.removeFailed', 'Failed to remove group membership.'),
            'error',
          )
        }
        return
      }
      flash(t('customer_groups.groups.personTab.removeSuccess', 'Group membership removed.'), 'success')
      await load()
    },
    [confirm, load, t],
  )

  if (!customerId) return null

  const countLabel = t('customer_groups.groups.personTab.count', '{count} groups', { count: memberships.length })

  return (
    <div className="space-y-3">
      {ConfirmDialogElement}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1.5">
            <Users className="size-4" aria-hidden />
            {countLabel}
          </Badge>
        </div>
        <Button type="button" size="sm" onClick={() => setAssignDialogOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          {t('customer_groups.groups.personTab.assign', 'Assign to group')}
        </Button>
      </div>

      {loading ? (
        <LoadingMessage label={t('customer_groups.groups.personTab.loading', 'Loading group memberships…')} />
      ) : error ? (
        <ErrorMessage label={error} />
      ) : rows.length === 0 ? (
        <EmptyState
          size="sm"
          variant="subtle"
          icon={<Users className="h-5 w-5" aria-hidden />}
          title={t('customer_groups.groups.personTab.empty.title', 'No group memberships yet')}
          description={t(
            'customer_groups.groups.personTab.empty.description',
            'Assign this customer to a group to apply group-based pricing and terms.',
          )}
          actions={(
            <Button type="button" size="sm" variant="outline" onClick={() => setAssignDialogOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('customer_groups.groups.personTab.assign', 'Assign to group')}
            </Button>
          )}
          className="border border-dashed border-border"
        />
      ) : (
        <ul
          className="space-y-2"
          aria-label={t('customer_groups.groups.personTab.listLabel', 'Group memberships')}
        >
          {rows.map(({ row, status }) => (
            <MembershipRowItem
              key={row.id}
              row={row}
              status={status}
              groupLabel={groupLabelFor(row.groupId)}
              onRemove={handleRemove}
            />
          ))}
        </ul>
      )}

      <PersonGroupsExplainTerms customerId={customerId} />

      <Dialog
        open={assignDialogOpen}
        onOpenChange={(next) => {
          if (!next) setAssignDialogOpen(false)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('customer_groups.groups.personTab.assignDialog.title', 'Assign to group')}</DialogTitle>
          </DialogHeader>
          <CrudForm<AssignFormValues>
            key={formInstanceKey}
            embedded
            fields={assignFields}
            initialValues={assignInitialValues}
            submitLabel={t('customer_groups.groups.personTab.assignDialog.submit', 'Assign')}
            onSubmit={handleAssignSubmit}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default PersonGroupsTabWidget
