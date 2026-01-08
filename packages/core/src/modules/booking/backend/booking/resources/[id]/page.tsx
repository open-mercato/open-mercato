"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { updateCrud, deleteCrud, createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { Input } from '@open-mercato/ui/primitives/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { ScheduleView, type ScheduleItem, type ScheduleRange, type ScheduleViewMode, type ScheduleSlot } from '@open-mercato/ui/backend/schedule'
import { DictionarySelectControl } from '@open-mercato/core/modules/dictionaries/components/DictionarySelectControl'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { BOOKING_CAPACITY_UNIT_DICTIONARY_KEY } from '@open-mercato/core/modules/booking/lib/capacityUnits'

const DEFAULT_PAGE_SIZE = 200

const REPEAT_OPTIONS = [
  { value: 'once', labelKey: 'booking.resources.availability.repeat.once', fallback: 'Once' },
  { value: 'daily', labelKey: 'booking.resources.availability.repeat.daily', fallback: 'Daily' },
  { value: 'weekly', labelKey: 'booking.resources.availability.repeat.weekly', fallback: 'Weekly' },
]

type ResourceRecord = {
  id: string
  name: string
  resourceTypeId: string | null
  capacity: number | null
  capacityUnitValue: string | null
  capacityUnitName: string | null
  capacityUnitColor: string | null
  capacityUnitIcon: string | null
  tags: string[]
  isActive: boolean
} & Record<string, unknown>

type ResourceResponse = {
  items: ResourceRecord[]
}

type ResourceTypeRow = {
  id: string
  name: string
}

type ResourceTypesResponse = {
  items: ResourceTypeRow[]
}

type AvailabilityRule = {
  id: string
  subjectType: 'resource' | 'member'
  subjectId: string
  timezone: string
  rrule: string
  exdates: string[]
  createdAt?: string | null
}

type AvailabilityResponse = {
  items: AvailabilityRule[]
}

