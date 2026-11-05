export function eventNameFromEntity(entityType: string, action: 'created' | 'updated' | 'deleted'): string {
  const [mod, ent] = (entityType || '').split(':')
  if (!mod || !ent) throw new Error(`Invalid entityType: ${entityType}`)
  return `${mod}.${ent}.${action}`
}

export async function emitIndexUpdate(bus: any, entityType: string, payload: { id: string; organizationId?: string | null; tenantId?: string | null }, persistent = true) {
  const event = eventNameFromEntity(entityType, 'updated')
  await bus.emitEvent(event, payload, { persistent })
}

