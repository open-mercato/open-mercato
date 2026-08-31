import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { BusinessHarnessRuntimeMode } from '../lib/runtime/businessHarnessMode'
import type { AgentRuntime } from './types'

const RUNTIME_FALLBACK: Record<AgentRuntime, string> = {
  'in-process': 'In Process',
  native: 'Native',
  'business-harness': 'Business Harness',
  external: 'External',
}

export function runtimeLabelKey(
  runtime: string,
  mode?: BusinessHarnessRuntimeMode | null,
): string {
  if (runtime === 'business-harness' && mode === 'standalone') {
    return 'agent_orchestrator.agents.list.runtime.business-harness-standalone'
  }
  return `agent_orchestrator.agents.list.runtime.${runtime}`
}

export function runtimeDisplayLabel(
  t: TranslateFn,
  runtime: string | null | undefined,
  mode?: BusinessHarnessRuntimeMode | null,
): string {
  if (!runtime) return '—'
  const fallback =
    runtime === 'business-harness' && mode === 'standalone'
      ? 'Business Harness (standalone)'
      : RUNTIME_FALLBACK[runtime as AgentRuntime] ?? runtime
  return t(runtimeLabelKey(runtime, mode), fallback)
}
