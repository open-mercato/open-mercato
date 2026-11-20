import type { z } from 'zod'
import type { CrudFormRequiredLeafFact } from '../../../modules/form-section-facts'

type SchemaFixture = Readonly<Record<string, unknown>>

function isPlainRecord(value: unknown): value is SchemaFixture {
  if (value === null || typeof value !== 'object') return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === null || Object.getPrototypeOf(prototype) === null
}

function collectPaths(value: SchemaFixture, prefix: readonly string[] = []): string[][] {
  return Object.entries(value).flatMap(([key, entry]) => {
    const path = [...prefix, key]
    return isPlainRecord(entry) && Object.keys(entry).length ? collectPaths(entry, path) : [path]
  })
}

function omitPath(record: SchemaFixture, [key, ...descendants]: readonly string[]): SchemaFixture {
  if (descendants.length === 0) {
    return Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key))
  }
  const nested = record[key]
  if (!isPlainRecord(nested)) return record
  return { ...record, [key]: omitPath(nested, descendants) }
}

export async function findCrudFormRequiredLeafDrift(
  schema: z.ZodType,
  schemaId: string,
  fixtures: readonly SchemaFixture[],
  declaredLeaves: readonly Pick<CrudFormRequiredLeafFact, 'schemaId' | 'payloadPath'>[],
): Promise<{ missingDeclarations: string[]; noLongerRequired: string[] }> {
  if (!fixtures.length) throw new Error('[internal] Required leaf contract needs at least one valid schema fixture')
  const required = new Set<string>()
  for (const fixture of fixtures) {
    if (!(await schema.safeParseAsync(fixture)).success) {
      throw new Error(`[internal] Invalid fixture for required leaf schema "${schemaId}"`)
    }
    for (const path of collectPaths(fixture)) {
      const parsed = await schema.safeParseAsync(omitPath(fixture, path))
      if (!parsed.success) required.add(path.join('.'))
    }
  }

  const declared = new Set(declaredLeaves.filter((leaf) => leaf.schemaId === schemaId).map((leaf) => leaf.payloadPath))
  return {
    missingDeclarations: [...required].filter((path) => !declared.has(path)).sort(),
    noLongerRequired: [...declared].filter((path) => !required.has(path)).sort(),
  }
}
