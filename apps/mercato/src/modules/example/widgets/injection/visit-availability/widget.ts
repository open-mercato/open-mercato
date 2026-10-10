import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetModule, InjectionContext } from '@open-mercato/shared/modules/widgets/injection'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { visitAvailabilityRequestUrl, visitAvailabilitySubjectMessage, type VisitAvailabilityResponse } from '../../../lib/visitAvailabilityClient'

import VisitAvailabilityWidget from './widget.client'

const widget: InjectionWidgetModule<InjectionContext, Record<string, unknown>> = {
  metadata: {
    id: 'example.injection.visit-availability',
    title: 'Visit availability validation',
    requiredModules: ['customers'],
    enabled: true,
  },
  Widget: VisitAvailabilityWidget,
  eventHandlers: {
    onBeforeSave: async (values, context) => {
      const state = context.sharedState as { get?: (key: string) => unknown } | undefined
      const candidate = state?.get?.('visitAvailabilityTranslate')
      const translate = typeof candidate === 'function' ? candidate as TranslateFn : null
      const eventTypeKey = values.category ?? values.kind
      if (typeof eventTypeKey !== 'string' || eventTypeKey.trim().toLowerCase() !== 'visit') return { ok: true }
      let fields: Record<string, unknown>
      try {
        const catalog = await apiCall<{ items: { key: string; behavior: { fields: Record<string, unknown> } }[] }>('/api/customers/activity-types')
        const definition = catalog.result?.items?.find((item) => item.key === 'visit')
        if (!catalog.ok || !definition) return { ok: false, fieldErrors: { ends: 'example.calendar.visitAvailability.retry' } }
        fields = definition.behavior.fields
      } catch {
        return { ok: false, fieldErrors: { ends: 'example.calendar.visitAvailability.retry' } }
      }
      const url = visitAvailabilityRequestUrl({
        ...values,
        participants: fields.people === 'none' ? [] : values.participants,
        resources: fields.resources === false ? [] : values.resources,
      })
      if (!url) return { ok: false, fieldErrors: { ends: 'example.calendar.visitAvailability.invalidInterval' } }
      try {
        const { ok, result } = await apiCall<VisitAvailabilityResponse>(url)
        if (!ok || !result || !Array.isArray(result.subjects)) {
          return { ok: false, fieldErrors: { ends: 'example.calendar.visitAvailability.retry' } }
        }
        const blocked = result.subjects.filter((subject) => subject.status !== 'available')
        if (!blocked.length) return { ok: true }
        const fieldErrors: Record<string, string> = {}
        for (const type of ['staff', 'resource'] as const) {
          const subjects = blocked.filter((subject) => subject.type === type)
          if (!subjects.length) continue
          fieldErrors[type === 'staff' ? 'participants' : 'resources'] = translate
            ? subjects.map((subject) => visitAvailabilitySubjectMessage(subject, values, translate)).join('\n')
            : 'example.calendar.visitAvailability.unavailable'
        }
        return { ok: false, fieldErrors }
      } catch {
        return { ok: false, fieldErrors: { ends: 'example.calendar.visitAvailability.retry' } }
      }
    },
  },
}

export default widget
