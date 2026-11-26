import { z } from 'zod'
import { propsTableFromJsonSchema } from './props-table'
import type { ManifestEntry, ManifestVariant } from './manifest-types'

export function projectBlockContract(schema: z.ZodType) {
  const propsSchema = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' })
  return { propsSchema, rows: propsTableFromJsonSchema(propsSchema) }
}

export type PublicBlock = Pick<ManifestEntry, 'id' | 'title' | 'importPath'> & {
  docs: string
  install: {
    command: string
    target: string
    hash: string
    files: Array<{ path: string; hash: string; url: string }>
  }
  slots: string[]
  events: string[]
  sources: { component: string; contract: string; gallery: string }
  propsSchema: ReturnType<typeof projectBlockContract>['propsSchema']
  scenarios: ManifestVariant[]
}
