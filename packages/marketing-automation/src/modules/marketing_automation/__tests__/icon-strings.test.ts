import fs from 'node:fs'
import path from 'node:path'

/**
 * Every icon this module names already exists in the shared registry.
 *
 * `packages/ui/src/backend/icons/lucideRegistry.generated.tsx` is generated from the icon strings discovered
 * across the repo, so naming one nothing else uses makes `yarn generate` rewrite a file in `packages/ui` — and
 * then the choice is committing a change to another package or leaving permanent dirt in the working tree. Three
 * step icons did exactly that (`split`, `smile`, `share`), and the substitutes were already in the registry.
 *
 * The registry is READ as text rather than imported: `packages/ui` has its own guard scanning repo-wide for
 * importers of that deep generated path, and this guard has no business becoming one of them.
 */
const MODULE_ROOT = path.resolve(__dirname, '..')
const REGISTRY = path.resolve(MODULE_ROOT, '../../../../ui/src/backend/icons/lucideRegistry.generated.tsx')

/** `alert-triangle` is exported as `AlertTriangle`; `share-2` as `Share2`. */
function pascalCase(name: string): string {
  return name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

describe('icon strings', () => {
  test('the shared registry is where this guard expects it', () => {
    // A hard failure rather than a skip: a guard that quietly stops checking is not a guard, and the fix when
    // `packages/ui` moves the file is one line here.
    expect(fs.existsSync(REGISTRY)).toBe(true)
  })

  test('every icon this module names is already in the registry', () => {
    const registry = new Set(
      [...fs.readFileSync(REGISTRY, 'utf8').matchAll(/^ {2}([A-Z][A-Za-z0-9]*),?$/gm)].map((match) => match[1]),
    )
    expect(registry.size).toBeGreaterThan(50)

    const missing: Array<{ file: string; icon: string }> = []
    for (const file of sourceFiles(MODULE_ROOT)) {
      const source = fs.readFileSync(file, 'utf8')
      for (const match of source.matchAll(/icon: '([a-z0-9-]+)'/g)) {
        const icon = match[1]
        if (registry.has(pascalCase(icon))) continue
        missing.push({ file: path.relative(MODULE_ROOT, file), icon })
      }
    }
    expect(missing).toEqual([])
  })
})
