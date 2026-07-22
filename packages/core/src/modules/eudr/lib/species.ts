import type { EudrCommodity } from '../data/validators'

export const WOOD_COMMODITY = 'wood' satisfies EudrCommodity

export function hasMissingSpecies(mapping: {
  commodity: string
  speciesScientificName?: string | null
  speciesCommonName?: string | null
}): boolean {
  if (mapping.commodity !== WOOD_COMMODITY) return false
  return !mapping.speciesScientificName?.trim() || !mapping.speciesCommonName?.trim()
}
