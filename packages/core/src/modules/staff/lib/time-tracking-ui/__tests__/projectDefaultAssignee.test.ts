import { isUsableDefaultAssigneeMembership } from '../ProjectFormSections'

const NOW = new Date(2026, 9, 14, 12, 0, 0)

describe('isUsableDefaultAssigneeMembership', () => {
  it('accepts an active, open-ended membership', () => {
    expect(isUsableDefaultAssigneeMembership({ status: 'active' }, 14, NOW)).toBe(true)
  })

  it('refuses a membership that is not active', () => {
    expect(isUsableDefaultAssigneeMembership({ status: 'inactive' }, 14, NOW)).toBe(false)
    expect(isUsableDefaultAssigneeMembership({}, 14, NOW)).toBe(false)
  })

  it('refuses a membership that has not started yet', () => {
    expect(isUsableDefaultAssigneeMembership({ status: 'active', assigned_start_date: '2026-10-20' }, 14, NOW)).toBe(false)
  })

  it('keeps an ended membership usable through the grace days, then refuses it', () => {
    expect(isUsableDefaultAssigneeMembership({ status: 'active', assigned_end_date: '2026-10-04' }, 14, NOW)).toBe(true)
    expect(isUsableDefaultAssigneeMembership({ status: 'active', assignedEndDate: '2026-09-20' }, 14, NOW)).toBe(false)
    expect(isUsableDefaultAssigneeMembership({ status: 'active', assigned_end_date: '2026-10-13' }, 0, NOW)).toBe(false)
  })
})
