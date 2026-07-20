'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import type { GalleryEntry } from '../../gallery/types'
import { loadGalleryEntryMap } from '../integrity'
import {
  collectLeaves,
  collectUserStories,
  mockupDocument,
  type MockupCounts,
  type MockupDocument,
} from '../schema'
import { MockupLedger } from './MockupLedger'
import { MockupStage, mockupBlockDomId } from './MockupStage'

/**
 * Loads a mockup document through the GET route, resolves its blocks against
 * the gallery registry, and renders the stage behind the Clean / Annotated
 * toolbar toggle. In dev an auto-refresh poll (2s) re-fetches the document so
 * a JSON edit lands on screen within one poll tick.
 */

const STORY_ALL = 'all'

type ViewerState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error' }
  | { kind: 'invalid'; issues: Array<{ path: string; message: string }> }
  | { kind: 'ready'; document: MockupDocument; counts: MockupCounts; documentHash: string }

export function MockupViewer({ slug }: { slug: string }) {
  const t = useT()
  const [state, setState] = React.useState<ViewerState>({ kind: 'loading' })
  const [entries, setEntries] = React.useState<Map<string, GalleryEntry> | null>(null)
  const [annotated, setAnnotated] = React.useState(true)
  const [storyFilter, setStoryFilter] = React.useState<string>(STORY_ALL)
  const [hoveredBlockId, setHoveredBlockId] = React.useState<string | null>(null)
  const hashRef = React.useRef<string | null>(null)

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
          documentHash: string
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
        hashRef.current = body.documentHash
        setState({
          kind: 'ready',
          document: parsed.data,
          counts: body.counts,
          documentHash: body.documentHash,
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
  // edit-to-screen latency is one poll tick.
  React.useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    const timer = setInterval(() => {
      void load(true)
    }, 2000)
    return () => clearInterval(timer)
  }, [load])

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

  const { document, counts } = state
  const stories = collectUserStories(document)

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
          />
        </div>
        {annotated ? (
          <MockupLedger
            document={document}
            entries={entries!}
            counts={counts}
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
