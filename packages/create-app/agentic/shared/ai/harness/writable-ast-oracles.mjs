#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

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
    sources: ['src/modules/deal_accessibility/backend/board/page.tsx'],
    artifacts: ['src/modules/deal_accessibility/backend/board/page.tsx'],
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
    sources: ['src/modules/demo_requests/frontend/request-demo.tsx'],
    artifacts: ['src/modules/demo_requests/frontend/request-demo.tsx'],
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
    sources: ['src/modules/setup_wizard/backend/setup/page.tsx'],
    artifacts: ['src/modules/setup_wizard/backend/setup/page.tsx'],
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
    sources: ['src/modules/smtp_email'],
    artifacts: ['src/modules/smtp_email/index.ts', 'src/modules/smtp_email/lib/client.ts', 'src/modules/smtp_email/lib/health.ts'],
  },
  'OMH-150': {
    family: 'provider-adapter',
    seam: 'createCardPayment',
    sources: ['src/modules/card_payments/lib/adapter.ts'],
    artifacts: ['src/modules/card_payments/lib/adapter.ts'],
  },
  'OMH-151': {
    family: 'provider-adapter',
    seam: 'bookCarrierShipment',
    sources: ['src/modules/carrier_shipping/lib/adapter.ts'],
    artifacts: ['src/modules/carrier_shipping/lib/adapter.ts'],
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
  'OMH-165': {
    family: 'test-authoring-mutation',
    seam: 'runPortalQuoteApprovalScenario',
    sources: ['tests/e2e/portal-quote-approval.spec.ts'],
    artifacts: ['tests/e2e/portal-quote-approval.spec.ts'],
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
    family: 'ui-business-surface',
    seam: 'reviewOrderRisk',
    handler: 'handleOrderRiskReview',
    sources: ['src/modules/order_risk/widgets/orders-table.tsx'],
    artifacts: ['src/modules/order_risk/widgets/orders-table.tsx'],
  },
})

export const WRITABLE_CASE_IDS = Object.freeze(Object.keys(WRITABLE_CASES))

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

function collectSourceFiles(root, relativeEntries) {
  const found = new Set()
  const visit = (absolute) => {
    if (!fs.existsSync(absolute)) return
    const stat = fs.statSync(absolute)
    if (stat.isFile()) {
      if (isTypeScriptSource(absolute)) found.add(fs.realpathSync(absolute))
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
  if (!pattern.endsWith('/**')) return fs.existsSync(path.join(root, pattern))
  const directory = path.join(root, pattern.slice(0, -3))
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return false
  const pending = [directory]
  while (pending.length) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isFile()) return true
      if (entry.isDirectory()) pending.push(path.join(current, entry.name))
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
    functions: new Set(),
    jsxAttributes: new Set(),
    jsxTags: new Set(),
    loops: 0,
    newCalls: new Set(),
    nullNodes: 0,
    objectProperties: new Set(),
    propertyAccesses: new Set(),
    strings: new Set(),
    throwStatements: 0,
    variables: new Map(),
    assignments: new Set(),
    awaitedCalls: new Set(),
  }
}

function isExportedFunction(ts, node) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
}

function collectFunctionFact(ts, node) {
  const fact = {
    binaryOperators: new Set(),
    calls: new Set(),
    callOptions: new Map(),
    conditionalExpressions: 0,
    finallyBlocks: 0,
    loops: 0,
    nullNodes: 0,
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
    if (ts.isTryStatement(current) && current.finallyBlock) fact.finallyBlocks += 1
    if (ts.isForStatement(current) || ts.isForInStatement(current) || ts.isForOfStatement(current) || ts.isWhileStatement(current) || ts.isDoStatement(current)) {
      fact.loops += 1
    }
    ts.forEachChild(current, visit)
  }
  if (node.body) visit(node.body)
  return fact
}

function addCall(facts, name, optionNames = []) {
  facts.calls.set(name, (facts.calls.get(name) ?? 0) + 1)
  if (!facts.callOptions.has(name)) facts.callOptions.set(name, [])
  facts.callOptions.get(name).push(new Set(optionNames))
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
      if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node)) return

      if (ts.isClassDeclaration(node)) {
        const members = new Set(node.members.map((member) => propertyName(ts, member.name)).filter(Boolean))
        const decorators = typeof ts.getDecorators === 'function' && ts.canHaveDecorators(node)
          ? (ts.getDecorators(node) ?? []).map((decorator) => expressionName(ts, decorator.expression.expression ?? decorator.expression)).filter(Boolean)
          : []
        facts.classes.push({ name: node.name?.text, members, decorators: new Set(decorators) })
        if (node.name) facts.declarations.add(node.name.text)
        for (const decorator of decorators) facts.decorators.add(decorator)
      }
      if (ts.isFunctionDeclaration(node) && node.name) {
        facts.functions.add(node.name.text)
        facts.declarations.add(node.name.text)
        if (isExportedFunction(ts, node)) facts.exportedFunctions.set(node.name.text, collectFunctionFact(ts, node))
      }
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
        facts.declarations.add(node.name.text)
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        facts.declarations.add(node.name.text)
        const properties = new Set()
        if (node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
          for (const property of node.initializer.properties) {
            const name = propertyName(ts, property.name)
            if (name) properties.add(name)
          }
        }
        facts.variables.set(node.name.text, properties)
      }
      if (ts.isCallExpression(node)) {
        const name = expressionName(ts, node.expression)
        const fullName = fullExpressionName(ts, node.expression)
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
      if (ts.isPropertyAccessExpression(node)) facts.propertyAccesses.add(node.name.text)
      if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) facts.strings.add(node.text)
      if (node.kind === ts.SyntaxKind.NullKeyword) facts.nullNodes += 1
      if (ts.isThrowStatement(node)) facts.throwStatements += 1
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
          if (ts.isJsxAttribute(attribute)) facts.jsxAttributes.add(attribute.name.text)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return facts
}

