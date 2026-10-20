"use client"

import * as React from 'react'
import Link from 'next/link'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { buildQueryString, workflowDefinitionPagePath, xraySuggestionApiPath } from '../../lib/client/xray/api'
import { summarizeDraftPayload } from '../../lib/client/xray/draft'
import { formatCount, formatDecimal, formatPercent, formatWindowSeconds } from '../../lib/client/xray/format'
import type { XraySuggestion, XraySuggestionDraftResponse } from '../../lib/client/xray/types'
import { XrayDraftSummary } from './XrayDraftSummary'
import { XrayErrorNotice } from './XrayErrorNotice'
import { XrayWorkflowIdField } from './XrayWorkflowIdField'
import { describeNotDraftableReason, describeSuggestionRule } from './suggestionText'
import { readMutationError, useXrayMutations, useXrayResource, type XrayPermissions } from '../../lib/client/xray/hooks'

export const XRAY_SUGGESTION_REVIEW_CONTEXT_ID = 'insights-xray:suggestion-review'

export type XraySuggestionReviewDialogProps = {
  suggestion: XraySuggestion | null
  permissions: XrayPermissions
  onClose: () => void
  onUpdated: (suggestion: XraySuggestion) => void
}

export function describeCreateError(error: unknown, t: (key: string) => string): string {
  const { status } = readMutationError(error)
  if (status === 409) return t('insights.xray.ui.draft.createConflict')
  if (status === 403) return t('insights.xray.ui.draft.createForbidden')
  if (status === 400) return t('insights.xray.ui.draft.createInvalid')
  return t('insights.xray.ui.draft.createFailed')
}

/**
 * Reviews an automation suggestion: loads its disabled draft (`GET …/suggestions/{id}/draft`,
 * nothing is stored), shows what the workflow would do and, after a confirmation, creates it
 * as the user through `POST /api/workflows/definitions` and marks the suggestion `drafted`
 * with the new definition (optimistic lock on the suggestion's version). Cmd/Ctrl+Enter
 * creates, Escape cancels.
 */
