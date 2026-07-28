'use client'

import * as React from 'react'
import { CircleAlert, ClipboardPaste, Copy, TriangleAlert } from 'lucide-react'
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
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { WorkflowValidationIssue } from '../lib/collect-validation-issues'

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
}

/**
 * Code view, stage 1 (spec section 2.2).
 *
 * "Phase 3 (retirement precondition): read-only view + copy/paste of subgraphs +
 * JSON-schema validation display." Two-way live sync is Phase 5, so nothing here
 * edits: the panel renders the assembled definition JSON the page would save,
 * offers to copy it, offers to paste a copied selection back onto the canvas
 * through the SAME portable-subgraph format the canvas writes
 * (`lib/subgraph-clipboard.ts`), and shows the structured issue list beside it.
 *
 * Presentational on purpose — clipboard access, the splice and the undo entry
 * all belong to the page, which already owns them for the canvas path.
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
}: WorkflowCodeViewProps) {
  const t = useT()

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
            {t(
              'workflows.visualEditor.codeView.description',
              'The definition JSON this workflow would be saved as. It is read-only here — the canvas stays the source of truth.',
            )}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="flex flex-col gap-4">
          <section aria-labelledby="workflow-code-view-json">
            <h3 id="workflow-code-view-json" className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              {t('workflows.visualEditor.codeView.jsonTitle', 'Definition JSON')}
            </h3>
            <pre
              data-testid="workflow-code-view-json"
              tabIndex={0}
              className="max-h-[50vh] overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs text-foreground"
            >
              {definitionJson}
            </pre>
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
                  const isNavigable = Boolean(issue.nodeId || issue.edgeId) && Boolean(onIssueClick)
                  const severityLabel = issue.severity === 'error'
                    ? t('workflows.visualEditor.problems.severityError', 'Error')
                    : t('workflows.visualEditor.problems.severityWarning', 'Warning')
                  return (
                    <li key={issue.id}>
                      <Button
                        variant="ghost"
                        onClick={() => onIssueClick?.(issue)}
                        disabled={!isNavigable}
                        className={`flex h-auto w-full items-start justify-start gap-2 rounded-none px-3 py-1.5 text-left text-sm font-normal ${isNavigable ? 'hover:bg-muted' : 'cursor-default hover:bg-transparent'}`}
                      >
                        {issue.severity === 'error' ? (
                          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-error-text" aria-hidden="true" />
                        ) : (
                          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-warning-text" aria-hidden="true" />
                        )}
                        <span className="sr-only">{severityLabel}</span>
                        <span className="min-w-0 flex-1 text-foreground">{issue.message}</span>
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
          <Button onClick={onPasteSubgraph} disabled={!canPaste}>
            <ClipboardPaste className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t('workflows.visualEditor.codeView.pasteSubgraph', 'Paste steps')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
