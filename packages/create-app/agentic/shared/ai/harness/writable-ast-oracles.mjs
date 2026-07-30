#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { sandboxedInvocation } from '../../scripts/execution-sandbox.mjs'

const TYPECHECK_TIMEOUT_MS = 120_000

const WRITABLE_CASES = Object.freeze({
  'OMH-009': {
    sources: ['src/modules/library'],
    artifacts: [
      'src/modules/library/data/entities.ts',
      'src/modules/library/data/validators.ts',
      'src/modules/library/migrations/**',
    ],
  },
  'OMH-011': {
    sources: ['src/modules/library/api/books/route.ts'],
    artifacts: ['src/modules/library/api/books/route.ts'],
  },
  'OMH-012': {
    sources: ['src/modules/library/api/books/checkout/route.ts', 'src/modules/library/commands'],
    artifacts: ['src/modules/library/api/books/checkout/route.ts', 'src/modules/library/commands/**'],
  },
  'OMH-014': {
    sources: ['src/modules/library/backend'],
    artifacts: ['src/modules/library/backend/**'],
  },
  'OMH-026': {
    sources: ['src/modules/app_customizations'],
    artifacts: [
      'src/modules/app_customizations/widgets/**',
      'src/modules/app_customizations/data/enrichers.ts',
      'src/modules/app_customizations/api/interceptors.ts',
    ],
  },
  'OMH-027': {
    sources: ['src/modules/app_customizations/widgets'],
    artifacts: ['src/modules/app_customizations/widgets/**'],
  },
  'OMH-029': {
    sources: ['src/modules/app_customizations'],
    artifacts: ['src/modules/app_customizations/**'],
  },
  'OMH-031': {
    sources: ['src/modules/app_customizations/api/interceptors.ts'],
    artifacts: ['src/modules/app_customizations/api/interceptors.ts'],
  },
  'OMH-042': {
    sources: ['src/modules/magento'],
    artifacts: ['src/modules/magento/**'],
  },
  'OMH-045': {
    sources: ['src/modules/external_sync/lib/client.ts'],
    artifacts: ['src/modules/external_sync/lib/client.ts'],
  },
  'OMH-049': {
    sources: ['src/modules/library/ai-agents.ts'],
    artifacts: ['src/modules/library/ai-agents.ts'],
  },
  'OMH-054': {
    sources: ['src/modules/automation/workflows/call-api.ts'],
    artifacts: ['src/modules/automation/workflows/call-api.ts'],
  },
  'OMH-057': {
    sources: ['src/modules/harness_fixture/api/scope/route.ts'],
    artifacts: ['src/modules/harness_fixture/api/scope/route.ts'],
  },
  'OMH-060': {
    sources: ['src/modules/harness_fixture/commands/update-record.ts'],
    artifacts: ['src/modules/harness_fixture/commands/update-record.ts'],
  },
  'OMH-061': {
    sources: ['src/modules/harness_fixture/backend/edit/page.tsx'],
    artifacts: ['src/modules/harness_fixture/backend/edit/page.tsx'],
  },
  'OMH-070': {
    sources: ['src/modules/harness_fixture/workers/sync.ts'],
    artifacts: ['src/modules/harness_fixture/workers/sync.ts'],
  },
  'OMH-093': {
    family: 'business-command',
    seam: 'mergeContacts',
    sources: ['src/modules/customer_merge/commands/merge-contacts.ts'],
    artifacts: ['src/modules/customer_merge/commands/merge-contacts.ts'],
  },
  'OMH-105': {
    family: 'business-command',
    seam: 'changeDealStage',
    sources: ['src/modules/deal_stages/commands/change-stage.ts'],
    artifacts: ['src/modules/deal_stages/commands/change-stage.ts'],
  },
  'OMH-107': {
    family: 'business-command',
    seam: 'requestQuoteDiscount',
    sources: ['src/modules/quote_approval/commands/request-discount.ts'],
    artifacts: ['src/modules/quote_approval/commands/request-discount.ts'],
  },
  'OMH-115': {
    family: 'ui-business-surface',
    seam: 'moveDealAccessibly',
    handler: 'handleDealBoardAction',
    render: 'DealBoardPage',
    event: 'onClick',
    components: ['Page', 'PageHeader', 'PageBody', 'Button', 'Alert'],
    metadata: ['requireAuth', 'requireFeatures'],
    sources: [
      'src/modules/deal_accessibility/backend/board/page.tsx',
      'src/modules/deal_accessibility/backend/board/page.meta.ts',
      'src/modules/deal_accessibility/lib/move-deal.ts',
    ],
    artifacts: [
      'src/modules/deal_accessibility/backend/board/page.tsx',
      'src/modules/deal_accessibility/backend/board/page.meta.ts',
      'src/modules/deal_accessibility/lib/move-deal.ts',
      'src/modules/deal_accessibility/i18n/en.json',
    ],
  },
  'OMH-122': {
    family: 'business-command',
    seam: 'reserveStock',
    sources: ['src/modules/stock_reservations/commands/reserve-stock.ts'],
    artifacts: ['src/modules/stock_reservations/commands/reserve-stock.ts'],
  },
  'OMH-128': {
    family: 'async-operation',
    seam: 'updatePrices',
    sources: ['src/modules/bulk_pricing/commands/update-prices.ts'],
    artifacts: ['src/modules/bulk_pricing/commands/update-prices.ts'],
  },
  'OMH-130': {
    family: 'ui-business-surface',
    seam: 'submitDemoRequest',
    handler: 'handleDemoRequest',
    render: 'RequestDemoPage',
    event: 'onSubmit',
    components: ['FormField', 'Input', 'CheckboxField', 'Button', 'Alert'],
    metadata: ['navHidden'],
    allowFormTag: true,
    sources: [
      'src/modules/demo_requests/frontend/request-demo/page.tsx',
      'src/modules/demo_requests/frontend/request-demo/page.meta.ts',
      'src/modules/demo_requests/lib/submit-demo-request.ts',
    ],
    artifacts: [
      'src/modules/demo_requests/frontend/request-demo/page.tsx',
      'src/modules/demo_requests/frontend/request-demo/page.meta.ts',
      'src/modules/demo_requests/lib/submit-demo-request.ts',
      'src/modules/demo_requests/i18n/en.json',
    ],
  },
  'OMH-133': {
    family: 'business-command',
    seam: 'approvePortalQuote',
    sources: ['src/modules/portal_quote_approval/commands/approve-quote.ts'],
    artifacts: ['src/modules/portal_quote_approval/commands/approve-quote.ts'],
  },
  'OMH-137': {
    family: 'ui-business-surface',
    seam: 'advanceSetupWizard',
    handler: 'handleSetupWizardAction',
    render: 'SetupWizardPage',
    event: 'onClick',
    components: ['Page', 'PageHeader', 'PageBody', 'StepIndicator', 'Button', 'Alert', 'LoadingMessage'],
    metadata: ['requireAuth', 'requireFeatures'],
    sources: [
      'src/modules/setup_wizard/backend/setup/page.tsx',
      'src/modules/setup_wizard/backend/setup/page.meta.ts',
      'src/modules/setup_wizard/lib/advance-setup.ts',
    ],
    artifacts: [
      'src/modules/setup_wizard/backend/setup/page.tsx',
      'src/modules/setup_wizard/backend/setup/page.meta.ts',
      'src/modules/setup_wizard/lib/advance-setup.ts',
      'src/modules/setup_wizard/i18n/en.json',
    ],
  },
  'OMH-140': {
    family: 'async-operation',
    seam: 'runInvoiceDunning',
    sources: ['src/modules/invoice_dunning'],
    artifacts: ['src/modules/invoice_dunning/workflows/**', 'src/modules/invoice_dunning/events.ts'],
  },
  'OMH-144': {
    family: 'ai-safe-agent',
    seam: 'saveQuoteDraftWithApproval',
    mode: 'mutation',
    sources: ['src/modules/quote_assistant/ai-agents.ts', 'src/modules/quote_assistant/ai-tools.ts'],
    artifacts: ['src/modules/quote_assistant/ai-agents.ts', 'src/modules/quote_assistant/ai-tools.ts'],
  },
  'OMH-146': {
    family: 'ai-safe-agent',
    seam: 'coordinateSalesQuestion',
    mode: 'delegate',
    sources: ['src/modules/sales_orchestrator/ai-agents.ts'],
    artifacts: ['src/modules/sales_orchestrator/ai-agents.ts'],
  },
  'OMH-149': {
    family: 'provider-adapter',
    seam: 'sendTransactionalEmail',
    providerKind: 'transactional-email',
    moduleId: 'smtp_email',
    healthService: 'smtpEmailHealthCheck',
    sources: ['src/modules/smtp_email', 'src/modules.ts'],
    artifacts: [
      'src/modules/smtp_email/index.ts',
      'src/modules/smtp_email/integration.ts',
      'src/modules/smtp_email/di.ts',
      'src/modules/smtp_email/lib/client.ts',
      'src/modules/smtp_email/lib/health.ts',
      'src/modules.ts',
    ],
  },
  'OMH-150': {
    family: 'provider-adapter',
    seam: 'createCardPayment',
    providerKind: 'payment',
    moduleId: 'card_payments',
    healthService: 'cardPaymentsHealthCheck',
    adapterVariable: 'cardPaymentAdapter',
    sources: ['src/modules/card_payments', 'src/modules.ts'],
    artifacts: [
      'src/modules/card_payments/index.ts',
      'src/modules/card_payments/integration.ts',
      'src/modules/card_payments/di.ts',
      'src/modules/card_payments/acl.ts',
      'src/modules/card_payments/setup.ts',
      'src/modules/card_payments/lib/adapter.ts',
      'src/modules/card_payments/lib/client.ts',
      'src/modules/card_payments/lib/health.ts',
      'src/modules.ts',
    ],
  },
  'OMH-151': {
    family: 'provider-adapter',
    seam: 'bookCarrierShipment',
    providerKind: 'shipping',
    moduleId: 'carrier_shipping',
    healthService: 'carrierShippingHealthCheck',
    adapterVariable: 'carrierShippingAdapter',
    sources: ['src/modules/carrier_shipping', 'src/modules.ts'],
    artifacts: [
      'src/modules/carrier_shipping/index.ts',
      'src/modules/carrier_shipping/integration.ts',
      'src/modules/carrier_shipping/di.ts',
      'src/modules/carrier_shipping/acl.ts',
      'src/modules/carrier_shipping/setup.ts',
      'src/modules/carrier_shipping/lib/adapter.ts',
      'src/modules/carrier_shipping/lib/client.ts',
      'src/modules/carrier_shipping/lib/health.ts',
      'src/modules.ts',
    ],
  },
  'OMH-153': {
    family: 'data-flow',
    seam: 'synchronizeErpPage',
    sources: ['src/modules/erp_sync'],
    artifacts: ['src/modules/erp_sync/data-sync.ts', 'src/modules/erp_sync/backend/**', 'src/modules/erp_sync/workers/**'],
  },
  'OMH-156': {
    family: 'data-flow',
    seam: 'transferProductRows',
    sources: ['src/modules/product_transfer/lib/flow.ts'],
    artifacts: ['src/modules/product_transfer/lib/flow.ts'],
  },
  'OMH-163': {
    family: 'test-authoring-unit',
    sources: ['src/modules/quote_approval/commands/__tests__/approve-quote.test.ts'],
    artifacts: ['src/modules/quote_approval/commands/__tests__/approve-quote.test.ts'],
  },
  'OMH-164': {
    family: 'test-authoring-api',
    sources: ['src/modules/customer_api/__integration__/TC-API-CUSTOMERS-001.spec.ts'],
    artifacts: ['src/modules/customer_api/__integration__/TC-API-CUSTOMERS-001.spec.ts'],
  },
  'OMH-165': {
    family: 'test-authoring-browser',
    sources: ['src/modules/portal_quote_approval/__integration__/TC-PORTAL-QUOTE-001.spec.ts'],
    artifacts: ['src/modules/portal_quote_approval/__integration__/TC-PORTAL-QUOTE-001.spec.ts'],
  },
  'OMH-171': {
    family: 'regression',
    seam: 'listRecords',
    sources: ['src/modules/harness_fixture/api/scope/route.ts'],
    artifacts: ['src/modules/harness_fixture/api/scope/route.ts'],
  },
  'OMH-172': {
    family: 'regression',
    sources: ['src/modules/harness_fixture/backend/edit/page.tsx'],
    artifacts: ['src/modules/harness_fixture/backend/edit/page.tsx'],
  },
  'OMH-181': {
    family: 'data-table-extension',
    seam: 'reviewOrderRisk',
    sources: [
      'src/modules/order_risk/widgets/injection/order-risk-filter/widget.ts',
      'src/modules/order_risk/widgets/injection/order-risk-review/widget.ts',
      'src/modules/order_risk/widgets/injection-table.ts',
    ],
    artifacts: [
      'src/modules/order_risk/widgets/injection/order-risk-filter/widget.ts',
      'src/modules/order_risk/widgets/injection/order-risk-review/widget.ts',
      'src/modules/order_risk/widgets/injection-table.ts',
      'src/modules/order_risk/i18n/en.json',
    ],
  },
  'OMH-188': {
    family: 'booking-overlap',
    sources: ['src/modules/room_bookings', 'src/modules.ts'],
    artifacts: [
      'src/modules/room_bookings/index.ts',
      'src/modules/room_bookings/data/entities.ts',
      'src/modules/room_bookings/data/validators.ts',
      'src/modules/room_bookings/migrations/**',
      'src/modules/room_bookings/commands/**',
      'src/modules/room_bookings/api/bookings/route.ts',
      'src/modules.ts',
    ],
  },
  'OMH-189': {
    family: 'provider-transport',
    moduleId: 'room_calendar_sync',
    healthService: 'roomCalendarSyncHealth',
    sources: ['src/modules/room_calendar_sync', 'src/modules.ts'],
    artifacts: [
      'src/modules/room_calendar_sync/index.ts',
      'src/modules/room_calendar_sync/integration.ts',
      'src/modules/room_calendar_sync/di.ts',
      'src/modules/room_calendar_sync/lib/**',
      'src/modules.ts',
    ],
  },
  'OMH-190': {
    family: 'response-enricher',
    sources: ['src/modules/room_bookings/data/enrichers.ts'],
    artifacts: ['src/modules/room_bookings/data/enrichers.ts'],
  },
  'OMH-191': {
    family: 'durable-workflow',
    sources: ['src/modules/room_bookings/workflows.ts'],
    artifacts: ['src/modules/room_bookings/workflows.ts'],
  },
  'OMH-192': {
    family: 'crm-library-regression',
    sources: ['src/modules/library/commands/crm-loans.ts', 'src/modules/library/api/schemas.ts', 'src/modules/library/commands/__tests__/crm-loans.test.ts'],
    schemaSource: 'src/modules/library/api/schemas.ts',
    testSource: 'src/modules/library/commands/__tests__/crm-loans.test.ts',
    artifacts: ['src/modules/library/commands/crm-loans.ts', 'src/modules/library/api/schemas.ts', 'src/modules/library/commands/__tests__/crm-loans.test.ts'],
  },
  'OMH-185': {
    family: 'complete-module',
    sources: ['src/modules/library', 'src/modules.ts'],
    artifacts: [
      'src/modules/library/index.ts',
      'src/modules/library/acl.ts',
      'src/modules/library/setup.ts',
      'src/modules/library/encryption.ts',
      'src/modules/library/search.ts',
      'src/modules/library/data/entities.ts',
      'src/modules/library/data/validators.ts',
      'src/modules/library/migrations/**',
      'src/modules/library/commands/**',
      'src/modules/library/commands/__tests__/**',
      'src/modules/library/api/books/route.ts',
      'src/modules/library/backend/books/**',
      'src/modules/library/i18n/en.json',
      'src/modules.ts',
    ],
  },
})

