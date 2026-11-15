import type { InjectionContext, InjectionEventParticipant } from '@open-mercato/shared/modules/widgets/injection'
import type { LoadedInjectionDataWidget } from '@open-mercato/shared/modules/widgets/injection-loader'
import type { LoadedInjectionSpotWidget } from './InjectionSpot'

export type LoadedInjectionEventParticipant = InjectionEventParticipant<InjectionContext, Record<string, unknown>>

async function skipInjectedFieldDeleteEvent(): Promise<void> {}

const injectedFieldDeleteEventDefaults = {
  onBeforeDelete: skipInjectedFieldDeleteEvent,
  onDelete: skipInjectedFieldDeleteEvent,
  onAfterDelete: skipInjectedFieldDeleteEvent,
}

function participantPriority(participant: LoadedInjectionEventParticipant): number {
  const placementPriority = participant.placement?.priority
  if (typeof placementPriority === 'number') return placementPriority
  return typeof participant.module.metadata.priority === 'number' ? participant.module.metadata.priority : 0
}

export function mergeInjectionEventParticipants(
  renderedWidgets: readonly LoadedInjectionSpotWidget[],
  fieldWidgets: readonly LoadedInjectionDataWidget[],
): LoadedInjectionEventParticipant[] {
  const participants: LoadedInjectionEventParticipant[] = []
  const seen = new Set<string>()
  let hasFieldEventHandlers = false
  for (const widget of renderedWidgets) {
    if (!widget.module?.metadata || widget.module.metadata.enabled === false || seen.has(widget.widgetId)) continue
    seen.add(widget.widgetId)
    participants.push(widget)
  }
  for (const widget of fieldWidgets) {
    if (!('fields' in widget) || !widget.metadata || !widget.eventHandlers || widget.metadata.enabled === false) continue
    hasFieldEventHandlers = true
    if (seen.has(widget.metadata.id)) continue
    seen.add(widget.metadata.id)
    participants.push({
      widgetId: widget.metadata.id,
      moduleId: widget.moduleId,
      key: widget.key,
      module: {
        ...widget,
        eventHandlers: { ...injectedFieldDeleteEventDefaults, ...widget.eventHandlers },
      },
      placement: widget.placement,
    })
  }
  return hasFieldEventHandlers
    ? participants.sort((left, right) => participantPriority(right) - participantPriority(left))
    : participants
}
