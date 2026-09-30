import type { InjectionWidgetModule, InjectionContext } from '@open-mercato/shared/modules/widgets/injection'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { visitAvailabilityRequestUrl, type VisitAvailabilityResponse } from '../../../lib/visitAvailabilityClient'

function VisitAvailabilityWidget() { return null }

const widget: InjectionWidgetModule<InjectionContext, Record<string, unknown>> = {
  metadata: {
    id: 'example.injection.visit-availability',
    title: 'Visit availability validation',
    requiredModules: ['customers'],
    enabled: true,
  },
  Widget: VisitAvailabilityWidget,
  eventHandlers: {
    onBeforeSave: async (values) => {
      if ((values.category ?? values.kind) !== 'visit') return { ok: true }
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
        if (blocked.some((subject) => subject.type === 'staff')) {
          fieldErrors.participants = 'example.calendar.visitAvailability.unavailable'
        }
        if (blocked.some((subject) => subject.type === 'resource')) {
          fieldErrors.resources = 'example.calendar.visitAvailability.unavailable'
        }
        return { ok: false, fieldErrors }
      } catch {
        return { ok: false, fieldErrors: { ends: 'example.calendar.visitAvailability.retry' } }
      }
    },
  },
}

export default widget
