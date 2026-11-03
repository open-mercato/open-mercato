import React from 'react'
import figma from '@figma/code-connect'
import { Tag } from '../src/primitives/tag'

// Basic, non-dismissable tags. Avatar/country/brand/company content and removal handlers belong to the consumer.
// Hover and active styling follows real interaction; there is no synthetic state prop.
figma.connect(Tag, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=431-16147', {
  imports: ["import { Tag } from '@open-mercato/ui/primitives/tag'"],
  variant: { '🧩 Type': '📂 Basic', '✖️ Dismiss Icon': 'Off' },
  props: {
    appearance: figma.enum('🏵️ Style', { Stroke: 'stroke', Gray: 'gray' }),
    disabled: figma.enum('📌 State', { Default: false, Hover: false, Active: false, Disabled: true }),
    label: figma.string('✏️ Edit Text'),
    sublabel: figma.boolean('💬 Sublabel', { true: figma.string('✏️ Edit Sublabel'), false: undefined }),
  },
  example: ({ appearance, disabled, label, sublabel }) => (
    <Tag appearance={appearance} disabled={disabled} sublabel={sublabel} shape="square">
      {label}
    </Tag>
  ),
})
