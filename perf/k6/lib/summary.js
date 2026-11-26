import { env, workload, workloadPath } from './config.js'
import { renderTextSummary } from './pure/summary-text.js'

export function makeHandleSummary(scenario, describe) {
  return function handleSummary(data) {
    const payload = {
      scenario,
      runId: env.runId,
      tier: env.tier,
      profile: env.profile,
      phase: env.phase || scenario,
      baseUrl: env.baseUrl,
      workloadPath,
      params: describe ? describe() : {},
      generatedAt: new Date().toISOString(),
      k6: data,
    }
    const outputs = { stdout: renderTextSummary(data, { title: `${scenario} (${env.runId})`, reference: workload.reference }) }
    if (env.summaryOut) outputs[env.summaryOut] = JSON.stringify(payload, null, 2)
    return outputs
  }
}
