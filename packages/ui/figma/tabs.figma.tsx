import React from 'react'
import figma from '@figma/code-connect'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../src/primitives/tabs'

// TODO(figma): resolve the real node id in the DS file before ds:code-connect:publish.
figma.connect(Tabs, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/Design-System?node-id=0-1', {
  imports: ["import { Tabs, TabsList, TabsTrigger, TabsContent } from '@open-mercato/ui/primitives/tabs'"],
  props: {
    label: figma.string('Label'),
    count: figma.string('Count'),
  },
  example: ({ label, count }) => (
    <Tabs defaultValue="first" variant="underline">
      <TabsList aria-label="Sections">
        <TabsTrigger value="first" count={count}>
          {label}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="first">Content</TabsContent>
    </Tabs>
  ),
})
