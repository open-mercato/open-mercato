import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolvePreset, generateModulesTs, applyStarterPreset } from './apply-starter-preset.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// resolvePreset tests

test('resolvePreset: classic returns isClassic=true and empty modules', () => {
  const result = resolvePreset('classic')
  assert.equal(result.isClassic, true)
  assert.equal(result.id, 'classic')
  assert.deepEqual(result.modules, [])
  assert.deepEqual(result.filesToRemove, [])
})

test('resolvePreset: empty returns 11-module list', () => {
  const result = resolvePreset('empty')
  assert.equal(result.isClassic, false)
  assert.equal(result.modules.length, 11)
  const ids = result.modules.map((m) => m.id)
  assert.deepEqual(ids, [
    'auth',
    'directory',
    'configs',
    'entities',
    'query_index',
    'api_docs',
    'audit_logs',
    'notifications',
    'dashboards',
    'events',
    'search',
  ])
  assert.equal(result.modules.find((m) => m.id === 'events')?.from, '@open-mercato/events')
  // search backs the Cmd+K palette the app shell renders unconditionally (issue #5164)
  assert.equal(result.modules.find((m) => m.id === 'search')?.from, '@open-mercato/search')
  assert.ok(
    result.modules
      .filter((m) => m.id !== 'events' && m.id !== 'search')
      .every((m) => m.from === '@open-mercato/core'),
  )
  // Example source stays present in every preset; it is disabled through modules.ts only.
  assert.ok(!result.filesToRemove.includes('src/modules/example'))
  assert.ok(!result.filesToRemove.includes('src/modules/example_customers_sync'))
  assert.deepEqual(result.filesToRemove, [])
})

test('resolvePreset: crm returns 17-module list extending empty (includes currencies + communication_channels + ai_assistant + search)', () => {
  const result = resolvePreset('crm')
  assert.equal(result.isClassic, false)
  assert.equal(result.modules.length, 17)
  const ids = result.modules.map((m) => m.id)
  assert.ok(ids.includes('auth'))
  assert.ok(ids.includes('directory'))
  assert.ok(ids.includes('configs'))
  assert.ok(ids.includes('entities'))
  assert.ok(ids.includes('query_index'))
  assert.ok(ids.includes('api_docs'))
  assert.ok(ids.includes('audit_logs'))
  assert.ok(ids.includes('customers'))
  assert.ok(ids.includes('dictionaries'))
  assert.ok(ids.includes('feature_toggles'))
  assert.ok(ids.includes('notifications'))
  assert.ok(ids.includes('dashboards'))
  assert.ok(ids.includes('events'))
  // currencies backs deals KPI/aggregate base-currency + FX lookups
  assert.ok(ids.includes('currencies'))
  // communication_channels backs CRM email + /backend/profile/communication-channels
  assert.ok(ids.includes('communication_channels'))
  // ai_assistant must be included so customers AI widgets can register
  // (issue #1849 — CRM mode must enable AI assistant module)
  assert.ok(ids.includes('ai_assistant'))
  const aiAssistantEntry = result.modules.find((m) => m.id === 'ai_assistant')
  assert.equal(aiAssistantEntry?.from, '@open-mercato/ai-assistant')
  // search must be inherited from empty so the CRM preset gets Cmd+K next to Cmd+L
  // (issue #5164 — the palette was absent even for superadmins)
  assert.ok(ids.includes('search'))
  assert.equal(result.modules.find((m) => m.id === 'search')?.from, '@open-mercato/search')
  // Inherits filesToRemove from empty, which no longer removes the example source.
  assert.ok(!result.filesToRemove.includes('src/modules/example'))
  assert.ok(!result.filesToRemove.includes('src/modules/example_customers_sync'))
  assert.deepEqual(result.filesToRemove, [])
  // No duplicates
  const unique = new Set(ids)
  assert.equal(unique.size, ids.length)
})

