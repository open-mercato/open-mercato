'use client'

import * as React from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import type { GalleryEntry } from '../../gallery/types'
import { computeMockupDiff, diffToneByBlock, type MockupDiff, type MockupDiffTone } from '../diff'
import { mockupDocument, type MockupDocument } from '../schema'
import {
  DIFF_DOT_CLASS,
  DIFF_LABELS,
  DIFF_TONE_ORDER,
} from './statusPresentation'
import { MockupStage } from './MockupStage'

/**
 * Side-by-side version diff (spec 2026-07-05-ds-live-mockup-composer.md,
 * Phase 2): two stages next to each other, the block-level delta expressed in
 * the SAME rail-and-ledger vocabulary as everything else — added → success
 * rail, removed → error rail (on the FROM stage, where the block still
 * exists), changed → info, moved-only → neutral. Removed blocks additionally
 * appear as ghost entries in the diff LEDGER; content is never framed,
 * badged, or dimmed.
 */

type DiffState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'not-found' }
  | { kind: 'ready'; fromDocument: MockupDocument; toDocument: MockupDocument; diff: MockupDiff }

async function fetchVersion(slug: string, ref: string): Promise<MockupDocument | null> {
  const url =
    ref === 'current'
      ? `/api/design_system/mockups/${encodeURIComponent(slug)}`
      : `/api/design_system/mockups/${encodeURIComponent(slug)}/versions/${encodeURIComponent(ref)}`
  const response = await apiFetch(url)
  if (!response.ok) return null
  const body = (await response.json()) as { document: unknown }
  const parsed = mockupDocument.safeParse(body.document)
  return parsed.success ? parsed.data : null
}

function toneOf(diff: MockupDiff, id: string): MockupDiffTone | null {
  if (diff.added.includes(id)) return 'added'
  if (diff.removed.includes(id)) return 'removed'
  if (diff.changed.some((entry) => entry.id === id)) return 'changed'
  if (diff.moved.includes(id)) return 'moved'
  return null
}

export function MockupDiffView({
  slug,
  from,
  to,
  entries,
}: {
  slug: string
  from: string
  to: string
  entries: Map<string, GalleryEntry>
}) {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const [state, setState] = React.useState<DiffState>({ kind: 'loading' })
  const [hoveredBlockId, setHoveredBlockId] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    void (async () => {
      try {
        const [fromDocument, toDocument] = await Promise.all([
          fetchVersion(slug, from),
          fetchVersion(slug, to),
        ])
        if (cancelled) return
        if (!fromDocument || !toDocument) {
          setState({ kind: 'not-found' })
          return
        }
        setState({
          kind: 'ready',
          fromDocument,
          toDocument,
          diff: computeMockupDiff(fromDocument, toDocument, { slug, from, to }),
        })
      } catch {
        if (!cancelled) setState({ kind: 'error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slug, from, to])

  if (state.kind === 'loading') {
    return <LoadingMessage label={t('design_system.mockups.diff.loading', 'Computing diff…')} />
  }
  if (state.kind === 'not-found') {
    return (
      <ErrorMessage label={t('design_system.mockups.diff.notFound', 'Version not found for this mockup')} />
    )
  }
  if (state.kind === 'error') {
    return <ErrorMessage label={t('design_system.mockups.diff.failed', 'Could not compute this diff')} />
  }

  const { fromDocument, toDocument, diff } = state
  const tones = diffToneByBlock(diff)
  // The FROM stage shows removed/changed/moved rails; the TO stage shows
  // added/changed/moved. Removed ids exist only in FROM anyway.
  const deltaCount = diff.added.length + diff.removed.length + diff.changed.length + diff.moved.length

  const ledgerRow = (id: string, tone: MockupDiffTone, detail?: string) => (
    <li
      key={`${tone}-${id}`}
      data-testid={`mockup-diff-entry-${id}`}
      className={cn(
        'rounded-sm border border-border bg-card px-2 py-1.5',
        tone === 'removed' ? 'opacity-60' : null,
      )}
      onMouseEnter={() => setHoveredBlockId(id)}
      onMouseLeave={() => setHoveredBlockId(null)}
    >
      <span className="flex items-center gap-1.5">
        <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DIFF_DOT_CLASS[tone])} />
        <span className="truncate font-mono text-sm">{id}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {t(DIFF_LABELS[tone].key, DIFF_LABELS[tone].fallback)}
        </span>
      </span>
      {detail ? <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span> : null}
    </li>
  )

  return (
    <div className="space-y-4" data-testid="mockup-diff-view">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{toDocument.title}</h2>
          <p className="font-mono text-xs text-muted-foreground">
            {diff.from} → {diff.to}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => router.push(pathname ?? `/backend/design-system/mockups/${slug}`)}
        >
          {t('design_system.mockups.diff.exit', 'Back to current')}
        </Button>
      </div>
      <div className="flex flex-col gap-6 xl:flex-row">
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <h3 className="font-mono text-xs text-muted-foreground">{diff.from}</h3>
            <MockupStage
              document={fromDocument}
              entries={entries}
              annotated
              hoveredBlockId={hoveredBlockId}
              onHoverBlock={setHoveredBlockId}
              railToneOverrides={tones}
              domIdPrefix="diff-from-"
            />
          </div>
          <div className="min-w-0 space-y-2">
            <h3 className="font-mono text-xs text-muted-foreground">{diff.to}</h3>
            <MockupStage
              document={toDocument}
              entries={entries}
              annotated
              hoveredBlockId={hoveredBlockId}
              onHoverBlock={setHoveredBlockId}
              railToneOverrides={tones}
              domIdPrefix="diff-to-"
            />
          </div>
        </div>
        <aside
          className="w-72 shrink-0 space-y-4"
          data-testid="mockup-diff-ledger"
          aria-label={t('design_system.mockups.diff.ledgerTitle', 'Version delta')}
        >
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">
              {t('design_system.mockups.diff.ledgerTitle', 'Version delta')}
            </h3>
            <div className="grid grid-cols-2 gap-2" data-testid="mockup-diff-counts">
              {DIFF_TONE_ORDER.map((tone) => (
                <span
                  key={tone}
                  className="flex items-center justify-between gap-2 rounded-sm border border-border px-2 py-1 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DIFF_DOT_CLASS[tone])} />
                    <span className="truncate">{t(DIFF_LABELS[tone].key, DIFF_LABELS[tone].fallback)}</span>
                  </span>
                  <span className="font-medium tabular-nums">
                    {tone === 'added'
                      ? diff.added.length
                      : tone === 'removed'
                        ? diff.removed.length
                        : tone === 'changed'
                          ? diff.changed.length
                          : diff.moved.length}
                  </span>
                </span>
              ))}
            </div>
          </div>
          {deltaCount === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('design_system.mockups.diff.noChanges', 'No block-level changes between these versions')}
            </p>
          ) : (
            <ul className="space-y-2">
              {diff.added.map((id) => ledgerRow(id, 'added'))}
              {diff.removed.map((id) =>
                ledgerRow(
                  id,
                  'removed',
                  t('design_system.mockups.diff.removedDetail', 'Present in the earlier version only'),
                ),
              )}
              {diff.changed.map((entry) => ledgerRow(entry.id, 'changed', entry.fields.join(', ')))}
              {diff.moved.map((id) => ledgerRow(id, 'moved'))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  )
}
