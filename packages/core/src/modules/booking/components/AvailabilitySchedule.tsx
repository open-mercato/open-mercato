"use client"

import * as React from 'react'
import { ScheduleView, type ScheduleItem, type ScheduleRange, type ScheduleViewMode, type ScheduleSlot } from '@open-mercato/ui/backend/schedule'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud, deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { parseAvailabilityRuleWindow } from '@open-mercato/core/modules/booking/lib/resourceSchedule'
import { GanttChart } from 'lucide-react'
import type { BookingEventStatus } from '@open-mercato/core/modules/booking/data/entities'

type AvailabilityRepeat = 'once' | 'daily' | 'weekly'

export type AvailabilityRule = {
  id: string
  subjectType: 'resource' | 'member'
  subjectId: string
  timezone: string
  rrule: string
  exdates: string[]
  kind?: 'availability' | 'unavailability'
  note?: string | null
  createdAt?: string | null
}

export type AvailabilityBookedEvent = {
  id: string
  title: string
  startsAt: string | Date
  endsAt: string | Date
  status?: BookingEventStatus | null
}

export type AvailabilityScheduleItemBuilder = (params: {
  availabilityRules: AvailabilityRule[]
  bookedEvents: AvailabilityBookedEvent[]
  translate: (key: string, fallback?: string) => string
}) => ScheduleItem[]

export type AvailabilityScheduleProps = {
  subjectType: 'member' | 'resource'
  subjectId: string
  labelPrefix: string
  mode?: 'availability' | 'unavailability'
  buildScheduleItems: AvailabilityScheduleItemBuilder
  loadBookedEvents?: (range: ScheduleRange) => Promise<AvailabilityBookedEvent[]>
}

