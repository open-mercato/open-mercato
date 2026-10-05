"use client"

import * as React from 'react'
import { HelpCircle } from 'lucide-react'
import { IconButton } from '../primitives/icon-button'
import { TooltipCard } from '../primitives/tooltip'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

export type HelpTipProps = {
  /** Card heading — usually the section or field name. Already translated. */
  title: string
  /** Two or three sentences. Already translated. */
  body: React.ReactNode
  /** `xs` sits beside a field label without lifting the row; `sm` suits a section heading. */
  size?: 'xs' | 'sm'
  className?: string
}

/**
 * The "?" that explains one piece of the system to somebody meeting it for the first time.
 *
 * Opens on CLICK rather than hover, which is why it wraps `TooltipCard` (a Popover underneath)
 * rather than `SimpleTooltip`. Radix only opens a hover tooltip on long-press, so a hover affordance
 * would be close to undiscoverable on a tablet — and this is help text, read by the people least
 * likely to guess at an interaction. The popover also gives the keyboard a way in and `Escape` a way
 * out, and holds a few sentences without the cramping a tooltip surface implies.
 *
 * The icon is imported from `lucide-react` directly, NOT named as an `icon:` / `icon=` string. Those
 * two forms are what the repo-wide scan behind `lucideRegistry.generated.tsx` collects, so naming it
 * would make `yarn ui:icons:check` demand a regenerated file in `packages/ui` for every caller.
 */
export function HelpTip({ title, body, size = 'xs', className }: HelpTipProps) {
  const t = useT()
  return (
    <TooltipCard
      title={title}
      // `whitespace-pre-line` so a help text can use a blank line between paragraphs: without it the newline
      // collapses to a space and a two-part explanation arrives as one wall.
      description={<span className="block whitespace-pre-line">{body}</span>}
      leading={<HelpCircle aria-hidden="true" className="size-4 text-muted-foreground" />}
    >
      <IconButton
        type="button"
        variant="ghost"
        size={size}
        fullRadius
        aria-label={t('ui.helpTip.ariaLabel', 'What is this?')}
        className={cn('text-muted-foreground', className)}
      >
        <HelpCircle className={size === 'xs' ? 'size-3.5' : 'size-4'} />
      </IconButton>
    </TooltipCard>
  )
}
