"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { updateCrud, deleteCrud, createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { Input } from '@open-mercato/ui/primitives/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage, ErrorMessage, TagsSection, type TagOption } from '@open-mercato/ui/backend/detail'
import { ScheduleView, type ScheduleItem, type ScheduleRange, type ScheduleViewMode, type ScheduleSlot } from '@open-mercato/ui/backend/schedule'
import { DictionarySelectControl } from '@open-mercato/core/modules/dictionaries/components/DictionarySelectControl'
import { AppearanceSelector } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { BOOKING_CAPACITY_UNIT_DICTIONARY_KEY } from '@open-mercato/core/modules/booking/lib/capacityUnits'
import {
  buildResourceScheduleItems,
  parseAvailabilityRuleWindow,
} from '@open-mercato/core/modules/booking/lib/resourceSchedule'
import { BOOKING_RESOURCE_FIELDSET_DEFAULT, resolveBookingResourceFieldsetCode } from '@open-mercato/core/modules/booking/lib/resourceCustomFields'
import type { BookingEventStatus } from '@open-mercato/core/modules/booking/data/entities'
import { GanttChart } from 'lucide-react'

const DEFAULT_PAGE_SIZE = 200

const REPEAT_OPTIONS = [
  { value: 'once', labelKey: 'booking.resources.availability.repeat.once', fallback: 'Once' },
  { value: 'daily', labelKey: 'booking.resources.availability.repeat.daily', fallback: 'Daily' },
  { value: 'weekly', labelKey: 'booking.resources.availability.repeat.weekly', fallback: 'Weekly' },
]

type ResourceRecord = {
  id: string
  name: string
  description?: string | null
  resourceTypeId: string | null
  capacity: number | null
  capacityUnitValue: string | null
  capacityUnitName: string | null
  capacityUnitColor: string | null
  capacityUnitIcon: string | null
  tags?: TagOption[] | null
  isActive: boolean
  isAvailableByDefault: boolean
  appearanceIcon?: string | null
  appearanceColor?: string | null
  resource_type_id?: string | null
  capacity_unit_value?: string | null
  capacity_unit_name?: string | null
  capacity_unit_color?: string | null
  capacity_unit_icon?: string | null
  appearance_icon?: string | null
  appearance_color?: string | null
  is_active?: boolean
  is_available_by_default?: boolean
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
  exdates: string[]
}

type BookedEvent = {
  id: string
  title: string
  startsAt: string
  endsAt: string
  status?: BookingEventStatus | null
}

