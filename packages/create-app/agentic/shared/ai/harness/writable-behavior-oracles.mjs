#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const EXIT_PASS = 0
const EXIT_FAILURE = 1
const EXIT_INVALID = 2
const MAX_SOURCE_BYTES = 256 * 1024
const WORKER_TIMEOUT_MS = 3_000

const CASES = {
  'OMH-045': { file: 'src/modules/external_sync/lib/client.ts', allowCompiledImports: true },
  'OMH-054': { file: 'src/modules/automation/workflows/call-api.ts' },
  'OMH-057': { file: 'src/modules/harness_fixture/api/scope/route.ts' },
  'OMH-060': { file: 'src/modules/harness_fixture/commands/update-record.ts' },
  'OMH-061': {
    file: 'src/modules/harness_fixture/backend/edit/page.tsx',
    allowedCompiledImport: '@open-mercato/ui/backend/CrudForm',
  },
  'OMH-070': { file: 'src/modules/harness_fixture/workers/sync.ts' },
  'OMH-093': { file: 'src/modules/customer_merge/commands/merge-contacts.ts', family: 'business-command', exportName: 'mergeContacts', requiredFlags: ['scopeValid', 'survivorSelected'] },
  'OMH-105': { file: 'src/modules/deal_stages/commands/change-stage.ts', family: 'business-command', exportName: 'changeDealStage', requiredFlags: ['transitionAllowed', 'requiredFieldsPresent'], allowCompiledImports: true },
  'OMH-107': { file: 'src/modules/quote_approval/commands/request-discount.ts', family: 'business-command', exportName: 'requestQuoteDiscount', requiredFlags: ['approvalSatisfied', 'separationOfDuties'] },
  'OMH-115': { file: 'src/modules/deal_accessibility/lib/move-deal.ts', family: 'ui-business-surface', exportName: 'moveDealAccessibly', requiredFlags: ['accessGranted', 'keyboardEquivalent'] },
  'OMH-122': { file: 'src/modules/stock_reservations/commands/reserve-stock.ts', family: 'business-command', exportName: 'reserveStock', requiredFlags: ['stockAvailable', 'reservationKeyPresent'] },
  'OMH-128': { file: 'src/modules/bulk_pricing/commands/update-prices.ts', family: 'async-operation', exportName: 'updatePrices' },
  'OMH-130': { file: 'src/modules/demo_requests/lib/submit-demo-request.ts', family: 'ui-business-surface', exportName: 'submitDemoRequest', requiredFlags: ['scopeDerived', 'consentAccepted'] },
  'OMH-133': { file: 'src/modules/portal_quote_approval/commands/approve-quote.ts', family: 'business-command', exportName: 'approvePortalQuote', requiredFlags: ['portalScoped', 'latestVersion'] },
  'OMH-137': { file: 'src/modules/setup_wizard/lib/advance-setup.ts', family: 'ui-business-surface', exportName: 'advanceSetupWizard', requiredFlags: ['draftPersisted', 'transitionAllowed'] },
  'OMH-140': { file: 'src/modules/invoice_dunning/workflows/run-dunning.ts', family: 'async-operation', exportName: 'runInvoiceDunning' },
  'OMH-144': { file: 'src/modules/quote_assistant/ai-tools.ts', family: 'ai-safe-agent', exportName: 'saveQuoteDraftWithApproval', mode: 'mutation' },
  'OMH-146': { file: 'src/modules/sales_orchestrator/ai-agents.ts', family: 'ai-safe-agent', exportName: 'coordinateSalesQuestion', mode: 'delegate' },
  'OMH-149': { file: 'src/modules/smtp_email/lib/client.ts', family: 'provider-adapter', exportName: 'sendTransactionalEmail' },
  'OMH-150': { file: 'src/modules/card_payments/lib/client.ts', family: 'provider-adapter', exportName: 'createCardPayment' },
  'OMH-151': { file: 'src/modules/carrier_shipping/lib/client.ts', family: 'provider-adapter', exportName: 'bookCarrierShipment' },
  'OMH-153': { file: 'src/modules/erp_sync/data-sync.ts', family: 'data-flow', exportName: 'synchronizeErpPage' },
  'OMH-156': { file: 'src/modules/product_transfer/lib/flow.ts', family: 'data-flow', exportName: 'transferProductRows' },
  'OMH-171': { file: 'src/modules/harness_fixture/api/scope/route.ts', probeCase: 'OMH-057' },
  'OMH-172': { file: 'src/modules/harness_fixture/backend/edit/page.tsx', probeCase: 'OMH-061', allowedCompiledImport: '@open-mercato/ui/backend/CrudForm' },
  'OMH-181': { file: 'src/modules/order_risk/widgets/injection/order-risk-review/widget.ts', family: 'data-table-extension', exportName: 'reviewOrderRisk' },
  'OMH-192': { file: 'src/modules/library/commands/crm-loans.ts', family: 'crm-library-regression' },
}

