'use client'

/**
 * A compact two-button row for boolean settings in the studio property panels.
 * Replaces the slider-toggle Switch pattern: label on the left, mutually
 * exclusive Yes / No buttons on the right. Clicking either selects that value
 * and clears the other (always one is "pressed").
 */

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { cn } from '@open-mercato/shared/lib/utils'

export type YesNoRowProps = {
  value: boolean
  onChange: (next: boolean) => void
  label: React.ReactNode
  disabled?: boolean
  yesLabel?: string
  noLabel?: string
  /** Optional className on the outer row (helps callers tweak spacing). */
  className?: string
}

export function YesNoRow({
  value,
  onChange,
  label,
  disabled,
  yesLabel,
  noLabel,
  className,
}: YesNoRowProps) {
  const t = useT()
  const yes = yesLabel ?? t('forms.studio.yesNo.yes', 'Yes')
  const no = noLabel ?? t('forms.studio.yesNo.no', 'No')
  return (
    <div className={cn('flex items-center justify-between gap-2 text-xs', className)}>
      <span className="min-w-0 font-medium text-foreground">{label}</span>
      <div className="flex shrink-0 gap-1" role="group" aria-label={typeof label === 'string' ? label : undefined}>
        <Button
          type="button"
          variant={value ? 'default' : 'outline'}
          size="2xs"
          aria-pressed={value}
          disabled={disabled}
          onClick={() => onChange(true)}
        >
          {yes}
        </Button>
        <Button
          type="button"
          variant={!value ? 'default' : 'outline'}
          size="2xs"
          aria-pressed={!value}
          disabled={disabled}
          onClick={() => onChange(false)}
        >
          {no}
        </Button>
      </div>
    </div>
  )
}
