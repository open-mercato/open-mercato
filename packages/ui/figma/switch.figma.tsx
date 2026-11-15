import React from 'react'
import figma from '@figma/code-connect'
import { Switch } from '../src/primitives/switch'
import { SwitchField } from '../src/primitives/switch-field'

// Hover/pressed are runtime states, not persistent boolean props.
figma.connect(Switch, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=385-4086', {
  imports: ["import { Switch } from '@open-mercato/ui/primitives/switch'"],
  props: {
    checked: figma.enum('🟢 Active', { Off: false, On: true }),
    disabled: figma.enum('📌 State', { Default: false, Hover: false, Pressed: false, Disabled: true }),
  },
  example: ({ checked, disabled }) => <Switch defaultChecked={checked} disabled={disabled} />,
})

// The label set has no Disabled property; badge/link children are omitted until connected.
figma.connect(SwitchField, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=385-4580', {
  imports: ["import { SwitchField } from '@open-mercato/ui/primitives/switch-field'"],
  props: {
    checked: figma.enum('🟢 Active', { Off: false, On: true }),
    label: figma.string('✏️ Edit Label'),
    sublabel: figma.boolean('💬 Sublabel', { true: figma.string('✏️ Edit Sublabel'), false: undefined }),
    description: figma.enum('📝 Description', { Off: undefined, On: figma.string('✏️ Edit Description') }),
    // Figma Off puts the switch on the left; SwitchField calls that flip=true.
    flip: figma.enum('🔄 Flip', { Off: true, On: false }),
  },
  example: ({ checked, label, sublabel, description, flip }) => (
    <SwitchField defaultChecked={checked} label={label} sublabel={sublabel} description={description} flip={flip} />
  ),
})
