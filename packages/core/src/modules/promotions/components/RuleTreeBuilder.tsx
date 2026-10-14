'use client'

// Top-level Rule Group Tree Builder (Step 1.7, SPEC-055 §UI/UX "Rule Group Tree
// Builder" / "Promotion Form" panel 4, "Rules & Benefits"). Owns the local tree state
// (`ruleTreeReducer`), a single `DndContext` scoping drag-and-drop by node type
// (rules→rule containers, sub-groups→sub-group containers, benefits→benefit
// containers — cross-type drops disabled per the spec), dirty tracking, and the Save
// button that PUTs the whole tree to `PUT /api/promotions/[id]/tree` (Step 1.4).
//
// Fetches the promotion's tree independently of the metadata `CrudForm` above it on the
// detail page (see `backend/promotions/[id]/page.tsx`) — the two save surfaces are
// deliberately decoupled, mirroring the pattern
// `customers/backend/customers/people-v2/[id]/page.tsx` uses for its embedded `CrudForm`
// plus a fully custom section with its own independent save. After every successful
// tree save this component reloads the tree from the server rather than trusting the
// PUT response (which only returns `{ ok, promotionId }`, not the new tree) — reloading
// is also what makes every previously-new node's server-minted `id` available for the
// NEXT save, which matters because a node still missing `id` after a save would be
// treated as "new" again on the following save and create a duplicate row.

import * as React from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { RuleGroupNode } from './RuleGroupNode'
import { ruleTreeReducer, type TreeAction } from './ruleTreeReducer'
import { fromServerTree, toServerTree, type LocalRuleGroupNode, type ServerRuleGroupTree } from './ruleTreeTypes'

const RESOURCE_KIND = 'promotions.promotion'

type PromotionTreeResponse = {
  updatedAt: string
  ruleGroupTree: ServerRuleGroupTree | null
}

function serialize(root: LocalRuleGroupNode | null): string {
  return root ? JSON.stringify(toServerTree(root)) : ''
}

function locateContainer(
  root: LocalRuleGroupNode,
  nodeId: string,
): { groupId: string; listKey: 'rules' | 'benefits' | 'children'; index: number } | null {
  const ruleIndex = root.rules.findIndex((rule) => rule.clientId === nodeId)
  if (ruleIndex !== -1) return { groupId: root.clientId, listKey: 'rules', index: ruleIndex }
  const benefitIndex = root.benefits.findIndex((benefit) => benefit.clientId === nodeId)
  if (benefitIndex !== -1) return { groupId: root.clientId, listKey: 'benefits', index: benefitIndex }
  const childIndex = root.children.findIndex((child) => child.clientId === nodeId)
  if (childIndex !== -1) return { groupId: root.clientId, listKey: 'children', index: childIndex }
  for (const child of root.children) {
    const found = locateContainer(child, nodeId)
    if (found) return found
  }
  return null
}

export type RuleTreeBuilderProps = {
  promotionId: string
}

export function RuleTreeBuilder({ promotionId }: RuleTreeBuilderProps) {
  const t = useT()
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null)
  const [root, setRoot] = React.useState<LocalRuleGroupNode | null>(null)
  const [savedSignature, setSavedSignature] = React.useState('')
  const [isSaving, setIsSaving] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const call = await apiCall<PromotionTreeResponse>(`/api/promotions/${encodeURIComponent(promotionId)}`, undefined, {
          fallback: { updatedAt: '', ruleGroupTree: null },
        })
        if (cancelled) return
        if (!call.ok || !call.result) {
          setLoadError(t('promotions.tree.loadError', 'Failed to load the promotion rule tree'))
          return
        }
        const localRoot = call.result.ruleGroupTree ? fromServerTree(call.result.ruleGroupTree) : null
        setRoot(localRoot)
        setUpdatedAt(call.result.updatedAt)
        setSavedSignature(serialize(localRoot))
      } catch {
        if (!cancelled) setLoadError(t('promotions.tree.loadError', 'Failed to load the promotion rule tree'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [promotionId, reloadToken, t])

  const dispatch = React.useCallback((action: TreeAction) => {
    setRoot((current) => (current ? ruleTreeReducer(current, action) : current))
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id || !root) return
      const from = locateContainer(root, String(active.id))
      const to = locateContainer(root, String(over.id))
      if (!from || !to) return
      // Type-scoped + same-group only: cross-type (rule ↔ sub-group ↔ benefit) and
      // cross-group drops are no-ops (SPEC-055 §UI/UX "Drag-and-drop within tree is
      // type-scoped... cross-type drops disabled").
      if (from.groupId !== to.groupId || from.listKey !== to.listKey) return
      if (from.listKey === 'rules') dispatch({ type: 'reorderRules', groupId: from.groupId, fromIndex: from.index, toIndex: to.index })
      else if (from.listKey === 'benefits') {
        dispatch({ type: 'reorderBenefits', groupId: from.groupId, fromIndex: from.index, toIndex: to.index })
      } else {
        dispatch({ type: 'reorderChildren', parentGroupId: from.groupId, fromIndex: from.index, toIndex: to.index })
      }
    },
    [dispatch, root],
  )

  const isDirty = root !== null && serialize(root) !== savedSignature

  const handleSave = React.useCallback(async () => {
    if (!root || !updatedAt) return
    setIsSaving(true)
    try {
      const call = await withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), () =>
        apiCall(`/api/promotions/${encodeURIComponent(promotionId)}/tree`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updatedAt, root: toServerTree(root) }),
        }),
      )
      if (!call.ok) {
        throw Object.assign(new Error('[internal] promotions.tree.put failed'), {
          status: call.status,
          ...((call.result as Record<string, unknown> | null) ?? {}),
        })
      }
      flash(t('promotions.tree.saved', 'Rule tree saved'), 'success')
      setReloadToken((value) => value + 1)
    } catch (error) {
      if (surfaceRecordConflict(error, t, { onRefresh: () => setReloadToken((value) => value + 1) })) return
      flash(t('promotions.tree.saveError', 'Could not save the rule tree'), 'error')
    } finally {
      setIsSaving(false)
    }
  }, [promotionId, root, t, updatedAt])

  if (isLoading) return <LoadingMessage label={t('promotions.tree.loading', 'Loading rule tree...')} />
  if (loadError) return <ErrorMessage label={loadError} />
  if (!root) return <ErrorMessage label={t('promotions.tree.loadError', 'Failed to load the promotion rule tree')} />

  return (
    <div className="space-y-4">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <RuleGroupNode group={root} depth={0} disabled={isSaving} dispatch={dispatch} />
      </DndContext>

      <div
        className={`sticky bottom-0 z-sticky flex items-center justify-end gap-3 border-t bg-background/95 py-3 backdrop-blur ${
          isDirty ? 'border-accent' : 'border-border'
        }`}
      >
        <span className="text-xs text-muted-foreground">
          {isDirty ? t('promotions.tree.unsavedHint', 'Unsaved changes') : t('promotions.tree.allSaved', 'All changes saved')}
        </span>
        <Button type="button" size="sm" disabled={!isDirty || isSaving} onClick={handleSave}>
          {isSaving ? <Spinner className="size-4" /> : null}
          {t('promotions.tree.save', 'Save rules')}
        </Button>
      </div>
    </div>
  )
}
