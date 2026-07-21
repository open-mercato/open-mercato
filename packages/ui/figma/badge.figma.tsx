import React from 'react'
import figma from '@figma/code-connect'
import { Badge } from '../src/primitives/badge'

// TODO(figma): resolve the real node id in the DS file before ds:code-connect:publish.
figma.connect(Badge, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/Design-System?node-id=0-1', {
  imports: ["import { Badge } from '@open-mercato/ui/primitives/badge'"],
  props: {
    variant: figma.enum('Variant', {
      Default: 'default',
      Secondary: 'secondary',
      Outline: 'outline',
      Muted: 'muted',
      Success: 'success',
      Warning: 'warning',
      Info: 'info',
      Neutral: 'neutral',
      Error: 'error',
      Brand: 'brand',
    }),
    size: figma.enum('Size', {
      Small: 'sm',
      Default: 'default',
      Large: 'lg',
    }),
    label: figma.string('Label'),
  },
  example: ({ variant, size, label }) => (
    <Badge variant={variant} size={size}>
      {label}
    </Badge>
  ),
})
