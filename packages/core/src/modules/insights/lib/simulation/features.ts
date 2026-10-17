import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { SimulationKindDefinition } from '@open-mercato/shared/modules/insights/simulate'
import { listSimulationEventAdapters } from './registry'

const logger = createLogger('insights').child({ component: 'simulation-features' })

/**
 * Every feature a run of `definition` for `input` needs: the kind's `requiredFeatures` plus the
 * proposal's `inputFeatures` (e.g. the view feature of the record type a rule targets). A failing
 * `inputFeatures` is logged and answered with an unsatisfiable feature, so access fails closed.
 */
export function simulationRunFeatures(definition: SimulationKindDefinition, input: unknown): string[] {
  const features = new Set(definition.requiredFeatures)
  if (definition.inputFeatures) {
    try {
      for (const feature of definition.inputFeatures(input, { eventAdapters: listSimulationEventAdapters() })) {
        if (typeof feature === 'string' && feature.trim().length > 0) features.add(feature)
      }
    } catch (error) {
      logger.warn('[internal] A simulation kind could not list the features of a proposal', { kind: definition.kind, err: error })
      getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.simulation_input_features_failed', attributes: { kind: definition.kind } })
      features.add('__simulation_input_features_unavailable__')
    }
  }
  return Array.from(features)
}

/** The features of a stored run: its parsed proposal's features, or the kind's when the proposal no longer parses. */
export function storedRunFeatures(definition: SimulationKindDefinition, inputJson: unknown): string[] {
  const parsed = definition.inputSchema.safeParse(inputJson)
  return parsed.success ? simulationRunFeatures(definition, parsed.data) : [...definition.requiredFeatures]
}
