import fs from 'node:fs'
import path from 'node:path'

// §7.2/§10.5 — "Nothing in the console mutates the buyer's cart... a 'push to cart' affordance
// must not exist, and §10 asserts its absence by enumerating registered routes rather than by
// inspecting the UI." This test enumerates every `route.ts` file this module ships (statically,
// by source text — no import/mocking graph to keep in sync) and asserts:
//
//   1. no route exports an HTTP method outside GET/POST/PUT (never PATCH/DELETE anywhere in
//      this module), and PUT exists ONLY on the settings route;
//   2. no route — staff or buyer — ever references one of `cart`'s own line-mutation command
//      ids (`cart.lines.add`/`.update`/`.remove`/`.bulkAdd`). The only path into a cart this
//      module ever takes is `cart.proposal.create`/`.reject` (wrapped by `commands/
//      proposals.ts`) and the plain reads `commands/threads.ts`/`lib/cartAccess.ts` dispatch —
//      never a line write, staff or buyer side.
//
// A future route that accidentally imports a cart line-mutation command, or adds a `PATCH`/
// `DELETE` export, fails this test immediately — the same discipline `cart`'s own
// `api/carts/__tests__/routeEnumeration.test.ts` (Step 2.10) applies to its admin surface.

const API_ROOT = path.join(__dirname, '..')
const HTTP_METHOD_EXPORT = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g
const FORBIDDEN_CART_LINE_COMMAND_IDS = ['cart.lines.add', 'cart.lines.update', 'cart.lines.remove', 'cart.lines.bulkAdd']

function listRouteFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listRouteFiles(full))
    } else if (entry.isFile() && entry.name === 'route.ts') {
      files.push(full)
    }
  }
  return files
}

function exportedMethods(source: string): string[] {
  const methods: string[] = []
  for (const match of source.matchAll(HTTP_METHOD_EXPORT)) methods.push(match[1])
  return methods
}

describe('assisted_selling routes — no route mutates the buyer\'s cart (§7.2/§10.5)', () => {
  const routeFiles = listRouteFiles(API_ROOT)

  it('found every route.ts file this module ships (sanity — not an empty enumeration)', () => {
    expect(routeFiles.length).toBeGreaterThanOrEqual(10)
  })

  it('no route anywhere in this module exports PATCH or DELETE', () => {
    for (const file of routeFiles) {
      const source = fs.readFileSync(file, 'utf8')
      const methods = exportedMethods(source)
      expect({ file: path.relative(API_ROOT, file), methods }).toEqual(
        expect.objectContaining({
          methods: expect.not.arrayContaining(['PATCH', 'DELETE']),
        }),
      )
    }
  })

  it('PUT is exported ONLY by the settings route', () => {
    const putFiles = routeFiles.filter((file) => exportedMethods(fs.readFileSync(file, 'utf8')).includes('PUT'))
    const relative = putFiles.map((file) => path.relative(API_ROOT, file))
    expect(relative).toEqual([path.join('settings', '[storeId]', 'route.ts')])
  })

  it('every route file exports at least one recognized HTTP method', () => {
    for (const file of routeFiles) {
      const source = fs.readFileSync(file, 'utf8')
      expect(exportedMethods(source).length).toBeGreaterThan(0)
    }
  })

  it('no route — staff or buyer — ever references a cart line-mutation command id', () => {
    for (const file of routeFiles) {
      const source = fs.readFileSync(file, 'utf8')
      for (const forbidden of FORBIDDEN_CART_LINE_COMMAND_IDS) {
        expect(source.includes(forbidden)).toBe(false)
      }
    }
  })

  it('no command file under this module references a cart line-mutation command id either', () => {
    const commandsDir = path.join(API_ROOT, '..', 'commands')
    const commandFiles = fs
      .readdirSync(commandsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => path.join(commandsDir, entry.name))
    for (const file of commandFiles) {
      const source = fs.readFileSync(file, 'utf8')
      for (const forbidden of FORBIDDEN_CART_LINE_COMMAND_IDS) {
        expect(source.includes(forbidden)).toBe(false)
      }
    }
  })
})
