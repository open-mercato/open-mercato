import type { InjectionContext, InjectionEventParticipant } from '@open-mercato/shared/modules/widgets/injection'
import type { LoadedInjectionDataWidget } from '@open-mercato/shared/modules/widgets/injection-loader'
import type { LoadedInjectionSpotWidget } from './InjectionSpot'

export type LoadedInjectionEventParticipant = InjectionEventParticipant<InjectionContext, Record<string, unknown>>

export function mergeInjectionEventParticipants(
  renderedWidgets: readonly LoadedInjectionSpotWidget[],
  fieldWidgets: readonly LoadedInjectionDataWidget[],
): LoadedInjectionEventParticipant[] {
  const participants: LoadedInjectionEventParticipant[] = []
  const seen = new Set<string>()
  for (const widget of renderedWidgets) {
    if (!widget.module?.metadata || widget.module.metadata.enabled === false || seen.has(widget.widgetId)) continue
    seen.add(widget.widgetId)
    participants.push(widget)
  }
  for (const widget of fieldWidgets) {
    if (!('fields' in widget) || !widget.metadata || widget.metadata.enabled === false || seen.has(widget.metadata.id)) continue
    seen.add(widget.metadata.id)
    participants.push({
      widgetId: widget.metadata.id,
      moduleId: widget.moduleId,
      key: widget.key,
      module: widget,
      placement: widget.placement,
    })
  }
  return participants
}
