import React from 'react'
import figma from '@figma/code-connect'
import { Switch } from '../src/primitives/switch'
import { SwitchField } from '../src/primitives/switch-field'

// TODO(figma): resolve the real node id in the DS file before ds:code-connect:publish.
figma.connect(Switch, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/Design-System?node-id=0-1', {
  imports: ["import { Switch } from '@open-mercato/ui/primitives/switch'"],
  variant: { Label: 'False' },
  props: {
    checked: figma.boolean('Checked'),
    disabled: figma.boolean('Disabled'),
  },
  example: ({ checked, disabled }) => <Switch checked={checked} disabled={disabled} />,
})

figma.connect(SwitchField, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/Design-System?node-id=0-1', {
  imports: ["import { SwitchField } from '@open-mercato/ui/primitives/switch-field'"],
  variant: { Label: 'True' },
  props: {
    checked: figma.boolean('Checked'),
    disabled: figma.boolean('Disabled'),
    label: figma.string('Label text'),
  },
  example: ({ checked, disabled, label }) => (
    <SwitchField checked={checked} disabled={disabled} label={label} />
  ),
})
