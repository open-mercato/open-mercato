import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LUCIDE_ICON_REGISTRY } from '@open-mercato/ui/backend/icons/lucideRegistry'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { GalleryEntry } from '../types'

// Mirrors the DS Figma icon sheet (node 2716:25504, "Lucide icons"): a plain
// grid of outline icons with the name beneath each. The gallery shows the
// icons REGISTERED in the string-icon registry — the set page.meta.ts `icon`
// accepts; components import from lucide-react directly.

const FIGMA_ICONS_NODE = '2716:25504'

function pascalCase(registryName: string): string {
  return registryName
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

type IconCopyMode = 'meta' | 'jsx'

function IconGrid() {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const [copyMode, setCopyMode] = React.useState<IconCopyMode>('meta')
  const names = React.useMemo(() => Object.keys(LUCIDE_ICON_REGISTRY).sort((a, b) => (a < b ? -1 : 1)), [])
  const needle = query.trim().toLowerCase()
  const visible = needle ? names.filter((name) => name.toLowerCase().includes(needle)) : names

  const copyName = React.useCallback(async (name: string) => {
    const payload = copyMode === 'meta'
      ? name
      : `<${pascalCase(name)} aria-hidden className="size-4" />`
    try {
      await navigator.clipboard.writeText(payload)
      flash(
        copyMode === 'meta'
          ? t('design_system.gallery.iconCopiedMeta', 'Copied page.meta icon name: "{name}"', { name })
          : t('design_system.gallery.iconCopiedJsx', 'Copied JSX (import {component} from lucide-react)', { component: pascalCase(name) }),
        'success',
      )
    } catch {
      flash(t('design_system.gallery.copyFailed', 'Could not copy the snippet'), 'error')
    }
  }, [copyMode, t])

  return (
    <div className="space-y-4">
      <div className="max-w-sm">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t('design_system.gallery.iconSearchPlaceholder', 'Filter icons…')}
          aria-label={t('design_system.gallery.iconSearchPlaceholder', 'Filter icons…')}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          aria-label={t('design_system.gallery.iconCopyMode', 'What clicking an icon copies')}
          value={copyMode}
          onValueChange={(value) => setCopyMode(value as IconCopyMode)}
        >
          <SegmentedControlItem value="meta">
            {t('design_system.gallery.iconCopyMeta', 'page.meta name')}
          </SegmentedControlItem>
          <SegmentedControlItem value="jsx">
            {t('design_system.gallery.iconCopyJsx', 'JSX')}
          </SegmentedControlItem>
        </SegmentedControl>
        <p className="text-xs text-muted-foreground">
          {visible.length} / {names.length}
        </p>
      </div>
      <div className="grid grid-cols-4 gap-1 sm:grid-cols-6 lg:grid-cols-8">
        {visible.map((name) => {
          const Icon = LUCIDE_ICON_REGISTRY[name]
          return (
            <button
              key={name}
              type="button"
              onClick={() => copyName(name)}
              title={`Copy "${name}"`}
              className="flex flex-col items-center gap-1.5 rounded-md border border-transparent p-2 transition-colors hover:border-border hover:bg-muted/40"
            >
              <Icon aria-hidden className="size-5 text-foreground" strokeWidth={1.75} />
              <code className="max-w-full truncate text-[10px] leading-tight text-muted-foreground">{name}</code>
            </button>
          )
        })}
      </div>
    </div>
  )
}

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

export const entries: GalleryEntry[] = [iconRegistryEntry]
