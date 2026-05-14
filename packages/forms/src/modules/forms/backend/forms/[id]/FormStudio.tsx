"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Alert } from '@open-mercato/ui/primitives/alert'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { FormPalettePanel } from './studio/palette/FormPalettePanel'
import { PALETTE_DRAGGABLE_PREFIX } from './studio/palette/PaletteCard'
import { buildPaletteEntries, resolvePaletteId } from './studio/palette/entries'
import { resolveLucideIcon, Trash2, Undo2, Redo2 } from './studio/lucide-icons'
import { resolveTypeLabel } from './studio/type-label'
import { DragOverlayCard } from './studio/canvas/DragOverlayCard'
import { FormCanvas } from './studio/canvas/FormCanvas'
import { FIELD_DRAGGABLE_PREFIX } from './studio/canvas/FieldRow'
import { SECTION_DROP_PREFIX, parseSectionDropId } from './studio/canvas/GridSlot'
import { SECTION_DRAGGABLE_PREFIX } from './studio/canvas/SectionContainer'
import {
  addFieldFromPalette,
  addLayoutFromPalette,
  adoptUngroupedAsSection,
  deleteSection,
  findSectionOwning,
  indexOfFieldInSection,
  isCompatibleFieldSwap,
  moveField,
  moveSection,
  setFieldAlign,
  setFieldGridSpan,
  setFieldHideMobile,
  setFieldVisibilityIf,
  setHiddenFields,
  setSectionVisibilityIf,
  type HiddenFieldEntry,
  setFormLabelPosition,
  setFormStyle,
  setPageMode,
  setSectionColumns,
  setSectionDivider,
  setSectionGap,
  setSectionHideTitle,
  setSectionKind,
  setSectionTitle,
  setShowProgress,
  swapFieldType,
  SWAP_FAMILIES,
  validateSchemaExtensions,
  type FieldNode,
  type FormSchema,
  type SectionNode,
} from './studio/schema-helpers'
import { createAutosaveGuard } from './studio/autosave-guard'
import {
  partitionPages,
  resolveFormLabelPosition,
  resolveFormStyle,
  resolvePageMode,
  resolveSectionViews,
  resolveShowProgress,
} from '../../../services/form-version-compiler'
import { createUndoController } from './studio/undo-controller'
import { PreviewSurface } from './studio/preview/PreviewSurface'
import { ConditionBuilder, buildFieldSourceOptions } from './studio/logic/ConditionBuilder'
import { ViewportFrame, type PreviewViewport } from './studio/preview/ViewportFrame'
import type { StudioSelection, StudioTopTab } from './studio/types'

