import { buildCollectionPreview, normalizeCollectionLabels } from '../list/CollectionPreviewCell'

describe('CollectionPreviewCell helpers', () => {
  it('normalizes and trims empty labels', () => {
    expect(normalizeCollectionLabels(['  Alpha  ', '', '   ', null, undefined, 'Beta'])).toEqual([
      'Alpha',
      'Beta',
    ])
  })

  it('shows a compact preview with remaining count', () => {
    expect(buildCollectionPreview(['Alpha', 'Beta', 'Gamma', 'Delta'], 2)).toEqual({
      visibleText: 'Alpha, Beta',
      hiddenCount: 2,
      tooltipText: 'Alpha, Beta, Gamma, Delta',
    })
  })

  it('keeps a single visible item when maxVisible is below one', () => {
    expect(buildCollectionPreview(['Alpha', 'Beta'], 0)).toEqual({
      visibleText: 'Alpha',
      hiddenCount: 1,
      tooltipText: 'Alpha, Beta',
    })
  })

  it('returns empty values when no usable labels exist', () => {
    expect(buildCollectionPreview(['', '   '], 2)).toEqual({
      visibleText: '',
      hiddenCount: 0,
      tooltipText: '',
    })
  })
})
