import type { InjectionWidgetModule, InjectionContext } from '@open-mercato/shared/modules/widgets/injection'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { visitAvailabilityRequestUrl, type VisitAvailabilityResponse } from '../../../lib/visitAvailabilityClient'

function VisitAvailabilityWidget() { return null }

const widget: InjectionWidgetModule<InjectionContext, Record<string, unknown>> = {
  metadata: {
    id: 'example.injection.visit-availability',
    title: 'Visit availability validation',
    calendarEventTypeKeys: ['visit'],
    enabled: true,
  },
  Widget: VisitAvailabilityWidget,
  eventHandlers: {
    onBeforeSave: async (values, context) => {
      const fields = context.calendarEventTypeFields
      const applicability = fields && typeof fields === 'object' ? fields as Record<string, unknown> : null
      const url = visitAvailabilityRequestUrl({
        ...values,
        participants: applicability?.people === 'none' ? [] : values.participants,
        resources: applicability?.resources === false || context.calendarResourcesEnabled === false
          ? [] : values.resources,
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
