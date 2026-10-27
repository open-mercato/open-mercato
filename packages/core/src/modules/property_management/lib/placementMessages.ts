import type { PlacementIssue } from './geometry'

export type PlacementTranslator = (key: string, fallback: string, params?: Record<string, string | number>) => string

export function describePlacementIssue(issue: PlacementIssue, t: PlacementTranslator): string {
  switch (issue.code) {
    case 'invalid_size':
      return t('property_management.placement.invalidSize', 'Width and depth must be greater than 0.')
    case 'outside_floor':
      return t('property_management.placement.outsideFloor', 'It does not fit on the floor.')
    case 'outside_space':
      return issue.spaceName
        ? t('property_management.placement.outsideSpace', 'It does not fit inside {space}.', { space: issue.spaceName })
        : t('property_management.placement.noSpace', 'It is not inside any space.')
    case 'overlaps': {
      const names = issue.names.join(', ')
      if (issue.kind === 'space') return t('property_management.placement.overlapsSpace', 'It overlaps the space {names}.', { names })
      if (issue.kind === 'common_area') return t('property_management.placement.overlapsCommonArea', 'It overlaps the common area {names}.', { names })
      return t('property_management.placement.overlapsUnit', 'It overlaps the unit {names}.', { names })
    }
    case 'strands_units':
      return t('property_management.placement.strandsUnits', '{names} would stick out of this space. Move them first or keep the space larger.', {
        names: issue.names.join(', '),
      })
    default:
      return t('property_management.placement.invalid', 'This placement is not allowed.')
  }
}

export function describePlacementIssues(issues: readonly PlacementIssue[], t: PlacementTranslator): string {
  return issues.map((issue) => describePlacementIssue(issue, t)).join(' ')
}
