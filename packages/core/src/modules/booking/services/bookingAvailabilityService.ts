import type { AvailabilityRange, AvailabilityRuleLike, AvailabilityWindow } from '../lib/availabilityMerge'
import { getMergedAvailabilityWindows } from '../lib/availabilityMerge'

export type { AvailabilityRange, AvailabilityRuleLike, AvailabilityWindow }

export interface BookingAvailabilityService {
  getMergedAvailabilityWindows(params: {
    rules: AvailabilityRuleLike[]
    range: AvailabilityRange
  }): AvailabilityWindow[]
}

export class DefaultBookingAvailabilityService implements BookingAvailabilityService {
  getMergedAvailabilityWindows(params: {
    rules: AvailabilityRuleLike[]
    range: AvailabilityRange
  }): AvailabilityWindow[] {
    return getMergedAvailabilityWindows(params)
  }
}
