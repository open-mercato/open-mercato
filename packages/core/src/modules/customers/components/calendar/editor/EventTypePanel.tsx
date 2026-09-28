"use client"

import * as React from 'react'
import { z } from 'zod'
import { registerComponent } from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import type { EffectiveCalendarEventType } from '../../../calendar-event-types'
import { extensionPoints } from '../../../extension-points'

export type CalendarEventPanelCapabilities = Readonly<Record<string, unknown>>

export type CalendarEventTypePanelProps = {
  definition: EffectiveCalendarEventType
  panelKey?: string
  mode: 'create' | 'edit'
  values: Readonly<Record<string, unknown>>
  errors: Readonly<Record<string, string | undefined>>
  disabled: boolean
  capabilities: CalendarEventPanelCapabilities
  setValue: (fieldId: string, value: unknown) => void
}

function DefaultEventTypePanel(): React.ReactNode {
  return null
}

const callbackSchema = z.custom<CalendarEventTypePanelProps['setValue']>(
  (value) => typeof value === 'function',
  { message: '[internal] expected a field setter' },
)

const eventTypePanelPropsSchema: z.ZodType<CalendarEventTypePanelProps> = z.object({
  definition: z.custom<EffectiveCalendarEventType>((value) => value !== null && typeof value === 'object'),
  panelKey: z.string().optional(),
  mode: z.enum(['create', 'edit']),
  values: z.record(z.string(), z.unknown()),
  errors: z.record(z.string(), z.string().optional()),
  disabled: z.boolean(),
  capabilities: z.record(z.string(), z.unknown()),
  setValue: callbackSchema,
})

registerComponent<CalendarEventTypePanelProps>({
  id: extensionPoints.hosts.calendarEventTypePanel.componentId,
  component: DefaultEventTypePanel,
  metadata: {
    module: 'customers',
    description: 'Calendar event editor type-specific panel.',
    propsSchema: eventTypePanelPropsSchema,
  },
})

export function EventTypePanel(props: CalendarEventTypePanelProps) {
  const Resolved = useRegisteredComponent<CalendarEventTypePanelProps>(
    extensionPoints.hosts.calendarEventTypePanel.componentId,
    DefaultEventTypePanel,
  )
  return <Resolved {...props} />
}