export const WRITABLE_CASE_IDS = Object.freeze(Object.keys(WRITABLE_CASES).sort())

function parseArgs(argv) {
  const options = { root: undefined, caseId: undefined, phase: undefined, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => {
      const next = argv[index + 1]
      if (!next || next.startsWith('--')) throw new Error(`${arg} requires a value`)
      index += 1
      return next
    }
    if (arg === '--root') options.root = value()
    else if (arg === '--case') options.caseId = value()
    else if (arg === '--phase') options.phase = value()
    else if (arg === '--json') options.json = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (!options.root || !options.caseId || !options.phase || !options.json) {
    throw new Error('--root, --case, --phase before|after, and --json are required')
  }
  if (!path.isAbsolute(options.root)) throw new Error('--root must be absolute')
  if (!WRITABLE_CASES[options.caseId]) throw new Error(`unsupported writable case: ${options.caseId}`)
  if (!['before', 'after'].includes(options.phase)) throw new Error('--phase must be before or after')
  return options
}

function loadTargetTypeScript(root) {
  const targetRequire = createRequire(path.join(root, 'package.json'))
  try {
    return targetRequire('typescript')
  } catch (error) {
    throw new Error(`target app cannot resolve TypeScript: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function isTypeScriptSource(file) {
  return /\.(?:cts|mts|ts|tsx)$/.test(file) && !/\.d\.(?:cts|mts|ts)$/.test(file)
}

function safeTargetEntry(root, absolute) {
  const relative = path.relative(root, absolute)
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`oracle path escapes the target: ${relative || '.'}`)
  }
  let current = root
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    if (!fs.existsSync(current)) return undefined
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink()) throw new Error(`oracle path contains a symbolic link: ${path.relative(root, current).replaceAll(path.sep, '/')}`)
    if (!stat.isDirectory() && !stat.isFile()) throw new Error(`oracle path contains a special file: ${path.relative(root, current).replaceAll(path.sep, '/')}`)
  }
  if (!path.relative(root, fs.realpathSync(current)).startsWith('..')) return fs.lstatSync(current)
  throw new Error(`oracle path resolves outside the target: ${relative.replaceAll(path.sep, '/')}`)
}

function collectSourceFiles(root, relativeEntries) {
  const found = new Set()
  const visit = (absolute) => {
    const stat = safeTargetEntry(root, absolute)
    if (!stat) return
    if (stat.isFile()) {
      if (isTypeScriptSource(absolute)) found.add(absolute)
      return
    }
    if (!stat.isDirectory()) return
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      visit(path.join(absolute, entry.name))
    }
  }
  for (const relative of relativeEntries) visit(path.join(root, relative))
  return [...found].sort()
}

function artifactExists(root, pattern) {
  if (!pattern.endsWith('/**')) return Boolean(safeTargetEntry(root, path.join(root, pattern)))
  const directory = path.join(root, pattern.slice(0, -3))
  const directoryStat = safeTargetEntry(root, directory)
  if (!directoryStat?.isDirectory()) return false
  const pending = [directory]
  while (pending.length) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      const stat = safeTargetEntry(root, absolute)
      if (stat?.isFile()) return true
      if (stat?.isDirectory()) pending.push(absolute)
    }
  }
  return false
}

function propertyName(ts, node) {
  if (!node) return undefined
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) {
    return node.text
  }
  if (ts.isComputedPropertyName(node) && ts.isStringLiteralLike(node.expression)) return node.expression.text
  return undefined
}

function expressionName(ts, expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression && ts.isStringLiteralLike(expression.argumentExpression)) {
    return expression.argumentExpression.text
  }
  return undefined
}

function fullExpressionName(ts, expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) {
    const left = fullExpressionName(ts, expression.expression)
    return left ? `${left}.${expression.name.text}` : expression.name.text
  }
  return expressionName(ts, expression)
}

function expressionPath(ts, expression) {
  if (ts.isIdentifier(expression)) return [expression.text]
  if (ts.isPropertyAccessExpression(expression)) {
    return [...expressionPath(ts, expression.expression), expression.name.text]
  }
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression && ts.isStringLiteralLike(expression.argumentExpression)) {
    return [...expressionPath(ts, expression.expression), expression.argumentExpression.text]
  }
  if (ts.isCallExpression(expression)) return expressionPath(ts, expression.expression)
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression)) {
    return expressionPath(ts, expression.expression)
  }
  return []
}

const FORBIDDEN_TEST_ALIASES = new Set(['fdescribe', 'fit', 'pending', 'xdescribe', 'xit', 'xtest'])
const TEST_RUNNER_ROOTS = new Set(['describe', 'it', 'test'])
const FORBIDDEN_TEST_MODIFIERS = new Set(['fail', 'failing', 'fixme', 'only', 'skip', 'todo'])
const TEST_INFO_MODIFIERS = new Set(['fail', 'fixme', 'skip'])

function forbiddenTestModifier(ts, expression) {
  const parts = expressionPath(ts, expression)
  if (FORBIDDEN_TEST_ALIASES.has(parts[0])) return parts.join('.')
  if (parts[0] === 'testInfo' && parts.slice(1).some((part) => TEST_INFO_MODIFIERS.has(part))) return parts.join('.')
  if (!TEST_RUNNER_ROOTS.has(parts[0])) return undefined
  return parts.slice(1).some((part) => FORBIDDEN_TEST_MODIFIERS.has(part)) ? parts.join('.') : undefined
}

function exactString(ts, expression, expected) {
  return Boolean(expression && ts.isStringLiteralLike(expression) && expression.text === expected)
}

function listenBindsLoopback(ts, call) {
  const first = call.arguments[0]
  if (first && ts.isObjectLiteralExpression(first)) {
    if (first.properties.some((property) => ts.isSpreadAssignment(property))) return false
    if (first.properties.some((property) => property.name && ts.isComputedPropertyName(property.name))) return false
    const hosts = first.properties.filter((property) => propertyName(ts, property.name) === 'host')
    return hosts.length === 1 && ts.isPropertyAssignment(hosts[0]) && exactString(ts, hosts[0].initializer, '127.0.0.1')
  }
  return exactString(ts, call.arguments[1], '127.0.0.1')
}

function jsxTagName(ts, tag) {
  if (ts.isIdentifier(tag)) return tag.text
  if (ts.isPropertyAccessExpression(tag)) return tag.name.text
  return tag.getText()
}

function newFacts() {
  return {
    calls: new Map(),
    callOptions: new Map(),
    classes: [],
    declarations: new Set(),
    decorators: new Set(),
    exportedFunctions: new Map(),
    exportedObjectFacts: new Map(),
    exportedVariables: new Set(),
    functionFacts: new Map(),
    functions: new Set(),
    finallyBlocks: 0,
    importedBindings: new Map(),
    importSources: new Set(),
    forbiddenTestModifiers: new Set(),
    jsxLiteralAttributes: new Map(),
    jsxAttributes: new Set(),
    jsxTags: new Set(),
    jsxText: [],
    loops: 0,
    listenBindings: [],
    newCalls: new Set(),
    nullNodes: 0,
    objectProperties: new Set(),
    propertyIdentifiers: new Map(),
    propertyAccesses: new Set(),
    strings: new Set(),
    throwStatements: 0,
    variables: new Map(),
    assignments: new Set(),
    awaitedCalls: new Set(),
    moduleEntries: [],
  }
}

function isExportedFunction(ts, node) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
}

function isExportedVariable(ts, node) {
  const statement = node.parent?.parent
  return Boolean(statement && ts.isVariableStatement(statement) && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
}

function addMappedValue(map, key, value) {
  if (!map.has(key)) map.set(key, new Set())
  map.get(key).add(value)
}

function jsxAttributeLiteral(ts, attribute) {
  if (!attribute.initializer) return undefined
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text
  if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression && ts.isStringLiteralLike(attribute.initializer.expression)) {
    return attribute.initializer.expression.text
  }
  return undefined
}

function collectFunctionFact(ts, node) {
  const fact = {
    binaryOperators: new Set(),
    calls: new Set(),
    callOptions: new Map(),
    conditionalExpressions: 0,
    finallyBlocks: 0,
    jsxAttributes: new Set(),
    jsxLiteralAttributes: new Map(),
    jsxTags: new Set(),
    jsxText: [],
    loops: 0,
    nullNodes: 0,
    strings: new Set(),
    throws: 0,
  }
  const visit = (current) => {
    if (ts.isImportDeclaration(current) || ts.isImportEqualsDeclaration(current) || ts.isExportDeclaration(current)) return
    if (ts.isCallExpression(current)) {
      const names = [expressionName(ts, current.expression), fullExpressionName(ts, current.expression)].filter(Boolean)
      const optionNames = current.arguments.flatMap((argument) => ts.isObjectLiteralExpression(argument)
        ? argument.properties.map((property) => propertyName(ts, property.name)).filter(Boolean)
        : [])
      for (const name of names) {
        fact.calls.add(name)
        if (!fact.callOptions.has(name)) fact.callOptions.set(name, [])
        fact.callOptions.get(name).push(new Set(optionNames))
      }
    }
    if (ts.isThrowStatement(current)) fact.throws += 1
    if (ts.isBinaryExpression(current)) fact.binaryOperators.add(current.operatorToken.kind)
    if (ts.isConditionalExpression(current)) fact.conditionalExpressions += 1
    if (current.kind === ts.SyntaxKind.NullKeyword) fact.nullNodes += 1
    if (ts.isStringLiteralLike(current) || ts.isNoSubstitutionTemplateLiteral(current)) fact.strings.add(current.text)
    if (ts.isJsxText(current) && current.text.trim()) fact.jsxText.push(current.text.trim())
    if (ts.isJsxOpeningElement(current) || ts.isJsxSelfClosingElement(current)) {
      fact.jsxTags.add(jsxTagName(ts, current.tagName))
      for (const attribute of current.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue
        const name = attribute.name.text
        fact.jsxAttributes.add(name)
        const literal = jsxAttributeLiteral(ts, attribute)
        if (literal !== undefined) addMappedValue(fact.jsxLiteralAttributes, name, literal)
      }
    }
    if (ts.isTryStatement(current) && current.finallyBlock) fact.finallyBlocks += 1
    if (ts.isForStatement(current) || ts.isForInStatement(current) || ts.isForOfStatement(current) || ts.isWhileStatement(current) || ts.isDoStatement(current)) {
      fact.loops += 1
    }
    ts.forEachChild(current, visit)
  }
  visit(node.body ?? node)
  return fact
}

function addCall(facts, name, optionNames = []) {
  facts.calls.set(name, (facts.calls.get(name) ?? 0) + 1)
  if (!facts.callOptions.has(name)) facts.callOptions.set(name, [])
  facts.callOptions.get(name).push(new Set(optionNames))
}

function classMemberNames(ts, member) {
  const names = new Set()
  const identifier = propertyName(ts, member.name)
  if (identifier) names.add(identifier)
  const decorators = typeof ts.getDecorators === 'function' && ts.canHaveDecorators(member)
    ? ts.getDecorators(member) ?? []
    : []
  for (const decorator of decorators) {
    if (!ts.isCallExpression(decorator.expression)) continue
    if (expressionName(ts, decorator.expression.expression) !== 'Property') continue
    for (const argument of decorator.expression.arguments) {
      if (!ts.isObjectLiteralExpression(argument)) continue
      for (const option of argument.properties) {
        if (!ts.isPropertyAssignment(option)) continue
        const optionName = propertyName(ts, option.name)
        if (!['name', 'fieldName'].includes(optionName) || !ts.isStringLiteralLike(option.initializer)) continue
        names.add(option.initializer.text)
      }
    }
  }
  return names
}

function collectFacts(ts, sourceFiles) {
  const facts = newFacts()
  for (const file of sourceFiles) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const visit = (node) => {
      if (ts.isImportDeclaration(node)) {
        const source = node.moduleSpecifier.text
        facts.importSources.add(source)
        const clause = node.importClause
        if (clause?.name) facts.importedBindings.set(clause.name.text, source)
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) facts.importedBindings.set(element.name.text, source)
        } else if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          facts.importedBindings.set(clause.namedBindings.name.text, source)
        }
        return
      }
      if (ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node)) return

      if (ts.isClassDeclaration(node)) {
        const members = new Set(node.members.flatMap((member) => [...classMemberNames(ts, member)]))
        const decorators = typeof ts.getDecorators === 'function' && ts.canHaveDecorators(node)
          ? (ts.getDecorators(node) ?? []).map((decorator) => expressionName(ts, decorator.expression.expression ?? decorator.expression)).filter(Boolean)
          : []
        facts.classes.push({ name: node.name?.text, members, decorators: new Set(decorators) })
        if (node.name) facts.declarations.add(node.name.text)
        for (const decorator of decorators) facts.decorators.add(decorator)
      }
      if (ts.isFunctionDeclaration(node) && node.name) {
        const functionFact = collectFunctionFact(ts, node)
        facts.functions.add(node.name.text)
        facts.declarations.add(node.name.text)
        facts.functionFacts.set(node.name.text, functionFact)
        if (isExportedFunction(ts, node)) facts.exportedFunctions.set(node.name.text, functionFact)
      }
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
        facts.declarations.add(node.name.text)
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        facts.declarations.add(node.name.text)
        if (isExportedVariable(ts, node)) facts.exportedVariables.add(node.name.text)
        const properties = new Set()
        if (node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
          if (isExportedVariable(ts, node)) facts.exportedObjectFacts.set(node.name.text, collectFunctionFact(ts, node.initializer))
          for (const property of node.initializer.properties) {
            const name = propertyName(ts, property.name)
            if (name) properties.add(name)
          }
        }
        facts.variables.set(node.name.text, properties)
        if (node.name.text === 'enabledModules' && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
          for (const element of node.initializer.elements) {
            if (!ts.isObjectLiteralExpression(element)) continue
            const entry = {}
            for (const property of element.properties) {
              if (!ts.isPropertyAssignment(property)) continue
              const name = propertyName(ts, property.name)
              if (!name || !ts.isStringLiteralLike(property.initializer)) continue
              entry[name] = property.initializer.text
            }
            facts.moduleEntries.push(entry)
          }
        }
      }
      if (ts.isCallExpression(node)) {
        const name = expressionName(ts, node.expression)
        const fullName = fullExpressionName(ts, node.expression)
        if (fullName === 'enabledModules.push') {
          for (const argument of node.arguments) {
            if (!ts.isObjectLiteralExpression(argument)) continue
            const entry = {}
            for (const property of argument.properties) {
              if (!ts.isPropertyAssignment(property)) continue
              const propertyKey = propertyName(ts, property.name)
              if (!propertyKey || !ts.isStringLiteralLike(property.initializer)) continue
              entry[propertyKey] = property.initializer.text
            }
            facts.moduleEntries.push(entry)
          }
        }
        const forbiddenModifier = forbiddenTestModifier(ts, node.expression)
        if (forbiddenModifier) facts.forbiddenTestModifiers.add(forbiddenModifier)
        const callPath = expressionPath(ts, node.expression)
        if (callPath.includes('listen')) facts.listenBindings.push(callPath.at(-1) === 'listen' && listenBindsLoopback(ts, node))
        const optionNames = node.arguments.flatMap((argument) => ts.isObjectLiteralExpression(argument)
          ? argument.properties.map((property) => propertyName(ts, property.name)).filter(Boolean)
          : [])
        if (name) addCall(facts, name, optionNames)
        if (fullName && fullName !== name) addCall(facts, fullName, optionNames)
        if (node.parent && ts.isAwaitExpression(node.parent) && name) facts.awaitedCalls.add(name)
      }
      if (ts.isNewExpression(node)) {
        const name = expressionName(ts, node.expression)
        if (name) facts.newCalls.add(name)
      }
      if (ts.isObjectLiteralElementLike(node)) {
        const name = propertyName(ts, node.name)
        if (name) facts.objectProperties.add(name)
      }
      if (ts.isPropertyAssignment(node)) {
        const name = propertyName(ts, node.name)
        if (name && ts.isIdentifier(node.initializer)) addMappedValue(facts.propertyIdentifiers, name, node.initializer.text)
      }
      if (ts.isPropertyAccessExpression(node)) {
        facts.propertyAccesses.add(node.name.text)
        const forbiddenModifier = forbiddenTestModifier(ts, node)
        if (forbiddenModifier) facts.forbiddenTestModifiers.add(forbiddenModifier)
      }
      if (ts.isElementAccessExpression(node)) {
        const forbiddenModifier = forbiddenTestModifier(ts, node)
        if (forbiddenModifier) facts.forbiddenTestModifiers.add(forbiddenModifier)
      }
      if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) facts.strings.add(node.text)
      if (node.kind === ts.SyntaxKind.NullKeyword) facts.nullNodes += 1
      if (ts.isThrowStatement(node)) facts.throwStatements += 1
      if (ts.isTryStatement(node) && node.finallyBlock) facts.finallyBlocks += 1
      if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
        facts.loops += 1
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const name = expressionName(ts, node.left)
        if (name) facts.assignments.add(name)
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        facts.jsxTags.add(jsxTagName(ts, node.tagName))
        for (const attribute of node.attributes.properties) {
          if (!ts.isJsxAttribute(attribute)) continue
          const name = attribute.name.text
          facts.jsxAttributes.add(name)
          const literal = jsxAttributeLiteral(ts, attribute)
          if (literal !== undefined) addMappedValue(facts.jsxLiteralAttributes, name, literal)
        }
      }
      if (ts.isJsxText(node) && node.text.trim()) facts.jsxText.push(node.text.trim())
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return facts
}

function hasCall(facts, ...names) {
  return names.some((name) => (facts.calls.get(name) ?? 0) > 0)
}

function hasOnlyEnabledTests(facts) {
  return facts.forbiddenTestModifiers.size === 0
}

function allServersBindLoopback(facts) {
  return facts.listenBindings.length > 0 && facts.listenBindings.every(Boolean)
}

function hasCallOptions(facts, callName, required) {
  return (facts.callOptions.get(callName) ?? []).some((options) => required.every((name) => options.has(name)))
}

function hasObjectVariable(facts, variableName, required) {
  const properties = facts.variables.get(variableName)
  return Boolean(properties && required.every((name) => properties.has(name)))
}

export function hasExactString(facts, value) {
  return facts.strings.has(value)
}

// SQL migrations arrive as one template-literal string, so containment is the
// only way to assert a clause without hard-coding the author's formatting.
function hasStringIncluding(facts, ...fragments) {
  return [...facts.strings].some((entry) => fragments.every((fragment) => entry.includes(fragment)))
}

function hasStringPrefix(facts, value) {
  return [...facts.strings].some((entry) => entry.startsWith(value))
}

function factReachesCalls(facts, start, requiredCalls) {
  if (!start) return false
  const reached = new Set(start.calls)
  const pending = [...start.calls]
  const visited = new Set()
  while (pending.length) {
    const name = pending.pop()
    if (visited.has(name)) continue
    visited.add(name)
    const local = facts.functionFacts.get(name)
    if (!local) continue
    for (const call of local.calls) {
      reached.add(call)
      pending.push(call)
    }
  }
  return requiredCalls.every((name) => reached.has(name))
}

function exportedFunctionCalls(facts, functionName, requiredCalls) {
  return factReachesCalls(facts, facts.exportedFunctions.get(functionName), requiredCalls)
}

function exportedObjectCalls(facts, variableName, requiredCalls) {
  return factReachesCalls(facts, facts.exportedObjectFacts.get(variableName), requiredCalls)
}

function exportedCommandObjectCalls(facts, variableName, requiredCalls) {
  return [variableName, `${variableName}Command`].some((name) => exportedObjectCalls(facts, name, requiredCalls))
}

function exportedFunctionHasCallOptions(facts, functionName, callName, requiredOptions) {
  const fact = facts.exportedFunctions.get(functionName)
  return Boolean(fact && (fact.callOptions.get(callName) ?? []).some((options) => requiredOptions.every((name) => options.has(name))))
}

function importsSharedComponent(facts, name) {
  return facts.importedBindings.get(name)?.startsWith('@open-mercato/ui') === true
}

function uiPolicyFailures(facts, { allowFormTag = false } = {}) {
  const rawTags = ['button', 'input', 'select', 'textarea', 'svg', ...(allowFormTag ? [] : ['form'])]
  const failures = []
  for (const tag of rawTags) if (facts.jsxTags.has(tag)) failures.push(`raw <${tag}>`)
  if (facts.jsxAttributes.has('style')) failures.push('inline style')
  const strings = [...facts.strings]
  if (strings.some((value) => /(?:^|\s)(?:[a-z-]+:)*(?:text|bg|border|ring)-(?:red|green|emerald|blue|amber|orange|yellow|rose|lime|cyan|teal|indigo|violet|purple|pink)-\d{2,3}(?:\/\d+)?\b/.test(value))) {
    failures.push('hard-coded palette class')
  }
  if (strings.some((value) => /(?:^|\s)\S*\[[^\]]+\]/.test(value))) failures.push('arbitrary Tailwind value')
  if (strings.some((value) => /(?:^|\s)dark:/.test(value))) failures.push('manual dark-mode override')
  for (const name of ['label', 'title', 'placeholder', 'aria-label', 'alt']) {
    if ((facts.jsxLiteralAttributes.get(name)?.size ?? 0) > 0) failures.push(`hard-coded ${name}`)
  }
  if (facts.jsxText.length > 0) failures.push('hard-coded JSX copy')
  return failures
}

function renderedUiChecks(definition, facts) {
  const render = facts.exportedFunctions.get(definition.render)
  const handler = facts.exportedFunctions.get(definition.handler)
  const policyFailures = uiPolicyFailures(facts, { allowFormTag: definition.allowFormTag })
  const strings = [...(render?.strings ?? [])]
  return [
    check('business.ui-rendered-components', Boolean(render) && definition.components.every((name) => render.jsxTags.has(name) && importsSharedComponent(facts, name)), `exported ${definition.render} renders the required shared Open Mercato components`),
    check('business.ui-event-link', Boolean(render) && render.jsxAttributes.has(definition.event) && render.calls.has(definition.handler) && handler?.calls.has(definition.seam), `rendered ${definition.event} reaches ${definition.handler} and the tested ${definition.seam} seam`),
    check('business.ui-localized', Boolean(render) && render.calls.has('useT') && render.calls.has('t') && render.jsxText.length === 0, `exported ${definition.render} obtains all visible copy through useT`),
    check('business.ui-accessible-feedback', Boolean(render) && render.jsxAttributes.has('aria-live') && render.jsxTags.has('Alert') && render.jsxAttributes.has('status'), `exported ${definition.render} renders an accessible shared Alert status region`),
    check('business.ui-responsive', strings.some((value) => /(?:^|\s)(?:sm|md|lg|xl|2xl):/.test(value)), `exported ${definition.render} includes a standard responsive breakpoint`),
    check('business.ui-semantic-token', strings.some((value) => /(?:^|\s)(?:text-(?:foreground|muted-foreground)|bg-(?:background|muted)|border-border)\b/.test(value)), `exported ${definition.render} uses semantic design tokens`),
    check('business.ui-metadata', hasObjectVariable(facts, 'metadata', definition.metadata), `the sibling page metadata declares ${definition.metadata.join(' and ')}`),
    check('business.ui-policy', policyFailures.length === 0, `case-owned UI avoids raw controls/forms, inline SVG/style, hard-coded copy/colors, arbitrary Tailwind, and manual dark overrides${policyFailures.length ? ` (${policyFailures.join(', ')})` : ''}`),
  ]
}

function check(id, passed, requirement) {
  return { id, passed: Boolean(passed), requirement }
}

function caseChecks(ts, caseId, facts, root) {
  const definition = WRITABLE_CASES[caseId]
  if (definition.family === 'complete-module') {
    const scopedEntity = facts.classes.some((entry) => entry.decorators.has('Entity') && ['tenant_id', 'organization_id', 'updated_at'].every((name) => entry.members.has(name)))
    const uiFailures = uiPolicyFailures(facts)
    return [
      check('module.activation', facts.moduleEntries.some((entry) => entry.id === 'library' && entry.from === '@app') && facts.moduleEntries.some((entry) => entry.id === 'directory' && entry.from === '@open-mercato/core') && facts.moduleEntries.some((entry) => entry.id === 'example' && entry.from === '@app'), 'src/modules.ts preserves statically discoverable baseline entries and activates library from @app'),
      check('module.entity', scopedEntity, 'a scoped editable @Entity includes tenant_id, organization_id, and updated_at'),
      check('module.validator', hasCall(facts, 'z.object', 'object'), 'the book input boundary uses a concrete validator object'),
      check('module.acl', facts.exportedVariables.has('features') && hasExactString(facts, 'library.books.view') && hasExactString(facts, 'library.books.manage'), 'acl.ts exports stable view/manage features'),
      check('module.setup', facts.exportedVariables.has('setup') && facts.objectProperties.has('defaultRoleFeatures'), 'setup.ts grants module features through defaultRoleFeatures'),
      check('module.crud-host', hasCallOptions(facts, 'makeCrudRoute', ['metadata', 'orm', 'list', 'actions', 'indexer', 'enrichers']) && hasExactString(facts, 'library:book'), 'the scoped CRUD route publishes aligned indexer and enricher hosts for library:book'),
      check('module.crud-actions', hasCall(facts, 'registerCommand') && ['library.books.create', 'library.books.update', 'library.books.delete'].every((id) => hasExactString(facts, id)) && ['create', 'update', 'delete'].every((name) => facts.objectProperties.has(name)), 'create, update, and delete actions are backed by aligned registered commands'),
      check('module.api-metadata', ['GET', 'POST', 'PUT', 'DELETE', 'requireAuth', 'requireFeatures'].every((name) => facts.objectProperties.has(name)), 'CRUD API metadata declares per-method auth and features'),
      check('module.openapi', facts.exportedVariables.has('openApi'), 'the CRUD API exports OpenAPI documentation separately'),
      check('module.command-atomic', exportedCommandObjectCalls(facts, 'createBook', ['withAtomicFlush'])
        && ['updateBook', 'deleteBook'].every((name) => exportedCommandObjectCalls(facts, name, ['withAtomicFlush', 'enforceCommandOptimisticLock'])),
      'each declared create/update/delete command reaches its own transaction seam, and update/delete each enforce their own optimistic lock'),
      check('module.command-undo', exportedCommandObjectCalls(facts, 'createBook', ['extractUndoPayload', 'emitCrudUndoSideEffects'])
        && ['updateBook', 'deleteBook'].every((name) => exportedCommandObjectCalls(facts, name, ['extractUndoPayload', 'buildCustomFieldResetMap', 'emitCrudUndoSideEffects']))
        && hasCall(facts, 'emitCrudSideEffects'),
      'each declared create/update/delete command owns concrete undo behavior; update/delete restore custom fields and all commands retain forward side effects'),
      check('module.encryption-map', facts.exportedVariables.has('defaultEncryptionMaps') && hasExactString(facts, 'library:book'), 'encryption.ts exports a library:book defaultEncryptionMaps entry'),
      check('module.encrypted-read', ['findWithDecryption', 'findOneWithDecryption', 'findAndCountWithDecryption'].some((name) => hasCall(facts, name)) && [...facts.importSources].includes('@open-mercato/shared/lib/encryption/find'), 'read paths use a scoped framework decryption helper'),
      check('module.search', facts.exportedVariables.has('searchConfig') && ['fieldPolicy', 'checksumSource', 'formatResult'].every((name) => facts.objectProperties.has(name)), 'search.ts defines policy, checksum, and presentation contracts'),
      check('module.table', facts.jsxTags.has('DataTable') && facts.jsxTags.has('RowActions') && facts.jsxAttributes.has('extensionTableId') && hasExactString(facts, '/backend/library/books/create') && [...facts.strings].some((value) => value === 'edit' || value.endsWith('.edit')) && [...facts.strings].some((value) => value === 'delete' || value.endsWith('.delete')), 'the extensible DataTable list exposes add, linked edit, and guarded delete actions'),
      check('module.list-query', facts.jsxAttributes.has('searchValue') && facts.jsxAttributes.has('onSearchChange') && ['search', 'buildFilters'].every((name) => facts.objectProperties.has(name)), 'the DataTable and scoped CRUD list connect server search and filters'),
      check('module.form', facts.jsxTags.has('CrudForm') && facts.jsxAttributes.has('initialValues') && (facts.jsxAttributes.has('entityId') || facts.objectProperties.has('entityIds')) && ['createCrud', 'updateCrud', 'deleteCrud'].every((name) => hasCall(facts, name)), 'CrudForm create/edit/delete binds the stable custom-field entity identity and initial values'),
      check('module.custom-fields', hasCall(facts, 'collectCustomFieldValues') && hasCall(facts, 'buildCustomFieldResetMap'), 'UI submission and command undo preserve custom fields'),
      check('module.sidebar', ['pageTitleKey', 'pageGroupKey', 'pagePriority', 'pageOrder', 'icon', 'breadcrumb'].every((name) => facts.objectProperties.has(name)), 'the Books list page metadata publishes localized main-sidebar navigation'),
      check('module.localized-ui', hasCall(facts, 'useT') && hasCall(facts, 't') && uiFailures.length === 0, `rendered UI uses i18n and shared design-system policy${uiFailures.length ? ` (${uiFailures.join(', ')})` : ''}`),
    ]
  }
  if (definition.family === 'booking-overlap') {
    const scopedEntity = facts.classes.some((entry) => entry.decorators.has('Entity') && ['tenant_id', 'organization_id', 'updated_at'].every((name) => entry.members.has(name)))
    return [
      check('overlap.exclusion-constraint', hasStringIncluding(facts, 'btree_gist') && hasStringIncluding(facts, 'exclude using gist', 'tstzrange', "'[)'"), 'the migration guards overlaps with a btree_gist exclusion constraint over a half-open tstzrange'),
      check('overlap.constraint-scope', hasStringIncluding(facts, 'exclude using gist', 'room_id', 'tenant_id', 'organization_id'), 'the exclusion constraint scopes by room and tenant/organization, not by period alone'),
      check('overlap.constraint-liveness', hasStringIncluding(facts, 'exclude using gist', 'deleted_at', 'cancelled'), 'cancelled and soft-deleted rows are excluded so they do not block the slot'),
      check('overlap.conflict-mapping', hasExactString(facts, '23P01') && facts.newCalls.has('CrudHttpError'), 'the command recognises the exclusion violation (SQLSTATE 23P01) and maps it to a conflict error instead of a 500'),
      check('overlap.entity-id-source', [...facts.importSources].includes('@/.mercato/generated/entities.ids.generated'), 'entity IDs come from the generated E map through the app alias, never hand-written strings'),
      check('overlap.scoped-entity', scopedEntity, 'the booking entity carries tenant_id, organization_id, and updated_at'),
      check('overlap.command-atomic', hasCallOptions(facts, 'withAtomicFlush', ['transaction']), 'booking writes flush inside a transaction so the constraint decides atomically'),
      check('overlap.command-undo', hasCall(facts, 'extractUndoPayload') && hasCall(facts, 'emitCrudSideEffects'), 'commands persist undo evidence and emit post-commit side effects'),
      check('overlap.crud-host', hasCallOptions(facts, 'makeCrudRoute', ['metadata', 'orm', 'list', 'actions', 'indexer']), 'the bookings CRUD route wires metadata, scoped ORM, list, command actions, and indexer'),
    ]
  }
  if (definition.family === 'provider-transport') {
    const guard = facts.exportedFunctions.get('assertSafeEndpoint')
    const client = facts.exportedFunctions.get('createRoomCalendarClient')
    return [
      check('provider.paired-exports', ['integration', 'integrations', 'bundle', 'bundles'].every((name) => facts.exportedVariables.has(name)), 'integration.ts declares all four paired exports the generated module registry reads'),
      check('provider.credential-schema', hasObjectVariable(facts, 'integration', ['id', 'credentials', 'healthCheck']) && hasExactString(facts, 'secret') && hasExactString(facts, 'url'), 'the integration declares typed credential fields including a secret and the endpoint URL'),
      check('provider.health-di', hasExactString(facts, definition.healthService) && hasCall(facts, 'container.register'), `DI registers the exact ${definition.healthService} service declared by integration.ts`),
      check('provider.ssrf-guard', Boolean(guard && guard.throws > 0) && hasExactString(facts, 'https:'), 'exported assertSafeEndpoint rejects non-HTTPS and unsafe endpoints on every call'),
      check('provider.idempotency-key', hasExactString(facts, 'idempotency-key'), 'every remote mutation carries a stable idempotency key header'),
      check('provider.redirect-refusal', hasExactString(facts, 'manual'), 'the transport refuses to follow redirects'),
      check('provider.bounded-retry', Boolean(client && client.loops > 0), 'exported createRoomCalendarClient retries through a bounded loop'),
      check('provider.unconfigured-degraded', hasExactString(facts, 'unconfigured'), 'a missing configuration reports a degraded state instead of failing'),
    ]
  }
  if (definition.family === 'response-enricher') {
    return [
      check('enricher.dot-target', hasExactString(facts, 'customers.person') && !hasExactString(facts, 'customers:person'), 'targetEntity uses the dot form customers.person; the colon-form ID never matches and is silently skipped'),
      check('enricher.batched', facts.objectProperties.has('enrichMany') && facts.objectProperties.has('enrichOne'), 'the enricher implements both enrichOne and batched enrichMany'),
      check('enricher.namespaced', facts.objectProperties.has('_room_bookings'), 'added fields live under the module underscore namespace'),
      check('enricher.resilience', ['fallback', 'timeout', 'cacheableOnListHit'].every((name) => facts.objectProperties.has(name)), 'the enricher declares fallback, timeout, and conservative list-cache behaviour'),
      check('enricher.acl', hasExactString(facts, 'room_bookings.bookings.view'), 'the enricher gates on the owning module feature'),
      check('enricher.registration', facts.exportedVariables.has('enrichers') && facts.importedBindings.get('ResponseEnricher') === '@open-mercato/shared/lib/crud/response-enricher', 'the typed enricher list is exported for discovery'),
    ]
  }
  if (definition.family === 'durable-workflow') {
    return [
      check('workflow.timer-config', hasExactString(facts, 'WAIT_FOR_TIMER') && facts.objectProperties.has('config') && facts.objectProperties.has('duration') && hasStringPrefix(facts, 'PT'), 'the WAIT_FOR_TIMER step declares an ISO 8601 duration; without one the instance fails with TIMER_CONFIG_MISSING after it is already paused'),
      check('workflow.safe-commands', hasCall(facts, 'registerWorkflowSafeCommands') && facts.objectProperties.has('requiredFeatures') && hasExactString(facts, 'room_bookings.bookings.update'), 'the dispatched command is allowlisted with the features it is authorised against'),
      check('workflow.builder', hasCall(facts, 'defineWorkflow') && hasCall(facts, 'createWorkflowsModuleConfig') && facts.exportedVariables.has('workflowsConfig'), 'the definition uses the typed builder and exports the discovered workflowsConfig'),
      check('workflow.terminal-graph', hasExactString(facts, 'START') && hasExactString(facts, 'END'), 'the graph declares an explicit start and a reachable end'),
      check('workflow.confirmation-beats-expiry', hasExactString(facts, 'signal') && hasExactString(facts, 'timer'), 'confirmation arrives as a signal transition competing with the expiry timer'),
      check('workflow.dispatch-update-entity', hasExactString(facts, 'UPDATE_ENTITY'), 'the release path cancels the hold through an UPDATE_ENTITY activity, not a direct mutation'),
    ]
  }
  if (definition.family === 'crm-library-regression') {
    const schemaFacts = collectFacts(ts, collectSourceFiles(root, [definition.schemaSource]))
    const testFacts = collectFacts(ts, collectSourceFiles(root, [definition.testSource]))
    const scopedActions = ['createBook', 'undoCreateBook', 'deleteBook', 'undoDeleteBook', 'checkoutBook', 'returnLoan', 'renewLoan', 'markLoanLost']
    return [
      check('crm-library.exports', scopedActions.every((name) => facts.exportedFunctions.has(name)), 'the stable lifecycle, checkout, return, renew, and mark-lost seams remain exported'),
      check('crm-library.trusted-scope', scopedActions.every((name) => exportedFunctionCalls(facts, name, ['requireTrustedScope'])), 'every mutating seam fails closed through the same trusted tenant/organization scope guard'),
      check('crm-library.lifecycle', exportedFunctionCalls(facts, 'createBook', ['effects.createBook'])
        && exportedFunctionCalls(facts, 'undoCreateBook', ['effects.softDeleteBook'])
        && exportedFunctionCalls(facts, 'deleteBook', ['effects.softDeleteBook'])
        && exportedFunctionCalls(facts, 'undoDeleteBook', ['effects.restoreBook']),
      'create undo soft-deletes, delete soft-deletes, and delete undo restores through explicit scoped effects'),
      check('crm-library.crm-checkout', exportedFunctionCalls(facts, 'checkoutBook', ['effects.resolveCustomer', 'effects.claimCheckout'])
        && !hasExactString(facts, 'memberId'), 'checkout resolves an existing CRM customer and reaches the atomic claim seam without a duplicate local member'),
      check('crm-library.loan-scope', ['returnLoan', 'renewLoan', 'markLoanLost'].every((name) => exportedFunctionCalls(facts, name, ['effects.findLoan', 'effects.updateLoan'])), 'every loan action performs both lookup and mutation through scoped effects'),
      check('crm-library.public-schema', !schemaFacts.objectProperties.has('tenantId') && !schemaFacts.objectProperties.has('organizationId')
        && schemaFacts.exportedVariables.has('createBookRequestSchema') && schemaFacts.exportedVariables.has('checkoutBookRequestSchema'),
      'public create/checkout request schemas omit tenantId and organizationId because runtime scope is server-derived'),
      check('crm-library.jest-import', [...testFacts.importSources].includes('@jest/globals') && hasOnlyEnabledTests(testFacts), 'generated Jest coverage imports its globals explicitly and contains no disabled/focused/expected-failure modifiers'),
      check('crm-library.semantic-tests', ['createBook', 'undoCreateBook', 'deleteBook', 'undoDeleteBook', 'returnLoan', 'renewLoan', 'markLoanLost'].every((name) => hasCall(testFacts, name))
        && (testFacts.calls.get('checkoutBook') ?? 0) >= 3 && hasCall(testFacts, 'Promise.all'),
      'generated tests exercise lifecycle undo, every scoped loan action, concurrent checkout, and deterministic retry'),
    ]
  }
  if (definition.family === 'business-command') {
    const fact = facts.exportedFunctions.get(definition.seam)
    return [
      check('business.command-seam', exportedFunctionCalls(facts, definition.seam, ['effects.reserveIdempotency', 'effects.transaction', 'effects.apply', 'effects.record']), `exported ${definition.seam} uses the idempotency, transaction, mutation, and lineage seams`),
      check('business.command-guard', (fact?.throws ?? 0) > 0, `exported ${definition.seam} rejects an invalid business invariant`),
    ]
  }
  if (definition.family === 'ui-business-surface') {
    const fact = facts.exportedFunctions.get(definition.seam)
    return [
      check('business.ui-seam', exportedFunctionCalls(facts, definition.seam, ['effects.execute', 'effects.restoreFocus', 'effects.announce']), `exported ${definition.seam} executes, restores focus, and announces the result`),
      check('business.ui-guard', (fact?.throws ?? 0) > 0, `exported ${definition.seam} rejects an invalid UI business action`),
      check('business.ui-finally', (fact?.finallyBlocks ?? 0) > 0, `exported ${definition.seam} restores focus after both success and failure`),
      ...renderedUiChecks(definition, facts),
    ]
  }
  if (definition.family === 'data-table-extension') {
    const fact = facts.exportedFunctions.get(definition.seam)
    const onExecute = facts.propertyIdentifiers.get('onExecute')
    return [
      check('business.table-filter-host', hasObjectVariable(facts, 'injectionTable', ['data-table:sales.orders:filters']) && hasExactString(facts, 'order_risk.injection.order-risk-filter'), 'the exact sales.orders filters host loads the order-risk filter widget'),
      check('business.table-bulk-host', hasObjectVariable(facts, 'injectionTable', ['data-table:sales.orders:bulk-actions']) && hasExactString(facts, 'order_risk.injection.order-risk-review'), 'the exact sales.orders bulk-actions host loads the order-risk review widget'),
      check('business.table-filter', facts.exportedVariables.has('orderRiskFilterWidget') && hasObjectVariable(facts, 'orderRiskFilterWidget', ['metadata', 'filters']) && ['order-risk', 'order_risk.filters.risk.label', 'server', 'risk'].every((value) => hasExactString(facts, value)), 'an exported localized server-backed order-risk filter is registered'),
      check('business.table-bulk-action', facts.exportedVariables.has('orderRiskReviewWidget') && hasObjectVariable(facts, 'orderRiskReviewWidget', ['metadata', 'bulkActions']) && hasExactString(facts, 'review-order-risk') && onExecute?.has(definition.seam), `the exported bulk action links onExecute directly to ${definition.seam}`),
      check('business.table-safe-seam', exportedFunctionCalls(facts, definition.seam, ['effects.authorize', 'effects.checkVersion', 'effects.surfaceConflict', 'effects.execute']) && (fact?.loops ?? 0) > 0 && (fact?.throws ?? 0) > 0, `exported ${definition.seam} authorizes and version-checks every selected order before execution`),
      check('business.table-ui-policy', uiPolicyFailures(facts).length === 0, 'the injected table extension avoids raw UI, inline SVG/style, hard-coded copy/colors, arbitrary Tailwind, and manual dark overrides'),
    ]
  }
  if (definition.family === 'async-operation') {
    const fact = facts.exportedFunctions.get(definition.seam)
    return [
      check('business.async-seam', exportedFunctionCalls(facts, definition.seam, ['effects.isCancelled', 'effects.shouldSkip', 'effects.applyChunk', 'effects.reportProgress', 'effects.registerUndo']), `exported ${definition.seam} uses cancellation, skip, mutation, progress, and undo seams`),
      check('business.async-loop', (fact?.loops ?? 0) > 0, `exported ${definition.seam} processes work through a bounded loop`),
    ]
  }
  if (definition.family === 'ai-safe-agent') {
    const requiredCalls = definition.mode === 'mutation'
      ? ['effects.authorize', 'effects.prepareMutation', 'effects.execute']
      : ['effects.authorize', 'effects.delegate']
    const checks = [
      check('business.ai-seam', exportedFunctionCalls(facts, definition.seam, requiredCalls), `exported ${definition.seam} uses the required authorization and ${definition.mode} seams`),
    ]
    if (definition.mode === 'delegate') {
      checks.push(check('business.ai-authority', exportedFunctionHasCallOptions(facts, definition.seam, 'effects.delegate', ['authority', 'allowedTools']), `exported ${definition.seam} delegates with an explicit authority ceiling and allowlist`))
    }
    return checks
  }
  if (definition.family === 'provider-adapter') {
    const fact = facts.exportedFunctions.get(definition.seam)
    const checks = [
      check('business.provider-seam', exportedFunctionCalls(facts, definition.seam, ['effects.findExisting', 'effects.request', 'effects.reconcile', 'effects.redact']), `exported ${definition.seam} uses idempotency, provider, reconciliation, and redaction seams`),
      check('business.provider-retry', (fact?.loops ?? 0) > 0 && (fact?.throws ?? 0) > 0, `exported ${definition.seam} bounds retries and redacts terminal failure`),
      check('business.provider-integration', facts.importedBindings.get('IntegrationDefinition') === '@open-mercato/shared/modules/integrations/types' && facts.exportedVariables.has('integration') && facts.exportedVariables.has('integrations') && hasObjectVariable(facts, 'integration', ['id', 'category', 'providerKey', 'credentials', 'healthCheck']), 'integration.ts exports typed IntegrationDefinition metadata, credentials, and health'),
      check('business.provider-secret', hasExactString(facts, 'secret'), 'integration credentials include a secret-bearing field type'),
      check('business.provider-health', hasExactString(facts, definition.healthService) && hasCall(facts, 'container.register'), `DI registers the exact ${definition.healthService} health service declared by integration.ts`),
      check('business.provider-activation', facts.moduleEntries.some((entry) => entry.id === definition.moduleId && entry.from === '@app'), `src/modules.ts activates ${definition.moduleId} from @app`),
    ]
    if (definition.providerKind === 'transactional-email') {
      checks.push(
        check('business.provider-transactional-di', hasObjectVariable(facts, 'smtpEmailService', ['send']) && facts.propertyIdentifiers.get('send')?.has(definition.seam), 'DI-facing SMTP sender delegates to the tested transactional client seam'),
        check('business.provider-not-mailbox', !hasExactString(facts, 'communication_channels') && !facts.importedBindings.has('ChannelAdapter'), 'transactional SMTP does not claim the mailbox ChannelAdapter contract'),
      )
    }
    if (definition.providerKind === 'payment') {
      checks.push(
        check('business.provider-payment-contract', facts.importedBindings.get('GatewayAdapter') === '@open-mercato/shared/modules/payment_gateways/types' && hasObjectVariable(facts, definition.adapterVariable, ['providerKey', 'createSession', 'capture', 'refund', 'cancel', 'getStatus', 'verifyWebhook', 'mapStatus']) && hasCall(facts, definition.seam), 'provider implements the installed GatewayAdapter surface and reaches the tested client seam'),
        check(
          'business.provider-payment-registration',
          hasCall(facts, 'registerGatewayAdapter')
            && hasCall(facts, 'registerPaymentGatewayDescriptor')
            && facts.importedBindings.get('registerWebhookHandler') === '@open-mercato/shared/modules/payment_gateways/types'
            && hasCall(facts, 'registerWebhookHandler')
            && facts.propertyAccesses.has('verifyWebhook'),
          'DI registers the gateway adapter, its verifyWebhook handler, and the payment descriptor',
        ),
      )
    }
    if (definition.providerKind === 'shipping') {
      checks.push(
        check('business.provider-shipping-contract', facts.importedBindings.get('ShippingAdapter') === '@open-mercato/core/modules/shipping_carriers/lib/adapter' && hasObjectVariable(facts, definition.adapterVariable, ['providerKey', 'calculateRates', 'createShipment', 'getTracking', 'cancelShipment', 'verifyWebhook', 'mapStatus']) && hasCall(facts, definition.seam), 'provider implements the installed ShippingAdapter surface and reaches the tested client seam'),
        check('business.provider-shipping-registration', hasCall(facts, 'registerShippingAdapter'), 'DI registers the shipping adapter'),
      )
    }
    if (definition.providerKind === 'payment' || definition.providerKind === 'shipping') {
      checks.push(
        check('business.provider-acl', facts.exportedVariables.has('features') && hasExactString(facts, `${definition.moduleId}.view`) && hasExactString(facts, `${definition.moduleId}.configure`), 'provider acl.ts exports stable view/configure features'),
        check('business.provider-setup', facts.exportedVariables.has('setup') && hasObjectVariable(facts, 'setup', ['defaultRoleFeatures']), 'provider setup.ts grants its features through defaultRoleFeatures'),
      )
    }
    return checks
  }
  if (definition.family === 'data-flow') {
    const fact = facts.exportedFunctions.get(definition.seam)
    return [
      check('business.data-seam', exportedFunctionCalls(facts, definition.seam, ['effects.fetchPage', 'effects.sanitize', 'effects.apply', 'effects.commitCursor']), `exported ${definition.seam} uses fetch, sanitization, row mutation, and cursor seams`),
      check('business.data-loop', (fact?.loops ?? 0) > 0, `exported ${definition.seam} isolates rows in a loop`),
    ]
  }
  if (definition.family === 'test-authoring-unit') {
    return [
      check('business.test-unit-runner', (facts.calls.get('test') ?? 0) >= 3 && (facts.calls.get('expect') ?? 0) >= 3, 'at least three executable Jest tests with assertions'),
      check('business.test-unit-enabled', hasOnlyEnabledTests(facts), 'generated Jest coverage contains no disabled, focused-only, todo, or expected-failure tests or suites'),
      check('business.test-unit-invariants', ['already approved', 'requester', 'injected failure'].every((value) => [...facts.strings].some((entry) => entry.toLowerCase().includes(value))), 'test titles or assertions cover duplicate approval, separation of duties, and injected failure'),
      check('business.test-unit-failure', hasCall(facts, 'toThrow', 'toReject', 'rejects.toThrow') && hasCall(facts, 'toHaveBeenCalledTimes', 'toEqual', 'toBe'), 'failure and rollback outcomes are asserted'),
    ]
  }
  if (definition.family === 'test-authoring-api') {
    return [
      check('business.test-api-runner', facts.importedBindings.get('test') === '@playwright/test' && facts.importedBindings.get('expect') === '@playwright/test', 'the module-local spec uses the Playwright test runner'),
      check('business.test-api-enabled', hasOnlyEnabledTests(facts), 'generated API coverage contains no disabled, focused-only, todo, or expected-failure tests or suites'),
      check('business.test-api-http', ['request.post', 'request.patch', 'request.delete'].every((name) => hasCall(facts, name)), 'real HTTP creation, stale update, and cleanup requests are executed'),
      check('business.test-api-scope-conflict', hasExactString(facts, 'x-organization-id') && hasExactString(facts, 'if-match') && (facts.calls.get('toBe') ?? 0) >= 4, 'organization denial and optimistic conflict statuses are asserted'),
      check('business.test-api-lifecycle', allServersBindLoopback(facts) && hasCall(facts, 'close') && facts.finallyBlocks > 0, 'every ephemeral server listen call binds the literal host 127.0.0.1 and is closed in finally'),
    ]
  }
  if (definition.family === 'test-authoring-browser') {
    return [
      check('business.test-browser-runner', facts.importedBindings.get('test') === '@playwright/test' && facts.importedBindings.get('expect') === '@playwright/test', 'the module-local spec uses the Playwright test runner'),
      check('business.test-browser-enabled', hasOnlyEnabledTests(facts), 'generated browser coverage contains no disabled, focused-only, todo, or expected-failure tests or suites'),
      check('business.test-browser-real-page', hasCall(facts, 'page.goto') && hasCall(facts, 'page.getByRole') && hasCall(facts, 'click'), 'a real browser navigates loopback HTTP and interacts through semantic roles'),
      check('business.test-browser-coverage', hasExactString(facts, '/portal/orders/forbidden') && hasExactString(facts, '/api/backend/quotes/quote-1') && hasCall(facts, 'toHaveText', 'toContainText', 'toBe'), 'direct-route denial, stale conflict, and backend state are asserted'),
      check('business.test-browser-lifecycle', allServersBindLoopback(facts) && hasCall(facts, 'close') && facts.finallyBlocks > 0, 'every ephemeral server listen call binds the literal host 127.0.0.1 and is closed in finally'),
    ]
  }
  switch (caseId) {
    case 'OMH-009': {
      const entity = facts.classes.some((entry) => entry.decorators.has('Entity') && ['tenant_id', 'organization_id', 'updated_at'].every((name) => entry.members.has(name)))
      return [
        check('entity.declaration', entity, 'an @Entity class declaring tenant_id, organization_id, and updated_at'),
        check('entity.validator', hasCall(facts, 'z.object') || hasCall(facts, 'object'), 'a concrete validator object call'),
        check('entity.migration', facts.classes.some((entry) => entry.members.has('up')), 'a migration class with an up method'),
      ]
    }
    case 'OMH-011':
      return [
        check('crud.factory-import', facts.importedBindings.get('makeCrudRoute') === '@open-mercato/shared/lib/crud/factory', 'makeCrudRoute imported from @open-mercato/shared/lib/crud/factory'),
        check('crud.route', hasCallOptions(facts, 'makeCrudRoute', ['metadata', 'orm', 'list', 'actions', 'indexer']), 'makeCrudRoute called with metadata, orm, list, actions, and indexer options'),
        check('crud.openapi', facts.exportedVariables.has('openApi'), 'openApi exported separately from the CRUD factory options'),
      ]
    case 'OMH-012':
      return [
        check('command.guards', hasCall(facts, 'runMutationGuards'), 'a runMutationGuards call'),
        check('command.atomic', hasCall(facts, 'withAtomicFlush'), 'a withAtomicFlush call'),
        check('command.effects', hasCall(facts, 'emitCrudSideEffects'), 'an emitCrudSideEffects call'),
      ]
    case 'OMH-014':
      return [
        check('ui.table', facts.jsxTags.has('DataTable') && (facts.jsxAttributes.has('extensionTableId') || facts.objectProperties.has('extensionTableId')), 'a DataTable JSX use with extensionTableId'),
        check('ui.form', facts.jsxTags.has('CrudForm') && facts.jsxAttributes.has('initialValues'), 'a CrudForm JSX use with initialValues'),
        check('ui.conflict', hasCall(facts, 'surfaceRecordConflict'), 'a surfaceRecordConflict call'),
      ]
    case 'OMH-026':
      return [
        check('umes.form-spot', hasStringPrefix(facts, 'crud-form:'), 'a concrete crud-form:* spot ID literal'),
        check('umes.enricher', hasCall(facts, 'enrichMany'), 'an enrichMany call'),
        check('umes.interceptor', hasObjectVariable(facts, 'interceptors', []) || facts.declarations.has('interceptors'), 'an interceptors declaration'),
      ]
    case 'OMH-027':
      return [
        check('umes.table-spot', hasStringPrefix(facts, 'data-table:'), 'a concrete data-table:* spot ID literal'),
        check('umes.table-id', facts.objectProperties.has('extensionTableId') || facts.jsxAttributes.has('extensionTableId'), 'an extensionTableId option or JSX attribute'),
      ]
    case 'OMH-029':
      return [check('umes.page-override', facts.declarations.has('overrides') && facts.objectProperties.has('page'), 'an overrides declaration containing a page option')]
    case 'OMH-031':
      return [
        check('umes.interceptors', facts.declarations.has('interceptors'), 'an interceptors declaration'),
        check('umes.interceptor-scope', ['metadata', 'organizationId', 'tenantId'].every((name) => facts.propertyAccesses.has(name) || facts.objectProperties.has(name)), 'metadata, organizationId, and tenantId used in executable AST'),
        check('umes.interceptor-hook', facts.objectProperties.has('before') || facts.objectProperties.has('after'), 'a before or after interceptor hook'),
      ]
    case 'OMH-042':
      return [
        check('provider.adapter', [...facts.variables.entries()].some(([, properties]) => properties.has('health') && (properties.has('pull') || properties.has('run'))), 'an adapter object declaration with health and pull/run methods'),
        check('provider.effects', hasCall(facts, 'fetchPage') && hasCall(facts, 'applyItem') && hasCall(facts, 'commitCursor'), 'fetchPage, applyItem, and commitCursor call sites'),
      ]
    case 'OMH-045':
      return [
        check('rest.url', facts.newCalls.has('URL'), 'a concrete new URL(...) call'),
        check('rest.retry', facts.loops > 0 || hasCall(facts, 'retry'), 'a retry loop or retry(...) call'),
        check('rest.cursor', facts.assignments.has('cursor') && (facts.awaitedCalls.has('fetch') || facts.awaitedCalls.has('fetchImpl') || facts.awaitedCalls.has('fetchPage')), 'cursor assignment and an awaited fetch call'),
      ]
    case 'OMH-049':
      return [check('ai.agent', hasCallOptions(facts, 'defineAiAgent', ['provider', 'model', 'allowedTools', 'requiredFeatures']), 'defineAiAgent called with provider, model, allowedTools, and requiredFeatures options')]
    case 'OMH-054':
      return [
        check('workflow.activity', facts.functions.has('callApiActivity') && hasExactString(facts, 'CALL_API'), 'a callApiActivity declaration and CALL_API literal'),
        check('workflow.transaction', hasCall(facts, 'transaction', 'transactional'), 'a transaction/transactional call'),
        check('workflow.idempotency', (hasCall(facts, 'fetch', 'fetchImpl') && facts.objectProperties.has('headers') && hasExactString(facts, 'Idempotency-Key')), 'a fetch call with headers and an Idempotency-Key literal'),
      ]
    case 'OMH-057':
    case 'OMH-171':
      return [
        check('regression.fail-closed', facts.functions.has('listRecords') && facts.throwStatements > 0, 'listRecords with a fail-closed throw'),
        check('regression.scope', ['tenantId', 'organizationId'].every((name) => facts.propertyAccesses.has(name) || facts.objectProperties.has(name)), 'tenantId and organizationId concrete scope access'),
      ]
    case 'OMH-060':
      return [
        check('regression.atomic', hasCall(facts, 'withAtomicFlush', 'transaction', 'transactional'), 'a withAtomicFlush/transaction/transactional call'),
        check('regression.phases', (facts.calls.get('persist') ?? 0) >= 2, 'two concrete persist call sites inside the atomic operation'),
      ]
    case 'OMH-061':
      return [
        check('regression.nullable', facts.nullNodes > 0, 'a concrete nullable type or null expression'),
        check('regression.form', facts.jsxTags.has('CrudForm') && facts.jsxAttributes.has('initialValues'), 'CrudForm JSX with initialValues'),
      ]
    case 'OMH-172': {
      const initialValues = facts.exportedFunctions.get('toInitialValues')
      const updatePayload = facts.exportedFunctions.get('toUpdatePayload')
      return [
        check('regression.null-load-seam', Boolean(initialValues) && !initialValues.binaryOperators.has(ts.SyntaxKind.QuestionQuestionToken), 'exported toInitialValues preserves explicit null instead of replacing it'),
        check('regression.null-clear-seam', Boolean(updatePayload) && updatePayload.nullNodes > 0 && updatePayload.conditionalExpressions > 0 && updatePayload.binaryOperators.has(ts.SyntaxKind.EqualsEqualsEqualsToken), 'exported toUpdatePayload maps an explicit clear to null'),
        check('regression.form', facts.jsxTags.has('CrudForm') && facts.jsxAttributes.has('initialValues'), 'CrudForm JSX with initialValues'),
      ]
    }
    case 'OMH-070':
      return [
        check('regression.cursor-fetch', facts.functions.has('syncPage') && facts.awaitedCalls.has('fetchPage') && facts.assignments.has('cursor'), 'syncPage with awaited fetchPage and cursor assignment'),
        check('regression.cursor-retry', facts.loops > 0 || hasCall(facts, 'retry'), 'a retry loop or retry(...) call'),
      ]
    default:
      return [check('case.supported', false, 'a fixed writable oracle')]
  }
}

function runTargetTypecheck(root) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-harness-oracle-'))
  const home = path.join(tempRoot, 'home')
  fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  const env = {
    PATH: process.env.PATH ?? '', HOME: home, TMPDIR: tempRoot, TEMP: tempRoot, TMP: tempRoot,
    XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'),
    CI: '1', NO_COLOR: '1', NEXT_TELEMETRY_DISABLED: '1', YARN_ENABLE_TELEMETRY: '0', TZ: 'UTC',
  }
  const configuredCorepackHome = process.env.COREPACK_HOME || path.join(os.homedir(), '.cache', 'node', 'corepack')
  const corepackHome = fs.existsSync(configuredCorepackHome) && fs.statSync(configuredCorepackHome).isDirectory()
    ? fs.realpathSync(configuredCorepackHome)
    : undefined
  if (corepackHome) env.COREPACK_HOME = corepackHome
  let result
  try {
    const dependencyPath = path.join(root, 'node_modules')
    const invocation = sandboxedInvocation({
      command: process.platform === 'win32' ? 'yarn.cmd' : 'yarn',
      args: ['typecheck', '--tsBuildInfoFile', path.join(tempRoot, 'tsconfig.tsbuildinfo')],
      cwd: root,
      writableRoots: [root, tempRoot],
      readOnlyRoots: [...(fs.existsSync(dependencyPath) ? [fs.realpathSync(dependencyPath)] : []), ...(corepackHome ? [corepackHome] : [])],
      networkAllowed: false,
      env,
    })
    result = spawnSync(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      encoding: 'utf8',
      shell: false,
      timeout: TYPECHECK_TIMEOUT_MS,
      windowsHide: true,
    })
  } catch (error) {
    result = { status: null, signal: null, stdout: '', stderr: '', error }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
  if (result.error?.code === 'ETIMEDOUT' || result.signal) {
    return check('target.typecheck', false, `yarn typecheck must complete within ${TYPECHECK_TIMEOUT_MS}ms`)
  }
  if (result.error) return check('target.typecheck', false, `yarn typecheck could not start: ${result.error.message}`)
  if (result.status !== 0) {
    const summary = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim().replaceAll(root, '<target>').slice(0, 1000)
    return check('target.typecheck', false, `yarn typecheck failed${summary ? `: ${summary}` : ''}`)
  }
  return check('target.typecheck', true, 'yarn typecheck succeeds')
}

export function evaluateWritableAstOracle({ root: requestedRoot, caseId, phase }) {
  if (!path.isAbsolute(requestedRoot)) throw new Error('root must be absolute')
  if (!WRITABLE_CASES[caseId]) throw new Error(`unsupported writable case: ${caseId}`)
  if (!['before', 'after'].includes(phase)) throw new Error('phase must be before or after')
  const root = fs.realpathSync(requestedRoot)
  const ts = loadTargetTypeScript(root)
  const definition = WRITABLE_CASES[caseId]
  const checks = definition.artifacts.map((artifact) => check(`artifact:${artifact}`, artifactExists(root, artifact), `artifact ${artifact} exists`))
  const sourceFiles = collectSourceFiles(root, definition.sources)
  checks.push(check('source.present', sourceFiles.length > 0, 'at least one case-owned TypeScript source file'))
  if (sourceFiles.length) checks.push(...caseChecks(ts, caseId, collectFacts(ts, sourceFiles), root))
  if (phase === 'after') checks.push(runTargetTypecheck(root))
  const failures = checks.filter((entry) => !entry.passed).map((entry) => `${entry.id}: ${entry.requirement}`)
  return { passed: failures.length === 0, failures, checks }
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
    const result = evaluateWritableAstOracle({ root: options.root, caseId: options.caseId, phase: options.phase })
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return result.passed ? 0 : 1
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stdout.write(`${JSON.stringify({ passed: false, failures: [message], checks: [] })}\n`)
    return 2
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
