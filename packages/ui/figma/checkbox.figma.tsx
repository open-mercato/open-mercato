import React from 'react'
import figma from '@figma/code-connect'
import { Checkbox } from '../src/primitives/checkbox'
import { CheckboxField } from '../src/primitives/checkbox-field'

// TODO(figma): resolve the real node id in the DS file before ds:code-connect:publish.
figma.connect(Checkbox, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/Design-System?node-id=0-1', {
  imports: ["import { Checkbox } from '@open-mercato/ui/primitives/checkbox'"],
  variant: { Label: 'False' },
  props: {
    checked: figma.boolean('Checked'),
    disabled: figma.boolean('Disabled'),
  },
  example: ({ checked, disabled }) => <Checkbox checked={checked} disabled={disabled} />,
})

figma.connect(CheckboxField, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/Design-System?node-id=0-1', {
  imports: ["import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'"],
  variant: { Label: 'True' },
  props: {
    checked: figma.boolean('Checked'),
    disabled: figma.boolean('Disabled'),
    label: figma.string('Label text'),
  },
  example: ({ checked, disabled, label }) => (
    <CheckboxField checked={checked} disabled={disabled} label={label} />
  ),
})
