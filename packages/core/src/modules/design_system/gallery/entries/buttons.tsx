import * as React from 'react'
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { SocialButton } from '@open-mercato/ui/primitives/social-button'
import { FancyButton } from '@open-mercato/ui/primitives/fancy-button'
import { ButtonGroup } from '@open-mercato/ui/primitives/button-group'
import type { GalleryEntry } from '../types'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.

const buttonEntry: GalleryEntry = {
  id: 'button',
  title: 'Button',
  importPath: '@open-mercato/ui/primitives/button',
  usage: {
    do: [
      'One default (primary) Button per view; remaining actions step down to outline, ghost or muted.',
      'Destructive actions use the destructive family; -outline/-soft/-ghost lower the emphasis without losing the semantics.',
      'Default height is h-9; sm (h-8) in dense toolbars, 2xs only inside table rows.',
    ],
    dont: [
      'Never Button size="icon" for icon-only actions — use IconButton (correct sizing + aria-label contract).',
      'Never style a raw <button> or <Link> to look like a Button.',
      'The link variant is for navigation-like actions, not for mutations.',
    ],
  },
  descriptionKey: 'design_system.entries.button.description',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => <Button>Save changes</Button>,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button>Save changes</Button>`,
    },
    {
      id: 'destructive',
      title: 'destructive',
      render: () => <Button variant="destructive">Delete</Button>,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button variant="destructive">Delete</Button>`,
    },
    {
      id: 'destructive-outline',
      title: 'destructive-outline',
      render: () => <Button variant="destructive-outline">Delete</Button>,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button variant="destructive-outline">Delete</Button>`,
    },
    {
      id: 'destructive-soft',
      title: 'destructive-soft',
      render: () => <Button variant="destructive-soft">Delete draft</Button>,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button variant="destructive-soft">Delete draft</Button>`,
    },
    {
      id: 'destructive-ghost',
      title: 'destructive-ghost',
      render: () => <Button variant="destructive-ghost">Remove</Button>,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button variant="destructive-ghost">Remove</Button>`,
    },
    {
      id: 'outline',
      title: 'outline',
      render: () => <Button variant="outline">Cancel</Button>,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button variant="outline">Cancel</Button>`,
    },
    {
      id: 'secondary',
      title: 'secondary',
      render: () => <Button variant="secondary">Duplicate</Button>,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button variant="secondary">Duplicate</Button>`,
    },
    {
      id: 'ghost',
      title: 'ghost',
      render: () => <Button variant="ghost">Dismiss</Button>,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button variant="ghost">Dismiss</Button>`,
    },
    {
      id: 'muted',
      title: 'muted',
      render: () => <Button variant="muted">Show more</Button>,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button variant="muted">Show more</Button>`,
    },
    {
      id: 'link',
      title: 'link',
      render: () => <Button variant="link">View details</Button>,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button variant="link">View details</Button>`,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      render: () => (
        <>
          <Button size="lg">Large</Button>
          <Button size="default">Default</Button>
          <Button size="sm">Small</Button>
          <Button size="2xs">2X-Small</Button>
          <Button size="icon" aria-label="Add">
            <Plus />
          </Button>
        </>
      ),
      code: `import { Plus } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'

<Button size="lg">Large</Button>
<Button size="default">Default</Button>
<Button size="sm">Small</Button>
<Button size="2xs">2X-Small</Button>
<Button size="icon" aria-label="Add"><Plus /></Button>`,
    },
  ],
}

