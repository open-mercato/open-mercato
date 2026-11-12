"use client"

import * as React from 'react'
import Link from 'next/link'
import type { Editor } from '@tiptap/core'
import { ListChecks, MessageSquare } from 'lucide-react'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Tabs, TabsList, TabsTrigger, useTabsContext } from '@open-mercato/ui/primitives/tabs'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CommentAnchor } from './CommentAnchorNavigation'
import { FindingCard, findingCardElementId } from './FindingCard'
import {
  FINDING_SEVERITIES,
  countDistinctSections,
  groupFindings,
  openFindingTotal,
  type DocumentFindingItem,
  type FindingSeverity,
} from './findingModel'
import { useDocumentFindings, type DocumentFindingsModel } from './useDocumentFindings'

type RailTab = 'changes' | 'comments'
type FindingGroupKey = FindingSeverity | 'decided'

const FINDING_NOTE_MAX_LENGTH = 2000

const GROUP_TITLE_KEYS: Record<FindingGroupKey, string> = {
  blocking: 'documents.findings.groups.blocking',
  warning: 'documents.findings.groups.warning',
  info: 'documents.findings.groups.info',
  decided: 'documents.findings.groups.decided',
}

const GROUP_HINT_KEYS: Partial<Record<FindingGroupKey, string>> = {
  blocking: 'documents.findings.groups.blockingHint',
  warning: 'documents.findings.groups.warningHint',
}

function RailTabPanel({ value, children }: { value: RailTab; children: React.ReactNode }) {
  const { value: selected, baseId } = useTabsContext()
  return (
    <div
      role="tabpanel"
      id={baseId ? `${baseId}-panel-${encodeURIComponent(value)}` : undefined}
      aria-labelledby={baseId ? `${baseId}-tab-${encodeURIComponent(value)}` : undefined}
      hidden={selected !== value}
      className="mt-3"
    >
      {children}
    </div>
  )
}

type DocumentReviewRailProps = {
  documentId: string
  editor: Editor | null
  canDecide: boolean
  commentFocusRequestId: number | null
  comments: React.ReactNode
  onNote?: (anchor: CommentAnchor) => void
}

export function DocumentReviewRail({
  documentId,
  editor,
  canDecide,
  commentFocusRequestId,
  comments,
  onNote,
}: DocumentReviewRailProps) {
  const t = useT()
  const [tab, setTab] = React.useState<RailTab>('comments')
  const [changesVisited, setChangesVisited] = React.useState(false)
  const userChoseTab = React.useRef(false)
  const showTab = React.useCallback((next: RailTab) => {
    setTab(next)
    if (next === 'changes') setChangesVisited(true)
  }, [])
  const selectTab = React.useCallback((next: RailTab) => {
    userChoseTab.current = true
    showTab(next)
  }, [showTab])
  const findings = useDocumentFindings({
    documentId,
    editor,
    listEnabled: changesVisited,
    canDecide,
    onDecorationFocus: () => selectTab('changes'),
  })
  const openTotal = openFindingTotal(findings.summary)

  React.useEffect(() => {
    if (!findings.summaryLoaded || userChoseTab.current) return
    if (openTotal > 0) showTab('changes')
  }, [findings.summaryLoaded, openTotal, showTab])

  React.useEffect(() => {
    if (commentFocusRequestId === null) return
    selectTab('comments')
  }, [commentFocusRequestId, selectTab])

  const handleNote = React.useCallback((finding: DocumentFindingItem) => {
    if (!onNote || !finding.anchor) return
    onNote(finding.anchor)
    selectTab('comments')
  }, [onNote, selectTab])

  return (
    <div data-testid="documents-review-rail">
      <Tabs
        value={tab}
        onValueChange={(value) => selectTab(value === 'changes' ? 'changes' : 'comments')}
        variant="underline"
      >
        <TabsList aria-label={t('documents.findings.rail.label')} className="w-full">
          <TabsTrigger
            value="changes"
            leading={<ListChecks className="size-4" />}
            count={findings.summaryLoaded ? openTotal : undefined}
          >
            {t('documents.findings.tab')}
          </TabsTrigger>
          <TabsTrigger value="comments" leading={<MessageSquare className="size-4" />}>
            {t('documents.comments.title')}
          </TabsTrigger>
        </TabsList>
        <RailTabPanel value="changes">
          {changesVisited ? (
            <FindingsPanel
              model={findings}
              canDecide={canDecide}
              editorEditable={Boolean(editor) && canDecide}
              onNote={onNote ? handleNote : undefined}
            />
          ) : null}
        </RailTabPanel>
        <RailTabPanel value="comments">{comments}</RailTabPanel>
      </Tabs>
    </div>
  )
}

