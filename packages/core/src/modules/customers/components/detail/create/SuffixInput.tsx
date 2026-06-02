"use client"

import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'

export type SuffixInputProps = React.ComponentPropsWithoutRef<typeof Input> & { suffix: string }

export const SuffixInput = React.forwardRef<HTMLInputElement, SuffixInputProps>(
  ({ suffix, ...props }, ref) => {
    return (
      <Input
        ref={ref}
        rightIcon={<span className="text-sm font-medium text-muted-foreground">{suffix}</span>}
        {...props}
      />
    )
  }
)

SuffixInput.displayName = 'SuffixInput'
