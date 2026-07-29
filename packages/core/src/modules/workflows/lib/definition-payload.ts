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
import type { WorkflowErrorHandlerConfig } from '../data/validators'
import { writeEditorAnnotations, type WorkflowEditorAnnotations } from './editor-annotations'
import { resolveRequiredEngineVersion, type EngineVersionedDefinition } from './engine-version'
import type { WorkflowInterpolationMode } from './interpolation-pipeline'

export type DefinitionPayloadInput = {
  graphDefinition: WorkflowDefinitionData
  triggers: WorkflowDefinitionTrigger[]
  contextSchema?: WorkflowContextSchema | null
  io?: WorkflowIoContract | null
  interpolation?: WorkflowInterpolationMode | null
  errorHandler?: WorkflowErrorHandlerConfig | null
}

export function buildDefinitionPayload({ graphDefinition, triggers, contextSchema, io, interpolation, errorHandler }: DefinitionPayloadInput): WorkflowDefinitionData {
  return {
    ...graphDefinition,
    triggers: triggers.length > 0 ? triggers : undefined,
    contextSchema: contextSchema ?? undefined,
    io: io ?? undefined,
    interpolation: interpolation ?? undefined,
    errorHandler: errorHandler ?? undefined,
  }
}

export type MetadataPayloadInput = {
  loadedMetadata: Record<string, unknown> | null
  tags: string[]
  category: string
  icon: string
  /**
   * Definition being saved. Used to stamp `minEngineVersion` when the graph
   * contains a step or transition capability older engines cannot execute
   * (spec section 5.8).
   * Definitions that need nothing beyond the baseline keep no such key, so
   * saving an existing workflow stays byte-identical.
   */
  definition?: EngineVersionedDefinition | null
  /**
   * Sticky notes and groups (spec section 4.5). The canvas owns them as nodes,
   * so they are derived back out of the node array on every persistence path and
   * written to `metadata.editor.annotations` here. Omitting the field leaves
   * whatever the loaded metadata carried untouched, which is what keeps callers
   * that never render a canvas (tests, migrations) byte-compatible.
   */
  annotations?: WorkflowEditorAnnotations | null
}

export function buildMetadataPayload({ loadedMetadata, tags, category, icon, definition, annotations }: MetadataPayloadInput): Record<string, unknown> | null {
  const base = annotations === undefined ? loadedMetadata : writeEditorAnnotations(loadedMetadata, annotations)
  const metadata: Record<string, unknown> = { ...(base ?? {}) }
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
