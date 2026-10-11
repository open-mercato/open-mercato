"use client"

import * as React from 'react'
import { Check, Plus, X } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  useAssigneeNames,
  useStaffMemberDirectory,
  useTagDirectory,
  useTagLabels,
  type BoardSelf,
} from './boardDirectory'
import {
  countActiveBoardFilters,
  withAssigneeFilter,
  withStatusFilter,
  withTagFilter,
  withoutTagFilter,
  type BoardFilters,
} from './boardFilters'
import type { BoardStatus } from './kanbanBoardData'

/**
 * The `dt-chips` row of screen 6 and the picker behind it.
 *
 * Modelled on the deals pipeline filter surfaces (`customers/.../pipeline/components`):
 * a popover-backed picker, chips that carry their own removal, one idiom for the whole
 * product. The difference the mockup asks for is the *shape* of the row — the pipeline
 * shows one chip per filter kind with its current value, screen 6 shows one chip per
 * active filter plus a dashed "Dodaj filtr" — so the chrome is shared in spirit rather
 * than by importing a component out of another module's page folder.
 *
 * "Przypisane do mnie" is the first entry in the picker and one click: it is the filter
 * an operator reaches for far more often than any other, so it does not sit behind a
 * person search.
 */

type BoardFilterSurfaceProps = {
  filters: BoardFilters
  onChange: (next: BoardFilters) => void
  self: BoardSelf | null
  statuses: readonly BoardStatus[]
}

function chipClassName(dashed: boolean): string {
  const base =
    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs leading-normal text-foreground'
  return dashed
    ? `${base} border border-dashed border-muted-foreground/60 bg-transparent text-muted-foreground hover:bg-muted/60`
    : `${base} border border-border bg-card`
}

function FilterChip({
  label,
  avatarLabel,
  removeLabel,
  onRemove,
  testId,
}: {
  label: string
  avatarLabel?: string | null
  removeLabel: string
  onRemove: () => void
  testId: string
}): React.ReactElement {
  return (
    <span className={chipClassName(false)} data-testid={testId}>
      {avatarLabel ? <Avatar size="xs" label={avatarLabel} variant="monochrome" /> : null}
      <span className="max-w-48 truncate font-semibold">{label}</span>
      <Button
        type="button"
        variant="ghost"
        size="2xs"
        onClick={onRemove}
        aria-label={removeLabel}
        data-testid={`${testId}-remove`}
        className="size-4 rounded-full p-0 text-muted-foreground hover:text-foreground"
      >
        <X className="size-3" aria-hidden="true" />
      </Button>
    </span>
  )
}

function PickerRow({
  label,
  selected,
  avatarLabel,
  onSelect,
  testId,
}: {
  label: string
  selected: boolean
  avatarLabel?: string | null
  onSelect: () => void
  testId: string
}): React.ReactElement {
  return (
    <Button
      type="button"
      variant="ghost"
      role="checkbox"
      aria-checked={selected}
      onClick={onSelect}
      data-testid={testId}
      className={`h-auto w-full justify-start gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-normal ${
        selected ? 'bg-muted/60' : 'bg-transparent'
      }`}
    >
      {avatarLabel ? <Avatar size="xs" label={avatarLabel} variant="monochrome" /> : null}
      <span className="truncate text-foreground">{label}</span>
      {selected ? <Check className="ml-auto size-3.5 text-muted-foreground" aria-hidden="true" /> : null}
    </Button>
  )
}