const FAMILY_PROBES = {
  'business-command': new vm.Script(`
    'use strict';
    globalThis.__oracleResult = (async () => {
    const config = __oracleConfig
    const action = module.exports[config.exportName]
    if (typeof action !== 'function') throw new Error('required business command export is missing')
    const checks = []
    const validInput = { idempotencyKey: 'business-key', ...Object.fromEntries(config.requiredFlags.map((flag) => [flag, true])) }
    const invalidInput = { ...validInput, [config.requiredFlags[0]]: false, idempotencyKey: 'invalid-key' }
    const committed = []
    const durable = new Map()
    let active = null
    const effects = {
      async reserveIdempotency(key) { return durable.get(key) },
      async transaction(work) {
        const pending = []
        active = pending
        try {
          const result = await work()
          committed.push(...pending)
          for (const entry of pending.filter((item) => item.kind === 'record')) durable.set(entry.value.idempotencyKey, entry.value.result)
          return result
        } finally { active = null }
      },
      async apply(input) {
        if (input.failApply) throw new Error('injected mutation failure')
        const result = { applied: input.idempotencyKey }
        ;(active ?? committed).push({ kind: 'apply', value: input })
        return result
      },
      async record(value) { (active ?? committed).push({ kind: 'record', value }) },
    }

    let invalidRejected = false
    try { await action(invalidInput, effects) } catch { invalidRejected = true }
    checks.push({ id: 'rejects-invalid-business-invariant', passed: invalidRejected && committed.length === 0 })

    let failureRejected = false
    try { await action({ ...validInput, failApply: true }, effects) } catch { failureRejected = true }
    checks.push({ id: 'rolls-back-injected-mutation-failure', passed: failureRejected && committed.length === 0 && durable.size === 0 })

    let result
    let successError
    try { result = await action(validInput, effects) } catch (error) { successError = error }
    checks.push({ id: 'commits-mutation-and-lineage-together', passed: !successError && result?.applied === 'business-key' && committed.length === 2 && committed[0]?.kind === 'apply' && committed[1]?.kind === 'record' })
    checks.push({ id: 'records-idempotency-lineage', passed: durable.get('business-key')?.applied === 'business-key' })

    let duplicateError
    try { await action(validInput, effects) } catch (error) { duplicateError = error }
    checks.push({ id: 'deduplicates-retried-command', passed: !duplicateError && committed.length === 2 })
    return { checks }
    })();
  `),
  'ui-business-surface': new vm.Script(`
    'use strict';
    globalThis.__oracleResult = (async () => {
    const config = __oracleConfig
    const action = module.exports[config.exportName]
    if (typeof action !== 'function') throw new Error('required UI business export is missing')
    const checks = []
    const validInput = { focusTarget: 'row-1', ...Object.fromEntries(config.requiredFlags.map((flag) => [flag, true])) }
    const invalidInput = { ...validInput, [config.requiredFlags[0]]: false }
    const events = []
    const effects = {
      async execute(input) { events.push('execute'); return { message: 'updated', input } },
      async restoreFocus(target) { events.push('focus:' + target) },
      async announce(message) { events.push('announce:' + message) },
    }
    let invalidRejected = false
    try { await action(invalidInput, effects) } catch { invalidRejected = true }
    checks.push({ id: 'rejects-invalid-ui-business-action', passed: invalidRejected && events.length === 0 })
    let result
    let successError
    try { result = await action(validInput, effects) } catch (error) { successError = error }
    checks.push({ id: 'executes-authorized-ui-action-once', passed: !successError && result?.message === 'updated' && events.filter((entry) => entry === 'execute').length === 1 })
    checks.push({ id: 'restores-semantic-focus', passed: events.includes('focus:row-1') })
    checks.push({ id: 'announces-observable-result', passed: events.includes('announce:updated') })

    const failedEvents = []
    let failureObserved = false
    try {
      await action(validInput, {
        async execute() { failedEvents.push('execute'); throw new Error('injected UI failure') },
        async restoreFocus(target) { failedEvents.push('focus:' + target) },
        async announce(message) { failedEvents.push('announce:' + message) },
      })
    } catch { failureObserved = true }
    checks.push({ id: 'restores-focus-after-ui-failure', passed: failureObserved && failedEvents.includes('focus:row-1') })
    checks.push({ id: 'announces-ui-failure', passed: failedEvents.some((entry) => entry.startsWith('announce:')) })
    return { checks }
    })();
  `),
  'data-table-extension': new vm.Script(`
    'use strict';
    globalThis.__oracleResult = (async () => {
    const config = __oracleConfig
    const action = module.exports[config.exportName]
    if (typeof action !== 'function') throw new Error('required DataTable bulk action export is missing')
    const checks = []
    const rows = [{ id: 'one', updatedAt: 'v1' }, { id: 'two', updatedAt: 'v2' }]

    let deniedExecutions = 0
    let denied = false
    try {
      await action(rows, {
        async authorize() { return false },
        async checkVersion() { return true },
        async surfaceConflict() {},
        async execute() { deniedExecutions += 1 },
      })
    } catch { denied = true }
    checks.push({ id: 'denies-unauthorized-bulk-review', passed: denied && deniedExecutions === 0 })

    const conflicts = []
    let staleExecutions = 0
    let stale = false
    try {
      await action(rows, {
        async authorize() { return true },
        async checkVersion(row) { return row.id !== 'two' },
        async surfaceConflict(row) { conflicts.push(row.id) },
        async execute() { staleExecutions += 1 },
      })
    } catch { stale = true }
    checks.push({ id: 'checks-every-selected-version', passed: stale && conflicts.join(',') === 'two' && staleExecutions === 0 })

    const checked = []
    let executedRows = []
    const result = await action(rows, {
      async authorize(feature) { return feature === 'sales.orders.manage' },
      async checkVersion(row) { checked.push(row.id + ':' + row.updatedAt); return true },
      async surfaceConflict() {},
      async execute(selectedRows) { executedRows = selectedRows; return { ok: true, progressJobId: 'job-1' } },
    })
    checks.push({ id: 'executes-exact-selected-orders', passed: checked.join(',') === 'one:v1,two:v2' && executedRows === rows })
    checks.push({ id: 'returns-shared-progress-job', passed: result?.ok === true && result?.progressJobId === 'job-1' })
    return { checks }
    })();
  `),
  'async-operation': new vm.Script(`
    'use strict';
    globalThis.__oracleResult = (async () => {
    const config = __oracleConfig
    const action = module.exports[config.exportName]
    if (typeof action !== 'function') throw new Error('required async operation export is missing')
    const checks = []
    const items = [{ id: 'one' }, { id: 'paid-or-skipped', skip: true }, { id: 'three' }]
    const applied = []
    const progress = []
    const undo = []
    const effects = {
      async isCancelled() { return false },
      async shouldSkip(item) { return item.skip === true },
      async applyChunk(chunk) { applied.push(...chunk.map((item) => item.id)); return { ids: chunk.map((item) => item.id) } },
      async reportProgress(value) { progress.push(value) },
      async registerUndo(value) { undo.push(value) },
    }
    let successError
    try { await action(items, effects) } catch (error) { successError = error }
    checks.push({ id: 'skips-ineligible-or-paid-work', passed: !successError && applied.join(',') === 'one,three' })
    checks.push({ id: 'reports-monotonic-progress', passed: progress.length === 2 && progress[0]?.completed < progress[1]?.completed && progress[1]?.total === 3 })
    checks.push({ id: 'registers-compensating-undo', passed: undo.length === 2 && undo.every((entry) => Array.isArray(entry?.ids)) })

    const cancelledApplied = []
    let cancellationChecks = 0
    await action(items, {
      async isCancelled() { cancellationChecks += 1; return cancelledApplied.length >= 1 },
      async shouldSkip(item) { return item.skip === true },
      async applyChunk(chunk) { cancelledApplied.push(...chunk.map((item) => item.id)); return { ids: chunk.map((item) => item.id) } },
      async reportProgress() {},
      async registerUndo() {},
    })
    checks.push({ id: 'stops-at-cancellation-boundary', passed: cancellationChecks >= 2 && cancelledApplied.join(',') === 'one' })
    return { checks }
    })();
  `),
  'ai-safe-agent': new vm.Script(`
    'use strict';
    globalThis.__oracleResult = (async () => {
    const config = __oracleConfig
    const action = module.exports[config.exportName]
    if (typeof action !== 'function') throw new Error('required AI action export is missing')
    const checks = []
    if (config.mode === 'mutation') {
      const events = []
      let denied = false
      try { await action({ change: 'quote' }, { async authorize() { return false }, async prepareMutation() { events.push('prepare') }, async execute() { events.push('execute') } }) } catch { denied = true }
      checks.push({ id: 'denies-unauthorized-ai-mutation', passed: denied && events.length === 0 })
      const pending = await action({ change: 'quote' }, { async authorize() { return true }, async prepareMutation() { events.push('prepare'); return { approved: false } }, async execute() { events.push('execute') } })
      checks.push({ id: 'does-not-execute-pending-mutation', passed: pending?.status === 'pending' && !events.includes('execute') })
      let approvedError
      try { await action({ change: 'quote' }, { async authorize() { events.push('authorize'); return true }, async prepareMutation(input) { events.push('prepare-approved'); return { approved: true, input } }, async execute() { events.push('execute'); return { saved: true } } }) } catch (error) { approvedError = error }
      checks.push({ id: 'executes-only-after-approval', passed: !approvedError && events.slice(-3).join(',') === 'authorize,prepare-approved,execute' })
    } else {
      const delegated = []
      let denied = false
      try { await action({ question: 'stock' }, { async authorize() { return false }, async delegate(...args) { delegated.push(args) } }) } catch { denied = true }
      checks.push({ id: 'denies-unauthorized-delegation', passed: denied && delegated.length === 0 })
      await action({ question: 'stock', requestedMutation: true, allowedTools: ['catalog.read'] }, { async authorize() { return true }, async delegate(input, options) { delegated.push([input, options]); return { answer: 'ok' } } })
      checks.push({ id: 'caps-delegated-authority', passed: delegated.length === 1 && delegated[0][1]?.authority === 'read-only' })
      checks.push({ id: 'passes-explicit-tool-allowlist', passed: delegated[0][1]?.allowedTools?.join(',') === 'catalog.read' })
    }
    return { checks }
    })();
  `),
  'provider-adapter': new vm.Script(`
    'use strict';
    globalThis.__oracleResult = (async () => {
    const config = __oracleConfig
    const action = module.exports[config.exportName]
    if (typeof action !== 'function') throw new Error('required provider adapter export is missing')
    const checks = []
    let requests = 0
    const duplicate = await action({ idempotencyKey: 'existing', maxAttempts: 2 }, {
      async findExisting() { return { id: 'prior' } },
      async request() { requests += 1 },
      async reconcile(value) { return value },
      redact(value) { return value },
    })
    checks.push({ id: 'returns-existing-idempotent-result', passed: duplicate?.id === 'prior' && requests === 0 })

    let reconciled = 0
    let retryError
    let result
    try {
      result = await action({ idempotencyKey: 'new', maxAttempts: 2 }, {
        async findExisting() { return undefined },
        async request() { requests += 1; if (requests === 1) throw new Error('transient'); return { id: 'provider-id', secret: 'hidden' } },
        async reconcile(value) { reconciled += 1; return value },
        redact(value) { return { id: value.id } },
      })
    } catch (error) { retryError = error }
    checks.push({ id: 'retries-transient-provider-failure', passed: !retryError && requests === 2 })
    checks.push({ id: 'reconciles-and-redacts-result', passed: reconciled === 1 && result?.id === 'provider-id' && !Object.prototype.hasOwnProperty.call(result ?? {}, 'secret') })

    let terminalMessage = ''
    try {
      await action({ idempotencyKey: 'terminal', maxAttempts: 2 }, {
        async findExisting() { return undefined },
        async request() { throw new Error('secret-token-value') },
        async reconcile(value) { return value },
        redact(value) { return value },
      })
    } catch (error) { terminalMessage = String(error?.message ?? error) }
    checks.push({ id: 'redacts-terminal-provider-error', passed: terminalMessage.length > 0 && !terminalMessage.includes('secret-token-value') })
    return { checks }
    })();
  `),
  'data-flow': new vm.Script(`
    'use strict';
    globalThis.__oracleResult = (async () => {
    const config = __oracleConfig
    const action = module.exports[config.exportName]
    if (typeof action !== 'function') throw new Error('required data-flow export is missing')
    const checks = []
    const events = []
    const applied = []
    let result
    let flowError
    try {
      result = await action({ cursor: 'current' }, {
        async fetchPage() { events.push('fetch'); return { items: [{ id: 'one', value: '=1+1' }, { id: 'bad', value: 'bad' }, { id: 'two', value: 'ok' }], nextCursor: 'next' } },
        sanitize(row) { events.push('sanitize:' + row.id); return { ...row, value: String(row.value).startsWith('=') ? "'" + row.value : row.value } },
        async apply(row) { events.push('apply:' + row.id); if (row.id === 'bad') throw new Error('row rejected'); applied.push(row) },
        async commitCursor(cursor) { events.push('commit:' + cursor) },
      })
    } catch (error) { flowError = error }
    checks.push({ id: 'isolates-bad-row', passed: !flowError && result?.errors?.length === 1 && applied.map((row) => row.id).join(',') === 'one,two' })
    checks.push({ id: 'neutralizes-formula-content', passed: applied[0]?.value === "'=1+1" })
    checks.push({ id: 'commits-cursor-after-rows', passed: events.at(-1) === 'commit:next' })

    let failedCommit = false
    let fetchRejected = false
    try {
      await action({ cursor: 'stable' }, {
        async fetchPage() { throw new Error('page failed') },
        sanitize(row) { return row },
        async apply() {},
        async commitCursor() { failedCommit = true },
      })
    } catch { fetchRejected = true }
    checks.push({ id: 'preserves-cursor-on-page-failure', passed: fetchRejected && !failedCommit })
    return { checks }
    })();
  `),
  'crm-library-regression': new vm.Script(`
    'use strict';
    globalThis.__oracleResult = (async () => {
    const required = ['createBook', 'undoCreateBook', 'deleteBook', 'undoDeleteBook', 'checkoutBook', 'returnLoan', 'renewLoan', 'markLoanLost']
    const actions = Object.fromEntries(required.map((name) => [name, module.exports[name]]))
    if (required.some((name) => typeof actions[name] !== 'function')) throw new Error('required CRM library export is missing')

    const checks = []
    const trustedScope = { tenantId: 'tenant-a', organizationId: 'org-a' }
    const attackerScope = { tenantId: 'tenant-b', organizationId: 'org-b' }
    const books = new Map()
    const loans = new Map()
    const idempotency = new Map()
    const activeByBook = new Map()
    const scopeEvents = []
    const customerEvents = []
    let effectCalls = 0

    const assertScope = (scope) => {
      effectCalls += 1
      scopeEvents.push(scope?.tenantId + ':' + scope?.organizationId)
    }

    const effects = {
      async createBook(record, scope) {
        assertScope(scope)
        const stored = { ...record, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }
        books.set(stored.id, stored)
        return { ...stored }
      },
      async softDeleteBook(id, scope) {
        assertScope(scope)
        const book = books.get(id)
        if (!book) throw new Error('book not found')
        book.deletedAt = 'deleted'
        return { ...book }
      },
      async restoreBook(id, scope) {
        assertScope(scope)
        const book = books.get(id)
        if (!book) throw new Error('book not found')
        book.deletedAt = null
        return { ...book }
      },
      async resolveCustomer(id, scope) {
        assertScope(scope)
        customerEvents.push({ id, scope: { ...scope } })
        return { id, displayName: 'Scoped CRM customer' }
      },
      async findActiveLoan(bookId, scope) {
        assertScope(scope)
        await Promise.resolve()
        const loanId = activeByBook.get(bookId)
        return loanId ? { ...loans.get(loanId) } : undefined
      },
      async createLoan(input, scope) {
        assertScope(scope)
        await Promise.resolve()
        const loan = { ...input, id: 'loan-' + (loans.size + 1), status: 'active' }
        loans.set(loan.id, loan)
        activeByBook.set(loan.bookId, loan.id)
        return { ...loan }
      },
      async claimCheckout(input, scope) {
        assertScope(scope)
        if ('memberId' in input) throw new Error('duplicate local member leaked into checkout')
        const priorId = idempotency.get(input.idempotencyKey)
        if (priorId) return { status: 'existing', loan: { ...loans.get(priorId) } }
        if (activeByBook.has(input.bookId)) return { status: 'conflict' }
        const loan = { ...input, id: 'loan-' + (loans.size + 1), tenantId: scope.tenantId, organizationId: scope.organizationId, status: 'active' }
        loans.set(loan.id, loan)
        activeByBook.set(input.bookId, loan.id)
        idempotency.set(input.idempotencyKey, loan.id)
        return { status: 'created', loan: { ...loan } }
      },
      async findLoan(id, scope) {
        assertScope(scope)
        const loan = loans.get(id)
        return loan ? { ...loan } : undefined
      },
      async updateLoan(id, scope, patch) {
        assertScope(scope)
        const loan = loans.get(id)
        if (!loan) throw new Error('loan not found')
        Object.assign(loan, patch)
        return { ...loan }
      },
    }

    let missingScopeRejected = false
    const callsBeforeMissingScope = effectCalls
    try {
      await actions.checkoutBook({ bookId: 'missing-scope', customerEntityId: 'customer-a', idempotencyKey: 'missing-scope' }, {}, effects)
    } catch { missingScopeRejected = true }
    checks.push({ id: 'fails-closed-before-effects', passed: missingScopeRejected && effectCalls === callsBeforeMissingScope })

    await actions.createBook({ id: 'created-book', title: 'Created', ...attackerScope }, trustedScope, effects)
    await actions.undoCreateBook('created-book', trustedScope, effects)
    checks.push({ id: 'create-undo-soft-deletes', passed: books.get('created-book')?.deletedAt === 'deleted' })

    await actions.createBook({ id: 'restored-book', title: 'Restored', ...attackerScope }, trustedScope, effects)
    await actions.deleteBook('restored-book', trustedScope, effects)
    await actions.undoDeleteBook('restored-book', trustedScope, effects)
    checks.push({ id: 'delete-undo-restores', passed: books.get('restored-book')?.deletedAt === null })
    checks.push({ id: 'body-scope-cannot-override-trusted-scope', passed: [...books.values()].every((book) => book.tenantId === trustedScope.tenantId && book.organizationId === trustedScope.organizationId) })

    const checkoutInput = { bookId: 'shared-copy', customerEntityId: 'customer-a', ...attackerScope }
    const concurrent = await Promise.all([
      actions.checkoutBook({ ...checkoutInput, idempotencyKey: 'checkout-a' }, trustedScope, effects).catch(() => ({ status: 'conflict' })),
      actions.checkoutBook({ ...checkoutInput, idempotencyKey: 'checkout-b' }, trustedScope, effects).catch(() => ({ status: 'conflict' })),
    ])
    const statuses = concurrent.map((result) => result?.status).sort()
    checks.push({ id: 'concurrent-checkout-has-one-winner', passed: statuses.join(',') === 'conflict,created' && [...loans.values()].filter((loan) => loan.bookId === 'shared-copy' && loan.status === 'active').length === 1 })

    const winner = concurrent.find((result) => result?.status === 'created')
    const winnerKey = winner?.loan?.id === loans.get(idempotency.get('checkout-a'))?.id ? 'checkout-a' : 'checkout-b'
    const retry = await actions.checkoutBook({ ...checkoutInput, idempotencyKey: winnerKey }, trustedScope, effects)
    checks.push({ id: 'checkout-retry-is-deterministic', passed: retry?.status === 'existing' && retry?.loan?.id === winner?.loan?.id && loans.size === 1 })
    checks.push({ id: 'resolves-scoped-crm-customer-snapshot', passed: customerEvents.length >= 2 && customerEvents.every((event) => event.id === 'customer-a' && event.scope.tenantId === trustedScope.tenantId) && winner?.loan?.customerEntityId === 'customer-a' && winner?.loan?.customerNameSnapshot === 'Scoped CRM customer' && !('memberId' in (winner?.loan ?? {})) })

    for (const [id, action] of [['return-loan', actions.returnLoan], ['renew-loan', actions.renewLoan], ['lost-loan', actions.markLoanLost]]) {
      loans.set(id, { id, bookId: id, customerEntityId: 'customer-a', status: 'active' })
      await action({ id, ...attackerScope }, trustedScope, effects)
    }
    checks.push({ id: 'all-loan-actions-use-trusted-scope', passed: ['return-loan', 'renew-loan', 'lost-loan'].every((id) => loans.get(id)?.status !== 'active') && scopeEvents.every((entry) => entry === 'tenant-a:org-a') })
    return { checks }
    })();
  `),
}

