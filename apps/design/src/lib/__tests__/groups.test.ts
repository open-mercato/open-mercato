import { ENTRY_GROUPS, groupForFamily, isEntryGroup } from '../groups'

describe('groupForFamily', () => {
  it('maps the blocks family to Blocks', () => {
    expect(groupForFamily('blocks')).toBe('blocks')
  })

  it('maps token and asset families to Foundations', () => {
    expect(groupForFamily('foundations')).toBe('foundations')
    expect(groupForFamily('icons')).toBe('foundations')
    expect(groupForFamily('library')).toBe('foundations')
  })

  it('maps every other family to Components', () => {
    for (const family of ['buttons', 'inputs', 'charts', 'overlays', 'navigation', 'schedule', 'unknown-family']) {
      expect(groupForFamily(family)).toBe('components')
    }
  })

  it('only produces known entry groups', () => {
    expect(ENTRY_GROUPS).toEqual(['foundations', 'components', 'blocks'])
    expect(isEntryGroup('blocks')).toBe(true)
    expect(isEntryGroup('introduction')).toBe(false)
  })
})