export function AddBoardFilterPopover({
  filters,
  onChange,
  self,
  statuses,
  trigger,
  testId = 'board-filter-add',
}: BoardFilterSurfaceProps & {
  trigger: React.ReactNode
  testId?: string
}): React.ReactElement {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const tagDirectory = useTagDirectory(open)
  const memberDirectory = useStaffMemberDirectory(open)

  const tags = tagDirectory.data ?? []
  const otherMembers = React.useMemo(
    () => (memberDirectory.data ?? []).filter((member) => member.id !== self?.id),
    [memberDirectory.data, self?.id],
  )

  const assignedToMeLabel = t('staff.time_tracking.board.filters.assignedToMe', 'Assigned to me')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0" data-testid={`${testId}-popover`}>
        <div className="max-h-96 overflow-y-auto p-2">
          {self ? (
            <PickerRow
              label={assignedToMeLabel}
              avatarLabel={self.displayName ?? assignedToMeLabel}
              selected={filters.assigneeStaffMemberId === self.id}
              testId="board-filter-assigned-to-me"
              onSelect={() => {
                onChange(
                  withAssigneeFilter(
                    filters,
                    filters.assigneeStaffMemberId === self.id ? null : self.id,
                  ),
                )
                setOpen(false)
              }}
            />
          ) : null}

          {otherMembers.length > 0 ? (
            <div className="mt-2 flex flex-col gap-0.5">
              <span className="px-2.5 py-1 text-xs font-semibold uppercase leading-normal tracking-wide text-muted-foreground">
                {t('staff.time_tracking.board.filters.assignee', 'Assignee')}
              </span>
              {otherMembers.map((member) => (
                <PickerRow
                  key={member.id}
                  label={member.displayName}
                  avatarLabel={member.displayName}
                  selected={filters.assigneeStaffMemberId === member.id}
                  testId={`board-filter-assignee-${member.id}`}
                  onSelect={() => {
                    onChange(
                      withAssigneeFilter(
                        filters,
                        filters.assigneeStaffMemberId === member.id ? null : member.id,
                      ),
                    )
                    setOpen(false)
                  }}
                />
              ))}
            </div>
          ) : null}

          {statuses.length > 0 ? (
            <div className="mt-2 flex flex-col gap-0.5">
              <span className="px-2.5 py-1 text-xs font-semibold uppercase leading-normal tracking-wide text-muted-foreground">
                {t('staff.time_tracking.board.filters.status', 'Status')}
              </span>
              {statuses.map((status) => (
                <PickerRow
                  key={status.id}
                  label={status.name}
                  selected={filters.taskStatusId === status.id}
                  testId={`board-filter-status-${status.id}`}
                  onSelect={() => {
                    onChange(
                      withStatusFilter(
                        filters,
                        filters.taskStatusId === status.id ? null : status.id,
                      ),
                    )
                    setOpen(false)
                  }}
                />
              ))}
            </div>
          ) : null}

          {tags.length > 0 ? (
            <div className="mt-2 flex flex-col gap-0.5">
              <span className="px-2.5 py-1 text-xs font-semibold uppercase leading-normal tracking-wide text-muted-foreground">
                {t('staff.time_tracking.board.filters.tag', 'Tag')}
              </span>
              {tags.map((tag) => {
                const selected = filters.tagIds.includes(tag.id)
                return (
                  <PickerRow
                    key={tag.id}
                    label={tag.label}
                    selected={selected}
                    testId={`board-filter-tag-${tag.id}`}
                    onSelect={() => {
                      onChange(
                        selected ? withoutTagFilter(filters, tag.id) : withTagFilter(filters, tag.id),
                      )
                      setOpen(false)
                    }}
                  />
                )
              })}
            </div>
          ) : null}

          {!self && otherMembers.length === 0 && statuses.length === 0 && tags.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-xs leading-normal text-muted-foreground">
              {t('staff.time_tracking.board.filters.noOptions', 'Nothing to filter by yet.')}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function BoardFilterChips({
  filters,
  onChange,
  self,
  statuses,
}: BoardFilterSurfaceProps): React.ReactElement {
  const t = useT()

  const assigneeIds = React.useMemo(
    () =>
      filters.assigneeStaffMemberId && filters.assigneeStaffMemberId !== self?.id
        ? [filters.assigneeStaffMemberId]
        : [],
    [filters.assigneeStaffMemberId, self?.id],
  )
  const assigneeNames = useAssigneeNames(assigneeIds)
  const tagLabels = useTagLabels(filters.tagIds)

  const activeStatus = React.useMemo(
    () => statuses.find((status) => status.id === filters.taskStatusId) ?? null,
    [filters.taskStatusId, statuses],
  )

  const assignedToMeLabel = t('staff.time_tracking.board.filters.assignedToMe', 'Assigned to me')
  const isSelf = !!filters.assigneeStaffMemberId && filters.assigneeStaffMemberId === self?.id
  const assigneeLabel = isSelf
    ? assignedToMeLabel
    : filters.assigneeStaffMemberId
      ? assigneeNames.data?.get(filters.assigneeStaffMemberId) ?? filters.assigneeStaffMemberId
      : null

  const removeLabel = React.useCallback(
    (label: string) =>
      t('staff.time_tracking.board.filters.remove', 'Remove filter: {label}', { label }),
    [t],
  )

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="board-filter-chips">
      {assigneeLabel ? (
        <FilterChip
          label={assigneeLabel}
          avatarLabel={isSelf ? self?.displayName ?? assignedToMeLabel : assigneeLabel}
          removeLabel={removeLabel(assigneeLabel)}
          testId="board-filter-chip-assignee"
          onRemove={() => onChange(withAssigneeFilter(filters, null))}
        />
      ) : null}

      {activeStatus ? (
        <FilterChip
          label={activeStatus.name}
          removeLabel={removeLabel(activeStatus.name)}
          testId="board-filter-chip-status"
          onRemove={() => onChange(withStatusFilter(filters, null))}
        />
      ) : null}

      {filters.tagIds.map((tagId) => {
        const label = tagLabels.data?.get(tagId) ?? tagId
        return (
          <FilterChip
            key={tagId}
            label={label}
            removeLabel={removeLabel(label)}
            testId={`board-filter-chip-tag-${tagId}`}
            onRemove={() => onChange(withoutTagFilter(filters, tagId))}
          />
        )
      })}

      <AddBoardFilterPopover
        filters={filters}
        onChange={onChange}
        self={self}
        statuses={statuses}
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="board-filter-add-chip"
            className={`h-auto ${chipClassName(true)}`}
          >
            <Plus className="size-3" aria-hidden="true" />
            {t('staff.time_tracking.board.filters.add', 'Add filter')}
          </Button>
        }
      />

      {countActiveBoardFilters(filters) > 1 ? (
        <Button
          type="button"
          variant="link"
          size="2xs"
          onClick={() => onChange({ assigneeStaffMemberId: null, taskStatusId: null, tagIds: [] })}
          data-testid="board-filter-clear"
          className="h-auto px-1 text-xs leading-normal text-muted-foreground hover:text-foreground"
        >
          {t('staff.time_tracking.board.filters.clear', 'Clear filters')}
        </Button>
      ) : null}
    </div>
  )
}

export default BoardFilterChips
