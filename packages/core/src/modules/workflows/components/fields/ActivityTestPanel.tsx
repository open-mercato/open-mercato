'use client'

import * as React from 'react'
import { ChevronDown, Pin, PinOff, Play, TriangleAlert } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { LedgerEntry } from '../../lib/context-ledger'
import { resolveStepSample, type PinnedSampleEnvelope } from '../../lib/sample-resolver'

/**
 * Per-activity Test-step panel (spec 2026-07-26-workflows-ux-redesign.md
 * section 8.2, step 4.4, mockup Screen 2's "▶ Test step" affordance).
 *
 * Builds the sample context through `resolveStepSample` (pinned sample >
 * last in-panel test output > ledger-derived placeholder), POSTs to the
 * mock-first test-step API, and renders the outcome:
 * - simulated → formatted JSON output with a subtle "simulated" badge and a
 *   collapsible interpolated-config section, plus "Pin as sample"
 * - refused → a warning notice naming the structured refusal reason
 * - error → ErrorMessage with a retry action (403 gets its own message —
 *   there is no client-side feature check on this surface, mirroring the
 *   page's convention of letting the API gate and surfacing the denial)
 *
 * Pinning writes through the callbacks threaded from the visual-editor page
 * (which owns `metadata.editor.samples`); the panel itself stays stateless
 * about persistence. Samples are stored un-redacted with the definition, so
 * the no-redaction warning copy sits right next to the pin button. Unsaved
 * definitions (no id yet) disable the button with an i18n'd hint since the
 * API is anchored to a saved definition.
 */

export type ActivityTestOutcome =
  | { kind: 'simulated'; output: unknown; interpolatedConfig: Record<string, unknown> | null }
  | { kind: 'refused'; reason: 'refused' | 'noMock' }
  | { kind: 'error'; message: string }

type TestStepApiResult = {
  simulated?: boolean
  refused?: boolean
  reason?: string
  output?: unknown
  interpolatedConfig?: Record<string, unknown>
  error?: string
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

export interface ActivityTestPanelProps {
  definitionId: string | null
  stepId: string
  activityType: string
  config: Record<string, unknown>
  ledgerEntries?: LedgerEntry[]
  pinnedSample?: PinnedSampleEnvelope
  onPinSample: (data: unknown) => void
  onUnpinSample: () => void
  disabled?: boolean
}

export function ActivityTestPanel({
  definitionId,
  stepId,
  activityType,
  config,
  ledgerEntries,
  pinnedSample,
  onPinSample,
  onUnpinSample,
  disabled,
}: ActivityTestPanelProps) {
  const t = useT()
  const [isRunning, setIsRunning] = React.useState(false)
  const [outcome, setOutcome] = React.useState<ActivityTestOutcome | null>(null)
  const [lastOutput, setLastOutput] = React.useState<{ value: unknown } | null>(null)
  const [showInterpolated, setShowInterpolated] = React.useState(false)

  const runTest = React.useCallback(async () => {
    if (!definitionId) return
    setIsRunning(true)
    try {
      const resolved = resolveStepSample({
        stepId,
        samples: pinnedSample ? { [stepId]: pinnedSample } : undefined,
        testOutputs: lastOutput ? { [stepId]: lastOutput.value } : undefined,
        ledgerEntries,
      })
      const context = resolved && isPlainRecord(resolved.data) ? resolved.data : {}
      const response = await apiCall<TestStepApiResult>(
        `/api/workflows/definitions/${encodeURIComponent(definitionId)}/test-step`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stepId, activityType, config, context }),
        },
      )
      if (response.ok && response.result?.simulated) {
        const output = response.result.output ?? null
        setLastOutput({ value: output })
        setShowInterpolated(false)
        setOutcome({
          kind: 'simulated',
          output,
          interpolatedConfig: isPlainRecord(response.result.interpolatedConfig)
            ? response.result.interpolatedConfig
            : null,
        })
      } else if (response.ok && response.result?.refused) {
        setOutcome({
          kind: 'refused',
          reason: response.result.reason === 'refused' ? 'refused' : 'noMock',
        })
      } else if (response.status === 403) {
        setOutcome({ kind: 'error', message: t('workflows.testStep.notAllowed') })
      } else {
        setOutcome({ kind: 'error', message: t('workflows.testStep.failed') })
      }
    } catch {
      setOutcome({ kind: 'error', message: t('workflows.testStep.failed') })
    } finally {
      setIsRunning(false)
    }
  }, [definitionId, stepId, activityType, config, ledgerEntries, pinnedSample, lastOutput, t])

  const pinnedAtLabel = React.useMemo(() => {
    if (!pinnedSample) return null
    const parsed = new Date(pinnedSample.pinnedAt)
    return Number.isNaN(parsed.getTime()) ? pinnedSample.pinnedAt : parsed.toLocaleString()
  }, [pinnedSample])

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={runTest}
          disabled={disabled || isRunning || !definitionId}
        >
          <Play className="size-3 mr-1" />
          {isRunning ? t('workflows.testStep.running') : t('workflows.testStep.run')}
        </Button>
        <span className="text-xs text-muted-foreground">
          {definitionId ? t('workflows.testStep.hint') : t('workflows.testStep.unsavedHint')}
        </span>
      </div>

      {pinnedSample && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Pin className="size-3" aria-hidden="true" />
          <span>{t('workflows.testStep.pinnedAt', { time: pinnedAtLabel ?? '' })}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onUnpinSample}
            disabled={disabled}
          >
            <PinOff className="size-3 mr-1" />
            {t('workflows.testStep.unpin')}
          </Button>
        </div>
      )}

      {outcome?.kind === 'simulated' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">{t('workflows.testStep.outputTitle')}</span>
            <Badge variant="outline" className="text-xs">
              {t('workflows.testStep.simulatedBadge')}
            </Badge>
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted p-2 text-xs font-mono">
            {formatJson(outcome.output)}
          </pre>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onPinSample(outcome.output)}
              disabled={disabled}
            >
              <Pin className="size-3 mr-1" />
              {t('workflows.testStep.pin')}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t('workflows.testStep.noRedactionWarning')}
            </span>
          </div>
          {outcome.interpolatedConfig && (
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowInterpolated((current) => !current)}
                aria-expanded={showInterpolated}
              >
                <ChevronDown
                  className={`size-4 mr-1 transition-transform ${showInterpolated ? 'rotate-180' : ''}`}
                />
                {t('workflows.testStep.interpolatedConfig')}
              </Button>
              {showInterpolated && (
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted p-2 text-xs font-mono">
                  {formatJson(outcome.interpolatedConfig)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {outcome?.kind === 'refused' && (
        <div
          role="status"
          className="flex items-start gap-2 rounded border border-status-warning-border bg-status-warning-bg px-3 py-2 text-xs text-status-warning-text"
        >
          <TriangleAlert className="size-4 shrink-0 text-status-warning-icon" aria-hidden="true" />
          <span>{t(`workflows.testStep.refused.${outcome.reason}`)}</span>
        </div>
      )}

      {outcome?.kind === 'error' && (
        <ErrorMessage
          label={outcome.message}
          action={
            <Button type="button" variant="outline" size="sm" onClick={runTest} disabled={isRunning}>
              {t('workflows.testStep.retry')}
            </Button>
          }
        />
      )}
    </div>
  )
}
