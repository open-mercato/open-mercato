'use client'

import * as React from 'react'
import { z } from 'zod'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import type { GalleryEntry } from '../../gallery/types'
import { galleryFamilies } from '../../gallery/registry'
import { familyLabelFallback } from '../../gallery/components/sectionNav'
import {
  collectLeaves,
  collectNodes,
  MOCKUP_STATUSES,
  mockupDocument,
  type MockupDocument,
  type MockupLeafNode,
  type MockupStatus,
} from '../schema'
import {
  insertLeaf,
  removeNode,
  reorderNode,
  updateAnnotation,
  updateBlock,
  updatePlaceholderLabel,
  type MutationResult,
} from '../mutations'
import { STATUS_LABELS } from './statusPresentation'
import { MockupStage } from './MockupStage'

/**
 * The studio (spec 2026-07-05-ds-live-mockup-composer.md, Phase 2): palette ·
 * canvas · inspector over the SAME JSON document — a structured editor, never
 * a parallel model. The canvas is the live MockupStage; selection rides the
 * margin-rail emphasis (content is never framed). Save serializes the working
 * document and PUTs it with the load-time `baseHash`; a 409 (concurrent edit
 * — human, agent, or another tab) prompts reload-and-reapply. The studio
 * holds no state the file doesn't: closing it loses nothing that was saved.
 */

type FamilyGroup = { id: string; label: string; entries: GalleryEntry[] }

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'conflict' }
  | { kind: 'invalid'; issues: Array<{ path: string; message: string }> }
  | { kind: 'error' }

// --- composePropsSchema introspection (drives the generated prop form) ---

type FieldSpec = {
  key: string
  kind: 'string' | 'number' | 'boolean' | 'enum' | 'json'
  options?: string[]
  optional: boolean
  nullable: boolean
}

function unwrapType(schema: z.ZodTypeAny): { inner: z.ZodTypeAny; optional: boolean; nullable: boolean } {
  let current = schema
  let optional = false
  let nullable = false
  for (;;) {
    if (current instanceof z.ZodOptional) {
      optional = true
      current = current.unwrap() as z.ZodTypeAny
      continue
    }
    if (current instanceof z.ZodNullable) {
      nullable = true
      current = current.unwrap() as z.ZodTypeAny
      continue
    }
    if (current instanceof z.ZodDefault) {
      optional = true
      current = current.unwrap() as z.ZodTypeAny
      continue
    }
    return { inner: current, optional, nullable }
  }
}

/** Field specs for a ZodObject compose schema; null when not introspectable. */
function fieldSpecsFor(schema: z.ZodTypeAny | undefined): FieldSpec[] | null {
  if (!schema || !(schema instanceof z.ZodObject)) return null
  const shape = schema.shape as Record<string, z.ZodTypeAny>
  return Object.keys(shape).map((key) => {
    const { inner, optional, nullable } = unwrapType(shape[key])
    if (inner instanceof z.ZodString) return { key, kind: 'string' as const, optional, nullable }
    if (inner instanceof z.ZodNumber) return { key, kind: 'number' as const, optional, nullable }
    if (inner instanceof z.ZodBoolean) return { key, kind: 'boolean' as const, optional, nullable }
    if (inner instanceof z.ZodEnum) {
      const options = (inner.options as unknown[]).map((option) => String(option))
      return { key, kind: 'enum' as const, options, optional, nullable }
    }
    return { key, kind: 'json' as const, optional, nullable }
  })
}

