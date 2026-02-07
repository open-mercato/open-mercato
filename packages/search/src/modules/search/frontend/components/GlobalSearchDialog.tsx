'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  Search,
  Loader2,
  Zap,
  User,
  Users,
  Building,
  StickyNote,
  Briefcase,
  CheckSquare,
  FileText,
  Mail,
  Phone,
  Calendar,
  Clock,
  Star,
  Tag,
  Flag,
  Heart,
  Bookmark,
  Package,
  Truck,
  ShoppingCart,
  CreditCard,
  DollarSign,
  Target,
  Award,
  Trophy,
  Rocket,
  Lightbulb,
  MessageSquare,
  Bell,
  Settings,
  Globe,
  MapPin,
  Link,
  Folder,
  Database,
  Activity,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Button } from '@open-mercato/ui/primitives/button'
import { cn } from '@open-mercato/shared/lib/utils'
import type { SearchResult, SearchResultLink, SearchStrategyId } from '@open-mercato/shared/modules/search'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { fetchGlobalSearchResults } from '../utils'

const MIN_QUERY_LENGTH = 2

/** Default strategies used when none are configured */
const DEFAULT_STRATEGIES: SearchStrategyId[] = ['fulltext', 'vector', 'tokens']

function normalizeLinks(links?: SearchResultLink[] | null): SearchResultLink[] {
  if (!Array.isArray(links)) return []
  return links.filter((link) => typeof link?.href === 'string')
}

function pickPrimaryLink(result: SearchResult): string | null {
  if (result.url) return result.url
  const links = normalizeLinks(result.links)
  if (!links.length) return null
  const primary = links.find((link) => link.kind === 'primary')
  return (primary ?? links[0]).href
}

