'use client'

import * as React from 'react'
import { CircleAlert, Sparkles, TriangleAlert } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { WorkflowValidationIssue } from '../lib/collect-validation-issues'
import { WORKFLOW_DRAFT_PROMPT_MAX_LENGTH } from '../lib/ai-authoring'

/**
 * Prompt-to-draft (spec section 9).
 *
 * *"natural language → draft definition generated against the real catalogs,
 * opened in the Studio with a Problems pass already run. Never auto-published."*
 *
 * The dialog owns the PROMPT and the REVIEW; the page owns the apply, the undo
 * checkpoint and the Problems pass, because those are document operations and
 * the document lives there. `onApply` returns a refusal when the draft cannot
 * be applied, so the same four escalating refusals a pasted definition faces
 * (`lib/code-view-apply.ts`) are what an AI-authored one faces, and a refused
 * draft leaves the canvas byte-identical.
 *
 * Every failure mode is STATED. A missing AI provider, a failed call and a
 * model that produced something that is not a workflow each render their own
 * message — a surface that quietly does nothing is this module's recurring bug,
 * so there is no path here that ends in silence.
 */

export type WorkflowAiDraftApplyRefusal = {
  reason: 'parseError' | 'schemaError' | 'graphError'
  messages: string[]
}

export interface WorkflowAiDraftDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Apply the generated definition to the canvas. Returns `null` when it
   * landed, or the refusal to render when the shared gate rejected it.
   */
  onApply: (input: {
    definition: Record<string, unknown>
    prompt: string
  }) => WorkflowAiDraftApplyRefusal | null
  /** True when the canvas already holds steps — applying replaces all of them. */
  canvasHasContent: boolean
}

type GenerateResponse = {
  ok?: boolean
  reason?: 'unavailable' | 'failed' | 'malformedResponse' | 'schemaError'
  message?: string
  messages?: string[]
  summary?: string
  definition?: Record<string, unknown>
  problems?: WorkflowValidationIssue[]
  errorCount?: number
  warningCount?: number
  error?: string
}

type DraftState =
  | { kind: 'idle' }
  | { kind: 'generating' }
  | {
      kind: 'ready'
      prompt: string
      summary: string
      definition: Record<string, unknown>
      problems: WorkflowValidationIssue[]
      errorCount: number
      warningCount: number
    }
  | { kind: 'refused'; title: string; messages: string[] }

