import type { EntityManager } from '@mikro-orm/postgresql'
import { Incident, IncidentSettings, IncidentSeverity } from '../data/entities'

export type IncidentUpdateCadenceScope = {
  organizationId: string
  tenantId: string
}

type CadenceResolution = {
  severityKey: string
  updateMinutes: number
}

const TERMINAL_STATUSES = new Set(['resolved', 'closed'])

function isValidUpdateMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
}

export function isIncidentUpdateCadenceActive(status: string): boolean {
  return !TERMINAL_STATUSES.has(status)
}

export function computeNextUpdateDueAt(now: Date, updateMinutes: number): Date {
  return new Date(now.getTime() + updateMinutes * 60_000)
}

export function clearIncidentUpdateCadence(incident: Incident): void {
  incident.nextUpdateDueAt = null
  incident.updateOverdueNotifiedAt = null
}

export async function resolveIncidentUpdateCadence(
  em: EntityManager,
  scope: IncidentUpdateCadenceScope,
  severityId: string,
): Promise<CadenceResolution | null> {
  const settings = await em.findOne(IncidentSettings, { ...scope, deletedAt: null })
  if (!settings?.updateCadence) return null

  const severity = await em.findOne(IncidentSeverity, { id: severityId, ...scope, deletedAt: null })
  if (!severity?.key) return null

  const updateMinutes = settings.updateCadence[severity.key]?.updateMinutes
  if (!isValidUpdateMinutes(updateMinutes)) return null

  return {
    severityKey: severity.key,
    updateMinutes,
  }
}

export async function applyIncidentUpdateCadence(
  em: EntityManager,
  scope: IncidentUpdateCadenceScope,
  incident: Incident,
  now: Date,
): Promise<void> {
  if (!isIncidentUpdateCadenceActive(incident.status)) {
    clearIncidentUpdateCadence(incident)
    return
  }

  const cadence = await resolveIncidentUpdateCadence(em, scope, incident.severityId)
  if (!cadence) {
    clearIncidentUpdateCadence(incident)
    return
  }

  incident.nextUpdateDueAt = computeNextUpdateDueAt(now, cadence.updateMinutes)
  incident.updateOverdueNotifiedAt = null
}
