'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import type { GalleryEntry } from '../../gallery/types'
import type {
  MockupBlockNode,
  MockupDocument,
  MockupLayoutNode,
  MockupPlaceholderNode,
  MockupWidth,
} from '../schema'
import { applyCopyOverrides } from '../copy'
import type { MockupDiffTone } from '../diff'
import {
  DIFF_RAIL_CLASS,
  ledgerStatusOf,
  SEVERITY_SEGMENT_CLASS,
  STATUS_RAIL_CLASS,
} from './statusPresentation'

/**
 * The live render: the layout tree drawn with the REAL components resolved
 * through the gallery registry, inside a bordered stage sized by the width
 * preset. The annotation layer is review-margin only — a slim status rail in
 * the margin gutter (plus short severity segments for findings, Phase 2),
 * absolutely positioned so Clean and Annotated renders are pixel-identical
 * underneath. Content is never outlined, badged, or dimmed — selection and
 * diff tones ride the same rail, never a frame.
 */

const WIDTH_CLASS: Record<MockupWidth, string> = {
  desktop: 'max-w-screen-xl',
  tablet: 'max-w-3xl',
  mobile: 'max-w-sm',
}

const GAP_CLASS: Record<2 | 4 | 6 | 8, string> = {
  2: 'gap-2',
  4: 'gap-4',
  6: 'gap-6',
  8: 'gap-8',
}

export function mockupBlockDomId(blockId: string): string {
  return `mockup-block-${blockId}`
}

export type CopyOverrideMap = Record<string, Array<{ propPath: string[]; value: string }>>

export type MockupStageProps = {
  document: MockupDocument
  entries: Map<string, GalleryEntry>
  annotated: boolean
  hoveredBlockId?: string | null
  onHoverBlock?: (blockId: string | null) => void
  /** Studio: currently selected block — emphasized on the rail, never framed. */
  selectedBlockId?: string | null
  /** Studio: click-to-select. */
  onSelectBlock?: (blockId: string) => void
  /** Diff view: per-block rail tone replacing the status rail. */
  railToneOverrides?: Record<string, MockupDiffTone>
  /** om-ux-copy: per-block string-prop overrides for the active locale. */
  copyOverrides?: CopyOverrideMap
  /** DOM id prefix so two stages (diff view) can coexist on one page. */
  domIdPrefix?: string
}

function BlockContent({
  node,
  entries,
  copyOverrides,
}: {
  node: MockupBlockNode
  entries: Map<string, GalleryEntry>
  copyOverrides?: CopyOverrideMap
}) {
  const t = useT()
  const entry = entries.get(node.entry)
  if (!entry) {
    return (
      <Alert status="error" style="light" size="sm">
        <AlertDescription>
          {t('design_system.mockups.unknownEntry', 'Unknown gallery entry')}: {node.entry}
        </AlertDescription>
      </Alert>
    )
  }
  const composing = node.props !== undefined && typeof entry.compose === 'function'
  const variant = composing
    ? undefined
    : node.variant
      ? entry.variants.find((candidate) => candidate.id === node.variant)
      : entry.variants[0]
  if (!composing && !variant) {
    return (
      <Alert status="error" style="light" size="sm">
        <AlertDescription>
          {t('design_system.mockups.unknownVariant', 'Unknown variant')}: {node.entry}/{node.variant}
        </AlertDescription>
      </Alert>
    )
  }
  // No JSX inside try/catch (lint rule) — only the registry calls, which can
  // throw (e.g. a compose() rejecting props at parse time).
  let content: React.ReactNode = null
  let failed = false
  try {
    if (composing) {
      const overrides = copyOverrides?.[node.id]
      const props = overrides ? applyCopyOverrides(node.props ?? {}, overrides) : (node.props ?? {})
      content = entry.compose!(props)
    } else {
      content = variant!.render()
    }
  } catch {
    failed = true
  }
  if (failed) {
    return (
      <Alert status="error" style="light" size="sm">
        <AlertDescription>
          {t('design_system.mockups.renderFailed', 'This block failed to render')}: {node.id}
        </AlertDescription>
      </Alert>
    )
  }
  return <>{content}</>
}

function PlaceholderContent({ node }: { node: MockupPlaceholderNode }) {
  const t = useT()
  return (
    <div className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
      <p className="text-sm font-medium text-muted-foreground">{node.label}</p>
      <p className="text-xs text-muted-foreground">
        {t('design_system.mockups.placeholderCaption', 'Placeholder, no registry entry yet')}
      </p>
    </div>
  )
}

