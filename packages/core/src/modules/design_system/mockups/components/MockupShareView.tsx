'use client'

import * as React from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import type { GalleryEntry } from '../../gallery/types'
import { loadGalleryEntryMap } from '../integrity'
import { copyFileSchema, copyOverridesFor, type MockupCopyFile } from '../copy'
import {
  mockupDocument,
  type MockupCounts,
  type MockupDocument,
  type MockupFindingsSummary,
} from '../schema'
import { MockupLedger } from './MockupLedger'
import { MockupStage, type CopyOverrideMap } from './MockupStage'

/**
 * The public, token-gated share surface (spec 2026-07-05-ds-live-mockup-composer.md,
 * Phase 2 — Share links): read-only, no backend shell, no session use, zero
 * write surface — the overlay toggle and the ledger are the only controls.
 * The watermark ribbon is ALWAYS on so a pixel-true render cannot circulate
 * as shipped UI. Invalid, expired, or tampered tokens land on the same
 * not-found message the API's uniform 404 dictates.
 */

type ShareState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | {
      kind: 'ready'
      document: MockupDocument
      counts: MockupCounts
      findings: MockupFindingsSummary
      contentHash: string
      copy: MockupCopyFile | null
    }

export function MockupShareView({ token }: { token: string }) {
  const t = useT()
  const locale = useLocale()
  const [state, setState] = React.useState<ShareState>({ kind: 'loading' })
  const [entries, setEntries] = React.useState<Map<string, GalleryEntry> | null>(null)
  const [annotated, setAnnotated] = React.useState(false)
  const [hoveredBlockId, setHoveredBlockId] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    loadGalleryEntryMap()
      .then((map) => {
        if (!cancelled) setEntries(map)
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'not-found' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(
          `/api/design_system/mockup-share/${encodeURIComponent(token)}`,
          { cache: 'no-store' },
        )
        if (!response.ok) {
          if (!cancelled) setState({ kind: 'not-found' })
          return
        }
        const body = (await response.json()) as {
          document: unknown
          coverage: {
            totals: MockupCounts
            userStories: string[]
            findings: MockupFindingsSummary
          }
          contentHash: string
          copy: unknown
        }
        const parsed = mockupDocument.safeParse(body.document)
        if (!parsed.success) {
          if (!cancelled) setState({ kind: 'not-found' })
          return
        }
        const parsedCopy = body.copy == null ? null : copyFileSchema.safeParse(body.copy)
        if (!cancelled) {
          setState({
            kind: 'ready',
            document: parsed.data,
            counts: body.coverage.totals,
            findings: body.coverage.findings,
            contentHash: body.contentHash,
            copy: parsedCopy?.success ? parsedCopy.data : null,
          })
        }
      } catch {
        if (!cancelled) setState({ kind: 'not-found' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  if (state.kind === 'loading' || (state.kind === 'ready' && !entries)) {
    return (
      <div className="p-6">
        <LoadingMessage label={t('design_system.mockups.loading', 'Loading mockup…')} />
      </div>
    )
  }
  if (state.kind === 'not-found') {
    return (
      <div className="p-6" data-testid="mockup-share-not-found">
        <ErrorMessage label={t('design_system.mockups.share.notFound', 'This link is invalid or has expired')} />
      </div>
    )
  }

  const { document, counts, findings, contentHash, copy } = state
  const copyOverrides: CopyOverrideMap | undefined = copy
    ? copyOverridesFor(document, copy, locale)
    : undefined

  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-6" data-testid="mockup-share-view">
      <div className="mx-auto w-full max-w-screen-2xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <span
              data-testid="mockup-share-watermark"
              className="inline-block rounded-sm border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground"
            >
              {t('design_system.mockups.share.watermark', 'Mockup — not shipped UI')}
            </span>
            <h1 className="mt-1 text-lg font-semibold">{document.title}</h1>
            {document.description ? (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{document.description}</p>
            ) : null}
          </div>
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
              storyFilter={null}
              hoveredBlockId={hoveredBlockId}
              onHoverBlock={setHoveredBlockId}
              onSelectBlock={() => {}}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
