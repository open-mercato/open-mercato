"use client"

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { ViewChip } from '@open-mercato/ui/backend/views/ViewChip'
import { NewViewForm } from '@open-mercato/ui/backend/views/NewViewForm'
import { apiCallOrThrow, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  buildDealTimelinePerspectiveSettings,
  parseDealTimelineSavedView,
  validateDealTimelineSavedViewForSave,
  type DealTimelineSavedView,
} from '../../../../../lib/dealsTimelineSavedView'

const logger = createLogger('customers').child({ component: 'TimelineSavedViews' })

export const TIMELINE_PERSPECTIVE_TABLE_ID = 'customers.deals.timeline'
const PERSPECTIVES_URL = `/api/perspectives/${encodeURIComponent(TIMELINE_PERSPECTIVE_TABLE_ID)}`
const SAVED_VIEWS_CONTEXT_ID = 'customers-deals-timeline:saved-views'

type PerspectiveRecord = {
  id: string
  name: string
  settings: unknown
  updatedAt?: string | null
}

type PerspectivesResponse = {
  perspectives?: PerspectiveRecord[]
}

type SavedViewsMutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

function readErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : null
  }
  return null
}

export function timelineSavedViewSignature(view: DealTimelineSavedView): string {
  const sorted = (values: string[]) => [...values].sort((left, right) => left.localeCompare(right))
  return JSON.stringify({
    status: sorted(view.status),
    pipelineId: view.pipelineId ?? null,
    ownerUserId: sorted(view.ownerUserId),
    personId: sorted(view.personId),
    companyId: sorted(view.companyId),
    excludeClosed: view.excludeClosed,
    groupBy: view.groupBy,
    bucket: view.bucket,
    search: view.search?.trim() || null,
  })
}

export type TimelineSavedViewsProps = {
  currentView: DealTimelineSavedView
  onApply: (view: DealTimelineSavedView) => void
}

