'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { GalleryEntry } from '../../gallery/types'
import { loadGalleryEntryMap } from '../integrity'
import { copyFileSchema, copyOverridesFor, type MockupCopyFile } from '../copy'
import {
  collectLeaves,
  collectUserStories,
  mockupDocument,
  type MockupCounts,
  type MockupDocument,
  type MockupFindingsSummary,
} from '../schema'
import { MockupLedger } from './MockupLedger'
import { MockupStage, mockupBlockDomId, type CopyOverrideMap } from './MockupStage'

const MockupDiffView = React.lazy(() =>
  import('./MockupDiffView').then((mod) => ({ default: mod.MockupDiffView })),
)
const MockupStudio = React.lazy(() =>
  import('./MockupStudio').then((mod) => ({ default: mod.MockupStudio })),
)

/**
 * Loads a mockup document through the GET route, resolves its blocks against
 * the gallery registry, and renders the stage behind the Clean / Annotated
 * toolbar toggle. In dev an auto-refresh poll (2s) re-fetches the document so
 * a JSON edit lands on screen within one poll tick.
 *
 * Phase 2: `?compare=<label>` (or `<from>..<to>`) switches to the side-by-side
 * diff view; an Edit toggle (dev mode + `design_system.mockups.manage`) opens
 * the studio — both lazily loaded so the plain renderer stays light.
 */

const STORY_ALL = 'all'
const MANAGE_FEATURE = 'design_system.mockups.manage'

type ViewerState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error' }
  | { kind: 'invalid'; issues: Array<{ path: string; message: string }> }
  | {
      kind: 'ready'
      document: MockupDocument
      counts: MockupCounts
      findings: MockupFindingsSummary
      documentHash: string
      contentHash: string
      copy: MockupCopyFile | null
    }

