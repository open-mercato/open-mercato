import { describePlacementIssues } from '../lib/placementMessages'

const t = (_key: string, fallback: string, params?: Record<string, string | number>) =>
  fallback.replace(/\{(\w+)\}/g, (match, key: string) => (params && key in params ? String(params[key]) : match))

describe('describePlacementIssues', () => {
  it('names what is in the way in words', () => {
    const message = describePlacementIssues(
      [
        { code: 'outside_space', spaceName: 'Coworking' },
        { code: 'overlaps', kind: 'unit', names: ['Dedicated desks'] },
        { code: 'overlaps', kind: 'common_area', names: ['Kitchen'] },
      ],
      t,
    )
    expect(message).toContain('Coworking')
    expect(message).toContain('Dedicated desks')
    expect(message).toContain('Kitchen')
  })

  it('names stranded units of a shrunk space', () => {
    expect(describePlacementIssues([{ code: 'strands_units', names: ['Tiny Meeting Room', 'Dedicated desks'] }], t)).toContain(
      'Tiny Meeting Room, Dedicated desks would stick out',
    )
  })
})
