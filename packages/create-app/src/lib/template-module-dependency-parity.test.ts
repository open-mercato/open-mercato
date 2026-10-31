import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const templateRoot = fileURLToPath(new URL('../../template/', import.meta.url))
const templateFile = (...segments: string[]) => path.join(templateRoot, ...segments)

/**
 * Every module the standalone template enables unconditionally must also be
 * installed by the template's package.json. A provider that is enabled but
 * not installed breaks a fresh scaffold at the generate step
 * ("Package ... is not installed"). Env-gated modules (pushed inside an `if`
 * after the literal) are opt-in and deliberately excluded.
 */
test('every unconditionally enabled template module has a matching template dependency', () => {
  const modulesSource = fs.readFileSync(templateFile('src', 'modules.ts'), 'utf8')
  const literalStart = modulesSource.indexOf('export const enabledModules')
  assert.ok(literalStart >= 0, 'template modules.ts declares enabledModules')
  const literalEnd = modulesSource.indexOf('\n]', literalStart)
  assert.ok(literalEnd > literalStart, 'enabledModules literal is terminated')
  const literal = modulesSource.slice(literalStart, literalEnd)

  const packages = new Set<string>()
  for (const line of literal.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('//')) continue
    for (const match of trimmed.matchAll(/from:\s*'(@open-mercato\/[a-z0-9-]+)'/g)) {
      packages.add(match[1])
    }
  }
  assert.ok(packages.size > 0, 'enabledModules references package-backed modules')

  const packageTemplate = JSON.parse(
    fs.readFileSync(templateFile('package.json.template'), 'utf8').replace(/\{\{PACKAGE_VERSION\}\}/g, '0.0.0'),
  ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  const installed = new Set([
    ...Object.keys(packageTemplate.dependencies ?? {}),
    ...Object.keys(packageTemplate.devDependencies ?? {}),
  ])

  const missing = [...packages].filter((name) => !installed.has(name)).sort()
  assert.deepEqual(
    missing,
    [],
    `template enables modules from packages it does not install: ${missing.join(', ')}`,
  )
})
