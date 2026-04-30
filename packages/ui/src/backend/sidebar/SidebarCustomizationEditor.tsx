'use client'
import * as React from 'react'
import { ChevronUp, ChevronDown, GripVertical, RotateCcw, Trash2, Plus, Search, AlertTriangle } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Image from 'next/image'
import { resolveInjectedIcon } from '../injection/resolveInjectedIcon'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../primitives/button'
import { IconButton } from '../../primitives/icon-button'
import { Input } from '../../primitives/input'
import { Switch } from '../../primitives/switch'
import { Card, CardContent, CardHeader, CardTitle } from '../../primitives/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../primitives/dialog'
import { Tag } from '../../primitives/tag'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../primitives/select'
import { apiCall } from '../utils/apiCall'
import { flash } from '../FlashMessages'
import { Page, PageBody } from '../Page'
import { useBackendChrome } from '../BackendChromeProvider'
import { useConfirmDialog } from '../confirm-dialog'
import { useGuardedMutation } from '../injection/useGuardedMutation'
import {
  applyCustomizationDraft,
  applyItemOrder,
  cloneSidebarGroups,
  collectSidebarDefaults,
  filterMainSidebarGroups,
  mergeGroupOrder,
  resolveGroupKey,
  resolveItemKey,
  type SidebarCustomizationDraft,
  type SidebarGroup,
  type SidebarItem,
} from './customization-helpers'

export type SidebarCustomizationEditorProps = {
  onSaved?: () => void
  onCanceled?: () => void
  variantsApiPath?: string
  preferencesApiPath?: string
  groups?: SidebarGroup[]
}

const VARIANTS_API_DEFAULT = '/api/auth/sidebar/variants'
const PREFERENCES_API_DEFAULT = '/api/auth/sidebar/preferences'
const REFRESH_SIDEBAR_EVENT = 'om:refresh-sidebar'
const NEW_VARIANT_KEY = '__new__'

// Surface server-provided error messages directly when present (4xx with `error` field
// like 409 duplicate-name); fall back to the generic copy + status code for opaque 5xx.
function formatVariantApiError(
  call: { ok: boolean; status: number; result: unknown },
  t: (key: string, fallback?: string) => string,
): string {
  const detail = (call.result as { error?: unknown } | null)?.error
  if (typeof detail === 'string' && detail.length > 0 && call.status >= 400 && call.status < 500) {
    return detail
  }
  if (typeof detail === 'string' && detail.length > 0) {
    return `${t('appShell.sidebarCustomizationSaveError')} (${call.status}: ${detail})`
  }
  return `${t('appShell.sidebarCustomizationSaveError')} (${call.status})`
}

type RoleTarget = {
  id: string
  name: string
  hasPreference: boolean
}

type VariantSettings = {
  version: number
  groupOrder: string[]
  groupLabels: Record<string, string>
  itemLabels: Record<string, string>
  hiddenItems: string[]
  itemOrder?: Record<string, string[]>
}

type Variant = {
  id: string
  name: string
  isActive: boolean
  settings: VariantSettings
  createdAt: string
  updatedAt: string | null
}

type VariantListResponse = { locale: string; variants: Variant[] }
type VariantSingleResponse = { locale: string; variant: Variant }

function findItemByKey(items: SidebarItem[], targetKey: string): SidebarItem | null {
  for (const item of items) {
    if (resolveItemKey(item) === targetKey) return item
    if (item.children && item.children.length > 0) {
      const found = findItemByKey(item.children, targetKey)
      if (found) return found
    }
  }
  return null
}

function collectDescendantKeys(item: SidebarItem): string[] {
  const out: string[] = []
  const walk = (node: SidebarItem) => {
    if (!node.children) return
    for (const child of node.children) {
      out.push(resolveItemKey(child))
      walk(child)
    }
  }
  walk(item)
  return out
}

function parseDraftFromSettings(
  rawSettings: VariantSettings | null | undefined,
  baseSnapshot: SidebarGroup[],
): SidebarCustomizationDraft {
  const responseOrder = Array.isArray(rawSettings?.groupOrder)
    ? rawSettings.groupOrder
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter((id) => id.length > 0)
    : []
  const responseGroupLabels: Record<string, string> = {}
  if (rawSettings?.groupLabels && typeof rawSettings.groupLabels === 'object') {
    for (const [key, value] of Object.entries(rawSettings.groupLabels)) {
      if (typeof value !== 'string') continue
      const trimmedKey = key.trim()
      if (!trimmedKey) continue
      responseGroupLabels[trimmedKey] = value
    }
  }
  const responseItemLabels: Record<string, string> = {}
  if (rawSettings?.itemLabels && typeof rawSettings.itemLabels === 'object') {
    for (const [key, value] of Object.entries(rawSettings.itemLabels)) {
      if (typeof value !== 'string') continue
      const trimmedKey = key.trim()
      if (!trimmedKey) continue
      responseItemLabels[trimmedKey] = value
    }
  }
  const responseHiddenItems = Array.isArray(rawSettings?.hiddenItems)
    ? rawSettings.hiddenItems
        .map((itemId) => (typeof itemId === 'string' ? itemId.trim() : ''))
        .filter((itemId) => itemId.length > 0)
    : []
  const responseItemOrder: Record<string, string[]> = {}
  if (rawSettings?.itemOrder && typeof rawSettings.itemOrder === 'object') {
    for (const [groupKey, list] of Object.entries(rawSettings.itemOrder)) {
      if (!Array.isArray(list)) continue
      const trimmedGroup = groupKey.trim()
      if (!trimmedGroup) continue
      const seen = new Set<string>()
      const values: string[] = []
      for (const itemKey of list) {
        if (typeof itemKey !== 'string') continue
        const trimmedItem = itemKey.trim()
        if (!trimmedItem || seen.has(trimmedItem)) continue
        seen.add(trimmedItem)
        values.push(trimmedItem)
      }
      if (values.length > 0) responseItemOrder[trimmedGroup] = values
    }
  }
  const currentIds = baseSnapshot.map((group) => resolveGroupKey(group))
  const order = mergeGroupOrder(responseOrder, currentIds)
  const { itemDefaults } = collectSidebarDefaults(baseSnapshot)
  const hiddenItemIds: Record<string, boolean> = {}
  for (const itemId of responseHiddenItems) {
    if (!itemDefaults.has(itemId)) continue
    hiddenItemIds[itemId] = true
  }
  return {
    order,
    groupLabels: responseGroupLabels,
    itemLabels: responseItemLabels,
    hiddenItemIds,
    itemOrder: responseItemOrder,
  }
}