const PROBES = {
  'OMH-045': new vm.Script(`
    'use strict';
    globalThis.__oracleResult = (async () => {
    const fetchPage = module.exports.fetchPage
    if (typeof fetchPage !== 'function') throw new Error('required export fetchPage is missing')
    const checks = []
    const state = { cursor: 'cursor-current' }
    const urls = []
    let attempt = 0
    let page
    let retryError
    const effects = {
      maxAttempts: 2,
      async fetch(url) {
        urls.push(url)
        attempt += 1
        if (attempt === 1) return { ok: false, status: 503, async json() { return {} } }
        return { ok: true, status: 200, async json() { return { items: ['record'], nextCursor: 'cursor-next' } } }
      },
    }
    try { page = await fetchPage('https://provider.test/records', state, effects) } catch (error) { retryError = error }
    checks.push({ id: 'retries-transient-response', passed: !retryError && attempt === 2 })
    checks.push({ id: 'retries-same-cursor', passed: urls.length === 2 && urls.every((url) => url.endsWith('cursor=cursor-current')) })
    checks.push({ id: 'commits-cursor-after-success', passed: state.cursor === 'cursor-next' && page?.nextCursor === 'cursor-next' })

    const failedState = { cursor: 'cursor-stable' }
    let failedAttempts = 0
    let terminalRejected = false
    try {
      await fetchPage('https://provider.test/records', failedState, {
        maxAttempts: 2,
        async fetch() {
          failedAttempts += 1
          return { ok: false, status: 503, async json() { return {} } }
        },
      })
    } catch { terminalRejected = true }
    checks.push({ id: 'bounds-retries', passed: terminalRejected && failedAttempts === 2 })
    checks.push({ id: 'preserves-cursor-after-terminal-failure', passed: failedState.cursor === 'cursor-stable' })

    let privateFetchCalls = 0
    let privateEndpointRejected = false
    try {
      await fetchPage('http://127.0.0.1/admin', { cursor: 'cursor-private' }, {
        maxAttempts: 2,
        async fetch() {
          privateFetchCalls += 1
          return { ok: true, status: 200, async json() { return { items: [] } } }
        },
      })
    } catch { privateEndpointRejected = true }
    checks.push({ id: 'rejects-private-endpoint-before-fetch', passed: privateEndpointRejected && privateFetchCalls === 0 })
    return { checks }
    })();
  `),
  'OMH-054': new vm.Script(`
    'use strict';
    globalThis.__oracleResult = (async () => {
    const callApiActivity = module.exports.callApiActivity
    if (typeof callApiActivity !== 'function') throw new Error('required export callApiActivity is missing')
    const checks = []
    const durable = new Set()
    const posts = []
    const events = []
    let transactionState = null
    const effects = {
      async reserveIdempotency(key) {
        events.push('reserve:' + key)
        if (transactionState) transactionState.add(key)
        else durable.add(key)
        return key
      },
      async transaction(work) {
        events.push('transaction:start')
        const staged = new Set()
        transactionState = staged
        try {
          const result = await work()
          for (const key of staged) durable.add(key)
          events.push('transaction:commit')
          return result
        } catch (error) {
          events.push('transaction:rollback')
          throw error
        } finally {
          transactionState = null
        }
      },
      async post(url, options) {
        posts.push({ url, key: options?.idempotencyKey })
        if (posts.length === 1) throw new Error('injected post failure')
        return { ok: true }
      },
    }
    const input = { url: 'https://provider.test/action', idempotencyKey: 'activity-key' }
    let firstRejected = false
    try { await callApiActivity(input, effects) } catch { firstRejected = true }
    checks.push({ id: 'injected-failure-rolls-back-transaction', passed: firstRejected && events.includes('transaction:rollback') })
    checks.push({ id: 'idempotency-survives-rollback', passed: durable.has('activity-key') })
    let retryError
    try { await callApiActivity(input, effects) } catch (error) { retryError = error }
    checks.push({ id: 'retry-reuses-idempotency-key', passed: !retryError && posts.length === 2 && posts.every((post) => post.key === 'activity-key') })
    checks.push({ id: 'reservation-precedes-transaction', passed: events[0] === 'reserve:activity-key' && events[1] === 'transaction:start' })
    return { checks }
    })();
  `),
  'OMH-057': new vm.Script(`
    'use strict';
    globalThis.__oracleResult = (async () => {
    const listRecords = module.exports.listRecords
    if (typeof listRecords !== 'function') throw new Error('required export listRecords is missing')
    const checks = []
    const calls = []
    const store = { async find(filter) { calls.push(filter); return ['record'] } }
    let missingTenantRejected = false
    try { await listRecords({ organizationId: 'organization-1' }, store) } catch { missingTenantRejected = true }
    let missingOrganizationRejected = false
    try { await listRecords({ tenantId: 'tenant-1' }, store) } catch { missingOrganizationRejected = true }
    checks.push({ id: 'rejects-missing-tenant', passed: missingTenantRejected })
    checks.push({ id: 'rejects-missing-organization', passed: missingOrganizationRejected })
    checks.push({ id: 'does-not-query-with-missing-scope', passed: calls.length === 0 })
    let validResult
    let validError
    try { validResult = await listRecords({ tenantId: 'tenant-1', organizationId: 'organization-1' }, store) } catch (error) { validError = error }
    const filter = calls[0]
    checks.push({
      id: 'queries-with-complete-scope',
      passed: !validError && Array.isArray(validResult) && calls.length === 1
        && filter?.tenant_id === 'tenant-1' && filter?.organization_id === 'organization-1',
    })
    return { checks }
    })();
  `),
  'OMH-060': new vm.Script(`
    'use strict';
    globalThis.__oracleResult = (async () => {
    const updateRecord = module.exports.updateRecord
    if (typeof updateRecord !== 'function') throw new Error('required export updateRecord is missing')
    const checks = []
    function makeStore() {
      const committed = []
      const store = {
        committed,
        async persist(value) { committed.push({ ...value }) },
        async flush() {},
        async transaction(work) {
          const pending = []
          const transactionalStore = {
            async persist(value) { pending.push({ ...value }) },
            async flush() {},
          }
          const result = await work(transactionalStore)
          committed.push(...pending)
          return result
        },
      }
      return store
    }
    const failedStore = makeStore()
    let injectedFailureObserved = false
    try { await updateRecord(failedStore, true) } catch { injectedFailureObserved = true }
    checks.push({ id: 'propagates-injected-failure', passed: injectedFailureObserved })
    checks.push({ id: 'rolls-back-all-phases', passed: failedStore.committed.length === 0 })
    const successStore = makeStore()
    let successError
    try { await updateRecord(successStore, false) } catch (error) { successError = error }
    checks.push({
      id: 'commits-complete-write-on-success',
      passed: !successError && successStore.committed.length === 2
        && successStore.committed[0]?.phase === 1 && successStore.committed[1]?.phase === 2,
    })
    return { checks }
    })();
  `),
  'OMH-061': new vm.Script(`
    'use strict';
    globalThis.__oracleResult = (async () => {
    const toInitialValues = module.exports.toInitialValues
    const toUpdatePayload = module.exports.toUpdatePayload
    if (typeof toInitialValues !== 'function' || typeof toUpdatePayload !== 'function') {
      throw new Error('required nullable round-trip exports are missing')
    }
    const checks = []
    const initialNull = toInitialValues({ note: null })
    checks.push({ id: 'loads-explicit-null', passed: initialNull?.note === null })
    const cleared = toUpdatePayload({ note: '' })
    checks.push({ id: 'serializes-clear-as-null', passed: Object.prototype.hasOwnProperty.call(cleared ?? {}, 'note') && cleared.note === null })
    const reloaded = toInitialValues(cleared)
    checks.push({ id: 'reload-preserves-null', passed: reloaded?.note === null })
    const text = 'kept value'
    const nonNull = toUpdatePayload(toInitialValues({ note: text }))
    checks.push({ id: 'round-trips-non-null-value', passed: nonNull?.note === text })
    return { checks }
    })();
  `),
  'OMH-070': new vm.Script(`
    'use strict';
    globalThis.__oracleResult = (async () => {
    const syncPage = module.exports.syncPage
    if (typeof syncPage !== 'function') throw new Error('required export syncPage is missing')
    const checks = []
    const state = { cursor: 'cursor-current' }
    const received = []
    let attempt = 0
    let page
    let retryError
    const provider = {
      maxAttempts: 2,
      nextCursor: 'cursor-next',
      async fetchPage(cursor) {
        received.push(cursor)
        attempt += 1
        if (attempt === 1) throw new Error('transient provider failure')
        return { items: ['record'], nextCursor: 'cursor-next' }
      },
    }
    try { page = await syncPage(state, provider) } catch (error) { retryError = error }
    checks.push({ id: 'retries-transient-page', passed: !retryError && attempt === 2 })
    checks.push({ id: 'retries-current-cursor', passed: received.length === 2 && received.every((cursor) => cursor === 'cursor-current') })
    checks.push({ id: 'advances-after-success', passed: state.cursor === 'cursor-next' && page?.nextCursor === 'cursor-next' })

    const failedState = { cursor: 'cursor-stable' }
    let failedAttempts = 0
    let terminalRejected = false
    try {
      await syncPage(failedState, {
        maxAttempts: 2,
        nextCursor: 'cursor-never',
        async fetchPage(cursor) {
          if (cursor !== 'cursor-stable') throw new Error('cursor advanced before success')
          failedAttempts += 1
          throw new Error('transient provider failure')
        },
      })
    } catch { terminalRejected = true }
    checks.push({ id: 'bounds-page-retries', passed: terminalRejected && failedAttempts === 2 })
    checks.push({ id: 'preserves-cursor-after-terminal-failure', passed: failedState.cursor === 'cursor-stable' })
    return { checks }
    })();
  `),
}

