import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { ScheduleGrid } from '../ScheduleGrid'
import { ScheduleAgenda } from '../ScheduleAgenda'
import type { ScheduleItem } from '../types'

const statuses = ['confirmed', 'negotiation', 'cancelled', 'draft'] as const
const items: ScheduleItem[] = statuses.map((status) => ({
  id: status, kind: 'event', status, title: `Meeting ${status}`,
  startsAt: new Date(2026, 5, 8, 9), endsAt: new Date(2026, 5, 8, 10),
}))
const dict = {
  'schedule.item.kind.event': 'Wydarzenie',
  'schedule.item.status.confirmed': 'Potwierdzone',
  'schedule.item.status.negotiation': 'Negocjacja',
  'schedule.item.status.cancelled': 'Anulowane',
  'schedule.item.status.draft': 'Szkic',
}

it.each([['grid', ScheduleGrid], ['agenda', ScheduleAgenda]] as const)('%s distinguishes states with labeled semantic badges and localized metadata', (_, Component) => {
  const onItemClick = jest.fn()
  render(<I18nProvider locale="pl" dict={dict}>
    <Component items={items} range={{ start: new Date(2026, 5, 8), end: new Date(2026, 5, 8, 23, 59) }} onItemClick={onItemClick} />
  </I18nProvider>)
  for (const [label, tone] of [['Potwierdzone', 'success'], ['Negocjacja', 'warning'], ['Anulowane', 'error'], ['Szkic', 'neutral']]) {
    expect(screen.getByText(label)).toHaveClass(`text-status-${tone}-text`)
  }
  expect(screen.getAllByText('Wydarzenie')).toHaveLength(4)
  expect(screen.getAllByText('09:00–10:00')).toHaveLength(4)
  expect(screen.queryByText('event')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Meeting confirmed/ }))
  expect(onItemClick).toHaveBeenCalledWith(items[0])
})
