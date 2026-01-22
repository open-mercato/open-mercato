export type UnavailabilityReasonSubjectType = 'member' | 'resource' | 'ruleset'

export const UNAVAILABILITY_REASON_DICTIONARIES = {
  member: {
    key: 'planner.unavailability-reasons.staff',
    name: 'Staff unavailability reasons',
  },
  resource: {
    key: 'planner.unavailability-reasons.resources',
    name: 'Resource unavailability reasons',
  },
  ruleset: {
    key: 'planner.unavailability-reasons.rulesets',
    name: 'Schedule unavailability reasons',
  },
} as const

export function resolveUnavailabilityReasonDictionary(subjectType: UnavailabilityReasonSubjectType) {
  return UNAVAILABILITY_REASON_DICTIONARIES[subjectType]
}