type AvailabilityFormValues = {
  timezone: string
  startAt: string
  endAt: string
  repeat: string
  exdates: string
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

function buildAvailabilityRrule(start: Date, end: Date, repeat: string): string {
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

function parseRuleValue(rule: AvailabilityRule): { startAt: Date; endAt: Date; repeat: string } {
  const dtStartMatch = rule.rrule.match(/DTSTART[:=](\d{8}T\d{6}Z?)/)
  const durationMatch = rule.rrule.match(/DURATION:PT(?:(\d+)H)?(?:(\d+)M)?/)
  const freqMatch = rule.rrule.match(/FREQ=([A-Z]+)/)
  let start = new Date()
  if (dtStartMatch?.[1]) {
    const raw = dtStartMatch[1].replace(/Z$/, '')
    const parts = raw.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/)
    if (parts) {
      const [, year, month, day, hour, minute, second] = parts
      const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
      const parsed = new Date(iso)
      if (!Number.isNaN(parsed.getTime())) start = parsed
    }
  } else if (rule.createdAt) {
    const parsed = new Date(rule.createdAt)
    if (!Number.isNaN(parsed.getTime())) start = parsed
  }
  let durationMinutes = 60
  if (durationMatch) {
    const hours = durationMatch[1] ? Number(durationMatch[1]) : 0
    const minutes = durationMatch[2] ? Number(durationMatch[2]) : 0
    durationMinutes = Math.max(1, hours * 60 + minutes)
  }
  const end = new Date(start.getTime() + durationMinutes * 60000)
  const freq = freqMatch?.[1]
  const repeat = freq === 'WEEKLY' ? 'weekly' : freq === 'DAILY' ? 'daily' : 'once'
  return { startAt: start, endAt: end, repeat }
}

function buildAvailabilityTitle(rule: AvailabilityRule, t: (key: string, fallback?: string) => string): string {
  const freqMatch = rule.rrule.match(/FREQ=([A-Z]+)/)
  const freq = freqMatch?.[1]
  if (freq === 'WEEKLY') return t('booking.resources.availability.title.weekly', 'Weekly availability')
  if (freq === 'DAILY') return t('booking.resources.availability.title.daily', 'Daily availability')
  return t('booking.resources.availability.title.once', 'Availability')
}

function parseExdates(value: string): string[] {
  if (!value) return []
  return value
    .split(/\s*[\n,]+\s*/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export default function BookingResourceDetailPage({ params }: { params?: { id?: string } }) {
  const resourceId = params?.id
  const t = useT()
  const router = useRouter()
  const dialogRef = React.useRef<HTMLDivElement | null>(null)
  const [initialValues, setInitialValues] = React.useState<Record<string, unknown> | null>(null)
  const [resourceTypes, setResourceTypes] = React.useState<ResourceTypeRow[]>([])
  const [availabilityRules, setAvailabilityRules] = React.useState<AvailabilityRule[]>([])
  const [availabilityLoading, setAvailabilityLoading] = React.useState(true)
  const [availabilityError, setAvailabilityError] = React.useState<string | null>(null)
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
  const [capacityUnitDictionaryId, setCapacityUnitDictionaryId] = React.useState<string | null>(null)
  const scopeVersion = useOrganizationScopeVersion()

  React.useEffect(() => {
    if (!resourceId) return
    let cancelled = false
    async function loadResource() {
      try {
        const params = new URLSearchParams()
        params.set('page', '1')
        params.set('pageSize', '1')
        if (resourceId) params.set('ids', resourceId)
        const record = await readApiResultOrThrow<ResourceResponse>(`/api/booking/resources?${params.toString()}`)
        const resource = Array.isArray(record?.items) ? record.items[0] : null
        if (!resource) throw new Error(t('booking.resources.form.errors.notFound', 'Resource not found.'))
        if (!cancelled) {
          const customValues: Record<string, unknown> = {}
          for (const [key, value] of Object.entries(resource)) {
            if (key.startsWith('cf_')) customValues[key] = value
            else if (key.startsWith('cf:')) customValues[`cf_${key.slice(3)}`] = value
          }
          setInitialValues({
            id: resource.id,
            name: resource.name,
            resourceTypeId: resource.resourceTypeId || '',
            capacity: resource.capacity ?? '',
            capacityUnitValue: resource.capacityUnitValue ?? '',
            tags: Array.isArray(resource.tags) ? resource.tags : [],
            isActive: resource.isActive ?? true,
            ...customValues,
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : t('booking.resources.form.errors.load', 'Failed to load resource.')
        flash(message, 'error')
      }
    }
    loadResource()
    return () => { cancelled = true }
  }, [resourceId, t])

  React.useEffect(() => {
    let cancelled = false
    async function loadResourceTypes() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: String(DEFAULT_PAGE_SIZE) })
        const call = await apiCall<ResourceTypesResponse>(`/api/booking/resource-types?${params.toString()}`)
        if (!cancelled) {
          const items = Array.isArray(call.result?.items) ? call.result.items : []
          setResourceTypes(items)
        }
      } catch {
        if (!cancelled) setResourceTypes([])
      }
    }
    loadResourceTypes()
    return () => { cancelled = true }
  }, [scopeVersion])

  React.useEffect(() => {
    let cancelled = false
    async function loadCapacityUnitDictionary() {
      try {
        const call = await apiCall<{ items?: Array<{ id?: string; key?: string; isInherited?: boolean }> }>('/api/dictionaries')
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        const matches = items.filter((item) => item?.key === BOOKING_CAPACITY_UNIT_DICTIONARY_KEY)
        const preferred = matches.find((item) => item?.isInherited === false) ?? matches[0] ?? null
        if (!cancelled) setCapacityUnitDictionaryId(preferred?.id ?? null)
      } catch {
        if (!cancelled) setCapacityUnitDictionaryId(null)
      }
    }
    loadCapacityUnitDictionary()
    return () => { cancelled = true }
  }, [scopeVersion])

  const refreshAvailability = React.useCallback(async () => {
    if (!resourceId) return
    setAvailabilityLoading(true)
    setAvailabilityError(null)
    try {
      const params = new URLSearchParams({
        page: '1',
        pageSize: '200',
        subjectType: 'resource',
        subjectIds: resourceId,
      })
      const call = await apiCall<AvailabilityResponse>(`/api/booking/availability?${params.toString()}`)
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      setAvailabilityRules(items)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('booking.resources.availability.error.load', 'Failed to load availability.')
      setAvailabilityError(message)
    } finally {
      setAvailabilityLoading(false)
    }
  }, [resourceId, t])

  React.useEffect(() => {
    void refreshAvailability()
  }, [refreshAvailability])

  const availabilityItems = React.useMemo<ScheduleItem[]>(() => (
    availabilityRules.map((rule) => {
      const window = parseRuleValue(rule)
      return {
        id: rule.id,
        kind: 'availability',
        title: buildAvailabilityTitle(rule, t),
        startsAt: window.startAt,
        endsAt: window.endAt,
        metadata: { rule },
      }
    })
  ), [availabilityRules, t])

  const ruleMap = React.useMemo(() => new Map(availabilityRules.map((rule) => [rule.id, rule])), [availabilityRules])

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('booking.resources.form.fields.name', 'Name'), type: 'text', required: true },
    {
      id: 'resourceTypeId',
      label: t('booking.resources.form.fields.type', 'Resource type'),
      type: 'select',
      options: resourceTypes.map((type) => ({ value: type.id, label: type.name })),
    },
    {
      id: 'capacity',
      label: t('booking.resources.form.fields.capacity', 'Capacity'),
      description: t(
        'booking.resources.form.fields.capacity.help',
        'Depends on the resource and can mean spots, units, quantity, or another type of capacity.',
      ),
      type: 'number',
    },
    {
      id: 'capacityUnitValue',
      label: t('booking.resources.form.fields.capacityUnit', 'Capacity unit'),
      type: 'custom',
      component: ({ value, setValue }) => {
        if (!capacityUnitDictionaryId) {
          return (
            <p className="text-xs text-muted-foreground">
              {t('booking.resources.form.fields.capacityUnit.missing', 'Capacity unit dictionary is not configured.')}
            </p>
          )
        }
        return (
          <DictionarySelectControl
            dictionaryId={capacityUnitDictionaryId}
            value={typeof value === 'string' ? value : null}
            onChange={(next) => setValue(next ?? '')}
            selectClassName="w-full"
          />
        )
      },
    },
    {
      id: 'tags',
      label: t('booking.resources.form.fields.tags', 'Tags'),
      type: 'tags',
    },
    {
      id: 'isActive',
      label: t('booking.resources.form.fields.active', 'Active'),
      type: 'checkbox',
    },
  ], [capacityUnitDictionaryId, resourceTypes, t])

  const availabilityFields = React.useMemo<CrudField[]>(() => [
    {
      id: 'startAt',
      label: t('booking.resources.availability.form.fields.start', 'Start'),
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
      label: t('booking.resources.availability.form.fields.end', 'End'),
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
      label: t('booking.resources.availability.form.fields.repeat', 'Repeat'),
      type: 'select',
      options: REPEAT_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey, opt.fallback) })),
    },
    {
      id: 'timezone',
      label: t('booking.resources.availability.form.fields.timezone', 'Timezone'),
      type: 'text',
    },
    {
      id: 'exdates',
      label: t('booking.resources.availability.form.fields.exdates', 'Exceptions'),
      description: t('booking.resources.availability.form.fields.exdates.help', 'Comma or newline-separated ISO datetimes.'),
      type: 'textarea',
    },
  ], [t])

  const availabilityInitialValues = React.useMemo<AvailabilityFormValues>(() => {
    if (editingRule) {
      const parsed = parseRuleValue(editingRule)
      return {
        timezone: editingRule.timezone || timezone,
        startAt: formatDateTimeLocal(parsed.startAt),
        endAt: formatDateTimeLocal(parsed.endAt),
        repeat: parsed.repeat,
        exdates: Array.isArray(editingRule.exdates) ? editingRule.exdates.join('\n') : '',
      }
    }
    const slot = slotSeed
    const start = slot?.start ?? new Date()
    const end = slot?.end ?? new Date(start.getTime() + 60 * 60000)
    return {
      timezone,
      startAt: formatDateTimeLocal(start),
      endAt: formatDateTimeLocal(end),
      repeat: 'once',
      exdates: '',
    }
  }, [editingRule, slotSeed, timezone])

  const handleAvailabilitySubmit = React.useCallback(async (values: Record<string, unknown>) => {
    if (!resourceId) return
    const startAt = parseDateTimeLocal(String(values.startAt || ''))
    const endAt = parseDateTimeLocal(String(values.endAt || ''))
    if (!startAt || !endAt) {
      throw createCrudFormError(t('booking.resources.availability.form.errors.invalidDates', 'Start and end times are required.'))
    }
    if (startAt >= endAt) {
      throw createCrudFormError(t('booking.resources.availability.form.errors.invalidRange', 'End time must be after start.'))
    }
    const repeat = String(values.repeat || 'once')
    const rule = buildAvailabilityRrule(startAt, endAt, repeat)
    const payload = {
      subjectType: 'resource',
      subjectId: resourceId,
      timezone: String(values.timezone || timezone),
      rrule: rule,
      exdates: parseExdates(String(values.exdates || '')),
    }
    if (editingRule) {
      await updateCrud('booking/availability', { id: editingRule.id, ...payload }, {
        errorMessage: t('booking.resources.availability.form.errors.update', 'Failed to update availability.'),
      })
      flash(t('booking.resources.availability.form.flash.updated', 'Availability updated.'), 'success')
    } else {
      await createCrud('booking/availability', payload, {
        errorMessage: t('booking.resources.availability.form.errors.create', 'Failed to create availability.'),
      })
      flash(t('booking.resources.availability.form.flash.created', 'Availability created.'), 'success')
    }
    setDialogOpen(false)
    setEditingRule(null)
    setSlotSeed(null)
    await refreshAvailability()
  }, [editingRule, refreshAvailability, resourceId, t, timezone])

  const handleAvailabilityDelete = React.useCallback(async () => {
    if (!editingRule) return
    await deleteCrud('booking/availability', editingRule.id, {
      errorMessage: t('booking.resources.availability.form.errors.delete', 'Failed to delete availability.'),
    })
    flash(t('booking.resources.availability.form.flash.deleted', 'Availability deleted.'), 'success')
    setDialogOpen(false)
    setEditingRule(null)
    setSlotSeed(null)
    await refreshAvailability()
  }, [editingRule, refreshAvailability, t])

  const openCreateDialog = React.useCallback((slot?: ScheduleSlot) => {
    setEditingRule(null)
    setSlotSeed(slot ?? null)
    setDialogOpen(true)
  }, [])

  const openEditDialog = React.useCallback((rule: AvailabilityRule) => {
    setEditingRule(rule)
    setSlotSeed(null)
    setDialogOpen(true)
  }, [])

  const handleItemClick = React.useCallback((item: ScheduleItem) => {
    const rule = ruleMap.get(item.id)
    if (rule) openEditDialog(rule)
  }, [openEditDialog, ruleMap])

  const handleSlotClick = React.useCallback((slot: ScheduleSlot) => {
    openCreateDialog(slot)
  }, [openCreateDialog])

  const handleSubmit = React.useCallback(async (values: Record<string, unknown>) => {
    if (!resourceId) return
    const payload: Record<string, unknown> = {
      ...values,
      id: resourceId,
      resourceTypeId: values.resourceTypeId || null,
      capacity: values.capacity ? Number(values.capacity) : null,
      capacityUnitValue: values.capacityUnitValue ? String(values.capacityUnitValue) : null,
      isActive: values.isActive ?? true,
      ...collectCustomFieldValues(values),
    }
    if (!payload.name || String(payload.name).trim().length === 0) {
      throw createCrudFormError(t('booking.resources.form.errors.nameRequired', 'Name is required.'))
    }
    await updateCrud('booking/resources', payload, {
      errorMessage: t('booking.resources.form.errors.update', 'Failed to update resource.'),
    })
    flash(t('booking.resources.form.flash.updated', 'Resource updated.'), 'success')
  }, [resourceId, t])

  const handleDelete = React.useCallback(async () => {
    if (!resourceId) return
    await deleteCrud('booking/resources', resourceId, {
      errorMessage: t('booking.resources.form.errors.delete', 'Failed to delete resource.'),
    })
    flash(t('booking.resources.form.flash.deleted', 'Resource deleted.'), 'success')
    router.push('/backend/booking/resources')
  }, [resourceId, router, t])

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('booking.resources.form.editTitle', 'Edit resource')}
          backHref="/backend/booking/resources"
          cancelHref="/backend/booking/resources"
          fields={fields}
          initialValues={initialValues ?? undefined}
          entityId={E.booking.booking_resource}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
          isLoading={!initialValues}
          loadingMessage={t('booking.resources.form.loading', 'Loading resource...')}
        />

        <div className="mt-8 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-foreground">
              {t('booking.resources.availability.section.title', 'Availability')}
            </h2>
            <Button type="button" variant="outline" onClick={() => openCreateDialog()}>
              {t('booking.resources.availability.actions.add', 'Add availability')}
            </Button>
          </div>
          {availabilityLoading ? (
            <LoadingMessage label={t('booking.resources.availability.loading', 'Loading availability...')} />
          ) : availabilityError ? (
            <ErrorMessage label={availabilityError} />
          ) : (
            <ScheduleView
              items={availabilityItems}
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
      </PageBody>

      <Dialog open={dialogOpen} onOpenChange={(open) => {
        if (!open) {
          setDialogOpen(false)
          setEditingRule(null)
          setSlotSeed(null)
        }
      }}>
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
              {editingRule
                ? t('booking.resources.availability.form.title.edit', 'Edit availability')
                : t('booking.resources.availability.form.title.create', 'Add availability')}
            </DialogTitle>
          </DialogHeader>
          <CrudForm
            embedded
            fields={availabilityFields}
            initialValues={availabilityInitialValues}
            submitLabel={editingRule
              ? t('booking.resources.availability.form.actions.save', 'Save')
              : t('booking.resources.availability.form.actions.create', 'Create')}
            onSubmit={handleAvailabilitySubmit}
            onDelete={editingRule ? handleAvailabilityDelete : undefined}
            deleteVisible={Boolean(editingRule)}
          />
        </DialogContent>
      </Dialog>
    </Page>
  )
}