function useCanManageMockups(): boolean {
  const [granted, setGranted] = React.useState(false)
  React.useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    let cancelled = false
    void (async () => {
      try {
        const res = await apiCall<{ ok: boolean; granted: string[] }>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: [MANAGE_FEATURE] }),
        })
        if (!cancelled && res.ok && Array.isArray(res.result?.granted)) {
          setGranted(res.result.granted.includes(MANAGE_FEATURE))
        }
      } catch {
        if (!cancelled) setGranted(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  // The write contract is dev-mode only — outside dev the toggle never shows.
  return process.env.NODE_ENV === 'development' && granted
}

export function MockupViewer({ slug }: { slug: string }) {
  const t = useT()
  const locale = useLocale()
  const searchParams = useSearchParams()
  const [state, setState] = React.useState<ViewerState>({ kind: 'loading' })
  const [entries, setEntries] = React.useState<Map<string, GalleryEntry> | null>(null)
  const [annotated, setAnnotated] = React.useState(true)
  const [storyFilter, setStoryFilter] = React.useState<string>(STORY_ALL)
  const [hoveredBlockId, setHoveredBlockId] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState(false)
  const hashRef = React.useRef<string | null>(null)
  const canManage = useCanManageMockups()
  const compareParam = searchParams?.get('compare') ?? null

  React.useEffect(() => {
    let cancelled = false
    loadGalleryEntryMap()
      .then((map) => {
        if (!cancelled) setEntries(map)
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const load = React.useCallback(
    async (silent: boolean) => {
      try {
        const response = await apiFetch(`/api/design_system/mockups/${encodeURIComponent(slug)}`)
        if (response.status === 404) {
          hashRef.current = null
          setState({ kind: 'not-found' })
          return
        }
        if (response.status === 422) {
          const body = (await response.json()) as { issues?: Array<{ path: string; message: string }> }
          hashRef.current = null
          setState({ kind: 'invalid', issues: body.issues ?? [] })
          return
        }
        if (!response.ok) {
          if (!silent) setState({ kind: 'error' })
          return
        }
        const body = (await response.json()) as {
          document: unknown
          counts: MockupCounts
          findings: MockupFindingsSummary
          documentHash: string
          contentHash: string
          copy: unknown
        }
        if (silent && hashRef.current === body.documentHash) return
        const parsed = mockupDocument.safeParse(body.document)
        if (!parsed.success) {
          hashRef.current = null
          setState({
            kind: 'invalid',
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join('.') || '(root)',
              message: issue.message,
            })),
          })
          return
        }
        const parsedCopy = body.copy == null ? null : copyFileSchema.safeParse(body.copy)
        hashRef.current = body.documentHash
        setState({
          kind: 'ready',
          document: parsed.data,
          counts: body.counts,
          findings: body.findings,
          documentHash: body.documentHash,
          contentHash: body.contentHash,
          copy: parsedCopy?.success ? parsedCopy.data : null,
        })
      } catch {
        if (!silent) setState({ kind: 'error' })
      }
    },
    [slug],
  )

  React.useEffect(() => {
    hashRef.current = null
    setState({ kind: 'loading' })
    setStoryFilter(STORY_ALL)
    void load(false)
  }, [load])

  // Dev auto-refresh: the server re-reads the file per request, so
  // edit-to-screen latency is one poll tick. Paused while the studio holds a
  // working copy (it owns conflict handling through baseHash instead).
  React.useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    if (editing) return
    const timer = setInterval(() => {
      void load(true)
    }, 2000)
    return () => clearInterval(timer)
  }, [load, editing])

  const scrollToBlock = React.useCallback((blockId: string) => {
    globalThis.document
      ?.getElementById(mockupBlockDomId(blockId))
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  const onStoryChange = React.useCallback(
    (value: string) => {
      setStoryFilter(value)
      if (value === STORY_ALL || state.kind !== 'ready') return
      const first = collectLeaves(state.document.root).find((leaf) => leaf.userStory === value)
      if (first) scrollToBlock(first.id)
    },
    [state, scrollToBlock],
  )

  if (state.kind === 'loading' || (state.kind === 'ready' && !entries)) {
    return <LoadingMessage label={t('design_system.mockups.loading', 'Loading mockup…')} />
  }
  if (state.kind === 'not-found') {
    return <ErrorMessage label={t('design_system.mockups.notFound', 'Mockup not found')} />
  }
  if (state.kind === 'error') {
    return <ErrorMessage label={t('design_system.mockups.loadFailed', 'Could not load this mockup')} />
  }
  if (state.kind === 'invalid') {
    return (
      <div className="space-y-3" data-testid="mockup-invalid">
        <ErrorMessage
          label={t('design_system.mockups.invalid', 'This mockup document fails schema validation')}
        />
        <ul className="space-y-1 rounded-lg border border-border p-4 text-sm">
          {state.issues.map((issue, index) => (
            <li key={`${issue.path}-${index}`} className="flex gap-2">
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{issue.path}</span>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const { document, counts, findings, contentHash, copy } = state

  // Diff mode: ?compare=<label> (current vs label) or ?compare=<from>..<to>.
  if (compareParam) {
    const [fromLabel, toLabel] = compareParam.includes('..')
      ? (compareParam.split('..', 2) as [string, string])
      : [compareParam, 'current']
    return (
      <React.Suspense
        fallback={<LoadingMessage label={t('design_system.mockups.loading', 'Loading mockup…')} />}
      >
        <MockupDiffView slug={slug} from={fromLabel} to={toLabel} entries={entries!} />
      </React.Suspense>
    )
  }

  if (editing && canManage) {
    return (
      <React.Suspense
        fallback={<LoadingMessage label={t('design_system.mockups.studio.loading', 'Loading studio…')} />}
      >
        <MockupStudio
          slug={slug}
          initialDocument={document}
          baseHash={state.documentHash}
          contentHash={contentHash}
          entries={entries!}
          onExit={() => {
            setEditing(false)
            void load(false)
          }}
        />
      </React.Suspense>
    )
  }

  const stories = collectUserStories(document)
  const copyOverrides: CopyOverrideMap | undefined = copy
    ? copyOverridesFor(document, copy, locale)
    : undefined

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{document.title}</h2>
          {document.routeHint ? (
            <p className="font-mono text-xs text-muted-foreground">{document.routeHint}</p>
          ) : null}
          {document.description ? (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{document.description}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {annotated && stories.length > 0 ? (
            <Select value={storyFilter} onValueChange={onStoryChange}>
              <SelectTrigger
                size="sm"
                className="w-44"
                aria-label={t('design_system.mockups.storyFilter', 'Filter by user story')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={STORY_ALL}>
                  {t('design_system.mockups.allStories', 'All user stories')}
                </SelectItem>
                {stories.map((story) => (
                  <SelectItem key={story} value={story}>
                    {story}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <SegmentedControl
            size="sm"
            value={annotated ? 'annotated' : 'clean'}
            onValueChange={(value) => setAnnotated(value === 'annotated')}
            aria-label={t('design_system.mockups.layerToggle', 'Annotation layer')}
          >
            <SegmentedControlItem value="clean">
              {t('design_system.mockups.clean', 'Clean')}
            </SegmentedControlItem>
            <SegmentedControlItem value="annotated">
              {t('design_system.mockups.annotated', 'Annotated')}
            </SegmentedControlItem>
          </SegmentedControl>
          {canManage ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="mockup-edit-toggle"
              onClick={() => setEditing(true)}
            >
              {t('design_system.mockups.studio.edit', 'Edit')}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1">
          <MockupStage
            document={document}
            entries={entries!}
            annotated={annotated}
            hoveredBlockId={hoveredBlockId}
            onHoverBlock={setHoveredBlockId}
            copyOverrides={copyOverrides}
          />
        </div>
        {annotated ? (
          <MockupLedger
            document={document}
            entries={entries!}
            counts={counts}
            findingsSummary={findings}
            contentHash={contentHash}
            storyFilter={storyFilter === STORY_ALL ? null : storyFilter}
            hoveredBlockId={hoveredBlockId}
            onHoverBlock={setHoveredBlockId}
            onSelectBlock={scrollToBlock}
          />
        ) : null}
      </div>
    </div>
  )
}