test('resolvePreset: unknown preset throws', () => {
  assert.throws(() => resolvePreset('bogus'), /Unknown preset/)
})

// generateModulesTs tests

test('generateModulesTs: produces valid content for empty modules', () => {
  const emptyModules = resolvePreset('empty').modules
  const content = generateModulesTs(emptyModules)
  assert.ok(content.includes('parseBooleanWithDefault'))
  assert.ok(content.includes("id: 'auth'"))
  assert.ok(content.includes("id: 'api_docs'"))
  assert.ok(content.includes("id: 'audit_logs'"))
  assert.ok(content.includes("id: 'notifications'"))
  assert.ok(content.includes("id: 'dashboards'"))
  assert.ok(content.includes("id: 'events'"))
  assert.ok(content.includes("from: '@open-mercato/events'"))
  assert.ok(content.includes('enterpriseModulesEnabled'))
  assert.ok(!content.includes('example_customers_sync'))
  assert.ok(!content.includes("id: 'example'"))
  assert.ok(content.includes('export const enabledModules'))
  assert.ok(content.includes('export type ModuleEntry'))
})

test('generateModulesTs: produces valid content for crm modules', () => {
  const crmModules = resolvePreset('crm').modules
  const content = generateModulesTs(crmModules)
  assert.ok(content.includes("id: 'customers'"))
  assert.ok(content.includes("id: 'feature_toggles'"))
  assert.ok(content.includes("id: 'dictionaries'"))
  assert.ok(content.includes("id: 'currencies'"))
  assert.ok(content.includes("id: 'notifications'"))
  assert.ok(content.includes("id: 'dashboards'"))
  assert.ok(content.includes("id: 'events'"))
  assert.ok(content.includes("id: 'communication_channels'"))
  // ai_assistant must register from its own package
  assert.ok(content.includes("id: 'ai_assistant'"))
  assert.ok(content.includes("from: '@open-mercato/ai-assistant'"))
  assert.ok(!content.includes('example_customers_sync'))
})

// applyStarterPreset filesystem tests

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'preset-test-'))
  // Set up minimal structure matching what scaffoldTemplateApp produces
  mkdirSync(join(dir, 'src', 'modules', 'example'), { recursive: true })
  mkdirSync(join(dir, 'src', 'modules', 'example_customers_sync'), { recursive: true })
  mkdirSync(join(dir, '.mercato'), { recursive: true })
  writeFileSync(join(dir, 'src', 'modules.ts'), '// original')
  return dir
}

function extractExampleModuleEntry(content: string): string {
  const startMarker = "  {\n    id: 'example',"
  const endMarker = "\n  { id: 'ratelimit_probe'"
  const start = content.indexOf(startMarker)
  const end = content.indexOf(endMarker, start)

  assert.notEqual(start, -1, 'expected the Example module entry')
  assert.notEqual(end, -1, 'expected the module entry after Example')

  return content.slice(start, end)
}

