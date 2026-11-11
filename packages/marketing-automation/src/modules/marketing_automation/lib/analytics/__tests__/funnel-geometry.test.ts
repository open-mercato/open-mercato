import { buildFunnelBands } from '../funnel-geometry'

describe('buildFunnelBands', () => {
  it('tapers each band towards the stage below it', () => {
    const bands = buildFunnelBands([
      { key: 'entered', people: 100 },
      { key: 'sent', people: 50 },
      { key: 'opened', people: 25 },
    ])

    expect(bands.map((band) => [band.topRatio, band.bottomRatio])).toEqual([
      [1, 0.5],
      [0.5, 0.25],
      // The last band has nothing below it, so it stays straight rather than closing to a point it never
      // measured.
      [0.25, 0.25],
    ])
  })

  it('gives a stage nobody reached a sliver rather than a line', () => {
    const bands = buildFunnelBands([
      { key: 'entered', people: 10 },
      { key: 'ordered', people: 0 },
    ])

    expect(bands[1].topRatio).toBeGreaterThan(0)
    // Narrow enough that nobody reads it as a quantity.
    expect(bands[1].topRatio).toBeLessThan(0.05)
    expect(bands[0].bottomRatio).toBe(bands[1].topRatio)
  })

  it('scales against the widest stage, not the first', () => {
    // Real shape: somebody buys without clicking the message, so a later stage outgrows an earlier one.
    const bands = buildFunnelBands([
      { key: 'entered', people: 10 },
      { key: 'clicked', people: 2 },
      { key: 'ordered', people: 20 },
    ])

    // Scaling against the first would have produced a band twice the width of the chart.
    expect(Math.max(...bands.map((band) => band.topRatio))).toBe(1)
    expect(bands[2].topRatio).toBe(1)
    expect(bands[0].topRatio).toBe(0.5)
  })

  it('refuses a conversion rate out of an empty stage', () => {
    const bands = buildFunnelBands([
      { key: 'entered', people: 0 },
      { key: 'sent', people: 0 },
    ])

    // Not 0%: nobody converted from nobody, and a zero would claim everybody dropped out.
    expect(bands[1].fromPrevious).toBeNull()
    expect(bands[0].shareOfFirst).toBeNull()
  })

  it('has no first conversion to report', () => {
    const bands = buildFunnelBands([{ key: 'entered', people: 7 }])

    expect(bands[0].fromPrevious).toBeNull()
    expect(bands[0].shareOfFirst).toBe(1)
  })

  it('returns nothing for no stages', () => {
    expect(buildFunnelBands([])).toEqual([])
  })
})
