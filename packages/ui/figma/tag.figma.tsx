import React from 'react'
import figma from '@figma/code-connect'
import { Tag } from '../src/primitives/tag'

// TODO(figma): resolve the real node id in the DS file before ds:code-connect:publish.
figma.connect(Tag, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/Design-System?node-id=0-1', {
  imports: ["import { Tag } from '@open-mercato/ui/primitives/tag'"],
  props: {
    variant: figma.enum('Variant', {
      Default: 'default',
      Success: 'success',
      Warning: 'warning',
      Error: 'error',
      Info: 'info',
      Neutral: 'neutral',
      Brand: 'brand',
      Pink: 'pink',
    }),
    dot: figma.boolean('Dot'),
    label: figma.string('Label'),
  },
  example: ({ variant, dot, label }) => (
    <Tag variant={variant} dot={dot}>
      {label}
    </Tag>
  ),
})