const ORACLE_CONFIG_SCRIPT = new vm.Script(`
  'use strict';
  globalThis.__oracleConfig = Object.freeze({
    exportName: globalThis.__oracleExportName,
    mode: globalThis.__oracleMode,
    requiredFlags: Object.freeze(JSON.parse(globalThis.__oracleRequiredFlagsJson)),
  });
`)

function usage() {
  return `Usage: node .ai/harness/writable-behavior-oracles.mjs --root <absolute-app-path> --case <OMH-NNN> --phase <before|after> [--json]`
}

function parseArgs(argv) {
  const options = { root: undefined, caseId: undefined, phase: undefined, json: false, internalCase: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const takeValue = () => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      index += 1
      return value
    }
    if (arg === '--root') options.root = takeValue()
    else if (arg === '--case') options.caseId = takeValue()
    else if (arg === '--phase') options.phase = takeValue()
    else if (arg === '--json') options.json = true
    else if (arg === '--internal-case') options.internalCase = takeValue()
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function safeMessage(error, root) {
  let message = String(error?.message ?? error ?? 'unknown error')
  for (const sensitive of [root, process.env.HOME, os.homedir()].filter(Boolean).sort((a, b) => b.length - a.length)) {
    message = message.split(sensitive).join('<redacted-path>')
  }
  return message
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_A-Za-z0-9]{8,}\b/g, '<redacted-token>')
    .slice(0, 500)
}