function humanizeSegment(segment: string): string {
  return segment
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

const ICON_MAP: Record<string, LucideIcon> = {
  bolt: Zap,
  zap: Zap,
  user: User,
  users: Users,
  building: Building,
  'sticky-note': StickyNote,
  briefcase: Briefcase,
  'check-square': CheckSquare,
  'file-text': FileText,
  mail: Mail,
  phone: Phone,
  calendar: Calendar,
  clock: Clock,
  star: Star,
  tag: Tag,
  flag: Flag,
  heart: Heart,
  bookmark: Bookmark,
  package: Package,
  truck: Truck,
  'shopping-cart': ShoppingCart,
  'credit-card': CreditCard,
  'dollar-sign': DollarSign,
  target: Target,
  award: Award,
  trophy: Trophy,
  rocket: Rocket,
  lightbulb: Lightbulb,
  'message-square': MessageSquare,
  bell: Bell,
  settings: Settings,
  globe: Globe,
  'map-pin': MapPin,
  link: Link,
  folder: Folder,
  database: Database,
  activity: Activity,
}

function resolveIcon(name?: string): LucideIcon | null {
  if (!name) return null
  return ICON_MAP[name.toLowerCase()] ?? null
}

function formatEntityId(entityId: string): string {
  if (!entityId.includes(':')) return humanizeSegment(entityId)
  const [module, entity] = entityId.split(':')
  return `${humanizeSegment(module)} · ${humanizeSegment(entity)}`
}

export type GlobalSearchDialogProps = {
  /** Whether embedding provider is configured for vector search */
  embeddingConfigured: boolean
  /** Message to show when embedding is not configured */
  missingConfigMessage: string
  /** Enabled strategies from tenant configuration (optional - uses defaults if not provided) */
  enabledStrategies?: SearchStrategyId[]
}

export function GlobalSearchDialog({
  embeddingConfigured,
  missingConfigMessage,
  enabledStrategies: propStrategies,
}: GlobalSearchDialogProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<SearchResult[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)
  const t = useT()

  // Use configured strategies or fall back to defaults
  const enabledStrategies = React.useMemo(() => {
    if (propStrategies && propStrategies.length > 0) {
      return propStrategies
    }
    return DEFAULT_STRATEGIES
  }, [propStrategies])

  const resetState = React.useCallback(() => {
    setQuery('')
    setResults([])
    setError(null)
    setSelectedIndex(0)
    setLoading(false)
  }, [])

  React.useEffect(() => {
    if (!open) {
      resetState()
      return
    }
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, resetState])

  React.useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])

  React.useEffect(() => {
    if (!open) return
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(focusTimer)
  }, [open])

  React.useEffect(() => {
    if (!open) return

    abortRef.current?.abort()
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setResults([])
      setError(null)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)

    const handle = setTimeout(async () => {
      try {
        const data = await fetchGlobalSearchResults(query, {
          limit: 10,
          signal: controller.signal,
        })
        setResults(data.results)
        setError(data.error ?? null)
        setSelectedIndex(0)
      } catch (err: unknown) {
        if (controller.signal.aborted) return
        const abortError = err as { name?: string }
        if (abortError?.name === 'AbortError') return
        setError(err instanceof Error ? err.message : t('search.dialog.errors.searchFailed'))
        setResults([])
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 220)

    return () => {
      clearTimeout(handle)
      controller.abort()
    }
  }, [open, query, enabledStrategies, t])

  const openResult = React.useCallback((result: SearchResult | undefined) => {
    if (!result) return
    const href = pickPrimaryLink(result)
    if (!href) return
    router.push(href)
    setOpen(false)
  }, [router])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      openResult(results[selectedIndex])
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % Math.max(results.length || 1, 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((prev) => {
        if (!results.length) return 0
        return prev <= 0 ? results.length - 1 : prev - 1
      })
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const target = results[selectedIndex]
      openResult(target)
      return
    }
  }, [results, selectedIndex, openResult])

  // Check if vector search is enabled but not configured
  const showVectorWarning = !embeddingConfigured && enabledStrategies.includes('vector') && !error

  // Check if selected result has a navigable link
  const selectedResult = results[selectedIndex]
  const selectedHasLink = selectedResult ? pickPrimaryLink(selectedResult) !== null : false

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)} className="hidden sm:inline-flex items-center gap-2">
        <Search className="h-4 w-4" />
        <span>{t('search.dialog.actions.search')}</span>
        <span className="ml-2 rounded border px-1 text-xs text-muted-foreground">⌘K</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="sm:hidden"
        onClick={() => setOpen(true)}
        aria-label={t('search.dialog.actions.openGlobalSearch')}
      >
        <Search className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl p-0" aria-describedby="global-search-description">
          <DialogTitle className="sr-only">
            {t('search.dialog.title', 'Global Search')}
          </DialogTitle>
          <span id="global-search-description" className="sr-only">
            {t('search.dialog.instructions')}
          </span>
          <div className="flex flex-col gap-3 border-b px-4 pb-3 pt-12">
            <div className="flex items-center gap-2 rounded border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
              <Search className="h-4 w-4 text-muted-foreground" />
              <TypedInput
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('search.dialog.input.placeholder')}
                className="border-none px-0 shadow-none focus-visible:ring-0"
                autoFocus
              />
              {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>

            {error ? (
              <p className="rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
            ) : null}
            {showVectorWarning ? (
              <p className="rounded bg-amber-100 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">{missingConfigMessage}</p>
            ) : null}
          </div>
          <div className="max-h-96 overflow-y-auto px-2 pb-3">
            {results.length === 0 && !loading && !error ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                {query.trim().length < MIN_QUERY_LENGTH
                  ? t('search.dialog.empty.hint')
                  : t('search.dialog.empty.none')}
              </div>
            ) : null}
            <ul className="flex flex-col">
              {results.map((result, index) => {
                const presenter = result.presenter
                const isActive = index === selectedIndex
                const hasLink = pickPrimaryLink(result) !== null
                const Icon = presenter?.icon ? resolveIcon(presenter.icon) : null
                return (
                  <li key={`${result.entityId}:${result.recordId}`}>
                    <button
                      type="button"
                      onClick={() => openResult(result)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={cn(
                        'w-full rounded-lg px-4 py-3 text-left transition border',
                        isActive
                          ? 'border-primary bg-primary/10 text-foreground shadow-sm'
                          : 'border-transparent hover:border-muted-foreground/30 hover:bg-muted/60',
                        !hasLink && 'opacity-60'
                      )}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn('font-medium text-base whitespace-normal break-all', !hasLink && 'text-muted-foreground')}>{presenter?.title ?? result.recordId}</span>
                            <span className="rounded-full border border-muted-foreground/30 px-2 py-0.5 text-xs text-muted-foreground">
                              {formatEntityId(result.entityId)}
                            </span>
                            {!hasLink && (
                              <span className="rounded-full border border-amber-500/50 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
                                {t('search.dialog.noLink')}
                              </span>
                            )}
                          </div>
                          {presenter?.subtitle ? (
                            <div className="text-sm text-muted-foreground whitespace-normal break-words">{presenter.subtitle}</div>
                          ) : null}
                          {normalizeLinks(result.links).length ? (
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              {normalizeLinks(result.links).map((link) => (
                                <span
                                  key={`${link.href}`}
                                  className={cn(
                                    'rounded-full border px-2 py-0.5 text-xs',
                                    link.kind === 'primary'
                                      ? 'border-primary text-primary'
                                      : 'border-muted-foreground/40 text-muted-foreground'
                                  )}
                                >
                                  {link.label ?? link.href}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        {Icon ? (
                          <div className="flex flex-col items-end gap-2">
                            <Icon className="h-5 w-5 text-muted-foreground" />
                          </div>
                        ) : null}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
          <div className="flex items-center justify-between border-t px-4 py-3">
            <span className="text-xs text-muted-foreground">
              {selectedResult && !selectedHasLink
                ? t('search.dialog.noLinkHint')
                : t('search.dialog.shortcuts.hint')}
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                {t('search.dialog.actions.cancel')}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => openResult(results[selectedIndex])}
                disabled={!results.length || !selectedHasLink}
              >
                {t('search.dialog.actions.openSelected')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default GlobalSearchDialog
const TypedInput = Input as React.ForwardRefExoticComponent<React.InputHTMLAttributes<HTMLInputElement> & React.RefAttributes<HTMLInputElement>>
