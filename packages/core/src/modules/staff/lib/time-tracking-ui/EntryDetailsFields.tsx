"use client"

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TagPicker, tagChipStyle } from './TagPicker'
import type { TagOption } from './timeEntryDialogState'

/**
 * The optional half of logging time: description, date, clocks, billable, tags.
 *
 * Shared rather than duplicated, because three surfaces log time — the task
 * drawer, "My work" and the full dialog — and the first two had already drifted
 * into offering different subsets of the same fields. A person who learns that
 * the drawer can back-date an entry should not discover that the identical row on
 * "My work" cannot.
 *
 * Collapsed by default everywhere. The fast path is a duration and a task, and
 * that path stays one keystroke.
 */

export type EntryDetailsValue = {
  description: string
  date: string
  startClock: string
  endClock: string
  isBillable: boolean
  tagIds: string[]
}

export type EntryDetailsFieldsProps = {
  value: EntryDetailsValue
  onChange: (next: EntryDetailsValue) => void
  tagOptions: TagOption[]
  onCreateTag: (label: string) => Promise<TagOption | null>
  disabled?: boolean
  idPrefix: string
  /** Rendered open, for hosts where the details are the point rather than the exception. */
  defaultExpanded?: boolean
}

export function EntryDetailsFields({
  value,
  onChange,
  tagOptions,
  onCreateTag,
  disabled,
  idPrefix,
  defaultExpanded,
}: EntryDetailsFieldsProps) {
  const t = useT()
  const [expanded, setExpanded] = React.useState(defaultExpanded === true)

  const patch = React.useCallback(
    (next: Partial<EntryDetailsValue>) => onChange({ ...value, ...next }),
    [onChange, value],
  )

  const assigned = React.useMemo(() => {
    const byId = new Map(tagOptions.map((tag) => [tag.id, tag]))
    return value.tagIds.map((id) => byId.get(id) ?? { id, label: id, color: null })
  }, [tagOptions, value.tagIds])

  const available = React.useMemo(
    () => tagOptions.filter((tag) => !value.tagIds.includes(tag.id)),
    [tagOptions, value.tagIds],
  )

  return (
    <div className="flex w-full flex-col gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        data-testid={`${idPrefix}-details-toggle`}
      >
        <ChevronDown
          className={`size-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
        {t('staff.time_tracking.taskDrawer.quickLog.details', 'Details')}
      </Button>

      {expanded ? (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor={`${idPrefix}-description`}>
              {t('staff.time_tracking.entryDialog.description', 'Description')}
            </label>
            <Input
              id={`${idPrefix}-description`}
              value={value.description}
              disabled={disabled}
              size="sm"
              maxLength={2000}
              onChange={(event) => patch({ description: event.target.value })}
              placeholder={t(
                'staff.time_tracking.taskDrawer.quickLog.descriptionPlaceholder',
                'What did the time go on?',
              )}
              data-testid={`${idPrefix}-description`}
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor={`${idPrefix}-date`}>
                {t('staff.time_tracking.entryDialog.date', 'Date')}
              </label>
              <Input
                id={`${idPrefix}-date`}
                type="date"
                value={value.date}
                disabled={disabled}
                size="sm"
                className="w-40"
                onChange={(event) => patch({ date: event.target.value })}
                data-testid={`${idPrefix}-date`}
              />
            </div>
            {/*
              * Optional and paired. A start with no end is not a partial record —
              * it is how the entries list identifies a *running timer* — so the
              * caller derives the missing half from the duration before saving.
              */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor={`${idPrefix}-start`}>
                {t('staff.time_tracking.entryDialog.start', 'Start')}
              </label>
              <Input
                id={`${idPrefix}-start`}
                type="time"
                value={value.startClock}
                disabled={disabled}
                size="sm"
                className="w-28"
                inputClassName="font-mono tabular-nums"
                onChange={(event) => patch({ startClock: event.target.value })}
                data-testid={`${idPrefix}-start`}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor={`${idPrefix}-end`}>
                {t('staff.time_tracking.entryDialog.end', 'End')}
              </label>
              <Input
                id={`${idPrefix}-end`}
                type="time"
                value={value.endClock}
                disabled={disabled}
                size="sm"
                className="w-28"
                inputClassName="font-mono tabular-nums"
                onChange={(event) => patch({ endClock: event.target.value })}
                data-testid={`${idPrefix}-end`}
              />
            </div>
            <div className="flex items-center gap-2 pb-1">
              <Switch
                checked={value.isBillable}
                disabled={disabled}
                onCheckedChange={(next) => patch({ isBillable: next })}
                aria-label={t('staff.time_tracking.entryDialog.billable', 'Billable')}
                data-testid={`${idPrefix}-billable`}
              />
              <span className="text-xs text-foreground">
                {t('staff.time_tracking.entryDialog.billable', 'Billable')}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t('staff.time_tracking.entryDialog.tags', 'Tags')}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {assigned.map((tag) => (
                <Badge key={tag.id} variant="neutral" className="gap-1" style={tagChipStyle(tag)}>
                  {tag.label}
                  <button
                    type="button"
                    aria-label={t('staff.time_tracking.entryDialog.removeTag', 'Remove tag {label}', {
                      label: tag.label,
                    })}
                    onClick={() => patch({ tagIds: value.tagIds.filter((id) => id !== tag.id) })}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </Badge>
              ))}
              <TagPicker
                available={available}
                disabled={disabled}
                onAssign={(id) =>
                  patch({ tagIds: value.tagIds.includes(id) ? value.tagIds : [...value.tagIds, id] })
                }
                onCreate={onCreateTag}
                labels={{
                  add: t('staff.time_tracking.entryDialog.addTag', 'Add tag'),
                  create: (name) => t('staff.time_tracking.entryDialog.createTag', 'Create "{name}"', { name }),
                  empty: t('staff.time_tracking.entryDialog.noTags', 'No matching tag'),
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function emptyEntryDetails(date: string, isBillable = true): EntryDetailsValue {
  return { description: '', date, startClock: '', endClock: '', isBillable, tagIds: [] }
}

export default EntryDetailsFields