function readTargetSource(root, caseRecord) {
  const candidate = path.resolve(root, caseRecord.file)
  if (!isPathInside(root, candidate)) throw new Error('oracle target escapes the app root')
  const realRoot = fs.realpathSync(root)
  const realCandidate = fs.realpathSync(candidate)
  if (!isPathInside(realRoot, realCandidate)) throw new Error('oracle target resolves outside the app root')
  const stat = fs.statSync(realCandidate)
  if (!stat.isFile()) throw new Error(`oracle target is not a file: ${caseRecord.file}`)
  if (stat.size > MAX_SOURCE_BYTES) throw new Error(`oracle target exceeds ${MAX_SOURCE_BYTES} bytes`)
  return fs.readFileSync(realCandidate, 'utf8')
}

function loadTargetTypeScript(root) {
  const targetRequire = createRequire(path.join(root, 'package.json'))
  let resolved
  try { resolved = targetRequire.resolve('typescript') } catch { throw new Error('target app TypeScript compiler is unavailable') }
  return targetRequire(resolved)
}

function transpileTarget(root, caseRecord, source) {
  const ts = loadTargetTypeScript(root)
  const result = ts.transpileModule(source, {
    fileName: caseRecord.file,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  })
  const diagnostics = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
  if (diagnostics.length) {
    const codes = diagnostics.slice(0, 8).map((diagnostic) => `TS${diagnostic.code}`).join(', ')
    throw new Error(`target TypeScript compilation failed (${codes})`)
  }
  let output = result.outputText
  let importStub = ''
  if (caseRecord.allowCompiledImports) {
    importStub = `
const __harnessImportStub = new Proxy(function (...args) {
  const callback = args.find((argument) => typeof argument === 'function')
  return callback ? callback() : __harnessImportStub
}, {
  get(_target, property) { return property === 'then' ? undefined : __harnessImportStub },
  construct() { return __harnessImportStub },
})
`
    output = output.replace(/\brequire\((['"])[^'"]+\1\)/g, '__harnessImportStub')
  } else if (caseRecord.allowedCompiledImport) {
    const escaped = caseRecord.allowedCompiledImport.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const importExpression = new RegExp(`require\\(["']${escaped}["']\\)`, 'g')
    output = output.replace(importExpression, '({ CrudForm: function CrudForm() {} })')
  }
  if (/\brequire\s*\(/.test(output)) throw new Error('behavior-oracle target must not execute imports')
  return `${importStub}${output}`
}

function executeWorker(caseId, compiledSource) {
  const child = spawnSync(process.execPath, [
    '--permission', path.resolve(process.argv[1]), '--internal-case', caseId,
  ], {
    input: compiledSource,
    encoding: 'utf8',
    timeout: WORKER_TIMEOUT_MS,
    maxBuffer: 512 * 1024,
    env: { NO_COLOR: '1' },
  })
  if (child.error?.code === 'ETIMEDOUT' || child.signal) throw new Error('behavior probe timed out')
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(child.stderr.trim() || 'behavior probe worker failed')
  let parsed
  try { parsed = JSON.parse(child.stdout) } catch { throw new Error('behavior probe worker returned invalid JSON') }
  if (!Array.isArray(parsed?.checks) || parsed.checks.some((check) => typeof check?.id !== 'string' || typeof check?.passed !== 'boolean')) {
    throw new Error('behavior probe worker returned an invalid result')
  }
  return parsed
}

async function internalRun(caseId) {
  const caseRecord = CASES[caseId]
  const probeScript = PROBES[caseRecord?.probeCase ?? caseId] ?? FAMILY_PROBES[caseRecord?.family]
  if (!probeScript) throw new Error(`unsupported behavior-oracle case: ${caseId}`)
  const chunks = []
  let size = 0
  for await (const chunk of process.stdin) {
    size += chunk.length
    if (size > MAX_SOURCE_BYTES * 4) throw new Error('compiled target exceeds worker input limit')
    chunks.push(chunk)
  }
  const compiledSource = Buffer.concat(chunks).toString('utf8')
  const context = vm.createContext(Object.create(null), {
    name: `writable-behavior-oracle-${caseId}`,
    codeGeneration: { strings: false, wasm: false },
  })
  new vm.Script(`
    'use strict';
    class OracleURLSearchParams {
      #entries = []
      constructor(query = '') {
        for (const pair of String(query).replace(/^\\?/, '').split('&')) {
          if (!pair) continue
          const separator = pair.indexOf('=')
          const key = separator < 0 ? pair : pair.slice(0, separator)
          const value = separator < 0 ? '' : pair.slice(separator + 1)
          this.#entries.push([decodeURIComponent(key), decodeURIComponent(value)])
        }
      }
      get(key) { return this.#entries.find(([name]) => name === String(key))?.[1] ?? null }
      set(key, value) {
        const name = String(key)
        this.#entries = this.#entries.filter(([candidate]) => candidate !== name)
        this.#entries.push([name, String(value)])
      }
      toString() { return this.#entries.map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&') }
    }
    class OracleURL {
      constructor(input) {
        const match = /^(https?):\\/\\/([^/?#]+)([^?#]*)(?:\\?([^#]*))?(?:#(.*))?$/.exec(String(input))
        if (!match) throw new TypeError('invalid absolute URL')
        this.protocol = match[1] + ':'
        const authority = match[2]
        const portIndex = authority.lastIndexOf(':')
        this.hostname = portIndex > -1 ? authority.slice(0, portIndex) : authority
        this.port = portIndex > -1 ? authority.slice(portIndex + 1) : ''
        this.pathname = match[3] || '/'
        this.hash = match[5] ? '#' + match[5] : ''
        this.searchParams = new OracleURLSearchParams(match[4] || '')
      }
      toString() {
        const query = this.searchParams.toString()
        return this.protocol + '//' + this.hostname + (this.port ? ':' + this.port : '') + this.pathname + (query ? '?' + query : '') + this.hash
      }
      get href() { return this.toString() }
    }
    globalThis.URL = OracleURL
    globalThis.URLSearchParams = OracleURLSearchParams
    globalThis.module = { exports: Object.create(null) }
    globalThis.exports = globalThis.module.exports
  `).runInContext(context, { timeout: 250 })
  new vm.Script(`'use strict';\n${compiledSource}`, { filename: caseRecord.file }).runInContext(context, { timeout: 1_000 })
  Object.defineProperties(context, {
    __oracleExportName: { value: caseRecord.exportName ?? null },
    __oracleMode: { value: caseRecord.mode ?? null },
    __oracleRequiredFlagsJson: { value: JSON.stringify(caseRecord.requiredFlags ?? []) },
  })
  ORACLE_CONFIG_SCRIPT.runInContext(context, { timeout: 250 })
  probeScript.runInContext(context, { timeout: 1_000 })
  const serialized = await new vm.Script(`(async () => JSON.stringify(await globalThis.__oracleResult))()`).runInContext(context, { timeout: 1_000 })
  process.stdout.write(`${serialized}\n`)
}

function emit(result, json) {
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`)
  else {
    const marker = result.passed ? 'PASS' : 'FAIL'
    process.stdout.write(`${marker}: ${result.failures.join('; ') || 'all behavior checks passed'}\n`)
  }
}

async function main() {
  let options
  try { options = parseArgs(process.argv.slice(2)) } catch (error) {
    console.error(error.message)
    console.error(usage())
    return EXIT_INVALID
  }
  if (options.internalCase) {
    try { await internalRun(options.internalCase); return EXIT_PASS } catch (error) {
      console.error(safeMessage(error))
      return EXIT_INVALID
    }
  }
  if (options.help) { console.log(usage()); return EXIT_PASS }
  const root = options.root ? path.resolve(options.root) : undefined
  try {
    if (!options.root || !path.isAbsolute(options.root)) throw new Error('--root must be an absolute path')
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('--root must identify an existing directory')
    if (!CASES[options.caseId]) throw new Error(`--case must be one of: ${Object.keys(CASES).join(', ')}`)
    if (!['before', 'after'].includes(options.phase)) throw new Error('--phase must be before or after')
    const caseRecord = CASES[options.caseId]
    const source = readTargetSource(root, caseRecord)
    const compiled = transpileTarget(root, caseRecord, source)
    const probe = executeWorker(options.caseId, compiled)
    const failures = probe.checks.filter((check) => !check.passed).map((check) => `${check.id}: behavior requirement was not met`)
    const result = { passed: failures.length === 0, failures, checks: probe.checks }
    emit(result, options.json)
    return result.passed ? EXIT_PASS : EXIT_FAILURE
  } catch (error) {
    emit({ passed: false, failures: [safeMessage(error, root)], checks: [] }, options.json)
    return EXIT_INVALID
  }
}

process.exitCode = await main()