const iconButtonEntry: GalleryEntry = {
  id: 'icon-button',
  title: 'IconButton',
  importPath: '@open-mercato/ui/primitives/icon-button',
  usage: {
    do: [
      'Always pass aria-label — the icon is the only content.',
      'size="default" is h-8, one step smaller than Button; use size="lg" (h-9) to align inside a Button row.',
    ],
    dont: ['Never fake it with Button size="icon".'],
  },
  descriptionKey: 'design_system.entries.iconButton.description',
  variants: [
    {
      id: 'variants',
      title: 'Variants',
      render: () => (
        <>
          <IconButton variant="primary" aria-label="Add">
            <Plus />
          </IconButton>
          <IconButton variant="outline" aria-label="Edit">
            <Pencil />
          </IconButton>
          <IconButton variant="ghost" aria-label="More">
            <MoreHorizontal />
          </IconButton>
          <IconButton variant="white" aria-label="Edit">
            <Pencil />
          </IconButton>
          <IconButton variant="destructive" aria-label="Delete">
            <Trash2 />
          </IconButton>
        </>
      ),
      code: `import { Pencil } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'

<IconButton variant="primary" aria-label="Add"><Plus /></IconButton>
<IconButton variant="outline" aria-label="Edit"><Pencil /></IconButton>
<IconButton variant="ghost" aria-label="More"><MoreHorizontal /></IconButton>
<IconButton variant="white" aria-label="Edit"><Pencil /></IconButton>
<IconButton variant="destructive" aria-label="Delete"><Trash2 /></IconButton>`,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      render: () => (
        <>
          <IconButton size="lg" aria-label="Edit">
            <Pencil />
          </IconButton>
          <IconButton size="default" aria-label="Edit">
            <Pencil />
          </IconButton>
          <IconButton size="sm" aria-label="Edit">
            <Pencil />
          </IconButton>
          <IconButton size="xs" aria-label="Edit">
            <Pencil />
          </IconButton>
        </>
      ),
      code: `import { Pencil } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'

<IconButton size="lg" aria-label="Edit"><Pencil /></IconButton>
<IconButton size="default" aria-label="Edit"><Pencil /></IconButton>
<IconButton size="sm" aria-label="Edit"><Pencil /></IconButton>
<IconButton size="xs" aria-label="Edit"><Pencil /></IconButton>`,
    },
    {
      id: 'full-radius',
      title: 'fullRadius',
      render: () => (
        <IconButton fullRadius aria-label="Add">
          <Plus />
        </IconButton>
      ),
      code: `import { Plus } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'

<IconButton fullRadius aria-label="Add"><Plus /></IconButton>`,
    },
  ],
}

const linkButtonEntry: GalleryEntry = {
  id: 'link-button',
  title: 'LinkButton',
  importPath: '@open-mercato/ui/primitives/link-button',
  descriptionKey: 'design_system.entries.linkButton.description',
  variants: [
    {
      id: 'variants',
      title: 'Variants',
      render: () => (
        <>
          <LinkButton>primary</LinkButton>
          <LinkButton variant="gray">gray</LinkButton>
          <LinkButton variant="black">black</LinkButton>
          <LinkButton variant="error">error</LinkButton>
        </>
      ),
      code: `import { LinkButton } from '@open-mercato/ui/primitives/link-button'

<LinkButton>primary</LinkButton>
<LinkButton variant="gray">gray</LinkButton>
<LinkButton variant="black">black</LinkButton>
<LinkButton variant="error">error</LinkButton>`,
    },
    {
      id: 'underline',
      title: 'Underline',
      render: () => (
        <>
          <LinkButton underline="always">always</LinkButton>
          <LinkButton underline="hover">hover</LinkButton>
          <LinkButton underline="none">none</LinkButton>
        </>
      ),
      code: `import { LinkButton } from '@open-mercato/ui/primitives/link-button'

<LinkButton underline="always">always</LinkButton>
<LinkButton underline="hover">hover</LinkButton>
<LinkButton underline="none">none</LinkButton>`,
    },
    {
      id: 'as-anchor',
      title: 'As anchor (asChild)',
      render: () => (
        <LinkButton asChild>
          <a href="#gallery-entry-link-button">Open link</a>
        </LinkButton>
      ),
      code: `import { LinkButton } from '@open-mercato/ui/primitives/link-button'

<LinkButton asChild>
  <a href="/backend/docs">Open link</a>
</LinkButton>`,
    },
  ],
}