export function XraySuggestionReviewDialog({ suggestion, permissions, onClose, onUpdated }: XraySuggestionReviewDialogProps) {
  const t = useT()
  const locale = useLocale()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { createWorkflowDefinition, updateSuggestion } = useXrayMutations(XRAY_SUGGESTION_REVIEW_CONTEXT_ID)
  const [workflowId, setWorkflowId] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [createdId, setCreatedId] = React.useState<string | null>(null)
  const open = suggestion !== null

  React.useEffect(() => {
    setWorkflowId(null)
    setCreatedId(null)
    setBusy(false)
  }, [suggestion?.id])

  const draftUrl = suggestion ? `${xraySuggestionApiPath(suggestion.id, 'draft')}${buildQueryString({ workflowId })}` : null
  const draft = useXrayResource<XraySuggestionDraftResponse>(draftUrl)
  const body = draft.data
  const summary = body?.draftable && body.payload ? summarizeDraftPayload(body.payload) : null
  const canCreate = Boolean(
    suggestion && summary && body?.payload && body.workflowIdAvailable !== false && permissions.canCreateWorkflows && !createdId && !busy && !draft.loading,
  )

  const handleCreate = React.useCallback(async () => {
    if (!suggestion || !body?.payload || !summary || busy) return
    setBusy(true)
    try {
      const confirmed = await confirm({
        title: t('insights.xray.ui.draft.confirmTitle'),
        text: t('insights.xray.ui.draft.confirmText', { name: summary.workflowName }),
        confirmText: t('insights.xray.ui.draft.create'),
      })
      if (!confirmed) return
      let definitionId: string | null = null
      try {
        definitionId = await createWorkflowDefinition(body.payload)
      } catch (error) {
        if (!surfaceRecordConflict(error, t)) flash(describeCreateError(error, t), 'error')
        return
      }
      if (!definitionId) {
        flash(t('insights.xray.ui.draft.createFailed'), 'error')
        return
      }
      setCreatedId(definitionId)
      if (!permissions.canManage) {
        flash(t('insights.xray.ui.draft.createdNotMarked'), 'success')
        return
      }
      try {
        const updated = await updateSuggestion(suggestion, { status: 'drafted', draftedArtifactId: definitionId })
        if (updated) onUpdated(updated)
        flash(t('insights.xray.ui.draft.created'), 'success')
      } catch (error) {
        if (!surfaceRecordConflict(error, t)) flash(t('insights.xray.ui.suggestions.markFailed'), 'error')
      }
    } finally {
      setBusy(false)
    }
  }, [body?.payload, busy, confirm, createWorkflowDefinition, onUpdated, permissions.canManage, suggestion, summary, t, updateSuggestion])

  const handleKeyDown = useDialogKeyHandler({ onConfirm: () => { void handleCreate() }, disabled: !canCreate })

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose() }}>
      <DialogContent size="lg" onKeyDown={handleKeyDown} data-testid="xray-suggestion-review-dialog">
        {ConfirmDialogElement}
        <DialogHeader>
          <DialogTitle>{t('insights.xray.ui.suggestions.reviewTitle')}</DialogTitle>
          <DialogDescription>{suggestion ? describeSuggestionRule(suggestion, t) : null}</DialogDescription>
        </DialogHeader>
        {suggestion ? (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {t('insights.xray.ui.suggestions.statistics', {
                support: formatCount(suggestion.support, locale),
                triggers: formatCount(suggestion.triggerCount, locale),
                window: formatWindowSeconds(suggestion.windowSeconds, t),
                confidence: formatPercent(suggestion.confidence, locale),
                lift: formatDecimal(suggestion.lift, locale),
                actors: formatCount(suggestion.distinctActorCount, locale),
              })}
            </p>
            {draft.loading && !body ? <LoadingMessage label={t('insights.xray.ui.draft.loading')} /> : null}
            {draft.error ? <XrayErrorNotice error={draft.error} onRetry={draft.reload} /> : null}
            {body && !body.draftable ? (
              <Alert status="information" size="default" data-testid="xray-draft-not-draftable">
                <AlertTitle>{t('insights.xray.ui.draft.notDraftable')}</AlertTitle>
                <AlertDescription>{describeNotDraftableReason(body.reason, t)}</AlertDescription>
              </Alert>
            ) : null}
            {summary ? (
              <XrayDraftSummary summary={summary} commands={body?.commands} workflowIdAvailable={body?.workflowIdAvailable !== false} />
            ) : null}
            {summary && body?.workflowIdAvailable === false && !createdId ? (
              <XrayWorkflowIdField initialValue={`${summary.workflowId}-2`} disabled={busy} onApply={setWorkflowId} />
            ) : null}
            {!permissions.loading && !permissions.canCreateWorkflows && summary ? (
              <p className="text-xs text-muted-foreground">{t('insights.xray.ui.draft.createNotAllowed')}</p>
            ) : null}
            {createdId ? (
              <Alert
                status="success"
                size="default"
                data-testid="xray-draft-created"
                footer={permissions.canViewWorkflows ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={workflowDefinitionPagePath(createdId)}>{t('insights.xray.ui.draft.openDraft')}</Link>
                  </Button>
                ) : undefined}
              >
                <AlertTitle>{t('insights.xray.ui.draft.createdTitle')}</AlertTitle>
                <AlertDescription>{t('insights.xray.ui.draft.createdDescription')}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {createdId ? t('insights.xray.ui.actions.close') : t('insights.xray.ui.actions.cancel')}
          </Button>
          {!createdId ? (
            <Button type="button" onClick={() => { void handleCreate() }} disabled={!canCreate} data-testid="xray-draft-create">
              {t('insights.xray.ui.draft.create')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
