import * as React from 'react'
import {
  FilePlus2,
  Info,
  LayoutDashboard,
  Settings,
  TriangleAlert,
  UserRound,
  Users,
} from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@open-mercato/ui/primitives/dialog'
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@open-mercato/ui/primitives/drawer'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@open-mercato/ui/primitives/sheet'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@open-mercato/ui/primitives/popover'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import {
  CommandMenu,
  CommandMenuContent,
  CommandMenuEmpty,
  CommandMenuFooter,
  CommandMenuGroup,
  CommandMenuInput,
  CommandMenuItem,
  CommandMenuList,
  CommandMenuSeparator,
  CommandMenuTrigger,
} from '@open-mercato/ui/primitives/command-menu'
import type { GalleryEntry } from '../types'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.
//
// Every stateful overlay renders a REAL trigger in the preview stage and opens
// uncontrolled — the actual Radix focus trap, Escape-to-close, and
// outside-click behavior are exercised live, never imitated.

const dialogEntry: GalleryEntry = {
  id: 'dialog',
  title: 'Dialog',
  importPath: '@open-mercato/ui/primitives/dialog',
  docsAnchor: '#dialog',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => (
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename view</DialogTitle>
              <DialogDescription>
                The new name is visible to everyone in this workspace.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Press Escape or click outside to dismiss.
            </p>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button>Save changes</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ),
      code: `import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@open-mercato/ui/primitives/dialog'

<Dialog>
  <DialogTrigger asChild>
    <Button variant="outline">Open dialog</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Rename view</DialogTitle>
      <DialogDescription>
        The new name is visible to everyone in this workspace.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <DialogClose asChild>
        <Button variant="outline">Cancel</Button>
      </DialogClose>
      <Button>Save changes</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>`,
    },
    {
      id: 'status-leading',
      title: 'Status leading badge',
      render: () => (
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive-outline">Delete record</Button>
          </DialogTrigger>
          <DialogContent size="sm">
            <DialogHeader leading={<TriangleAlert className="size-4" />} leadingTone="error">
              <DialogTitle>Delete this record?</DialogTitle>
              <DialogDescription>
                This removes the record from every linked view.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter layout="equal">
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button variant="destructive">Delete</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ),
      code: `import { TriangleAlert } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@open-mercato/ui/primitives/dialog'

<Dialog>
  <DialogTrigger asChild>
    <Button variant="destructive-outline">Delete record</Button>
  </DialogTrigger>
  <DialogContent size="sm">
    <DialogHeader leading={<TriangleAlert className="size-4" />} leadingTone="error">
      <DialogTitle>Delete this record?</DialogTitle>
      <DialogDescription>
        This removes the record from every linked view.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter layout="equal">
      <DialogClose asChild>
        <Button variant="outline">Cancel</Button>
      </DialogClose>
      <Button variant="destructive">Delete</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>`,
    },
  ],
}

