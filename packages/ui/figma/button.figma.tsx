import React from 'react'
import figma from '@figma/code-connect'
import { Button } from '../src/primitives/button'

// TODO(figma): resolve the real node id in the DS file before ds:code-connect:publish.
figma.connect(Button, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/Design-System?node-id=0-1', {
  imports: ["import { Button } from '@open-mercato/ui/primitives/button'"],
  props: {
    variant: figma.enum('Variant', {
      Primary: 'default',
      Destructive: 'destructive',
      Outline: 'outline',
      Secondary: 'secondary',
      Ghost: 'ghost',
      Muted: 'muted',
      Link: 'link',
    }),
    size: figma.enum('Size', {
      Default: 'default',
      Small: 'sm',
      Large: 'lg',
      '2XS': '2xs',
      Icon: 'icon',
    }),
    disabled: figma.boolean('Disabled'),
    label: figma.string('Label'),
  },
  example: ({ variant, size, disabled, label }) => (
    <Button variant={variant} size={size} disabled={disabled}>
      {label}
    </Button>
  ),
})
