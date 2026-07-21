import React from 'react'
import figma from '@figma/code-connect'
import { Radio, RadioGroup } from '../src/primitives/radio'

// TODO(figma): resolve the real node id in the DS file before ds:code-connect:publish.
figma.connect(Radio, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/Design-System?node-id=0-1', {
  imports: ["import { Radio, RadioGroup } from '@open-mercato/ui/primitives/radio'"],
  props: {
    disabled: figma.boolean('Disabled'),
  },
  example: ({ disabled }) => (
    <RadioGroup defaultValue="first">
      <Radio value="first" disabled={disabled} />
    </RadioGroup>
  ),
})
