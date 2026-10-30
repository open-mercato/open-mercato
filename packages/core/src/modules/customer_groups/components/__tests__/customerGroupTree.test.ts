import { nextFreePriority } from '../customerGroupTree'

describe('nextFreePriority', () => {
  it('starts at 0 when the tenant has no groups', () => {
    expect(nextFreePriority([])).toBe(0)
    expect(nextFreePriority(undefined)).toBe(0)
    expect(nextFreePriority(null)).toBe(0)
  })

  it('places a new group one reorder step above the highest priority', () => {
    expect(nextFreePriority([{ priority: 40 }])).toBe(50)
    expect(nextFreePriority([{ priority: -30 }, { priority: 20 }, { priority: 5 }])).toBe(30)
  })

  it('ignores items without a numeric priority', () => {
    expect(nextFreePriority([{ priority: '90' }, null, { name: 'x' }, { priority: 7 }])).toBe(17)
  })
})