function LeafWrapper({
  node,
  annotated,
  hoveredBlockId,
  onHoverBlock,
  selectedBlockId,
  onSelectBlock,
  railToneOverrides,
  domIdPrefix,
  children,
}: {
  node: MockupBlockNode | MockupPlaceholderNode
  annotated: boolean
  hoveredBlockId?: string | null
  onHoverBlock?: (blockId: string | null) => void
  selectedBlockId?: string | null
  onSelectBlock?: (blockId: string) => void
  railToneOverrides?: Record<string, MockupDiffTone>
  domIdPrefix?: string
  children: React.ReactNode
}) {
  const status = ledgerStatusOf(node)
  const hovered = hoveredBlockId === node.id
  const selected = selectedBlockId === node.id
  const diffTone = railToneOverrides?.[node.id]
  const railClass = diffTone ? DIFF_RAIL_CLASS[diffTone] : STATUS_RAIL_CLASS[status]
  const findings = node.findings ?? []
  return (
    <div
      id={`${domIdPrefix ?? ''}${mockupBlockDomId(node.id)}`}
      data-mockup-block-id={node.id}
      data-mockup-status={status}
      {...(diffTone ? { 'data-mockup-diff': diffTone } : {})}
      {...(selected ? { 'data-mockup-selected': 'true' } : {})}
      className="relative"
      onMouseEnter={onHoverBlock ? () => onHoverBlock(node.id) : undefined}
      onMouseLeave={onHoverBlock ? () => onHoverBlock(null) : undefined}
      onClick={
        onSelectBlock
          ? (event) => {
              event.stopPropagation()
              onSelectBlock(node.id)
            }
          : undefined
      }
    >
      {annotated ? (
        <span
          aria-hidden
          data-testid={`mockup-rail-${node.id}`}
          className={cn(
            'pointer-events-none absolute inset-y-0 -left-4 transition-opacity duration-150',
            railClass,
            hovered || selected ? 'opacity-100' : 'opacity-50',
          )}
        />
      ) : null}
      {annotated && !diffTone && findings.length > 0 ? (
        <span
          aria-hidden
          data-testid={`mockup-finding-rail-${node.id}`}
          className="pointer-events-none absolute inset-y-0 -left-6 flex flex-col justify-start gap-1 pt-1"
        >
          {findings.map((leafFinding) => (
            <span
              key={leafFinding.id}
              data-testid={`mockup-finding-segment-${leafFinding.id}`}
              className={cn(
                'h-4 w-1 rounded-full transition-opacity duration-150',
                SEVERITY_SEGMENT_CLASS[leafFinding.severity],
                hovered || selected ? 'opacity-100' : 'opacity-60',
              )}
            />
          ))}
        </span>
      ) : null}
      {children}
    </div>
  )
}

function StageNode({
  node,
  entries,
  annotated,
  hoveredBlockId,
  onHoverBlock,
  selectedBlockId,
  onSelectBlock,
  railToneOverrides,
  copyOverrides,
  domIdPrefix,
}: {
  node: MockupLayoutNode
  entries: Map<string, GalleryEntry>
  annotated: boolean
  hoveredBlockId?: string | null
  onHoverBlock?: (blockId: string | null) => void
  selectedBlockId?: string | null
  onSelectBlock?: (blockId: string) => void
  railToneOverrides?: Record<string, MockupDiffTone>
  copyOverrides?: CopyOverrideMap
  domIdPrefix?: string
}) {
  const shared = {
    entries,
    annotated,
    hoveredBlockId,
    onHoverBlock,
    selectedBlockId,
    onSelectBlock,
    railToneOverrides,
    copyOverrides,
    domIdPrefix,
  }
  if (node.type === 'stack') {
    return (
      <div className={cn('flex flex-col', GAP_CLASS[node.gap ?? 4])}>
        {node.children.map((child) => (
          <StageNode key={child.id} node={child} {...shared} />
        ))}
      </div>
    )
  }
  if (node.type === 'columns') {
    return (
      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: node.children
            .map((_, index) => `minmax(0, ${node.weights[index] ?? 1}fr)`)
            .join(' '),
        }}
      >
        {node.children.map((child) => (
          <StageNode key={child.id} node={child} {...shared} />
        ))}
      </div>
    )
  }
  return (
    <LeafWrapper
      node={node}
      annotated={annotated}
      hoveredBlockId={hoveredBlockId}
      onHoverBlock={onHoverBlock}
      selectedBlockId={selectedBlockId}
      onSelectBlock={onSelectBlock}
      railToneOverrides={railToneOverrides}
      domIdPrefix={domIdPrefix}
    >
      {node.type === 'block' ? (
        <BlockContent node={node} entries={entries} copyOverrides={copyOverrides} />
      ) : (
        <PlaceholderContent node={node} />
      )}
    </LeafWrapper>
  )
}

export function MockupStage({
  document,
  entries,
  annotated,
  hoveredBlockId,
  onHoverBlock,
  selectedBlockId,
  onSelectBlock,
  railToneOverrides,
  copyOverrides,
  domIdPrefix,
}: MockupStageProps) {
  return (
    <div
      data-testid="mockup-stage"
      className={cn(
        'mx-auto w-full rounded-lg border border-border bg-background p-6',
        WIDTH_CLASS[document.width],
      )}
    >
      <StageNode
        node={document.root}
        entries={entries}
        annotated={annotated}
        hoveredBlockId={hoveredBlockId}
        onHoverBlock={onHoverBlock}
        selectedBlockId={selectedBlockId}
        onSelectBlock={onSelectBlock}
        railToneOverrides={railToneOverrides}
        copyOverrides={copyOverrides}
        domIdPrefix={domIdPrefix}
      />
    </div>
  )
}
