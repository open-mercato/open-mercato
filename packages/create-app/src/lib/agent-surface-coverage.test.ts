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
    'inbox-actions.ts', 'ai-tools.ts', 'ai-agents.ts', 'security.mfa-providers.ts', 'security.sudo.ts',
    'cli.ts', 'integration.ts', 'generators.ts',
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

test('standalone provider guidance defaults app integrations to local modules, not phantom workspaces', () => {
  const root = read('shared/AGENTS.md.template')
  const guide = read('guides/integrations.md')
  const activation = read('shared/ai/skills/om-integration-builder/references/package-and-activation.md')
  assert.match(root, /src\/modules\/<id>/)
  for (const content of [guide, activation]) assert.match(content, /src\/modules\/<provider>/)
  for (const content of [root, guide, activation]) assert.match(content, /packages\/\*/)
  assert.match(root, /Providers are published, never `packages\/\*`/)
  assert.match(guide, /scaffold has no workspace topology/)
  assert.match(activation, /App-specific \(default\)/)
  assert.match(activation, /Reusable \(explicit user requirement\)/)
})

test('provider guidance distinguishes transactional SMTP from communication-channel mailboxes and names canonical host registrations', () => {
  const guide = read('guides/integrations.md')
  const families = read('shared/ai/skills/om-integration-builder/references/provider-families.md')
  const activation = read('shared/ai/skills/om-integration-builder/references/package-and-activation.md')
  for (const content of [guide, families, activation]) {
    assert.match(content, /transactional email/i)
    assert.match(content, /mailbox/i)
    assert.match(content, /ChannelAdapter/)
  }
  for (const expected of [
    "hub: 'communication_channels'",
    'channel_gmail',
    'channel_imap',
    'GatewayAdapter',
    'registerGatewayAdapter',
    'registerWebhookHandler',
    'registerPaymentGatewayDescriptor',
    'ShippingAdapter',
    'registerShippingAdapter',
  ]) assert.ok(`${guide}\n${families}\n${activation}`.includes(expected), `missing provider contract ${expected}`)
  assert.match(guide, /createLogger/)
  assert.match(activation, /detached client seam alone is never a production registration/)
})

test('AI router and skill cover typed tools, MCP/OpenCode Code Mode, and two-tier per-request authorization', () => {
  const root = read('shared/AGENTS.md.template')
  const guide = read('guides/ai-workflows.md')
  const skill = read('shared/ai/skills/om-create-ai-agent/SKILL.md')
  const selector = read('shared/ai/skills/om-create-ai-agent/references/surface-selector.md')
  const tools = read('shared/ai/skills/om-create-ai-agent/references/module-agents-and-tools.md')
  assert.match(root, /MCP\/OpenCode\/Code Mode/)
  for (const expected of ['defineAiTool', 'registerMcpTool', 'Zod', 'moduleId', 'requiredFeatures', 'serializable', 'search', 'execute', 'x-api-key', '_sessionToken', 'per-tool ACL']) {
    assert.ok(`${guide}\n${skill}\n${selector}\n${tools}`.includes(expected), `missing AI/MCP contract ${expected}`)
  }
  assert.match(guide, /Ask before editing OpenCode configuration/)
  assert.match(tools, /stateless per HTTP request/)
})

test('UMES selector documents additive command interceptors across execute and undo', () => {
  const guide = read('guides/extensions.md')
  const selector = read('shared/ai/skills/om-system-extension/references/mechanism-selector.md')
  const branches = read('shared/ai/skills/om-system-extension/references/extension-branches.md')
  for (const expected of ['commands/interceptors.ts', 'targetCommand', 'beforeExecute', 'afterExecute', 'beforeUndo', 'afterUndo', 'wildcard-aware']) {
    assert.ok(`${guide}\n${selector}\n${branches}`.includes(expected), `missing command-interceptor contract ${expected}`)
  }
  assert.match(guide, /never grants authority/)
  assert.match(branches, /never bypass the command, locking, audit, or undo/)
})