type FindingsPanelProps = {
  model: DocumentFindingsModel
  canDecide: boolean
  editorEditable: boolean
  onNote?: (finding: DocumentFindingItem) => void
}

function ReviewHeader({ model }: { model: DocumentFindingsModel }) {
  const t = useT()
  const reviewed = model.findings.find((finding) => finding.status !== 'superseded') ?? model.findings[0]
  if (!reviewed) return null
  const reviewedAt = model.summary?.reviewedAt ?? reviewed.createdAt
  const sourceLabel = t(reviewed.source === 'import' ? 'documents.findings.header.sourceImport' : 'documents.findings.header.sourceAi')
  return (
    <div className="space-y-1 text-xs text-muted-foreground" data-testid="documents-findings-review-header">
      <p>
        {t('documents.findings.header.reviewed', {
          source: sourceLabel,
          sections: countDistinctSections(model.findings),
          time: new Date(reviewedAt).toLocaleString(),
        })}
      </p>
      {model.summary?.playbook ? (
        <p data-testid="documents-findings-review-playbook">
          {model.summary.playbook.version !== null
            ? t('documents.reviewPlaybooks.header.playbook', {
              name: model.summary.playbook.name,
              version: model.summary.playbook.version,
            })
            : t('documents.reviewPlaybooks.header.playbookNoVersion', { name: model.summary.playbook.name })}
        </p>
      ) : null}
      {reviewed.sourceWorkflowInstanceId ? (
        <p>
          {t('documents.findings.header.workflowInstance')}{' '}
          <Link className="font-mono text-primary underline-offset-4 hover:underline" href={`/backend/instances/${encodeURIComponent(reviewed.sourceWorkflowInstanceId)}`}>
            {reviewed.sourceWorkflowInstanceId}
          </Link>
        </p>
      ) : null}
      {reviewed.sourceAgentRunId ? (
        <p>
          {t('documents.findings.header.agentRun')}{' '}
          <span className="font-mono">{reviewed.sourceAgentRunId}</span>
        </p>
      ) : null}
    </div>
  )
}