type VersionDetail = {
  id: string
  formId: string
  versionNumber: number
  status: 'draft' | 'published' | 'archived'
  schema: FormSchema
  uiSchema: Record<string, unknown>
  roles: string[]
  schemaHash: string
  registryVersion: string
  publishedAt: string | null
  publishedBy: string | null
  changelog: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

type FormDetail = {
  id: string
  key: string
  name: string
  description: string | null
  status: 'draft' | 'active' | 'archived'
  defaultLocale: string
  supportedLocales: string[]
  currentPublishedVersionId: string | null
  versions: Array<{
    id: string
    versionNumber: number
    status: 'draft' | 'published' | 'archived'
    schemaHash: string
    publishedAt: string | null
    changelog: string | null
  }>
}

const DEFAULT_SECTION_KEY = 'default_section'

const DEFAULT_SCHEMA: FormSchema = {
  type: 'object',
  'x-om-roles': ['admin'],
  'x-om-default-actor-role': 'admin',
  'x-om-sections': [
    { key: DEFAULT_SECTION_KEY, kind: 'section', title: { en: '' }, fieldKeys: [] },
  ],
  properties: {},
  required: [],
}

function ensureDefaultSection(schema: FormSchema): FormSchema {
  const sections = (schema['x-om-sections'] ?? []) as SectionNode[]
  if (sections.length > 0) return schema
  const next: FormSchema = {
    ...schema,
    'x-om-sections': [
      { key: DEFAULT_SECTION_KEY, kind: 'section', title: { en: '' }, fieldKeys: [] },
    ],
  }
  return next
}

function describeFieldForAnnouncement(schema: FormSchema, fieldKey: string): string {
  const node = schema.properties[fieldKey]
  if (!node) return fieldKey
  return (node['x-om-label']?.en as string) ?? fieldKey
}

function describeSectionForAnnouncement(schema: FormSchema, sectionKey: string): string {
  const section = (schema['x-om-sections'] ?? []).find((entry) => entry.key === sectionKey)
  if (!section) return sectionKey
  return section.title?.en?.length ? section.title.en : sectionKey
}

function buildAnnouncements(t: TranslateFn, schemaRef: React.MutableRefObject<FormSchema>) {
  const labelOf = (rawId: string): string => {
    if (rawId.startsWith(FIELD_DRAGGABLE_PREFIX)) {
      const fieldKey = rawId.slice(FIELD_DRAGGABLE_PREFIX.length)
      return describeFieldForAnnouncement(schemaRef.current, fieldKey)
    }
    if (rawId.startsWith(PALETTE_DRAGGABLE_PREFIX)) {
      return rawId.slice(PALETTE_DRAGGABLE_PREFIX.length)
    }
    return rawId
  }
  const targetOf = (rawId: string | null): string => {
    if (!rawId) return ''
    if (rawId.startsWith(SECTION_DROP_PREFIX)) {
      const sectionKey = rawId.slice(SECTION_DROP_PREFIX.length)
      return describeSectionForAnnouncement(schemaRef.current, sectionKey)
    }
    if (rawId.startsWith(FIELD_DRAGGABLE_PREFIX)) {
      const fieldKey = rawId.slice(FIELD_DRAGGABLE_PREFIX.length)
      return describeFieldForAnnouncement(schemaRef.current, fieldKey)
    }
    return String(rawId)
  }
  return {
    onDragStart({ active }: { active: { id: string | number } }) {
      return t('forms.studio.dnd.announce.pickedUp', { item: labelOf(String(active.id)) })
    },
    onDragOver({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) {
      return t('forms.studio.dnd.announce.movedOver', {
        item: labelOf(String(active.id)),
        target: targetOf(over ? String(over.id) : null),
      })
    },
    onDragEnd({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) {
      return t('forms.studio.dnd.announce.droppedAt', {
        item: labelOf(String(active.id)),
        target: targetOf(over ? String(over.id) : null),
      })
    },
    onDragCancel({ active }: { active: { id: string | number } }) {
      return t('forms.studio.dnd.announce.cancelled', { item: labelOf(String(active.id)) })
    },
  }
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function autosaveDebounce<TArgs extends unknown[]>(fn: (...args: TArgs) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: TArgs) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

export function FormStudio({ formId }: { formId: string }) {
  const t = useT()
  const router = useRouter()

  const [form, setForm] = React.useState<FormDetail | null>(null)
  const [draftVersionId, setDraftVersionId] = React.useState<string | null>(null)
  const [version, setVersion] = React.useState<VersionDetail | null>(null)
  const [schema, setSchema] = React.useState<FormSchema>(DEFAULT_SCHEMA)
  const [selection, setSelection] = React.useState<StudioSelection>(null)
  const [previewRole, setPreviewRole] = React.useState<string>('admin')
  const [autosaveState, setAutosaveState] = React.useState<'idle' | 'saving' | 'error'>('idle')
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [showPublishDialog, setShowPublishDialog] = React.useState(false)
  const [topTab, setTopTab] = React.useState<StudioTopTab>('builder')
  const [activeDragId, setActiveDragId] = React.useState<string | null>(null)
  const [focusSectionTitleKey, setFocusSectionTitleKey] = React.useState<string | null>(null)
  const [activeLocale] = React.useState<string>('en')
  const [previewViewport, setPreviewViewport] = React.useState<PreviewViewport>('desktop')
  const dirtyFlagRef = React.useRef(false)
  const schemaRef = React.useRef<FormSchema>(DEFAULT_SCHEMA)
  const selectionRef = React.useRef<StudioSelection>(null)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const selectedFieldKey = selection?.kind === 'field' ? selection.key : null
  const undoController = React.useMemo(() => createUndoController({ capacity: 50 }), [])
  const [undoNonce, setUndoNonce] = React.useState(0)

  React.useEffect(() => {
    schemaRef.current = schema
  }, [schema])

  React.useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  const reload = React.useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    const formCall = await apiCall<FormDetail>(`/api/forms/${encodeURIComponent(formId)}`)
    if (!formCall.ok || !formCall.result) {
      setLoadError('forms.errors.form_not_found')
      setIsLoading(false)
      return
    }
    const detail = formCall.result
    setForm(detail)
    let draft = detail.versions.find((entry) => entry.status === 'draft') ?? null

    if (!draft) {
      // No draft yet — fork one automatically so the studio always has a draft.
      const forkCall = await apiCall<{ versionId: string }>(
        `/api/forms/${encodeURIComponent(formId)}/versions/fork`,
        { method: 'POST', body: JSON.stringify({}) },
      )
      if (forkCall.ok && forkCall.result?.versionId) {
        const refresh = await apiCall<FormDetail>(`/api/forms/${encodeURIComponent(formId)}`)
        if (refresh.ok && refresh.result) {
          setForm(refresh.result)
          draft = refresh.result.versions.find((entry) => entry.id === forkCall.result?.versionId) ?? null
        }
      }
    }

    if (draft) {
      setDraftVersionId(draft.id)
      const versionCall = await apiCall<VersionDetail>(
        `/api/forms/${encodeURIComponent(formId)}/versions/${encodeURIComponent(draft.id)}`,
      )
      if (versionCall.ok && versionCall.result) {
        setVersion(versionCall.result)
        const loaded = versionCall.result.schema as FormSchema
        setSchema(ensureDefaultSection(loaded && loaded.properties ? loaded : DEFAULT_SCHEMA))
        dirtyFlagRef.current = false
        undoController.clear()
      }
    } else {
      setVersion(null)
      setSchema(DEFAULT_SCHEMA)
      dirtyFlagRef.current = false
      undoController.clear()
    }
    setIsLoading(false)
  }, [formId, undoController])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const persistDraftRaw = React.useCallback(async (next: FormSchema) => {
    if (!draftVersionId) return
    setAutosaveState('saving')
    const call = await apiCall(
      `/api/forms/${encodeURIComponent(formId)}/versions/${encodeURIComponent(draftVersionId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ schema: next }),
      },
    )
    if (!call.ok) {
      setAutosaveState('error')
      const errPayload = call.result as { error?: string } | undefined
      flash(errPayload?.error ?? 'forms.studio.autosave.error', 'error')
      return
    }
    setAutosaveState('idle')
    dirtyFlagRef.current = false
    // Refresh schemaHash from the server response (best-effort)
    const refreshed = await apiCall<VersionDetail>(
      `/api/forms/${encodeURIComponent(formId)}/versions/${encodeURIComponent(draftVersionId)}`,
    )
    if (refreshed.ok && refreshed.result) setVersion(refreshed.result)
  }, [draftVersionId, formId])

  const autosaveGuard = React.useMemo(
    () =>
      createAutosaveGuard({
        patch: persistDraftRaw,
        onInvalid: () => {
          setAutosaveState('error')
          flash('forms.studio.autosave.invalidSchema', 'error')
        },
      }),
    [persistDraftRaw],
  )

  const persistDraft = React.useMemo(
    () => autosaveDebounce((next: FormSchema) => {
      void autosaveGuard.run(next)
    }, 2000),
    [autosaveGuard],
  )

  const updateSchema = React.useCallback((updater: (current: FormSchema) => FormSchema) => {
    setSchema((current) => {
      const next = updater(current)
      dirtyFlagRef.current = true
      persistDraft(next)
      return next
    })
  }, [persistDraft])

  /**
   * Structural mutators (Decision 6a) push an undo snapshot BEFORE applying
   * the mutation so undo restores the pre-mutation schema + selection. The
   * carve-out for `swapFieldType` (Decision 31b) lands here too.
   */
  const updateSchemaStructural = React.useCallback(
    (updater: (current: FormSchema) => FormSchema) => {
      undoController.push({
        schema: schemaRef.current,
        selection: selectionRef.current,
      })
      setSchema((current) => {
        const next = updater(current)
        dirtyFlagRef.current = true
        persistDraft(next)
        return next
      })
    },
    [persistDraft, undoController],
  )

  const selectField = React.useCallback((fieldKey: string) => {
    setSelection({ kind: 'field', key: fieldKey })
  }, [])

  const selectSection = React.useCallback((sectionKey: string) => {
    setSelection({ kind: 'section', key: sectionKey })
  }, [])

  const clearSelection = React.useCallback(() => {
    setSelection(null)
  }, [])

  const handleDeleteField = React.useCallback((fieldKey: string) => {
    updateSchemaStructural((current) => {
      const next = deepClone(current)
      delete next.properties[fieldKey]
      next.required = (next.required ?? []).filter((entry) => entry !== fieldKey)
      return next
    })
    clearSelection()
    flash(t('forms.studio.fields.deletedFlash'), 'info')
  }, [updateSchemaStructural, clearSelection, t])

  const handleDeleteSection = React.useCallback(async (sectionKey: string) => {
    const sections = (schemaRef.current['x-om-sections'] ?? []) as SectionNode[]
    const target = sections.find((entry) => entry.key === sectionKey)
    if (!target) return
    const fieldCount = target.fieldKeys.length
    if (fieldCount > 0) {
      const ok = await confirm({
        title: t('forms.studio.canvas.section.delete.confirm.title'),
        text: t('forms.studio.canvas.section.delete.confirm.body', {
          name: target.title?.en?.length
            ? target.title.en
            : t('forms.studio.canvas.section.title.placeholder'),
          count: String(fieldCount),
        }),
        confirmText: t('forms.studio.canvas.section.delete.confirm.submit'),
        variant: 'destructive',
      })
      if (!ok) return
    }
    updateSchemaStructural((current) => deleteSection({ schema: current, sectionKey }))
    clearSelection()
  }, [confirm, t, updateSchemaStructural, clearSelection])

  const handleSectionTitleCommit = React.useCallback((sectionKey: string, title: string) => {
    updateSchema((current) =>
      setSectionTitle({ schema: current, sectionKey, locale: activeLocale, title }),
    )
  }, [updateSchema, activeLocale])

  const handleSectionColumnsChange = React.useCallback(
    (sectionKey: string, columns: 1 | 2 | 3 | 4) => {
      updateSchemaStructural((current) => setSectionColumns({ schema: current, sectionKey, columns }))
    },
    [updateSchemaStructural],
  )

  const handleSectionGapChange = React.useCallback(
    (sectionKey: string, gap: 'sm' | 'md' | 'lg') => {
      updateSchemaStructural((current) => setSectionGap({ schema: current, sectionKey, gap }))
    },
    [updateSchemaStructural],
  )

  const handleSectionDividerChange = React.useCallback(
    (sectionKey: string, divider: boolean) => {
      updateSchemaStructural((current) => setSectionDivider({ schema: current, sectionKey, divider }))
    },
    [updateSchemaStructural],
  )

  const handleSectionKindChange = React.useCallback(
    (sectionKey: string, kind: 'page' | 'section') => {
      updateSchemaStructural((current) => setSectionKind({ schema: current, sectionKey, kind }))
    },
    [updateSchemaStructural],
  )

  const handleSectionHideTitleChange = React.useCallback(
    (sectionKey: string, hideTitle: boolean) => {
      updateSchemaStructural((current) => setSectionHideTitle({ schema: current, sectionKey, hideTitle }))
    },
    [updateSchemaStructural],
  )

  const handleAdoptUngrouped = React.useCallback(() => {
    let newSectionKey: string | null = null
    updateSchemaStructural((current) => {
      const result = adoptUngroupedAsSection({ schema: current })
      newSectionKey = result.sectionKey
      return result.schema
    })
    if (newSectionKey) {
      const created: string = newSectionKey
      setSelection({ kind: 'section', key: created })
      setFocusSectionTitleKey(created)
      flash(
        t('forms.studio.canvas.ungrouped.adopt.toast', {
          name: t('forms.studio.canvas.section.title.placeholder'),
        }),
        'success',
      )
    }
  }, [updateSchemaStructural, t])

  // Phase D — field style + form-level settings + type swap.
  const handleFieldGridSpan = React.useCallback(
    (fieldKey: string, span: 1 | 2 | 3 | 4) => {
      updateSchemaStructural((current) => setFieldGridSpan({ schema: current, fieldKey, span }))
    },
    [updateSchemaStructural],
  )

  const handleFieldAlign = React.useCallback(
    (fieldKey: string, align: 'start' | 'center' | 'end') => {
      // Property-edit (Decision 6a) — no undo push.
      updateSchema((current) => setFieldAlign({ schema: current, fieldKey, align }))
    },
    [updateSchema],
  )

  const handleFieldHideMobile = React.useCallback(
    (fieldKey: string, value: boolean) => {
      updateSchema((current) => setFieldHideMobile({ schema: current, fieldKey, value }))
    },
    [updateSchema],
  )

  const handleFieldVisibilityChange = React.useCallback(
    (fieldKey: string, predicate: unknown | null) => {
      updateSchema((current) => setFieldVisibilityIf({ schema: current, fieldKey, predicate }))
    },
    [updateSchema],
  )

  const handleSectionVisibilityChange = React.useCallback(
    (sectionKey: string, predicate: unknown | null) => {
      updateSchema((current) => setSectionVisibilityIf({ schema: current, sectionKey, predicate }))
    },
    [updateSchema],
  )

  const handleHiddenFieldsChange = React.useCallback(
    (entries: HiddenFieldEntry[]) => {
      updateSchema((current) => setHiddenFields({ schema: current, entries }))
    },
    [updateSchema],
  )

  const handleFieldTypeSwap = React.useCallback(
    (fieldKey: string, targetType: string) => {
      try {
        // Decision 31b — type swap pushes undo (carve-out from property-edit rule).
        updateSchemaStructural((current) =>
          swapFieldType({ schema: current, fieldKey, targetType }),
        )
      } catch (error) {
        flash('forms.studio.autosave.invalidSchema', 'error')
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn('[forms.studio] field-type swap failed', error)
        }
      }
    },
    [updateSchemaStructural],
  )

  const handleDensityChange = React.useCallback(
    (next: 'default' | 'compact' | 'spacious') => {
      // Property edit — no undo push (Decision 6a).
      updateSchema((current) => setFormStyle({ schema: current, style: next }))
    },
    [updateSchema],
  )

  const handleLabelPositionChange = React.useCallback(
    (next: 'top' | 'left') => {
      updateSchema((current) => setFormLabelPosition({ schema: current, position: next }))
    },
    [updateSchema],
  )

  const handlePageModeChange = React.useCallback(
    (next: 'stacked' | 'paginated') => {
      updateSchema((current) => setPageMode({ schema: current, mode: next }))
    },
    [updateSchema],
  )

  const handleShowProgressChange = React.useCallback(
    (next: boolean) => {
      updateSchema((current) => setShowProgress({ schema: current, value: next }))
    },
    [updateSchema],
  )

  const handleUndo = React.useCallback(() => {
    const previous = undoController.undo({
      schema: schemaRef.current,
      selection: selectionRef.current,
    })
    if (!previous) return
    setSchema(previous.schema)
    setSelection(previous.selection ?? null)
    dirtyFlagRef.current = true
    persistDraft(previous.schema)
    setUndoNonce((current) => current + 1)
    flash('forms.studio.undo.toast.undone', 'success')
  }, [persistDraft, undoController])

  const handleRedo = React.useCallback(() => {
    const next = undoController.redo({
      schema: schemaRef.current,
      selection: selectionRef.current,
    })
    if (!next) return
    setSchema(next.schema)
    setSelection(next.selection ?? null)
    dirtyFlagRef.current = true
    persistDraft(next.schema)
    setUndoNonce((current) => current + 1)
    flash('forms.studio.undo.toast.redone', 'success')
  }, [persistDraft, undoController])

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return
      // Decision 6c — keyboard binding only fires outside text inputs so
      // browser-native undo handles property edits in <input> / <textarea>.
      const target = event.target as HTMLElement | null
      if (target) {
        const tagName = target.tagName?.toLowerCase()
        if (tagName === 'input' || tagName === 'textarea' || target.isContentEditable) return
      }
      const isRedoCombo =
        (event.key === 'z' && event.shiftKey) || event.key === 'y'
      const isUndoCombo = event.key === 'z' && !event.shiftKey
      if (isRedoCombo) {
        event.preventDefault()
        handleRedo()
      } else if (isUndoCombo) {
        event.preventDefault()
        handleUndo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleUndo, handleRedo])

  const handleFieldUpdate = React.useCallback((fieldKey: string, updater: (node: FieldNode) => FieldNode) => {
    updateSchema((current) => {
      const next = deepClone(current)
      const node = next.properties[fieldKey]
      if (!node) return current
      next.properties[fieldKey] = updater(node)
      return next
    })
  }, [updateSchema])

  const handleRequiredToggle = React.useCallback((fieldKey: string, required: boolean) => {
    updateSchema((current) => {
      const next = deepClone(current)
      const requiredList = new Set(next.required ?? [])
      if (required) requiredList.add(fieldKey)
      else requiredList.delete(fieldKey)
      next.required = Array.from(requiredList)
      return next
    })
  }, [updateSchema])

  const handleDefaultActorRoleChange = React.useCallback((nextRole: string) => {
    updateSchema((current) => {
      const next = deepClone(current)
      next['x-om-default-actor-role'] = nextRole
      const declared = new Set(next['x-om-roles'] ?? [])
      declared.add(nextRole)
      declared.add('admin')
      next['x-om-roles'] = Array.from(declared)
      return next
    })
  }, [updateSchema])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const announcements = React.useMemo(() => buildAnnouncements(t, schemaRef), [t])

  const paletteEntries = React.useMemo(() => buildPaletteEntries(), [])
  const paletteEntryById = React.useMemo(() => {
    const map = new Map<string, { displayNameKey: string; iconName: string }>()
    for (const entry of [...paletteEntries.input, ...paletteEntries.layout]) {
      map.set(entry.id, { displayNameKey: entry.displayNameKey, iconName: entry.iconName })
    }
    return map
  }, [paletteEntries])

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id))
  }, [])

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    setActiveDragId(null)
    const { active, over } = event
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)

    const handleDrop = (next: {
      schema: FormSchema
      selection?: StudioSelection | undefined
    }) => {
      try {
        validateSchemaExtensions(next.schema)
      } catch (error) {
        flash('forms.studio.autosave.invalidSchema', 'error')
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn('[forms.studio] drop validation failed', error)
        }
        return
      }
      // Decision 6a — DnD drops are structural mutations; push undo
      // BEFORE applying so undo restores the pre-drop schema + selection.
      undoController.push({
        schema: schemaRef.current,
        selection: selectionRef.current,
      })
      setSchema(next.schema)
      dirtyFlagRef.current = true
      persistDraft(next.schema)
      if (next.selection !== undefined) setSelection(next.selection)
    }

    const resolveTargetSection = (): { sectionKey: string; index?: number } | null => {
      if (overId.startsWith(SECTION_DROP_PREFIX)) {
        const parsed = parseSectionDropId(overId)
        if (parsed) return { sectionKey: parsed.sectionKey }
        return { sectionKey: overId.slice(SECTION_DROP_PREFIX.length) }
      }
      if (overId.startsWith(FIELD_DRAGGABLE_PREFIX)) {
        const overFieldKey = overId.slice(FIELD_DRAGGABLE_PREFIX.length)
        const owning = findSectionOwning(schemaRef.current, overFieldKey)
        if (!owning) return null
        const index = indexOfFieldInSection(schemaRef.current, owning.key, overFieldKey)
        return { sectionKey: owning.key, index: index >= 0 ? index : undefined }
      }
      return null
    }

    if (activeId.startsWith(PALETTE_DRAGGABLE_PREFIX)) {
      const rawId = activeId.slice(PALETTE_DRAGGABLE_PREFIX.length)
      const resolved = resolvePaletteId(rawId)
      if (resolved.kind === 'input' || resolved.kind === 'layout-field') {
        const target = resolveTargetSection()
        if (!target) return
        try {
          const result = addFieldFromPalette({
            schema: schemaRef.current,
            typeKey: resolved.typeKey,
            target,
          })
          handleDrop({
            schema: result.schema,
            selection: { kind: 'field', key: result.fieldKey },
          })
        } catch (error) {
          flash('forms.studio.autosave.invalidSchema', 'error')
          if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn('[forms.studio] palette drop failed', error)
          }
        }
        return
      }
      if (resolved.kind === 'layout-primitive') {
        // Layout primitives drop at the section level — work out the target index.
        let insertionIndex: number | undefined
        const sections = (schemaRef.current['x-om-sections'] ?? []) as SectionNode[]
        if (overId.startsWith(SECTION_DRAGGABLE_PREFIX)) {
          const overSectionKey = overId.slice(SECTION_DRAGGABLE_PREFIX.length)
          const candidate = sections.findIndex((entry) => entry.key === overSectionKey)
          if (candidate >= 0) insertionIndex = candidate
        }
        try {
          const result = addLayoutFromPalette({
            schema: schemaRef.current,
            kind: resolved.layoutKind,
            target: { index: insertionIndex },
          })
          handleDrop({
            schema: result.schema,
            selection: { kind: 'section', key: result.sectionKey },
          })
          setFocusSectionTitleKey(result.sectionKey)
        } catch (error) {
          flash('forms.studio.autosave.invalidSchema', 'error')
          if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn('[forms.studio] layout drop failed', error)
          }
        }
        return
      }
      return
    }

    if (activeId.startsWith(SECTION_DRAGGABLE_PREFIX)) {
      const sectionKey = activeId.slice(SECTION_DRAGGABLE_PREFIX.length)
      let beforeKey: string | null = null
      if (overId.startsWith(SECTION_DRAGGABLE_PREFIX)) {
        const overKey = overId.slice(SECTION_DRAGGABLE_PREFIX.length)
        if (overKey !== sectionKey) beforeKey = overKey
      }
      try {
        const nextSchema = moveSection({ schema: schemaRef.current, sectionKey, beforeKey })
        handleDrop({ schema: nextSchema })
      } catch (error) {
        flash('forms.studio.autosave.invalidSchema', 'error')
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn('[forms.studio] section reorder failed', error)
        }
      }
      return
    }

    if (activeId.startsWith(FIELD_DRAGGABLE_PREFIX)) {
      const fieldKey = activeId.slice(FIELD_DRAGGABLE_PREFIX.length)
      const target = resolveTargetSection()
      if (!target) return
      try {
        const nextSchema = moveField({
          schema: schemaRef.current,
          fieldKey,
          target,
        })
        handleDrop({ schema: nextSchema })
      } catch (error) {
        flash('forms.studio.autosave.invalidSchema', 'error')
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn('[forms.studio] reorder failed', error)
        }
      }
    }
  }, [persistDraft, undoController])

  const handleDragCancel = React.useCallback(() => {
    setActiveDragId(null)
  }, [])

  const dragOverlayContent = React.useMemo(() => {
    if (!activeDragId) return null
    if (activeDragId.startsWith(PALETTE_DRAGGABLE_PREFIX)) {
      const rawId = activeDragId.slice(PALETTE_DRAGGABLE_PREFIX.length)
      const meta = paletteEntryById.get(rawId)
      if (!meta) return null
      return (
        <DragOverlayCard
          Icon={resolveLucideIcon(meta.iconName)}
          label={t(meta.displayNameKey)}
        />
      )
    }
    if (activeDragId.startsWith(FIELD_DRAGGABLE_PREFIX)) {
      const fieldKey = activeDragId.slice(FIELD_DRAGGABLE_PREFIX.length)
      const node = schemaRef.current.properties[fieldKey]
      if (!node) return null
      const omType = String(node['x-om-type'] ?? 'text')
      const Icon = resolveLucideIcon(
        paletteEntryById.get(omType)?.iconName ?? paletteEntryById.get(`layout:field:${omType}`)?.iconName,
      )
      const label = (node['x-om-label']?.en as string) ?? fieldKey
      return <DragOverlayCard Icon={Icon} label={label} />
    }
    return null
  }, [activeDragId, paletteEntryById, t])

  const persistFormPatch = React.useMemo(
    () =>
      autosaveDebounce(async (payload: { name?: string; description?: string | null }) => {
        const call = await apiCall(`/api/forms/${encodeURIComponent(formId)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
        if (!call.ok) {
          const errPayload = call.result as { error?: string } | undefined
          flash(errPayload?.error ?? 'forms.studio.autosave.error', 'error')
        }
      }, 1000),
    [formId],
  )

  const handleNameChange = React.useCallback((nextName: string) => {
    setForm((current) => (current ? { ...current, name: nextName } : current))
    persistFormPatch({ name: nextName })
  }, [persistFormPatch])

  const handleDescriptionChange = React.useCallback((nextDescription: string) => {
    setForm((current) => (current ? { ...current, description: nextDescription } : current))
    persistFormPatch({ description: nextDescription.length > 0 ? nextDescription : null })
  }, [persistFormPatch])

  const declaredRoles = React.useMemo(
    () => (schema['x-om-roles'] ?? []).filter((entry): entry is string => typeof entry === 'string'),
    [schema],
  )
  const previewRoles = React.useMemo(() => {
    const all = new Set<string>(['admin'])
    declaredRoles.forEach((entry) => all.add(entry))
    return Array.from(all)
  }, [declaredRoles])

  const selectedField = selectedFieldKey ? schema.properties[selectedFieldKey] : null
  const selectedSectionNode =
    selection?.kind === 'section'
      ? ((schema['x-om-sections'] ?? []) as SectionNode[]).find((entry) => entry.key === selection.key) ?? null
      : null

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('forms.studio.title')} />
        </PageBody>
      </Page>
    )
  }
  if (loadError || !form) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={t(loadError ?? 'forms.errors.internal')}
            action={(
              <Button asChild variant="outline">
                <Link href="/backend/forms">{t('forms.list.title')}</Link>
              </Button>
            )}
          />
        </PageBody>
      </Page>
    )
  }

  const sectionsForDerivation = resolveSectionViews(schema as Record<string, unknown>)
  const derivedPages = partitionPages(sectionsForDerivation)
  const density = resolveFormStyle(schema as Record<string, unknown>)
  const persistedLabelPosition = resolveFormLabelPosition(schema as Record<string, unknown>)
  const pageMode = resolvePageMode(schema as Record<string, unknown>)
  const persistedShowProgress = resolveShowProgress(schema as Record<string, unknown>)

  const canUndo = undoController.canUndo()
  const canRedo = undoController.canRedo()
  void undoNonce // re-render trigger after undo/redo

  const persistedHiddenFields = React.useMemo<HiddenFieldEntry[]>(() => {
    const raw = (schema as Record<string, unknown>)['x-om-hidden-fields']
    if (!Array.isArray(raw)) return []
    return raw
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      .map((entry) => ({
        name: String(entry.name ?? ''),
        defaultValue: typeof entry.defaultValue === 'string' ? entry.defaultValue : undefined,
      }))
      .filter((entry) => entry.name.length > 0)
  }, [schema])

  const paletteParameters = {
    formId,
    formKey: form.key,
    name: form.name,
    description: form.description ?? '',
    supportedLocales: form.supportedLocales,
    defaultActorRole: schema['x-om-default-actor-role'] ?? 'admin',
    declaredRoles,
    density,
    labelPosition: persistedLabelPosition,
    pageMode,
    showProgress: persistedShowProgress,
    pagesCount: derivedPages.length,
    hiddenFields: persistedHiddenFields,
    onNameChange: handleNameChange,
    onDescriptionChange: handleDescriptionChange,
    onDefaultActorRoleChange: handleDefaultActorRoleChange,
    onDensityChange: handleDensityChange,
    onLabelPositionChange: handleLabelPositionChange,
    onPageModeChange: handlePageModeChange,
    onShowProgressChange: handleShowProgressChange,
    onHiddenFieldsChange: handleHiddenFieldsChange,
  }

  return (
    <Page>
      <PageBody>
        <header className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{form.name}</h1>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{form.key}</span>
              <span className="mx-2">·</span>
              <span>{t('forms.studio.schemaHashLabel')}: <span className="font-mono">{(version?.schemaHash ?? '').slice(0, 12) || '—'}</span></span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Tag variant={version?.status === 'published' ? 'success' : 'warning'} dot>
              {t(version?.status === 'published'
                ? 'forms.studio.statusPublished'
                : version?.status === 'archived'
                  ? 'forms.studio.statusArchived'
                  : 'forms.studio.statusDraft')}
            </Tag>
            <span className="text-xs text-muted-foreground">
              {autosaveState === 'saving'
                ? t('forms.studio.autosave.saving')
                : autosaveState === 'error'
                  ? t('forms.studio.autosave.error')
                  : t('forms.studio.autosave.idle')}
            </span>
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleUndo}
              disabled={!canUndo}
              aria-label={t('forms.studio.undo.button.undo')}
              title={t('forms.studio.undo.button.undo')}
            >
              <Undo2 className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRedo}
              disabled={!canRedo}
              aria-label={t('forms.studio.undo.button.redo')}
              title={t('forms.studio.undo.button.redo')}
            >
              <Redo2 className="size-4" aria-hidden="true" />
            </IconButton>
            <Button asChild variant="outline">
              <Link href={`/backend/forms/${encodeURIComponent(formId)}/history`}>
                {t('forms.studio.actions.history')}
              </Link>
            </Button>
            <Button onClick={() => setShowPublishDialog(true)} disabled={!draftVersionId}>
              {t('forms.studio.actions.publish')}
            </Button>
          </div>
        </header>

        <Tabs value={topTab} onValueChange={(next) => setTopTab(next as StudioTopTab)}>
          <TabsList>
            <TabsTrigger value="builder">{t('forms.studio.tabs.top.builder')}</TabsTrigger>
            <TabsTrigger value="preview">{t('forms.studio.tabs.top.preview')}</TabsTrigger>
          </TabsList>
          <TabsContent value="builder">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
              accessibility={{ announcements }}
            >
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_320px]">
                <FormPalettePanel parameters={paletteParameters} />

                <section className="rounded-lg border border-border bg-card p-4">
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('forms.studio.panes.tree')}
                  </h2>
                  <FormCanvas
                    schema={schema}
                    selectedKey={selection}
                    onSelectField={selectField}
                    onSelectSection={selectSection}
                    onDeleteSection={(key) => { void handleDeleteSection(key) }}
                    onAdoptUngrouped={handleAdoptUngrouped}
                    onSectionTitleCommit={handleSectionTitleCommit}
                    focusSectionTitleKey={focusSectionTitleKey}
                    onSectionTitleFocusConsumed={() => setFocusSectionTitleKey(null)}
                    activeLocale={activeLocale}
                    t={t}
                  />
                </section>

                <aside className="rounded-lg border border-border bg-card p-4">
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('forms.studio.panes.properties')}
                  </h2>
                  {selection?.kind === 'section' ? (
                    <SectionPropertiesPanel
                      schema={schema}
                      sectionKey={selection.key}
                      activeLocale={activeLocale}
                      onColumnsChange={handleSectionColumnsChange}
                      onGapChange={handleSectionGapChange}
                      onDividerChange={handleSectionDividerChange}
                      onKindChange={handleSectionKindChange}
                      onHideTitleChange={handleSectionHideTitleChange}
                      onVisibilityChange={handleSectionVisibilityChange}
                      t={t}
                    />
                  ) : !selectedField || !selectedFieldKey ? (
                    <p className="text-sm text-muted-foreground">{t('forms.studio.empty')}</p>
                  ) : (
                    <FieldPropertiesPanel
                      schema={schema}
                      fieldKey={selectedFieldKey}
                      node={selectedField}
                      declaredRoles={declaredRoles}
                      required={(schema.required ?? []).includes(selectedFieldKey)}
                      activeLocale={activeLocale}
                      onUpdate={(updater) => handleFieldUpdate(selectedFieldKey, updater)}
                      onRequiredChange={(value) => handleRequiredToggle(selectedFieldKey, value)}
                      onDelete={() => handleDeleteField(selectedFieldKey)}
                      onGridSpanChange={handleFieldGridSpan}
                      onAlignChange={handleFieldAlign}
                      onHideMobileChange={handleFieldHideMobile}
                      onTypeSwap={handleFieldTypeSwap}
                      onVisibilityChange={handleFieldVisibilityChange}
                      t={t}
                    />
                  )}
                  <details className="mt-4">
                    <summary className="cursor-pointer text-xs font-medium uppercase text-muted-foreground">
                      {t('forms.studio.compiledJson')}
                    </summary>
                    <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-xs">
                      {selectedField
                        ? stableJsonStringify(selectedField)
                        : selectedSectionNode
                          ? stableJsonStringify(selectedSectionNode)
                          : '{}'}
                    </pre>
                  </details>
                </aside>
              </div>
              <DragOverlay>{dragOverlayContent}</DragOverlay>
            </DndContext>
          </TabsContent>

          <TabsContent value="preview">
            <section className="rounded-lg border border-border bg-card p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('forms.studio.panes.preview')}
                </h2>
                <div className="flex items-center gap-2 text-xs">
                  <span>{t('forms.studio.previewAs')}</span>
                  <Select value={previewRole} onValueChange={setPreviewRole}>
                    <SelectTrigger className="h-8 w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {previewRoles.map((role) => (
                        <SelectItem key={role} value={role}>{role}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <ViewportFrame
                viewport={previewViewport}
                onViewportChange={setPreviewViewport}
                t={t}
              >
                <PreviewSurface
                  schema={schema}
                  viewport={previewViewport}
                  previewRole={previewRole}
                  t={t}
                />
              </ViewportFrame>
            </section>
          </TabsContent>
        </Tabs>

        {showPublishDialog && draftVersionId && (
          <PublishDialog
            formId={formId}
            versionId={draftVersionId}
            onClose={() => setShowPublishDialog(false)}
            onPublished={() => {
              setShowPublishDialog(false)
              flash(t('forms.studio.actions.publish'), 'success')
              router.push(`/backend/forms/${encodeURIComponent(formId)}/history`)
            }}
            t={t}
          />
        )}
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}

