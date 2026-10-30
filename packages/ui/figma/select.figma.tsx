import React from 'react'
import figma from '@figma/code-connect'
import { Select, SelectTrigger, SelectTriggerLeading, SelectValue } from '../src/primitives/select'

// This is the Basic trigger, not a fabricated option menu. Compose form labels and actual option data at the call site.
figma.connect(SelectTrigger, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=270-1085', {
  imports: [
    "import { Select, SelectTrigger, SelectTriggerLeading, SelectValue } from '@open-mercato/ui/primitives/select'",
  ],
  variant: { '🧩 Type': '📂 Basic' },
  props: {
    placeholder: figma.string('✏️ Edit Text'),
    disabled: figma.enum('📌 State', { Default: false, Filled: false, Hover: false, Focus: false, Disabled: true, Error: false }),
    invalid: figma.enum('📌 State', { Default: false, Filled: false, Hover: false, Focus: false, Disabled: false, Error: true }),
    size: figma.enum('📏 Size', { 'Medium (40)': 40, 'Small (36)': 36, 'X-Small (32)': 32 }),
    leading: figma.boolean('⬅️ Left Icon', { true: figma.instance('⬅️ Pick Left'), false: undefined }),
  },
  example: ({ placeholder, disabled, invalid, size, leading }) => (
    <Select>
      <SelectTrigger disabled={disabled} size={size} aria-invalid={invalid}>
        <SelectTriggerLeading className="empty:hidden">{leading}</SelectTriggerLeading>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
    </Select>
  ),
})
