import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const agenticRoot = fileURLToPath(new URL('../../agentic/', import.meta.url))

function read(relativePath: string): string {
  return fs.readFileSync(path.join(agenticRoot, relativePath), 'utf8')
}

function readPackageDoc(relativePath: string): string {
  return fs.readFileSync(path.join(agenticRoot, '..', relativePath), 'utf8')
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

test('the 233-case catalog routes audited installed-module, runtime, and AI/provider branches explicitly', () => {
  const cases = JSON.parse(read('shared/ai/harness/cases.json')) as Array<{
    id: string
    prompt: string
    evaluationKind: string
    context: { required: string[]; allowedExtra?: string[] }
    requiredDecisions: string[]
    requiredSkills: string[]
    expectedRouter: { required: string[] }
    frameworkContext?: Array<{ module?: string; package?: string; query: string }>
    source?: { paths?: string[] }
  }>
  assert.equal(cases.length, 233)
  const byId = new Map(cases.map((entry) => [entry.id, entry]))
  const expectations: Record<string, { contexts: string[]; decisions: string[] }> = {
    'OMH-013': { contexts: ['.ai/guides/modules/auth/index.md'], decisions: ['auth-invitation-flow', 'feature-based-declarative-auth', 'session-safe-auth'] },
    'OMH-015': { contexts: ['.ai/guides/modules/content/index.md'], decisions: ['static-content-page', 'localized-copy', 'ssr-friendly-content'] },
    'OMH-039': { contexts: ['.ai/guides/modules/communication_channels/index.md', '.ai/guides/modules/channel_gmail/index.md', '.ai/guides/modules/channel_imap/index.md', '.ai/guides/modules/channel_resend/index.md', '.ai/guides/modules/channel_ses/index.md'], decisions: ['email-provider-kind', 'channel-adapter-contract', 'structured-logger-redaction'] },
    'OMH-052': { contexts: ['.ai/guides/modules/attachments/index.md'], decisions: ['attachment-scope-both-or-neither', 'check-attachment-access'] },
    'OMH-087': { contexts: ['.ai/guides/ai-workflows.md', '.ai/guides/modules/api_keys/index.md', '.ai/guides/modules/configs/index.md', '.ai/guides/modules/dictionaries/index.md', '.ai/guides/modules/gateway_stripe/index.md', '.ai/guides/modules/perspectives/index.md', '.ai/guides/modules/resources/index.md', '.ai/guides/modules/sync_akeneo/index.md', '.ai/guides/modules/sync_excel/index.md', '.ai/guides/modules/dashboards/index.md', '.ai/guides/modules/notifications/index.md', '.ai/guides/modules/messages/index.md', '.ai/guides/modules/inbox_ops/index.md', '.ai/guides/modules/ai_assistant/index.md'], decisions: ['mfa-and-sudo-contributions', 'dashboard-notification-message-inbox-surfaces', 'typed-tool-versus-mcp', 'mcp-opencode-code-mode', 'mcp-two-tier-auth'] },
    'OMH-026': { contexts: ['.ai/guides/extensions.md'], decisions: ['facts-first-target', 'bound-crud-form-host', 'correlated-roundtrip'] },
    'OMH-027': { contexts: ['.ai/guides/extensions.md'], decisions: ['facts-first-target', 'bound-data-table-host', 'base-prefix-not-mountable'] },
    'OMH-028': { contexts: ['.ai/guides/framework-extension-points.md'], decisions: ['framework-facts-first', 'exact-framework-menu-host'] },
    'OMH-031': { contexts: ['.ai/guides/extensions.md'], decisions: ['facts-first-target', 'interceptor-activation', 'interceptor-phases-and-failure-posture'] },
    'OMH-032': { contexts: ['.ai/guides/extensions.md'], decisions: ['facts-first-target', 'guard-operations-and-capabilities', 'locking-preserved'] },
    'OMH-035': { contexts: ['.ai/guides/modules/events/index.md'], decisions: ['facts-first-event', 'broadcast-audience-scope', 'exact-browser-hook'] },
    'OMH-088': {
      contexts: [
        '.ai/skills/om-system-extension/references/extension-branches.md',
        '.ai/guides/framework-extension-points.md',
      ],
      decisions: [
        'facts-first-target-resolution',
        'exact-pattern-fact-ref-resolution',
        'unresolved-first-party-blocker',
        'querying-queried-caller-opt-in',
        'all-bound-crud-form-families',
        'all-bound-data-table-families',
        'reject-helper-only-hosts',
        'dom-portal-audience-scope',
        'correlated-roundtrip-verification',
      ],
    },
    'OMH-089': {
      contexts: [],
      decisions: ['facts-first-override-resolution', 'override-fact-ref-provenance', 'override-mode-from-facts', 'unresolved-first-party-blocker'],
    },
    'OMH-091': { contexts: ['.ai/guides/framework-extension-points.md'], decisions: ['facts-first-portal-host', 'portal-broadcast-audience-scope', 'exact-portal-hook'] },
    'OMH-097': { contexts: ['.ai/guides/modules/onboarding/index.md'], decisions: ['on-tenant-created-hook', 'seed-defaults-versus-examples', 'translated-welcome-invitation-email'] },
    'OMH-106': { contexts: ['.ai/guides/modules/staff/index.md'], decisions: ['staff-assignable-route', 'staff-availability-resolver', 'optional-staff-module'] },
    'OMH-157': { contexts: ['.ai/guides/modules/attachments/index.md'], decisions: ['attachment-scope-both-or-neither', 'check-attachment-access'] },
    'OMH-179': { contexts: ['.ai/guides/modules/customers/index.md'], decisions: ['facts-first-target', 'enricher-host-opt-in', 'enricher-list-detail-posture'] },
    'OMH-180': { contexts: ['.ai/guides/modules/customers/index.md'], decisions: ['facts-first-target', 'bound-crud-form-host', 'correlated-roundtrip', 'reject-helper-only-host'] },
    'OMH-181': { contexts: ['.ai/guides/modules/sales/index.md'], decisions: ['facts-first-target', 'bound-data-table-host', 'base-prefix-not-mountable', 'correlated-execution-guard'] },
    'OMH-182': { contexts: ['.ai/guides/modules/sales/index.md'], decisions: ['facts-first-target', 'guard-operations-and-capabilities', 'locking-preserved'] },
    'OMH-183': { contexts: ['.ai/guides/modules/sales/index.md'], decisions: ['facts-first-event', 'subscriber-delivery-posture', 'optional-external-provenance'] },
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
      contexts: ['.ai/guides/modules/customers/index.md', '.ai/skills/om-module-scaffold/references/verification.md'],
      decisions: ['trusted-scope-only', 'scalar-crm-customer-snapshot', 'atomic-one-winner-checkout', 'executable-jest-regression'],
    },
    'OMH-194': {
      contexts: ['.ai/guides/modules/dictionaries/index.md', '.ai/guides/architecture.md', '.ai/skills/om-help/SKILL.md'],
      decisions: ['facts-first', 'tenant-scope', 'acl-features', 'smallest-validation'],
    },
    'OMH-195': {
      contexts: ['.ai/guides/modules/api_keys/index.md', '.ai/guides/architecture.md', '.ai/skills/om-help/SKILL.md'],
      decisions: ['facts-first', 'acl-features', 'tenant-scope', 'smallest-validation'],
    },
    'OMH-196': {
      contexts: ['.ai/guides/modules/configs/index.md', '.ai/guides/architecture.md', '.ai/skills/om-help/SKILL.md'],
      decisions: ['facts-first', 'tenant-scope', 'acl-features', 'smallest-validation'],
    },
    'OMH-197': {
      contexts: ['.ai/guides/modules/perspectives/index.md', '.ai/guides/architecture.md', '.ai/skills/om-help/SKILL.md'],
      decisions: ['facts-first', 'tenant-scope', 'acl-features', 'smallest-validation'],
    },
    'OMH-198': {
      contexts: ['.ai/guides/modules/resources/index.md', '.ai/guides/architecture.md', '.ai/skills/om-help/SKILL.md'],
      decisions: ['facts-first', 'tenant-scope', 'acl-features', 'smallest-validation'],
    },
    'OMH-199': {
      contexts: ['.ai/guides/modules/sync_excel/index.md', '.ai/guides/architecture.md', '.ai/skills/om-integration-builder/SKILL.md'],
      decisions: ['facts-first', 'tenant-scope', 'acl-features', 'smallest-validation'],
    },
    'OMH-200': {
      contexts: ['.ai/guides/modules/gateway_stripe/index.md', '.ai/guides/architecture.md', '.ai/skills/om-integration-builder/SKILL.md'],
      decisions: ['facts-first', 'app-module-activation', 'acl-features', 'smallest-validation'],
    },
    'OMH-201': {
      contexts: ['.ai/guides/modules/sync_akeneo/index.md', '.ai/guides/architecture.md', '.ai/skills/om-integration-builder/SKILL.md'],
      decisions: ['facts-first', 'app-module-activation', 'tenant-scope', 'smallest-validation'],
    },
    'OMH-202': {
      contexts: ['.ai/guides/modules/wms/index.md', '.ai/guides/architecture.md', '.ai/skills/om-help/SKILL.md'],
      decisions: ['facts-first', 'app-module-activation', 'tenant-scope', 'acl-features', 'smallest-validation'],
    },
    'OMH-203': {
      contexts: [
        '.ai/guides/extensions.md',
        '.ai/guides/backend-ui.md',
        '.ai/guides/modules/customers/index.md',
        '.ai/skills/om-system-extension/SKILL.md',
        '.ai/skills/om-backend-ui-design/SKILL.md',
        '.ai/skills/om-framework-context/SKILL.md',
      ],
      decisions: [
        'extension-mechanism',
        'additive-before-replacement',
        'extension-entity',
        'eject-last',
        'widget-injection-files',
        'person-detail-tab-spot',
        'company-detail-tab-spot',
        'guidance-before-framework-context',
        'installed-packages-read-only',
      ],
    },
    'OMH-229': {
      contexts: ['.ai/guides/modules/eudr/index.md', '.ai/guides/architecture.md', '.ai/skills/om-help/SKILL.md'],
      decisions: ['facts-first', 'app-module-activation', 'tenant-scope', 'acl-features', 'smallest-validation'],
    },
    'OMH-230': {
      contexts: ['.ai/skills/om-implement-spec/references/resume.md', '.ai/skills/om-implement-spec/references/planning-and-progress.md'],
      decisions: ['focused-typecheck-first', 'ledger-tree-reconciliation', 'resume-first-unticked-slice', 'in-flight-ledger', 'atomic-edit-sequence'],
    },
    'OMH-231': {
      contexts: ['.ai/guides/framework-contracts.md'],
      decisions: ['framework-contract-digest-first', 'exact-installed-source-links', 'bounded-resolver-only-if-unresolved', 'installed-packages-read-only'],
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

  const optionalUmesSpec = '.ai/specs/implemented/SPEC-041-2026-02-24-universal-module-extension-system.md'
  for (const caseId of ['OMH-088', 'OMH-089']) {
    const record = byId.get(caseId)
    assert.ok(record?.source?.paths?.includes(optionalUmesSpec), `${caseId}: UMES spec must remain provenance`)
    assert.ok(!record?.context.allowedExtra?.includes(optionalUmesSpec), `${caseId}: source-only provenance must not become scaffold context`)
    assert.ok(!record?.context.required.includes(optionalUmesSpec), `${caseId}: standalone must not require the UMES spec`)
  }

  // Every reuse-installed case observes its module fact-sheet; the skill that governs the
  // decision differs by framing. "Does something already own this?" opens om-help; a named
  // provider or file-feed opens om-integration-builder, which is what live routing selects.
  const reuseInstalledFacts: Record<string, { factSheet: string; skill: string }> = {
    'OMH-194': { factSheet: '.ai/guides/modules/dictionaries/index.md', skill: 'om-help' },
    'OMH-195': { factSheet: '.ai/guides/modules/api_keys/index.md', skill: 'om-help' },
    'OMH-196': { factSheet: '.ai/guides/modules/configs/index.md', skill: 'om-help' },
    'OMH-197': { factSheet: '.ai/guides/modules/perspectives/index.md', skill: 'om-help' },
    'OMH-198': { factSheet: '.ai/guides/modules/resources/index.md', skill: 'om-help' },
    'OMH-199': { factSheet: '.ai/guides/modules/sync_excel/index.md', skill: 'om-integration-builder' },
    'OMH-200': { factSheet: '.ai/guides/modules/gateway_stripe/index.md', skill: 'om-integration-builder' },
    'OMH-201': { factSheet: '.ai/guides/modules/sync_akeneo/index.md', skill: 'om-integration-builder' },
    'OMH-202': { factSheet: '.ai/guides/modules/wms/index.md', skill: 'om-help' },
    'OMH-229': { factSheet: '.ai/guides/modules/eudr/index.md', skill: 'om-help' },
  }
  for (const [caseId, { factSheet, skill }] of Object.entries(reuseInstalledFacts)) {
    const record = byId.get(caseId)
    assert.deepEqual(record?.expectedRouter.required, ['architecture'], `${caseId}: reuse-installed routing is an architecture decision`)
    assert.ok(record?.requiredSkills.includes(skill), `${caseId}: an installed-versus-new choice must open ${skill}`)
    assert.ok(record?.context.required.includes('.ai/guides/architecture.md'), `${caseId}: the architecture guide must be observed, not merely allowed`)
    assert.ok(record?.context.required.includes(`.ai/skills/${skill}/SKILL.md`), `${caseId}: the ${skill} skill must be observed, not merely allowed`)
    assert.ok(record?.context.required.includes(factSheet), `${caseId}: the installed module fact-sheet must be observed, not merely allowed`)
    assert.ok(record?.requiredDecisions.includes('facts-first'), `${caseId}: reuse-installed routing must decide facts-first`)
  }
  assert.deepEqual(byId.get('OMH-203')?.expectedRouter.required, ['umes', 'backend-ui', 'framework-context'])
  assert.equal(byId.get('OMH-203')?.evaluationKind, 'routing')
  assert.deepEqual(byId.get('OMH-203')?.frameworkContext, [
    { module: 'customers', query: 'detail:customers.' },
  ])
  const systemExtensionSkill = read('shared/ai/skills/om-system-extension/SKILL.md')
  assert.match(systemExtensionSkill, /widgets\/injection\/\*\*/)
  assert.match(systemExtensionSkill, /widgets\/injection-table\.ts/)
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
  const releaseMatrix = JSON.parse(read('shared/ai/harness/release-matrix.json')) as {
    generatedCodeReview: { maxChangedFiles: number }
    generativeJudge: { maxChangedFiles: number }
  }

  assert.equal(new Set(cases.map((entry) => entry.id)).size, cases.length, 'catalog case IDs must be unique')
  assert.equal(cohort.length, 93)
  assert.deepEqual(cohort.map((entry) => entry.id), expectedIds)
  assert.ok(releaseMatrix.generatedCodeReview.maxChangedFiles >= 22, 'complete library review must admit its canonical artifact layout')
  assert.ok(releaseMatrix.generativeJudge.maxChangedFiles >= 22, 'complete library judge must admit its canonical artifact layout')

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

test('the published case schema accepts the shipped catalog it pins', () => {
  const cases = JSON.parse(read('shared/ai/harness/cases.json')) as Array<Record<string, unknown>>
  const schema = JSON.parse(read('shared/ai/harness/cases.schema.json')) as {
    minItems: number
    maxItems: number
    items: {
      required: string[]
      properties: Record<string, { pattern?: string; items?: { pattern?: string }; properties?: Record<string, { items?: { pattern?: string } }> }>
    }
  }

  assert.equal(schema.minItems, cases.length, 'schema minItems must pin the shipped catalog size')
  assert.equal(schema.maxItems, cases.length, 'schema maxItems must pin the shipped catalog size')

  function requirePattern(source: string | undefined, label: string): RegExp {
    assert.ok(source, `schema must declare a ${label} pattern; an absent one would make this guard vacuous`)
    return new RegExp(source)
  }

  const idPattern = requirePattern(schema.items.properties.id.pattern, 'case id')
  const relatedPattern = requirePattern(schema.items.properties.relatedCases.items?.pattern, 'relatedCases')
  const oraclePattern = requirePattern(schema.items.properties.oracle.properties?.validatorIds.items?.pattern, 'oracle validatorId')
  const declaredProperties = new Set(Object.keys(schema.items.properties))

  for (const entry of cases) {
    const id = entry.id as string
    assert.match(id, idPattern, `${id}: schema id pattern rejects a shipped case`)
    for (const required of schema.items.required) {
      assert.ok(required in entry, `${id}: missing schema-required property ${required}`)
    }
    for (const property of Object.keys(entry)) {
      assert.ok(declaredProperties.has(property), `${id}: undeclared property ${property} under additionalProperties:false`)
    }
    for (const related of (entry.relatedCases as string[] | undefined) ?? []) {
      assert.match(related, relatedPattern, `${id}: schema relatedCases pattern rejects ${related}`)
    }
    const oracle = entry.oracle as { validatorIds?: string[] } | undefined
    for (const validatorId of oracle?.validatorIds ?? []) {
      assert.match(validatorId, oraclePattern, `${id}: schema oracle validatorId pattern rejects ${validatorId}`)
    }
  }
})

test('every published case count states the shipped catalog or the portability sample', () => {
  const cases = JSON.parse(read('shared/ai/harness/cases.json')) as Array<{ id: string }>
  const validators = JSON.parse(read('shared/ai/harness/validators.json')) as { catalog: { writableCaseIds: string[] } }
  // Any run of lower-case qualifier words may sit between the number and "cases", so shapes like
  // "49 writable implementation/regression cases" and "231 live-routing cases" are checked too; a
  // fixed qualifier list silently skipped them and let a stale count hide in the longer phrasing.
  const statedCounts = /(?<![A-Za-z0-9-])([0-9]+)[ -][a-z/ -]{0,120}cases?\b/g
  const allowed = new Map([
    [cases.length, 'the shipped catalog'],
    [validators.catalog.writableCaseIds.length, 'the writable/portability sample'],
  ])
  const documents: Array<[string, string]> = [
    ['packages/create-app/README.md', readPackageDoc('README.md')],
    ['agentic/shared/ai/harness/README.md', read('shared/ai/harness/README.md')],
    ['agentic/shared/ai/harness/RELEASE.md', read('shared/ai/harness/RELEASE.md')],
    ['agentic/shared/scripts/run-agent-harness-release.mjs', read('shared/scripts/run-agent-harness-release.mjs')],
    ['om-evolve-harness/references/case-template.md', read('shared/ai/skills/om-evolve-harness/references/case-template.md')],
    ['om-evolve-harness/references/case-workflow.md', read('shared/ai/skills/om-evolve-harness/references/case-workflow.md')],
  ]

  for (const [label, contents] of documents) {
    const matches = [...contents.matchAll(statedCounts)]
    assert.ok(matches.length > 0, `${label}: states no case count; an absent one would make this guard vacuous`)
    for (const match of matches) {
      const stated = Number(match[1])
      assert.ok(
        allowed.has(stated),
        `${label}: "${match[0]}" states ${stated}, but ${[...allowed].map(([count, source]) => `${source} has ${count}`).join(' and ')}`,
      )
    }
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
