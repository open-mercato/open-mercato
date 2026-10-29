import {
  processTriggersSchema,
  type ProcessEventTrigger,
  type ProcessManualTrigger,
  type ProcessScheduleTrigger,
  type ProcessTrigger,
} from '../../data/validators'

/**
 * Readers for the `agent_process_definitions.triggers` jsonb column. Dependency-free
 * and client-safe: no scheduler, no ORM, no server-only import — the trigger
 * editor and the event dispatcher read the same list through these helpers.
 */

/**
 * Tolerant parse of the stored column. A row written before this phase (or by
 * a hand-edited definition) must not take the dispatcher or the editor down:
 * unparseable entries are dropped, never thrown on.
 */
export function parseProcessTriggers(raw: unknown): ProcessTrigger[] {
  if (!Array.isArray(raw)) return []
  const parsed = processTriggersSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  const kept: ProcessTrigger[] = []
  for (const entry of raw) {
    const one = processTriggersSchema.safeParse([entry])
    if (one.success) kept.push(...one.data)
  }
  return kept
}

export function scheduleTriggers(triggers: ProcessTrigger[]): ProcessScheduleTrigger[] {
  return triggers.filter((trigger): trigger is ProcessScheduleTrigger => trigger.kind === 'schedule')
}

export function eventTriggers(triggers: ProcessTrigger[]): ProcessEventTrigger[] {
  return triggers.filter((trigger): trigger is ProcessEventTrigger => trigger.kind === 'event')
}

export function manualTrigger(triggers: ProcessTrigger[]): ProcessManualTrigger | null {
  return triggers.find((trigger): trigger is ProcessManualTrigger => trigger.kind === 'manual') ?? null
}

/** Whether the definition declares hand-starting as a capability (`/run` gates on this). */
export function allowsManualEntry(raw: unknown): boolean {
  return manualTrigger(parseProcessTriggers(raw)) !== null
}