type BookedEventsResponse = {
  items: BookedEvent[]
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

function normalizeResourceRecord(record: ResourceRecord): ResourceRecord {
  return {
    ...record,
    resourceTypeId: record.resourceTypeId ?? record.resource_type_id ?? null,
    description: record.description ?? null,
    capacityUnitValue: record.capacityUnitValue ?? record.capacity_unit_value ?? null,
    capacityUnitName: record.capacityUnitName ?? record.capacity_unit_name ?? null,
    capacityUnitColor: record.capacityUnitColor ?? record.capacity_unit_color ?? null,
    capacityUnitIcon: record.capacityUnitIcon ?? record.capacity_unit_icon ?? null,
    appearanceIcon: record.appearanceIcon ?? record.appearance_icon ?? null,
    appearanceColor: record.appearanceColor ?? record.appearance_color ?? null,
    isActive: record.isActive ?? record.is_active ?? true,
    isAvailableByDefault: record.isAvailableByDefault ?? record.is_available_by_default ?? true,
  }
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
  const [bookedEvents, setBookedEvents] = React.useState<BookedEvent[]>([])
  const [bookedLoading, setBookedLoading] = React.useState(false)
  const [bookedError, setBookedError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingRule, setEditingRule] = React.useState<AvailabilityRule | null>(null)
  const [scheduleView, setScheduleView] = React.useState<ScheduleViewMode>('week')
  const [timezone, setTimezone] = React.useState<string>(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  const [tags, setTags] = React.useState<TagOption[]>([])
  const [activeTab, setActiveTab] = React.useState<'details' | 'availability'>('details')
  const [isAvailableByDefault, setIsAvailableByDefault] = React.useState(true)
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
        const resourceRaw = Array.isArray(record?.items) ? record.items[0] : null
        const resource = resourceRaw ? normalizeResourceRecord(resourceRaw) : null
        if (!resource) throw new Error(t('booking.resources.form.errors.notFound', 'Resource not found.'))
        if (!cancelled) {
          const customValues: Record<string, unknown> = {}
          for (const [key, value] of Object.entries(resource)) {
            if (key.startsWith('cf_')) customValues[key] = value
            else if (key.startsWith('cf:')) customValues[`cf_${key.slice(3)}`] = value
          }
          setTags(Array.isArray(resource.tags) ? resource.tags : [])
          setIsAvailableByDefault(resource.isAvailableByDefault ?? true)
          setInitialValues({
            id: resource.id,
            name: resource.name,
            description: resource.description ?? '',
            resourceTypeId: resource.resourceTypeId || '',
            capacity: resource.capacity ?? '',
            capacityUnitValue: resource.capacityUnitValue ?? '',
            appearance: { icon: resource.appearanceIcon ?? null, color: resource.appearanceColor ?? null },
            isActive: resource.isActive ?? true,
            isAvailableByDefault: resource.isAvailableByDefault ?? true,
            customFieldsetCode: resolveFieldsetCode(resource.resourceTypeId ?? null),
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
  }, [resourceId, resolveFieldsetCode, t])

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

  const refreshBookedEvents = React.useCallback(async () => {
    if (!resourceId) return
    setBookedLoading(true)
    setBookedError(null)
    try {
      const params = new URLSearchParams({
        resourceId,
        startsAt: range.start.toISOString(),
        endsAt: range.end.toISOString(),
      })
      const call = await apiCall<BookedEventsResponse>(`/api/booking/resource-events?${params.toString()}`)
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      setBookedEvents(items)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('booking.resources.schedule.error.load', 'Failed to load schedule.')
      setBookedError(message)
    } finally {
      setBookedLoading(false)
    }
  }, [range.end, range.start, resourceId, t])

  React.useEffect(() => {
    void refreshBookedEvents()
  }, [refreshBookedEvents])

  const scheduleItems = React.useMemo<ScheduleItem[]>(() => (
    buildResourceScheduleItems({
      availabilityRules,
      bookedEvents,
      isAvailableByDefault,
      translate: t,
    })
  ), [availabilityRules, bookedEvents, isAvailableByDefault, t])

  const ruleMap = React.useMemo(() => new Map(availabilityRules.map((rule) => [rule.id, rule])), [availabilityRules])
  const availabilityLabels = React.useMemo(() => {
    const mode = isAvailableByDefault ? 'unavailability' : 'availability'
    return {
      addAction: isAvailableByDefault
        ? t('booking.resources.unavailability.actions.add', 'Add unavailability')
        : t('booking.resources.availability.actions.add', 'Add availability'),
      editTitle: isAvailableByDefault
        ? t('booking.resources.unavailability.form.title.edit', 'Edit unavailability')
        : t('booking.resources.availability.form.title.edit', 'Edit availability'),
      createTitle: isAvailableByDefault
        ? t('booking.resources.unavailability.form.title.create', 'Add unavailability')
        : t('booking.resources.availability.form.title.create', 'Add availability'),
      createError: isAvailableByDefault
        ? t('booking.resources.unavailability.form.errors.create', 'Failed to create unavailability.')
        : t('booking.resources.availability.form.errors.create', 'Failed to create availability.'),
      updateError: isAvailableByDefault
        ? t('booking.resources.unavailability.form.errors.update', 'Failed to update unavailability.')
        : t('booking.resources.availability.form.errors.update', 'Failed to update availability.'),
      deleteError: isAvailableByDefault
        ? t('booking.resources.unavailability.form.errors.delete', 'Failed to delete unavailability.')
        : t('booking.resources.availability.form.errors.delete', 'Failed to delete availability.'),
      createdFlash: isAvailableByDefault
        ? t('booking.resources.unavailability.form.flash.created', 'Unavailability created.')
        : t('booking.resources.availability.form.flash.created', 'Availability created.'),
      updatedFlash: isAvailableByDefault
        ? t('booking.resources.unavailability.form.flash.updated', 'Unavailability updated.')
        : t('booking.resources.availability.form.flash.updated', 'Availability updated.'),
      deletedFlash: isAvailableByDefault
        ? t('booking.resources.unavailability.form.flash.deleted', 'Unavailability deleted.')
        : t('booking.resources.availability.form.flash.deleted', 'Availability deleted.'),
      exdatesLabel: t(`booking.resources.${mode}.form.fields.exdates`, 'Exceptions'),
      exdatesHelp: isAvailableByDefault
        ? t('booking.resources.unavailability.form.fields.exdates.help', 'Exclude these dates from unavailability.')
        : t('booking.resources.availability.form.fields.exdates.help', 'Exclude these dates from availability.'),
      exdatesAdd: t('booking.resources.availability.form.fields.exdates.add', 'Add exception'),
      exdatesRemove: t('booking.resources.availability.form.fields.exdates.remove', 'Remove'),
    }
  }, [isAvailableByDefault, t])
  const scheduleLoading = availabilityLoading || bookedLoading
  const scheduleError = availabilityError ?? bookedError

  const resourceFieldsetByTypeId = React.useMemo(() => {
    const map = new Map<string, string>()
    resourceTypes.forEach((type) => {
      map.set(type.id, resolveBookingResourceFieldsetCode(type.name))
    })
    return map
  }, [resourceTypes])

  const resolveFieldsetCode = React.useCallback((resourceTypeId?: string | null) => {
    if (!resourceTypeId) return BOOKING_RESOURCE_FIELDSET_DEFAULT
    return resourceFieldsetByTypeId.get(resourceTypeId) ?? BOOKING_RESOURCE_FIELDSET_DEFAULT
  }, [resourceFieldsetByTypeId])

  const appearanceLabels = React.useMemo(() => ({
    colorLabel: t('booking.resources.form.appearance.colorLabel', 'Color'),
    colorHelp: t('booking.resources.form.appearance.colorHelp', 'Pick a color for this resource.'),
    colorClearLabel: t('booking.resources.form.appearance.colorClear', 'Clear color'),
    iconLabel: t('booking.resources.form.appearance.iconLabel', 'Icon'),
    iconPlaceholder: t('booking.resources.form.appearance.iconPlaceholder', 'Type an emoji or icon name'),
    iconPickerTriggerLabel: t('booking.resources.form.appearance.iconPicker', 'Browse icons'),
    iconSearchPlaceholder: t('booking.resources.form.appearance.iconSearch', 'Search icons or emojis…'),
    iconSearchEmptyLabel: t('booking.resources.form.appearance.iconSearchEmpty', 'No icons match your search'),
    iconSuggestionsLabel: t('booking.resources.form.appearance.iconSuggestions', 'Suggestions'),
    iconClearLabel: t('booking.resources.form.appearance.iconClear', 'Clear icon'),
    previewEmptyLabel: t('booking.resources.form.appearance.previewEmpty', 'No appearance selected'),
  }), [t])

  const defaultAvailabilityLabel = t('booking.resources.form.fields.defaultAvailability', 'Available by default')
  const defaultAvailabilityDescription = t(
    'booking.resources.form.fields.defaultAvailability.help',
    'When unchecked, this resource is unavailable unless you add availability rules.',
  )

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('booking.resources.form.fields.name', 'Name'), type: 'text', required: true },
    {
      id: 'description',
      label: t('booking.resources.form.fields.description', 'Description'),
      type: 'richtext',
      editor: 'markdown',
    },
    {
      id: 'resourceTypeId',
      label: t('booking.resources.form.fields.type', 'Resource type'),
      type: 'custom',
      component: ({ value, setValue, setFormValue }) => (
        <select
          className="w-full h-9 rounded border px-2 text-sm"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => {
            const next = event.target.value || ''
            setValue(next)
            setFormValue('customFieldsetCode', resolveFieldsetCode(next || null))
          }}
          data-crud-focus-target=""
        >
          <option value="">{t('ui.forms.select.emptyOption', '—')}</option>
          {resourceTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      ),
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
      id: 'appearance',
      label: t('booking.resources.form.appearance.label', 'Appearance'),
      type: 'custom',
      component: ({ value, setValue, disabled }) => {
        const appearance = value && typeof value === 'object'
          ? value as { icon?: string | null; color?: string | null }
          : {}
        return (
          <AppearanceSelector
            icon={appearance.icon ?? null}
            color={appearance.color ?? null}
            onIconChange={(next) => setValue({ ...appearance, icon: next })}
            onColorChange={(next) => setValue({ ...appearance, color: next })}
            labels={appearanceLabels}
            disabled={disabled}
          />
        )
      },
    },
    {
      id: 'isAvailableByDefault',
      label: defaultAvailabilityLabel,
      description: defaultAvailabilityDescription,
      type: 'custom',
      component: ({ value, setValue, disabled }) => (
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4"
            checked={value === true}
            onChange={(event) => {
              const next = event.target.checked
              setValue(next)
              setIsAvailableByDefault(next)
            }}
            disabled={disabled}
          />
          <span className="text-sm">{defaultAvailabilityLabel}</span>
        </label>
      ),
    },
    {
      id: 'isActive',
      label: t('booking.resources.form.fields.active', 'Active'),
      type: 'checkbox',
    },
  ], [
    appearanceLabels,
    capacityUnitDictionaryId,
    defaultAvailabilityDescription,
    defaultAvailabilityLabel,
    resolveFieldsetCode,
    resourceTypes,
    t,
  ])

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
      label: availabilityLabels.exdatesLabel,
      description: availabilityLabels.exdatesHelp,
      type: 'custom',
      component: ({ value, setValue }) => {
        const values = Array.isArray(value) ? value : []
        return (
          <div className="space-y-2">
            {values.map((item, index) => (
              <div key={`${index}-${item}`} className="flex items-center gap-2">
                <Input
                  type="datetime-local"
                  value={typeof item === 'string' ? item : ''}
                  onChange={(event) => {
                    const next = [...values]
                    next[index] = event.target.value
                    setValue(next)
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    const next = values.filter((_, idx) => idx !== index)
                    setValue(next)
                  }}
                >
                  {availabilityLabels.exdatesRemove}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => setValue([...values, ''])}
            >
              {availabilityLabels.exdatesAdd}
            </Button>
          </div>
        )
      },
    },
  ], [availabilityLabels, t])

  const availabilityInitialValues = React.useMemo<AvailabilityFormValues>(() => {
    if (editingRule) {
      const parsed = parseAvailabilityRuleWindow(editingRule)
      return {
        timezone: editingRule.timezone || timezone,
        startAt: formatDateTimeLocal(parsed.startAt),
        endAt: formatDateTimeLocal(parsed.endAt),
        repeat: parsed.repeat,
        exdates: Array.isArray(editingRule.exdates) ? formatExdatesInput(editingRule.exdates) : [],
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
      exdates: [],
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
  }, [availabilityLabels, editingRule, refreshAvailability, resourceId, t, timezone])

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
    const nextIsAvailableByDefault = values.isAvailableByDefault ?? true
    const appearance = values.appearance && typeof values.appearance === 'object'
      ? values.appearance as { icon?: string | null; color?: string | null }
      : {}
    const { appearance: _appearance, customFieldsetCode: _customFieldsetCode, ...rest } = values
    const payload: Record<string, unknown> = {
      ...rest,
      id: resourceId,
      resourceTypeId: values.resourceTypeId || null,
      capacity: values.capacity ? Number(values.capacity) : null,
      capacityUnitValue: values.capacityUnitValue ? String(values.capacityUnitValue) : null,
      appearanceIcon: appearance.icon ?? null,
      appearanceColor: appearance.color ?? null,
      isActive: values.isActive ?? true,
      isAvailableByDefault: nextIsAvailableByDefault,
      ...collectCustomFieldValues(values),
    }
    if (!payload.name || String(payload.name).trim().length === 0) {
      throw createCrudFormError(t('booking.resources.form.errors.nameRequired', 'Name is required.'))
    }
    await updateCrud('booking/resources', payload, {
      errorMessage: t('booking.resources.form.errors.update', 'Failed to update resource.'),
    })
    setIsAvailableByDefault(Boolean(nextIsAvailableByDefault))
    flash(t('booking.resources.form.flash.updated', 'Resource updated.'), 'success')
  }, [resourceId, t])

  const tagLabels = React.useMemo(
    () => ({
      loading: t('booking.resources.tags.loading', 'Loading tags...'),
      placeholder: t('booking.resources.tags.placeholder', 'Type to add tags'),
      empty: t('booking.resources.tags.placeholder', 'No tags yet. Add labels to keep resources organized.'),
      loadError: t('booking.resources.tags.loadError', 'Failed to load tags.'),
      createError: t('booking.resources.tags.createError', 'Failed to create tag.'),
      updateError: t('booking.resources.tags.updateError', 'Failed to update tags.'),
      labelRequired: t('booking.resources.tags.labelRequired', 'Tag name is required.'),
      saveShortcut: t('booking.resources.tags.saveShortcut', 'Save Cmd+Enter / Ctrl+Enter'),
      cancelShortcut: t('booking.resources.tags.cancelShortcut', 'Cancel (Esc)'),
      edit: t('ui.forms.actions.edit', 'Edit'),
      cancel: t('ui.forms.actions.cancel', 'Cancel'),
      success: t('booking.resources.tags.success', 'Tags updated.'),
    }),
    [t],
  )

  const loadTagOptions = React.useCallback(
    async (query?: string): Promise<TagOption[]> => {
      const params = new URLSearchParams({ pageSize: '100' })
      if (query) params.set('search', query)
      const payload = await readApiResultOrThrow<Record<string, unknown>>(
        `/api/booking/tags?${params.toString()}`,
        undefined,
        { errorMessage: t('booking.resources.tags.loadError', 'Failed to load tags.') },
      )
      const items = Array.isArray(payload?.items) ? payload.items : []
      return items
        .map((item: unknown): TagOption | null => {
          if (!item || typeof item !== 'object') return null
          const raw = item as { id?: unknown; tagId?: unknown; label?: unknown; slug?: unknown; color?: unknown }
          const rawId =
            typeof raw.id === 'string'
              ? raw.id
              : typeof raw.tagId === 'string'
                ? raw.tagId
                : null
          if (!rawId) return null
          const labelValue =
            (typeof raw.label === 'string' && raw.label.trim().length && raw.label.trim()) ||
            (typeof raw.slug === 'string' && raw.slug.trim().length && raw.slug.trim()) ||
            rawId
          const color = typeof raw.color === 'string' && raw.color.trim().length ? raw.color.trim() : null
          return { id: rawId, label: labelValue, color }
        })
        .filter((entry): entry is TagOption => entry !== null)
    },
    [t],
  )

  const createTag = React.useCallback(
    async (label: string): Promise<TagOption> => {
      const trimmed = label.trim()
      if (!trimmed.length) {
        throw new Error(t('booking.resources.tags.labelRequired', 'Tag name is required.'))
      }
      const response = await apiCallOrThrow<Record<string, unknown>>(
        '/api/booking/tags',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label: trimmed }),
        },
        { errorMessage: t('booking.resources.tags.createError', 'Failed to create tag.') },
      )
      const payload = response.result ?? {}
      const id =
        typeof payload?.id === 'string'
          ? payload.id
          : typeof (payload as any)?.tagId === 'string'
            ? (payload as any).tagId
            : ''
      if (!id) throw new Error(t('booking.resources.tags.createError', 'Failed to create tag.'))
      const color = typeof (payload as any)?.color === 'string' && (payload as any).color.trim().length
        ? (payload as any).color.trim()
        : null
      return { id, label: trimmed, color }
    },
    [t],
  )

  const handleTagsSave = React.useCallback(
    async ({ next }: { next: TagOption[] }) => {
      if (!resourceId) return
      const tagIds = Array.from(new Set(next.map((tag) => tag.id)))
      await updateCrud('booking/resources', { id: resourceId, tags: tagIds }, {
        errorMessage: t('booking.resources.tags.updateError', 'Failed to update tags.'),
      })
      setTags(next)
      flash(t('booking.resources.tags.success', 'Tags updated.'), 'success')
    },
    [resourceId, t],
  )

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

        <div className="mt-6">
          <TagsSection
            title={t('booking.resources.tags.title', 'Tags')}
            tags={tags}
            onChange={setTags}
            loadOptions={loadTagOptions}
            createTag={createTag}
            onSave={handleTagsSave}
            labels={tagLabels}
          />
        </div>

        <div className="mt-8 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-foreground">
              {t('booking.resources.availability.section.title', 'Availability')}
            </h2>
            <Button type="button" variant="outline" onClick={() => openCreateDialog()}>
              <GanttChart className="mr-2 h-4 w-4" aria-hidden="true" />
              {availabilityLabels.addAction}
            </Button>
          </div>
          {scheduleLoading ? (
            <LoadingMessage label={t('booking.resources.schedule.loading', 'Loading schedule...')} />
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
              {editingRule ? availabilityLabels.editTitle : availabilityLabels.createTitle}
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
