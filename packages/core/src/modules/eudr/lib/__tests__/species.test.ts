import { hasMissingSpecies } from '../species'

describe('hasMissingSpecies', () => {
  it('returns false for wood when both species names are present', () => {
    expect(hasMissingSpecies({
      commodity: 'wood',
      speciesScientificName: 'Quercus robur',
      speciesCommonName: 'European oak',
    })).toBe(false)
  })

  it.each([
    ['missing scientific name', { speciesScientificName: null, speciesCommonName: 'European oak' }],
    ['missing common name', { speciesScientificName: 'Quercus robur', speciesCommonName: undefined }],
    ['both names missing', { speciesScientificName: null, speciesCommonName: null }],
    ['whitespace scientific name', { speciesScientificName: '  ', speciesCommonName: 'European oak' }],
    ['whitespace common name', { speciesScientificName: 'Quercus robur', speciesCommonName: '\t' }],
    ['both names whitespace-only', { speciesScientificName: ' \n ', speciesCommonName: '\t ' }],
  ])('returns true for wood with %s', (_caseName, species) => {
    expect(hasMissingSpecies({ commodity: 'wood', ...species })).toBe(true)
  })

  it('returns false for a non-wood commodity without species names', () => {
    expect(hasMissingSpecies({ commodity: 'cocoa' })).toBe(false)
  })
})