export function FindingsPanel({ model, canDecide, editorEditable, onNote }: FindingsPanelProps) {
  const t = useT()
  const groups = React.useMemo(() => groupFindings(model.findings), [model.findings])
  const [collapsed, setCollapsed] = React.useState<Record<FindingGroupKey, boolean>>({
    blocking: false,
    warning: false,
    info: false,
    decided: true,
  })
  const [keepTarget, setKeepTarget] = React.useState<DocumentFindingItem | null>(null)
  const [keepNote, setKeepNote] = React.useState('')
  const [keepAttempted, setKeepAttempted] = React.useState(false)
  const noteRequired = keepTarget?.severity === 'blocking'
  const noteMissing = noteRequired && keepNote.trim().length === 0

  React.useEffect(() => {
    const request = model.focusRequest
    if (!request) return
    const finding = model.findings.find((candidate) => candidate.id === request.findingId)
    if (!finding) return
    const group: FindingGroupKey = finding.status === 'open' ? finding.severity : 'decided'
    setCollapsed((current) => (current[group] ? { ...current, [group]: false } : current))
    window.requestAnimationFrame(() => {
      const card = document.getElementById(findingCardElementId(finding.id))
      if (!card) return
      card.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      card.focus({ preventScroll: true })
    })
  }, [model.findings, model.focusRequest])

  const openKeepDialog = React.useCallback((finding: DocumentFindingItem) => {
    setKeepTarget(finding)
    setKeepNote('')
    setKeepAttempted(false)
  }, [])
  const closeKeepDialog = React.useCallback(() => {
    setKeepTarget(null)
    setKeepNote('')
    setKeepAttempted(false)
  }, [])
  const submitKeep = React.useCallback(async () => {
    if (!keepTarget) return
    setKeepAttempted(true)
    if (noteMissing) return
    const kept = await model.keepFinding(keepTarget, keepNote)
    if (kept) closeKeepDialog()
  }, [closeKeepDialog, keepNote, keepTarget, model, noteMissing])
  const keepKeyDown = useDialogKeyHandler({
    onConfirm: () => { void submitKeep() },
    onCancel: closeKeepDialog,
    disabled: model.pendingFindingId !== null,
  })

  const renderCards = (items: DocumentFindingItem[]) => (
    <div className="space-y-3">
      {items.map((finding) => (
        <FindingCard
          key={finding.id}
          finding={finding}
          resolution={model.resolutions[finding.id]}
          active={model.activeFindingId === finding.id}
          canDecide={canDecide}
          editorEditable={editorEditable}
          pending={model.pendingFindingId === finding.id}
          revertable={model.revertableFindingId === finding.id}
          onLocate={(target) => { void model.locateFinding(target) }}
          onApply={(target) => { void model.applyFinding(target) }}
          onKeep={openKeepDialog}
          onReopen={(target) => { void model.reopenFinding(target) }}
          onRevert={() => { void model.revertFinding() }}
          onNote={onNote}
        />
      ))}
    </div>
  )

  const groupKeys: FindingGroupKey[] = [...FINDING_SEVERITIES, 'decided']
  const visibleGroups = groupKeys.filter((key) => groups[key].length > 0)

  return (
    <section className="rounded-lg border border-border bg-card p-3 sm:p-4" aria-label={t('documents.findings.title')} data-testid="documents-findings-panel">
      <div className="space-y-4">
        {model.listState.status === 'loading' || model.listState.status === 'idle' ? (
          <LoadingMessage label={t('documents.findings.loading')} />
        ) : null}
        {model.listState.status === 'error' ? (
          <ErrorMessage
            label={t('documents.findings.error.load')}
            action={<Button type="button" size="sm" variant="outline" onClick={() => void model.reload()}>{t('documents.actions.retry')}</Button>}
          />
        ) : null}
        {model.listState.status === 'ready' && visibleGroups.length === 0 ? (
          <EmptyState size="sm" variant="subtle" title={t('documents.findings.empty')} icon={<ListChecks className="size-5" />} />
        ) : null}
        {model.listState.status === 'ready' && visibleGroups.length > 0 ? (
          <>
            <ReviewHeader model={model} />
            {visibleGroups.map((key) => (
              <div key={key} data-testid={`documents-findings-group-${key}`}>
                <CollapsibleSection
                  title={t(GROUP_TITLE_KEYS[key])}
                  count={groups[key].length}
                  collapsed={collapsed[key]}
                  onCollapsedChange={(next) => setCollapsed((current) => ({ ...current, [key]: next }))}
                >
                  {GROUP_HINT_KEYS[key] ? (
                    <p className="mb-2 text-xs text-muted-foreground">{t(GROUP_HINT_KEYS[key] ?? '')}</p>
                  ) : null}
                  {renderCards(groups[key])}
                </CollapsibleSection>
              </div>
            ))}
          </>
        ) : null}
      </div>
      <Dialog open={keepTarget !== null} onOpenChange={(open) => { if (!open) closeKeepDialog() }}>
        <DialogContent onKeyDown={keepKeyDown} data-testid="documents-finding-keep-dialog">
          <DialogHeader>
            <DialogTitle>{t('documents.findings.keep.title')}</DialogTitle>
            <DialogDescription>
              {t(noteRequired ? 'documents.findings.keep.descriptionRequired' : 'documents.findings.keep.description')}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault()
              void submitKeep()
            }}
          >
            <FormField
              id="documents-finding-keep-note"
              label={t(noteRequired ? 'documents.findings.keep.noteRequiredLabel' : 'documents.findings.keep.noteLabel')}
              error={keepAttempted && noteMissing ? t('documents.findings.keep.noteMissing') : undefined}
            >
              <Textarea
                value={keepNote}
                maxLength={FINDING_NOTE_MAX_LENGTH}
                onChange={(event) => setKeepNote(event.target.value)}
                autoFocus
                rows={4}
              />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeKeepDialog}>{t('documents.actions.cancel')}</Button>
              <Button type="submit" disabled={model.pendingFindingId !== null}>{t('documents.findings.keep.submit')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}

export default DocumentReviewRail
