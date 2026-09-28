import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * A filter key must be the column name.
 *
 * The CRUD list turns `buildFilters` output into a where clause whose keys are resolved against the
 * entity's *fields*, not its properties, so the key has to be spelled the way the column is
 * (`department_id`, `vehicle_id`, `entity_id`). A camelCase key is accepted by the schema, reaches the
 * builder, and matches nothing — no error, no log, no failing type. The list simply comes back empty,
 * which is why every search box and dropdown in the HR and fleet modules looked like it worked while
 * filtering on nothing.
 *
 * Verified against a running app before this guard existed: `?departmentId=<uuid>` returned zero rows
 * and `?department_id=<uuid>` returned the row, with the same route, the same session and the same
 * value. `sortFieldMap` is untouched by the rule — its keys are the client's camelCase sort ids and its
 * values are the columns.
 *
 * The scan is limited to `buildFilters` inside route files, and to keys that would be wrong:
 *
 *   - `$`-prefixed keys are operators, never columns;
 *   - an all-uppercase key is an HTTP verb or a constant (`metadata.GET`, `resourceKind: 'X'`), not a
 *     column;
 *   - a key without an uppercase letter is already in column form.
 *
 * The block runs from the `buildFilters` token to the next sibling property, so a neighbouring
 * `openApi` object full of camelCase (`resourceName`, `querySchema`) is out of scope.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..')

/**
 * The app modules and the create-app mirror of them.
 *
 * Deliberately not the published packages: several core routes declare camelCase keys *and* an indexer,
 * and whether the query engine resolves them is an open question this guard cannot settle. Scoping the
 * check to the trees whose behaviour was verified against a running app keeps it free of the false
 * positives that get a guard deleted.
 */
const SCAN_ROOTS = [
  join(repoRoot, 'apps', 'mercato', 'src', 'modules'),
  join(repoRoot, 'packages', 'create-app', 'template', 'src', 'modules'),
]

const SKIP_DIRS = new Set(['node_modules', '__tests__', '__integration__', 'dist', '.next', 'generated'])

function collectRouteFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      collectRouteFiles(full, out)
    } else if (entry === 'route.ts' || entry === 'routes.ts') {
      out.push(full)
    }
  }
  return out
}

/**
 * Returns the source text of every `buildFilters` block in a file.
 *
 * The block is found by brace balancing from the first `{` after the token rather than by looking for
 * the next property name: a sibling such as `openApi` (full of camelCase like `resourceName`) or a
 * multi-line hook would otherwise be swallowed, and a guard that reports innocent code gets silenced.
 * A template literal contributes balanced `${…}` braces, so counting them cancels out.
 */
function buildFilterBlocks(source: string): string[] {
  const blocks: string[] = []
  let index = source.indexOf('buildFilters')
  while (index >= 0) {
    const open = source.indexOf('{', index)
    if (open < 0) break
    let depth = 0
    let cursor = open
    while (cursor < source.length) {
      const char = source[cursor]
      if (char === '{') depth += 1
      else if (char === '}') {
        depth -= 1
        if (depth === 0) break
      }
      cursor += 1
    }
    blocks.push(source.slice(open, cursor + 1))
    index = source.indexOf('buildFilters', cursor)
  }
  return blocks
}

/**
 * CamelCase keys that head a query-operator filter object (`{ productId: { $eq: … } }`).
 *
 * Only that shape is checked, because it is unambiguously a list filter for the CRUD factory. The same
 * function bodies also contain ordinary ORM queries — `em.find(CustomFieldDef, { entityId: … })` — where
 * a camelCase property name is correct, and flagging those is how a guard loses its authority.
 */
function camelCaseFilterKeys(block: string): string[] {
  const keys = new Set<string>()
  for (const match of block.matchAll(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{\s*\$/g)) {
    const key = match[1]
    if (!/[A-Z]/.test(key)) continue
    if (key === key.toUpperCase()) continue
    keys.add(key)
  }
  return [...keys].sort()
}

describe('CRUD list filter keys are column names', () => {
  const files = SCAN_ROOTS.flatMap((root) => collectRouteFiles(root))

  it('finds the route files to inspect', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  // A guard that matches nothing is indistinguishable from a guard that passes, so the detector is
  // proved against a violation and against the shapes it must leave alone.
  it('detects the violation it exists for, and nothing else', () => {
    expect(camelCaseFilterKeys('{ ...(q.productId ? { productId: { $eq: q.productId } } : {}) }')).toEqual(['productId'])
    expect(camelCaseFilterKeys('{ $or: [ { licenseNumber: { $ilike: q.x } } ] }')).toEqual(['licenseNumber'])
    expect(camelCaseFilterKeys('{ ...(q.search ? { assignment_id: { $eq: q.x } } : {}) }')).toEqual([])
    expect(camelCaseFilterKeys('{ $and: [ { $or: [ { id: { $eq: q.id } } ] } ] }')).toEqual([])
    expect(camelCaseFilterKeys('em.find(CustomFieldDef, { entityId: ENTITY_ID, $and: [ { tenantId } ] })')).toEqual([])
  })

  it('never filters on a camelCase key, which the query engine silently matches against nothing', () => {
    const offenders: string[] = []

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const block of buildFilterBlocks(source)) {
        const keys = camelCaseFilterKeys(block)
        if (keys.length > 0) {
          offenders.push(`${relative(repoRoot, file).split(sep).join('/')} :: ${keys.join(', ')}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
