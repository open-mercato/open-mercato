import { trimLeadingSilence } from '../daily-series'

const day = (date: string, sent = 0, opened = 0, clicked = 0) => ({ date, sent, opened, clicked })

/**
 * The chart starts where the campaign did.
 *
 * The window is ninety days because that is what an author may ask about, and the SQL fills every day in it
 * so a gap stays visible. For a campaign that started last week that meant eighty-nine days of flat line with
 * the whole story crushed against the right edge — a chart that reads as broken rather than as new.
 */
describe('trimLeadingSilence', () => {
  it('drops the silence before anything happened, keeping one day of run-up', () => {
    const points = [day('2026-09-01'), day('2026-09-02'), day('2026-09-03'), day('2026-09-04', 12, 8, 4)]
    expect(trimLeadingSilence(points).map((p) => p.date)).toEqual(['2026-09-03', '2026-09-04'])
  })

  it('keeps a gap that comes AFTER the first activity', () => {
    // Those empty days are data: they are the fortnight nobody was messaged, and hiding them would flatter
    // the campaign.
    const points = [day('2026-09-01', 5), day('2026-09-02'), day('2026-09-03'), day('2026-09-04', 3)]
    expect(trimLeadingSilence(points)).toHaveLength(4)
  })

  it('counts an open or a click as activity, not just a send', () => {
    // Opens arrive for days after the send; a window that starts at the first OPEN would cut the send off.
    expect(trimLeadingSilence([day('2026-09-01'), day('2026-09-02', 0, 1)]).map((p) => p.date))
      .toEqual(['2026-09-01', '2026-09-02'])
  })

  it('returns nothing when nothing ever happened', () => {
    // The screen hides the chart entirely rather than drawing a flat line at zero, which would read as a
    // campaign that failed rather than one that has not run.
    expect(trimLeadingSilence([day('2026-09-01'), day('2026-09-02')])).toEqual([])
  })

  it('survives an empty window', () => {
    expect(trimLeadingSilence([])).toEqual([])
  })
})
