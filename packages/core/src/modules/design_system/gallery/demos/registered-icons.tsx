import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LUCIDE_ICON_REGISTRY } from '@open-mercato/ui/backend/icons/lucideRegistry'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { Button } from '@open-mercato/ui/primitives/button'
import { Pagination } from '@open-mercato/ui/primitives/pagination'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

function pascalCase(registryName: string): string {
  return registryName
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

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
        <Button
          type="button"
          variant="ghost"
          className="h-auto min-h-28 min-w-0 flex-col gap-3 whitespace-normal rounded-lg border border-border bg-background p-3"
        >
          <Icon aria-hidden className="size-7 text-foreground" strokeWidth={1.75} />
          <code className="max-w-full break-words text-xs leading-4 text-muted-foreground">{name}</code>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-auto max-w-xs p-2">
        <div className="space-y-1">
          <PopoverClose asChild>
            <Button
              type="button"
              variant="ghost"
              onClick={() => copy(name)}
              className="h-auto w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:shadow-focus"
            >
              <span className="text-xs font-medium text-foreground">
                {t('design_system.gallery.iconCopyMeta', 'Copy name for page.meta icon')}
              </span>
              <code className="text-xs text-muted-foreground">{name}</code>
            </Button>
          </PopoverClose>
          <PopoverClose asChild>
            <Button
              type="button"
              variant="ghost"
              onClick={() => copy(jsxSnippet)}
              className="h-auto w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:shadow-focus"
            >
              <span className="text-xs font-medium text-foreground">
                {t('design_system.gallery.iconCopyJsx', 'Copy JSX (lucide-react)')}
              </span>
              <code className="max-w-full truncate text-xs text-muted-foreground">{jsxSnippet}</code>
            </Button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function IconGrid({ collectionControl }: { collectionControl?: React.ReactNode } = {}) {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const names = React.useMemo(() => Object.keys(LUCIDE_ICON_REGISTRY).sort((a, b) => a.localeCompare(b)), [])
  const [page, setPage] = React.useState(1)
  const needle = query.trim().toLowerCase()
  const filtered = needle ? names.filter((name) => name.toLowerCase().includes(needle)) : names
  const visible = filtered.slice((page - 1) * 48, page * 48)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {collectionControl}
        <div className="max-w-sm flex-1">
          <SearchInput
            value={query}
            onChange={value => { setQuery(value); setPage(1) }}
            placeholder={t('design_system.gallery.iconSearchPlaceholder', 'Filter icons…')}
            aria-label={t('design_system.gallery.iconSearchPlaceholder', 'Filter icons…')}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {needle
            ? t('design_system.gallery.iconCountFiltered', '{visible} of {total} icons', {
                visible: filtered.length,
                total: names.length,
              })
            : t('design_system.gallery.iconCountAll', '{total} icons', { total: names.length })}
        </p>
      </div>
      {visible.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {visible.map((name) => (
          <IconTile key={name} name={name} />
        ))}
      </div> : <EmptyState title={t('design_system.gallery.noResults')} />}
      {filtered.length > 48 ? <Pagination page={page} pageSize={48} total={filtered.length} showPageSize={false} onPageChange={setPage} aria-label={t('design_system.gallery.sourceIcons.pages')} /> : null}
    </div>
  )
}

