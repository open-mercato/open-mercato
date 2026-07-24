import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import fg from 'fast-glob'

const repoRoot = resolve(__dirname, '../../../..')

const serverRuntimeRoots = [
  'packages/core/src/modules',
  'packages/ai-assistant/src/modules',
  'packages/search/src/modules',
  'packages/enterprise/src/modules',
  'packages/webhooks/src/modules',
]

const sharedAuthorizationRunners = [
  'packages/shared/src/lib/commands/command-interceptor-runner.ts',
  'packages/shared/src/lib/crud/interceptor-runner.ts',
  'packages/shared/src/lib/crud/mutation-guard-registry.ts',
  'packages/shared/src/lib/crud/enricher-runner.ts',
]

const lowLevelMatcherAllowlist = new Set([
  // Realm services are the only persistence-aware authorization entrypoints.
  'packages/core/src/modules/auth/services/rbacService.ts',
  'packages/core/src/modules/customer_accounts/services/customerRbacService.ts',
  // Grant-management validation compares proposed role grants, not a live subject.
  'packages/core/src/modules/auth/lib/grantChecks.ts',
  // Static tool-route contract validation, not a user authorization decision.
  'packages/ai-assistant/src/modules/ai_assistant/lib/ai-api-operation-runner.ts',
])

function isTestFile(path: string): boolean {
  return path.includes('/__tests__/')
    || path.endsWith('.test.ts')
    || path.endsWith('.test.tsx')
    || path.endsWith('.spec.ts')
    || path.endsWith('.spec.tsx')
}

function isBrowserFile(path: string, source: string): boolean {
  return source.trimStart().startsWith("'use client'")
    || source.trimStart().startsWith('"use client"')
    || path.includes('/components/')
    || path.includes('/widgets/injection/')
    || path.endsWith('.client.ts')
    || path.endsWith('.client.tsx')
}

describe('server feature-policy authorization coverage', () => {
  it('does not authorize live subjects with low-level ACL matchers', async () => {
    const files = await fg(
      [
        ...serverRuntimeRoots.map((root) => `${root}/**/*.{ts,tsx}`),
        ...sharedAuthorizationRunners,
      ],
      { cwd: repoRoot, absolute: true },
    )
    const violations: string[] = []

    for (const file of files) {
      const path = relative(repoRoot, file).replaceAll('\\', '/')
      if (isTestFile(path)) continue

      const source = readFileSync(file, 'utf8')
      if (isBrowserFile(path, source) || lowLevelMatcherAllowlist.has(path)) continue

      const importsLowLevelMatcher = /@open-mercato\/shared\/security\/features/.test(source)
        || /(?:lib\/auth\/featureMatch|customer_accounts\/lib\/featureMatch)/.test(source)
      const matchesLoadedAclDirectly = /\bloadAcl\s*\(/.test(source) && (
        /\b(?:hasFeature|hasAllFeatures|matchFeature)\s*\(/.test(source)
        || /\.features\s*\.includes\s*\(/.test(source)
      )
      const locallyOrdersAdminAndGrants = /\bisSuperAdmin\b/.test(source)
        && /\.features\s*\.includes\s*\(/.test(source)

      if (importsLowLevelMatcher || matchesLoadedAclDirectly || locallyOrdersAdminAndGrants) {
        violations.push(path)
      }
    }

    expect(violations).toEqual([])
  })
})
