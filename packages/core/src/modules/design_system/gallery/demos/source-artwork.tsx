import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { loadSourceArtwork, type SourceArtwork, type SourceArtworkGroup } from '@open-mercato/ui/assets/source-artwork'
import { Button } from '@open-mercato/ui/primitives/button'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { Pagination } from '@open-mercato/ui/primitives/pagination'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'

const pageSize = 48

function ArtworkTile({ asset, group, duplicate }: { asset: SourceArtwork; group: SourceArtworkGroup; duplicate: boolean }) {
  const t = useT()
  const [notice, setNotice] = React.useState('')
  const illustration = group === 'thumbnails'
  const name = illustration ? t(`design_system.gallery.thumbnailNames.${asset.name}`, asset.name) : asset.name
  const category = illustration ? t(`design_system.gallery.thumbnailCategories.${asset.category}`, asset.category) : asset.category
  const label = duplicate ? `${name} (${illustration ? category : asset.id})` : name
  async function copy() {
    const code = `import { loadSourceArtwork } from '@open-mercato/ui/assets/source-artwork'\n\nconst assets = await loadSourceArtwork('${group}')\nconst asset = assets.find(item => item.id === '${asset.id}')\n\n<img src={asset?.src} width={asset?.width} height={asset?.height} alt="" />`
    try { await navigator.clipboard.writeText(code); setNotice(t('design_system.gallery.sourceIcons.copied')) }
    catch { setNotice(t('design_system.gallery.copyFailed')) }
  }
  return <Popover onOpenChange={() => setNotice('')}>
    <PopoverTrigger asChild>
      <Button type="button" variant="ghost" data-source-node={asset.id} aria-label={label} className="h-auto min-h-36 min-w-0 flex-col gap-3 whitespace-normal rounded-lg border border-border bg-background p-3">
        <span className={cn("flex w-full items-center justify-center rounded-md bg-muted p-2", illustration ? "h-40" : "h-20")}><img src={asset.src} width={asset.width} height={asset.height} alt="" loading="lazy" className="max-h-full max-w-full object-contain drop-shadow-sm" /></span>
        <span className="max-w-full break-words text-center text-xs font-normal leading-4">{name}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent className={cn("space-y-4 p-4", illustration ? "w-80" : "w-72")} aria-label={label}>
      <div className={cn("flex items-center justify-center rounded-md bg-status-neutral-solid p-4", illustration ? "h-64" : "h-32")}><img src={asset.src} width={asset.width} height={asset.height} alt="" className="max-h-full max-w-full object-contain" /></div>
      <div><p className="break-words font-medium">{name}</p><p className="text-xs text-muted-foreground">{category} · {asset.width} × {asset.height}</p></div>
      <Button type="button" size="sm" variant="outline" onClick={copy}>{t('design_system.gallery.sourceIcons.copy')}</Button>
      {notice ? <p role="status" className="text-xs text-muted-foreground">{notice}</p> : null}
    </PopoverContent>
  </Popover>
}

export function SourceArtworkCatalogue({ group, collectionControl }: { group: SourceArtworkGroup; collectionControl?: React.ReactNode }) {
  const t = useT()
  const [assets, setAssets] = React.useState<readonly SourceArtwork[] | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [attempt, setAttempt] = React.useState(0)
  const [query, setQuery] = React.useState('')
  const [page, setPage] = React.useState(1)

  React.useEffect(() => {
    let active = true
    setAssets(null)
    setFailed(false)
    setPage(1)
    setQuery('')
    loadSourceArtwork(group).then(items => {
      if (active) setAssets(items)
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [group, attempt])

  if (failed) return <div className="space-y-5">{collectionControl}<ErrorMessage label={t('design_system.gallery.loadFailed')} action={<Button type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}>{t('design_system.gallery.retry')}</Button>} /></div>
  if (!assets) return <div className="space-y-5">{collectionControl}<LoadingMessage label={t('design_system.gallery.sourceArtwork.loading')} /></div>
  const needle = query.trim().toLowerCase()
  const nameCounts = new Map<string, number>()
  for (const asset of assets) nameCounts.set(asset.name, (nameCounts.get(asset.name) ?? 0) + 1)
  const filtered = assets.filter(asset => {
    const translated = group === 'thumbnails' ? `${t(`design_system.gallery.thumbnailNames.${asset.name}`, asset.name)} ${t(`design_system.gallery.thumbnailCategories.${asset.category}`, asset.category)}` : ''
    return `${asset.name} ${asset.category} ${translated}`.toLowerCase().includes(needle)
  })
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)

  return <div className="w-full min-w-0 space-y-5" data-example="source-artwork-catalogue" data-collection={group}>
    <div className="flex flex-wrap items-center gap-4">
      {collectionControl}
      <SearchInput value={query} onChange={value => { setQuery(value); setPage(1) }} className="w-80 max-w-full" aria-label={t('design_system.gallery.sourceArtwork.search')} placeholder={t('design_system.gallery.sourceArtwork.search')} />
      <p role="status" className="text-sm text-muted-foreground">{t('design_system.gallery.sourceArtwork.count', { visible: filtered.length, total: assets.length })}</p>
    </div>
    {visible.length ? <div className={cn("grid gap-3", group === "thumbnails" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5")}>
      {visible.map(asset => <ArtworkTile key={asset.id} asset={asset} group={group} duplicate={(nameCounts.get(asset.name) ?? 0) > 1} />)}
    </div> : <EmptyState title={t('design_system.gallery.noResults')} />}
    {filtered.length > pageSize ? <Pagination page={page} pageSize={pageSize} total={filtered.length} showPageSize={false} onPageChange={setPage} aria-label={t('design_system.gallery.sourceArtwork.pages')} /> : null}
  </div>
}

export function sourceArtworkCode(group: SourceArtworkGroup) {
  return `import { loadSourceArtwork } from '@open-mercato/ui/assets/source-artwork'\n\nconst artwork = await loadSourceArtwork('${group}')\n\n<div className="flex flex-wrap gap-4">\n  {artwork.slice(0, 24).map(asset => <img key={asset.id} src={asset.src} width={asset.width} height={asset.height} alt={asset.name} />)}\n</div>`
}