test('business one-shot guidance maps staff record outcomes to canonical complete-module contracts', () => {
  const blueprint = read('shared/ai/skills/om-module-scaffold/references/business-one-shot-blueprints.md')
  for (const expected of [
    'references/api-and-domain.md',
    'references/module-surfaces.md',
    'references/verification.md',
    'controlled-search `DataTable`',
    '`CrudForm` create/edit/delete flows',
    '`collectCustomFieldValues`',
    '`extractUndoPayload`',
    '`emitCrudUndoSideEffects`',
    '`buildCustomFieldResetMap`',
    '`withAtomicFlush`',
    '`findWithDecryption`',
    'intentional API enricher host',
    'Preserve every statically discoverable baseline entry',
    "enabledModules.push({ id: '<module>', from: '@app' })",
  ]) assert.ok(blueprint.includes(expected), `missing business-to-framework inference ${expected}`)
  assert.match(blueprint, /do not substitute plausible alternatives/)
  assert.match(blueprint, /### Complete Library Contract/)
  assert.match(blueprint, /Do not route `framework-context`/)
  for (const expected of [
    '`library.books.view`',
    '`library.books.manage`',
    '`setup: ModuleSetupConfig = { defaultRoleFeatures }`',
    '`orgField`',
    '`transformItem`',
    '`loadCustomFieldSnapshot`',
    '`@open-mercato\/shared\/lib\/commands\/undo`',
    '`@open-mercato\/shared\/lib\/encryption\/find`',
    '`searchConfig`',
    '`@jest\/globals`',
    '`CommandHandler<Input, Result>`',
    '`@open-mercato\/ui\/backend\/confirm-dialog`',
    '`execute(input, ctx)`',
    '`async prepare(input, ctx)`',
    '`async captureAfter(input, result, ctx)`',
    '`undo` receives `{ input, ctx, logEntry }`',
    'Never write `execute: async ({ input, ctx })`',
    '`dataEngine.setCustomFields({ entityId, recordId, tenantId, organizationId, values, notify: false })`',
    '`normalizeCustomFieldValues`',
    '`findOneWithDecryption(em, Book, { id, tenant_id, organization_id }, undefined, { tenantId, organizationId })`',
    'shared `Input`, `Button`, and `Alert`',
    '`@open-mercato\/ui\/primitives\/input`',
    'async execute(input, ctx)',
    'Delete undo must call `buildCustomFieldResetMap`',
    '`yarn generate` and then `yarn typecheck`',
  ]) assert.ok(blueprint.includes(expected), `missing complete-library contract ${expected}`)
  assert.match(blueprint, /Do not create any test outside `commands\/__tests__\/`/)
  assert.match(blueprint, /do not hide oracle-significant behavior in shared helpers/)
  assert.match(blueprint, /Avoid optional locales, standalone widget\/event\/enricher files/)
})

test('the 193-case catalog routes audited installed-module, runtime, and AI/provider branches explicitly', () => {
  const cases = JSON.parse(read('shared/ai/harness/cases.json')) as Array<{
    id: string
    prompt: string
    context: { required: string[]; allowedExtra?: string[] }
    requiredDecisions: string[]
    expectedRouter: { required: string[] }
  }>
  assert.equal(cases.length, 193)
  const byId = new Map(cases.map((entry) => [entry.id, entry]))
  const expectations: Record<string, { contexts: string[]; decisions: string[] }> = {
    'OMH-013': { contexts: ['.ai/guides/modules/auth.md'], decisions: ['auth-invitation-flow', 'feature-based-declarative-auth', 'session-safe-auth'] },
    'OMH-015': { contexts: ['.ai/guides/modules/content.md'], decisions: ['static-content-page', 'localized-copy', 'ssr-friendly-content'] },
    'OMH-039': { contexts: ['.ai/guides/modules/communication_channels.md', '.ai/guides/modules/channel_gmail.md', '.ai/guides/modules/channel_imap.md'], decisions: ['email-provider-kind', 'channel-adapter-contract', 'structured-logger-redaction'] },
    'OMH-052': { contexts: ['.ai/guides/modules/attachments.md'], decisions: ['attachment-scope-both-or-neither', 'check-attachment-access'] },
    'OMH-087': { contexts: ['.ai/guides/ai-workflows.md', '.ai/guides/modules/api_keys.md', '.ai/guides/modules/configs.md', '.ai/guides/modules/dictionaries.md', '.ai/guides/modules/gateway_stripe.md', '.ai/guides/modules/perspectives.md', '.ai/guides/modules/resources.md', '.ai/guides/modules/sync_akeneo.md', '.ai/guides/modules/sync_excel.md', '.ai/guides/modules/dashboards.md', '.ai/guides/modules/notifications.md', '.ai/guides/modules/messages.md', '.ai/guides/modules/inbox_ops.md', '.ai/guides/modules/ai_assistant.md'], decisions: ['mfa-and-sudo-contributions', 'dashboard-notification-message-inbox-surfaces', 'typed-tool-versus-mcp', 'mcp-opencode-code-mode', 'mcp-two-tier-auth'] },
    'OMH-088': { contexts: ['.ai/skills/om-system-extension/references/extension-branches.md'], decisions: ['command-interceptor-execute-undo', 'command-interceptor-acl-scope', 'safe-command-block-rewrite'] },
    'OMH-097': { contexts: ['.ai/guides/modules/onboarding.md'], decisions: ['on-tenant-created-hook', 'seed-defaults-versus-examples', 'translated-welcome-invitation-email'] },
    'OMH-106': { contexts: ['.ai/guides/modules/staff.md'], decisions: ['staff-assignable-route', 'staff-availability-resolver', 'optional-staff-module'] },
    'OMH-157': { contexts: ['.ai/guides/modules/attachments.md'], decisions: ['attachment-scope-both-or-neither', 'check-attachment-access'] },
    'OMH-185': {
      contexts: [
        '.ai/skills/om-module-scaffold/references/business-one-shot-blueprints.md',
        '.ai/skills/om-data-model-design/references/integrity-and-concurrency.md',
        '.ai/skills/om-data-model-design/references/sensitive-data.md',
        '.ai/skills/om-backend-ui-design/references/crud-surfaces.md',
        '.ai/skills/om-backend-ui-design/references/page-and-navigation.md',
        '.ai/skills/om-module-scaffold/references/verification.md',
        '.ai/skills/om-system-extension/references/read-write-roundtrip.md',
      ],
      decisions: [
        'main-sidebar-navigation',
        'crudform-datatable-add-book',
        'custom-field-roundtrip',
        'command-atomic-undo-locking',
        'encryption-scoped-decryption',
        'search-index-convergence',
        'umes-api-host',
      ],
    },
    'OMH-186': {
      contexts: ['.ai/skills/om-module-scaffold/references/runtime-cache-and-queues.md'],
      decisions: ['di-cache-service', 'tenant-aware-cache-context', 'post-commit-cache-invalidation', 'undo-cache-invalidation'],
    },
    'OMH-187': {
      contexts: ['.ai/skills/om-module-scaffold/references/runtime-cache-and-queues.md'],
      decisions: ['module-queue-factory', 'discovered-worker-metadata', 'scoped-serializable-job', 'queue-retry-idempotency'],
    },
    'OMH-188': {
      contexts: ['.ai/skills/om-data-model-design/references/integrity-and-concurrency.md'],
      decisions: ['exclusion-constraint-overlap', 'conflict-not-500', 'generated-entity-ids'],
    },
    'OMH-189': {
      contexts: ['.ai/skills/om-integration-builder/references/security-and-reliability.md'],
      decisions: ['paired-integration-exports', 'ssrf-endpoint-guard', 'stable-idempotency-key'],
    },
    'OMH-190': {
      contexts: ['.ai/skills/om-system-extension/references/extension-branches.md'],
      decisions: ['dot-form-target-entity', 'batched-enrichment', 'namespaced-additive-result'],
    },
    'OMH-191': {
      contexts: ['.ai/skills/om-build-workflow/references/workflow-design.md'],
      decisions: ['timer-duration-config', 'workflow-safe-commands', 'signal-over-timer'],
    },
    'OMH-192': {
      contexts: ['.ai/guides/modules/customers.md', '.ai/skills/om-module-scaffold/references/verification.md'],
      decisions: ['trusted-scope-only', 'scalar-crm-customer-snapshot', 'atomic-one-winner-checkout', 'executable-jest-regression'],
    },
  }
  for (const [caseId, expected] of Object.entries(expectations)) {
    const record = byId.get(caseId)
    assert.ok(record, `missing ${caseId}`)
    const declaredContexts = [...record.context.required, ...(record.context.allowedExtra ?? [])]
    for (const context of expected.contexts) assert.ok(declaredContexts.includes(context), `${caseId}: missing context ${context}`)
    for (const decision of expected.decisions) assert.ok(record.requiredDecisions.includes(decision), `${caseId}: missing decision ${decision}`)
  }
  assert.ok(byId.get('OMH-087')?.expectedRouter.required.includes('ai-workflow'))
  assert.deepEqual(byId.get('OMH-134')?.expectedRouter.required, ['umes'])
  assert.deepEqual(byId.get('OMH-185')?.expectedRouter.required, ['module-data', 'backend-ui', 'umes'])
  assert.match(byId.get('OMH-185')?.prompt ?? '', /src\/modules\/library\/backend\/books\/\*\*/)
  assert.match(byId.get('OMH-185')?.prompt ?? '', /\/backend\/library\/books/)
  assert.ok(byId.get('OMH-185')?.context.required.includes('.ai/skills/om-backend-ui-design/references/page-and-navigation.md'))
  assert.ok(byId.get('OMH-185')?.context.required.includes('.ai/skills/om-module-scaffold/references/verification.md'))
  assert.ok(!byId.get('OMH-185')?.context.required.includes('.ai/skills/om-system-extension/references/read-write-roundtrip.md'))
  assert.ok(byId.get('OMH-185')?.context.allowedExtra?.includes('.ai/skills/om-system-extension/references/read-write-roundtrip.md'))
  assert.deepEqual(byId.get('OMH-186')?.expectedRouter.required, ['module-data'])
  assert.deepEqual(byId.get('OMH-187')?.expectedRouter.required, ['module-data'])
  assert.deepEqual(byId.get('OMH-192')?.expectedRouter.required, ['module-data', 'umes', 'testing'])
  assert.deepEqual(byId.get('OMH-193')?.expectedRouter.required, ['module-data', 'backend-ui', 'umes'])
})

test('the business-language cohort includes the OMH-185 parity case without leaked framework contracts', () => {
  const cases = JSON.parse(read('shared/ai/harness/cases.json')) as Array<{
    [key: string]: unknown
    id: string
    prompt: string
    tags: string[]
  }>
  const expectedIds = [
    ...Array.from({ length: 92 }, (_, index) => `OMH-${String(index + 93).padStart(3, '0')}`),
    'OMH-193',
  ]
  const cohort = cases.filter((entry) => entry.tags.includes('business-language'))

  assert.equal(new Set(cases.map((entry) => entry.id)).size, cases.length, 'catalog case IDs must be unique')
  assert.equal(cohort.length, 93)
  assert.deepEqual(cohort.map((entry) => entry.id), expectedIds)

  const prohibitedImplementationVocabulary = /(?:\b(?:IntegrationDefinition|ChannelAdapter|GatewayAdapter|ShippingAdapter|availabilityAccessResolver|checkAttachmentAccess|onTenantCreated|seedDefaults|seedExamples|registerGatewayAdapter|registerWebhookHandler|registerPaymentGatewayDescriptor|registerShippingAdapter|tenantId|organizationId)\b|\/api\/staff\/team-members\/assignable\b|--no-examples\b|\bsetup\.ts\b)/
  for (const entry of cohort) {
    assert.doesNotMatch(entry.prompt, prohibitedImplementationVocabulary, `${entry.id} leaks an implementation contract into its business prompt`)
  }

  const technicalCase = cases.find((entry) => entry.id === 'OMH-185')
  const businessCase = cases.find((entry) => entry.id === 'OMH-193')
  assert.ok(technicalCase)
  assert.ok(businessCase)
  assert.match(businessCase.prompt, /Use every standard platform procedure/)
  assert.match(businessCase.prompt, /checking the generated app/)
  assert.doesNotMatch(businessCase.prompt, /CrudForm|DataTable|makeCrudRoute|src\/modules|\/backend\/|\.tsx?\b|optimistic locking|UMES|i18n|Jest/)
  for (const field of ['owner', 'expectedRouter', 'requiredSkills', 'context', 'requiredDecisions', 'forbiddenPatterns', 'validators', 'fixture', 'oracle', 'allowedWrites', 'timeoutMs'] as const) {
    assert.deepEqual(businessCase[field], technicalCase[field], `OMH-193 must preserve OMH-185 ${field}`)
  }
})

test('scope guidance preserves explicit tenant-wide host contracts without widening organization data', () => {
  const cases = JSON.parse(read('shared/ai/harness/cases.json')) as Array<{ id: string; prompt: string; requiredDecisions: string[] }>
  const worker = cases.find((entry) => entry.id === 'OMH-019')
  assert.match(read('shared/AGENTS.md.template'), /Only an installed contract may use system scope \(`organizationId: null`\)/)
  assert.match(read('guides/contracts.md'), /explicitly authorizes nullable organization scope/)
  assert.match(read('guides/ai-workflows.md'), /organizationId: null/)
  assert.match(worker?.prompt ?? '', /tenant-wide scheduler worker/)
  assert.ok(worker?.requiredDecisions.includes('organization-data-isolation'))
})
