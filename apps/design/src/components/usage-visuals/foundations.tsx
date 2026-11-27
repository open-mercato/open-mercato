'use client'

import * as React from 'react'
import { Bell, Check, CircleCheck, Search, Sparkles, Star } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Bar, LABEL_MUTED, SAMPLE, SOLID, SURFACE, T, evenRhythmPair, fieldRolesPair, framesPair, pairedSurfacePair } from './specimens'
import { copy, type UsagePairGroup } from './types'

const CHIP = 'inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs'
const VIOLET_TINT = 'border border-brand-violet/30 bg-brand-violet/10 text-brand-violet'

function SelectedRow({ tone }: { tone: 'accent' | 'violet' }) {
  const surface = tone === 'accent' ? 'border-accent-indigo bg-accent-indigo/5' : 'border-brand-violet bg-brand-violet/10'
  const mark = tone === 'accent' ? 'text-accent-indigo' : 'text-brand-violet'
  return (
    <div className={`flex w-28 items-center gap-2 rounded-md border p-2 ${surface}`}>
      <Check className={`size-4 shrink-0 ${mark}`} />
      <Bar className="w-16" />
    </div>
  )
}

function SeriesBars({ first, second }: { first: string; second: string }) {
  const heights = ['h-6', 'h-10', 'h-8', 'h-12', 'h-10', 'h-14']
  return (
    <div className="flex h-14 items-end gap-1">
      {heights.map((height, index) => (
        <span key={index} className={`block w-3 rounded-sm ${height} ${index % 2 === 0 ? first : second} ${index % 2 === 1 ? 'mr-2' : ''}`} />
      ))}
    </div>
  )
}

function StatusChip({ textClass, dotClass }: { textClass: string; dotClass?: string }) {
  return (
    <span className={`${CHIP} bg-status-success-bg ${textClass}`}>
      {dotClass ? <span className={`block size-2 rounded-full ${dotClass}`} /> : null}
      <T c={SAMPLE.paid} />
    </span>
  )
}

function PageTitle({ display }: { display: boolean }) {
  return (
    <div className="flex w-28 flex-col gap-2 overflow-hidden">
      <span className={display ? 'text-foreground' : 'text-2xl leading-8 text-foreground'} style={display ? { fontSize: 36, lineHeight: '40px' } : undefined}>
        <T c={SAMPLE.orders} />
      </span>
      <Bar />
      <Bar className="w-20" />
    </div>
  )
}