export function WorkflowAiDraftDialog({
  open,
  onOpenChange,
  onApply,
  canvasHasContent,
}: WorkflowAiDraftDialogProps) {
  const t = useT()
  const [prompt, setPrompt] = React.useState('')
  const [state, setState] = React.useState<DraftState>({ kind: 'idle' })

  // A dialog reopened onto the previous run's draft would offer an author a
  // definition they cannot see the prompt for. Reset on close.
  React.useEffect(() => {
    if (open) return
    setState({ kind: 'idle' })
  }, [open])

  const refuse = React.useCallback((title: string, messages: string[]) => {
    setState({ kind: 'refused', title, messages })
  }, [])

  const handleGenerate = React.useCallback(async () => {
    const trimmed = prompt.trim()
    if (!trimmed) return
    setState({ kind: 'generating' })
    let response
    try {
      response = await apiCall<GenerateResponse>('/api/workflows/definitions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: trimmed }),
      })
    } catch {
      refuse(t('workflows.aiDraft.failedTitle', 'The workflow could not be generated'), [
        t(
          'workflows.aiDraft.networkError',
          'The request did not reach the server. Nothing on the canvas was changed.',
        ),
      ])
      return
    }

    if (response.status === 403) {
      refuse(t('workflows.aiDraft.notAllowedTitle', 'Not allowed'), [
        t(
          'workflows.aiDraft.notAllowed',
          'You need permission to create workflow definitions to use AI authoring.',
        ),
      ])
      return
    }

    const result = response.result
    if (!response.ok || !result) {
      refuse(t('workflows.aiDraft.failedTitle', 'The workflow could not be generated'), [
        result?.error ??
          t('workflows.aiDraft.serverError', 'The server could not generate a draft. Nothing on the canvas was changed.'),
      ])
      return
    }

    if (result.ok !== true) {
      if (result.reason === 'unavailable') {
        refuse(t('workflows.aiDraft.unavailableTitle', 'AI authoring is not available'), [
          t(
            'workflows.aiDraft.unavailable',
            'No AI provider is configured for this installation, so nothing was generated and the canvas is unchanged. Ask an administrator to configure an AI provider.',
          ),
        ])
        return
      }
      if (result.reason === 'failed') {
        refuse(t('workflows.aiDraft.failedTitle', 'The workflow could not be generated'), [
          result.message ??
            t('workflows.aiDraft.modelError', 'The AI provider returned an error. Nothing on the canvas was changed.'),
        ])
        return
      }
      refuse(t('workflows.aiDraft.notAWorkflowTitle', 'The generated result is not a workflow'), [
        t(
          'workflows.aiDraft.notAWorkflow',
          'The model produced something that does not describe a workflow, so nothing was applied. Try rephrasing the request.',
        ),
        ...(result.messages ?? []),
      ])
      return
    }

    if (!result.definition) {
      refuse(t('workflows.aiDraft.failedTitle', 'The workflow could not be generated'), [
        t('workflows.aiDraft.serverError', 'The server could not generate a draft. Nothing on the canvas was changed.'),
      ])
      return
    }

    setState({
      kind: 'ready',
      prompt: trimmed,
      summary: result.summary ?? '',
      definition: result.definition,
      problems: result.problems ?? [],
      errorCount: result.errorCount ?? 0,
      warningCount: result.warningCount ?? 0,
    })
  }, [prompt, refuse, t])

  const handleApply = React.useCallback(() => {
    if (state.kind !== 'ready') return
    const refusal = onApply({ definition: state.definition, prompt: state.prompt })
    if (refusal) {
      refuse(t('workflows.aiDraft.cannotApplyTitle', 'This draft cannot be applied'), refusal.messages)
      return
    }
    onOpenChange(false)
  }, [state, onApply, onOpenChange, refuse, t])

  const isGenerating = state.kind === 'generating'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        onKeyDown={(event) => {
          if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return
          event.preventDefault()
          if (state.kind === 'ready') handleApply()
          else if (!isGenerating) void handleGenerate()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('workflows.aiDraft.title', 'Draft a workflow with AI')}</DialogTitle>
          <DialogDescription>
            {t(
              'workflows.aiDraft.description',
              'Describe the process in plain language. The draft is authored against this installation\'s real activities, commands and events, lands on the canvas as a single undoable step, and is never saved or enabled for you.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="workflow-ai-draft-prompt"
              className="mb-1.5 block text-xs font-semibold uppercase text-muted-foreground"
            >
              {t('workflows.aiDraft.promptLabel', 'What should this workflow do?')}
            </label>
            <textarea
              id="workflow-ai-draft-prompt"
              data-testid="workflow-ai-draft-prompt"
              value={prompt}
              maxLength={WORKFLOW_DRAFT_PROMPT_MAX_LENGTH}
              disabled={isGenerating}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t(
                'workflows.aiDraft.promptPlaceholder',
                'When a refund is requested above 500, ask a manager to approve it, then notify the customer.',
              )}
              className="min-h-32 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {/* The Alerts below pass no icon child: `Alert` renders its own
              status icon, and supplying one would draw it twice. */}
          {canvasHasContent && (
            <Alert variant="warning">
              <AlertTitle>
                {t('workflows.aiDraft.replaceTitle', 'Applying replaces the current canvas')}
              </AlertTitle>
              <AlertDescription>
                {t(
                  'workflows.aiDraft.replaceBody',
                  'Every step and route on the canvas is replaced. It is one undo away.',
                )}
              </AlertDescription>
            </Alert>
          )}

          {state.kind === 'refused' && (
            <Alert variant="destructive" data-testid="workflow-ai-draft-refusal">
              <AlertTitle>{state.title}</AlertTitle>
              <AlertDescription>
                {/* Rendered as blocks rather than a list: `AlertDescription`
                    is a `<p>`, and a nested `<ul>` is invalid HTML. */}
                {state.messages.map((message) => (
                  <span key={message} className="block">
                    {message}
                  </span>
                ))}
              </AlertDescription>
            </Alert>
          )}

          {state.kind === 'ready' && (
            <section
              aria-labelledby="workflow-ai-draft-review"
              data-testid="workflow-ai-draft-review"
              className="rounded-lg border border-border p-3"
            >
              <h3
                id="workflow-ai-draft-review"
                className="mb-2 text-xs font-semibold uppercase text-muted-foreground"
              >
                {t('workflows.aiDraft.reviewTitle', 'Review before applying')}
              </h3>
              {state.summary && <p className="mb-2 text-sm text-foreground">{state.summary}</p>}
              <p className="text-sm text-muted-foreground" data-testid="workflow-ai-draft-counts">
                {t('workflows.aiDraft.counts', '{steps} step(s), {routes} route(s)', {
                  steps: Array.isArray(state.definition.steps) ? state.definition.steps.length : 0,
                  routes: Array.isArray(state.definition.transitions)
                    ? state.definition.transitions.length
                    : 0,
                })}
                {' · '}
                {t('workflows.aiDraft.problemCounts', '{errors} error(s), {warnings} warning(s)', {
                  errors: state.errorCount,
                  warnings: state.warningCount,
                })}
              </p>
              {state.problems.length > 0 && (
                <ul
                  data-testid="workflow-ai-draft-problems"
                  className="mt-2 max-h-40 space-y-1 overflow-auto text-sm"
                >
                  {state.problems.map((issue) => (
                    <li key={issue.id} className="flex items-start gap-2">
                      {issue.severity === 'error' ? (
                        <CircleAlert
                          className="mt-0.5 h-4 w-4 shrink-0 text-status-error-text"
                          aria-hidden="true"
                        />
                      ) : (
                        <TriangleAlert
                          className="mt-0.5 h-4 w-4 shrink-0 text-status-warning-text"
                          aria-hidden="true"
                        />
                      )}
                      <span className="sr-only">
                        {issue.severity === 'error'
                          ? t('workflows.visualEditor.problems.severityError', 'Error')
                          : t('workflows.visualEditor.problems.severityWarning', 'Warning')}
                      </span>
                      <span className="min-w-0 flex-1 text-foreground">{issue.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            variant="outline"
            onClick={() => { void handleGenerate() }}
            disabled={isGenerating || prompt.trim().length === 0}
            data-testid="workflow-ai-draft-generate"
          >
            {isGenerating ? (
              <Spinner className="mr-1.5 h-4 w-4" />
            ) : (
              <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />
            )}
            {state.kind === 'ready'
              ? t('workflows.aiDraft.regenerate', 'Generate again')
              : t('workflows.aiDraft.generate', 'Generate draft')}
          </Button>
          <Button
            onClick={handleApply}
            disabled={state.kind !== 'ready'}
            data-testid="workflow-ai-draft-apply"
          >
            {t('workflows.aiDraft.apply', 'Apply to canvas')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
