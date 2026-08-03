import React from 'react'
import figma from '@figma/code-connect'
import { StatusBadge } from '../src/primitives/status-badge'

// TODO(figma): resolve the real node id in the DS file before ds:code-connect:publish.
figma.connect(StatusBadge, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/Design-System?node-id=0-1', {
  imports: ["import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'"],
  props: {
    variant: figma.enum('Variant', {
      Success: 'success',
      Warning: 'warning',
      Error: 'error',
      Info: 'info',
      Neutral: 'neutral',
    }),
    dot: figma.boolean('Dot'),
    label: figma.string('Label'),
  },
  example: ({ variant, dot, label }) => (
    <StatusBadge variant={variant} dot={dot}>
      {label}
    </StatusBadge>
  ),
})