const drawerEntry: GalleryEntry = {
  id: 'drawer',
  title: 'Drawer',
  importPath: '@open-mercato/ui/primitives/drawer',
  docsAnchor: '#drawer',
  figmaNodeId: '486:7366',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => (
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="outline">Open drawer</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Edit person</DrawerTitle>
              <DrawerDescription>Update the contact details below.</DrawerDescription>
            </DrawerHeader>
            <DrawerBody>
              <div className="divide-y divide-input text-sm">
                <div className="flex items-center justify-between py-3">
                  <span className="text-muted-foreground">Name</span>
                  <span className="text-foreground">Anna Kowalska</span>
                </div>
                <div className="flex items-center justify-between py-3">
                  <span className="text-muted-foreground">Role</span>
                  <span className="text-foreground">Account manager</span>
                </div>
                <div className="flex items-center justify-between py-3">
                  <span className="text-muted-foreground">Team</span>
                  <span className="text-foreground">Sales EU</span>
                </div>
              </div>
            </DrawerBody>
            <DrawerFooter layout="equal">
              <DrawerClose asChild>
                <Button variant="outline">Cancel</Button>
              </DrawerClose>
              <Button>Save changes</Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ),
      code: `import { Button } from '@open-mercato/ui/primitives/button'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerBody,
  DrawerFooter,
  DrawerClose,
} from '@open-mercato/ui/primitives/drawer'

<Drawer>
  <DrawerTrigger asChild>
    <Button variant="outline">Open drawer</Button>
  </DrawerTrigger>
  <DrawerContent>
    <DrawerHeader>
      <DrawerTitle>Edit person</DrawerTitle>
      <DrawerDescription>Update the contact details below.</DrawerDescription>
    </DrawerHeader>
    <DrawerBody>{/* content */}</DrawerBody>
    <DrawerFooter layout="equal">
      <DrawerClose asChild>
        <Button variant="outline">Cancel</Button>
      </DrawerClose>
      <Button>Save changes</Button>
    </DrawerFooter>
  </DrawerContent>
</Drawer>`,
    },
    {
      id: 'leading-icon',
      title: 'Header leading icon',
      render: () => (
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="outline">Open profile drawer</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader leading={<UserRound className="size-4" />}>
              <DrawerTitle>Profile details</DrawerTitle>
              <DrawerDescription>Read-only summary of this account.</DrawerDescription>
            </DrawerHeader>
            <DrawerBody>
              <p className="text-sm text-muted-foreground">
                The header badge takes any Lucide icon via the <code>leading</code> prop.
              </p>
            </DrawerBody>
            <DrawerFooter layout="equal">
              <DrawerClose asChild>
                <Button variant="outline">Cancel</Button>
              </DrawerClose>
              <Button>Continue</Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ),
      code: `import { UserRound } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerBody,
  DrawerFooter,
  DrawerClose,
} from '@open-mercato/ui/primitives/drawer'

<Drawer>
  <DrawerTrigger asChild>
    <Button variant="outline">Open profile drawer</Button>
  </DrawerTrigger>
  <DrawerContent>
    <DrawerHeader leading={<UserRound className="size-4" />}>
      <DrawerTitle>Profile details</DrawerTitle>
      <DrawerDescription>Read-only summary of this account.</DrawerDescription>
    </DrawerHeader>
    <DrawerBody>{/* content */}</DrawerBody>
    <DrawerFooter layout="equal">
      <DrawerClose asChild>
        <Button variant="outline">Cancel</Button>
      </DrawerClose>
      <Button>Continue</Button>
    </DrawerFooter>
  </DrawerContent>
</Drawer>`,
    },
  ],
}

const sheetEntry: GalleryEntry = {
  id: 'sheet',
  title: 'Sheet',
  importPath: '@open-mercato/ui/primitives/sheet',
  variants: [
    {
      id: 'right',
      title: 'right (default)',
      render: () => (
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">Open sheet</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription>Narrow down the current list.</SheetDescription>
            </SheetHeader>
            <div className="flex-1 px-4 text-sm text-muted-foreground">
              Sheet body content scrolls independently of the header and footer.
            </div>
            <SheetFooter>
              <Button variant="outline">Reset</Button>
              <Button>Apply</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ),
      code: `import { Button } from '@open-mercato/ui/primitives/button'
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@open-mercato/ui/primitives/sheet'

<Sheet>
  <SheetTrigger asChild>
    <Button variant="outline">Open sheet</Button>
  </SheetTrigger>
  <SheetContent>
    <SheetHeader>
      <SheetTitle>Filters</SheetTitle>
      <SheetDescription>Narrow down the current list.</SheetDescription>
    </SheetHeader>
    {/* body */}
    <SheetFooter>
      <Button variant="outline">Reset</Button>
      <Button>Apply</Button>
    </SheetFooter>
  </SheetContent>
</Sheet>`,
    },
    {
      id: 'left',
      title: 'side="left"',
      render: () => (
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">Open left sheet</Button>
          </SheetTrigger>
          <SheetContent side="left">
            <SheetHeader>
              <SheetTitle>Navigation</SheetTitle>
              <SheetDescription>Slides in from the left edge.</SheetDescription>
            </SheetHeader>
            <div className="flex-1 px-4 text-sm text-muted-foreground">
              Use the left side for mobile menus and secondary navigation.
            </div>
          </SheetContent>
        </Sheet>
      ),
      code: `import { Button } from '@open-mercato/ui/primitives/button'
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@open-mercato/ui/primitives/sheet'

<Sheet>
  <SheetTrigger asChild>
    <Button variant="outline">Open left sheet</Button>
  </SheetTrigger>
  <SheetContent side="left">
    <SheetHeader>
      <SheetTitle>Navigation</SheetTitle>
      <SheetDescription>Slides in from the left edge.</SheetDescription>
    </SheetHeader>
    {/* body */}
  </SheetContent>
</Sheet>`,
    },
  ],
}

