import React from 'react'
import figma from '@figma/code-connect'
import { Alert, AlertDescription, AlertTitle } from '../src/primitives/alert'

figma.connect(Alert, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/Design-System?node-id=169-2358', {
  imports: ["import { Alert, AlertTitle, AlertDescription } from '@open-mercato/ui/primitives/alert'"],
  props: {
    status: figma.enum('Status', {
      Error: 'error',
      Warning: 'warning',
      Success: 'success',
      Information: 'information',
      Feature: 'feature',
    }),
    style: figma.enum('Style', {
      Filled: 'filled',
      Light: 'light',
      Lighter: 'lighter',
      Stroke: 'stroke',
    }),
    size: figma.enum('Size', {
      XS: 'xs',
      Small: 'sm',
      Default: 'default',
    }),
    title: figma.string('Title'),
    description: figma.string('Description'),
  },
  example: ({ status, style, size, title, description }) => (
    <Alert status={status} style={style} size={size}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  ),
})
