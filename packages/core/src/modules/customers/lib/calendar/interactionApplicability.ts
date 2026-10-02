import type { CalendarEventTypeBehavior } from '../../calendar-event-types'

export type InteractionCoreValues = Readonly<Record<string, unknown>>

const CORE_FIELD_RULES: readonly [keyof CalendarEventTypeBehavior['fields'], readonly string[]][] = [
  ['endTime', ['durationMinutes']],
  ['allDay', ['allDay']],
  ['recurrence', ['recurrenceRule', 'recurrenceEnd']],
  ['priority', ['priority']],
]

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '' || value === false) return false
  if (Array.isArray(value)) return value.length > 0
  return true
}

function hasResourceLinks(value: unknown): boolean {
  return Array.isArray(value) && value.some((link) =>
    link !== null && typeof link === 'object' && 'type' in link && link.type === 'resource')
}

export function findInapplicableCoreFields(
  behavior: CalendarEventTypeBehavior,
  values: InteractionCoreValues,
): string[] {
  const fields: string[] = []
  for (const [rule, names] of CORE_FIELD_RULES) {
    if (behavior.fields[rule]) continue
    for (const name of names) if (hasValue(values[name])) fields.push(name)
  }
  if (behavior.fields.location === 'none' && hasValue(values.location)) fields.push('location')
  if (behavior.fields.people === 'none' && hasValue(values.participants)) fields.push('participants')
  if (!behavior.fields.resources && hasResourceLinks(values.linkedEntities)) fields.push('linkedEntities')
  return fields
}

export function clearInapplicableCoreFields(
  behavior: CalendarEventTypeBehavior,
  values: InteractionCoreValues,
): Record<string, unknown> {
  const cleared: Record<string, unknown> = {}
  for (const field of findInapplicableCoreFields(behavior, values)) {
    if (field === 'linkedEntities') {
      cleared.linkedEntities = (values.linkedEntities as readonly Record<string, unknown>[])
        .filter((link) => link.type !== 'resource')
    } else {
      cleared[field] = null
    }
  }
  return cleared
}

/**
 * `ignoreHiddenClears` belongs to the selectable-type opt-in: only a caller that
 * declares `enforceSelectableType` has its explicit `null` clears of fields the
 * type hides dropped. Retaining stored resource links is unconditional — it
 * protects bookings a partial payload never meant to release.
 */
export function preserveHiddenCoreValuesOnSameTypeEdit(
  behavior: CalendarEventTypeBehavior,
  current: InteractionCoreValues,
  patch: InteractionCoreValues,
  options: { ignoreHiddenClears?: boolean } = { ignoreHiddenClears: true },
): Record<string, unknown> {
  const result = { ...patch }
  if (options.ignoreHiddenClears !== false) {
    for (const [rule, names] of CORE_FIELD_RULES) {
      if (behavior.fields[rule]) continue
      for (const name of names) if (result[name] === null) delete result[name]
    }
    if (behavior.fields.location === 'none' && result.location === null) delete result.location
    if (behavior.fields.people === 'none' && result.participants === null) delete result.participants
  }
  if (!behavior.fields.resources && result.linkedEntities !== undefined) {
    const existingLinks = Array.isArray(current.linkedEntities) ? current.linkedEntities : []
    const retainedResources = existingLinks.filter((link) =>
      link !== null && typeof link === 'object' && 'type' in link && link.type === 'resource')
    const nextLinks = Array.isArray(result.linkedEntities) ? result.linkedEntities : []
    const sentResourceIds = new Set(nextLinks.flatMap((link) =>
      link !== null && typeof link === 'object' && 'type' in link && link.type === 'resource' && 'id' in link ? [link.id] : []))
    result.linkedEntities = [
      ...nextLinks,
      ...retainedResources.filter((link) => !('id' in link) || !sentResourceIds.has(link.id)),
    ]
  }
  return result
}
