import React from 'react'
import figma from '@figma/code-connect'
import { Tabs, TabsList, TabsTrigger } from '../src/primitives/tabs'

// This node is a horizontal tab item. Tabs supplies selection context; panel content is supplied by the application.
// The nested number and right-icon slots are not represented by matching props on this Figma set/code pair.
figma.connect(TabsTrigger, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=3511-9832', {
  imports: ["import { Tabs, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'"],
  props: {
    label: figma.string('✏️ Edit Text'),
    selected: figma.enum('🟢 Active', { Off: undefined, On: 'item' }),
    leading: figma.boolean('⬅️ Left Icon', { true: figma.instance('⬅️ Pick Left'), false: undefined }),
  },
  example: ({ label, selected, leading }) => (
    <Tabs defaultValue={selected} variant="underline">
      <TabsList>
        <TabsTrigger value="item" leading={leading}>
          {label}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  ),
})
