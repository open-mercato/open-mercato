'use client'

import * as React from 'react'
import { CircleAlert, ClipboardPaste, Copy, RotateCcw, TriangleAlert } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@open-mercato/ui/primitives/drawer'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { WorkflowValidationIssue } from '../lib/collect-validation-issues'
import type { CodeViewDraftStatus } from '../lib/code-view-apply'

export interface WorkflowCodeViewProps {
  isOpen: boolean
  onClose: () => void
  /** Assembled definition JSON, already serialized by the page. */
  definitionJson: string
  issues: WorkflowValidationIssue[]
  onCopy: () => void
  onPasteSubgraph: () => void
  canPaste: boolean
  onIssueClick?: (issue: WorkflowValidationIssue) => void
  /** Stage 2 — the current editor text, owned by the page. */
  draftText: string
  onDraftChange: (text: string) => void
  onApply: () => void
  onRevert: () => void
  draftStatus: CodeViewDraftStatus
  /** Highest severity per 1-based line, for the gutter markers. */
  severityByLine: Map<number, 'error' | 'warning'>
  /** Line an issue row points at, keyed by issue id. */
  lineByIssueId: Map<string, number>
}

/**
 * Code view, stage 2 (spec section 2.2) — two-way sync with issue markers.
 *
 * **Safety model** (`lib/code-view-apply.ts` owns the rule):
 * canvas → code is LIVE; code → canvas needs an explicit Apply. Parsing,
 * validation and the markers stay live as you type, so the loop is immediate
 * even though the commit is not. Applying JSON that does not parse, does not
 * match the definition schema, or whose GRAPH is broken is refused with the
 * reason — a canvas holding a graph the engine rejects is worse than no apply,
 * because the author has lost the text they typed.
 *
 * The markers are GUTTER markers rather than underlines: a plain textarea
 * cannot decorate a substring, and a second overlaid highlight layer would
 * drift out of alignment with the textarea's own text metrics. Each marked line
 * carries its severity glyph and an `sr-only` name, so status is never
 * colour-only (section 4.6).
 *
 * The page still owns clipboard access, the splice, the undo entry and the
 * apply itself — this component is presentational.
 */
