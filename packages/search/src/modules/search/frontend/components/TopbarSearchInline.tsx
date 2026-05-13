'use client'

import * as React from 'react'
import NextLink from 'next/link'
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
  Link as LinkIcon,
  Folder,
  Database,
  Activity,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import type { SearchResult, SearchResultLink } from '@open-mercato/shared/modules/search'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  getCurrentOrganizationScope,
  subscribeOrganizationScopeChanged,
} from '@open-mercato/shared/lib/frontend/organizationEvents'
import { isAllOrganizationsSelection } from '@open-mercato/core/modules/directory/constants'
import { parseSelectedOrganizationCookie } from '@open-mercato/core/modules/directory/utils/scopeCookies'
import { ForbiddenError } from '@open-mercato/ui/backend/utils/api'
import { resolveSearchMinTokenLength } from '@open-mercato/shared/lib/search/config'
import { fetchGlobalSearchResults } from '../utils'

const MIN_QUERY_LENGTH = resolveSearchMinTokenLength()

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

function hasActiveOrganizationSelection(): boolean {
  const fromEvent = getCurrentOrganizationScope().organizationId
  if (typeof fromEvent === 'string' && fromEvent.trim().length > 0) return true
  const cookieHeader = typeof document === 'undefined' ? null : document.cookie
  const cookieValue = parseSelectedOrganizationCookie(cookieHeader)
  if (!cookieValue) return false
  return !isAllOrganizationsSelection(cookieValue)
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
  link: LinkIcon,
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

export type TopbarSearchInlineProps = {
  /** Whether embedding provider is configured for vector search */
  embeddingConfigured: boolean
  /** Warning text to show when vector search is enabled but not configured */
  missingConfigMessage: string
}

export function TopbarSearchInline({
  embeddingConfigured,
  missingConfigMessage,
}: TopbarSearchInlineProps) {
  const router = useRouter()
  const t = useT()
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<SearchResult[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const [showScopeHint, setShowScopeHint] = React.useState<boolean>(() => hasActiveOrganizationSelection())
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const popoverRef = React.useRef<HTMLDivElement | null>(null)
  const containerRef = React.useRef<HTMLElement | null>(null)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)

  const expandAndFocus = React.useCallback(() => {
    setExpanded(true)
    // Wait one tick so the input is mounted/transitioned before focusing
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  const collapseAndReset = React.useCallback(() => {
    setOpen(false)
    setExpanded(false)
    setQuery('')
    inputRef.current?.blur()
  }, [])

  React.useEffect(() => {
    setShowScopeHint(hasActiveOrganizationSelection())
    return subscribeOrganizationScopeChanged((detail) => {
      setShowScopeHint(Boolean(detail.organizationId && detail.organizationId.trim().length > 0))
    })
  }, [])

  // Cmd/Ctrl+K expands + focuses the input
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        expandAndFocus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [expandAndFocus])

  // Click outside closes the popover AND collapses input (unless user has typed something)
  React.useEffect(() => {
    if (!expanded) return
    const handler = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (containerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      collapseAndReset()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [expanded, collapseAndReset])

  // Fetch results on query change (debounced)
  React.useEffect(() => {
    abortRef.current?.abort()
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
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
        if (err instanceof ForbiddenError) {
          setError(t('search.dialog.errors.noPermission'))
        } else {
          setError(err instanceof Error ? err.message : t('search.dialog.errors.searchFailed'))
        }
        setResults([])
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 220)

    return () => {
      clearTimeout(handle)
      controller.abort()
    }
  }, [query, t])

  // Auto-scroll active item into view
  React.useEffect(() => {
    const container = listRef.current
    const active = container?.querySelector<HTMLElement>('[data-active="true"]')
    if (!container || !active) return
    const { top: containerTop, bottom: containerBottom } = container.getBoundingClientRect()
    const { top: activeTop, bottom: activeBottom } = active.getBoundingClientRect()
    if (activeTop < containerTop) {
      container.scrollTop -= containerTop - activeTop
    } else if (activeBottom > containerBottom) {
      container.scrollTop += activeBottom - containerBottom
    }
  }, [selectedIndex])

  const openResult = React.useCallback(
    (result: SearchResult | undefined) => {
      if (!result) return
      const href = pickPrimaryLink(result)
      if (!href) return
      router.push(href)
      collapseAndReset()
    },
    [router, collapseAndReset],
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (!open) setOpen(true)
        setSelectedIndex((prev) => (results.length ? (prev + 1) % results.length : 0))
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
        if (open) {
          setOpen(false)
        } else if (query) {
          setQuery('')
        } else {
          collapseAndReset()
        }
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const target = results[selectedIndex]
        openResult(target)
        return
      }
    },
    [open, query, results, selectedIndex, openResult, collapseAndReset],
  )

  const showVectorWarning = !embeddingConfigured && !error
  const trimmed = query.trim()
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH
  const showPopover =
    open && (loading || results.length > 0 || error !== null || tooShort || showVectorWarning)
  const showClear = query.length > 0

  if (!expanded) {
    return (
      <button
        ref={(el) => {
          containerRef.current = el
        }}
        type="button"
        onClick={expandAndFocus}
        aria-label={t('search.dialog.actions.openGlobalSearch', 'Open global search')}
        title={t('search.dialog.actions.openGlobalSearch', 'Open global search')}
        className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:shadow-focus"
      >
        <Search className="size-4" aria-hidden="true" />
      </button>
    )
  }

  return (
    <div
      ref={(el) => {
        containerRef.current = el
      }}
      data-search-expanded="true"
      className="relative min-w-0 sm:w-[260px] md:w-[320px] max-sm:absolute max-sm:inset-x-3 max-sm:top-1/2 max-sm:-translate-y-1/2 max-sm:z-popover"
    >
      <div
        className={cn(
          'flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-xs transition-colors hover:bg-muted/40',
          open ? 'border-foreground bg-background shadow-focus' : '',
        )}
        onClick={() => inputRef.current?.focus()}
      >
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={t('search.dialog.actions.search', 'Search')}
          aria-label={t('search.dialog.actions.openGlobalSearch', 'Search')}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="topbar-search-results"
          className="flex-1 min-w-0 bg-transparent placeholder:text-muted-foreground/70 focus:outline-none"
          // Inline search; no need for native browser autocomplete or autocapitalize
          autoComplete="off"
          spellCheck={false}
        />
        {loading ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : showClear ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setQuery('')
              inputRef.current?.focus()
            }}
            className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('search.dialog.actions.clear', 'Clear search')}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        ) : (
          <kbd className="hidden md:inline-flex shrink-0 items-center rounded border bg-muted/50 px-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            ⌘K
          </kbd>
        )}
      </div>

      {showPopover ? (
        <div
          ref={popoverRef}
          id="topbar-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-popover min-w-[320px] rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          {error ? (
            <p className="border-b px-3 py-2 text-sm text-destructive">{error}</p>
          ) : null}
          {showVectorWarning && !error ? (
            <div className="border-b bg-status-warning-bg px-3 py-2 text-xs text-status-warning-text">
              <p>{missingConfigMessage}</p>
              <NextLink
                href="/backend/config/search"
                onClick={() => collapseAndReset()}
                className="mt-1 inline-flex items-center font-medium underline underline-offset-2 hover:no-underline"
              >
                {t('search.dialog.warnings.configureLink', 'Configure search settings')}
              </NextLink>
            </div>
          ) : null}
          {showScopeHint ? (
            <p className="border-b px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('search.scopeHint.currentOrg', 'Scoped to current organization')}
            </p>
          ) : null}

          {tooShort && !error ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">
              {t('search.dialog.empty.hint', { count: MIN_QUERY_LENGTH })}
            </div>
          ) : null}

          {!tooShort && results.length === 0 && !loading && !error ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">
              {t('search.dialog.empty.none', 'No results')}
            </div>
          ) : null}

          {results.length > 0 ? (
            <div ref={listRef} className="max-h-[380px] overflow-y-auto p-1">
              {results.map((result, index) => {
                const presenter = result.presenter
                const isActive = index === selectedIndex
                const hasLink = pickPrimaryLink(result) !== null
                const Icon = presenter?.icon ? resolveIcon(presenter.icon) : null
                return (
                  <button
                    key={`${result.entityId}:${result.recordId}`}
                    type="button"
                    data-active={isActive}
                    onClick={() => openResult(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    role="option"
                    aria-selected={isActive}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-sm px-2 py-2 text-left transition-colors',
                      isActive ? 'bg-muted' : 'hover:bg-muted/60',
                      !hasLink && 'opacity-60',
                    )}
                  >
                    {Icon ? (
                      <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border bg-background">
                        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                      </span>
                    ) : (
                      <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border bg-background">
                        <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
                      </span>
                    )}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            'truncate text-sm font-medium',
                            !hasLink ? 'text-muted-foreground' : 'text-foreground',
                          )}
                        >
                          {presenter?.title ?? result.recordId}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate">{formatEntityId(result.entityId)}</span>
                        {presenter?.subtitle ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{presenter.subtitle}</span>
                          </>
                        ) : null}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default TopbarSearchInline
