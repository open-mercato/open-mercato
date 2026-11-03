"use client"

import * as React from 'react'
import { CircleCheck, CircleX } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type PasswordStrengthState = 'empty' | 'weak' | 'moderate' | 'strong'

export type PasswordRequirement = {
  id: string
  label: React.ReactNode
  met: boolean
}

export type PasswordStrengthProps = React.HTMLAttributes<HTMLDivElement> & {
  strength: PasswordStrengthState
  requirements: readonly PasswordRequirement[]
  requirementsLabel?: React.ReactNode
}

const strengthLevel = { empty: 0, weak: 1, moderate: 2, strong: 3 } as const
const segmentColors = ['bg-status-error-icon', 'bg-status-warning-icon', 'bg-status-success-icon'] as const

export const PasswordStrength = React.forwardRef<HTMLDivElement, PasswordStrengthProps>(
  ({ className, strength, requirements, requirementsLabel, 'aria-label': ariaLabel, ...props }, ref) => {
    const t = useT()
    const labels = {
      empty: t('ui.passwordStrength.empty', 'Empty'),
      weak: t('ui.passwordStrength.weak', 'Weak'),
      moderate: t('ui.passwordStrength.moderate', 'Moderate'),
      strong: t('ui.passwordStrength.strong', 'Strong'),
    }
    const level = strengthLevel[strength]
    return (
      <div ref={ref} data-slot="password-strength" data-strength={strength} className={cn('flex w-75 max-w-full flex-col gap-2 pt-1.5 text-xs leading-4 text-muted-foreground', className)} {...props}>
        <div
          role="progressbar"
          aria-label={ariaLabel ?? t('ui.passwordStrength.label', 'Password strength')}
          aria-valuemin={0}
          aria-valuemax={3}
          aria-valuenow={level}
          aria-valuetext={labels[strength]}
          className="flex w-full gap-2"
        >
          {segmentColors.map((color, index) => (
            <span key={color} aria-hidden="true" className={cn('h-1 min-w-0 flex-1 rounded-xs', index < level ? color : 'bg-border')} />
          ))}
        </div>
        <p>{requirementsLabel ?? t('ui.passwordStrength.requirements', 'Must contain at least:')}</p>
        <ul className="flex w-full flex-col gap-2">
          {requirements.map(requirement => {
            const Glyph = requirement.met || strength === 'empty' ? CircleCheck : CircleX
            return (
              <li key={requirement.id} data-met={requirement.met} className="flex items-center gap-1">
                <Glyph aria-hidden="true" className={cn('size-4 shrink-0 text-background', requirement.met ? 'fill-status-success-icon' : 'fill-muted-foreground')} />
                <span className="sr-only">{requirement.met ? t('ui.passwordStrength.met', 'Requirement met') : t('ui.passwordStrength.unmet', 'Requirement not met')}: </span>
                <span>{requirement.label}</span>
              </li>
            )
          })}
        </ul>
      </div>
    )
  },
)
PasswordStrength.displayName = 'PasswordStrength'
