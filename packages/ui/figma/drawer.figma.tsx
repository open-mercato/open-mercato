import React from 'react'
import figma from '@figma/code-connect'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '../src/primitives/drawer'
import { Separator } from '../src/primitives/separator'

// The audited design publishes header/footer sets, not a Drawer root. This connection covers the actual header.
// Body/footer, optional count and header action need their own application composition.
figma.connect(DrawerHeader, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=3187-2897', {
  imports: [
    "import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@open-mercato/ui/primitives/drawer'",
    "import { Separator } from '@open-mercato/ui/primitives/separator'",
  ],
  props: {
    title: figma.string('✏️ Edit Title'),
    description: figma.enum('📏 Size', { Small: undefined, Large: figma.string('✏️ Edit Description') }),
    leading: figma.enum('🧩 Type', { '📂 Basic': undefined, '⬅️ Left Icon': figma.instance('💠 Pick Icon') }),
    hideCloseButton: figma.boolean('✖️ Dismiss Icon', { true: false, false: true }),
    divider: figma.boolean('➖ Divider', { true: <Separator />, false: undefined }),
  },
  example: ({ title, description, leading, hideCloseButton, divider }) => (
    <Drawer defaultOpen>
      <DrawerContent hideCloseButton={hideCloseButton}>
        <DrawerHeader leading={leading}>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        {divider}
      </DrawerContent>
    </Drawer>
  ),
})
