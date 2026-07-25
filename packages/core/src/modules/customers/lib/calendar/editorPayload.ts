import type { CalendarItem } from '../../components/calendar/types'
import { parseRecurrenceRule } from './recurrence'

export type EditorKind = 'meeting' | 'call' | 'email' | 'note' | 'event' | 'task'

export const EDITOR_KINDS: EditorKind[] = ['meeting', 'call', 'email', 'note', 'event', 'task']

export type EditorDateLabel = 'starts' | 'when' | 'sent' | 'logged' | 'due'

export type EditorPeopleMode = 'attendees' | 'participants' | 'to' | 'assignee'

export type EditorKindConfig = {
  dateLabel: EditorDateLabel
  hasEnd: boolean
  hasAllDay: boolean
  hasRepeat: boolean
  location: 'location' | 'phoneLink' | null
  people: EditorPeopleMode | null
  hasPriority: boolean
}

export const KIND_CONFIG: Record<EditorKind, EditorKindConfig> = {
  meeting: { dateLabel: 'starts', hasEnd: true, hasAllDay: true, hasRepeat: true, location: 'location', people: 'attendees', hasPriority: false },
  call: { dateLabel: 'when', hasEnd: false, hasAllDay: true, hasRepeat: true, location: 'phoneLink', people: 'participants', hasPriority: false },
  email: { dateLabel: 'sent', hasEnd: false, hasAllDay: true, hasRepeat: true, location: null, people: 'to', hasPriority: false },
  note: { dateLabel: 'logged', hasEnd: false, hasAllDay: false, hasRepeat: false, location: null, people: null, hasPriority: false },
  event: { dateLabel: 'starts', hasEnd: true, hasAllDay: true, hasRepeat: true, location: 'location', people: 'attendees', hasPriority: false },
  task: { dateLabel: 'due', hasEnd: false, hasAllDay: true, hasRepeat: true, location: null, people: 'assignee', hasPriority: true },
}

const KIND_BY_INTERACTION_TYPE: Record<string, EditorKind> = {
  meeting: 'meeting',
  call: 'call',
  'video-call': 'call',
  email: 'email',
  note: 'note',
  event: 'event',
  webinar: 'event',
  task: 'task',
  todo: 'task',
  deadline: 'task',
}

export function editorKindOfInteractionType(interactionType: string): EditorKind {
  return KIND_BY_INTERACTION_TYPE[interactionType] ?? 'meeting'
}

export type EditorTypeOption = { value: string; label: string; icon: string | null }

/** Fallback switcher icons matching the seeded dictionary appearance icons. */
export const EDITOR_KIND_ICONS: Record<EditorKind, string> = {
  meeting: 'lucide:users',
  call: 'lucide:phone-call',
  email: 'lucide:mail',
  note: 'lucide:notebook',
  event: 'lucide:calendar',
  task: 'lucide:check-square',
}

/**
 * Builds the editor's type-switcher options from the tenant `activity-types`
 * dictionary (#3552) so tenant-added types are first-class calendar event types,
 * not just Category values. Field morphology per option resolves through
 * `editorKindOfInteractionType` (custom types get the meeting-shaped default).
 * Falls back to the built-in kinds when the dictionary is empty/unavailable,
 * and always includes the currently selected value (e.g. a since-deleted type
 * on an existing event). Icons come from the dictionary entry appearance with
 * the seeded kind icons as fallback.
 */
export function buildEditorTypeOptions(params: {
  typeLabels: Record<string, string>
  typeIcons?: Record<string, string | null>
  selectedValue: string
  kindLabels: Record<EditorKind, string>
}): EditorTypeOption[] {
  const { typeLabels, typeIcons, selectedValue, kindLabels } = params
  const iconOf = (value: string): string | null =>
    typeIcons?.[value] ?? EDITOR_KIND_ICONS[editorKindOfInteractionType(value)] ?? null
  const dictionaryEntries = Object.entries(typeLabels)
  const options: EditorTypeOption[] = dictionaryEntries.length
    ? dictionaryEntries.map(([value, label]) => ({ value, label, icon: iconOf(value) }))
    : EDITOR_KINDS.map((kind) => ({ value: kind, label: kindLabels[kind], icon: EDITOR_KIND_ICONS[kind] }))
  if (!options.some((option) => option.value === selectedValue)) {
    options.unshift({
      value: selectedValue,
      label: typeLabels[selectedValue] ?? kindLabels[editorKindOfInteractionType(selectedValue)] ?? selectedValue,
      icon: iconOf(selectedValue),
    })
  }
  return options
}

