/**
 * Pure payload builders for the visual editor's save and draft round trips.
 *
 * The editor rebuilds the definition from the graph and rebuilds metadata from
 * three edited fields on every save, so anything it does not explicitly carry
 * (the declared contextSchema, future metadata.editor.* keys) would be
 * silently dropped. These helpers centralize that assembly: the definition
 * payload re-attaches triggers and contextSchema next to the graph output, and
 * the metadata payload spreads the metadata object loaded from the server
 * before overlaying the edited fields so unknown keys survive load → save.
 */

import type {
  WorkflowContextSchema,
  WorkflowDefinitionData,
  WorkflowDefinitionTrigger,
} from '../data/entities'

export type DefinitionPayloadInput = {
  graphDefinition: WorkflowDefinitionData
  triggers: WorkflowDefinitionTrigger[]
  contextSchema?: WorkflowContextSchema | null
}

export function buildDefinitionPayload({ graphDefinition, triggers, contextSchema }: DefinitionPayloadInput): WorkflowDefinitionData {
  return {
    ...graphDefinition,
    triggers: triggers.length > 0 ? triggers : undefined,
    contextSchema: contextSchema ?? undefined,
  }
}

export type MetadataPayloadInput = {
  loadedMetadata: Record<string, unknown> | null
  tags: string[]
  category: string
  icon: string
}

export function buildMetadataPayload({ loadedMetadata, tags, category, icon }: MetadataPayloadInput): Record<string, unknown> | null {
  const metadata: Record<string, unknown> = { ...(loadedMetadata ?? {}) }
  if (category) metadata.category = category
  else delete metadata.category
  if (tags.length > 0) metadata.tags = [...tags]
  else delete metadata.tags
  if (icon) metadata.icon = icon
  else delete metadata.icon
  return Object.keys(metadata).length > 0 ? metadata : null
}