const popoverEntry: GalleryEntry = {
  id: 'popover',
  title: 'Popover',
  importPath: '@open-mercato/ui/primitives/popover',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">Open popover</Button>
          </PopoverTrigger>
          <PopoverContent className="p-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-foreground">Display density</span>
              <span className="text-sm text-muted-foreground">
                Anchored to its trigger; Escape and outside-click dismiss it.
              </span>
            </div>
          </PopoverContent>
        </Popover>
      ),
      code: `import { Button } from '@open-mercato/ui/primitives/button'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@open-mercato/ui/primitives/popover'

<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline">Open popover</Button>
  </PopoverTrigger>
  <PopoverContent className="p-4">
    {/* content */}
  </PopoverContent>
</Popover>`,
    },
    {
      id: 'align-end',
      title: 'align="end" + side="top"',
      render: () => (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">Open above</Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="p-4">
            <span className="text-sm text-muted-foreground">
              Placement follows Radix side/align props and flips when space runs out.
            </span>
          </PopoverContent>
        </Popover>
      ),
      code: `import { Button } from '@open-mercato/ui/primitives/button'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@open-mercato/ui/primitives/popover'

<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline">Open above</Button>
  </PopoverTrigger>
  <PopoverContent side="top" align="end" className="p-4">
    {/* content */}
  </PopoverContent>
</Popover>`,
    },
  ],
}

const tooltipEntry: GalleryEntry = {
  id: 'tooltip',
  title: 'Tooltip',
  importPath: '@open-mercato/ui/primitives/tooltip',
  docsAnchor: '#tooltip--simpletooltip',
  variants: [
    {
      id: 'default',
      title: 'default (dark)',
      render: () => (
        <SimpleTooltip content="Duplicates this view with all filters">
          <Button variant="outline">Hover me</Button>
        </SimpleTooltip>
      ),
      code: `import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { Button } from '@open-mercato/ui/primitives/button'

<SimpleTooltip content="Duplicates this view with all filters">
  <Button variant="outline">Hover me</Button>
</SimpleTooltip>`,
    },
    {
      id: 'light',
      title: 'light',
      render: () => (
        <SimpleTooltip content="Help text on a light surface" variant="light">
          <Button variant="outline">
            <Info />
            Light variant
          </Button>
        </SimpleTooltip>
      ),
      code: `import { Info } from 'lucide-react'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { Button } from '@open-mercato/ui/primitives/button'

<SimpleTooltip content="Help text on a light surface" variant="light">
  <Button variant="outline"><Info />Light variant</Button>
</SimpleTooltip>`,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      render: () => (
        <>
          <SimpleTooltip content="Small" size="sm">
            <Button variant="outline" size="sm">sm</Button>
          </SimpleTooltip>
          <SimpleTooltip content="Default">
            <Button variant="outline" size="sm">default</Button>
          </SimpleTooltip>
          <SimpleTooltip content="Large tooltip for longer helper copy" size="lg">
            <Button variant="outline" size="sm">lg</Button>
          </SimpleTooltip>
        </>
      ),
      code: `import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { Button } from '@open-mercato/ui/primitives/button'

<SimpleTooltip content="Small" size="sm">
  <Button variant="outline" size="sm">sm</Button>
</SimpleTooltip>
<SimpleTooltip content="Default">
  <Button variant="outline" size="sm">default</Button>
</SimpleTooltip>
<SimpleTooltip content="Large tooltip for longer helper copy" size="lg">
  <Button variant="outline" size="sm">lg</Button>
</SimpleTooltip>`,
    },
  ],
}