const socialButtonEntry: GalleryEntry = {
  id: 'social-button',
  title: 'SocialButton',
  importPath: '@open-mercato/ui/primitives/social-button',
  descriptionKey: 'design_system.entries.socialButton.description',
  variants: [
    {
      id: 'filled',
      title: 'filled',
      render: () => (
        <>
          <SocialButton brand="github">Continue with GitHub</SocialButton>
          <SocialButton brand="google">Continue with Google</SocialButton>
        </>
      ),
      code: `import { SocialButton } from '@open-mercato/ui/primitives/social-button'

<SocialButton brand="github">Continue with GitHub</SocialButton>
<SocialButton brand="google">Continue with Google</SocialButton>`,
    },
    {
      id: 'stroke',
      title: 'stroke',
      render: () => (
        <>
          <SocialButton brand="github" appearance="stroke">Continue with GitHub</SocialButton>
          <SocialButton brand="linkedin" appearance="stroke">Continue with LinkedIn</SocialButton>
        </>
      ),
      code: `import { SocialButton } from '@open-mercato/ui/primitives/social-button'

<SocialButton brand="github" appearance="stroke">Continue with GitHub</SocialButton>
<SocialButton brand="linkedin" appearance="stroke">Continue with LinkedIn</SocialButton>`,
    },
  ],
}

const fancyButtonEntry: GalleryEntry = {
  id: 'fancy-button',
  title: 'FancyButton',
  importPath: '@open-mercato/ui/primitives/fancy-button',
  descriptionKey: 'design_system.entries.fancyButton.description',
  variants: [
    {
      id: 'intents',
      title: 'Intents',
      render: () => (
        <>
          <FancyButton intent="neutral">Neutral</FancyButton>
          <FancyButton intent="basic">Basic</FancyButton>
          <FancyButton intent="primary">Primary</FancyButton>
          <FancyButton intent="destructive">Destructive</FancyButton>
        </>
      ),
      code: `import { FancyButton } from '@open-mercato/ui/primitives/fancy-button'

<FancyButton intent="neutral">Neutral</FancyButton>
<FancyButton intent="basic">Basic</FancyButton>
<FancyButton intent="primary">Primary</FancyButton>
<FancyButton intent="destructive">Destructive</FancyButton>`,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      render: () => (
        <>
          <FancyButton size="default">Default</FancyButton>
          <FancyButton size="sm">Small</FancyButton>
          <FancyButton size="xs">X-Small</FancyButton>
        </>
      ),
      code: `import { FancyButton } from '@open-mercato/ui/primitives/fancy-button'

<FancyButton size="default">Default</FancyButton>
<FancyButton size="sm">Small</FancyButton>
<FancyButton size="xs">X-Small</FancyButton>`,
    },
  ],
}

const buttonGroupEntry: GalleryEntry = {
  id: 'button-group',
  title: 'ButtonGroup',
  importPath: '@open-mercato/ui/primitives/button-group',
  descriptionKey: 'design_system.entries.buttonGroup.description',
  variants: [
    {
      id: 'horizontal',
      title: 'Horizontal',
      render: () => (
        <ButtonGroup>
          <Button variant="outline">Save</Button>
          <Button variant="outline">Save &amp; New</Button>
          <IconButton aria-label="More">
            <MoreHorizontal />
          </IconButton>
        </ButtonGroup>
      ),
      code: `import { MoreHorizontal } from 'lucide-react'
import { ButtonGroup } from '@open-mercato/ui/primitives/button-group'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'

<ButtonGroup>
  <Button variant="outline">Save</Button>
  <Button variant="outline">Save & New</Button>
  <IconButton aria-label="More"><MoreHorizontal /></IconButton>
</ButtonGroup>`,
    },
    {
      id: 'vertical',
      title: 'Vertical',
      render: () => (
        <ButtonGroup orientation="vertical" size="sm">
          <Button variant="outline" size="sm">Top</Button>
          <Button variant="outline" size="sm">Middle</Button>
          <Button variant="outline" size="sm">Bottom</Button>
        </ButtonGroup>
      ),
      code: `import { ButtonGroup } from '@open-mercato/ui/primitives/button-group'
import { Button } from '@open-mercato/ui/primitives/button'

<ButtonGroup orientation="vertical" size="sm">
  <Button variant="outline" size="sm">Top</Button>
  <Button variant="outline" size="sm">Middle</Button>
  <Button variant="outline" size="sm">Bottom</Button>
</ButtonGroup>`,
    },
  ],
}

export const entries: GalleryEntry[] = [
  buttonEntry,
  iconButtonEntry,
  linkButtonEntry,
  socialButtonEntry,
  fancyButtonEntry,
  buttonGroupEntry,
]
