type EventTriggerInstance = {
  metadata?: {
    initiatedBy?: string | null
    labels?: Record<string, string>
  } | null
}

export function assertTrustedEventTriggerIdentity(instance: EventTriggerInstance): void {
  const triggerId = instance.metadata?.labels?.trigger_id
  if (triggerId && instance.metadata?.initiatedBy !== `trigger:${triggerId}`) {
    throw new Error('[internal] Untrusted legacy event-triggered workflow identity; cancel and restart this instance')
  }
}