function emptyDraftFor(baseSnapshot: SidebarGroup[]): SidebarCustomizationDraft {
  return {
    order: baseSnapshot.map((group) => resolveGroupKey(group)),
    groupLabels: {},
    itemLabels: {},
    hiddenItemIds: {},
    itemOrder: {},
  }
}

export function SidebarCustomizationEditor({
  onSaved,
  onCanceled,
  variantsApiPath = VARIANTS_API_DEFAULT,
  preferencesApiPath = PREFERENCES_API_DEFAULT,
  groups: groupsProp,
}: SidebarCustomizationEditorProps) {
  const t = useT()
  const locale = useLocale()
  const localeLabel = (locale || '').toUpperCase()
  const { payload: chromePayload, isLoading: chromeIsLoading } = useBackendChrome()
  const groupsFromChrome = chromePayload?.groups as SidebarGroup[] | undefined
  const sourceGroups = groupsProp ?? groupsFromChrome ?? []
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()

  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [variants, setVariants] = React.useState<Variant[]>([])
  const [selectedVariantId, setSelectedVariantId] = React.useState<string | null>(null)
  const [variantName, setVariantName] = React.useState('')
  const [draft, setDraft] = React.useState<SidebarCustomizationDraft | null>(null)
  const [previewGroups, setPreviewGroups] = React.useState<SidebarGroup[]>([])
  const [dirty, setDirty] = React.useState(false)
  const [availableRoleTargets, setAvailableRoleTargets] = React.useState<RoleTarget[]>([])
  const [selectedRoleIds, setSelectedRoleIds] = React.useState<string[]>([])
  const [canApplyToRoles, setCanApplyToRoles] = React.useState(false)
  const [addDialogOpen, setAddDialogOpen] = React.useState(false)
  const [addDialogName, setAddDialogName] = React.useState('')
  const baseSnapshotRef = React.useRef<SidebarGroup[] | null>(null)
  const hasInitializedRef = React.useRef(false)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    variantId?: string | null
    operation: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'sidebar-customization',
    blockedMessage: t('appShell.sidebarCustomizationSaveError'),
  })

  const buildMutationContext = React.useCallback(
    (operation: string, variantId?: string | null) => ({
      formId: 'sidebar-customization',
      variantId: variantId ?? null,
      operation,
      retryLastMutation,
    }),
    [retryLastMutation],
  )

  const isNewVariant = selectedVariantId === null
  const selectedVariant = React.useMemo(
    () => (selectedVariantId ? variants.find((v) => v.id === selectedVariantId) ?? null : null),
    [selectedVariantId, variants],
  )

  const updateDraft = React.useCallback((updater: (draft: SidebarCustomizationDraft) => SidebarCustomizationDraft) => {
    setDraft((prev) => {
      if (!prev) return prev
      const next = updater(prev)
      if (baseSnapshotRef.current) {
        setPreviewGroups(applyCustomizationDraft(baseSnapshotRef.current, next))
      }
      return next
    })
    setDirty(true)
  }, [])

  const buildBaseSnapshot = React.useCallback((): SidebarGroup[] => {
    return filterMainSidebarGroups(cloneSidebarGroups(sourceGroups))
  }, [sourceGroups])

  const loadVariantsList = React.useCallback(async (): Promise<Variant[]> => {
    // Cache-bust to prevent stale browser/Next caches from masking just-created variants.
    const url = `${variantsApiPath}?_=${Date.now()}`
    const call = await apiCall<VariantListResponse>(url, { cache: 'no-store' })
    if (!call.ok) {
      throw new Error('list-failed')
    }
    return call.result?.variants ?? []
  }, [variantsApiPath])

  const loadRolesPayload = React.useCallback(async (): Promise<{ canApplyToRoles: boolean; roles: RoleTarget[] }> => {
    const call = await apiCall<{ canApplyToRoles?: boolean; roles?: Array<{ id?: string; name?: string; hasPreference?: boolean }> }>(preferencesApiPath)
    if (!call.ok) {
      return { canApplyToRoles: false, roles: [] }
    }
    const data = call.result ?? null
    const can = data?.canApplyToRoles === true
    const roles = Array.isArray(data?.roles)
      ? (data!.roles as Array<{ id?: string; name?: string; hasPreference?: boolean }>)
          .filter((r) => typeof r?.id === 'string' && typeof r?.name === 'string')
          .map((r) => ({ id: r.id as string, name: r.name as string, hasPreference: r.hasPreference === true }))
      : []
    return { canApplyToRoles: can, roles }
  }, [preferencesApiPath])

  const selectVariantInternal = React.useCallback((variant: Variant | null, list: Variant[]) => {
    const baseSnapshot = baseSnapshotRef.current ?? buildBaseSnapshot()
    baseSnapshotRef.current = baseSnapshot
    if (variant) {
      const initialDraft = parseDraftFromSettings(variant.settings, baseSnapshot)
      setSelectedVariantId(variant.id)
      setVariantName(variant.name)
      setDraft(initialDraft)
      setPreviewGroups(applyCustomizationDraft(baseSnapshot, initialDraft))
    } else {
      const empty = emptyDraftFor(baseSnapshot)
      setSelectedVariantId(null)
      // Suggest a default name based on the existing variants count.
      const usedNumbers = new Set<number>()
      for (const v of list) {
        if (v.name === 'My preferences') usedNumbers.add(1)
        const match = v.name.match(/^My preferences\s+(\d+)$/)
        if (match) usedNumbers.add(Number.parseInt(match[1], 10))
      }
      let next = 1
      while (usedNumbers.has(next)) next += 1
      const suggestion = next === 1 ? 'My preferences' : `My preferences ${next}`
      setVariantName(suggestion)
      setDraft(empty)
      setPreviewGroups(applyCustomizationDraft(baseSnapshot, empty))
    }
    setDirty(false)
  }, [buildBaseSnapshot])

  // Initial load. No cancelled flag because React Strict Mode in dev runs effects twice
  // and the cleanup-driven cancellation made the only init pass abort silently — leaving
  // `loading` true forever and the editor stuck on the "Loading…" placeholder. The init
  // gate (`hasInitializedRef`) prevents the second Strict-Mode run from doubling work.
  React.useEffect(() => {
    if (hasInitializedRef.current) return
    if (sourceGroups.length === 0) return
    hasInitializedRef.current = true
    async function init() {
      setLoading(true)
      setError(null)
      try {
        const [list, rolesPayload] = await Promise.all([
          loadVariantsList(),
          loadRolesPayload(),
        ])
        setVariants(list)
        setCanApplyToRoles(rolesPayload.canApplyToRoles)
        setAvailableRoleTargets(rolesPayload.roles)
        const active = list.find((v) => v.isActive)
        const initial = active ?? list[0] ?? null
        selectVariantInternal(initial, list)
        setSelectedRoleIds([])
      } catch (err) {
        console.error('Failed to load sidebar variants', err)
        setError(t('appShell.sidebarCustomizationLoadError'))
      } finally {
        setLoading(false)
      }
    }
    void init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceGroups.length])

  const toggleRoleSelection = React.useCallback((roleId: string) => {
    setSelectedRoleIds((prev) => (prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]))
    setDirty(true)
  }, [])

  const createNewVariant = React.useCallback(async (proposedName?: string): Promise<boolean> => {
    if (saving || deleting) return false
    if (dirty && selectedVariantId !== null) {
      const proceed = await confirmDialog({
        title: t('appShell.sidebarCustomizationSwitchConfirmTitle', 'Discard unsaved changes?'),
        text: t('appShell.sidebarCustomizationSwitchConfirmText', 'You have unsaved changes for the current variant. Switching will discard them.'),
        confirmText: t('appShell.sidebarCustomizationSwitchConfirmYes', 'Discard and switch'),
        cancelText: t('common.cancel', 'Cancel'),
        variant: 'destructive',
      })
      if (!proceed) return false
    }
    setSaving(true)
    setError(null)
    try {
      const baseSnapshot = baseSnapshotRef.current ?? buildBaseSnapshot()
      baseSnapshotRef.current = baseSnapshot
      const groupOrder = baseSnapshot.map((g) => resolveGroupKey(g))
      const trimmed = (proposedName ?? '').trim()
      const call = await runMutation({
        operation: () =>
          apiCall<VariantSingleResponse>(variantsApiPath, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              // If name is omitted, server auto-names ("My preferences", "My preferences 2", …).
              name: trimmed.length > 0 ? trimmed : undefined,
              settings: { groupOrder, groupLabels: {}, itemLabels: {}, hiddenItems: [], itemOrder: {} },
              isActive: true,
            }),
          }),
        context: buildMutationContext('createVariant'),
        mutationPayload: { name: trimmed.length > 0 ? trimmed : null },
      })
      if (!call.ok) {
        setError(formatVariantApiError(call, t))
        return false
      }
      const created = call.result?.variant ?? null
      // Trust POST response as authoritative; refetch in background for any side-effects
      // (e.g. server-side deactivation of previous active variant).
      let nextList: Variant[]
      try {
        nextList = await loadVariantsList()
      } catch {
        nextList = variants
      }
      // Defensive merge: ensure the just-created variant is in the list even if the
      // refetch happened to be served from a stale cache.
      if (created && !nextList.some((v) => v.id === created.id)) {
        nextList = [...nextList, created]
      }
      setVariants(nextList)
      if (created) {
        const fresh = nextList.find((v) => v.id === created.id) ?? created
        selectVariantInternal(fresh, nextList)
      }
      flash(t('appShell.sidebarCustomizationVariantCreated', 'Variant created.'), 'success')
      return true
    } catch (err) {
      console.error('Failed to create sidebar variant', err)
      setError(t('appShell.sidebarCustomizationSaveError'))
      return false
    } finally {
      setSaving(false)
    }
  }, [saving, deleting, dirty, selectedVariantId, confirmDialog, t, buildBaseSnapshot, variantsApiPath, loadVariantsList, selectVariantInternal, variants, runMutation, buildMutationContext])

  const handleVariantSwitch = React.useCallback(async (key: string) => {
    if (saving || deleting) return
    if (key === selectedVariantId) return
    if (key === NEW_VARIANT_KEY && isNewVariant) return
    if (dirty) {
      const proceed = await confirmDialog({
        title: t('appShell.sidebarCustomizationSwitchConfirmTitle', 'Discard unsaved changes?'),
        text: t('appShell.sidebarCustomizationSwitchConfirmText', 'You have unsaved changes for the current variant. Switching will discard them.'),
        confirmText: t('appShell.sidebarCustomizationSwitchConfirmYes', 'Discard and switch'),
        cancelText: t('common.cancel', 'Cancel'),
        variant: 'destructive',
      })
      if (!proceed) return
    }
    if (key === NEW_VARIANT_KEY) {
      selectVariantInternal(null, variants)
      return
    }
    const next = variants.find((v) => v.id === key) ?? null
    selectVariantInternal(next, variants)
  }, [saving, deleting, selectedVariantId, isNewVariant, dirty, confirmDialog, t, variants, selectVariantInternal])

  const moveGroup = React.useCallback((groupId: string, offset: number) => {
    updateDraft((draft) => {
      const order = [...draft.order]
      const index = order.indexOf(groupId)
      if (index === -1) return draft
      const nextIndex = Math.max(0, Math.min(order.length - 1, index + offset))
      if (nextIndex === index) return draft
      order.splice(index, 1)
      order.splice(nextIndex, 0, groupId)
      return { ...draft, order }
    })
  }, [updateDraft])

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )

  const handleItemDragEnd = React.useCallback((groupKey: string, currentItemKeys: string[]) => (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const fromId = String(active.id)
    const toId = String(over.id)
    updateDraft((draft) => {
      const baseOrder = draft.itemOrder?.[groupKey]?.length
        ? [...draft.itemOrder[groupKey]]
        : [...currentItemKeys]
      const fromIndex = baseOrder.indexOf(fromId)
      const toIndex = baseOrder.indexOf(toId)
      if (fromIndex === -1 || toIndex === -1) return draft
      const nextOrder = arrayMove(baseOrder, fromIndex, toIndex)
      return {
        ...draft,
        itemOrder: { ...(draft.itemOrder ?? {}), [groupKey]: nextOrder },
      }
    })
  }, [updateDraft])

  const setGroupLabel = React.useCallback((groupId: string, value: string) => {
    updateDraft((draft) => {
      const next = { ...draft.groupLabels }
      if (value.trim().length === 0) delete next[groupId]
      else next[groupId] = value
      return { ...draft, groupLabels: next }
    })
  }, [updateDraft])

  const setItemLabel = React.useCallback((itemId: string, value: string) => {
    updateDraft((draft) => {
      const next = { ...draft.itemLabels }
      if (value.trim().length === 0) delete next[itemId]
      else next[itemId] = value
      return { ...draft, itemLabels: next }
    })
  }, [updateDraft])

  const setItemHidden = React.useCallback((itemId: string, hidden: boolean) => {
    updateDraft((draft) => {
      const next = { ...draft.hiddenItemIds }
      const apply = (id: string) => {
        if (hidden) next[id] = true
        else delete next[id]
      }
      apply(itemId)
      // Cascade: hiding a parent hides every descendant; showing it reveals them too.
      if (baseSnapshotRef.current) {
        for (const group of baseSnapshotRef.current) {
          const target = findItemByKey(group.items, itemId)
          if (!target) continue
          for (const descendantKey of collectDescendantKeys(target)) apply(descendantKey)
          break
        }
      }
      return { ...draft, hiddenItemIds: next }
    })
  }, [updateDraft])

  const reset = React.useCallback(() => {
    if (!baseSnapshotRef.current) return
    if (selectedVariant) {
      const initialDraft = parseDraftFromSettings(selectedVariant.settings, baseSnapshotRef.current)
      setDraft(initialDraft)
      setPreviewGroups(applyCustomizationDraft(baseSnapshotRef.current, initialDraft))
    } else {
      const empty = emptyDraftFor(baseSnapshotRef.current)
      setDraft(empty)
      setPreviewGroups(applyCustomizationDraft(baseSnapshotRef.current, empty))
    }
    setDirty(false)
  }, [selectedVariant])

  const cancel = React.useCallback(() => {
    onCanceled?.()
  }, [onCanceled])

  const submitAddDialog = React.useCallback(async () => {
    const ok = await createNewVariant(addDialogName)
    if (ok) {
      setAddDialogOpen(false)
      setAddDialogName('')
    }
  }, [createNewVariant, addDialogName])

  const sanitizeSettingsPayload = React.useCallback(() => {
    if (!draft || !baseSnapshotRef.current) return null
    const baseGroups = baseSnapshotRef.current
    const { groupDefaults, itemDefaults } = collectSidebarDefaults(baseGroups)
    const sanitizedGroupLabels: Record<string, string> = {}
    for (const [key, value] of Object.entries(draft.groupLabels)) {
      const trimmed = value.trim()
      const base = groupDefaults.get(key)
      if (!trimmed || !base) continue
      if (trimmed !== base) sanitizedGroupLabels[key] = trimmed
    }
    const sanitizedItemLabels: Record<string, string> = {}
    for (const [itemId, value] of Object.entries(draft.itemLabels)) {
      const trimmed = value.trim()
      const base = itemDefaults.get(itemId)
      if (!trimmed || !base) continue
      if (trimmed !== base) sanitizedItemLabels[itemId] = trimmed
    }
    const sanitizedHiddenItems: string[] = []
    for (const [itemId, hidden] of Object.entries(draft.hiddenItemIds)) {
      if (!hidden) continue
      if (!itemDefaults.has(itemId)) continue
      sanitizedHiddenItems.push(itemId)
    }
    // Build a Set of valid group keys to drop stale itemOrder entries.
    const groupKeys = new Set<string>()
    for (const group of baseGroups) groupKeys.add(resolveGroupKey(group))
    const sanitizedItemOrder: Record<string, string[]> = {}
    for (const [groupKey, list] of Object.entries(draft.itemOrder ?? {})) {
      if (!groupKeys.has(groupKey)) continue
      const seen = new Set<string>()
      const values: string[] = []
      for (const itemKey of list) {
        if (seen.has(itemKey)) continue
        if (!itemDefaults.has(itemKey)) continue
        seen.add(itemKey)
        values.push(itemKey)
      }
      if (values.length > 0) sanitizedItemOrder[groupKey] = values
    }
    return {
      groupOrder: draft.order,
      groupLabels: sanitizedGroupLabels,
      itemLabels: sanitizedItemLabels,
      hiddenItems: sanitizedHiddenItems,
      itemOrder: sanitizedItemOrder,
    }
  }, [draft])

  const save = React.useCallback(async () => {
    const settings = sanitizeSettingsPayload()
    if (!settings) return
    setSaving(true)
    setError(null)
    try {
      const trimmedName = variantName.trim()
      const isCurrentlyActive = selectedVariant?.isActive ?? false
      let savedVariant: Variant | null = null
      if (isNewVariant) {
        const call = await runMutation({
          operation: () =>
            apiCall<VariantSingleResponse>(variantsApiPath, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                name: trimmedName.length > 0 ? trimmedName : undefined,
                settings,
                // New variants are activated by default — there's only one active per scope,
                // others get auto-deactivated server-side.
                isActive: true,
              }),
            }),
          context: buildMutationContext('saveVariant'),
          mutationPayload: { name: trimmedName.length > 0 ? trimmedName : null, isActive: true },
        })
        if (!call.ok) {
          setError(formatVariantApiError(call, t))
          return
        }
        savedVariant = call.result?.variant ?? null
      } else if (selectedVariantId) {
        const call = await runMutation({
          operation: () =>
            apiCall<VariantSingleResponse>(`${variantsApiPath}/${encodeURIComponent(selectedVariantId)}`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                name: trimmedName.length > 0 ? trimmedName : undefined,
                settings,
                isActive: isCurrentlyActive,
              }),
            }),
          context: buildMutationContext('saveVariant', selectedVariantId),
          mutationPayload: {
            id: selectedVariantId,
            name: trimmedName.length > 0 ? trimmedName : null,
            isActive: isCurrentlyActive,
          },
        })
        if (!call.ok) {
          setError(formatVariantApiError(call, t))
          return
        }
        savedVariant = call.result?.variant ?? null
      }
      // Sync user prefs and (optionally) push to roles via the legacy preferences endpoint.
      // The variant entity is the canonical "saved layout"; the preferences endpoint is what
      // the AppShell sidebar actually reads. Without this sync, the saved variant wouldn't
      // become the user's live sidebar.
      const preferencesPayload: Record<string, unknown> = {
        groupOrder: settings.groupOrder,
        groupLabels: settings.groupLabels,
        itemLabels: settings.itemLabels,
        hiddenItems: settings.hiddenItems,
        itemOrder: settings.itemOrder,
      }
      if (canApplyToRoles) {
        const applyToRolesPayload = [...selectedRoleIds]
        const clearRoleIdsPayload = availableRoleTargets
          .filter((role) => role.hasPreference && !selectedRoleIds.includes(role.id))
          .map((role) => role.id)
        preferencesPayload.applyToRoles = applyToRolesPayload
        preferencesPayload.clearRoleIds = clearRoleIdsPayload
      }
      const preferencesCall = await runMutation({
        operation: () =>
          apiCall(preferencesApiPath, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(preferencesPayload),
          }),
        context: buildMutationContext('savePreferences', selectedVariantId),
        mutationPayload: preferencesPayload,
      })
      if (!preferencesCall.ok) {
        // The variant entity is the canonical layout; the preferences sync is what the
        // AppShell sidebar actually reads. A failed sync would leave the saved variant
        // not reflected live, so surface it as a save error rather than flashing success.
        setError(formatVariantApiError(preferencesCall, t))
        return
      }
      try { window.dispatchEvent(new Event(REFRESH_SIDEBAR_EVENT)) } catch {}
      // Refresh the list so isActive flags are accurate, plus refresh roles so hasPreference flags update.
      const [list, rolesPayload] = await Promise.all([
        loadVariantsList(),
        loadRolesPayload(),
      ])
      // Defensive: ensure the just-saved variant lands in the list even if the refetch
      // was served stale (browser HTTP cache, etc.).
      const mergedList = savedVariant && !list.some((v) => v.id === savedVariant!.id)
        ? [...list, savedVariant]
        : list
      setVariants(mergedList)
      setCanApplyToRoles(rolesPayload.canApplyToRoles)
      setAvailableRoleTargets(rolesPayload.roles)
      if (savedVariant) {
        const fresh = mergedList.find((v) => v.id === savedVariant!.id) ?? savedVariant
        selectVariantInternal(fresh, mergedList)
      } else {
        const active = mergedList.find((v) => v.isActive) ?? mergedList[0] ?? null
        selectVariantInternal(active, mergedList)
      }
      flash(
        isNewVariant
          ? t('appShell.sidebarCustomizationVariantCreated', 'Variant created.')
          : t('appShell.sidebarCustomizationVariantSaved', 'Variant saved.'),
        'success',
      )
      onSaved?.()
    } catch (err) {
      console.error('Failed to save sidebar variant', err)
      setError(t('appShell.sidebarCustomizationSaveError'))
    } finally {
      setSaving(false)
    }
  }, [draft, variantName, isNewVariant, selectedVariant, selectedVariantId, variantsApiPath, preferencesApiPath, canApplyToRoles, selectedRoleIds, availableRoleTargets, t, sanitizeSettingsPayload, loadVariantsList, loadRolesPayload, selectVariantInternal, onSaved, runMutation, buildMutationContext])

  const toggleActive = React.useCallback(async (next: boolean) => {
    if (!selectedVariant || saving || deleting) return
    setError(null)
    try {
      const call = await runMutation({
        operation: () =>
          apiCall<VariantSingleResponse>(`${variantsApiPath}/${encodeURIComponent(selectedVariant.id)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ isActive: next }),
          }),
        context: buildMutationContext('toggleVariantActive', selectedVariant.id),
        mutationPayload: { id: selectedVariant.id, isActive: next },
      })
      if (!call.ok) {
        setError(t('appShell.sidebarCustomizationSaveError'))
        return
      }
      try { window.dispatchEvent(new Event(REFRESH_SIDEBAR_EVENT)) } catch {}
      const list = await loadVariantsList()
      setVariants(list)
      const fresh = list.find((v) => v.id === selectedVariant.id) ?? selectedVariant
      selectVariantInternal(fresh, list)
    } catch (err) {
      console.error('Failed to toggle variant active state', err)
      setError(t('appShell.sidebarCustomizationSaveError'))
    }
  }, [selectedVariant, saving, deleting, variantsApiPath, t, loadVariantsList, selectVariantInternal, runMutation, buildMutationContext])

  const deleteVariant = React.useCallback(async () => {
    if (!selectedVariant) return
    const proceed = await confirmDialog({
      title: t('appShell.sidebarCustomizationDeleteVariantTitle', 'Delete variant?'),
      text: t(
        'appShell.sidebarCustomizationDeleteVariantText',
        'This variant will be removed from your library.',
      ),
      confirmText: t('appShell.sidebarCustomizationDeleteVariantConfirm', 'Delete variant'),
      cancelText: t('common.cancel', 'Cancel'),
      variant: 'destructive',
    })
    if (!proceed) return
    setDeleting(true)
    setError(null)
    try {
      const call = await runMutation({
        operation: () =>
          apiCall(`${variantsApiPath}/${encodeURIComponent(selectedVariant.id)}`, { method: 'DELETE' }),
        context: buildMutationContext('deleteVariant', selectedVariant.id),
        mutationPayload: { id: selectedVariant.id },
      })
      if (!call.ok) {
        setError(t('appShell.sidebarCustomizationSaveError'))
        return
      }
      try { window.dispatchEvent(new Event(REFRESH_SIDEBAR_EVENT)) } catch {}
      const list = await loadVariantsList()
      setVariants(list)
      const fallback = list[0] ?? null
      selectVariantInternal(fallback, list)
    } catch (err) {
      console.error('Failed to delete variant', err)
      setError(t('appShell.sidebarCustomizationSaveError'))
    } finally {
      setDeleting(false)
    }
  }, [selectedVariant, confirmDialog, t, variantsApiPath, loadVariantsList, selectVariantInternal, runMutation, buildMutationContext])

  const isBusy = saving || deleting

  if (loading && !draft) {
    return (
      <>
        {ConfirmDialogElement}
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="h-7 w-64 animate-pulse rounded bg-muted" />
            <div className="h-4 w-96 animate-pulse rounded bg-muted/60" />
          </div>
          <div className="h-64 animate-pulse rounded-lg border bg-muted/30" />
        </div>
      </>
    )
  }

  if (!draft || !baseSnapshotRef.current) {
    // While chrome payload streams in or the initial fetch runs, show a neutral loading
    // state instead of the error fallback (otherwise the first visit looks like a crash).
    const stillLoading = loading || chromeIsLoading || sourceGroups.length === 0
    return (
      <>
        {ConfirmDialogElement}
        <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-sm text-muted-foreground">
          {stillLoading
            ? t('appShell.sidebarCustomizationLoading', 'Loading…')
            : (error ?? t('appShell.sidebarCustomizationLoadError'))}
        </div>
      </>
    )
  }

  const baseGroupsForDefaults = baseSnapshotRef.current
  const baseGroupMap = new Map<string, SidebarGroup>()
  for (const group of baseGroupsForDefaults) {
    baseGroupMap.set(resolveGroupKey(group), group)
  }
  const orderedGroupIds = mergeGroupOrder(draft.order, Array.from(baseGroupMap.keys()))
  const totalGroups = orderedGroupIds.length

  const selectValue = isNewVariant ? NEW_VARIANT_KEY : selectedVariantId ?? NEW_VARIANT_KEY
  const showVariantPicker = variants.length > 0 || isNewVariant

  return (
    <>
      {ConfirmDialogElement}
      <Dialog
        open={addDialogOpen}
        onOpenChange={(next) => {
          if (!next) {
            setAddDialogOpen(false)
            setAddDialogName('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('appShell.sidebarCustomizationAddDialogTitle', 'Add new variant')}
            </DialogTitle>
            <DialogDescription>
              {t('appShell.sidebarCustomizationAddDialogDescription', 'Choose a name for the new sidebar variant. Leave blank to auto-name it.')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              {t('appShell.sidebarCustomizationVariantNameLabel', 'Variant name')}
            </label>
            <Input
              autoFocus
              value={addDialogName}
              onChange={(event) => setAddDialogName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submitAddDialog()
                }
              }}
              placeholder={t('appShell.sidebarCustomizationVariantNamePlaceholder', 'My preferences')}
              disabled={saving}
            />
          </div>
          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAddDialogOpen(false)
                setAddDialogName('')
              }}
              disabled={saving}
            >
              {t('appShell.sidebarCustomizationCancel')}
            </Button>
            <Button
              type="button"
              onClick={() => { void submitAddDialog() }}
              disabled={saving}
            >
              {saving
                ? t('appShell.sidebarCustomizationCreating', 'Creating…')
                : t('appShell.sidebarCustomizationCreateVariant', 'Create variant')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Page>
        <header className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-semibold leading-tight">
            {t('appShell.sidebarCustomizationHeading')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('appShell.sidebarCustomizationHint', { locale: localeLabel })}
          </p>
        </header>

        {error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {/* Two-column: editor (variant + roles + order) + preview */}
        <PageBody className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
          <div className="space-y-6">
            {(() => {
              const showRolesCard = canApplyToRoles && availableRoleTargets.length > 0
              if (!showVariantPicker && !showRolesCard) return null
              return (
                <Card>
                  <CardContent className="flex flex-col gap-6">
                    {showVariantPicker ? (
                      <div className="flex flex-col gap-4">
                        {/* Row: combobox-style name input with chevron picker + DS-compliant add button */}
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                            {t('appShell.sidebarCustomizationVariantNameLabel', 'Variant name')}
                          </label>
                          <div className="flex items-stretch gap-2">
                            {/* Combobox group: input + chevron picker share a single visual border. */}
                            <div className="relative flex flex-1 items-stretch">
                              <Input
                                value={variantName}
                                onChange={(event) => {
                                  setVariantName(event.target.value)
                                  setDirty(true)
                                }}
                                placeholder={t('appShell.sidebarCustomizationVariantNamePlaceholder', 'My preferences')}
                                disabled={isBusy}
                                className="w-full pr-10"
                              />
                              <Select
                                value={selectValue}
                                onValueChange={(value) => { void handleVariantSwitch(value) }}
                                disabled={isBusy || loading}
                              >
                                <SelectTrigger
                                  className="pointer-events-none absolute inset-0 h-full w-full justify-end border-0 bg-transparent px-3 shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 [&>span]:hidden [&>svg]:pointer-events-auto"
                                  aria-label={t('appShell.sidebarCustomizationVariantPickerLabel', 'Pick variant')}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {variants.length > 0 ? (
                                    variants.map((variant) => (
                                      <SelectItem key={variant.id} value={variant.id}>
                                        {variant.name}
                                      </SelectItem>
                                    ))
                                  ) : (
                                    <SelectItem value={NEW_VARIANT_KEY} disabled>
                                      {t('appShell.sidebarCustomizationVariantsEmpty', 'No saved variants yet')}
                                    </SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                            </div>
                            <Button
                              type="button"
                              onClick={() => {
                                setAddDialogName('')
                                setAddDialogOpen(true)
                              }}
                              disabled={isBusy}
                              title={t('appShell.sidebarCustomizationVariantNew', 'Add new variant')}
                            >
                              <Plus className="size-4" />
                              {t('appShell.sidebarCustomizationCreateNew', 'Create new')}
                            </Button>
                          </div>
                        </div>

                        {isNewVariant ? (
                          <p className="text-xs text-muted-foreground">
                            {t('appShell.sidebarCustomizationVariantNewHint', 'Saving will create a new variant. If you leave the name blank, it will be auto-named.')}
                          </p>
                        ) : null}

                        {/* Row: active switch */}
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={selectedVariant?.isActive ?? isNewVariant}
                            onCheckedChange={(next) => {
                              if (isNewVariant) return
                              void toggleActive(next === true)
                            }}
                            disabled={isBusy || isNewVariant}
                            aria-label={t('appShell.sidebarCustomizationVariantActiveLabel', 'Active')}
                          />
                          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                            {t('appShell.sidebarCustomizationVariantActiveLabel', 'Active')}
                          </span>
                        </div>
                      </div>
                    ) : null}

                    {showVariantPicker && showRolesCard ? (
                      <div className="-mx-6 border-t" aria-hidden />
                    ) : null}

                    {showRolesCard ? (
                      <div className="flex flex-col gap-3">
                        <div className="space-y-1">
                          <h3 className="text-base font-semibold leading-none text-foreground">
                            {t('appShell.sidebarApplyToRolesTitle')}
                          </h3>
                          <p className="text-sm text-muted-foreground">{t('appShell.sidebarApplyToRolesDescription')}</p>
                        </div>
                        <div className="flex flex-col gap-1.5 max-w-sm">
                          {availableRoleTargets.map((role) => {
                            const checked = selectedRoleIds.includes(role.id)
                            const willClear = role.hasPreference && !checked
                            return (
                              <label
                                key={role.id}
                                className="flex cursor-pointer items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm transition-colors hover:bg-muted"
                              >
                                <Switch
                                  checked={checked}
                                  onCheckedChange={() => toggleRoleSelection(role.id)}
                                  disabled={isBusy}
                                />
                                <span className="flex-1 truncate font-medium text-foreground">{role.name}</span>
                                {role.hasPreference ? (
                                  <Tag variant={willClear ? 'error' : 'info'} dot={!willClear}>
                                    {willClear ? <AlertTriangle className="size-3" aria-hidden /> : null}
                                    {willClear ? t('appShell.sidebarRoleWillClear') : t('appShell.sidebarRoleHasPreset')}
                                  </Tag>
                                ) : null}
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    ) : null}

                    {/* Footer: Reset / Cancel / Save (right) + Delete (left). All gated on dirty
                        except Delete which acts on the persisted variant regardless of edits. */}
                    <div className="-mx-6 border-t" aria-hidden />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      {selectedVariant ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => { void deleteVariant() }}
                          disabled={isBusy}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                          {deleting
                            ? t('appShell.sidebarCustomizationDeleteVariantInProgress', 'Deleting…')
                            : t('appShell.sidebarCustomizationDeleteVariant', 'Delete variant')}
                        </Button>
                      ) : <span />}
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={reset}
                          disabled={isBusy || !dirty}
                        >
                          {t('appShell.sidebarCustomizationReset')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={cancel}
                          disabled={isBusy || !dirty}
                        >
                          {t('appShell.sidebarCustomizationCancel')}
                        </Button>
                        <Button
                          type="button"
                          onClick={save}
                          disabled={isBusy || (!isNewVariant && !dirty)}
                        >
                          {saving
                            ? (isNewVariant
                                ? t('appShell.sidebarCustomizationCreating', 'Creating…')
                                : t('appShell.sidebarCustomizationSaving'))
                            : (isNewVariant
                                ? t('appShell.sidebarCustomizationCreateVariant', 'Create variant')
                                : t('appShell.sidebarCustomizationSave'))}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })()}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t('appShell.sidebarCustomizationOrderHeading', 'Order & visibility')}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {t('appShell.sidebarCustomizationOrderDescription', 'Reorder groups, rename them, and toggle individual items on or off.')}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {orderedGroupIds.map((groupId, index) => {
                  const baseGroup = baseGroupMap.get(groupId)
                  if (!baseGroup) return null
                  const placeholder = baseGroup.defaultName ?? baseGroup.name
                  const value = draft.groupLabels[groupId] ?? ''
                  const trimmedValue = value.trim()
                  const isGroupModified = trimmedValue.length > 0 && trimmedValue !== placeholder
                  return (
                    <div key={groupId} className="rounded-lg border bg-background">
                      <div className="flex items-start gap-3 border-b px-4 py-3">
                        <div className="flex flex-1 flex-col gap-1.5">
                          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                            {t('appShell.sidebarCustomizationGroupLabel')}
                          </label>
                          <div className="flex items-center gap-2">
                            <Input
                              value={value}
                              onChange={(event) => setGroupLabel(groupId, event.target.value)}
                              placeholder={placeholder}
                              disabled={isBusy}
                              className="flex-1"
                            />
                            {isGroupModified ? (
                              <IconButton
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setGroupLabel(groupId, '')}
                                disabled={isBusy}
                                aria-label={t('appShell.sidebarCustomizationResetField', 'Reset to default')}
                                title={t('appShell.sidebarCustomizationResetField', 'Reset to default')}
                              >
                                <RotateCcw className="size-3.5" />
                              </IconButton>
                            ) : null}
                          </div>
                          {isGroupModified ? (
                            <p className="text-xs text-muted-foreground">
                              {t('appShell.sidebarCustomizationDefault', 'Default:')}{' '}
                              <span className="font-medium text-foreground/80">{placeholder}</span>
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1 mt-[26px]">
                          <IconButton
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => moveGroup(groupId, -1)}
                            disabled={index === 0 || isBusy}
                            aria-label={t('appShell.sidebarCustomizationMoveUp')}
                            title={t('appShell.sidebarCustomizationMoveUp')}
                          >
                            <ChevronUp className="size-4" />
                          </IconButton>
                          <IconButton
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => moveGroup(groupId, 1)}
                            disabled={index === totalGroups - 1 || isBusy}
                            aria-label={t('appShell.sidebarCustomizationMoveDown')}
                            title={t('appShell.sidebarCustomizationMoveDown')}
                          >
                            <ChevronDown className="size-4" />
                          </IconButton>
                        </div>
                      </div>
                      <div className="flex flex-col divide-y">
                        <ItemRows
                          items={baseGroup.items}
                          draft={draft}
                          saving={isBusy}
                          onLabelChange={setItemLabel}
                          onHiddenChange={setItemHidden}
                          t={t}
                          groupKey={groupId}
                          sensors={dndSensors}
                          onDragEnd={handleItemDragEnd(groupId, baseGroup.items.map((item) => resolveItemKey(item)))}
                        />
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </div>

          <aside className="hidden lg:block">
            <div className="sticky top-6">
              <div className="relative">
                <span className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1/2 rounded-md bg-accent-indigo px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent-indigo-foreground shadow-sm">
                  {t('appShell.sidebarCustomizationPreview', 'Preview')}
                </span>
                <SidebarPreview
                  groups={previewGroups}
                  productName={t('appShell.productName', 'Open Mercato')}
                  pickFirstActive
                />
              </div>
            </div>
          </aside>
        </PageBody>
      </Page>
    </>
  )
}

type ItemRowProps = {
  item: SidebarItem
  draft: SidebarCustomizationDraft
  saving: boolean
  onLabelChange: (itemId: string, value: string) => void
  onHiddenChange: (itemId: string, hidden: boolean) => void
  t: ReturnType<typeof useT>
  depth: number
  dragHandle?: React.ReactNode
  /** True when an ancestor in the tree is hidden — child controls become read-only. */
  ancestorHidden?: boolean
}

function ItemRow({ item, draft, saving, onLabelChange, onHiddenChange, t, depth, dragHandle, ancestorHidden = false }: ItemRowProps) {
  const itemKey = resolveItemKey(item)
  const placeholder = item.defaultTitle ?? item.title
  const value = draft.itemLabels[itemKey] ?? ''
  const trimmedValue = value.trim()
  const isModified = trimmedValue.length > 0 && trimmedValue !== placeholder
  const hidden = draft.hiddenItemIds[itemKey] === true
  const effectivelyDimmed = hidden || ancestorHidden
  return (
    <div
      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
      style={depth ? { paddingLeft: 16 + depth * 24 } : undefined}
    >
      {dragHandle ?? (depth > 0 ? <span className="w-4 shrink-0" aria-hidden /> : null)}
      <div className={`min-w-0 flex-1 flex flex-col gap-1.5 ${effectivelyDimmed ? 'opacity-60' : ''}`}>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Input
              value={value}
              onChange={(event) => onLabelChange(itemKey, event.target.value)}
              placeholder={placeholder}
              disabled={saving}
            />
          </div>
          {isModified ? (
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onLabelChange(itemKey, '')}
              disabled={saving}
              aria-label={t('appShell.sidebarCustomizationResetField', 'Reset to default')}
              title={t('appShell.sidebarCustomizationResetField', 'Reset to default')}
            >
              <RotateCcw className="size-3.5" />
            </IconButton>
          ) : null}
        </div>
        {isModified ? (
          <p className="text-xs text-muted-foreground">
            {t('appShell.sidebarCustomizationDefault', 'Default:')}{' '}
            <span className="font-medium text-foreground/80">{placeholder}</span>
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-1.5">
        {hidden ? (
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('appShell.sidebarCustomizationHiddenBadge', 'Hidden')}
          </span>
        ) : null}
        <Switch
          checked={!hidden}
          onCheckedChange={(next) => onHiddenChange(itemKey, next !== true)}
          disabled={saving || ancestorHidden}
          aria-label={t('appShell.sidebarCustomizationShowItem')}
          title={ancestorHidden ? t('appShell.sidebarCustomizationParentHiddenHint', 'Parent is hidden — show parent first.') : undefined}
        />
      </div>
    </div>
  )
}

type SortableItemRowProps = ItemRowProps & { id: string }

function SortableItemRow({ id, ...rowProps }: SortableItemRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, setActivatorNodeRef } = useSortable({ id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  const dragHandle = (
    <button
      ref={setActivatorNodeRef}
      type="button"
      className="shrink-0 mt-1.5 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
      aria-label="Drag to reorder"
      disabled={rowProps.saving}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-4" />
    </button>
  )
  return (
    <div ref={setNodeRef} style={style}>
      <ItemRow {...rowProps} dragHandle={dragHandle} />
    </div>
  )
}

type ItemRowsProps = {
  items: SidebarItem[]
  draft: SidebarCustomizationDraft
  saving: boolean
  onLabelChange: (itemId: string, value: string) => void
  onHiddenChange: (itemId: string, hidden: boolean) => void
  t: ReturnType<typeof useT>
  depth?: number
  groupKey?: string
  sensors?: ReturnType<typeof useSensors>
  onDragEnd?: (event: DragEndEvent) => void
  ancestorHidden?: boolean
}

function ItemRows({
  items,
  draft,
  saving,
  onLabelChange,
  onHiddenChange,
  t,
  depth = 0,
  groupKey,
  sensors,
  onDragEnd,
  ancestorHidden = false,
}: ItemRowsProps) {
  if (items.length === 0) return null

  const renderRecursiveChildren = (item: SidebarItem, parentHidden: boolean) =>
    item.children && item.children.length > 0 ? (
      <ItemRows
        items={item.children}
        draft={draft}
        saving={saving}
        onLabelChange={onLabelChange}
        onHiddenChange={onHiddenChange}
        t={t}
        depth={depth + 1}
        ancestorHidden={parentHidden}
      />
    ) : null

  // Top-level rows in a group → enable DnD reordering.
  if (depth === 0 && groupKey && sensors && onDragEnd) {
    const ordered = applyItemOrder(items, resolveItemKey, draft.itemOrder?.[groupKey])
    const ids = ordered.map((item) => resolveItemKey(item))
    return (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ordered.map((item) => {
            const itemKey = resolveItemKey(item)
            const ownHidden = draft.hiddenItemIds[itemKey] === true
            return (
              <React.Fragment key={itemKey}>
                <SortableItemRow
                  id={itemKey}
                  item={item}
                  draft={draft}
                  saving={saving}
                  onLabelChange={onLabelChange}
                  onHiddenChange={onHiddenChange}
                  t={t}
                  depth={depth}
                  ancestorHidden={ancestorHidden}
                />
                {renderRecursiveChildren(item, ancestorHidden || ownHidden)}
              </React.Fragment>
            )
          })}
        </SortableContext>
      </DndContext>
    )
  }

  // Nested children → static rendering, no drag handle.
  return (
    <>
      {items.map((item) => {
        const itemKey = resolveItemKey(item)
        const ownHidden = draft.hiddenItemIds[itemKey] === true
        return (
          <React.Fragment key={itemKey}>
            <ItemRow
              item={item}
              draft={draft}
              saving={saving}
              onLabelChange={onLabelChange}
              onHiddenChange={onHiddenChange}
              t={t}
              depth={depth}
              ancestorHidden={ancestorHidden}
            />
            {renderRecursiveChildren(item, ancestorHidden || ownHidden)}
          </React.Fragment>
        )
      })}
    </>
  )
}

function SidebarPreviewIcon({ item }: { item: SidebarItem }) {
  if (item.icon) return <>{item.icon}</>
  if (item.iconName) {
    const resolved = resolveInjectedIcon(item.iconName)
    if (resolved) return <>{resolved}</>
  }
  if (item.iconMarkup) {
    return <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: item.iconMarkup }} />
  }
  // Fallback default icon — same shape as AppShell's DefaultIcon
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function SidebarPreview({
  groups,
  productName,
  pickFirstActive,
}: {
  groups: SidebarGroup[]
  productName: string
  pickFirstActive: boolean
}) {
  // Pre-compute the first visible item so we can render it as the "active" preview state.
  // This shows the user what the active state of their sidebar will look like.
  const activeKey = React.useMemo<string | null>(() => {
    if (!pickFirstActive) return null
    for (const group of groups) {
      for (const item of group.items) {
        if (item.hidden === true) continue
        return resolveItemKey(item)
      }
    }
    return null
  }, [groups, pickFirstActive])

  return (
    <div className="relative w-[240px] overflow-hidden rounded-xl border bg-background shadow-sm">
      {/* Match AppShell's outer aside: border-r, py-4, px-3 — minus border-r since the
          card border already serves that purpose, plus rounded so it reads as a preview tile. */}
      <div className="flex flex-col gap-3 px-3 py-4">
        {/* Brand block — same classes as AppShell brand tile */}
        <div className="mb-2">
          <div className="flex items-center gap-3 rounded-xl p-3">
            <Image
              src="/open-mercato.svg"
              alt={productName}
              width={40}
              height={40}
              className="rounded-full shrink-0"
            />
            <span className="text-sm font-medium text-foreground truncate">{productName}</span>
          </div>
        </div>
        {/* Search input mock — same container styling as the real sidebar */}
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-background pl-2.5 pr-2 py-2 shadow-sm">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 text-sm text-muted-foreground/70 truncate">
            Search...
          </span>
        </div>
        {groups.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">No groups to preview.</p>
        ) : (
          <nav className="flex flex-col gap-2">
            {groups.map((group, gi) => {
              const visibleItems = group.items.filter((item) => item.hidden !== true)
              if (visibleItems.length === 0) return null
              return (
                <div key={resolveGroupKey(group)}>
                  <div className="w-full px-1 justify-between flex text-xs font-medium uppercase tracking-wider text-muted-foreground/70 py-1">
                    <span>{group.name}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {visibleItems.map((item) => {
                      const itemKey = resolveItemKey(item)
                      const isActive = activeKey === itemKey
                      return (
                        <div
                          key={itemKey}
                          className={`relative text-sm font-medium rounded-lg inline-flex items-center w-full px-3 py-2 gap-2 ${
                            isActive ? 'bg-muted text-foreground' : 'text-muted-foreground'
                          }`}
                        >
                          {isActive ? (
                            <span
                              aria-hidden
                              className="absolute left-[-12px] top-2 w-1 h-5 rounded-r bg-foreground"
                            />
                          ) : null}
                          <span className="flex items-center justify-center shrink-0">
                            <SidebarPreviewIcon item={item} />
                          </span>
                          <span className="truncate">{item.title}</span>
                        </div>
                      )
                    })}
                  </div>
                  {gi < groups.length - 1 ? <div className="my-2 border-t -ml-3 -mr-4" /> : null}
                </div>
              )
            })}
          </nav>
        )}
      </div>
    </div>
  )
}

export default SidebarCustomizationEditor
