/**
 * Pure payload builders for the visual editor's save and draft round trips.
 *
 * The editor rebuilds the definition from the graph and rebuilds metadata from
 * three edited fields on every save, so anything it does not explicitly carry
 * (the declared contextSchema, the sub-workflow io port contract, future
 * metadata.editor.* keys) would be silently dropped. These helpers centralize
 * that assembly: the definition payload re-attaches triggers, contextSchema,
 * and io next to the graph output, and the metadata payload spreads the
 * metadata object loaded from the server before overlaying the edited fields
 * so unknown keys survive load → save.
 */

import type {
  WorkflowContextSchema,
  WorkflowDefinitionData,
  WorkflowDefinitionTrigger,
  WorkflowIoContract,
} from '../data/entities'
import { resolveRequiredEngineVersion } from './engine-version'
import type { WorkflowInterpolationMode } from './interpolation-pipeline'

export type DefinitionPayloadInput = {
  graphDefinition: WorkflowDefinitionData
  triggers: WorkflowDefinitionTrigger[]
  contextSchema?: WorkflowContextSchema | null
  io?: WorkflowIoContract | null
  interpolation?: WorkflowInterpolationMode | null
}

export function buildDefinitionPayload({ graphDefinition, triggers, contextSchema, io, interpolation }: DefinitionPayloadInput): WorkflowDefinitionData {
  return {
    ...graphDefinition,
    triggers: triggers.length > 0 ? triggers : undefined,
    contextSchema: contextSchema ?? undefined,
    io: io ?? undefined,
    interpolation: interpolation ?? undefined,
  }
}

export type MetadataPayloadInput = {
  loadedMetadata: Record<string, unknown> | null
  tags: string[]
  category: string
  icon: string
  /**
   * Definition being saved. Used to stamp `minEngineVersion` when the graph
   * contains a step type older engines cannot execute (spec section 5.8).
   * Definitions that need nothing beyond the baseline keep no such key, so
   * saving an existing workflow stays byte-identical.
   */
  definition?: { steps?: unknown } | null
}

export function buildMetadataPayload({ loadedMetadata, tags, category, icon, definition }: MetadataPayloadInput): Record<string, unknown> | null {
  const metadata: Record<string, unknown> = { ...(loadedMetadata ?? {}) }
  if (category) metadata.category = category
  else delete metadata.category
  if (tags.length > 0) metadata.tags = [...tags]
  else delete metadata.tags
  if (icon) metadata.icon = icon
  else delete metadata.icon
  const requiredEngineVersion = resolveRequiredEngineVersion(definition ?? null)
  if (requiredEngineVersion > 1) metadata.minEngineVersion = requiredEngineVersion
  else delete metadata.minEngineVersion
  return Object.keys(metadata).length > 0 ? metadata : null
}