export type EditorRepeatFreq = 'none' | 'daily' | 'weekly'

export type EditorRepeatEndType = 'never' | 'date' | 'count'

export type EditorPriority = 'low' | 'medium' | 'high'

export const PRIORITY_NUMBER: Record<EditorPriority, number> = { low: 10, medium: 50, high: 90 }

export function priorityFromNumber(value: number | null | undefined): EditorPriority {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'medium'
  if (value <= 33) return 'low'
  if (value <= 66) return 'medium'
  return 'high'
}

export type EditorRelatedTo = {
  id: string
  kind: 'person' | 'company' | 'unknown'
  label: string
}

export type EditorParticipant = {
  userId: string
  name: string
  email?: string
  isCustomer: boolean
}

/** linkedEntities `type` marker for resource assignments (FK-id + label snapshot). */
export const RESOURCE_LINK_TYPE = 'resource'

export type EditorLinkedEntity = { id: string; type: string; label: string }

export type EditorResource = { id: string; label: string }

export function parseLinkedEntities(raw: unknown): {
  resources: EditorResource[]
  preservedLinkedEntities: EditorLinkedEntity[]
} {
  const resources: EditorResource[] = []
  const preservedLinkedEntities: EditorLinkedEntity[] = []
  if (!Array.isArray(raw)) return { resources, preservedLinkedEntities }
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { id, type, label } = entry as Record<string, unknown>
    if (typeof id !== 'string' || !id.length || typeof type !== 'string' || !type.length) continue
    const safeLabel = typeof label === 'string' ? label : ''
    if (type === RESOURCE_LINK_TYPE) resources.push({ id, label: safeLabel || id })
    else preservedLinkedEntities.push({ id, type, label: safeLabel })
  }
  return { resources, preservedLinkedEntities }
}

export type EditorFormState = {
  kind: EditorKind
  title: string
  relatedTo: EditorRelatedTo | null
  dealId: string | null
  dealLabel: string | null
  allDay: boolean
  date: string
  startTime: string
  endDate: string
  endTime: string
  repeatFreq: EditorRepeatFreq
  repeatDays: boolean[]
  repeatEndType: EditorRepeatEndType
  repeatCount: number
  repeatUntilDate: string
  category: string | null
  location: string
  participants: EditorParticipant[]
  resources: EditorResource[]
  preservedLinkedEntities: EditorLinkedEntity[]
  assigneeUserId: string | null
  assigneeName: string | null
  priority: EditorPriority
  description: string
  status: 'planned' | 'done' | 'canceled'
}

const MO_FIRST_DAY_TOKENS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const

