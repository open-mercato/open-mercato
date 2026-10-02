/**
 * The shape of a funnel, computed separately from the drawing of it.
 *
 * A funnel is a picture of one number shrinking, and the only interesting part is what happens at the
 * edges: a stage nobody reached, a campaign where everybody made it all the way, a stage that somehow
 * counts more people than the one before it. Those are the cases a chart gets visibly wrong, so they are
 * decided here where a test can ask about them without a browser.
 */

export type FunnelInput = {
  key: string
  people: number
}

export type FunnelBand = {
  key: string
  people: number
  /** Width of the band where it starts, as a fraction of the widest stage. */
  topRatio: number
  /** Width where it ends, which is the next stage's width — that join is what makes it taper. */
  bottomRatio: number
  /** Of the stage before it. Null for the first, which has nothing to be a share of. */
  fromPrevious: number | null
  /** Of everyone who entered. Null when nobody did. */
  shareOfFirst: number | null
}

/**
 * A stage nobody reached still gets a sliver.
 *
 * At a true zero the band collapses to a line, the taper above it turns into a spike, and the stage looks
 * absent rather than empty — which is a different and wrong answer. The sliver is deliberately too narrow
 * to misread as a quantity.
 */
const EMPTY_BAND_RATIO = 0.02

export function buildFunnelBands(stages: FunnelInput[]): FunnelBand[] {
  if (stages.length === 0) return []

  /**
   * Scaled against the WIDEST stage, not against the first.
   *
   * They are normally the same, because a funnel narrows. They are not the same when a later stage counts
   * more people — which happens for real: "ordered afterwards" can exceed "clicked" when somebody buys
   * without clicking the message. Scaling against the first would then draw a band wider than the chart.
   */
  const widest = Math.max(...stages.map((stage) => Math.max(stage.people, 0)))
  const entered = Math.max(stages[0].people, 0)

  const ratioFor = (people: number): number => {
    if (widest <= 0) return EMPTY_BAND_RATIO
    const exact = Math.max(people, 0) / widest
    return exact <= 0 ? EMPTY_BAND_RATIO : Math.max(exact, EMPTY_BAND_RATIO)
  }

  return stages.map((stage, at) => {
    const previous = at > 0 ? Math.max(stages[at - 1].people, 0) : null
    const next = stages[at + 1]
    return {
      key: stage.key,
      people: Math.max(stage.people, 0),
      topRatio: ratioFor(stage.people),
      // The last band does not taper: there is nothing below it to taper towards, and inventing a point
      // would draw a conversion that was never measured.
      bottomRatio: next ? ratioFor(next.people) : ratioFor(stage.people),
      // Null rather than zero when the previous stage was empty: nobody converted from nobody, and 0%
      // would claim everyone dropped out.
      fromPrevious: previous === null ? null : previous === 0 ? null : Math.max(stage.people, 0) / previous,
      shareOfFirst: entered === 0 ? null : Math.max(stage.people, 0) / entered,
    }
  })
}
