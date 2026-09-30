import type { AvailabilityRange, AvailabilityRuleLike, AvailabilityWindow } from '../lib/availabilityMerge'
import { getMergedAvailabilityWindows } from '../lib/availabilityMerge'

export type { AvailabilityRange, AvailabilityRuleLike, AvailabilityWindow }

export interface PlannerAvailabilityService {
  getMergedAvailabilityWindows(params: {
    rules: AvailabilityRuleLike[]
    range: AvailabilityRange
    respectTimezone?: boolean
  }): AvailabilityWindow[]
}

export class DefaultPlannerAvailabilityService implements PlannerAvailabilityService {
  getMergedAvailabilityWindows(params: {
    rules: AvailabilityRuleLike[]
    range: AvailabilityRange
    respectTimezone?: boolean
  }): AvailabilityWindow[] {
    return getMergedAvailabilityWindows(params)
  }
}
