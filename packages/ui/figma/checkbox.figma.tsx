import React from 'react'
import figma from '@figma/code-connect'
import { Checkbox } from '../src/primitives/checkbox'
import { CheckboxField } from '../src/primitives/checkbox-field'

// Hover/focus are runtime states; checked includes Figma's indeterminate axis.
figma.connect(Checkbox, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=227-2002', {
  imports: ["import { Checkbox } from '@open-mercato/ui/primitives/checkbox'"],
  props: {
    checked: figma.enum('❓ Indeterminate', { On: 'indeterminate', Off: figma.enum('🟢 Active', { Off: false, On: true }) }),
    disabled: figma.enum('📌 State', { Default: false, Hover: false, Focused: false, Disabled: true }),
    size: figma.enum('📏 Size', { Medium: 'md', Small: 'sm' }),
  },
  example: ({ checked, disabled, size }) => <Checkbox checked={checked} disabled={disabled} size={size} />,
})

// The label set has no Disabled property. Nested badge/link content is not hardcoded.
figma.connect(CheckboxField, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=231-4897', {
  imports: ["import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'"],
  props: {
    checked: figma.enum('🟢 Active', { Off: false, On: true }),
    label: figma.string('✏️ Edit Label'),
    sublabel: figma.boolean('💬 Sublabel', { true: figma.string('✏️ Edit Sublabel'), false: undefined }),
    description: figma.enum('📝 Description', { Off: undefined, On: figma.string('✏️ Edit Description') }),
    flip: figma.enum('🔄 Flip', { Off: false, On: true }),
  },
  example: ({ checked, label, sublabel, description, flip }) => (
    <CheckboxField defaultChecked={checked} label={label} sublabel={sublabel} description={description} flip={flip} />
  ),
})
