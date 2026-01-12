declare module 'react-big-calendar' {
  import * as React from 'react'

  export type View = 'month' | 'week' | 'day' | 'agenda' | string

  export type SlotInfo = {
    start: Date
    end: Date
    slots: Date[]
    action: 'select' | 'click' | 'doubleClick'
  }

  export function dateFnsLocalizer(_config: Record<string, unknown>): unknown

  export const Calendar: React.ComponentType<Record<string, unknown>>
}
