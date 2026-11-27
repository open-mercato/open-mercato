'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { copy, type Copy, type UsagePair } from './types'

export const BAR = 'h-2 rounded-full bg-muted-foreground/40'
export const BAR_SOFT = 'h-2 rounded-full bg-muted-foreground/20'
export const SOLID = 'bg-muted-foreground/30'
export const SURFACE = 'bg-background shadow-xs'
export const FRAME = 'border border-border bg-card'
export const LABEL = 'text-xs leading-4 text-foreground'
export const LABEL_MUTED = 'text-xs leading-4 text-muted-foreground'

export const SAMPLE = {
  active: copy('design.usageVisuals.sample.active', 'Active'),
  askAi: copy('design.usageVisuals.sample.askAi', 'Ask AI'),
  billing: copy('design.usageVisuals.sample.billing', 'Billing address'),
  cancel: copy('design.usageVisuals.sample.cancel', 'Cancel'),
  count: copy('design.usageVisuals.sample.count', '128'),
  customer: copy('design.usageVisuals.sample.customer', 'Customer'),
  delete: copy('design.usageVisuals.sample.delete', 'Delete'),
  draftSaved: copy('design.usageVisuals.sample.draftSaved', 'Draft saved'),
  email: copy('design.usageVisuals.sample.email', 'Email'),
  failed: copy('design.usageVisuals.sample.failed', 'Failed'),
  meta: copy('design.usageVisuals.sample.meta', 'Due in 14 days'),
  orders: copy('design.usageVisuals.sample.orders', 'Orders'),
  paid: copy('design.usageVisuals.sample.paid', 'Paid'),
  save: copy('design.usageVisuals.sample.save', 'Save'),
  title: copy('design.usageVisuals.sample.title', 'Invoice 2041'),
  total: copy('design.usageVisuals.sample.total', 'Total'),
  wholesale: copy('design.usageVisuals.sample.wholesale', 'Wholesale'),
}

export function T({ c }: { c: Copy }) {
  const t = useT()
  return <>{t(c.key, c.fallback)}</>
}

export function Bar({ className = 'w-full', soft = false }: { className?: string; soft?: boolean }) {
  return <span className={`block shrink-0 ${soft ? BAR_SOFT : BAR} ${className}`} />
}

export function Divider() {
  return <span className="block h-px w-full shrink-0 bg-border" />
}

function PlaceholderInput({ placeholder }: { placeholder?: Copy }) {
  const t = useT()
  return <Input size="sm" readOnly tabIndex={-1} className="w-28" placeholder={placeholder ? t(placeholder.key, placeholder.fallback) : undefined} />
}

export function framesPair(avoidCaption: Copy, covers?: string[]): UsagePair {
  return {
    id: 'one-frame',
    title: copy('design.usageVisuals.shared.frames.title', 'One frame per level'),
    covers,
    do: {
      caption: copy('design.usageVisuals.shared.frames.do', 'One frame, groups split by a line'),
      specimen: (
        <div className={`flex w-28 flex-col gap-2 rounded-md p-2 ${FRAME}`}>
          <Bar className="w-12" />
          <Bar />
          <Divider />
          <Bar className="w-16" />
        </div>
      ),
    },
    avoid: {
      caption: avoidCaption,
      specimen: (
        <div className={`flex w-28 flex-col gap-1 rounded-md p-2 ${FRAME}`}>
          <div className={`flex flex-col gap-1 rounded-md p-2 ${FRAME}`}>
            <Bar className="w-12" />
          </div>
          <div className={`flex flex-col gap-1 rounded-md p-2 ${FRAME}`}>
            <Bar className="w-16" />
          </div>
        </div>
      ),
    },
  }
}

export function visibleLabelPair(covers?: string[]): UsagePair {
  return {
    id: 'visible-label',
    title: copy('design.usageVisuals.shared.visibleLabel.title', 'A label that stays visible'),
    covers,
    do: {
      caption: copy('design.usageVisuals.shared.visibleLabel.do', 'Label above the field'),
      specimen: (
        <div className="flex flex-col gap-2">
          <span className={LABEL}><T c={SAMPLE.email} /></span>
          <PlaceholderInput />
        </div>
      ),
    },
    avoid: {
      caption: copy('design.usageVisuals.shared.visibleLabel.avoid', 'Placeholder as the only label'),
      specimen: <PlaceholderInput placeholder={SAMPLE.email} />,
    },
  }
}

function FieldStack({ gapClass }: { gapClass: string }) {
  return (
    <div className={`flex w-28 flex-col ${gapClass}`}>
      <Bar className="w-10" />
      <span className="block h-7 w-full rounded-md border border-input bg-control" />
      <Bar className="w-20" soft />
    </div>
  )
}

export function fieldRolesPair(covers?: string[]): UsagePair {
  return {
    id: 'field-roles',
    title: copy('design.usageVisuals.shared.fieldRoles.title', 'Label, field and hint can breathe'),
    covers,
    do: {
      caption: copy('design.usageVisuals.shared.fieldRoles.do', '8 px from the field roles'),
      specimen: <FieldStack gapClass="gap-2" />,
    },
    avoid: {
      caption: copy('design.usageVisuals.shared.fieldRoles.avoid', 'Glued together with tiny gaps'),
      specimen: <FieldStack gapClass="gap-1" />,
    },
  }
}

export function pairedSurfacePair(covers?: string[]): UsagePair {
  const chip = 'flex h-9 w-24 items-center justify-center rounded-md bg-primary text-sm'
  return {
    id: 'paired-surface',
    title: copy('design.usageVisuals.shared.pairedSurface.title', 'Keep the pair together'),
    covers,
    do: {
      caption: copy('design.usageVisuals.shared.pairedSurface.do', 'Surface with its own text colour'),
      specimen: <span className={`${chip} text-primary-foreground`}><T c={SAMPLE.save} /></span>,
    },
    avoid: {
      caption: copy('design.usageVisuals.shared.pairedSurface.avoid', 'Text colour from another pair'),
      specimen: <span className={`${chip} text-foreground`}><T c={SAMPLE.save} /></span>,
    },
  }
}

function RhythmStack({ margins }: { margins: number[] | null }) {
  return (
    <div className={`flex w-28 flex-col ${margins ? '' : 'gap-2'}`}>
      {[0, 1, 2, 3].map((index) => (
        <span key={index} className={`block h-3 w-full rounded-sm ${SOLID}`} style={margins && index > 0 ? { marginTop: margins[index - 1] } : undefined} />
      ))}
    </div>
  )
}

export function evenRhythmPair(title: Copy, doCaption: Copy, avoidCaption: Copy, covers?: string[]): UsagePair {
  return {
    id: 'even-rhythm',
    title,
    covers,
    do: { caption: doCaption, specimen: <RhythmStack margins={null} /> },
    avoid: { caption: avoidCaption, specimen: <RhythmStack margins={[3, 15, 7]} /> },
  }
}
