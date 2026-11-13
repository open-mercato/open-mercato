import { createCliPresentation } from '../engine/cli-presentation'
import { progressRenderer } from '../engine/progress'
import type { ProgressEvent } from '../engine/types'
import type { RotationProtectionContext } from '@open-mercato/shared/lib/encryption/rotationProtection'
import type { RotationPresentationPhase } from './coordinator'
import type { VerificationResult } from './verifier'

type Translate = (key: string, fallback: string) => string
type Output = Pick<NodeJS.WriteStream, 'write'> & Partial<Pick<NodeJS.WriteStream, 'isTTY' | 'columns' | 'rows'>>
const phases: RotationPresentationPhase[] = ['recovery', 'recovery-verification', 'baseline', 'rotating', 'verification', 'finalizing']
const titles: Record<RotationPresentationPhase, [string, string]> = {
  recovery: ['recovery', 'Create encrypted recovery backup'],
  'recovery-verification': ['recoveryVerify', 'Verify recovery backup'],
  baseline: ['baseline', 'Capture verification baseline'],
  rotating: ['rotate', 'Rotate encrypted data'],
  verification: ['verify', 'Verify persisted data'],
  finalizing: ['finalize', 'Finalize durable verification report'],
}

/** Owns stderr only; the Core CLI keeps its existing stdout summaries. */
export function createRotationPresentation(context: RotationProtectionContext, translate: Translate, environment: NodeJS.ProcessEnv, output: Output = process.stderr) {
  const mode = environment.OM_ROTATION_PROGRESS === 'json' ? 'json' : environment.OM_ROTATION_PROGRESS === 'none' ? 'none'
    : output.isTTY && environment.NO_COLOR === undefined && environment.TERM !== 'dumb' ? 'tty' : 'plain'
  const progress = progressRenderer(mode, output)
  const ui = createCliPresentation({ mode, output, suspend: () => progress.suspend() })
  const text = (key: string, fallback: string) => translate(`backups.rotation.presentation.${key}`, fallback)
  let runId = 'rotation', previous: RotationPresentationPhase | undefined
  const started = Date.now()
  const notice = (phase: string, message: string, counts?: Pick<ProgressEvent, 'rowsDone' | 'rowsTotal' | 'rowsTotalExact' | 'bytesDone'>) => {
    if (mode === 'json') {
      const event: ProgressEvent = { schemaVersion: 1, type: 'phase.changed', runId, phase: `rotation.${phase}`, entity: message, rowsDone: '0', rowsTotal: '0', rowsTotalExact: false, bytesDone: '0', chunksDone: 0, at: new Date().toISOString(), ...counts }
      output.write(JSON.stringify(event) + '\n')
    } else ui.notice(message)
  }
  ui.title(text('title', 'Protected key rotation'))
  return {
    progress,
    phase(phase: RotationPresentationPhase) {
      if (previous === phase) return
      if (previous && mode !== 'json') ui.status('ok', text(...titles[previous]))
      const title = phase === 'baseline' && environment.OM_ROTATION_RESUME_ID
        ? text('resumeBaseline', 'Validate the retained verification baseline') : text(...titles[phase])
      if (mode === 'json') notice(phase, title)
      else ui.step(phases.indexOf(phase) + 1, phases.length, title)
      previous = phase
    },
    prepared(id: string) {
      runId = id
      notice('prepared', `${text('run', 'Run')}: ${id}`)
    },
    completed(result: VerificationResult, report: string, backup: string) {
      // Called only after coordinator.protect resolves, including its final
      // journal/state fsyncs. A persisted receipt alone is not final success.
      if (previous === 'finalizing' && mode !== 'json') ui.status('ok', text(...titles.finalizing))
      const lines = [
        `${text('scope', 'Scope')}: ${context.tenantId ?? '*'} / ${context.organizationId ?? '*'}`,
        `${text('rows', 'Compared rows')}: ${result.comparedRows}/${result.expectedRows}`,
        `${text('fields', 'Compared fields')}: ${result.comparedFields}/${result.expectedFields}`,
        `${text('bytes', 'Compared bytes')}: ${result.comparedBytes}/${result.expectedBytes}`,
        `${text('elapsed', 'Elapsed')}: ${((Date.now() - started) / 1000).toFixed(1)}s`,
        `${text('run', 'Run')}: ${runId}`,
        `${text('report', 'Verification report')}: ${report}`,
        `${text('backup', 'Retained recovery backup')}: ${backup}`,
        translate('backups.rotation.verificationPassed', 'Persisted data verification passed for the declared rotation scope; retain previous keys and the recovery backup.'),
      ]
      if (mode === 'json') for (const line of lines) notice('completed', line, { rowsDone: result.comparedRows, rowsTotal: result.expectedRows, rowsTotalExact: true, bytesDone: result.comparedBytes })
      else ui.result(text('completed', 'Persisted data verification passed'), lines)
    },
    failed(message: string) {
      const lines = [message, `${text('run', 'Run')}: ${runId}`]
      if (runId !== 'rotation') lines.push(`${text('resume', 'Inspect the trusted run record before resuming the same command with')}: OM_ROTATION_RESUME_ID=${runId}`)
      if (mode === 'json') for (const line of lines) notice('failed', line)
      else ui.error(text('failed', 'ERROR: Protected key rotation incomplete'), lines)
    },
  }
}
