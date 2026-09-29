import React from 'react'
import figma from '@figma/code-connect'
import { StatusBadge } from '../src/primitives/status-badge'

figma.connect(StatusBadge, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=171-5100', {
  imports: ["import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'"],
  props: {
    appearance: figma.enum('🏵️ Style', { Light: 'light', Stroke: 'stroke' }),
    variant: figma.enum('✨ Status', {
      '❇️ Completed': 'success',
      '✴️ Pending': 'warning',
      '🆘 Failed': 'error',
      '🚹 Information': 'info',
      '⚪️ Disabled': 'neutral',
    }),
    dot: figma.enum('• With Dot', { Off: false, On: true }),
    label: figma.string('✏️ Edit Badge'),
  },
  example: ({ appearance, variant, dot, label }) => (
    <StatusBadge appearance={appearance} variant={variant} dot={dot}>
      {label}
    </StatusBadge>
  ),
})
