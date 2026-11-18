import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { formatPreviewBookingTime } from '../components/availability/availabilityModel'
import { formatBookingTime } from '../components/bookings/bookingModel'

const t = ((key: string, fallback?: string) => fallback ?? key) as TranslateFn

describe('formatPreviewBookingTime', () => {
  it('labels a midnight-to-midnight booking as a whole day', () => {
    expect(formatPreviewBookingTime(t, { startsAt: '2099-03-10T00:00', endsAt: '2099-03-11T00:00' }, 'en-GB')).toBe('Whole day')
  })

  it('shows a next-day 00:00 end as midnight', () => {
    expect(formatPreviewBookingTime(t, { startsAt: '2099-03-10T18:00', endsAt: '2099-03-11T00:00' }, 'en-GB')).toBe('18:00–midnight')
  })

  it('formats an ordinary booking with the locale clock', () => {
    expect(formatPreviewBookingTime(t, { startsAt: '2099-03-10T09:00', endsAt: '2099-03-10T11:30' }, 'en-GB')).toBe('9:00–11:30')
    expect(formatPreviewBookingTime(t, { startsAt: '2099-03-10T09:00', endsAt: '2099-03-10T11:30' }, 'en-US').replace(/\s/g, ' ')).toBe('9:00 AM–11:30 AM')
  })
})

describe('formatBookingTime', () => {
  it('formats the bookings list time with the reader locale, like the availability preview', () => {
    const booking = { startsAt: '2099-03-10T09:00', endsAt: '2099-03-10T11:30', billingUnit: 'hour' as const }
    expect(formatBookingTime(t, booking, 'en-GB').time).toBe(formatPreviewBookingTime(t, booking, 'en-GB'))
    expect(formatBookingTime(t, booking, 'en-US').time.replace(/\s/g, ' ')).toBe('9:00 AM–11:30 AM')
  })

  it('shows a next-day 00:00 end as midnight and a day booking as a whole day', () => {
    expect(formatBookingTime(t, { startsAt: '2099-03-10T18:00', endsAt: '2099-03-11T00:00', billingUnit: 'hour' }, 'en-GB').time).toBe('18:00–midnight')
    expect(formatBookingTime(t, { startsAt: '2099-03-10T00:00', endsAt: '2099-03-11T00:00', billingUnit: 'hour' }, 'en-GB').time).toBe('Whole day')
    expect(formatBookingTime(t, { startsAt: '2099-03-10T00:00', endsAt: '2099-03-11T00:00', billingUnit: 'day' }, 'en-GB').time).toBe('Whole day')
  })
})