function padDatePart(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatLocalDateInput(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
}

export function formatLocalTimeInput(date: Date): string {
  return `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`
}

function moFirstIndexOfDate(date: Date): number {
  return (date.getDay() + 6) % 7
}

export function defaultRepeatDaysForDateInput(dateInput: string): boolean[] {
  const parsed = new Date(`${dateInput}T00:00:00`)
  return defaultRepeatDays(Number.isNaN(parsed.getTime()) ? new Date() : parsed)
}

function defaultRepeatDays(start: Date): boolean[] {
  const days = [false, false, false, false, false, false, false]
  days[moFirstIndexOfDate(start)] = true
  return days
}

/**
 * Resolves the `ownerUserId` an interaction will actually be SAVED with, so the
 * editor's conflict probe keys on the same owner the grid sees after save (see
 * buildInteractionPayload + the create/update command):
 * - Task (people === 'assignee'): owner = the assignee.
 * - Other kinds: the payload omits owner, so edit preserves the existing owner
 *   and create is ownerless (null) — conflicts then come from participants only.
 */
export function resolveSavedOwnerUserId(
  config: EditorKindConfig,
  form: EditorFormState,
  isEdit: boolean,
  existingOwnerUserId: string | null,
): string | null {
  if (config.people === 'assignee') return form.assigneeUserId ?? null
  return isEdit ? existingOwnerUserId : null
}

export function createDefaultFormState(
  defaultDate?: Date | null,
  now: Date = new Date(),
  range?: { start: Date; end: Date } | null,
): EditorFormState {
  let base: Date
  let end: Date
  if (range) {
    base = new Date(range.start)
    end = new Date(range.end)
  } else {
    base = defaultDate ? new Date(defaultDate) : new Date(now)
    base.setHours(now.getHours(), 0, 0, 0)
    base.setHours(base.getHours() + 1)
    end = new Date(base.getTime() + 90 * 60_000)
  }
  return {
    kind: 'meeting',
    title: '',
    relatedTo: null,
    dealId: null,
    dealLabel: null,
    allDay: false,
    date: formatLocalDateInput(base),
    startTime: formatLocalTimeInput(base),
    endDate: formatLocalDateInput(end),
    endTime: formatLocalTimeInput(end),
    repeatFreq: 'none',
    repeatDays: defaultRepeatDays(base),
    repeatEndType: 'never',
    repeatCount: 8,
    repeatUntilDate: '',
    category: null,
    location: '',
    participants: [],
    resources: [],
    preservedLinkedEntities: [],
    assigneeUserId: null,
    assigneeName: null,
    priority: 'medium',
    description: '',
    status: 'planned',
  }
}

export function buildRecurrenceRule(state: EditorFormState): string | null {
  if (state.repeatFreq === 'none') return null
  let rule: string
  if (state.repeatFreq === 'daily') {
    rule = 'FREQ=DAILY'
  } else {
    const selected = MO_FIRST_DAY_TOKENS.filter((_, index) => state.repeatDays[index])
    const tokens = selected.length > 0
      ? selected
      : [MO_FIRST_DAY_TOKENS[moFirstIndexOfDate(new Date(`${state.date}T00:00:00`))]]
    rule = `FREQ=WEEKLY;BYDAY=${tokens.join(',')}`
  }
  if (state.repeatEndType === 'count') rule += `;COUNT=${state.repeatCount}`
  if (state.repeatEndType === 'date' && state.repeatUntilDate) {
    rule += `;UNTIL=${state.repeatUntilDate.replace(/-/g, '')}T235959Z`
  }
  return rule
}

export function computeDurationMinutes(state: EditorFormState): number | null {
  const start = new Date(`${state.date}T${state.startTime}:00`)
  const end = new Date(`${state.endDate}T${state.endTime}:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000)
  return minutes > 0 ? minutes : null
}

export type BuildPayloadOptions = {
  mode: 'create' | 'edit'
  id?: string
  /**
   * When the resources module is loaded the payload owns `linkedEntities`
   * (preserved non-resource links + current resource assignments). When it is
   * not, the key is omitted entirely so edits never clobber links written by
   * other surfaces.
   */
  resourcesEnabled?: boolean
  /**
   * When the staff module is absent the Assignee field is hidden, so the
   * payload omits `ownerUserId` (edit keeps the stored owner untouched).
   */
  staffEnabled?: boolean
}

export function buildInteractionPayload(state: EditorFormState, options: BuildPayloadOptions): Record<string, unknown> {
  const config = KIND_CONFIG[state.kind]
  const time = state.allDay && config.hasAllDay ? '00:00' : state.startTime
  const scheduledAt = new Date(`${state.date}T${time}:00`).toISOString()
  const recurrenceRule = config.hasRepeat ? buildRecurrenceRule(state) : null
  const payload: Record<string, unknown> = {
    ...(options.mode === 'edit' && options.id ? { id: options.id } : {}),
    entityId: state.relatedTo?.id ?? null,
    dealId: state.dealId ?? null,
    interactionType: state.category ?? state.kind,
    title: state.title.trim(),
    body: state.description.trim() || null,
    status: options.mode === 'create' ? 'planned' : state.status,
    date: state.date,
    time,
    scheduledAt,
    durationMinutes: config.hasEnd && !(state.allDay && config.hasAllDay) ? computeDurationMinutes(state) : null,
    allDay: config.hasAllDay ? state.allDay : null,
    location: config.location ? state.location.trim() || null : null,
    recurrenceRule,
    recurrenceEnd:
      recurrenceRule && state.repeatEndType === 'date' && state.repeatUntilDate
        ? new Date(state.repeatUntilDate).toISOString()
        : null,
    participants:
      config.people && config.people !== 'assignee' && state.participants.length > 0
        ? state.participants.map((participant) => ({
            userId: participant.userId,
            name: participant.name,
            email: participant.email,
            status: participant.isCustomer ? 'customer' : 'pending',
          }))
        : null,
  }
  if (config.people === 'assignee' && (options.staffEnabled ?? true)) {
    payload.ownerUserId = state.assigneeUserId ?? null
  }
  if (config.hasPriority) payload.priority = PRIORITY_NUMBER[state.priority]
  if (options.resourcesEnabled) {
    const linkedEntities: EditorLinkedEntity[] = [
      ...state.preservedLinkedEntities,
      ...state.resources.map((resource) => ({ id: resource.id, type: RESOURCE_LINK_TYPE, label: resource.label })),
    ]
    payload.linkedEntities = linkedEntities.length > 0 ? linkedEntities : null
  }
  return payload
}

function readUnknownString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readUnknownNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

type ParsedRepeat = Pick<EditorFormState, 'repeatFreq' | 'repeatDays' | 'repeatEndType' | 'repeatCount' | 'repeatUntilDate'>

function parseRepeatFromRule(rawRule: unknown, start: Date): ParsedRepeat {
  const fallback: ParsedRepeat = {
    repeatFreq: 'none',
    repeatDays: defaultRepeatDays(start),
    repeatEndType: 'never',
    repeatCount: 8,
    repeatUntilDate: '',
  }
  const ruleText = readUnknownString(rawRule)
  if (!ruleText) return fallback
  const parsed = parseRecurrenceRule(ruleText)
  if (!parsed) return fallback
  const repeatDays = defaultRepeatDays(start)
  if (parsed.byDay) {
    repeatDays.fill(false)
    for (const jsWeekday of parsed.byDay) repeatDays[(jsWeekday + 6) % 7] = true
  }
  let repeatEndType: EditorRepeatEndType = 'never'
  let repeatCount = 8
  let repeatUntilDate = ''
  if (parsed.count !== null) {
    repeatEndType = 'count'
    repeatCount = parsed.count
  } else if (parsed.until) {
    repeatEndType = 'date'
    repeatUntilDate = `${parsed.until.getUTCFullYear()}-${padDatePart(parsed.until.getUTCMonth() + 1)}-${padDatePart(parsed.until.getUTCDate())}`
  }
  return {
    repeatFreq: parsed.freq === 'DAILY' ? 'daily' : 'weekly',
    repeatDays,
    repeatEndType,
    repeatCount,
    repeatUntilDate,
  }
}

function parseParticipants(item: CalendarItem): EditorParticipant[] {
  const rawParticipants = Array.isArray(item.raw.participants) ? item.raw.participants : []
  const statusByUserId = new Map<string, string | null>()
  for (const raw of rawParticipants) {
    statusByUserId.set(raw.userId, readUnknownString((raw as Record<string, unknown>).status))
  }
  return item.participants.map((participant) => ({
    userId: participant.userId,
    name: participant.name ?? participant.email ?? participant.userId,
    email: participant.email,
    isCustomer: statusByUserId.get(participant.userId) === 'customer',
  }))
}

export function parseItemToFormState(item: CalendarItem): EditorFormState {
  const kind = editorKindOfInteractionType(item.interactionType)
  const raw = item.raw as Record<string, unknown>
  const { resources, preservedLinkedEntities } = parseLinkedEntities(raw.linkedEntities)
  return {
    kind,
    title: item.title,
    relatedTo: item.entityId ? { id: item.entityId, kind: 'unknown', label: '' } : null,
    dealId: item.dealId,
    dealLabel: null,
    allDay: item.allDay,
    date: formatLocalDateInput(item.start),
    startTime: formatLocalTimeInput(item.start),
    endDate: formatLocalDateInput(item.end),
    endTime: formatLocalTimeInput(item.end),
    ...parseRepeatFromRule(item.raw.recurrenceRule, item.start),
    category: item.interactionType,
    location: item.location ?? '',
    participants: parseParticipants(item),
    resources,
    preservedLinkedEntities,
    assigneeUserId: item.ownerUserId,
    assigneeName: null,
    priority: priorityFromNumber(readUnknownNumber(raw.priority)),
    description: readUnknownString(raw.body) ?? '',
    status: item.status,
  }
}
