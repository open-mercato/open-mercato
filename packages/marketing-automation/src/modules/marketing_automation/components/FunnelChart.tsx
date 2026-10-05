'use client'
import * as React from 'react'
import { buildFunnelBands, type FunnelInput } from '../lib/analytics/funnel-geometry.js'

export type FunnelChartStage = FunnelInput & { label: string }

export type FunnelChartProps = {
  stages: FunnelChartStage[]
  /** Rendered under the count inside each band, e.g. "82% of everyone who entered". */
  shareLabel: (share: number) => string
  /** Rendered on the join between two bands, e.g. "66.7%". */
  dropLabel: (fromPrevious: number) => string
  peopleLabel: (people: number) => string
}

const BAND_HEIGHT = 44
const JOIN_HEIGHT = 20

/**
 * The funnel, drawn as a funnel.
 *
 * It used to be a horizontal bar chart, which is a ranking: five bars of decreasing length sorted by
 * length, where nothing shows that each bar is a SUBSET of the one above it. A taper says that in the
 * shape itself, before anybody reads a number.
 *
 * Built here rather than in `@open-mercato/ui` because this module does not change core. The shape is
 * `clip-path` rather than an SVG, so the labels stay ordinary text — they translate, they wrap, they
 * inherit the design system's type scale, and a screen reader reads them in order.
 *
 * **A stage is a block and the narrowing is a join between blocks**, which is the correction to the first
 * version. There, each band tapered across its whole height and the gap underneath it was empty, so the
 * drawing was a row of disconnected wedges: a campaign where everybody dropped out after entering painted
 * the first stage as a full-width arrowhead stabbing down to a point, and the four empty stages below it
 * as floating tick marks with no visible relationship to it. Each stage now holds its own width for its
 * whole height, and all the narrowing happens in the join, so the outline is continuous from top to bottom
 * and a collapse reads as a collapse rather than as a rendering fault.
 *
 * **Every word sits outside the shape**, in a column of its own. Text on top of the bands was the first
 * attempt and it failed at both ends: on a wide band the muted percentage went grey-on-orange, and on a
 * narrow one it fell off the shape entirely and floated in white space. A funnel is a picture whose whole
 * job is to be read at a glance, so nothing in it depends on the contrast of one colour against another.
 */
export function FunnelChart({ stages, shareLabel, dropLabel, peopleLabel }: FunnelChartProps) {
  const bands = React.useMemo(() => buildFunnelBands(stages), [stages])
  if (bands.length === 0) return null

  // Percent coordinates of a band's edges: the shape is centred, so each inset is half of what is left over.
  const insetFor = (ratio: number): number => (100 - ratio * 100) / 2

  /**
   * The rows below the point, where the funnel has already closed.
   *
   * Nothing is drawn in them, so a 1px line in the BORDER colour keeps the stage rows visually attached to
   * the chart above. It is deliberately not the chart colour: it carries no quantity, and anything in
   * `--chart-1` would be read as one.
   */
  const guide = (
    <div aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
  )

  return (
    /* Bounded, and not because of taste: stretched to a desk monitor the taper flattens into an arrowhead
       and stops reading as a narrowing at all. */
    <div className="w-full max-w-3xl">
      {bands.map((band, at) => {
        const label = stages[at]?.label ?? band.key
        const stageInset = insetFor(band.topRatio)
        const nextInset = insetFor(band.bottomRatio)

        return (
          <div key={band.key}>
            <div className="flex items-center gap-4" style={{ height: BAND_HEIGHT }}>
              <span className="w-44 shrink-0 text-right text-sm font-medium">{label}</span>
              <div className="relative h-full flex-1">
                {band.topRatio === 0 ? guide : (
                  <div
                    aria-hidden
                    className="absolute inset-0"
                    /* The token by name, in a style rather than an arbitrary Tailwind value: `--chart-1`
                       already carries its own dark-mode definition, so the band follows the theme with no
                       override. */
                    style={{
                      clipPath: `polygon(${stageInset}% 0%, ${100 - stageInset}% 0%, ${100 - stageInset}% 100%, ${stageInset}% 100%)`,
                      backgroundColor: 'var(--chart-1)',
                    }}
                  />
                )}
              </div>
              <span className="flex w-28 shrink-0 items-baseline gap-2">
                <span className="text-sm font-medium tabular-nums">{peopleLabel(band.people)}</span>
                {band.shareOfFirst === null ? null : (
                  <span className="text-xs tabular-nums text-muted-foreground">{shareLabel(band.shareOfFirst)}</span>
                )}
              </span>
            </div>
            {/*
              The join does two jobs: it is the piece of shape that narrows, and it carries the number people
              actually quote — "we lost half of them between sent and opened". The number sits in the label
              column beside it rather than across the middle, because the middle is now drawn on: a
              percentage centred there would be printed over the taper it describes.
              Nothing after the last band: there is no join below it.
            */}
            {at < bands.length - 1 ? (
              <div className="flex items-center gap-4" style={{ height: JOIN_HEIGHT }}>
                <span className="w-44 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {bands[at + 1].fromPrevious === null ? null : dropLabel(bands[at + 1].fromPrevious as number)}
                </span>
                <div className="relative h-full flex-1">
                  {band.topRatio === 0 && band.bottomRatio === 0 ? guide : (
                    <div
                      aria-hidden
                      className="absolute inset-0"
                      style={{
                        clipPath: `polygon(${stageInset}% 0%, ${100 - stageInset}% 0%, ${100 - nextInset}% 100%, ${nextInset}% 100%)`,
                        backgroundColor: 'var(--chart-1)',
                      }}
                    />
                  )}
                </div>
                <span className="w-28 shrink-0" />
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
