import * as React from 'react'
import { SourceIconCatalogue, sourceIconCatalogueCode } from '../demos/source-icons'
import { SourceArtworkCatalogue, sourceArtworkCode } from '../demos/source-artwork'
import { IconGrid } from '../demos/registered-icons'
import { LUCIDE_ICON_REGISTRY } from '@open-mercato/ui/backend/icons/lucideRegistry'
import type { GalleryEntry } from '../types'

const FIGMA_ICONS_NODE = '2716:25504'

const iconRegistryEntry: GalleryEntry = {
  id: 'icon-registry',
  title: 'Icon registry',
  importPath: 'lucide-react',
  usage: {
    do: [
      'size-4 inside buttons, menus and inline text; size-5 in section navs and toolbars.',
      'Always aria-hidden next to a visible label, or aria-label on icon-only controls.',
      'Color with semantic tokens only (text-muted-foreground, text-status-*-icon).',
      'Icon-only actions use IconButton — it ships the focus ring, sizing and the aria-label contract.',
    ],
    dont: [
      'No emoji or font glyphs as icons — Lucide only.',
      'Never convey status by icon color alone; pair with text or a label.',
      'No hand-drawn SVGs when a Lucide icon exists.',
    ],
  },
  figmaNodeId: FIGMA_ICONS_NODE,
  variants: [
    {
      id: 'registry',
      title: 'registered icons',
      render: () => <IconGrid />,
      code: `export const metadata = { icon: 'shapes' }`,
    },
    {
      id: 'component-usage',
      title: 'usage in components',
      render: () => {
        const Sample = LUCIDE_ICON_REGISTRY.search ?? Object.values(LUCIDE_ICON_REGISTRY)[0]
        return (
          <div className="flex items-center gap-4">
            <Sample aria-hidden className="size-4 text-muted-foreground" />
            <Sample aria-hidden className="size-5 text-foreground" />
            <Sample aria-hidden className="size-6 text-status-info-icon" />
          </div>
        )
      },
      code: `import { Search } from 'lucide-react'

<Search aria-hidden className="size-4 text-muted-foreground" />`,
    },
  ],
}

const sourceIconsEntry: GalleryEntry = {
  id: 'source-icons',
  title: 'Source icon library',
  importPath: '@open-mercato/ui/assets/source-icons',
  figmaNodeId: '199678:19375',
  descriptionKey: 'design_system.entries.sourceIcons.description',
  variants: [
    { id: 'catalogue', title: 'All 1667 source icons / search and copy', render: () => <SourceIconCatalogue />, code: sourceIconCatalogueCode },
  ],
}

const sourceArtworkEntry: GalleryEntry = {
  id: 'source-artwork',
  title: 'Source artwork library',
  importPath: '@open-mercato/ui/assets/source-artwork',
  figmaNodeId: '2771:1469',
  descriptionKey: 'design_system.gallery.sourceArtwork.description',
  variants: [
    { id: 'brands', title: 'Brands / 439 original logos and styles', render: () => <SourceArtworkCatalogue group="brand" />, code: sourceArtworkCode('brand') },
    { id: 'flags', title: 'Country flags / 263 original assets', render: () => <SourceArtworkCatalogue group="country-flags" />, code: sourceArtworkCode('country-flags') },
    { id: 'emoji', title: 'Emoji / 607 original assets', render: () => <SourceArtworkCatalogue group="emojies" />, code: sourceArtworkCode('emojies') },
    { id: 'store-badges', title: 'Store badges / 16 original variants', render: () => <SourceArtworkCatalogue group="appstore-badges" />, code: sourceArtworkCode('appstore-badges') },
    { id: 'thumbnails', title: 'Thumbnails / 78 component and landing illustrations', render: () => <SourceArtworkCatalogue group="thumbnails" />, code: sourceArtworkCode('thumbnails') },
    { id: 'cursors', title: 'Cursors / 10 original assets', render: () => <SourceArtworkCatalogue group="others" />, code: sourceArtworkCode('others') },
  ],
}

export const entries: GalleryEntry[] = [iconRegistryEntry, sourceIconsEntry, sourceArtworkEntry]