export const FOUNDATION_PAIRS: UsagePairGroup = {
  'brand-colors': [
    {
      id: 'status-not-brand',
      title: copy('design.usageVisuals.brandColors.status.title', 'Status is not a brand moment'),
      covers: ['Do not substitute brand colors for semantic status tokens.'],
      do: {
        caption: copy('design.usageVisuals.brandColors.status.do', 'Status tokens say it is paid'),
        specimen: <StatusBadge variant="success" dot><T c={SAMPLE.paid} /></StatusBadge>,
      },
      avoid: {
        caption: copy('design.usageVisuals.brandColors.status.avoid', 'Violet says nothing about state'),
        specimen: <span className={`${CHIP} ${VIOLET_TINT}`}><T c={SAMPLE.paid} /></span>,
      },
    },
    {
      id: 'violet-for-ai',
      title: copy('design.usageVisuals.brandColors.ai.title', 'Violet marks AI'),
      do: {
        caption: copy('design.usageVisuals.brandColors.ai.do', 'Soft violet tint on an AI action'),
        specimen: <span className={`${CHIP} ${VIOLET_TINT}`}><Sparkles className="size-3" /><T c={SAMPLE.askAi} /></span>,
      },
      avoid: {
        caption: copy('design.usageVisuals.brandColors.ai.avoid', 'Violet on an ordinary button'),
        specimen: <span className="inline-flex h-8 items-center rounded-md bg-brand-violet px-3 text-sm text-brand-violet-foreground"><T c={SAMPLE.save} /></span>,
      },
    },
    {
      id: 'selection-accent',
      title: copy('design.usageVisuals.brandColors.selection.title', 'Selection uses the accent'),
      do: {
        caption: copy('design.usageVisuals.brandColors.selection.do', 'Selected row in the accent'),
        specimen: <SelectedRow tone="accent" />,
      },
      avoid: {
        caption: copy('design.usageVisuals.brandColors.selection.avoid', 'Violet is reserved for AI'),
        specimen: <SelectedRow tone="violet" />,
      },
    },
  ],
  'color-roles': [
    pairedSurfacePair([
      'A role is a surface paired with its content color — always use them together, never mix pairs.',
      'Never put foreground on a surface from a different pair — contrast is only tested within a pair.',
    ]),
    {
      id: 'content-needs-surface',
      title: copy('design.usageVisuals.colorRoles.standalone.title', 'Content colours need their surface'),
      covers: ['Never use a -foreground token as a standalone accent color.'],
      do: {
        caption: copy('design.usageVisuals.colorRoles.standalone.do', 'Text in the foreground role'),
        specimen: (
          <div className={`flex w-24 flex-col gap-2 rounded-md p-2 ${SURFACE}`}>
            <span className="text-sm leading-5 text-foreground"><T c={SAMPLE.total} /></span>
            <Bar />
          </div>
        ),
      },
      avoid: {
        caption: copy('design.usageVisuals.colorRoles.standalone.avoid', 'A content colour used alone'),
        specimen: (
          <div className={`flex w-24 flex-col gap-2 rounded-md p-2 ${SURFACE}`}>
            <span className="text-sm leading-5 text-primary-foreground"><T c={SAMPLE.total} /></span>
            <Bar />
          </div>
        ),
      },
    },
  ],
  'color-tokens': [
    pairedSurfacePair(['Pair every surface with its -foreground counterpart.']),
    {
      id: 'token-borders',
      title: copy('design.usageVisuals.colorTokens.borders.title', 'Borders come from tokens'),
      covers: ['Never border-gray-* or any raw palette shade.'],
      do: {
        caption: copy('design.usageVisuals.colorTokens.borders.do', 'Token border follows the theme'),
        specimen: <span className="block h-12 w-24 rounded-md border border-border bg-card" />,
      },
      avoid: {
        caption: copy('design.usageVisuals.colorTokens.borders.avoid', 'A raw grey stays the same'),
        specimen: <span className="block h-12 w-24 rounded-md border bg-card" style={{ borderColor: '#6b7280' }} />,
      },
    },
  ],
  'state-tokens': [
    {
      id: 'same-family',
      title: copy('design.usageVisuals.stateTokens.family.title', 'Background and text from one family'),
      covers: ['Pair -bg with -text of the same family — the shades are contrast-tested together.'],
      do: {
        caption: copy('design.usageVisuals.stateTokens.family.do', 'Success text on success'),
        specimen: <StatusChip textClass="text-status-success-text" />,
      },
      avoid: {
        caption: copy('design.usageVisuals.stateTokens.family.avoid', 'Info text on success'),
        specimen: <StatusChip textClass="text-status-info-text" />,
      },
    },
    {
      id: 'dot-shade',
      title: copy('design.usageVisuals.stateTokens.dot.title', 'Dots use the icon shade'),
      do: {
        caption: copy('design.usageVisuals.stateTokens.dot.do', 'Dot in the icon shade'),
        specimen: <StatusChip textClass="text-status-success-text" dotClass="bg-status-success-icon" />,
      },
      avoid: {
        caption: copy('design.usageVisuals.stateTokens.dot.avoid', 'Dot in the border shade fades'),
        specimen: <StatusChip textClass="text-status-success-text" dotClass="bg-status-success-border" />,
      },
    },
  ],
  'chart-palette': [
    {
      id: 'chart-series',
      title: copy('design.usageVisuals.chartPalette.series.title', 'Series use the chart palette'),
      do: {
        caption: copy('design.usageVisuals.chartPalette.series.do', 'Two series in chart colours'),
        specimen: <SeriesBars first="bg-chart-blue" second="bg-chart-emerald" />,
      },
      avoid: {
        caption: copy('design.usageVisuals.chartPalette.series.avoid', 'Status colours imply a verdict'),
        specimen: <SeriesBars first="bg-status-success-icon" second="bg-status-error-icon" />,
      },
    },
  ],
  'corner-radius': [
    {
      id: 'control-radius',
      title: copy('design.usageVisuals.cornerRadius.chips.title', 'Filter chips keep the control radius'),
      covers: ['No full-pill radii on filter chips or custom controls outside the reserved primitives.'],
      do: {
        caption: copy('design.usageVisuals.cornerRadius.chips.do', 'Chips share the control radius'),
        specimen: (
          <div className="flex items-center gap-2">
            <span className={`block h-7 w-12 rounded-md ${SOLID}`} />
            <span className={`block h-7 w-12 rounded-md ${SOLID}`} />
          </div>
        ),
      },
      avoid: {
        caption: copy('design.usageVisuals.cornerRadius.chips.avoid', 'A pill among square chips'),
        specimen: (
          <div className="flex items-center gap-2">
            <span className={`block h-7 w-12 rounded-full ${SOLID}`} />
            <span className={`block h-7 w-12 rounded-md ${SOLID}`} />
          </div>
        ),
      },
    },
    {
      id: 'scale-radius',
      title: copy('design.usageVisuals.cornerRadius.scale.title', 'Radius from the scale'),
      covers: ['No arbitrary values (rounded-[24px]) — pick from the scale.'],
      do: {
        caption: copy('design.usageVisuals.cornerRadius.scale.do', 'A panel at 10 px from the scale'),
        specimen: <span className={`block h-14 w-24 rounded-lg ${SOLID}`} />,
      },
      avoid: {
        caption: copy('design.usageVisuals.cornerRadius.scale.avoid', 'An arbitrary 24 px radius'),
        specimen: <span className={`block h-14 w-24 ${SOLID}`} style={{ borderRadius: 24 }} />,
      },
    },
  ],
  'icon-registry': [
    {
      id: 'icon-size',
      title: copy('design.usageVisuals.icons.size.title', 'Icon sized to its control'),
      do: {
        caption: copy('design.usageVisuals.icons.size.do', '16 px icon in a button'),
        specimen: <Button type="button" size="sm" variant="outline" tabIndex={-1}><Bell className="size-4" /><T c={SAMPLE.orders} /></Button>,
      },
      avoid: {
        caption: copy('design.usageVisuals.icons.size.avoid', 'An icon larger than its label'),
        specimen: <Button type="button" size="sm" variant="outline" tabIndex={-1}><Bell className="size-4" style={{ width: 26, height: 26 }} /><T c={SAMPLE.orders} /></Button>,
      },
    },
    {
      id: 'status-with-label',
      title: copy('design.usageVisuals.icons.status.title', 'Status needs a label'),
      covers: ['Never convey status by icon color alone; pair with text or a label.'],
      do: {
        caption: copy('design.usageVisuals.icons.status.do', 'Icon and label together'),
        specimen: (
          <span className="flex items-center gap-2 text-sm text-foreground">
            <CircleCheck className="size-4 text-status-success-icon" />
            <T c={SAMPLE.paid} />
          </span>
        ),
      },
      avoid: {
        caption: copy('design.usageVisuals.icons.status.avoid', 'Colour alone carries the status'),
        specimen: <CircleCheck className="size-4 text-status-success-icon" />,
      },
    },
    {
      id: 'one-stroke',
      title: copy('design.usageVisuals.icons.stroke.title', 'One stroke width'),
      do: {
        caption: copy('design.usageVisuals.icons.stroke.do', 'Default 2 px stroke everywhere'),
        specimen: (
          <span className="flex items-center gap-3 text-foreground">
            <Bell className="size-6" />
            <Star className="size-6" />
            <Search className="size-6" />
          </span>
        ),
      },
      avoid: {
        caption: copy('design.usageVisuals.icons.stroke.avoid', 'Stroke changed per icon'),
        specimen: (
          <span className="flex items-center gap-3 text-foreground">
            <Bell className="size-6" strokeWidth={1} />
            <Star className="size-6" strokeWidth={3} />
            <Search className="size-6" />
          </span>
        ),
      },
    },
  ],
  shadows: [
    {
      id: 'control-elevation',
      title: copy('design.usageVisuals.shadows.elevation.title', 'Elevation matches the layer'),
      do: {
        caption: copy('design.usageVisuals.shadows.elevation.do', 'A control on the smallest shadow'),
        specimen: <span className="block h-8 w-24 rounded-md bg-background shadow-xs" />,
      },
      avoid: {
        caption: copy('design.usageVisuals.shadows.elevation.avoid', 'A control floating like a dialog'),
        specimen: <span className="block h-8 w-24 rounded-md bg-background shadow-xl" />,
      },
    },
    {
      id: 'no-glow',
      title: copy('design.usageVisuals.shadows.glow.title', 'No coloured glows'),
      covers: ['Do not draw custom colored glows or arbitrary box shadows.'],
      do: {
        caption: copy('design.usageVisuals.shadows.glow.do', 'Neutral shadow from the scale'),
        specimen: <span className="block h-12 w-20 rounded-lg bg-background shadow-sm" />,
      },
      avoid: {
        caption: copy('design.usageVisuals.shadows.glow.avoid', 'A coloured glow around a card'),
        specimen: <span className="block h-12 w-20 rounded-lg bg-background" style={{ boxShadow: '0 0 16px 2px var(--accent-indigo)' }} />,
      },
    },
    {
      id: 'focus-visible',
      title: copy('design.usageVisuals.shadows.focus.title', 'Focus stays visible'),
      covers: ['Do not remove focus feedback without an equivalent visible indicator.'],
      do: {
        caption: copy('design.usageVisuals.shadows.focus.do', 'Focus shows a halo'),
        specimen: <Button type="button" size="sm" variant="outline" tabIndex={-1} className="shadow-focus"><T c={SAMPLE.save} /></Button>,
      },
      avoid: {
        caption: copy('design.usageVisuals.shadows.focus.avoid', 'Focused, yet nothing shows it'),
        specimen: <Button type="button" size="sm" variant="outline" tabIndex={-1}><T c={SAMPLE.save} /></Button>,
      },
    },
  ],
  spacing: [
    evenRhythmPair(
      copy('design.usageVisuals.spacing.rhythm.title', 'One step between related items'),
      copy('design.usageVisuals.spacing.rhythm.do', 'Equal gaps from the 4 px scale'),
      copy('design.usageVisuals.spacing.rhythm.avoid', 'Gaps picked by eye'),
    ),
    fieldRolesPair(['Do not glue a label, field and hint together with gap-1; the field roles keep them readable.']),
    framesPair(copy('design.usageVisuals.spacing.frames.avoid', 'Nested frames pay padding twice')),
  ],
  typography: [
    {
      id: 'size-not-weight',
      title: copy('design.usageVisuals.typography.size.title', 'Hierarchy by size'),
      do: {
        caption: copy('design.usageVisuals.typography.size.do', 'Larger title, regular weight'),
        specimen: (
          <div className="flex w-28 flex-col gap-1">
            <span className="text-lg leading-6 text-foreground"><T c={SAMPLE.title} /></span>
            <span className={LABEL_MUTED}><T c={SAMPLE.meta} /></span>
          </div>
        ),
      },
      avoid: {
        caption: copy('design.usageVisuals.typography.size.avoid', 'One size, weight does the work'),
        specimen: (
          <div className="flex w-28 flex-col gap-1">
            <span className="text-sm leading-5 text-foreground" style={{ fontWeight: 700 }}><T c={SAMPLE.title} /></span>
            <span className="text-sm leading-5 text-foreground" style={{ fontWeight: 600 }}><T c={SAMPLE.meta} /></span>
          </div>
        ),
      },
    },
    {
      id: 'sentence-case',
      title: copy('design.usageVisuals.typography.case.title', 'Sentence case labels'),
      do: {
        caption: copy('design.usageVisuals.typography.case.do', 'Label in sentence case'),
        specimen: (
          <div className="flex w-28 flex-col gap-2">
            <span className={LABEL_MUTED}><T c={SAMPLE.billing} /></span>
            <Bar />
            <Bar className="w-16" />
          </div>
        ),
      },
      avoid: {
        caption: copy('design.usageVisuals.typography.case.avoid', 'Uppercase with wide tracking'),
        specimen: (
          <div className="flex w-28 flex-col gap-2">
            <span className="whitespace-nowrap text-muted-foreground" style={{ fontSize: 10, lineHeight: '16px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              <T c={SAMPLE.billing} />
            </span>
            <Bar />
            <Bar className="w-16" />
          </div>
        ),
      },
    },
    {
      id: 'no-display-sizes',
      title: copy('design.usageVisuals.typography.display.title', 'Page titles stop at 24 px'),
      covers: ['Do not copy marketing display sizes into dense backend pages.'],
      do: {
        caption: copy('design.usageVisuals.typography.display.do', 'Title sized for a dense page'),
        specimen: <PageTitle display={false} />,
      },
      avoid: {
        caption: copy('design.usageVisuals.typography.display.avoid', 'A marketing size crowds it'),
        specimen: <PageTitle display />,
      },
    },
  ],
}