type SectionPropertiesPanelProps = {
  schema: FormSchema
  sectionKey: string
  activeLocale: string
  onColumnsChange: (sectionKey: string, columns: 1 | 2 | 3 | 4) => void
  onGapChange: (sectionKey: string, gap: 'sm' | 'md' | 'lg') => void
  onDividerChange: (sectionKey: string, divider: boolean) => void
  onKindChange: (sectionKey: string, kind: 'page' | 'section') => void
  onHideTitleChange: (sectionKey: string, hideTitle: boolean) => void
  onVisibilityChange: (sectionKey: string, predicate: unknown | null) => void
  t: ReturnType<typeof useT>
}

function SectionPropertiesPanel(props: SectionPropertiesPanelProps) {
  const { schema, sectionKey, activeLocale, onVisibilityChange, t } = props
  const [tab, setTab] = React.useState<'style' | 'logic'>('style')
  const sections = (schema['x-om-sections'] ?? []) as SectionNode[]
  const section = sections.find((entry) => entry.key === sectionKey)
  if (!section) {
    return <p className="text-sm text-muted-foreground">{t('forms.studio.empty')}</p>
  }
  const isEnding = section.kind === 'ending'
  const sourceOptions = React.useMemo(
    () => buildFieldSourceOptions(schema, activeLocale, t),
    [schema, activeLocale, t],
  )
  return (
    <Tabs value={tab} onValueChange={(next) => setTab(next as 'style' | 'logic')}>
      <TabsList className="w-full justify-stretch">
        <TabsTrigger value="style" className="flex-1">
          {t('forms.studio.style.tabs.style')}
        </TabsTrigger>
        {!isEnding ? (
          <TabsTrigger value="logic" className="flex-1">
            {t('forms.studio.logic.tab.label')}
          </TabsTrigger>
        ) : null}
      </TabsList>
      <TabsContent value="style">
        <SectionStyleTabContent {...props} section={section} />
      </TabsContent>
      {!isEnding ? (
        <TabsContent value="logic">
          <ConditionBuilder
            predicate={(section as Record<string, unknown>)['x-om-visibility-if'] ?? null}
            sources={sourceOptions}
            onChange={(next) => onVisibilityChange(sectionKey, next)}
          />
        </TabsContent>
      ) : null}
    </Tabs>
  )
}

