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

export type EditorCategoryOption = { value: string; label: string }

/**
 * Builds the editor's Category quick-pick options from the tenant dictionary and
 * the user's calendar preferences:
 * - `surfacedTypes` (settings "Activity Types") filters which dictionary types are
 *   offered — a non-empty list keeps only matching labels; empty means "show all".
 * - `eventCategories` (settings "Event Categories") add custom quick-pick labels.
 * Dictionary entries keep their canonical key as the value (so category→tab/tint
 * mapping is preserved); custom labels use the label as the value.
 */
export function buildEditorCategoryOptions(params: {
  typeLabels: Record<string, string>
  surfacedTypes: string[]
  eventCategories: string[]
  selectedValue: string
  selectedFallbackLabel: string
}): EditorCategoryOption[] {
  const { typeLabels, surfacedTypes, eventCategories, selectedValue, selectedFallbackLabel } = params
  const dictionaryOptions: EditorCategoryOption[] = Object.entries(typeLabels).map(([value, label]) => ({ value, label }))
  const surfacedSet = new Set(surfacedTypes)
  const filtered =
    surfacedTypes.length > 0
      ? dictionaryOptions.filter((option) => surfacedSet.has(option.label))
      : dictionaryOptions
  const options = [...filtered]
  const knownLabels = new Set(options.map((option) => option.label))
  const knownValues = new Set(options.map((option) => option.value))
  const customLabels: string[] = []
  for (const label of [...eventCategories, ...surfacedTypes]) {
    const trimmed = label.trim()
    if (!trimmed || knownLabels.has(trimmed) || customLabels.includes(trimmed)) continue
    customLabels.push(trimmed)
  }
  for (const label of customLabels) {
    options.push({ value: label, label })
    knownValues.add(label)
  }
  if (!knownValues.has(selectedValue)) {
    options.unshift({ value: selectedValue, label: typeLabels[selectedValue] ?? selectedFallbackLabel })
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

export type BuildPayloadOptions = { mode: 'create' | 'edit'; id?: string }

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
  if (config.people === 'assignee') payload.ownerUserId = state.assigneeUserId ?? null
  if (config.hasPriority) payload.priority = PRIORITY_NUMBER[state.priority]
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
    assigneeUserId: item.ownerUserId,
    assigneeName: null,
    priority: priorityFromNumber(readUnknownNumber(raw.priority)),
    description: readUnknownString(raw.body) ?? '',
    status: item.status,
  }
}