function hasCall(facts, ...names) {
  return names.some((name) => (facts.calls.get(name) ?? 0) > 0)
}

function hasCallOptions(facts, callName, required) {
  return (facts.callOptions.get(callName) ?? []).some((options) => required.every((name) => options.has(name)))
}

function hasObjectVariable(facts, variableName, required) {
  const properties = facts.variables.get(variableName)
  return Boolean(properties && required.every((name) => properties.has(name)))
}

function hasString(facts, value) {
  return [...facts.strings].some((entry) => entry === value || entry.startsWith(value))
}

function exportedFunctionCalls(facts, functionName, requiredCalls) {
  const fact = facts.exportedFunctions.get(functionName)
  return Boolean(fact && requiredCalls.every((name) => fact.calls.has(name)))
}

function exportedFunctionHasCallOptions(facts, functionName, callName, requiredOptions) {
  const fact = facts.exportedFunctions.get(functionName)
  return Boolean(fact && (fact.callOptions.get(callName) ?? []).some((options) => requiredOptions.every((name) => options.has(name))))
}

function check(id, passed, requirement) {
  return { id, passed: Boolean(passed), requirement }
}

function caseChecks(ts, caseId, facts) {
  const definition = WRITABLE_CASES[caseId]
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
      check('business.ui-handler', exportedFunctionCalls(facts, definition.handler, [definition.seam]), `exported ${definition.handler} invokes the tested production seam`),
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
    return [
      check('business.provider-seam', exportedFunctionCalls(facts, definition.seam, ['effects.findExisting', 'effects.request', 'effects.reconcile', 'effects.redact']), `exported ${definition.seam} uses idempotency, provider, reconciliation, and redaction seams`),
      check('business.provider-retry', (fact?.loops ?? 0) > 0 && (fact?.throws ?? 0) > 0, `exported ${definition.seam} bounds retries and redacts terminal failure`),
    ]
  }
  if (definition.family === 'data-flow') {
    const fact = facts.exportedFunctions.get(definition.seam)
    return [
      check('business.data-seam', exportedFunctionCalls(facts, definition.seam, ['effects.fetchPage', 'effects.sanitize', 'effects.apply', 'effects.commitCursor']), `exported ${definition.seam} uses fetch, sanitization, row mutation, and cursor seams`),
      check('business.data-loop', (fact?.loops ?? 0) > 0, `exported ${definition.seam} isolates rows in a loop`),
    ]
  }
  if (definition.family === 'test-authoring-mutation') {
    const fact = facts.exportedFunctions.get(definition.seam)
    return [
      check('business.test-seam', exportedFunctionCalls(facts, definition.seam, ['harness.createFixture', 'harness.open', 'harness.approve', 'harness.expectConflict', 'harness.verifyBackend', 'harness.cleanup']), `exported ${definition.seam} exercises fixture, UI, conflict, backend verification, and cleanup seams`),
      check('business.test-finally', (fact?.finallyBlocks ?? 0) > 0, `exported ${definition.seam} cleans up in finally`),
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
      return [check('crud.route', hasCallOptions(facts, 'makeCrudRoute', ['metadata', 'openApi', 'indexer']), 'makeCrudRoute called with metadata, openApi, and indexer options')]
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
        check('umes.form-spot', hasString(facts, 'crud-form:'), 'a concrete crud-form:* spot ID literal'),
        check('umes.enricher', hasCall(facts, 'enrichMany'), 'an enrichMany call'),
        check('umes.interceptor', hasObjectVariable(facts, 'interceptors', []) || facts.declarations.has('interceptors'), 'an interceptors declaration'),
      ]
    case 'OMH-027':
      return [
        check('umes.table-spot', hasString(facts, 'data-table:'), 'a concrete data-table:* spot ID literal'),
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
        check('workflow.activity', facts.functions.has('callApiActivity') && hasString(facts, 'CALL_API'), 'a callApiActivity declaration and CALL_API literal'),
        check('workflow.transaction', hasCall(facts, 'transaction', 'transactional'), 'a transaction/transactional call'),
        check('workflow.idempotency', (hasCall(facts, 'fetch', 'fetchImpl') && facts.objectProperties.has('headers') && hasString(facts, 'Idempotency-Key')), 'a fetch call with headers and an Idempotency-Key literal'),
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
  const result = spawnSync('yarn', ['typecheck'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: TYPECHECK_TIMEOUT_MS,
    windowsHide: true,
  })
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
  if (sourceFiles.length) checks.push(...caseChecks(ts, caseId, collectFacts(ts, sourceFiles)))
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
