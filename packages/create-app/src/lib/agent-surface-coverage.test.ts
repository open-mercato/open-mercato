import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const agenticRoot = fileURLToPath(new URL('../../agentic/', import.meta.url))

function read(relativePath: string): string {
  return fs.readFileSync(path.join(agenticRoot, relativePath), 'utf8')
}

test('standalone discovery catalog covers every public module contribution family', () => {
  const catalog = read('shared/ai/skills/om-module-scaffold/references/discovery-surface-catalog.md')
  const expectedPaths = [
    'index.ts', 'data/entities.ts', 'data/validators.ts', 'data/extensions.ts', 'data/enrichers.ts', 'data/guards.ts',
    'ce.ts', 'di.ts', 'setup.ts', 'acl.ts', 'encryption.ts', 'commands/interceptors.ts', 'api/**/route.ts',
    'api/interceptors.ts', 'backend/**/page.tsx', 'frontend/**/page.tsx', 'frontend/[orgSlug]/portal/**/page.tsx',
    'backend/middleware.ts', 'frontend/middleware.ts', 'events.ts', 'subscribers/*.ts', 'workers/*.ts', 'workflows.ts',
    'search.ts', 'vector.ts', 'analytics.ts', 'translations.ts', 'i18n/<locale>.json', 'widgets/injection-table.ts', 'widgets/components.ts',
    'notifications.ts', 'notifications.client.ts', 'notifications.handlers.ts', 'message-types.ts', 'message-objects.ts',
    'inbox-actions.ts', 'ai-tools.ts', 'ai-agents.ts', 'cli.ts', 'integration.ts', 'generators.ts',
  ]
  for (const expected of expectedPaths) assert.ok(catalog.includes(`\`${expected}\``), `missing discovery surface ${expected}`)
  assert.match(catalog, /Do not use legacy HTTP-method directories or new flat page files/)
  assert.match(catalog, /not generator-discovered/)
  assert.match(catalog, /read-only\/retired inputs/)
  assert.match(catalog, /queryEngine\.enabled/)
  assert.match(catalog, /metadata\.sync/)
  assert.match(catalog, /eventHandlers\.filter\.operations/)
})

test('standalone override catalog covers all wired unified override domains and additive AI extensions', () => {
  const catalog = read('shared/ai/skills/om-system-extension/references/unified-overrides.md')
  const expectedShapes = [
    'overrides.ai.agents', 'overrides.ai.tools', 'overrides.ai.extensions', 'overrides.routes.api', 'overrides.routes.pages',
    'overrides.events.subscribers', 'overrides.workers', 'overrides.widgets.injection',
    'overrides.widgets.components', 'overrides.widgets.dashboard', 'overrides.notifications.types',
    '.handlers', 'overrides.interceptors', 'overrides.commandInterceptors', 'overrides.enrichers',
    'overrides.guards', 'overrides.cli', 'overrides.setup', 'overrides.acl.features', 'overrides.di',
    'overrides.encryption.maps',
  ]
  for (const expected of expectedShapes) assert.ok(catalog.includes(`\`${expected}\``), `missing override shape ${expected}`)
  assert.match(catalog, /`null` disables/)
  assert.match(catalog, /typed value replaces/)
  assert.match(catalog, /generated registry `entry\.key`/)
  assert.match(catalog, /explicit `metadata\.id` wins/)
  assert.match(catalog, /defaultCustomerRoleFeatures/)
  assert.match(catalog, /global override map may be declared on an app override entry/)
})

test('frontend and design-system reference covers routes, auth, responsive UX, states, and forbidden drift', () => {
  const reference = read('shared/ai/skills/om-backend-ui-design/references/frontend-and-design-system.md')
  for (const expected of [
    'frontend/**/page.tsx',
    'frontend/[orgSlug]/portal/**/page.tsx',
    'page.meta.ts',
    'principal',
    'navHidden',
    'usePortalInjectedMenuItems',
    'menu:portal:sidebar:main',
    'page:portal:layout',
    'semantic',
    'mobile',
    'reduced motion',
    'loading/skeleton',
    'not-found',
    'authorization denial',
    'optimistic-lock conflict',
    'keyboard navigation',
    'screen-reader',
    'self-contained fixtures',
  ]) assert.ok(reference.toLowerCase().includes(expected.toLowerCase()), `missing frontend/UX contract ${expected}`)
  assert.match(reference, /Never hard-code hex\/RGB/)
  assert.match(reference, /arbitrary Tailwind/)
  assert.match(reference, /UI visibility is not authorization/)
  assert.match(reference, /`CrudForm` owns its field layout/)
  assert.match(reference, /Use `DataTable` for portal lists/)
  assert.match(reference, /Never use `window\.confirm`/)
  assert.match(reference, /mobile-first standard breakpoints/)
})
