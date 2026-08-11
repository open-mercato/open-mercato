import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { setup } from '../setup'
import features from '../acl'

describe('global search ACL contract', () => {
  it('gates GET /api/search/search/global on the same feature the topbar renders on', () => {
    // BackendHeaderChrome renders TopbarSearchInline on `search.global`. When the
    // endpoint enforced the search-administration feature `search.view` instead, a
    // role holding one but not the other either saw a box that 403'd on every
    // keystroke or could query the endpoint with no UI (issue #5163).
    //
    // The route's metadata is asserted from source rather than by importing it,
    // because importing the route pulls the whole request container (and its
    // cross-package runtime deps) into this unit test.
    const source = readFileSync(join(__dirname, '..', 'api', 'search', 'global', 'route.ts'), 'utf8')
    const requireFeatures = source.match(/GET: \{ requireAuth: true, requireFeatures: \[([^\]]*)\] \}/)

    expect(requireFeatures).not.toBeNull()
    expect(requireFeatures?.[1]).toBe("'search.global'")
  })

  it('keeps both search.view and search.global declared — ACL feature IDs are frozen', () => {
    const ids = features.map((feature) => feature.id)
    expect(ids).toContain('search.view')
    expect(ids).toContain('search.global')
  })

  it('grants employees the palette but not search administration', () => {
    const employee = setup.defaultRoleFeatures?.employee ?? []
    expect(employee).toContain('search.global')
    expect(employee).not.toContain('search.view')
    expect(employee).not.toContain('search.manage')
    expect(employee).not.toContain('search.reindex')
    expect(employee).not.toContain('search.*')
  })
})

// Drift guard for the class of bug fixed in #5163: the single `search.global` gate
// says a caller may use search, not which records they may read. Every searchable
// entity therefore has to name the owning module's view feature in `aclFeatures`,
// or the global-search route fails closed and its results silently disappear.
describe('searchable entity ACL coverage', () => {
  const repoRoot = join(__dirname, '..', '..', '..', '..', '..', '..')

  function readEntityBlock(file: string, entityId: string): string {
    const source = readFileSync(file, 'utf8')
    const start = source.indexOf(`      entityId: '${entityId}',`)
    expect(start).toBeGreaterThan(-1)
    const nextEntity = source.indexOf('\n    {', start + 1)
    return source.slice(start, nextEntity === -1 ? undefined : nextEntity)
  }

  function findSearchConfigFiles(): string[] {
    const roots = [
      join(repoRoot, 'packages', 'core', 'src', 'modules'),
      join(repoRoot, 'packages', 'checkout', 'src', 'modules'),
    ].filter((dir) => existsSync(dir))

    return roots.flatMap((root) =>
      readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(root, entry.name, 'search.ts'))
        .filter((file) => existsSync(file)),
    )
  }

  const files = findSearchConfigFiles()

  it('finds the module search configs to check', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it.each(files)('%s declares aclFeatures for every searchable entity', (file) => {
    const source = readFileSync(file, 'utf8')
    // Entity configs are the six-space-indented `entityId:` entries of the config's
    // top-level `entities` array. Helper functions above it also build objects with
    // an `entityId` key, so the scan starts at the array and matches on indentation.
    const entitiesArrayStart = source.search(/^ {2}entities: \[$/m)
    expect(entitiesArrayStart).toBeGreaterThan(-1)
    const entitiesArray = source.slice(entitiesArrayStart)

    const declaredEntities = [...entitiesArray.matchAll(/^ {6}entityId: (.+),$/gm)].map((m) => m[1])
    const declaredAclFeatures = [...entitiesArray.matchAll(/^ {6}aclFeatures: \[/gm)].length

    expect(declaredEntities.length).toBeGreaterThan(0)
    expect(declaredAclFeatures).toBe(declaredEntities.length)
  })

  it('uses the offer read-route feature for catalog offer results', () => {
    const offer = readEntityBlock(
      join(repoRoot, 'packages', 'core', 'src', 'modules', 'catalog', 'search.ts'),
      'catalog:catalog_offer',
    )

    expect(offer).toContain("aclFeatures: ['sales.channels.manage']")
  })

  it('keeps record-scoped and polymorphic entities disabled until search can enforce their row access', () => {
    const messages = join(repoRoot, 'packages', 'core', 'src', 'modules', 'messages', 'search.ts')
    const sales = join(repoRoot, 'packages', 'core', 'src', 'modules', 'sales', 'search.ts')
    const unsafeEntities = [
      readEntityBlock(messages, 'messages:message'),
      readEntityBlock(sales, 'sales:sales_note'),
      readEntityBlock(sales, 'sales:sales_document_address'),
    ]

    for (const entity of unsafeEntities) {
      expect(entity).toContain('enabled: false')
    }
  })
})
