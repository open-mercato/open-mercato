import React from 'react'
import figma from '@figma/code-connect'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../src/primitives/select'

// TODO(figma): resolve the real node id in the DS file before ds:code-connect:publish.
figma.connect(Select, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/Design-System?node-id=0-1', {
  imports: [
    "import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@open-mercato/ui/primitives/select'",
  ],
  props: {
    placeholder: figma.string('Placeholder'),
    disabled: figma.boolean('Disabled'),
  },
  example: ({ placeholder, disabled }) => (
    <Select>
      <SelectTrigger disabled={disabled}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="first">First option</SelectItem>
      </SelectContent>
    </Select>
  ),
})
