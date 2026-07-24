import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LUCIDE_ICON_REGISTRY } from '@open-mercato/ui/backend/icons/lucideRegistry'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '@open-mercato/ui/primitives/popover'
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

// Clicking a tile opens an explicit two-option menu instead of a hidden
// copy-mode: each option shows exactly what will land in the clipboard.
function IconTile({ name }: { name: string }) {
  const t = useT()
  const Icon = LUCIDE_ICON_REGISTRY[name]
  const jsxSnippet = `<${pascalCase(name)} aria-hidden className="size-4" />`

  const copy = React.useCallback(async (payload: string) => {
    try {
      await navigator.clipboard.writeText(payload)
      flash(t('design_system.gallery.iconCopied', 'Copied: {snippet}', { snippet: payload }), 'success')
    } catch {
      flash(t('design_system.gallery.copyFailed', 'Could not copy the snippet'), 'error')
    }
  }, [t])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex flex-col items-center gap-1.5 rounded-md border border-transparent p-2 transition-colors hover:border-border hover:bg-muted/40"
        >
          <Icon aria-hidden className="size-5 text-foreground" strokeWidth={1.75} />
          <code className="max-w-full truncate text-[10px] leading-tight text-muted-foreground">{name}</code>
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-auto max-w-xs p-2">
        <div className="space-y-1">
          <PopoverClose asChild>
            <button
              type="button"
              onClick={() => copy(name)}
              className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
            >
              <span className="text-xs font-medium text-foreground">
                {t('design_system.gallery.iconCopyMeta', 'Copy name for page.meta icon')}
              </span>
              <code className="text-[11px] text-muted-foreground">{name}</code>
            </button>
          </PopoverClose>
          <PopoverClose asChild>
            <button
              type="button"
              onClick={() => copy(jsxSnippet)}
              className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
            >
              <span className="text-xs font-medium text-foreground">
                {t('design_system.gallery.iconCopyJsx', 'Copy JSX (lucide-react)')}
              </span>
              <code className="max-w-full truncate text-[11px] text-muted-foreground">{jsxSnippet}</code>
            </button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function IconGrid() {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const names = React.useMemo(() => Object.keys(LUCIDE_ICON_REGISTRY).sort((a, b) => a.localeCompare(b)), [])
  const needle = query.trim().toLowerCase()
  const visible = needle ? names.filter((name) => name.toLowerCase().includes(needle)) : names

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="max-w-sm flex-1">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t('design_system.gallery.iconSearchPlaceholder', 'Filter icons…')}
            aria-label={t('design_system.gallery.iconSearchPlaceholder', 'Filter icons…')}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {needle
            ? t('design_system.gallery.iconCountFiltered', '{visible} of {total} icons', {
                visible: visible.length,
                total: names.length,
              })
            : t('design_system.gallery.iconCountAll', '{total} icons', { total: names.length })}
        </p>
      </div>
      <div className="grid grid-cols-4 gap-1 sm:grid-cols-6 lg:grid-cols-8">
        {visible.map((name) => (
          <IconTile key={name} name={name} />
        ))}
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