type AvailabilityFormValues = {
  timezone: string
  startAt: string
  endAt: string
  repeat: AvailabilityRepeat
  exdates: string[]
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

function formatDateTimeLocal(value: Date): string {
  const offset = value.getTimezoneOffset()
  const adjusted = new Date(value.getTime() - offset * 60000)
  return adjusted.toISOString().slice(0, 16)
}

function parseDateTimeLocal(value: string): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function formatDuration(minutes: number): string {
  const clamped = Math.max(1, minutes)
  const hours = Math.floor(clamped / 60)
  const mins = clamped % 60
  if (hours > 0 && mins > 0) return `PT${hours}H${mins}M`
  if (hours > 0) return `PT${hours}H`
  return `PT${mins}M`
}

function buildAvailabilityRrule(start: Date, end: Date, repeat: AvailabilityRepeat): string {
  const dtStart = start.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
  const duration = formatDuration(durationMinutes)
  let rule = ''
  if (repeat === 'once') {
    rule = 'FREQ=DAILY;COUNT=1'
  } else if (repeat === 'weekly') {
    const dayCode = DAY_CODES[start.getDay()]
    rule = `FREQ=WEEKLY;BYDAY=${dayCode}`
  } else {
    rule = 'FREQ=DAILY'
  }
  return `DTSTART:${dtStart}\nDURATION:${duration}\nRRULE:${rule}`
}

function normalizeExdatesInput(value: unknown): string[] {
  const values = Array.isArray(value) ? value : []
  return values
    .map((item) => parseDateTimeLocal(String(item ?? '')))
    .filter((item): item is Date => item !== null)
    .map((item) => item.toISOString())
}

function formatExdatesInput(exdates: string[]): string[] {
  return exdates
    .map((value) => {
      const parsed = new Date(value)
      if (Number.isNaN(parsed.getTime())) return null
      return formatDateTimeLocal(parsed)
    })
    .filter((value): value is string => value !== null)
}

export function AvailabilitySchedule({
  subjectType,
  subjectId,
  labelPrefix,
  mode = 'availability',
  buildScheduleItems,
  loadBookedEvents,
}: AvailabilityScheduleProps) {
  const t = useT()
  const dialogRef = React.useRef<HTMLDivElement | null>(null)
  const [availabilityRules, setAvailabilityRules] = React.useState<AvailabilityRule[]>([])
  const [availabilityLoading, setAvailabilityLoading] = React.useState(true)
  const [availabilityError, setAvailabilityError] = React.useState<string | null>(null)
  const [bookedEvents, setBookedEvents] = React.useState<AvailabilityBookedEvent[]>([])
  const [bookedLoading, setBookedLoading] = React.useState(false)
  const [bookedError, setBookedError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingRule, setEditingRule] = React.useState<AvailabilityRule | null>(null)
  const [scheduleView, setScheduleView] = React.useState<ScheduleViewMode>('week')
  const [timezone, setTimezone] = React.useState<string>(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  const [range, setRange] = React.useState<ScheduleRange>(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000)
    return { start, end }
  })
  const [slotSeed, setSlotSeed] = React.useState<ScheduleSlot | null>(null)

  const refreshAvailability = React.useCallback(async () => {
    if (!subjectId) return
    setAvailabilityLoading(true)
    setAvailabilityError(null)
    try {
      const params = new URLSearchParams({
        page: '1',
        pageSize: '100',
        subjectType,
        subjectIds: subjectId,
      })
      const call = await apiCall<{ items?: AvailabilityRule[] }>(`/api/booking/availability?${params.toString()}`)
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      setAvailabilityRules(items)
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : t(`${labelPrefix}.availability.error.load`, 'Failed to load availability.')
      setAvailabilityError(message)
    } finally {
      setAvailabilityLoading(false)
    }
  }, [labelPrefix, subjectId, subjectType, t])

  React.useEffect(() => {
    void refreshAvailability()
  }, [refreshAvailability])

  const refreshBookedEvents = React.useCallback(async () => {
    if (!loadBookedEvents) return
    setBookedLoading(true)
    setBookedError(null)
    try {
      const items = await loadBookedEvents(range)
      setBookedEvents(Array.isArray(items) ? items : [])
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : t(`${labelPrefix}.schedule.error.load`, 'Failed to load schedule.')
      setBookedError(message)
    } finally {
      setBookedLoading(false)
    }
  }, [labelPrefix, loadBookedEvents, range, t])

  React.useEffect(() => {
    void refreshBookedEvents()
  }, [refreshBookedEvents])

  const scheduleItems = React.useMemo(
    () => buildScheduleItems({ availabilityRules, bookedEvents, translate: t }),
    [availabilityRules, bookedEvents, buildScheduleItems, t],
  )

  const ruleMap = React.useMemo(
    () => new Map(availabilityRules.map((rule) => [rule.id, rule])),
    [availabilityRules],
  )

  const availabilityLabels = React.useMemo(() => {
    const modeBase = `${labelPrefix}.${mode}`
    const availabilityBase = `${labelPrefix}.availability`
    const isUnavailable = mode === 'unavailability'
    return {
      sectionTitle: t(`${labelPrefix}.availability.section.title`, 'Availability'),
      addAction: t(
        `${modeBase}.actions.add`,
        isUnavailable ? 'Add unavailability' : 'Add availability',
      ),
      editTitle: t(
        `${modeBase}.form.title.edit`,
        isUnavailable ? 'Edit unavailability' : 'Edit availability',
      ),
      createTitle: t(
        `${modeBase}.form.title.create`,
        isUnavailable ? 'Add unavailability' : 'Add availability',
      ),
      createError: t(
        `${modeBase}.form.errors.create`,
        isUnavailable ? 'Failed to create unavailability.' : 'Failed to create availability.',
      ),
      updateError: t(
        `${modeBase}.form.errors.update`,
        isUnavailable ? 'Failed to update unavailability.' : 'Failed to update availability.',
      ),
      deleteError: t(
        `${modeBase}.form.errors.delete`,
        isUnavailable ? 'Failed to delete unavailability.' : 'Failed to delete availability.',
      ),
      createdFlash: t(
        `${modeBase}.form.flash.created`,
        isUnavailable ? 'Unavailability created.' : 'Availability created.',
      ),
      updatedFlash: t(
        `${modeBase}.form.flash.updated`,
        isUnavailable ? 'Unavailability updated.' : 'Availability updated.',
      ),
      deletedFlash: t(
        `${modeBase}.form.flash.deleted`,
        isUnavailable ? 'Unavailability deleted.' : 'Availability deleted.',
      ),
      startLabel: t(`${availabilityBase}.form.fields.start`, 'Start'),
      endLabel: t(`${availabilityBase}.form.fields.end`, 'End'),
      repeatLabel: t(`${availabilityBase}.form.fields.repeat`, 'Repeat'),
      timezoneLabel: t(`${availabilityBase}.form.fields.timezone`, 'Timezone'),
      exdatesLabel: t(`${modeBase}.form.fields.exdates`, 'Exceptions'),
      exdatesHelp: t(
        `${modeBase}.form.fields.exdates.help`,
        isUnavailable ? 'Exclude these dates from unavailability.' : 'Exclude these dates from availability.',
      ),
      exdatesAdd: t(`${availabilityBase}.form.fields.exdates.add`, 'Add exception'),
      exdatesRemove: t(`${availabilityBase}.form.fields.exdates.remove`, 'Remove'),
      invalidDates: t(`${availabilityBase}.form.errors.invalidDates`, 'Start and end times are required.'),
      invalidRange: t(`${availabilityBase}.form.errors.invalidRange`, 'End time must be after start.'),
      submitCreate: t(`${availabilityBase}.form.actions.create`, 'Create'),
      submitSave: t(`${availabilityBase}.form.actions.save`, 'Save'),
    }
  }, [labelPrefix, mode, t])

  const scheduleLoading = availabilityLoading || bookedLoading
  const scheduleError = availabilityError ?? bookedError

  const repeatOptions = React.useMemo(() => ([
    { value: 'once', label: t(`${labelPrefix}.availability.repeat.once`, 'Once') },
    { value: 'daily', label: t(`${labelPrefix}.availability.repeat.daily`, 'Daily') },
    { value: 'weekly', label: t(`${labelPrefix}.availability.repeat.weekly`, 'Weekly') },
  ]), [labelPrefix, t])

  const availabilityFields = React.useMemo<CrudField[]>(() => [
    {
      id: 'startAt',
      label: availabilityLabels.startLabel,
      type: 'custom',
      component: ({ value, setValue }) => (
        <Input
          type="datetime-local"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => setValue(event.target.value)}
        />
      ),
    },
    {
      id: 'endAt',
      label: availabilityLabels.endLabel,
      type: 'custom',
      component: ({ value, setValue }) => (
        <Input
          type="datetime-local"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => setValue(event.target.value)}
        />
      ),
    },
    {
      id: 'repeat',
      label: availabilityLabels.repeatLabel,
      type: 'select',
      options: repeatOptions.map((option) => ({ value: option.value, label: option.label })),
    },
    {
      id: 'timezone',
      label: availabilityLabels.timezoneLabel,
      type: 'text',
    },
    {
      id: 'exdates',
      label: availabilityLabels.exdatesLabel,
      description: availabilityLabels.exdatesHelp,
      type: 'custom',
      component: ({ value, setValue }) => {
        const list = formatExdatesInput(Array.isArray(value) ? value.map(String) : [])
        return (
          <div className="space-y-2">
            {list.map((entry, index) => (
              <div key={`${entry}-${index}`} className="flex items-center gap-2">
                <Input type="datetime-local" value={entry} onChange={() => {}} readOnly />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const next = [...list]
                    next.splice(index, 1)
                    setValue(normalizeExdatesInput(next))
                  }}
                >
                  {availabilityLabels.exdatesRemove}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const next = [...list, formatDateTimeLocal(new Date())]
                setValue(normalizeExdatesInput(next))
              }}
            >
              {availabilityLabels.exdatesAdd}
            </Button>
          </div>
        )
      },
    },
  ], [availabilityLabels, repeatOptions])

  const availabilityInitialValues = React.useMemo<AvailabilityFormValues>(() => {
    if (editingRule) {
      const window = parseAvailabilityRuleWindow(editingRule)
      return {
        timezone: editingRule.timezone ?? timezone,
        startAt: formatDateTimeLocal(window.startAt),
        endAt: formatDateTimeLocal(window.endAt),
        repeat: window.repeat,
        exdates: editingRule.exdates ?? [],
      }
    }
    const seed = slotSeed
    if (seed) {
      return {
        timezone,
        startAt: formatDateTimeLocal(seed.start),
        endAt: formatDateTimeLocal(seed.end),
        repeat: 'once',
        exdates: [],
      }
    }
    const now = new Date()
    return {
      timezone,
      startAt: formatDateTimeLocal(now),
      endAt: formatDateTimeLocal(new Date(now.getTime() + 60 * 60 * 1000)),
      repeat: 'once',
      exdates: [],
    }
  }, [editingRule, slotSeed, timezone])

  const handleAvailabilitySubmit = React.useCallback(async (values: Record<string, unknown>) => {
    const start = parseDateTimeLocal(String(values.startAt ?? ''))
    const end = parseDateTimeLocal(String(values.endAt ?? ''))
    if (!start || !end) {
      throw createCrudFormError(availabilityLabels.invalidDates)
    }
    if (start >= end) {
      throw createCrudFormError(availabilityLabels.invalidRange)
    }
    const repeat = (values.repeat as AvailabilityRepeat) ?? 'once'
    const rule = buildAvailabilityRrule(start, end, repeat)
    const payload = {
      subjectType,
      subjectId,
      timezone: typeof values.timezone === 'string' && values.timezone.trim().length ? values.timezone.trim() : timezone,
      rrule: rule,
      exdates: normalizeExdatesInput(values.exdates),
    }
    if (editingRule) {
      await updateCrud('booking/availability', { id: editingRule.id, ...payload }, {
        errorMessage: availabilityLabels.updateError,
      })
      flash(availabilityLabels.updatedFlash, 'success')
    } else {
      await createCrud('booking/availability', payload, {
        errorMessage: availabilityLabels.createError,
      })
      flash(availabilityLabels.createdFlash, 'success')
    }
    setDialogOpen(false)
    setEditingRule(null)
    setSlotSeed(null)
    await refreshAvailability()
  }, [availabilityLabels, editingRule, refreshAvailability, subjectId, subjectType, timezone])

  const handleAvailabilityDelete = React.useCallback(async () => {
    if (!editingRule) return
    await deleteCrud('booking/availability', editingRule.id, {
      errorMessage: availabilityLabels.deleteError,
    })
    flash(availabilityLabels.deletedFlash, 'success')
    setDialogOpen(false)
    setEditingRule(null)
    setSlotSeed(null)
    await refreshAvailability()
  }, [availabilityLabels, editingRule, refreshAvailability])

  const handleItemClick = React.useCallback((item: ScheduleItem) => {
    const rule = item.metadata?.rule as AvailabilityRule | undefined
    if (!rule) return
    setEditingRule(ruleMap.get(rule.id) ?? rule)
    setSlotSeed(null)
    setDialogOpen(true)
  }, [ruleMap])

  const handleSlotClick = React.useCallback((slot: ScheduleSlot) => {
    setSlotSeed(slot)
    setEditingRule(null)
    setDialogOpen(true)
  }, [])

  const openCreateDialog = React.useCallback(() => {
    setSlotSeed(null)
    setEditingRule(null)
    setDialogOpen(true)
  }, [])

  return (
    <>
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">
            {availabilityLabels.sectionTitle}
          </h2>
          <Button type="button" variant="outline" onClick={openCreateDialog}>
            <GanttChart className="mr-2 h-4 w-4" aria-hidden="true" />
            {availabilityLabels.addAction}
          </Button>
        </div>
        <div className="mt-4">
          {scheduleLoading ? (
            <LoadingMessage label={t(`${labelPrefix}.schedule.loading`, 'Loading schedule...')} />
          ) : scheduleError ? (
            <ErrorMessage label={scheduleError} />
          ) : (
            <ScheduleView
              items={scheduleItems}
              view={scheduleView}
              range={range}
              timezone={timezone}
              onRangeChange={setRange}
              onViewChange={setScheduleView}
              onTimezoneChange={setTimezone}
              onItemClick={handleItemClick}
              onSlotClick={handleSlotClick}
            />
          )}
        </div>
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false)
            setEditingRule(null)
            setSlotSeed(null)
          }
        }}
      >
        <DialogContent
          ref={dialogRef}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              const form = dialogRef.current?.querySelector('form')
              if (form instanceof HTMLFormElement) form.requestSubmit()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editingRule ? availabilityLabels.editTitle : availabilityLabels.createTitle}
            </DialogTitle>
          </DialogHeader>
          <CrudForm
            embedded
            fields={availabilityFields}
            initialValues={availabilityInitialValues}
            submitLabel={editingRule ? availabilityLabels.submitSave : availabilityLabels.submitCreate}
            onSubmit={handleAvailabilitySubmit}
            onDelete={editingRule ? handleAvailabilityDelete : undefined}
            deleteVisible={Boolean(editingRule)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