type SectionStyleTabContentProps = SectionPropertiesPanelProps & { section: SectionNode }

function SectionStyleTabContent({
  schema,
  sectionKey,
  section,
  onColumnsChange,
  onGapChange,
  onDividerChange,
  onKindChange,
  onHideTitleChange,
  t,
}: SectionStyleTabContentProps) {
  void schema
  const columns = section.columns ?? 1
  const gap = section.gap ?? 'md'
  const divider = section.divider === true
  const kind = section.kind ?? 'section'
  const hideTitle = section.hideTitle === true
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="block text-xs font-medium text-muted-foreground">
          {t('forms.studio.style.section.kind.label')}
        </label>
        <Select
          value={kind}
          onValueChange={(next) => onKindChange(sectionKey, (next as 'page' | 'section'))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="section">{t('forms.studio.style.section.kind.section')}</SelectItem>
            <SelectItem value="page">{t('forms.studio.style.section.kind.page')}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t('forms.studio.style.section.kind.helper')}
        </p>
      </div>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-muted-foreground">
          {t('forms.studio.style.section.columns.label')}
        </label>
        <Select
          value={String(columns)}
          onValueChange={(next) => onColumnsChange(sectionKey, Number(next) as 1 | 2 | 3 | 4)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1</SelectItem>
            <SelectItem value="2">2</SelectItem>
            <SelectItem value="3">3</SelectItem>
            <SelectItem value="4">4</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-muted-foreground">
          {t('forms.studio.style.section.gap.label')}
        </label>
        <Select
          value={gap}
          onValueChange={(next) => onGapChange(sectionKey, next as 'sm' | 'md' | 'lg')}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sm">{t('forms.studio.style.section.gap.sm')}</SelectItem>
            <SelectItem value="md">{t('forms.studio.style.section.gap.md')}</SelectItem>
            <SelectItem value="lg">{t('forms.studio.style.section.gap.lg')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium text-foreground">
          {t('forms.studio.style.section.divider.label')}
        </span>
        <Switch
          checked={divider}
          onCheckedChange={(value) => onDividerChange(sectionKey, Boolean(value))}
        />
      </label>
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium text-foreground">
          {t('forms.studio.style.section.hideTitle.label')}
        </span>
        <Switch
          checked={hideTitle}
          onCheckedChange={(value) => onHideTitleChange(sectionKey, Boolean(value))}
        />
      </label>
    </div>
  )
}

type FieldPropertiesPanelProps = {
  schema: FormSchema
  fieldKey: string
  node: FieldNode
  declaredRoles: string[]
  required: boolean
  activeLocale: string
  onUpdate: (updater: (node: FieldNode) => FieldNode) => void
  onRequiredChange: (value: boolean) => void
  onDelete: () => void
  onGridSpanChange: (fieldKey: string, span: 1 | 2 | 3 | 4) => void
  onAlignChange: (fieldKey: string, align: 'start' | 'center' | 'end') => void
  onHideMobileChange: (fieldKey: string, value: boolean) => void
  onTypeSwap: (fieldKey: string, targetType: string) => void
  onVisibilityChange: (fieldKey: string, predicate: unknown | null) => void
  t: ReturnType<typeof useT>
}

function findOwningSection(schema: FormSchema, fieldKey: string): SectionNode | null {
  const sections = (schema['x-om-sections'] ?? []) as SectionNode[]
  for (const section of sections) {
    if (section.fieldKeys.includes(fieldKey)) return section
  }
  return null
}

function FieldPropertiesPanel({
  schema,
  fieldKey,
  node,
  declaredRoles,
  required,
  activeLocale,
  onUpdate,
  onRequiredChange,
  onDelete,
  onGridSpanChange,
  onAlignChange,
  onHideMobileChange,
  onTypeSwap,
  onVisibilityChange,
  t,
}: FieldPropertiesPanelProps) {
  const [tab, setTab] = React.useState<'field' | 'style' | 'logic'>('field')
  const sourceOptions = React.useMemo(
    () => buildFieldSourceOptions(schema, activeLocale, t).filter((entry) => entry.value !== fieldKey),
    [schema, activeLocale, t, fieldKey],
  )
  const visibilityPredicate = node['x-om-visibility-if'] ?? null
  const owningSection = findOwningSection(schema, fieldKey)
  const sectionColumns = (owningSection?.columns ?? 1) as 1 | 2 | 3 | 4
  const omType = String(node['x-om-type'] ?? 'text')
  const isInfoBlock = omType === 'info_block'
  const persistedSpanRaw = node['x-om-grid-span']
  const persistedSpan: 1 | 2 | 3 | 4 =
    persistedSpanRaw === 2 || persistedSpanRaw === 3 || persistedSpanRaw === 4
      ? persistedSpanRaw
      : 1
  const align: 'start' | 'center' | 'end' =
    node['x-om-align'] === 'center' || node['x-om-align'] === 'end'
      ? (node['x-om-align'] as 'center' | 'end')
      : 'start'
  const hideMobile = node['x-om-hide-mobile'] === true
  const widthOptions = React.useMemo(() => {
    const max = sectionColumns
    const options: number[] = []
    for (let i = 1; i <= max; i += 1) options.push(i)
    return options
  }, [sectionColumns])
  const showWidth = !isInfoBlock && sectionColumns > 1
  const swapFamily = SWAP_FAMILIES[omType]
  const swapTargets = swapFamily ? Array.from(swapFamily) : null
  return (
    <Tabs value={tab} onValueChange={(next) => setTab(next as 'field' | 'style' | 'logic')}>
      <TabsList className="w-full justify-stretch">
        <TabsTrigger value="field" className="flex-1">
          {t('forms.studio.style.tabs.field')}
        </TabsTrigger>
        <TabsTrigger value="style" className="flex-1">
          {t('forms.studio.style.tabs.style')}
        </TabsTrigger>
        <TabsTrigger value="logic" className="flex-1">
          {t('forms.studio.logic.tab.label')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="field">
        <FieldTabContent
          fieldKey={fieldKey}
          node={node}
          declaredRoles={declaredRoles}
          required={required}
          onUpdate={onUpdate}
          onRequiredChange={onRequiredChange}
          onDelete={onDelete}
          onTypeSwap={onTypeSwap}
          omType={omType}
          swapTargets={swapTargets}
          t={t}
        />
      </TabsContent>
      <TabsContent value="style">
        <div className="space-y-3">
          {showWidth ? (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                {t('forms.studio.style.field.width.label')}
              </label>
              <Select
                value={String(Math.min(persistedSpan, sectionColumns))}
                onValueChange={(next) =>
                  onGridSpanChange(fieldKey, Number(next) as 1 | 2 | 3 | 4)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {widthOptions.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">
              {t('forms.studio.style.field.align.label')}
            </label>
            <Select
              value={align}
              onValueChange={(next) =>
                onAlignChange(fieldKey, next as 'start' | 'center' | 'end')
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="start">
                  {t('forms.studio.style.field.align.start')}
                </SelectItem>
                <SelectItem value="center">
                  {t('forms.studio.style.field.align.center')}
                </SelectItem>
                <SelectItem value="end">
                  {t('forms.studio.style.field.align.end')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium text-foreground">
              {t('forms.studio.style.field.hideMobile.label')}
            </span>
            <Switch
              checked={hideMobile}
              onCheckedChange={(value) => onHideMobileChange(fieldKey, Boolean(value))}
            />
          </label>
        </div>
      </TabsContent>
      <TabsContent value="logic">
        <ConditionBuilder
          predicate={visibilityPredicate}
          sources={sourceOptions}
          onChange={(next) => onVisibilityChange(fieldKey, next)}
        />
      </TabsContent>
    </Tabs>
  )
}

type FieldTabContentProps = {
  fieldKey: string
  node: FieldNode
  declaredRoles: string[]
  required: boolean
  onUpdate: (updater: (node: FieldNode) => FieldNode) => void
  onRequiredChange: (value: boolean) => void
  onDelete: () => void
  onTypeSwap: (fieldKey: string, targetType: string) => void
  omType: string
  swapTargets: string[] | null
  t: ReturnType<typeof useT>
}

function RoleCheckboxList({
  legend,
  selected,
  options,
  onToggle,
}: {
  legend: string
  selected: string[]
  options: string[]
  onToggle: (role: string, checked: boolean) => void
}) {
  return (
    <div>
      <span className="block text-xs font-medium text-muted-foreground">{legend}</span>
      <div className="mt-1 space-y-1">
        {options.map((role) => (
          <label key={role} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={selected.includes(role)}
              onCheckedChange={(value) => onToggle(role, Boolean(value))}
            />
            {role}
          </label>
        ))}
      </div>
    </div>
  )
}

function FieldTabContent({
  fieldKey,
  node,
  declaredRoles,
  required,
  onUpdate,
  onRequiredChange,
  onDelete,
  onTypeSwap,
  omType,
  swapTargets,
  t,
}: FieldTabContentProps) {
  const label = (node['x-om-label']?.en as string) ?? ''
  const help = (node['x-om-help']?.en as string) ?? ''
  const editableBy = (node['x-om-editable-by'] as string[] | undefined) ?? ['admin']
  const visibleTo = (node['x-om-visible-to'] as string[] | undefined) ?? []
  const sensitive = node['x-om-sensitive'] === true
  const roleOptions = React.useMemo(() => {
    const set = new Set<string>(['admin'])
    for (const role of declaredRoles) set.add(role)
    return Array.from(set)
  }, [declaredRoles])
  const toggleRole = React.useCallback(
    (keyword: 'x-om-editable-by' | 'x-om-visible-to', fallback: string[], role: string, checked: boolean) => {
      onUpdate((current) => {
        const next = new Set((current[keyword] as string[] | undefined) ?? fallback)
        if (checked) next.add(role)
        else next.delete(role)
        return { ...current, [keyword]: Array.from(next) }
      })
    },
    [onUpdate],
  )
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-muted-foreground">
          {t('forms.studio.field.type.label')}
        </label>
        {swapTargets && swapTargets.length > 1 ? (
          <Select
            value={omType}
            onValueChange={(next) => {
              if (next !== omType && isCompatibleFieldSwap(omType, next)) {
                onTypeSwap(fieldKey, next)
              }
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {swapTargets.map((value) => (
                <SelectItem key={value} value={value}>
                  {resolveTypeLabel(value, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm text-muted-foreground">{resolveTypeLabel(omType, t)}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {t('forms.studio.field.type.swapHint')}
        </p>
      </div>
      <div>
        <label className="block text-xs font-medium text-muted-foreground">{t('forms.studio.fields.label')}</label>
        <Input
          value={label}
          onChange={(event) => onUpdate((current) => ({
            ...current,
            'x-om-label': { ...(current['x-om-label'] ?? {}), en: event.target.value },
          }))}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted-foreground">{t('forms.studio.fields.help')}</label>
        <Textarea
          rows={2}
          value={help}
          onChange={(event) => onUpdate((current) => ({
            ...current,
            'x-om-help': { ...(current['x-om-help'] ?? {}), en: event.target.value },
          }))}
        />
      </div>
      <RoleCheckboxList
        legend={t('forms.studio.fields.editableBy')}
        selected={editableBy}
        options={roleOptions}
        onToggle={(role, checked) => toggleRole('x-om-editable-by', ['admin'], role, checked)}
      />
      <RoleCheckboxList
        legend={t('forms.studio.fields.visibleTo')}
        selected={visibleTo}
        options={roleOptions}
        onToggle={(role, checked) => toggleRole('x-om-visible-to', [], role, checked)}
      />
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={required} onCheckedChange={(value) => onRequiredChange(Boolean(value))} />
        {t('forms.studio.fields.required')}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={sensitive}
          onCheckedChange={(value) => onUpdate((current) => ({ ...current, 'x-om-sensitive': Boolean(value) }))}
        />
        {t('forms.studio.fields.sensitive')}
      </label>
      <Button type="button" variant="destructive-outline" onClick={onDelete}>
        <Trash2 className="size-4" aria-hidden="true" />
        {t('forms.studio.fields.deleteButton')}
      </Button>
    </div>
  )
}

type PublishDialogProps = {
  formId: string
  versionId: string
  onClose: () => void
  onPublished: () => void
  t: ReturnType<typeof useT>
}

function PublishDialog({ formId, versionId, onClose, onPublished, t }: PublishDialogProps) {
  const [changelog, setChangelog] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const submit = React.useCallback(async () => {
    if (busy) return
    setBusy(true)
    const call = await apiCall<{ versionId: string }>(
      `/api/forms/${encodeURIComponent(formId)}/versions/${encodeURIComponent(versionId)}/publish`,
      {
        method: 'POST',
        body: JSON.stringify({ changelog: changelog.trim() || null }),
      },
    )
    setBusy(false)
    if (!call.ok) {
      const errPayload = call.result as { error?: string } | undefined
      flash(errPayload?.error ?? 'forms.errors.internal', 'error')
      return
    }
    onPublished()
  }, [busy, changelog, formId, versionId, onPublished])

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void submit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('forms.version.publish.title')}</DialogTitle>
        </DialogHeader>
        <Alert variant="warning">{t('forms.version.publish.reassurance')}</Alert>
        <div>
          <label htmlFor="forms-publish-changelog" className="mb-1 block text-sm font-medium">
            {t('forms.version.publish.changelog')}
          </label>
          <Textarea
            id="forms-publish-changelog"
            rows={4}
            value={changelog}
            placeholder={t('forms.version.publish.changelogPlaceholder')}
            onChange={(event) => setChangelog(event.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t('forms.version.publish.blastRadius')}</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t('forms.version.publish.actions.cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            {t('forms.version.publish.actions.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