function PropField({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec
  value: unknown
  onChange: (next: unknown | undefined) => void
}) {
  const t = useT()
  const [jsonError, setJsonError] = React.useState(false)
  const [jsonText, setJsonText] = React.useState(() =>
    value === undefined ? '' : JSON.stringify(value, null, 2),
  )
  React.useEffect(() => {
    setJsonText(value === undefined ? '' : JSON.stringify(value, null, 2))
    setJsonError(false)
    // Only reset when the underlying value identity changes from outside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value ?? null)])

  if (spec.kind === 'boolean') {
    return (
      <Select
        value={value === true ? 'true' : value === false ? 'false' : 'unset'}
        onValueChange={(next) => onChange(next === 'unset' ? undefined : next === 'true')}
      >
        <SelectTrigger size="sm" aria-label={spec.key}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {spec.optional ? (
            <SelectItem value="unset">{t('design_system.mockups.studio.unset', 'Not set')}</SelectItem>
          ) : null}
          <SelectItem value="true">{t('design_system.mockups.studio.boolTrue', 'Yes')}</SelectItem>
          <SelectItem value="false">{t('design_system.mockups.studio.boolFalse', 'No')}</SelectItem>
        </SelectContent>
      </Select>
    )
  }
  if (spec.kind === 'enum') {
    return (
      <Select
        value={typeof value === 'string' ? value : 'unset'}
        onValueChange={(next) => onChange(next === 'unset' ? undefined : next)}
      >
        <SelectTrigger size="sm" aria-label={spec.key}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {spec.optional ? (
            <SelectItem value="unset">{t('design_system.mockups.studio.unset', 'Not set')}</SelectItem>
          ) : null}
          {(spec.options ?? []).map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (spec.kind === 'number') {
    return (
      <Input
        type="number"
        aria-label={spec.key}
        value={typeof value === 'number' ? String(value) : ''}
        onChange={(event) => {
          const raw = event.target.value
          if (raw === '') {
            onChange(spec.nullable ? null : undefined)
            return
          }
          const parsed = Number(raw)
          if (!Number.isNaN(parsed)) onChange(parsed)
        }}
      />
    )
  }
  if (spec.kind === 'string') {
    return (
      <Input
        aria-label={spec.key}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => {
          const raw = event.target.value
          onChange(raw === '' && spec.optional ? undefined : raw)
        }}
      />
    )
  }
  return (
    <div className="space-y-1">
      <Textarea
        aria-label={spec.key}
        rows={3}
        className="font-mono text-xs"
        value={jsonText}
        onChange={(event) => setJsonText(event.target.value)}
        onBlur={() => {
          const raw = jsonText.trim()
          if (raw === '') {
            setJsonError(false)
            onChange(undefined)
            return
          }
          try {
            onChange(JSON.parse(raw))
            setJsonError(false)
          } catch {
            setJsonError(true)
          }
        }}
      />
      {jsonError ? (
        <p className="text-xs text-status-error-text">
          {t('design_system.mockups.studio.invalidJson', 'Invalid JSON — the value was not applied')}
        </p>
      ) : null}
    </div>
  )
}

export function MockupStudio({
  slug,
  initialDocument,
  baseHash,
  contentHash,
  entries,
  onExit,
}: {
  slug: string
  initialDocument: MockupDocument
  baseHash: string
  contentHash: string
  entries: Map<string, GalleryEntry>
  onExit: () => void
}) {
  const t = useT()
  const [document, setDocument] = React.useState<MockupDocument>(initialDocument)
  const [currentBaseHash, setCurrentBaseHash] = React.useState(baseHash)
  const [dirty, setDirty] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [hoveredBlockId, setHoveredBlockId] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [families, setFamilies] = React.useState<FamilyGroup[] | null>(null)
  const [saveState, setSaveState] = React.useState<SaveState>({ kind: 'idle' })
  const [mutationError, setMutationError] = React.useState<string | null>(null)
  const [snapshotLabel, setSnapshotLabel] = React.useState('')
  const [toolMessage, setToolMessage] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void Promise.all(
      galleryFamilies
        // Documentation sheets (foundations, icons) are not insertable blocks.
        .filter((family) => family.composable !== false)
        .map(async (family) => {
          const mod = await family.load()
          return { id: family.id, label: familyLabelFallback(family.id), entries: mod.entries }
        }),
    ).then((groups) => {
      if (!cancelled) setFamilies(groups)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const apply = React.useCallback(
    (result: MutationResult) => {
      if (!result.ok) {
        setMutationError(result.error)
        return
      }
      setMutationError(null)
      setDocument(result.document)
      setDirty(true)
      setSaveState({ kind: 'idle' })
    },
    [],
  )

  const leaves = collectLeaves(document.root)
  const selected: MockupLeafNode | null = selectedId
    ? (leaves.find((leaf) => leaf.id === selectedId) ?? null)
    : null

  /** Insert target: after the selection inside its parent, else end of root. */
  const insertionPoint = React.useCallback((): { parentId: string; index: number } | null => {
    if (selectedId) {
      for (const node of collectNodes(document.root)) {
        if (node.type !== 'stack' && node.type !== 'columns') continue
        const index = node.children.findIndex((child) => child.id === selectedId)
        if (index >= 0) return { parentId: node.id, index: index + 1 }
      }
    }
    const root = document.root
    if (root.type === 'stack' || root.type === 'columns') {
      return { parentId: root.id, index: root.children.length }
    }
    return null
  }, [document, selectedId])

  const insertEntry = React.useCallback(
    (entry: GalleryEntry) => {
      const point = insertionPoint()
      if (!point) {
        setMutationError(
          t('design_system.mockups.studio.noContainer', 'The root node is not a container — nothing can be inserted'),
        )
        return
      }
      // Entries with compose() start from neutral defaults instead of the
      // gallery demo copy ("Edit product" has no place on a person form).
      apply(
        insertLeaf(
          document,
          point.parentId,
          point.index,
          typeof entry.compose === 'function'
            ? { type: 'block', entry: entry.id, props: {} }
            : { type: 'block', entry: entry.id, variant: entry.variants[0]?.id },
        ),
      )
    },
    [apply, document, insertionPoint, t],
  )

  const insertPlaceholder = React.useCallback(() => {
    const point = insertionPoint()
    if (!point) {
      setMutationError(
        t('design_system.mockups.studio.noContainer', 'The root node is not a container — nothing can be inserted'),
      )
      return
    }
    apply(
      insertLeaf(document, point.parentId, point.index, {
        type: 'placeholder',
        label: t('design_system.mockups.studio.newPlaceholder', 'New placeholder'),
      }),
    )
  }, [apply, document, insertionPoint, t])

  const save = React.useCallback(async () => {
    const parsed = mockupDocument.safeParse(document)
    if (!parsed.success) {
      setSaveState({
        kind: 'invalid',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || '(root)',
          message: issue.message,
        })),
      })
      return
    }
    setSaveState({ kind: 'saving' })
    try {
      const response = await apiFetch(`/api/design_system/mockups/${encodeURIComponent(slug)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ document, baseHash: currentBaseHash }),
      })
      if (response.status === 409) {
        setSaveState({ kind: 'conflict' })
        return
      }
      if (response.status === 422 || response.status === 400) {
        const body = (await response.json()) as { issues?: Array<{ path: string; message: string }> }
        setSaveState({ kind: 'invalid', issues: body.issues ?? [] })
        return
      }
      if (!response.ok) {
        setSaveState({ kind: 'error' })
        return
      }
      const body = (await response.json()) as { documentHash: string }
      setCurrentBaseHash(body.documentHash)
      setDirty(false)
      setSaveState({ kind: 'saved' })
    } catch {
      setSaveState({ kind: 'error' })
    }
  }, [document, currentBaseHash, slug])

  const reloadFromDisk = React.useCallback(async () => {
    try {
      const response = await apiFetch(`/api/design_system/mockups/${encodeURIComponent(slug)}`)
      if (!response.ok) return
      const body = (await response.json()) as { document: unknown; documentHash: string }
      const parsed = mockupDocument.safeParse(body.document)
      if (!parsed.success) return
      setDocument(parsed.data)
      setCurrentBaseHash(body.documentHash)
      setDirty(false)
      setSelectedId(null)
      setSaveState({ kind: 'idle' })
    } catch {
      setSaveState({ kind: 'error' })
    }
  }, [slug])

  const createSnapshot = React.useCallback(async () => {
    const label = snapshotLabel.trim()
    if (!label) return
    try {
      const response = await apiFetch(
        `/api/design_system/mockups/${encodeURIComponent(slug)}/versions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label }),
        },
      )
      if (response.ok) {
        setSnapshotLabel('')
        setToolMessage(t('design_system.mockups.studio.snapshotCreated', 'Snapshot created'))
      } else {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setToolMessage(
          body?.error ?? t('design_system.mockups.studio.snapshotFailed', 'Could not create the snapshot'),
        )
      }
    } catch {
      setToolMessage(t('design_system.mockups.studio.snapshotFailed', 'Could not create the snapshot'))
    }
  }, [slug, snapshotLabel, t])

  const mintShareLink = React.useCallback(async () => {
    try {
      const response = await apiFetch(
        `/api/design_system/mockups/${encodeURIComponent(slug)}/share`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      if (response.status === 503) {
        setToolMessage(
          t(
            'design_system.mockups.studio.shareDisabled',
            'Sharing is disabled: MOCKUP_SHARE_SECRET is not configured',
          ),
        )
        return
      }
      if (!response.ok) {
        setToolMessage(t('design_system.mockups.studio.shareFailed', 'Could not mint a share link'))
        return
      }
      const body = (await response.json()) as { url: string }
      try {
        await navigator.clipboard.writeText(body.url)
        setToolMessage(t('design_system.mockups.studio.shareCopied', 'Share link copied to clipboard'))
      } catch {
        setToolMessage(body.url)
      }
    } catch {
      setToolMessage(t('design_system.mockups.studio.shareFailed', 'Could not mint a share link'))
    }
  }, [slug, t])

  const selectedEntry = selected?.type === 'block' ? entries.get(selected.entry) : undefined
  const propSpecs = selected?.type === 'block' ? fieldSpecsFor(selectedEntry?.composePropsSchema) : null

  const query = search.trim().toLowerCase()
  const filteredFamilies = (families ?? [])
    .map((group) => ({
      ...group,
      entries: query
        ? group.entries.filter(
            (entry) =>
              entry.id.toLowerCase().includes(query) || entry.title.toLowerCase().includes(query),
          )
        : group.entries,
    }))
    .filter((group) => group.entries.length > 0)

  return (
    <div className="space-y-4" data-testid="mockup-studio">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{document.title}</h2>
          <p className="font-mono text-xs text-muted-foreground">
            {t('design_system.mockups.studio.title', 'Studio')} · {slug}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={snapshotLabel}
            onChange={(event) => setSnapshotLabel(event.target.value)}
            placeholder={t('design_system.mockups.studio.snapshotLabel', 'Snapshot label…')}
            className="w-36"
            aria-label={t('design_system.mockups.studio.snapshotLabel', 'Snapshot label…')}
          />
          <Button type="button" variant="outline" size="sm" onClick={createSnapshot} disabled={!snapshotLabel.trim()}>
            {t('design_system.mockups.studio.snapshot', 'Snapshot')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={mintShareLink}>
            {t('design_system.mockups.studio.share', 'Share')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onExit}>
            {t('design_system.mockups.studio.exit', 'Exit')}
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="mockup-studio-save"
            onClick={save}
            disabled={!dirty || saveState.kind === 'saving'}
          >
            {saveState.kind === 'saving'
              ? t('design_system.mockups.studio.saving', 'Saving…')
              : t('design_system.mockups.studio.save', 'Save')}
          </Button>
        </div>
      </div>

      {saveState.kind === 'conflict' ? (
        <Alert status="error" style="light" size="sm" data-testid="mockup-studio-conflict">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>
              {t(
                'design_system.mockups.studio.conflict',
                'The document changed on disk since you loaded it. Reload to pick up the latest version, then reapply your edits.',
              )}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={reloadFromDisk}>
              {t('design_system.mockups.studio.reload', 'Reload')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {saveState.kind === 'invalid' ? (
        <Alert status="error" style="light" size="sm">
          <AlertDescription>
            <span className="block">
              {t('design_system.mockups.studio.invalid', 'The document failed validation and was not saved')}
            </span>
            {saveState.issues.slice(0, 5).map((issue, index) => (
              <span key={`${issue.path}-${index}`} className="block font-mono text-xs">
                {issue.path}: {issue.message}
              </span>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}
      {saveState.kind === 'error' ? (
        <Alert status="error" style="light" size="sm">
          <AlertDescription>
            {t('design_system.mockups.studio.saveFailed', 'Could not save the document')}
          </AlertDescription>
        </Alert>
      ) : null}
      {saveState.kind === 'saved' ? (
        <Alert status="success" style="light" size="sm">
          <AlertDescription>{t('design_system.mockups.studio.saved', 'Saved')}</AlertDescription>
        </Alert>
      ) : null}
      {mutationError ? (
        <Alert status="error" style="light" size="sm">
          <AlertDescription>{mutationError}</AlertDescription>
        </Alert>
      ) : null}
      {toolMessage ? (
        <Alert status="information" style="light" size="sm">
          <AlertDescription className="break-all">{toolMessage}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-6 xl:flex-row">
        {/* Palette */}
        <aside className="w-64 shrink-0 space-y-3" data-testid="mockup-studio-palette">
          <h3 className="text-sm font-semibold">{t('design_system.mockups.studio.palette', 'Palette')}</h3>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('design_system.mockups.studio.paletteSearch', 'Search components…')}
            aria-label={t('design_system.mockups.studio.paletteSearch', 'Search components…')}
          />
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={insertPlaceholder}>
            {t('design_system.mockups.studio.insertPlaceholder', 'Add empty area (placeholder)')}
          </Button>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {families === null ? (
              <p className="text-xs text-muted-foreground">
                {t('design_system.mockups.studio.paletteLoading', 'Loading registry…')}
              </p>
            ) : (
              filteredFamilies.map((group) => (
                <div key={group.id}>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{group.label}</p>
                  <ul className="space-y-1">
                    {group.entries.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          data-testid={`mockup-palette-entry-${entry.id}`}
                          className="w-full rounded-sm border border-border bg-card px-2 py-1 text-left text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-focus"
                          onClick={() => insertEntry(entry)}
                        >
                          <span className="block truncate">{entry.title}</span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {entry.id}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Canvas — a muted workbench surface; the mockup lies on it as an
            inert sheet, so its demo controls never compete with the studio. */}
        <div className="min-w-0 flex-1 rounded-xl bg-muted/40 p-4 sm:p-6">
          <MockupStage
            document={document}
            entries={entries}
            annotated
            inertContent
            hoveredBlockId={hoveredBlockId}
            onHoverBlock={setHoveredBlockId}
            selectedBlockId={selectedId}
            onSelectBlock={setSelectedId}
          />
        </div>

        {/* Inspector */}
        <aside className="w-80 shrink-0 space-y-3" data-testid="mockup-studio-inspector">
          <h3 className="text-sm font-semibold">
            {t('design_system.mockups.studio.inspector', 'Inspector')}
          </h3>
          {!selected ? (
            <div className="space-y-3 rounded-lg border border-border bg-card p-3">
              <p className="text-xs font-medium text-muted-foreground">
                {t('design_system.mockups.studio.docSection', 'Mockup')}
              </p>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('design_system.mockups.studio.docTitle', 'Title')}
                </p>
                <Input
                  value={document.title}
                  aria-label={t('design_system.mockups.studio.docTitle', 'Title')}
                  onChange={(event) => {
                    setDocument({ ...document, title: event.target.value })
                    setDirty(true)
                    setSaveState({ kind: 'idle' })
                  }}
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('design_system.mockups.studio.docWidth', 'Width preset')}
                </p>
                <Select
                  value={document.width}
                  onValueChange={(next) => {
                    setDocument({ ...document, width: next as MockupDocument['width'] })
                    setDirty(true)
                    setSaveState({ kind: 'idle' })
                  }}
                >
                  <SelectTrigger size="sm" aria-label={t('design_system.mockups.studio.docWidth', 'Width preset')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desktop">{t('design_system.mockups.studio.widthDesktop', 'Desktop')}</SelectItem>
                    <SelectItem value="tablet">{t('design_system.mockups.studio.widthTablet', 'Tablet')}</SelectItem>
                    <SelectItem value="mobile">{t('design_system.mockups.studio.widthMobile', 'Mobile')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('design_system.mockups.studio.docBlocks', '{count} blocks on the canvas', {
                  count: leaves.length,
                })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(
                  'design_system.mockups.studio.noSelection',
                  'Click a block on the canvas to edit its variant, props and review status.',
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs text-muted-foreground">{selected.id}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t('design_system.mockups.studio.moveUp', 'Move up')}
                    onClick={() => apply(reorderNode(document, selected.id, -1))}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t('design_system.mockups.studio.moveDown', 'Move down')}
                    onClick={() => apply(reorderNode(document, selected.id, 1))}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t('design_system.mockups.studio.remove', 'Remove block')}
                    onClick={() => {
                      setSelectedId(null)
                      apply(removeNode(document, selected.id))
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </span>
              </div>

              {selected.type === 'block' ? (
                <>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t('design_system.mockups.studio.entry', 'Registry entry')}
                    </p>
                    <p className="truncate text-sm">{selectedEntry?.title ?? selected.entry}</p>
                  </div>
                  {selectedEntry && selectedEntry.variants.length > 1 && selected.props === undefined ? (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t('design_system.mockups.studio.variant', 'Variant')}
                      </p>
                      <Select
                        value={selected.variant ?? selectedEntry.variants[0].id}
                        onValueChange={(next) =>
                          apply(updateBlock(document, selected.id, { variant: next }))
                        }
                      >
                        <SelectTrigger size="sm" aria-label={t('design_system.mockups.studio.variant', 'Variant')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedEntry.variants.map((variant) => (
                            <SelectItem key={variant.id} value={variant.id}>
                              {variant.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  {propSpecs ? (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t('design_system.mockups.studio.props', 'Props')}
                      </p>
                      {propSpecs.map((spec) => (
                        <div key={spec.key} className="space-y-1">
                          <p className="font-mono text-xs text-muted-foreground">{spec.key}</p>
                          <PropField
                            spec={spec}
                            value={(selected.props ?? {})[spec.key]}
                            onChange={(next) => {
                              const nextProps: Record<string, unknown> = { ...(selected.props ?? {}) }
                              if (next === undefined) delete nextProps[spec.key]
                              else nextProps[spec.key] = next
                              apply(
                                updateBlock(document, selected.id, {
                                  props: Object.keys(nextProps).length > 0 ? nextProps : null,
                                }),
                              )
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : selectedEntry && typeof selectedEntry.compose !== 'function' ? (
                    <p className="text-xs text-muted-foreground">
                      {t(
                        'design_system.mockups.studio.noProps',
                        'This entry exposes no compose() — it renders its canonical variant preview',
                      )}
                    </p>
                  ) : null}
                </>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('design_system.mockups.studio.placeholderLabel', 'Placeholder label')}
                  </p>
                  <Input
                    value={selected.label}
                    aria-label={t('design_system.mockups.studio.placeholderLabel', 'Placeholder label')}
                    onChange={(event) =>
                      apply(updatePlaceholderLabel(document, selected.id, event.target.value))
                    }
                  />
                </div>
              )}

              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('design_system.mockups.studio.status', 'Status')}
                </p>
                <Select
                  value={selected.status}
                  onValueChange={(next) =>
                    apply(updateAnnotation(document, selected.id, { status: next as MockupStatus }))
                  }
                >
                  <SelectTrigger size="sm" aria-label={t('design_system.mockups.studio.status', 'Status')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MOCKUP_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {t(STATUS_LABELS[status].key, STATUS_LABELS[status].fallback)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('design_system.mockups.studio.userStory', 'User story')}
                </p>
                <Input
                  value={selected.userStory ?? ''}
                  placeholder="US-…"
                  aria-label={t('design_system.mockups.studio.userStory', 'User story')}
                  onChange={(event) =>
                    apply(
                      updateAnnotation(document, selected.id, {
                        userStory: event.target.value === '' ? null : event.target.value,
                      }),
                    )
                  }
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('design_system.mockups.studio.note', 'Note')}
                </p>
                <Textarea
                  rows={3}
                  value={selected.note ?? ''}
                  aria-label={t('design_system.mockups.studio.note', 'Note')}
                  onChange={(event) =>
                    apply(
                      updateAnnotation(document, selected.id, {
                        note: event.target.value === '' ? null : event.target.value,
                      }),
                    )
                  }
                />
              </div>

              {(selected.findings ?? []).length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('design_system.mockups.studio.findings', 'Findings')}
                  </p>
                  {(selected.findings ?? []).map((leafFinding) => (
                    <p
                      key={leafFinding.id}
                      className={cn(
                        'text-xs text-muted-foreground',
                        leafFinding.atHash !== contentHash ? 'opacity-50' : null,
                      )}
                    >
                      <span className="font-mono">{leafFinding.heuristicId}</span>: {leafFinding.summary}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
