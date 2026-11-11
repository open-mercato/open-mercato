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
 * Built here rather than in `@open-mercato/ui` because this module does not change core. The tapering is
 * a `clip-path` per band rather than an SVG, so the labels stay ordinary text — they translate, they wrap,
 * they inherit the design system's type scale, and a screen reader reads them in order.
 *
 * **Every word sits outside the shape**, in a column of its own. Text on top of the bands was the first
 * attempt and it failed at both ends: on a wide band the muted percentage went grey-on-orange, and on a
 * narrow one it fell off the shape entirely and floated in white space. A funnel is a picture whose whole
 * job is to be read at a glance, so nothing in it depends on the contrast of one colour against another.
 */
export function FunnelChart({ stages, shareLabel, dropLabel, peopleLabel }: FunnelChartProps) {
  const bands = React.useMemo(() => buildFunnelBands(stages), [stages])
  if (bands.length === 0) return null

  return (
    /* Bounded, and not because of taste: stretched to a desk monitor the taper flattens into an arrowhead
       and stops reading as a narrowing at all. */
    <div className="w-full max-w-3xl">
      {bands.map((band, at) => {
        const label = stages[at]?.label ?? band.key
        // Percent coordinates of the four corners: the top edge is this stage's width, the bottom edge is
        // the next stage's, and the band is centred, so each inset is half of what is left over.
        const topInset = (100 - band.topRatio * 100) / 2
        const bottomInset = (100 - band.bottomRatio * 100) / 2
        const clipPath = `polygon(${topInset}% 0%, ${100 - topInset}% 0%, ${100 - bottomInset}% 100%, ${bottomInset}% 100%)`

        return (
          <div key={band.key}>
            <div className="flex items-center gap-4" style={{ height: BAND_HEIGHT }}>
              <span className="w-44 shrink-0 text-right text-sm font-medium">{label}</span>
              <div className="relative h-full flex-1">
                <div
                  aria-hidden
                  className="absolute inset-0"
                  /* The token by name, in a style rather than an arbitrary Tailwind value: `--chart-1`
                     already carries its own dark-mode definition, so the band follows the theme with no
                     override. */
                  style={{ clipPath, backgroundColor: 'var(--chart-1)' }}
                />
              </div>
              <span className="flex w-28 shrink-0 items-baseline gap-2">
                <span className="text-sm font-medium tabular-nums">{peopleLabel(band.people)}</span>
                {band.shareOfFirst === null ? null : (
                  <span className="text-xs tabular-nums text-muted-foreground">{shareLabel(band.shareOfFirst)}</span>
                )}
              </span>
            </div>
            {/*
              The join carries the number people actually quote — "we lost half of them between sent and
              opened" — so it is written on the edge where that happens rather than only in the table.
              Nothing after the last band: there is no join below it. The empty side columns keep it
              centred under the funnel rather than under the row.
            */}
            {at < bands.length - 1 ? (
              <div className="flex items-center gap-4" style={{ height: JOIN_HEIGHT }}>
                <span className="w-44 shrink-0" />
                <span className="flex-1 text-center text-xs tabular-nums text-muted-foreground">
                  {bands[at + 1].fromPrevious === null ? null : dropLabel(bands[at + 1].fromPrevious as number)}
                </span>
                <span className="w-28 shrink-0" />
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
