import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const agenticRoot = fileURLToPath(new URL('../../agentic/', import.meta.url))
const packagesRoot = fileURLToPath(new URL('../../../', import.meta.url))

function readAgentic(relativePath: string): string {
  return fs.readFileSync(path.join(agenticRoot, relativePath), 'utf8')
}

function readPackage(relativePath: string): string {
  return fs.readFileSync(path.join(packagesRoot, relativePath), 'utf8')
}

test('standalone module contracts require structured runtime logging without banning script output', () => {
  const contracts = readAgentic('guides/contracts.md')
  assert.match(contracts, /createLogger\('<module>'\)/)
  assert.match(contracts, /\.child\(\{ component, \.\.\.context \}\)/)
  assert.match(contracts, /dynamic values in structured metadata/)
  assert.match(contracts, /credentials, tokens, secrets, PII, and payload bodies/)
  assert.match(contracts, /Do not add raw `console\.\*` calls to runtime\/server\/module code/)
  assert.match(contracts, /CLI\/build scripts and test-local console spies remain valid/)
})

test('installed auth and onboarding context directs new routes to current contracts', () => {
  const auth = readPackage('core/src/modules/auth/AGENTS.md')
  assert.match(auth, /API metadata is per HTTP method/)
  assert.match(auth, /GET: \{ requireAuth: true, requireFeatures: \['auth\.users\.list'\] \}/)
  assert.doesNotMatch(auth, /^\s*requireRoles:/m)
  assert.match(auth, /`requireRoles` remains a deprecated compatibility field/)

  const onboarding = readPackage('onboarding/AGENTS.md')
  assert.match(onboarding, /Existing `api\/get\/\*\*` and `api\/post\/\*\*` files are legacy compatibility routes/)
  assert.match(onboarding, /`api\/<step>\/get\|post\/route\.ts` as legacy/)
  assert.match(onboarding, /Create `api\/<step-name>\/route\.ts` and export sibling `GET` and `POST` handlers/)
  assert.doesNotMatch(onboarding, /Add GET endpoint in `api\/<step-name>\/get\/route\.ts`/)
})

