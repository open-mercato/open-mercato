import type { z } from 'zod'
import { entityHeaderPropsSchema } from '@open-mercato/ui/blocks/contracts/entity-header'
import { keyValuePropsSchema } from '@open-mercato/ui/blocks/contracts/key-value'
import { stackPropsSchema } from '@open-mercato/ui/blocks/contracts/stack'
import { timelinePropsSchema } from '@open-mercato/ui/blocks/contracts/timeline'
import { wizardPropsSchema } from '@open-mercato/ui/blocks/contracts/wizard'
import { buildPropsTable, type PropRow } from './props-table'

export const CONTRACT_FILES = {
  'entity-header': 'packages/ui/src/blocks/contracts/entity-header.ts',
  'key-value': 'packages/ui/src/blocks/contracts/key-value.ts',
  stack: 'packages/ui/src/blocks/contracts/stack.ts',
  timeline: 'packages/ui/src/blocks/contracts/timeline.ts',
  wizard: 'packages/ui/src/blocks/contracts/wizard.ts',
} as const

const CONTRACT_SCHEMAS: Record<keyof typeof CONTRACT_FILES, z.ZodType> = {
  'entity-header': entityHeaderPropsSchema,
  'key-value': keyValuePropsSchema,
  stack: stackPropsSchema,
  timeline: timelinePropsSchema,
  wizard: wizardPropsSchema,
}

function hasContract(entryId: string): entryId is keyof typeof CONTRACT_FILES {
  return Object.hasOwn(CONTRACT_SCHEMAS, entryId)
}

export type EntryContract = { file: string; rows: PropRow[] }

export function contractForEntry(entryId: string): EntryContract | null {
  if (!hasContract(entryId)) return null
  return { file: CONTRACT_FILES[entryId], rows: buildPropsTable(CONTRACT_SCHEMAS[entryId]) }
}
