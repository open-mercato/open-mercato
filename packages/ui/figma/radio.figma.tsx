import React from 'react'
import figma from '@figma/code-connect'
import { Radio, RadioGroup } from '../src/primitives/radio'

// Radio selection belongs to RadioGroup; hover/focus remain runtime states.
figma.connect(Radio, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=515-4242', {
  imports: ["import { Radio, RadioGroup } from '@open-mercato/ui/primitives/radio'"],
  props: {
    disabled: figma.enum('📌 State', { Default: false, Hover: false, Focused: false, Disabled: true }),
    selected: figma.enum('🟢 Active', { Off: undefined, On: 'item' }),
  },
  example: ({ disabled, selected }) => (
    <RadioGroup defaultValue={selected}>
      <Radio value="item" disabled={disabled} />
    </RadioGroup>
  ),
})
