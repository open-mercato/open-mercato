import React from 'react'
import figma from '@figma/code-connect'
import { HintText } from '../src/primitives/hint-text'

figma.connect(HintText, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=266-5284', {
  imports: ["import { HintText } from '@open-mercato/ui/primitives/hint-text'"],
  props: {
    state: figma.enum('📌 State', { Default: 'default', Error: 'error', Disabled: 'disabled' }),
    leading: figma.boolean('⬅️ Left Icon', { true: figma.instance('⬅️ Pick Left'), false: undefined }),
    text: figma.string('✏️ Edit Hint Text'),
  },
  example: ({ state, leading, text }) => <HintText state={state} leading={leading}>{text}</HintText>,
})