test('applyStarterPreset: classic is a no-op', () => {
  const dir = makeTempDir()
  try {
    applyStarterPreset('classic', dir)
    const content = readFileSync(join(dir, 'src', 'modules.ts'), 'utf-8')
    assert.equal(content, '// original')
    assert.ok(existsSync(join(dir, 'src', 'modules', 'example')))
    assert.ok(!existsSync(join(dir, '.mercato', 'starter-preset.json')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('applyStarterPreset: empty writes 11-module modules.ts and keeps example source present', () => {
  const dir = makeTempDir()
  try {
    applyStarterPreset('empty', dir)
    const content = readFileSync(join(dir, 'src', 'modules.ts'), 'utf-8')
    assert.ok(content.includes("id: 'auth'"))
    assert.ok(content.includes("id: 'api_docs'"))
    assert.ok(content.includes("id: 'audit_logs'"))
    assert.ok(content.includes("id: 'notifications'"))
    assert.ok(content.includes("id: 'dashboards'"))
    assert.ok(content.includes("id: 'events'"))
    assert.ok(content.includes("id: 'search'"))
    assert.ok(content.includes("from: '@open-mercato/search'"))
    assert.ok(!content.includes("id: 'customers'"))
    assert.ok(!content.includes('example_customers_sync'))
    assert.ok(existsSync(join(dir, 'src', 'modules', 'example')))
    assert.ok(existsSync(join(dir, 'src', 'modules', 'example_customers_sync')))
    const marker = JSON.parse(readFileSync(join(dir, '.mercato', 'starter-preset.json'), 'utf-8'))
    assert.equal(marker.preset, 'empty')
    assert.ok(typeof marker.generatedAt === 'string')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('applyStarterPreset: crm writes 17-module modules.ts and keeps example source present', () => {
  const dir = makeTempDir()
  try {
    applyStarterPreset('crm', dir)
    const content = readFileSync(join(dir, 'src', 'modules.ts'), 'utf-8')
    assert.ok(content.includes("id: 'auth'"))
    assert.ok(content.includes("id: 'customers'"))
    assert.ok(content.includes("id: 'dictionaries'"))
    assert.ok(content.includes("id: 'feature_toggles'"))
    assert.ok(content.includes("id: 'currencies'"))
    assert.ok(content.includes("id: 'notifications'"))
    assert.ok(content.includes("id: 'dashboards'"))
    assert.ok(content.includes("id: 'events'"))
    assert.ok(content.includes("id: 'communication_channels'"))
    // ai_assistant must register so customers AI widgets work in the CRM preset
    // (regression coverage for issue #1849)
    assert.ok(content.includes("id: 'ai_assistant'"))
    assert.ok(content.includes("from: '@open-mercato/ai-assistant'"))
    // search must register so Cmd+K sits beside Cmd+L (regression coverage for issue #5164)
    assert.ok(content.includes("id: 'search'"))
    assert.ok(content.includes("from: '@open-mercato/search'"))
    assert.ok(!content.includes('example_customers_sync'))
    assert.ok(existsSync(join(dir, 'src', 'modules', 'example')))
    assert.ok(existsSync(join(dir, 'src', 'modules', 'example_customers_sync')))
    const marker = JSON.parse(readFileSync(join(dir, '.mercato', 'starter-preset.json'), 'utf-8'))
    assert.equal(marker.preset, 'crm')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Drift guard: the app shell's topbar renders each affordance on an ACL feature, and
// `filterGrantsByEnabledModules` strips any feature whose owning module is not in the
// enabled-modules registry — for every role, superadmin included. A preset that omits
// such a module therefore ships an app where the affordance is silently absent rather
// than 403-ing, which is exactly how issue #5164 escaped review.

function readTopbarGatedModuleIds(): string[] {
  const chrome = readFileSync(
    join(__dirname, '..', '..', 'template', 'src', 'components', 'BackendHeaderChrome.tsx'),
    'utf-8',
  )
  const featureIds = [...chrome.matchAll(/hasFeature\(grantedFeatures,\s*'([^']+)'\)/g)].map((m) => m[1])
  assert.ok(
    featureIds.length >= 3,
    'expected the template topbar to gate at least the AI assistant, global search and notification affordances',
  )
  // Every feature id in this codebase is `<moduleId>.<rest>`, so the owning module is
  // the segment before the first dot.
  return [...new Set(featureIds.map((featureId) => featureId.split('.')[0]))]
}

test('every non-classic preset enables the modules the template topbar gates on', () => {
  const requiredModuleIds = readTopbarGatedModuleIds()
  assert.ok(requiredModuleIds.includes('search'))
  assert.ok(requiredModuleIds.includes('notifications'))

  for (const presetId of ['empty', 'crm']) {
    const enabledIds = new Set(resolvePreset(presetId).modules.map((m) => m.id))
    for (const moduleId of requiredModuleIds) {
      // ai_assistant is a CRM capability rather than baseline chrome, so the empty
      // preset is allowed to omit it; every other gated module must be present.
      if (moduleId === 'ai_assistant' && presetId === 'empty') continue
      assert.ok(
        enabledIds.has(moduleId),
        `preset "${presetId}" must enable module "${moduleId}" — the topbar gates an affordance on one of its features`,
      )
    }
  }
})

test('any preset enabling ai_assistant also enables search', () => {
  for (const presetId of ['classic', 'empty', 'crm']) {
    const resolved = resolvePreset(presetId)
    if (resolved.isClassic) continue
    const ids = new Set(resolved.modules.map((m) => m.id))
    if (!ids.has('ai_assistant')) continue
    assert.ok(
      ids.has('search'),
      `preset "${presetId}" enables ai_assistant (Cmd+L) but not search (Cmd+K); the two palettes ship as a pair`,
    )
  }
})

test('template baseline modules keep example and design_system unregistered for classic', () => {
  const content = readFileSync(join(__dirname, '..', '..', 'template', 'src', 'modules.ts'), 'utf-8')

  assert.ok(!content.includes("id: 'example',"))
  assert.ok(!content.includes("id: 'design_system'"))
  // example_customers_sync stays behind the example guard, so it is inert too.
  assert.ok(content.includes("enabledModules.some((entry) => entry.id === 'example')"))
  assert.ok(content.includes("enabledModules.push({ id: 'example_customers_sync', from: '@app' })"))
})

test('template baseline installs every enabled Documents package', () => {
  const templateRoot = join(__dirname, '..', '..', 'template')
  const modulesSource = readFileSync(join(templateRoot, 'src', 'modules.ts'), 'utf-8')
  const nextConfigSource = readFileSync(join(templateRoot, 'next.config.ts'), 'utf-8')
  const packageTemplate = JSON.parse(readFileSync(join(templateRoot, 'package.json.template'), 'utf-8')) as {
    dependencies?: Record<string, string>
    scripts?: Record<string, string>
  }
  const environmentTemplate = readFileSync(join(templateRoot, '.env.example'), 'utf-8')
  const htmlToDocxTypes = readFileSync(join(templateRoot, 'types', 'html-to-docx', 'index.d.ts'), 'utf-8')
  const dockerfile = readFileSync(join(templateRoot, 'Dockerfile'), 'utf-8')
  const fullAppCompose = readFileSync(join(templateRoot, 'docker-compose.fullapp.yml'), 'utf-8')

  assert.ok(modulesSource.includes("{ id: 'documents', from: '@open-mercato/documents' }"))
  assert.equal(packageTemplate.dependencies?.['@open-mercato/documents'], '{{PACKAGE_VERSION}}')
  assert.equal(
    packageTemplate.scripts?.['documents:collab'],
    'node ./node_modules/@open-mercato/documents/dist/server/documents-collab-server.js',
  )
  assert.match(nextConfigSource, /serverExternalPackages:[\s\S]*'puppeteer-core'/)
  assert.match(nextConfigSource, /serverExternalPackages:[\s\S]*'html-to-docx'/)
  assert.match(environmentTemplate, /^NEXT_PUBLIC_DOCUMENTS_COLLAB_URL=/m)
  assert.match(environmentTemplate, /^DOCUMENTS_COLLAB_JWT_SECRET_V2=$/m)
  assert.match(environmentTemplate, /^DOCUMENTS_COLLAB_ALLOWED_ORIGINS=/m)
  assert.match(htmlToDocxTypes, /declare module 'html-to-docx'/)
  assert.match(dockerfile, /^ARG NEXT_PUBLIC_DOCUMENTS_COLLAB_URL$/m)
  assert.doesNotMatch(dockerfile, /RUN node -e '[^']*NEXT_PUBLIC_DOCUMENTS_COLLAB_URL/)
  assert.doesNotMatch(dockerfile, /ARG NEXT_PUBLIC_DOCUMENTS_COLLAB_URL=ws:\/\/localhost:4101/)
  assert.match(dockerfile, /ENV NEXT_PUBLIC_DOCUMENTS_COLLAB_URL=\$\{NEXT_PUBLIC_DOCUMENTS_COLLAB_URL\}/)
  assert.match(dockerfile, /EXPOSE \$\{CONTAINER_PORT\} \$\{DOCUMENTS_COLLAB_PORT\}/)
  assert.match(dockerfile, /PUPPETEER_EXECUTABLE_PATH=\/usr\/bin\/chromium/)
  assert.match(dockerfile, /ARG INSTALL_CHROMIUM=0/)
  assert.match(dockerfile, /if \[ "\$INSTALL_CHROMIUM" = "1" \]/)
  assert.match(dockerfile, /apk add --no-cache ca-certificates chromium openssl/)
  assert.match(
    fullAppCompose,
    /NEXT_PUBLIC_DOCUMENTS_COLLAB_URL=\$\{NEXT_PUBLIC_DOCUMENTS_COLLAB_URL:-\}/,
  )
  assert.doesNotMatch(fullAppCompose, /NEXT_PUBLIC_DOCUMENTS_COLLAB_URL[^\n]*:-ws:\/\/localhost/)
  assert.match(
    fullAppCompose,
    /DOCUMENTS_COLLAB_JWT_SECRET_V2: \$\{DOCUMENTS_COLLAB_JWT_SECRET_V2:-\}/,
  )
  assert.doesNotMatch(fullAppCompose, /change-me-documents-collab-v2-secret/)
  assert.doesNotMatch(fullAppCompose, /DOCUMENTS_COLLAB[^\n]*\$\{[^}]*:\?/)
  assert.match(fullAppCompose, /APP_URL: \$\{APP_URL:-http:\/\/localhost:3000\}/)
  assert.match(
    fullAppCompose,
    /DOCUMENTS_COLLAB_ALLOWED_ORIGINS: \$\{DOCUMENTS_COLLAB_ALLOWED_ORIGINS:-\$\{APP_URL\}\}/,
  )
  assert.doesNotMatch(fullAppCompose, /DOCUMENTS_COLLAB_ALLOWED_ORIGINS[^\n]*localhost/)
  assert.match(fullAppCompose, /documents-collab:[\s\S]*command: \["yarn", "documents:collab"\]/)
  assert.match(fullAppCompose, /documents-collab:\s*\n\s+profiles:\s*\n\s+- documents-collab/)
  assert.match(fullAppCompose, /INSTALL_CHROMIUM=\$\{INSTALL_CHROMIUM:-0\}/)
})

test('production image does not abort for a misconfigured collaboration endpoint', () => {
  const dockerfile = readFileSync(
    join(__dirname, '..', '..', 'template', 'Dockerfile'),
    'utf-8',
  )

  assert.match(dockerfile, /^ARG NEXT_PUBLIC_DOCUMENTS_COLLAB_URL$/m)
  assert.match(dockerfile, /ENV NEXT_PUBLIC_DOCUMENTS_COLLAB_URL=\$\{NEXT_PUBLIC_DOCUMENTS_COLLAB_URL\}/)
  assert.doesNotMatch(dockerfile, /RUN node -e '[^']*NEXT_PUBLIC_DOCUMENTS_COLLAB_URL/)
})

test('monorepo keeps the applied Example nav override integration-only', () => {
  const monorepoContent = readFileSync(join(__dirname, '..', '..', '..', '..', 'apps', 'mercato', 'src', 'modules.ts'), 'utf-8')
  const monorepoEntry = extractExampleModuleEntry(monorepoContent)

  assert.match(
    monorepoEntry,
    /nav:\s*parseBooleanWithDefault\(process\.env\.OM_INTEGRATION_TEST, false\)\s*\?\s*\{ groupOrder: \['example\.nav\.group'\] \}\s*:\s*undefined/,
  )
  assert.doesNotMatch(monorepoEntry, /nav:\s*\{\s*groupOrder:/)
})
