import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
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

  // `entityId:` is written either as a string literal or as a module-level const,
  // so the token is resolved against the file rather than matched literally.
  function resolveEntityIdToken(source: string, token: string): string | null {
    const literal = token.match(/^'(.+)'$/)
    if (literal) return literal[1]
    const declaration = source.match(
      new RegExp(`^const ${token} = '([^']+)'`, 'm'),
    )
    return declaration ? declaration[1] : null
  }

  function readEntityBlock(file: string, entityId: string): string {
    const source = readFileSync(file, 'utf8')
    const declaration = [...source.matchAll(/^ {6}entityId: (.+),$/gm)].find(
      (match) => resolveEntityIdToken(source, match[1]) === entityId,
    )
    expect(declaration).toBeDefined()
    const start = declaration!.index!
    const nextEntity = source.indexOf('\n    {', start + 1)
    return source.slice(start, nextEntity === -1 ? undefined : nextEntity)
  }

  function findSearchConfigFiles(): string[] {
    // `apps/mercato` and the create-app template are scanned too: the example
    // module's `example:todo` is indexed but had no `search.ts` at all, so the
    // original #5168 fix made it fail closed and broke TC-EXAMPLE-001. The scan
    // stopping at packages/ is why that gap reached CI unnoticed.
    const roots = [
      join(repoRoot, 'packages', 'core', 'src', 'modules'),
      join(repoRoot, 'packages', 'checkout', 'src', 'modules'),
      join(repoRoot, 'apps', 'mercato', 'src', 'modules'),
      join(repoRoot, 'packages', 'create-app', 'template', 'src', 'modules'),
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

  it('gates example todos on the feature their own list route enforces', () => {
    // Regression for the revert that pulled #5169 out of #5167: with the hybrid
    // route filtering by `aclFeatures`, an indexed-but-unconfigured `example:todo`
    // is denied to every non-superadmin, which is what broke TC-EXAMPLE-001. The
    // fix is the config below, not a weaker filter — so both copies must keep it.
    for (const root of [
      join(repoRoot, 'apps', 'mercato', 'src', 'modules', 'example', 'search.ts'),
      join(repoRoot, 'packages', 'create-app', 'template', 'src', 'modules', 'example', 'search.ts'),
    ]) {
      expect(readEntityBlock(root, 'example:todo')).toContain("aclFeatures: ['example.todos.view']")
    }
  })

  function findAllSearchConfigFiles(): string[] {
    const packagesRoot = join(repoRoot, 'packages')
    const packageModuleRoots = existsSync(packagesRoot)
      ? readdirSync(packagesRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(packagesRoot, entry.name, 'src', 'modules'))
          .filter((dir) => existsSync(dir))
      : []
    const extraRoots = [
      join(repoRoot, 'apps', 'mercato', 'src', 'modules'),
      join(repoRoot, 'packages', 'create-app', 'template', 'src', 'modules'),
    ].filter((dir) => existsSync(dir))

    return [...packageModuleRoots, ...extraRoots].flatMap((root) =>
      readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(root, entry.name, 'search.ts'))
        .filter((file) => existsSync(file)),
    )
  }

  function extractEntityObjectLiterals(file: string): ts.ObjectLiteralExpression[] {
    const source = readFileSync(file, 'utf8')
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    const entities: ts.ObjectLiteralExpression[] = []

    function visit(node: ts.Node): void {
      if (
        ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.name.text === 'searchConfig'
        && node.initializer
        && ts.isObjectLiteralExpression(node.initializer)
      ) {
        for (const prop of node.initializer.properties) {
          if (
            ts.isPropertyAssignment(prop)
            && ts.isIdentifier(prop.name)
            && prop.name.text === 'entities'
            && ts.isArrayLiteralExpression(prop.initializer)
          ) {
            for (const element of prop.initializer.elements) {
              if (ts.isObjectLiteralExpression(element)) {
                entities.push(element)
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
    return entities
  }

  function getPropertyInitializer(
    obj: ts.ObjectLiteralExpression,
    name: string,
  ): ts.Expression | undefined {
    for (const prop of obj.properties) {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === name) {
        return prop.initializer
      }
      if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === name) {
        return prop.name
      }
    }
    return undefined
  }

  const allSearchFiles = findAllSearchConfigFiles()

  it.each(allSearchFiles)('%s pairs every aclFeaturesMode: "any" entity with a non-null filterResults hook', (file) => {
    const entities = extractEntityObjectLiterals(file)
    for (const entity of entities) {
      const modeInit = getPropertyInitializer(entity, 'aclFeaturesMode')
      const isAnyMode = modeInit && ts.isStringLiteral(modeInit) && modeInit.text === 'any'
      if (!isAnyMode) continue
      const filterInit = getPropertyInitializer(entity, 'filterResults')
      expect(filterInit).toBeDefined()
      expect(filterInit?.kind).not.toBe(ts.SyntaxKind.NullKeyword)
      expect(ts.isIdentifier(filterInit!) && filterInit.text === 'undefined').toBe(false)
    }
  })

  it('protects record-scoped and polymorphic entities with row-level filterResults hooks', () => {
    const messages = join(repoRoot, 'packages', 'core', 'src', 'modules', 'messages', 'search.ts')
    const sales = join(repoRoot, 'packages', 'core', 'src', 'modules', 'sales', 'search.ts')
    const messageEntity = readEntityBlock(messages, 'messages:message')
    const salesNoteEntity = readEntityBlock(sales, 'sales:sales_note')
    const salesAddressEntity = readEntityBlock(sales, 'sales:sales_document_address')

    expect(messageEntity).toContain('enabled: true')
    expect(messageEntity).toContain('filterResults: filterVisibleMessages')

    for (const polymorphicEntity of [salesNoteEntity, salesAddressEntity]) {
      expect(polymorphicEntity).toContain('enabled: true')
      expect(polymorphicEntity).toContain("aclFeaturesMode: 'any'")
      expect(polymorphicEntity).toContain(
        "aclFeatures: ['sales.orders.view', 'sales.quotes.view', 'sales.invoices.manage', 'sales.credit_memos.manage']",
      )
      expect(polymorphicEntity).toMatch(/^ {6}filterResults: filterVisibleSales/m)
    }
  })
})