export function TimelineSavedViews({ currentView, onApply }: TimelineSavedViewsProps): React.ReactElement {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<SavedViewsMutationContext>({
    contextId: SAVED_VIEWS_CONTEXT_ID,
    blockedMessage: translateWithFallback(t, 'ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const [applied, setApplied] = React.useState<{ id: string; signature: string } | null>(null)
  const currentSignature = React.useMemo(() => timelineSavedViewSignature(currentView), [currentView])
  const activeId = applied && applied.signature === currentSignature ? applied.id : null
  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const [nameError, setNameError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [renamingId, setRenamingId] = React.useState<string | null>(null)
  const [renameValue, setRenameValue] = React.useState('')
  const [deletingId, setDeletingId] = React.useState<string | null>(null)

  const queryKey = React.useMemo(() => ['perspectives', TIMELINE_PERSPECTIVE_TABLE_ID] as const, [])
  const perspectivesQuery = useQuery<PerspectiveRecord[]>({
    queryKey,
    staleTime: 30_000,
    queryFn: async () => {
      const payload = await readApiResultOrThrow<PerspectivesResponse>(PERSPECTIVES_URL, undefined, {
        errorMessage: translateWithFallback(t, 'customers.deals.timeline.savedViews.loadError', 'Failed to load saved views.'),
      })
      return Array.isArray(payload?.perspectives) ? payload.perspectives : []
    },
  })
  const perspectives = perspectivesQuery.data ?? []
  const reload = React.useCallback(() => queryClient.invalidateQueries({ queryKey }), [queryClient, queryKey])

  const duplicateMessage = translateWithFallback(
    t,
    'customers.deals.timeline.savedViews.duplicateName',
    'A view with this name already exists.',
  )

  const save = React.useCallback(
    async (input: { name: string; settings: unknown; perspectiveId?: string; updatedAt?: string | null }) => {
      const body: Record<string, unknown> = { name: input.name, settings: input.settings }
      if (input.perspectiveId) body.perspectiveId = input.perspectiveId
      else body.createOnly = true
      return runMutation({
        operation: () =>
          withScopedApiRequestHeaders(
            input.perspectiveId ? buildOptimisticLockHeader(input.updatedAt ?? null) : {},
            () =>
              apiCallOrThrow<{ perspective?: PerspectiveRecord }>(
                PERSPECTIVES_URL,
                {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(body),
                },
                {
                  errorMessage: translateWithFallback(
                    t,
                    'customers.deals.timeline.savedViews.saveError',
                    'Failed to save the view.',
                  ),
                },
              ),
          ),
        context: {
          formId: SAVED_VIEWS_CONTEXT_ID,
          resourceKind: 'perspectives.perspective',
          resourceId: input.perspectiveId ?? TIMELINE_PERSPECTIVE_TABLE_ID,
          retryLastMutation,
        },
        mutationPayload: body,
      })
    },
    [retryLastMutation, runMutation, t],
  )

  const handleWriteError = React.useCallback(
    (error: unknown, onDuplicate: () => void) => {
      if (readErrorCode(error) === 'duplicate_name') {
        onDuplicate()
        return
      }
      if (surfaceRecordConflict(error, t)) {
        void reload()
        return
      }
      const message =
        error instanceof Error && error.message
          ? error.message
          : translateWithFallback(t, 'customers.deals.timeline.savedViews.saveError', 'Failed to save the view.')
      flash(message, 'error')
    },
    [reload, t],
  )

  const handleCreate = React.useCallback(async () => {
    const name = newName.trim()
    if (!name) return
    const check = validateDealTimelineSavedViewForSave(currentView)
    if (!check.ok) {
      setNameError(
        check.field === 'search'
          ? translateWithFallback(
              t,
              'customers.deals.timeline.savedViews.searchTooLong',
              'The search text is too long to save in a view. Shorten it and try again.',
            )
          : check.field === 'status'
            ? translateWithFallback(
                t,
                'customers.deals.timeline.savedViews.statusInvalid',
                'A selected status is too long to save in a view. Change the Status filter and try again.',
              )
            : translateWithFallback(
                t,
                'customers.deals.timeline.savedViews.tooLarge',
                'This view has too many filter values to save. Narrow the filters and try again.',
              ),
      )
      return
    }
    setSaving(true)
    setNameError(null)
    try {
      const call = await save({ name, settings: buildDealTimelinePerspectiveSettings(currentView) })
      const created = call.result?.perspective
      if (created?.id) setApplied({ id: created.id, signature: currentSignature })
      setCreating(false)
      setNewName('')
      flash(translateWithFallback(t, 'customers.deals.timeline.savedViews.saved', 'View saved.'), 'success')
      await reload()
    } catch (error) {
      handleWriteError(error, () => setNameError(duplicateMessage))
    } finally {
      setSaving(false)
    }
  }, [currentSignature, currentView, duplicateMessage, handleWriteError, newName, reload, save, t])

  const handleRename = React.useCallback(
    async (perspective: PerspectiveRecord) => {
      const name = renameValue.trim()
      if (!name) return
      try {
        await save({ name, settings: perspective.settings, perspectiveId: perspective.id, updatedAt: perspective.updatedAt })
        setRenamingId(null)
        await reload()
      } catch (error) {
        handleWriteError(error, () => flash(duplicateMessage, 'error'))
      }
    },
    [duplicateMessage, handleWriteError, reload, renameValue, save],
  )

  const handleClone = React.useCallback(
    async (perspective: PerspectiveRecord) => {
      const name = translateWithFallback(t, 'customers.deals.timeline.savedViews.copyName', '{name} (copy)', {
        name: perspective.name,
      })
      try {
        await save({ name, settings: perspective.settings })
        await reload()
      } catch (error) {
        handleWriteError(error, () => flash(duplicateMessage, 'error'))
      }
    },
    [duplicateMessage, handleWriteError, reload, save, t],
  )

  const handleDelete = React.useCallback(
    async (perspective: PerspectiveRecord) => {
      const confirmed = await confirm({
        title: translateWithFallback(t, 'customers.deals.timeline.savedViews.deleteTitle', 'Delete view “{name}”?', {
          name: perspective.name,
        }),
        variant: 'destructive',
        confirmText: translateWithFallback(t, 'customers.deals.timeline.savedViews.delete', 'Delete'),
      })
      if (!confirmed) return
      setDeletingId(perspective.id)
      try {
        await runMutation({
          operation: () =>
            withScopedApiRequestHeaders(buildOptimisticLockHeader(perspective.updatedAt ?? null), () =>
              apiCallOrThrow(
                `${PERSPECTIVES_URL}/${encodeURIComponent(perspective.id)}`,
                { method: 'DELETE' },
                {
                  errorMessage: translateWithFallback(
                    t,
                    'customers.deals.timeline.savedViews.deleteError',
                    'Failed to delete the view.',
                  ),
                },
              ),
            ),
          context: {
            formId: SAVED_VIEWS_CONTEXT_ID,
            resourceKind: 'perspectives.perspective',
            resourceId: perspective.id,
            retryLastMutation,
          },
          mutationPayload: { id: perspective.id },
        })
        if (applied?.id === perspective.id) setApplied(null)
        await reload()
      } catch (error) {
        handleWriteError(error, () => undefined)
      } finally {
        setDeletingId(null)
      }
    },
    [applied, confirm, handleWriteError, reload, retryLastMutation, runMutation, t],
  )

  const handleActivate = React.useCallback(
    (perspective: PerspectiveRecord) => {
      const parsed = parseDealTimelineSavedView(perspective.settings)
      if (parsed.droppedFields.length) {
        logger.warn('Timeline saved view had invalid fields; defaults applied', {
          perspectiveId: perspective.id,
          droppedFields: parsed.droppedFields,
        })
      }
      setApplied({ id: perspective.id, signature: timelineSavedViewSignature(parsed.view) })
      onApply(parsed.view)
    },
    [onApply],
  )

  return (
    <div role="group" className="flex flex-wrap items-start gap-2" aria-label={translateWithFallback(t, 'customers.deals.timeline.savedViews.label', 'Saved views')}>
      <span className="pt-1.5 text-sm text-muted-foreground">
        {translateWithFallback(t, 'customers.deals.timeline.savedViews.label', 'Saved views')}
      </span>
      {perspectives.map((perspective) => (
        <ViewChip
          key={perspective.id}
          id={perspective.id}
          label={perspective.name}
          kind="personal"
          isActive={activeId === perspective.id}
          disabled={deletingId === perspective.id}
          isShared={false}
          isRenaming={renamingId === perspective.id}
          renameValue={renameValue}
          canApplyToRoles={false}
          deleting={deletingId === perspective.id}
          onActivate={() => handleActivate(perspective)}
          onRenameValueChange={setRenameValue}
          onRenameConfirm={() => void handleRename(perspective)}
          onRenameCancel={() => setRenamingId(null)}
          onRenameStart={() => {
            setRenamingId(perspective.id)
            setRenameValue(perspective.name)
          }}
          onClone={() => void handleClone(perspective)}
          onDelete={() => void handleDelete(perspective)}
        />
      ))}
      {creating ? (
        <div className="w-56">
          <NewViewForm
            name={newName}
            onNameChange={(value) => {
              setNewName(value)
              setNameError(null)
            }}
            onSubmit={() => void handleCreate()}
            onCancel={() => {
              setCreating(false)
              setNewName('')
              setNameError(null)
            }}
            saving={saving}
          />
          {nameError ? (
            <p role="alert" className="mt-1 text-xs text-status-error-text">
              {nameError}
            </p>
          ) : null}
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden="true" />
          {translateWithFallback(t, 'customers.deals.timeline.savedViews.save', 'Save view')}
        </Button>
      )}
      {ConfirmDialogElement}
    </div>
  )
}
