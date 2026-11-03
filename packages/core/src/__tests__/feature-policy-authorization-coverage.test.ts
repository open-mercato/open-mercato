import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import fg from 'fast-glob'

const repoRoot = resolve(__dirname, '../../../..')

const serverRuntimeRoots = [
  'apps/mercato/src/app',
  'packages/create-app/template/src/app',
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

  // --- Grant/requirement computation over a proposed or resolved grant array,
  // the same shape as `auth/lib/grantChecks.ts` above: none of these gates a
  // live subject, they compute what MAY be granted or what is still missing.
  'packages/core/src/modules/customer_accounts/lib/customerRoleAclSync.ts',
  'packages/core/src/modules/workflows/lib/definition-grant.ts',
  'packages/core/src/modules/workflows/api/grantable-features/route.ts',
  'packages/core/src/modules/workflows/ai-tools/types.ts',
  // Authoring-time lint: warns that a step needs a feature the DEFINITION does
  // not grant. Evaluated against the definition, never against a caller.
  'packages/core/src/modules/workflows/lib/flow-logic-warnings.ts',

  // --- Pure decision functions over an ALREADY-RESOLVED effective-feature
  // snapshot, with the impure per-request read living in the `-request`
  // companion (the shape `workflows/AGENTS.md` documents). They use the
  // wildcard-aware matcher deliberately, because a tenant `admin` holds
  // `workflows.*` rather than the concrete id.
  //
  // FOLLOW-UP: these four are the only entries here that decide about a live
  // subject. Whether they should route through `authorizeFeatures` instead —
  // which additionally orders removed-feature, disabled-module and scope
  // handling — is a maintainer call, not a merge-integration one. Tracked
  // rather than silently rewritten.
  'packages/core/src/modules/workflows/lib/task-visibility.ts',
  'packages/core/src/modules/workflows/lib/task-visibility-request.ts',
  'packages/core/src/modules/workflows/lib/work-inbox/provider.ts',
  'packages/core/src/modules/workflows/lib/activity-executor.ts',
])

function isTestFile(path: string): boolean {
  return path.includes('/__tests__/')
    || path.endsWith('.test.ts')
    || path.endsWith('.test.tsx')
    || path.endsWith('.spec.ts')
    || path.endsWith('.spec.tsx')
}

function skipLeadingWhitespaceAndComments(source: string): number {
  let offset = 0

  while (offset < source.length) {
    while (offset < source.length && source[offset].trim() === '') offset += 1

    if (source.startsWith('//', offset)) {
      const newline = source.indexOf('\n', offset + 2)
      offset = newline === -1 ? source.length : newline + 1
      continue
    }

    if (source.startsWith('/*', offset)) {
      const commentEnd = source.indexOf('*/', offset + 2)
      offset = commentEnd === -1 ? source.length : commentEnd + 2
      continue
    }

    break
  }

  return offset
}

function isBrowserFile(path: string, source: string): boolean {
  const directiveOffset = skipLeadingWhitespaceAndComments(source)
  const startsWithClientDirective = source.startsWith("'use client'", directiveOffset)
    || source.startsWith('"use client"', directiveOffset)
  return startsWithClientDirective
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
        && (
          /\.features\s*\.includes\s*\(/.test(source)
          || /\b(?:userFeatures|grantedFeatures|resolvedFeatures|authFeatures)\s*\.(?:includes|some|every)\s*\(/.test(source)
        )

      if (importsLowLevelMatcher || matchesLoadedAclDirectly || locallyOrdersAdminAndGrants) {
        violations.push(path)
      }
    }

    expect(violations).toEqual([])
  })
})
