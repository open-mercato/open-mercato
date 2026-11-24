import { groupTimelineByDay } from '../grouping'

const now = new Date(2026, 10, 24, 15, 0, 0)

function local(day: number, hour: number, month = 10): { id: string; occurredAt: string } {
  return { id: `${month}-${day}-${hour}`, occurredAt: new Date(2026, month, day, hour, 0, 0).toISOString() }
}

const translate = (key: string, fallback: string) => `[${key}]${fallback}`

describe('groupTimelineByDay', () => {
  it('groups consecutive items of the same day and keeps the given order', () => {
    const items = [local(24, 14), local(24, 9), local(23, 18), local(20, 8)]
    const groups = groupTimelineByDay(items, 'en', now)
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ['10-24-14', '10-24-9'],
      ['10-23-18'],
      ['10-20-8'],
    ])
  })

  it('respects ascending order as given', () => {
    const items = [local(20, 8), local(23, 18), local(24, 9)]
    const groups = groupTimelineByDay(items, 'en', now)
    expect(groups.map((group) => group.dayKey)).toEqual(['2026-11-20', '2026-11-23', '2026-11-24'])
  })

  it('labels today and yesterday through the translator', () => {
    const groups = groupTimelineByDay([local(24, 9), local(23, 9), local(20, 9)], 'en', now, translate)
    expect(groups[0].label).toBe('[ui.blocks.timeline.today]Today')
    expect(groups[1].label).toBe('[ui.blocks.timeline.yesterday]Yesterday')
    expect(groups[2].label).toContain('20')
    expect(groups[2].label).toContain('November')
  })

  it('falls back to English words without a translator', () => {
    const groups = groupTimelineByDay([local(24, 9), local(23, 9)], 'en', now)
    expect(groups.map((group) => group.label)).toEqual(['Today', 'Yesterday'])
  })

  it('localizes older day labels and adds the year for other years', () => {
    const older = { id: 'old', occurredAt: new Date(2025, 2, 5, 10, 0, 0).toISOString() }
    const [group] = groupTimelineByDay([older], 'pl', now)
    expect(group.label).toContain('2025')
    expect(group.label.toLowerCase()).toContain('marca')
  })

  it('returns no groups for no items', () => {
    expect(groupTimelineByDay([], 'en', now)).toEqual([])
  })

  it('accepts a timestamp as now', () => {
    const groups = groupTimelineByDay([local(24, 9)], 'en', now.getTime())
    expect(groups[0].label).toBe('Today')
  })

  it('creates separate groups for non-adjacent items of the same day', () => {
    const groups = groupTimelineByDay([local(24, 9), local(23, 9), local(24, 8)], 'en', now)
    expect(groups.map((group) => group.dayKey)).toEqual(['2026-11-24', '2026-11-23', '2026-11-24'])
  })

  it('gives unparseable dates an invalid group with an empty label', () => {
    const groups = groupTimelineByDay([{ id: 'bad', occurredAt: 'not-a-date' }], 'en', now)
    expect(groups).toEqual([{ dayKey: 'invalid', label: '', items: [{ id: 'bad', occurredAt: 'not-a-date' }] }])
  })
})
