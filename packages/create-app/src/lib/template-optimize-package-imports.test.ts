import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

function extractOptimizePackageImports(source) {
  const block = source.match(/optimizePackageImports:\s*\[([^\]]*)\]/)
  if (!block) return null
  return [...block[1].matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1])
}

function readConfigSource(relativeUrl) {
  return fs.readFileSync(new URL(relativeUrl, import.meta.url), 'utf8')
}

test('standalone template next.config mirrors the main app optimizePackageImports list', () => {
  const templateSource = readConfigSource('../../template/next.config.ts')
  const mainAppSource = readConfigSource('../../../../apps/mercato/next.config.ts')

  const templateImports = extractOptimizePackageImports(templateSource)
  const mainAppImports = extractOptimizePackageImports(mainAppSource)

  assert.ok(
    mainAppImports && mainAppImports.length > 0,
    'expected apps/mercato/next.config.ts to declare experimental.optimizePackageImports',
  )
  assert.ok(
    templateImports,
    'expected packages/create-app/template/next.config.ts to declare experimental.optimizePackageImports',
  )
  assert.deepEqual(
    templateImports,
    mainAppImports,
    'standalone template optimizePackageImports drifted from the main app baseline',
  )
})

test('standalone template optimizes lucide-react, recharts, and date-fns imports', () => {
  const templateImports = extractOptimizePackageImports(
    readConfigSource('../../template/next.config.ts'),
  )

  for (const pkg of ['lucide-react', 'recharts', 'date-fns']) {
    assert.ok(
      templateImports?.includes(pkg),
      `expected standalone template to optimize ${pkg} imports`,
    )
  }
})
