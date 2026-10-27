import React from 'react'
import figma from '@figma/code-connect'
import { Button } from '../src/primitives/button'

type ButtonVariant = NonNullable<React.ComponentProps<typeof Button>['variant']>

// Axes verified from the actual variants; Figma currently reports errors on this set's property definitions.
// Text buttons only. Hover/focus come from the browser; icon-only and swapped-icon examples remain separate work.
figma.connect(Button, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=129-1422', {
  imports: ["import { Button } from '@open-mercato/ui/primitives/button'"],
  variant: { '🔳 Only Icon': 'Off' },
  props: {
    variant: figma.enum('🧩 Type', {
      Neutral: figma.enum<ButtonVariant>('🏵️ Style', { Filled: 'default', Stroke: 'outline', Lighter: 'secondary', Ghost: 'ghost' }),
      Error: figma.enum<ButtonVariant>('🏵️ Style', { Filled: 'destructive-solid', Stroke: 'destructive-outline', Lighter: 'destructive-soft', Ghost: 'destructive-ghost' }),
    }),
    size: figma.enum('📏 Size', {
      'Medium (40)': 'lg',
      'Small (36)': 'default',
      'X-Small (32)': 'sm',
      '2X-Small (28)': '2xs',
    }),
    disabled: figma.enum('📌 State', { Default: false, Disabled: true, Hover: false, Focus: false }),
    label: figma.string('✏️ Edit Text'),
  },
  example: ({ variant, size, disabled, label }) => (
    <Button type="button" variant={variant} size={size} disabled={disabled}>
      {label}
    </Button>
  ),
})
