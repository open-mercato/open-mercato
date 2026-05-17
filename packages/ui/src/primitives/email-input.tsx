"use client"

import * as React from 'react'
import { Mail } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input, type InputProps } from './input'

export type EmailInputProps = Omit<InputProps, 'leftIcon' | 'type'> & {
  /** Show the leading Mail icon. Defaults to `true` per Figma `Text Input [1.1]` Email variant. */
  showIcon?: boolean
}

/**
 * Email input matching Figma `Text Input [1.1]` (node `266:5251`) **Email** variant — a thin
 * `Input` wrapper that hardcodes `type="email"`, `inputMode="email"`, `autoComplete="email"`,
 * and renders a leading `Mail` icon by default. Placeholder defaults to an auto-translated
 * `ui.inputs.emailInput.placeholder`.
 */
export const EmailInput = React.forwardRef<HTMLInputElement, EmailInputProps>(
  ({ showIcon = true, placeholder, ...props }, ref) => {
    const t = useT()
    const resolvedPlaceholder = placeholder ?? t('ui.inputs.emailInput.placeholder', 'name@example.com')
    return (
      <Input
        ref={ref}
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder={resolvedPlaceholder}
        leftIcon={showIcon ? <Mail aria-hidden="true" /> : undefined}
        {...props}
      />
    )
  },
)
EmailInput.displayName = 'EmailInput'
