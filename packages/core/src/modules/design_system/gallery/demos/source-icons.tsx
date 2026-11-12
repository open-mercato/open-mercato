import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SourceIcon, sourceIconNames, type SourceIconName } from '@open-mercato/ui/assets/source-icons'
import { Button } from '@open-mercato/ui/primitives/button'
import { Pagination } from '@open-mercato/ui/primitives/pagination'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'

const pageSize = 48

function SourceIconTile({ name }: { name: SourceIconName }) {
  const t = useT()
  const [notice, setNotice] = React.useState('')
  const code = `import { SourceIcon } from '@open-mercato/ui/assets/source-icons'\n\n<SourceIcon name="${name}" aria-hidden="true" className="size-6" />`
  async function copy() {
    try { await navigator.clipboard.writeText(code); setNotice(t('design_system.gallery.sourceIcons.copied')) }
    catch { setNotice(t('design_system.gallery.copyFailed')) }
  }
  return <Popover onOpenChange={() => setNotice('')}>
    <PopoverTrigger asChild>
      <Button type="button" variant="ghost" aria-label={name} className="h-auto min-h-28 min-w-0 flex-col gap-3 whitespace-normal rounded-lg border border-border bg-background p-3">
        <SourceIcon name={name} aria-hidden="true" className="size-7" />
        <span className="max-w-full break-words text-center text-xs font-normal leading-4 text-muted-foreground">{name}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-72 space-y-4 p-4" aria-label={name}>
      <div className="flex h-24 items-center justify-center rounded-md bg-muted"><SourceIcon name={name} aria-hidden="true" className="size-10" /></div>
      <p className="break-words font-medium">{name}</p>
      <Button type="button" variant="outline" size="sm" onClick={copy}>{t('design_system.gallery.sourceIcons.copy')}</Button>
      {notice ? <p role="status" className="text-xs text-muted-foreground">{notice}</p> : null}
    </PopoverContent>
  </Popover>
}

export function SourceIconCatalogue({ collectionControl }: { collectionControl?: React.ReactNode } = {}) {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const [page, setPage] = React.useState(1)
  const filtered = sourceIconNames.filter(name => name.includes(query.trim().toLowerCase()))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)
  return <div className="w-full min-w-0 space-y-5" data-example="source-icon-catalogue">
    <div className="flex flex-wrap items-center gap-4">
      {collectionControl}
      <SearchInput value={query} onChange={value => { setQuery(value); setPage(1) }} aria-label={t('design_system.gallery.iconSearchPlaceholder')} placeholder={t('design_system.gallery.iconSearchPlaceholder')} className="w-80 max-w-full" />
      <p className="text-sm text-muted-foreground" role="status">{t('design_system.gallery.iconCountFiltered', { visible: filtered.length, total: sourceIconNames.length })}</p>
    </div>
    {visible.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      {visible.map(name => <SourceIconTile key={name} name={name} />)}
    </div> : <EmptyState title={t('design_system.gallery.noResults')} />}
    {filtered.length > pageSize ? <Pagination page={page} pageSize={pageSize} total={filtered.length} showPageSize={false} onPageChange={setPage} aria-label={t('design_system.gallery.sourceIcons.pages')} /> : null}
  </div>
}

export const sourceIconCatalogueCode = `import { SourceIcon, sourceIconNames } from '@open-mercato/ui/assets/source-icons'

<div className="grid grid-cols-4 gap-4">
  {sourceIconNames.map(name => <div key={name} className="flex items-center gap-2">
    <SourceIcon name={name} aria-hidden="true" />
    <span>{name}</span>
  </div>)}
</div>`
