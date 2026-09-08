import React from 'react'
import figma from '@figma/code-connect'
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '../src/primitives/drawer'
import { Button } from '../src/primitives/button'

figma.connect(Drawer, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/Design-System?node-id=486-7366', {
  imports: [
    "import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerBody, DrawerFooter, DrawerClose } from '@open-mercato/ui/primitives/drawer'",
  ],
  props: {
    title: figma.string('Title'),
    description: figma.string('Description'),
  },
  example: ({ title, description }) => (
    <Drawer>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody>Content</DrawerBody>
        <DrawerFooter layout="equal">
          <DrawerClose asChild>
            <Button variant="outline">Cancel</Button>
          </DrawerClose>
          <Button>Save</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  ),
})