test('progressive data references pin encryption, atomicity, undo, and optimistic-lock helpers', () => {
  const sensitiveData = readAgentic(
    'shared/ai/skills/om-data-model-design/references/sensitive-data.md',
  )
  assert.match(sensitiveData, /@open-mercato\/shared\/lib\/encryption\/find/)
  assert.match(sensitiveData, /findWithDecryption/)
  assert.match(sensitiveData, /findOneWithDecryption/)
  assert.match(sensitiveData, /findAndCountWithDecryption/)
  assert.match(sensitiveData, /query `where`/)
  assert.match(sensitiveData, /fifth-argument decryption scope/)
  assert.match(sensitiveData, /hash-only/)
  assert.match(sensitiveData, /make a concrete call in every implemented direct sensitive-record read path/)
  assert.match(sensitiveData, /@open-mercato\/shared\/modules\/encryption/)
  assert.match(sensitiveData, /ModuleEncryptionMap/)
  assert.match(sensitiveData, /fields: \[\{ field:/)
  assert.match(sensitiveData, /export default defaultEncryptionMaps/)
  assert.match(sensitiveData, /factory QueryEngine owns list decryption/)
  assert.match(sensitiveData, /no `findAndCount` override key/)

  const integrity = readAgentic(
    'shared/ai/skills/om-data-model-design/references/integrity-and-concurrency.md',
  )
  assert.match(integrity, /@open-mercato\/shared\/lib\/commands\/flush/)
  assert.match(integrity, /withAtomicFlush/)
  assert.match(integrity, /transaction: true/)
  assert.match(integrity, /same `EntityManager`/)
  assert.match(integrity, /@open-mercato\/shared\/lib\/commands\/undo/)
  assert.match(integrity, /extractUndoPayload/)
  assert.match(integrity, /commands\/customFieldSnapshots/)
  assert.match(integrity, /buildCustomFieldResetMap/)
  assert.match(integrity, /loadCustomFieldSnapshot\(em, \{ entityId, recordId, tenantId, organizationId \}\)/)
  assert.match(integrity, /`DataEngine` has no `getCustomFields`/)
  assert.match(integrity, /dataEngine\.setCustomFields\(\{ entityId, recordId, tenantId, organizationId, values, notify \}\)/)
  assert.match(integrity, /enforceCommandOptimisticLock/)
  assert.match(integrity, /undo: async \(\{ logEntry, ctx \}\)/)
  assert.match(integrity, /registerCommand\(command\)` separately/)
  assert.match(integrity, /action: 'created' \| 'updated' \| 'deleted'/)
  assert.match(integrity, /identifiers: \{ id, tenantId, organizationId \}/)
  assert.match(integrity, /execute` returns `Result` directly/)
  assert.match(integrity, /ctx\.container\.resolve<EntityManager>/)
  assert.match(integrity, /ctx\.selectedOrganizationId/)
  assert.match(integrity, /ctx\.organizationScope\?\.selectedId/)
  assert.match(integrity, /`ctx\.organizationScope` is an object/)
  assert.match(integrity, /`prepare` returns exactly `\{ before: snapshot \}`/)
  assert.match(integrity, /`captureAfter` returns the after-snapshot value directly/)
  assert.match(integrity, /`snapshots\.before`\/`snapshots\.after`/)
  assert.match(integrity, /Never invent `snapshots\.snapshot`/)
  assert.match(integrity, /nest payload under `\{ metadata: \{ payload \} \}`/)
  assert.match(integrity, /never cast or mutate `ctx`/)
  assert.match(integrity, /Type command helpers as `\(ctx: CommandRuntimeContext\)`/)
  assert.match(integrity, /do not use `as const` for mutable `cacheAliases`/)
  assert.match(integrity, /commands\/helpers/)
  assert.match(integrity, /second argument is an array/)
  assert.match(integrity, /phase callback must return `void`/)
  assert.match(integrity, /\(\) => \{ em\.persist\(record\) \}/)
  assert.match(integrity, /created_at.*updated_at/)
  assert.match(integrity, /after commit/)
  assert.match(integrity, /Never ship an empty or stub `undo`/)
  assert.match(integrity, /must call `buildCustomFieldResetMap`/)
  assert.match(integrity, /`Object\.assign` alone does not replace/)
  assert.match(integrity, /`logEntry\.resourceId` is nullable/)
  assert.match(integrity, /store the stable record ID in the undo payload/)
})

test('progressive module references pin search, i18n, and intentional extension hosts', () => {
  const moduleSurfaces = readAgentic(
    'shared/ai/skills/om-module-scaffold/references/module-surfaces.md',
  )
  assert.match(moduleSurfaces, /`search\.ts`/)
  assert.match(moduleSurfaces, /fieldPolicy/)
  assert.match(moduleSurfaces, /checksumSource/)
  assert.match(moduleSurfaces, /formatResult/)
  assert.match(moduleSurfaces, /`indexer: \{ entityType \}`/)
  assert.match(moduleSurfaces, /Treat the shipped `src\/modules\.ts` baseline as protected source/)
  assert.match(moduleSurfaces, /do not rewrite, compress, map, spread, sort, or reformat existing entries/)
  assert.match(moduleSurfaces, /deterministic convergence/)
  assert.match(moduleSurfaces, /buildSource/)
  assert.match(moduleSurfaces, /Do not invent .*`convergenceKey`, `result`.*aliases/)
  assert.match(moduleSurfaces, /@open-mercato\/shared\/modules\/search/)
  assert.match(moduleSurfaces, /searchable: \[\.\.\.\], excluded: \[\.\.\.\]/)
  assert.match(moduleSurfaces, /text: string\[\]/)
  assert.match(moduleSurfaces, /exact `entityId` key/)
  assert.match(moduleSurfaces, /ctx\.record\.id/)
  assert.match(moduleSurfaces, /SearchResultPresenter.*`title`\/`subtitle`\/`icon`\/`badge`/)
  assert.match(moduleSurfaces, /has no `metadata`/)
  assert.match(moduleSurfaces, /enabledModules\.push/)
  assert.match(moduleSurfaces, /<module>\.<resources>\.view/)
  assert.match(moduleSurfaces, /setup: ModuleSetupConfig/)
  assert.match(moduleSurfaces, /@open-mercato\/shared\/modules\/events/)
  assert.match(moduleSurfaces, /category: 'crud'/)
  assert.match(moduleSurfaces, /export const features/)
  assert.match(moduleSurfaces, /export default features/)
  assert.match(moduleSurfaces, /export const entities/)
  assert.match(moduleSurfaces, /export default entities/)
  assert.match(moduleSurfaces, /`i18n\/<locale>\.json`/)
  assert.match(moduleSurfaces, /not `locales\/<locale>\.json`/)

  const apiAndDomain = readAgentic(
    'shared/ai/skills/om-module-scaffold/references/api-and-domain.md',
  )
  assert.match(apiAndDomain, /enrichers: \{ entityId: '<module>:<entity>' \}/)
  assert.match(apiAndDomain, /stable host contract/)
  assert.match(apiAndDomain, /registerCommand/)
  assert.match(apiAndDomain, /@open-mercato\/shared\/lib\/commands/)
  assert.match(apiAndDomain, /uses `commandId`/)
  assert.match(apiAndDomain, /not `findMany`/)
  assert.match(apiAndDomain, /no `findAndCount` key/)
  assert.match(apiAndDomain, /the key is not `body`/)
  assert.match(apiAndDomain, /methods: \{ GET:/)
  assert.match(apiAndDomain, /not a top-level `GET` key/)

  const crudSurfaces = readAgentic(
    'shared/ai/skills/om-backend-ui-design/references/crud-surfaces.md',
  )
  assert.match(crudSurfaces, /authoring a new host UI/)
  assert.match(crudSurfaces, /extensionTableId/)
  assert.match(crudSurfaces, /stable column, action, and row-action IDs/)
  for (const expected of ['@open-mercato/ui/backend/DataTable', '@open-mercato/ui/backend/RowActions', '@open-mercato/ui/backend/CrudForm', '@open-mercato/shared/lib/i18n/context', '@open-mercato/ui/backend/utils/apiCall', 'readApiResultOrThrow', 'searchValue', 'onSearchChange', '`/create`', 'RowActions', 'collectCustomFieldValues', 'mapCrudServerErrorToFormErrors', 'injectionSpotId', 'return `void`', 'no `requiredFeatures` field', 'LoadingMessage', 'ErrorMessage', 'has no `apiPath` prop', 'neither `name` nor `clearable`']) {
    assert.ok(crudSurfaces.includes(expected), `missing canonical CRUD surface contract ${expected}`)
  }
  assert.match(crudSurfaces, /DataTable loading prop is `isLoading`/)
  assert.match(crudSurfaces, /CrudForm has no `mapServerError` prop/)
  assert.match(crudSurfaces, /type `CrudField`/)
  assert.match(crudSurfaces, /never `CrudFormField`/)
  assert.match(crudSurfaces, /`const fields: CrudField\[\]`/)
  assert.match(crudSurfaces, /`CrudField` is not generic/)
  assert.match(crudSurfaces, /pagination=\{\{ page, pageSize, total, totalPages, onPageChange/)
  assert.match(crudSurfaces, /not top-level pagination props/)
  assert.match(crudSurfaces, /`onDelete` receives no values argument/)
  assert.match(crudSurfaces, /CrudForm has no `onCancel` prop/)
  assert.match(crudSurfaces, /use `cancelHref`/)
  assert.match(crudSurfaces, /const initialValues = values/)
  assert.match(crudSurfaces, /TypeScript does not retain state-property narrowing/)
  assert.match(crudSurfaces, /const \{ confirm, ConfirmDialogElement \} = useConfirmDialog\(\)/)
  assert.match(crudSurfaces, /hook result itself is not callable/)

  const pageAndNavigation = readAgentic(
    'shared/ai/skills/om-backend-ui-design/references/page-and-navigation.md',
  )
  for (const expected of ['pageTitleKey', 'pageGroupKey', 'pagePriority', 'pageOrder', 'breadcrumb']) {
    assert.ok(pageAndNavigation.includes(expected), `missing generated navigation metadata ${expected}`)
  }
  assert.match(pageAndNavigation, /const \{ t \} = await resolveTranslations\(\)/)

  const verification = readAgentic(
    'shared/ai/skills/om-module-scaffold/references/verification.md',
  )
  assert.match(verification, /Jest/)
  assert.match(verification, /commands\/__tests__\//)
  assert.match(verification, /never Vitest/)
  assert.match(verification, /@jest\/globals/)
  assert.match(verification, /discover and execute/)
  assert.match(verification, /beforeEach\(\(\) => \{ jest\.clearAllMocks\(\) \}\)/)
  assert.match(verification, /complete callable signatures/)
  assert.match(verification, /full `\{ input, logEntry, ctx \}` object/)
  assert.match(verification, /Do not stop with a known TypeScript diagnostic/)
  const testingGuide = readAgentic('guides/testing-debugging.md')
  assert.match(testingGuide, /om-module-scaffold\/references\/verification\.md/)

  const discoveryCatalog = readAgentic(
    'shared/ai/skills/om-module-scaffold/references/discovery-surface-catalog.md',
  )
  assert.match(discoveryCatalog, /`i18n\/<locale>\.json`/)
  assert.match(discoveryCatalog, /`translations\.ts`/)
})

test('progressive runtime reference pins cache invalidation and discovered queue contracts', () => {
  const runtime = readAgentic(
    'shared/ai/skills/om-module-scaffold/references/runtime-cache-and-queues.md',
  )
  for (const expected of [
    "container.resolve<CacheStrategy>('cache')",
    '@open-mercato/cache',
    'runWithCacheTenant',
    'deleteByTags',
    'invalidateCrudCache',
    'after commit',
    'undo',
    'createModuleQueue',
    '@open-mercato/queue',
    'WorkerMeta',
    'QueuedJob',
    'JobContext',
    'workers/<id>.ts',
    'attemptNumber',
    'three attempts',
    'exponential backoff',
  ]) assert.ok(runtime.includes(expected), `missing cache/queue contract ${expected}`)
})

test('progressive AI reference pins generated registration and approval-gated command writes', () => {
  const aiSkill = readAgentic('shared/ai/skills/om-create-ai-agent/SKILL.md')
  const moduleAi = readAgentic(
    'shared/ai/skills/om-create-ai-agent/references/module-agents-and-tools.md',
  )
  assert.match(aiSkill, /scores or explains customer, contact, lead, or deal records/)
  assert.match(aiSkill, /load `\.ai\/guides\/modules\/customers\.md`/)
  assert.match(aiSkill, /read-only access still targets that host/)
  assert.match(moduleAi, /`ai-agents\.ts`\/`ai-tools\.ts`/)
  assert.match(moduleAi, /`prepareMutation`/)
  assert.match(moduleAi, /dispatches a command with optimistic locking/)
  assert.match(moduleAi, /No write occurs before approval/)
  assert.match(moduleAi, /Run `yarn generate`/)
})

test('standalone review flow enforces the customers-derived module and design-system checklist', () => {
  const config = JSON.parse(readAgentic('shared/ai/agentic.config.json')) as { reviewChecklist?: string }
  assert.equal(config.reviewChecklist, '.ai/review-checklist.md')

  const checklist = readAgentic('shared/ai/review-checklist.md')
  for (const required of [
    'main sidebar',
    'pageTitleKey',
    'makeCrudRoute',
    'withAtomicFlush',
    'extractUndoPayload',
    'findWithDecryption',
    'DataTable',
    'CrudForm',
    'server filter/search',
    'view-or-edit/delete',
    'collectCustomFieldValues',
    'defaultEncryptionMaps',
    'fieldPolicy',
    'extensionTableId',
    'installed AI framework',
    'session tokens',
    'design system',
    'Public request/OpenAPI schemas',
    'helper vocabulary elsewhere',
    'atomic claim seam',
    'scalar IDs plus intentional snapshots',
    '@jest/globals',
  ]) assert.ok(checklist.includes(required), `missing module review rule ${required}`)

  const autoReview = readAgentic('shared/ai/skills/om-auto-review-pr/SKILL.md')
  assert.match(autoReview, /\.ai\/review-checklist\.md/)
  assert.match(autoReview, /module elements/)
  assert.match(autoReview, /design-system/)

  const generatedPolicy = readAgentic('shared/ai/harness/generated-code-review-policy.md')
  assert.match(generatedPolicy, /\.ai\/review-checklist\.md/)
  assert.match(generatedPolicy, /module elements/)
  assert.match(generatedPolicy, /design-system/)
})

test('backend UI defaults new editable entities to linked and filterable full CRUD', () => {
  const guide = readAgentic('guides/backend-ui.md')
  const crud = readAgentic('shared/ai/skills/om-backend-ui-design/references/crud-surfaces.md')
  for (const required of [
    'unless the brief explicitly excludes an operation',
    'list, create, view/edit, and delete',
    'filter/search',
    'localized add action',
    'linked row action',
  ]) assert.ok(`${guide}\n${crud}`.includes(required), `missing full-CRUD default ${required}`)
})

test('business one-shot route keys remain binding for installed-module links', () => {
  const blueprints = readAgentic(
    'shared/ai/skills/om-module-scaffold/references/business-one-shot-blueprints.md',
  )
  assert.match(blueprints, /route key is binding/)
  assert.match(blueprints, /do not remove `U`/)
  assert.match(blueprints, /every unparenthesized route letter and its skill/)
  assert.match(blueprints, /BACKWARD_COMPATIBILITY\.md` before extending existing customer response, event, or ID surfaces/)
})

test('spec routing binds integration coverage to its decision label', () => {
  const root = readAgentic('shared/AGENTS.md.template')
  assert.match(root, /integration coverage \(`integration-coverage`\); no domain routes/)
  assert.match(root, /Commit\+ready PR MUST add `spec-pr`, read `\.ai\/skills\/om-auto-create-pr\/SKILL\.md`, and keep task routes \(`delivery-route-preserves-task-routes`\)/)
})

test('complete one-shot modules cannot skip core module procedures for specialist skills', () => {
  const skill = readAgentic('shared/ai/skills/om-module-scaffold/SKILL.md')
  assert.match(skill, /complete one-shot module or CRUD vertical slice/)
  assert.match(skill, /steps 3, 4, and 7 are mandatory/)
  for (const reference of ['api-and-domain.md', 'module-surfaces.md', 'verification.md']) {
    assert.ok(skill.includes(`.ai/skills/om-module-scaffold/references/${reference}`), `missing mandatory one-shot reference ${reference}`)
  }
  assert.match(skill, /Specialist data\/UI\/UMES procedures add to these three; they never replace them/)
})

test('data-model skill pins validators beside entities for generated discovery', () => {
  const skill = readAgentic('shared/ai/skills/om-data-model-design/SKILL.md')
  assert.match(skill, /src\/modules\/<id>\/data\/entities\.ts/)
  assert.match(skill, /src\/modules\/<id>\/data\/validators\.ts/)
  assert.match(skill, /do not move validators to the module root/)

  const schemaDesign = readAgentic(
    'shared/ai/skills/om-data-model-design/references/schema-design.md',
  )
  assert.match(schemaDesign, /@mikro-orm\/decorators\/legacy/)
  assert.match(schemaDesign, /@Unique\(\{ name, properties: \[\.\.\.\] \}\)/)
  assert.match(schemaDesign, /@Index\(\{ unique: true \}\)/)
})

test('progressive references pin reviewed standalone runtime contracts', () => {
  const integrationSkill = readAgentic(
    'shared/ai/skills/om-integration-builder/SKILL.md',
  )
  assert.match(integrationSkill, /A new or complete provider implementation cannot stop at this file/)
  for (const reference of ['provider-families.md', 'package-and-activation.md', 'security-and-reliability.md']) {
    assert.match(integrationSkill, new RegExp(`references/${reference.replaceAll('.', '\\.')}`))
  }
  assert.match(integrationSkill, /A narrow repair of an existing provider reads the reference that owns the changed contract/)
  assert.match(integrationSkill, /cursor, retry, or idempotency repairs MUST read `references\/security-and-reliability\.md`/)
  assert.match(integrationSkill, /`subscriber-idempotency` when that decision vocabulary is requested/)
  assert.match(integrationSkill, /successful page \(`cursor-after-success`\)/)
  assert.match(integrationSkill, /transient provider failures \(`transient-retry`\)/)

  const integration = readAgentic(
    'shared/ai/skills/om-integration-builder/references/package-and-activation.md',
  )
  assert.match(integration, /singular `integration`\/`bundle` definitions/)
  assert.match(integration, /plural `integrations`\/`bundles` arrays/)

  const reliability = readAgentic(
    'shared/ai/skills/om-integration-builder/references/security-and-reliability.md',
  )
  const integrationGuide = readAgentic('guides/integrations.md')
  assert.match(reliability, /atomically claim each inbox delivery/)
  assert.match(reliability, /`atomic-inbox-claim`/)
  assert.match(reliability, /`encrypted-credentials`/)
  assert.match(reliability, /`oauth-single-flight-refresh`/)
  assert.match(reliability, /`health-retry-redaction`/)
  assert.match(integrationGuide, /atomically claim each inbox delivery/)

  const schema = readAgentic(
    'shared/ai/skills/om-data-model-design/references/schema-design.md',
  )
  assert.match(schema, /@\/\.mercato\/generated\/entities\.ids\.generated/)
  assert.match(schema, /`#generated\/entities\.ids\.generated` is a package-internal alias/)
  assert.match(schema, /smoke-test the affected API against its runtime registry/)

  const extensions = readAgentic(
    'shared/ai/skills/om-system-extension/references/extension-branches.md',
  )
  assert.match(extensions, /`targetEntity`/)
  assert.match(extensions, /`customers\.person`/)
  assert.match(extensions, /never the colon-form CRUD\/widget host ID/)

  const activities = readAgentic(
    'shared/ai/skills/om-build-workflow/references/activity-contracts.md',
  )
  assert.match(activities, /`registerWorkflowSafeCommands`/)
  assert.match(activities, /command bus alone does not make a command workflow-safe/)

  const workflow = readAgentic(
    'shared/ai/skills/om-build-workflow/references/workflow-design.md',
  )
  assert.match(workflow, /`WAIT_FOR_TIMER`/)
  assert.match(workflow, /ISO 8601 duration/)
  assert.match(workflow, /`TIMER_CONFIG_MISSING`/)
})

test('router distinguishes durable multi-stage state from one-step schedules', () => {
  const root = readAgentic('shared/AGENTS.md.template')
  assert.match(root, /Multi-stage waits\/cancel\/restart are durable/)
  assert.match(root, /reminders and renewal\/batch schedules are `module-data`/)
  assert.match(root, /spreadsheet\/CSV\/file I\/O, sync\/webhook\/storage/)
  assert.match(root, /imports = `integration`/)
})

test('installed behavior discovery and field-versus-history design bind their exact owners', () => {
  const root = readAgentic('shared/AGENTS.md.template')
  const extensionSkill = readAgentic('shared/ai/skills/om-system-extension/SKILL.md')
  const uiSkill = readAgentic('shared/ai/skills/om-backend-ui-design/SKILL.md')
  assert.match(root, /`architecture` \| Capability\/ownership\/field-vs-history choice/)
  assert.match(root, /current behavior, authorization, dependents/)
  assert.match(root, /safest customization seam/)
  assert.match(uiSkill, /field, filter, row action, or bulk action added to an existing installed form\/table/)
  assert.match(uiSkill, /also requires `om-system-extension`/)
  assert.match(uiSkill, /read `references\/crud-surfaces\.md` and `references\/quality-states\.md`/)
  assert.match(uiSkill, /stable host ID \(`stable-table-host`\)/)
  assert.match(uiSkill, /Do not load contracts or `om-module-scaffold` unless it adds app-owned persistence\/API\/commands/)
  assert.match(uiSkill, /stable host ID \(`stable-host-id`\)/)
  assert.match(uiSkill, /App-owned persisted fields\/entities also require `module-data`, contracts, and `om-data-model-design`/)
  assert.match(uiSkill, /new server API\/command path instead requires `module-data`, contracts, and `om-module-scaffold`/)
  assert.match(root, /Existing installed form\/table fields, filters, row\/bulk actions without app persistence = `umes` \+ `backend-ui` only/)
  assert.match(root, /read `crud-surfaces` \+ `quality-states`; do not load contracts, module-scaffold, or page\/navigation/)
  assert.match(root, /installed guard without app persistence = `umes` only, so do not load contracts/)
  assert.match(root, /read-only behavior\/auth\/dependents\/customization = `framework-context`/)
  assert.match(root, /`framework-context` \(alone: no extensions guide; report `installed-version`\)/)
  assert.match(root, /API\/command\/record\/status\/event\/UI changes\/guards = `umes`/)
  const frameworkContext = readAgentic('shared/ai/skills/om-framework-context/SKILL.md')
  assert.match(frameworkContext, /does not load `\.ai\/guides\/extensions\.md` unless the selected route also includes `umes`/)
  assert.match(extensionSkill, /one installed-host field versus extension records for history\/rules/)
  assert.match(extensionSkill, /editable addition that must survive reload is necessarily a persisted field: select `module-data`, read contracts, and invoke `om-data-model-design`/)
  for (const reference of ['mechanism-selector.md', 'extension-branches.md']) {
    assert.ok(
      extensionSkill.includes(`.ai/skills/om-system-extension/references/${reference}`),
      `missing field-versus-history reference ${reference}`,
    )
  }
  for (const decision of ['extension-mechanism', 'additive-before-replacement', 'extension-entity', 'eject-last']) {
    assert.ok(extensionSkill.includes(`\`${decision}\``), `missing field-versus-history decision ${decision}`)
  }
  assert.match(extensionSkill, /`eject-last`; the last applies even when ejection is rejected/)
  assert.match(extensionSkill, /one backend invariant across UI, API, and direct callers \(`backend-consistency`\)/)
  assert.match(extensionSkill, /host status transition invariant \(`status-invariant`\)/)
  assert.match(extensionSkill, /host status-command guard changes a public contract: read `\.ai\/guides\/upstream\/BACKWARD_COMPATIBILITY\.md`/)
  assert.match(extensionSkill, /do not read `references\/read-write-roundtrip\.md` unless adding an editable field/)
  assert.match(extensionSkill, /installed host guard, do not load contracts or `om-module-scaffold` unless adding app-owned persistence\/API\/commands/)
  assert.match(extensionSkill, /bulk mutation reports `bulk-mutation-safety`/)
  assert.match(extensionSkill, /reactive notification reports `notification-effect` and `idempotent-client-side-effect`/)
  assert.match(extensionSkill, /app-owned subscriber, API, command, persisted field, or extension entity also selects `module-data` and contracts/)
})

test('residual owner guidance binds implementation, provider, debugging, and business routes', () => {
  const implementSpec = readAgentic('shared/ai/skills/om-implement-spec/SKILL.md')
  const integration = readAgentic('shared/ai/skills/om-integration-builder/SKILL.md')
  const troubleshooter = readAgentic('shared/ai/skills/om-troubleshooter/SKILL.md')
  const blueprints = readAgentic(
    'shared/ai/skills/om-module-scaffold/references/business-one-shot-blueprints.md',
  )
  assert.match(implementSpec, /working app \(`working-phases`\)/)
  assert.match(implementSpec, /`integration-coverage` belongs to writing the spec/)
  assert.match(integration, /exact installed provider\/domain contract, invoke `om-framework-context`/)
  assert.match(integration, /superseded by an installed capability selects architecture \+ integration \+ framework-context/)
  assert.match(troubleshooter, /persisted create\/update\/clear\/reload defect also selects `module-data` and contracts/)
  assert.match(troubleshooter, /multi-seam persisted API\/command fix with concurrency MUST read the exact paths/)
  for (const reference of [
    '.ai/skills/om-module-scaffold/references/api-and-domain.md',
    '.ai/skills/om-module-scaffold/references/verification.md',
    '.ai/skills/om-data-model-design/references/integrity-and-concurrency.md',
  ]) {
    assert.ok(troubleshooter.includes(`\`${reference}\``), `missing multi-seam debugging reference ${reference}`)
  }
  assert.match(troubleshooter, /fail before any query \(`no-unscoped-query`\)/)
  assert.match(blueprints, /mandatory UMES customer panel and mutation guard/)
  assert.match(blueprints, /`M\+B\+W` \(`\+P` only when an accounting provider is requested\)/)
})

test('workflow skill binds implementation prompts to the progressive contract references', () => {
  const workflowSkill = readAgentic('shared/ai/skills/om-build-workflow/SKILL.md')
  assert.match(workflowSkill, /Always load `references\/workflow-design\.md`/)
  assert.match(workflowSkill, /custom activity or `UPDATE_ENTITY` command activity/)
  assert.match(workflowSkill, /Dispatching an existing allowlisted command from a workflow does not change that command's implementation and stays workflow-only: do not read contracts/)
  assert.match(workflowSkill, /installed-host order, status, or quantity state also selects `module-data` \+ `umes`/)
  assert.match(workflowSkill, /loads `\.ai\/guides\/contracts\.md`, `\.ai\/guides\/extensions\.md`, and `om-system-extension`/)
  assert.match(workflowSkill, /every new business account loads and declares `\.ai\/guides\/modules\/onboarding\.md`/)
  assert.match(workflowSkill, /uses `onTenantCreated` \(`on-tenant-created-hook`\)/)
  assert.match(workflowSkill, /Load `references\/durability-and-progress\.md` whenever the workflow waits, handles signals, schedules timers/)
  assert.match(workflowSkill, /`command-state-machine`/)
  assert.match(workflowSkill, /`subscriber-idempotency`/)
  assert.match(workflowSkill, /stable output \(`workflow-output-path`\)/)
})

test('integration routing binds installed-record imports and optional carriers at their direct owners', () => {
  const root = readAgentic('shared/AGENTS.md.template')
  const integrationSkill = readAgentic('shared/ai/skills/om-integration-builder/SKILL.md')
  const providerFamilies = readAgentic(
    'shared/ai/skills/om-integration-builder/references/provider-families.md',
  )
  assert.match(integrationSkill, /rows write existing installed customer\/catalog\/host records, also select UMES/)
  assert.match(integrationSkill, /`om-system-extension`/)
  assert.match(integrationSkill, /Storage\/media work always reads `references\/provider-families\.md`/)
  assert.match(integrationSkill, /lifecycle cleanup \(`cleanup`\)/)
  assert.match(providerFamilies, /host domain state provider-neutral \(`provider-neutral-domain`\)/)
  assert.match(providerFamilies, /carrier module is optional/)
  assert.match(providerFamilies, /safe absent-provider path \(`optional-provider`\)/)
  assert.match(providerFamilies, /object\/record access \(`artifact-authorization`\)/)
  assert.match(providerFamilies, /encrypted metadata \(`encrypted-storage`\)/)
  assert.match(providerFamilies, /lifecycle cleanup \(`cleanup`\)/)
  assert.match(root, /`testing`.*`\.ai\/guides\/testing-debugging\.md`/)
  assert.match(root, /AI consuming files = `ai-workflow`, NEVER `integration` unless transport\/storage changes/)
})

test('debugging stays additive to cross-module domain and extension work', () => {
  const root = readAgentic('shared/AGENTS.md.template')
  const debugging = readAgentic('guides/testing-debugging.md')
  assert.match(root, /`debugging` is additive/)
  assert.match(root, /API\/command\/record\/status\/event\/UI changes\/guards = `umes`/)
  assert.match(root, /A scalar-ID\/snapshot fix to persisted records or commands linked to an installed record MUST use `module-data` \+ `umes`/)
  assert.match(root, /load `om-data-model-design` \+ `om-system-extension`/)
  assert.match(debugging, /`unit-regression-oracle` when that decision vocabulary is requested/)
  assert.match(debugging, /Provider cursor\/retry\/idempotency fixes therefore load `om-integration-builder`/)
  assert.match(debugging, /explicitly asks for tests, coverage, or app-level verification also selects `testing`/)
  assert.match(debugging, /`health-retry-redaction`/)
  assert.match(debugging, /ephemeral test environment \(`ephemeral-test-environment`\)/)
  assert.match(debugging, /surface every real failure \(`honest-test-result`\)/)
  const troubleshooter = readAgentic('shared/ai/skills/om-troubleshooter/SKILL.md')
  assert.match(troubleshooter, /explicitly asks to add a test, select the `testing` route/)
})

test('AI attachments, CRM lead capture, and customer renewals bind their exact progressive owners', () => {
  const root = readAgentic('shared/AGENTS.md.template')
  const aiSkill = readAgentic('shared/ai/skills/om-create-ai-agent/SKILL.md')
  const dataModelSkill = readAgentic('shared/ai/skills/om-data-model-design/SKILL.md')
  const implementationSkill = readAgentic('shared/ai/skills/om-implement-spec/SKILL.md')
  const blueprints = readAgentic(
    'shared/ai/skills/om-module-scaffold/references/business-one-shot-blueprints.md',
  )
  assert.match(root, /AI file or content drafting\/attachment\/override.*`om-create-ai-agent`/)
  assert.match(aiSkill, /MUST load the `attachments` facts, every named domain-record fact \(product → `catalog`\), plus `references\/attachments-and-overrides\.md`/)
  for (const decision of ['artifact-authorization', 'encrypted-storage', 'cleanup', 'draft-only-ai-output']) {
    assert.ok(aiSkill.includes(`\`${decision}\``), `missing AI attachment decision ${decision}`)
  }
  assert.match(dataModelSkill, /staff surface showing current state, history, or evidence also adds backend UI/)
  assert.match(implementationSkill, /working app \(`working-phases`\) and report its smallest focused validation gate \(`smallest-validation`\)/)
  assert.match(blueprints, /MUST invoke `om-data-model-design` and report `smallest-validation` for the lead record and scalar CRM link/)
  assert.match(blueprints, /load both `scheduler` and `customers` facts/)
  assert.match(blueprints, /trusted host scope \(`host-scope-contract`\)/)
})

test('API and command fixes load trusted-scope domain contracts', () => {
  const moduleSkill = readAgentic('shared/ai/skills/om-module-scaffold/SKILL.md')
  const dataModelSkill = readAgentic('shared/ai/skills/om-data-model-design/SKILL.md')
  const apiDomain = readAgentic('shared/ai/skills/om-module-scaffold/references/api-and-domain.md')
  const root = readAgentic('shared/AGENTS.md.template')
  assert.match(root, /multi-seam domain\/API\/command fix/)
  assert.match(moduleSkill, /A fix spanning multiple domain, API, or command seams is a business slice/)
  assert.match(moduleSkill, /also loads that blueprint, `references\/api-and-domain\.md`, and `references\/verification\.md`/)
  assert.match(moduleSkill, /Every API\/schema\/command implementation or fix MUST read/)
  assert.match(moduleSkill, /also read `\.ai\/guides\/upstream\/BACKWARD_COMPATIBILITY\.md`/)
  assert.match(dataModelSkill, /A persisted concurrency, atomicity, or idempotency implementation or fix cannot stop at this file/)
  assert.match(apiDomain, /Public request schemas never accept `tenantId` or `organizationId`/)
  assert.match(apiDomain, /runtime scope comes only from the trusted request\/command context/)
})
