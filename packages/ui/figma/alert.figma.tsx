import React from 'react'
import figma from '@figma/code-connect'
import { Alert, AlertDescription, AlertTitle } from '../src/primitives/alert'

// The former URL was the page, not the component set. Dismiss handlers and link destinations are application behavior.
figma.connect(Alert, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=169-2399', {
  imports: ["import { Alert, AlertTitle, AlertDescription } from '@open-mercato/ui/primitives/alert'"],
  props: {
    status: figma.enum('✨ Status', {
      '🆘 Error': 'error',
      '✴️ Warning': 'warning',
      '❇️ Success': 'success',
      'ℹ️ Information': 'information',
      '🚀 Feature': 'feature',
    }),
    style: figma.enum('🏵️ Style', {
      Filled: 'filled',
      Light: 'light',
      Lighter: 'lighter',
      Stroke: 'stroke',
    }),
    size: figma.enum('📏 Size', {
      'X-Small (32)': 'xs',
      'Small (36)': 'sm',
      Large: 'default',
    }),
    title: figma.string('✏️ Edit Text'),
    description: figma.enum('📏 Size', { 'X-Small (32)': undefined, 'Small (36)': undefined, Large: figma.string('✏️ Edit Description') }),
    showIcon: figma.boolean('⬅️ Left Icon'),
    icon: figma.instance('⬅️ Pick Left'),
    dismissible: figma.boolean('✖️ Dismiss Icon'),
    action: figma.boolean('🔗 Link Button', { true: figma.children('Link Buttons [1.1]'), false: undefined }),
  },
  example: ({ status, style, size, title, description, showIcon, icon, dismissible, action }) => (
    <Alert status={status} style={style} size={size} showIcon={showIcon} icon={icon} dismissible={dismissible} action={action}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  ),
})