export function WorkflowCodeView({
  isOpen,
  onClose,
  definitionJson,
  issues,
  onCopy,
  onPasteSubgraph,
  canPaste,
  onIssueClick,
  draftText,
  onDraftChange,
  onApply,
  onRevert,
  draftStatus,
  severityByLine,
  lineByIssueId,
}: WorkflowCodeViewProps) {
  const t = useT()
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)

  const lineCount = React.useMemo(() => draftText.split('\n').length, [draftText])

  const focusLine = React.useCallback((line: number) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const lines = textarea.value.split('\n')
    const clamped = Math.max(1, Math.min(line, lines.length))
    let offset = 0
    for (let index = 0; index < clamped - 1; index += 1) offset += lines[index].length + 1
    textarea.focus()
    textarea.setSelectionRange(offset, offset + lines[clamped - 1].length)
  }, [])

  const handleIssueRow = React.useCallback((issue: WorkflowValidationIssue) => {
    const line = lineByIssueId.get(issue.id)
    if (line) focusLine(line)
    onIssueClick?.(issue)
  }, [lineByIssueId, focusLine, onIssueClick])

  return (
    <Drawer open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DrawerContent
        side="right"
        className="max-w-3xl"
        closeAriaLabel={t('common.close', 'Close')}
        aria-label={t('workflows.visualEditor.codeView.title', 'Code')}
      >
        <DrawerHeader>
          <DrawerTitle>{t('workflows.visualEditor.codeView.title', 'Code')}</DrawerTitle>
          <DrawerDescription>
            {t('workflows.visualEditor.codeView.descriptionEditable', 'The definition JSON this workflow would be saved as. Edit it and press Apply (or Cmd/Ctrl+Enter) to replace the canvas — the canvas keeps updating this text until you start typing.')}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="flex flex-col gap-4">
          <section aria-labelledby="workflow-code-view-json">
            <h3 id="workflow-code-view-json" className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              {t('workflows.visualEditor.codeView.jsonTitle', 'Definition JSON')}
            </h3>
            <div className="flex max-h-[50vh] overflow-auto rounded-lg border border-border bg-muted/40">
              <ol
                aria-hidden="true"
                data-testid="workflow-code-view-gutter"
                className="shrink-0 select-none border-r border-border px-2 py-3 text-right font-mono text-xs leading-5 text-muted-foreground"
              >
                {Array.from({ length: lineCount }, (unused, index) => {
                  const line = index + 1
                  const severity = severityByLine.get(line)
                  const isParseError = draftStatus.parseErrorLine === line
                  const marker = isParseError ? 'error' : severity
                  return (
                    <li
                      key={line}
                      data-line={line}
                      data-marker={marker ?? undefined}
                      className={
                        marker === 'error'
                          ? 'text-status-error-text'
                          : marker === 'warning'
                            ? 'text-status-warning-text'
                            : undefined
                      }
                    >
                      {marker ? (marker === 'error' ? '●' : '▲') : ''} {line}
                    </li>
                  )
                })}
              </ol>
              <textarea
                ref={textareaRef}
                data-testid="workflow-code-view-json"
                value={draftText}
                spellCheck={false}
                aria-label={t('workflows.visualEditor.codeView.jsonTitle', 'Definition JSON')}
                aria-invalid={draftStatus.blockingMessages.length > 0 || undefined}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault()
                    if (draftStatus.canApply) onApply()
                  }
                }}
                className="min-h-[40vh] flex-1 resize-none bg-transparent px-3 py-3 font-mono text-xs leading-5 text-foreground outline-none"
              />
            </div>
            {draftStatus.blockingMessages.length > 0 && (
              <Alert status="error" className="mt-2" icon={<CircleAlert aria-hidden="true" />}>
                <AlertTitle>{t('workflows.visualEditor.codeView.cannotApply', 'This JSON cannot be applied yet')}</AlertTitle>
                <AlertDescription>
                  <ul data-testid="workflow-code-view-blocking" className="list-disc space-y-0.5 pl-4">
                    {draftStatus.blockingMessages.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {draftStatus.dirty && draftStatus.canApply && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t('workflows.visualEditor.codeView.readyToApply', 'Ready to apply.')}
              </p>
            )}
            {!draftStatus.dirty && draftText !== definitionJson && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t('workflows.visualEditor.codeView.canvasChanged', 'The canvas changed; this text has been refreshed from it.')}
              </p>
            )}
          </section>
          <section aria-labelledby="workflow-code-view-issues">
            <h3 id="workflow-code-view-issues" className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              {t('workflows.visualEditor.codeView.validationTitle', 'Schema validation')}
            </h3>
            {issues.length === 0 ? (
              <p data-testid="workflow-code-view-clean" className="text-sm text-muted-foreground">
                {t('workflows.visualEditor.codeView.validationClean', 'No problems found in this definition.')}
              </p>
            ) : (
              <ul data-testid="workflow-code-view-issues" className="divide-y divide-border rounded-lg border border-border">
                {issues.map((issue) => {
                  const line = lineByIssueId.get(issue.id)
                  const isNavigable = Boolean(issue.nodeId || issue.edgeId) && Boolean(onIssueClick)
                  const severityLabel = issue.severity === 'error'
                    ? t('workflows.visualEditor.problems.severityError', 'Error')
                    : t('workflows.visualEditor.problems.severityWarning', 'Warning')
                  return (
                    <li key={issue.id}>
                      <Button
                        variant="ghost"
                        onClick={() => handleIssueRow(issue)}
                        disabled={!isNavigable}
                        data-issue-line={line ?? undefined}
                        className={`flex h-auto w-full items-start justify-start gap-2 rounded-none px-3 py-1.5 text-left text-sm font-normal ${isNavigable ? 'hover:bg-muted' : 'cursor-default hover:bg-transparent'}`}
                      >
                        {issue.severity === 'error' ? (
                          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-error-text" aria-hidden="true" />
                        ) : (
                          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-warning-text" aria-hidden="true" />
                        )}
                        <span className="sr-only">{severityLabel}</span>
                        <span className="min-w-0 flex-1 text-foreground">{issue.message}</span>
                        {line ? (
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            {t('workflows.visualEditor.codeView.lineNumber', 'line {line}', { line })}
                          </span>
                        ) : null}
                        {issue.nodeLabel && (
                          <span className="shrink-0 text-xs text-muted-foreground">{issue.nodeLabel}</span>
                        )}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </DrawerBody>
        <DrawerFooter>
          <Button variant="outline" onClick={onCopy}>
            <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t('workflows.visualEditor.codeView.copy', 'Copy JSON')}
          </Button>
          <Button variant="outline" onClick={onPasteSubgraph} disabled={!canPaste}>
            <ClipboardPaste className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t('workflows.visualEditor.codeView.pasteSubgraph', 'Paste steps')}
          </Button>
          <Button variant="outline" onClick={onRevert} disabled={!draftStatus.dirty}>
            <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t('workflows.visualEditor.codeView.revert', 'Discard edits')}
          </Button>
          <Button onClick={onApply} disabled={!draftStatus.canApply} data-testid="workflow-code-view-apply">
            {t('workflows.visualEditor.codeView.apply', 'Apply to canvas')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