const commandMenuEntry: GalleryEntry = {
  id: 'command-menu',
  title: 'CommandMenu',
  importPath: '@open-mercato/ui/primitives/command-menu',
  docsAnchor: '#commandmenu',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => (
        <CommandMenu>
          <CommandMenuTrigger asChild>
            <Button variant="outline">Open command menu</Button>
          </CommandMenuTrigger>
          <CommandMenuContent>
            <CommandMenuInput placeholder="Search actions..." />
            <CommandMenuList>
              <CommandMenuEmpty>No results.</CommandMenuEmpty>
              <CommandMenuGroup heading="Actions">
                <CommandMenuItem leading={<FilePlus2 className="size-4 text-muted-foreground" />}>
                  Create record
                </CommandMenuItem>
                <CommandMenuItem leading={<Users className="size-4 text-muted-foreground" />} description="Invite teammates to this workspace">
                  Manage members
                </CommandMenuItem>
              </CommandMenuGroup>
              <CommandMenuSeparator />
              <CommandMenuGroup heading="Navigate">
                <CommandMenuItem leading={<LayoutDashboard className="size-4 text-muted-foreground" />}>
                  Go to dashboard
                </CommandMenuItem>
                <CommandMenuItem leading={<Settings className="size-4 text-muted-foreground" />}>
                  Open settings
                </CommandMenuItem>
              </CommandMenuGroup>
            </CommandMenuList>
            <CommandMenuFooter />
          </CommandMenuContent>
        </CommandMenu>
      ),
      code: `import { FilePlus2, LayoutDashboard, Settings, Users } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  CommandMenu,
  CommandMenuTrigger,
  CommandMenuContent,
  CommandMenuInput,
  CommandMenuList,
  CommandMenuEmpty,
  CommandMenuGroup,
  CommandMenuItem,
  CommandMenuSeparator,
  CommandMenuFooter,
} from '@open-mercato/ui/primitives/command-menu'

<CommandMenu>
  <CommandMenuTrigger asChild>
    <Button variant="outline">Open command menu</Button>
  </CommandMenuTrigger>
  <CommandMenuContent>
    <CommandMenuInput placeholder="Search actions..." />
    <CommandMenuList>
      <CommandMenuEmpty>No results.</CommandMenuEmpty>
      <CommandMenuGroup heading="Actions">
        <CommandMenuItem leading={<FilePlus2 className="size-4" />}>
          Create record
        </CommandMenuItem>
        <CommandMenuItem leading={<Users className="size-4" />} description="Invite teammates to this workspace">
          Manage members
        </CommandMenuItem>
      </CommandMenuGroup>
      <CommandMenuSeparator />
      <CommandMenuGroup heading="Navigate">
        <CommandMenuItem leading={<LayoutDashboard className="size-4" />}>
          Go to dashboard
        </CommandMenuItem>
        <CommandMenuItem leading={<Settings className="size-4" />}>
          Open settings
        </CommandMenuItem>
      </CommandMenuGroup>
    </CommandMenuList>
    <CommandMenuFooter />
  </CommandMenuContent>
</CommandMenu>`,
    },
  ],
}

export const entries: GalleryEntry[] = [
  dialogEntry,
  drawerEntry,
  sheetEntry,
  popoverEntry,
  tooltipEntry,
  commandMenuEntry,
]
