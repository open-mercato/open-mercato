import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const targetSandboxAvailable = process.platform === 'darwin'
  || (process.platform === 'linux' && spawnSync('bwrap', ['--version'], { encoding: 'utf8' }).status === 0)

const require = createRequire(import.meta.url)
const astOracle = fileURLToPath(new URL('../../agentic/shared/ai/harness/writable-ast-oracles.mjs', import.meta.url))
const behaviorOracle = fileURLToPath(new URL('../../agentic/shared/ai/harness/writable-behavior-oracles.mjs', import.meta.url))
const casesPath = fileURLToPath(new URL('../../agentic/shared/ai/harness/cases.json', import.meta.url))
const fixtureIndexPath = fileURLToPath(new URL('../../agentic/shared/ai/harness/fixtures/index.json', import.meta.url))
const seedsPath = fileURLToPath(new URL('../../agentic/shared/ai/harness/fixtures/seeds.json', import.meta.url))
const typescriptRoot = path.dirname(require.resolve('typescript-standalone/package.json'))

type Family =
  | 'business-command'
  | 'ui-business-surface'
  | 'async-operation'
  | 'ai-safe-agent'
  | 'provider-adapter'
  | 'data-flow'
  | 'data-table-extension'
  | 'test-authoring-mutation'
  | 'regression'

type CaseDefinition = {
  fixture: string
  file: string
  family: Family
  validator: string
  seam?: string
  handler?: string
  requiredFlags?: string[]
  mode?: 'mutation' | 'delegate'
}

type OracleResult = {
  passed: boolean
  failures: string[]
  checks: Array<{ id: string; passed: boolean }>
}

const cases: Record<string, CaseDefinition> = {
  'OMH-093': { fixture: 'business-contact-merge', file: 'src/modules/customer_merge/commands/merge-contacts.ts', family: 'business-command', validator: 'oracle.business.command', seam: 'mergeContacts', requiredFlags: ['scopeValid', 'survivorSelected'] },
  'OMH-105': { fixture: 'business-deal-stage-transition', file: 'src/modules/deal_stages/commands/change-stage.ts', family: 'business-command', validator: 'oracle.business.command', seam: 'changeDealStage', requiredFlags: ['transitionAllowed', 'requiredFieldsPresent'] },
  'OMH-107': { fixture: 'business-quote-discount-approval', file: 'src/modules/quote_approval/commands/request-discount.ts', family: 'business-command', validator: 'oracle.business.command', seam: 'requestQuoteDiscount', requiredFlags: ['approvalSatisfied', 'separationOfDuties'] },
  'OMH-115': { fixture: 'ui-deal-board-accessibility', file: 'src/modules/deal_accessibility/lib/move-deal.ts', family: 'ui-business-surface', validator: 'oracle.business.ui-surface', seam: 'moveDealAccessibly', handler: 'handleDealBoardAction', requiredFlags: ['accessGranted', 'keyboardEquivalent'] },
  'OMH-122': { fixture: 'business-stock-reservation', file: 'src/modules/stock_reservations/commands/reserve-stock.ts', family: 'business-command', validator: 'oracle.business.command', seam: 'reserveStock', requiredFlags: ['stockAvailable', 'reservationKeyPresent'] },
  'OMH-128': { fixture: 'async-bulk-price-update', file: 'src/modules/bulk_pricing/commands/update-prices.ts', family: 'async-operation', validator: 'oracle.business.async-operation', seam: 'updatePrices' },
  'OMH-130': { fixture: 'ui-public-lead-capture', file: 'src/modules/demo_requests/lib/submit-demo-request.ts', family: 'ui-business-surface', validator: 'oracle.business.ui-surface', seam: 'submitDemoRequest', handler: 'handleDemoRequest', requiredFlags: ['scopeDerived', 'consentAccepted'] },
  'OMH-133': { fixture: 'business-portal-quote-approval', file: 'src/modules/portal_quote_approval/commands/approve-quote.ts', family: 'business-command', validator: 'oracle.business.command', seam: 'approvePortalQuote', requiredFlags: ['portalScoped', 'latestVersion'] },
  'OMH-137': { fixture: 'ui-resumable-setup-wizard', file: 'src/modules/setup_wizard/lib/advance-setup.ts', family: 'ui-business-surface', validator: 'oracle.business.ui-surface', seam: 'advanceSetupWizard', handler: 'handleSetupWizardAction', requiredFlags: ['draftPersisted', 'transitionAllowed'] },
  'OMH-140': { fixture: 'workflow-invoice-dunning', file: 'src/modules/invoice_dunning/workflows/run-dunning.ts', family: 'async-operation', validator: 'oracle.business.async-operation', seam: 'runInvoiceDunning' },
  'OMH-144': { fixture: 'ai-quote-mutation', file: 'src/modules/quote_assistant/ai-tools.ts', family: 'ai-safe-agent', validator: 'oracle.business.ai-safe-agent', seam: 'saveQuoteDraftWithApproval', mode: 'mutation' },
  'OMH-146': { fixture: 'ai-sales-orchestrator', file: 'src/modules/sales_orchestrator/ai-agents.ts', family: 'ai-safe-agent', validator: 'oracle.business.ai-safe-agent', seam: 'coordinateSalesQuestion', mode: 'delegate' },
  'OMH-149': { fixture: 'integration-smtp-email', file: 'src/modules/smtp_email/lib/client.ts', family: 'provider-adapter', validator: 'oracle.business.provider-adapter', seam: 'sendTransactionalEmail' },
  'OMH-150': { fixture: 'integration-payment-idempotency', file: 'src/modules/card_payments/lib/client.ts', family: 'provider-adapter', validator: 'oracle.business.provider-adapter', seam: 'createCardPayment' },
  'OMH-151': { fixture: 'integration-carrier-booking', file: 'src/modules/carrier_shipping/lib/client.ts', family: 'provider-adapter', validator: 'oracle.business.provider-adapter', seam: 'bookCarrierShipment' },
  'OMH-153': { fixture: 'integration-erp-sync', file: 'src/modules/erp_sync/data-sync.ts', family: 'data-flow', validator: 'oracle.business.data-flow', seam: 'synchronizeErpPage' },
  'OMH-156': { fixture: 'data-product-import-export', file: 'src/modules/product_transfer/lib/flow.ts', family: 'data-flow', validator: 'oracle.business.data-flow', seam: 'transferProductRows' },
  'OMH-163': { fixture: 'testing-quote-approval-unit', file: 'src/modules/quote_approval/commands/__tests__/approve-quote.test.ts', family: 'test-authoring-mutation', validator: 'oracle.business.test-authoring' },
  'OMH-164': { fixture: 'testing-customer-api', file: 'src/modules/customer_api/__integration__/TC-API-CUSTOMERS-001.spec.ts', family: 'test-authoring-mutation', validator: 'oracle.business.test-authoring' },
  'OMH-165': { fixture: 'testing-portal-quote-approval', file: 'src/modules/portal_quote_approval/__integration__/TC-PORTAL-QUOTE-001.spec.ts', family: 'test-authoring-mutation', validator: 'oracle.business.test-authoring' },
  'OMH-171': { fixture: 'regression-missing-scope', file: 'src/modules/harness_fixture/api/scope/route.ts', family: 'regression', validator: 'oracle.regression.fail-closed' },
  'OMH-172': { fixture: 'regression-null-roundtrip', file: 'src/modules/harness_fixture/backend/edit/page.tsx', family: 'regression', validator: 'oracle.regression.null-roundtrip' },
  'OMH-181': { fixture: 'ui-order-risk-bulk-review', file: 'src/modules/order_risk/widgets/injection/order-risk-review/widget.ts', family: 'data-table-extension', validator: 'oracle.business.ui-surface', seam: 'reviewOrderRisk' },
}

const fixtureIndex = JSON.parse(fs.readFileSync(fixtureIndexPath, 'utf8')) as {
  fixtures: Record<string, { seededArtifacts: string[]; precondition: string }>
}
const catalogCases = JSON.parse(fs.readFileSync(casesPath, 'utf8')) as Array<{
  id: string
  oracle?: { expectedArtifacts: string[] }
  allowedWrites?: string[]
}>
const seeds = JSON.parse(fs.readFileSync(seedsPath, 'utf8')) as {
  fixtures: Record<string, Record<string, string>>
}

function correctedSource(caseId: string, definition: CaseDefinition): string {
  const flags = JSON.stringify(definition.requiredFlags ?? [])
  if (definition.family === 'business-command') {
    return `
export async function ${definition.seam}(input: any, effects: any) {
  for (const flag of ${flags}) if (!input[flag]) throw new Error('business invariant failed')
  const existing = await effects.reserveIdempotency(input.idempotencyKey)
  if (existing) return existing
  return effects.transaction(async () => {
    const result = await effects.apply(input)
    await effects.record({ idempotencyKey: input.idempotencyKey, result })
    return result
  })
}
`
  }
  if (definition.family === 'ui-business-surface') {
    return `
export async function ${definition.seam}(input: any, effects: any) {
  for (const flag of ${flags}) if (!input[flag]) throw new Error('UI business invariant failed')
  try {
    const result = await effects.execute(input)
    await effects.announce(result.message)
    return result
  } catch (error) {
    await effects.announce('error')
    throw error
  } finally {
    await effects.restoreFocus(input.focusTarget)
  }
}
`
  }
  if (definition.family === 'data-table-extension') {
    return `
export async function reviewOrderRisk(rows: any[], effects: any) {
  if (!await effects.authorize('sales.orders.manage')) throw new Error('not authorized')
  for (const row of rows) {
    if (!await effects.checkVersion(row)) {
      await effects.surfaceConflict(row)
      throw new Error('stale order')
    }
  }
  return effects.execute(rows)
}

export const orderRiskReviewWidget = {
  metadata: { id: 'order_risk.injection.order-risk-review' },
  bulkActions: [{
    id: 'review-order-risk',
    label: 'order_risk.actions.review.label',
    requiresSelection: true,
    onExecute: reviewOrderRisk,
  }],
}
`
  }
  if (definition.family === 'async-operation') {
    return `
export async function ${definition.seam}(items: any[], effects: any) {
  let completed = 0
  for (const item of items) {
    if (await effects.isCancelled()) break
    if (await effects.shouldSkip(item)) {
      completed += 1
      continue
    }
    const undo = await effects.applyChunk([item])
    await effects.registerUndo(undo)
    completed += 1
    await effects.reportProgress({ completed, total: items.length })
  }
}
`
  }
  if (definition.family === 'ai-safe-agent' && definition.mode === 'mutation') {
    return `
export async function ${definition.seam}(input: any, effects: any) {
  if (!await effects.authorize(input)) throw new Error('not authorized')
  const prepared = await effects.prepareMutation(input)
  if (!prepared.approved) return { status: 'pending' }
  return effects.execute(prepared.input)
}
`
  }
  if (definition.family === 'ai-safe-agent') {
    return `
export async function ${definition.seam}(input: any, effects: any) {
  if (!await effects.authorize(input)) throw new Error('not authorized')
  return effects.delegate(input, { authority: 'read-only', allowedTools: input.allowedTools })
}
`
  }
  if (definition.family === 'provider-adapter') {
    return `
export async function ${definition.seam}(input: any, effects: any) {
  const existing = await effects.findExisting(input.idempotencyKey)
  if (existing) return existing
  for (let attempt = 0; attempt < input.maxAttempts; attempt += 1) {
    try {
      const response = await effects.request(input)
      const reconciled = await effects.reconcile(response)
      return effects.redact(reconciled)
    } catch {
      if (attempt + 1 === input.maxAttempts) throw new Error('provider request failed')
    }
  }
  throw new Error('provider request failed')
}
`
  }
  if (definition.family === 'data-flow') {
    return `
export async function ${definition.seam}(input: any, effects: any) {
  const page = await effects.fetchPage(input.cursor)
  const errors: unknown[] = []
  for (const row of page.items) {
    const sanitized = effects.sanitize(row)
    try { await effects.apply(sanitized) } catch (error) { errors.push(error) }
  }
  await effects.commitCursor(page.nextCursor)
  return { errors }
}
`
  }
  if (definition.family === 'test-authoring-mutation') {
    if (caseId === 'OMH-163') return `
test('rejects an already approved quote', async () => { await expect(Promise.reject(new Error('already approved'))).rejects.toThrow('already approved') })
test('rejects the requester', async () => { await expect(Promise.reject(new Error('requester'))).rejects.toThrow('requester') })
test('rolls back after an injected failure', async () => {
  const persist = jest.fn()
  await expect(Promise.reject(new Error('injected failure'))).rejects.toThrow('injected failure')
  expect(persist).toHaveBeenCalledTimes(0)
})
`
    if (caseId === 'OMH-164') return `
import { createServer } from 'node:http'
import { expect, test } from '@playwright/test'
test('creates scopes conflicts and deletes a customer', async ({ request }) => {
  const server = createServer((_req, res) => res.end())
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const headers = { 'x-organization-id': 'org-1', 'if-match': '1' }
    expect((await request.post('http://127.0.0.1:1/customers', { headers })).status()).toBe(201)
    expect((await request.patch('http://127.0.0.1:1/customers/1', { headers })).status()).toBe(409)
    expect((await request.patch('http://127.0.0.1:1/customers/1', { headers: { ...headers, 'x-organization-id': 'other' } })).status()).toBe(403)
    expect((await request.delete('http://127.0.0.1:1/customers/1', { headers })).status()).toBe(204)
  } finally { server.close() }
})
`
    if (caseId === 'OMH-165') return `
import { createServer } from 'node:http'
import { expect, test } from '@playwright/test'
test('uses the portal and verifies protected quote state', async ({ page, request }) => {
  const server = createServer((_req, res) => res.end())
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const forbiddenPath = '/portal/orders/forbidden'
    const backendPath = '/api/backend/quotes/quote-1'
    await page.goto('http://127.0.0.1:1/portal/orders/1')
    await page.getByRole('button', { name: 'Approve quote' }).click()
    await expect(page.getByRole('status')).toHaveText('Approved')
    expect((await request.get('http://127.0.0.1:1' + forbiddenPath)).status()).toBe(403)
    expect((await request.get('http://127.0.0.1:1' + backendPath)).status()).toBe(200)
  } finally { server.close() }
})
`
    return `
export async function ${definition.seam}(harness: any) {
  let fixture: any
  try {
    fixture = await harness.createFixture()
    await harness.open(fixture)
    await harness.approve(fixture)
    await harness.expectConflict(fixture)
    await harness.verifyBackend(fixture)
  } finally {
    if (fixture) await harness.cleanup(fixture)
  }
}
`
  }
  if (caseId === 'OMH-171') {
    return `
export async function listRecords(scope: any, store: any) {
  if (!scope.tenantId || !scope.organizationId) throw new Error('complete scope is required')
  return store.find({ tenant_id: scope.tenantId, organization_id: scope.organizationId })
}
`
  }
  return `
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'

export function toInitialValues(record: { note: string | null }) { return { note: record.note } }
export function toUpdatePayload(values: { note: string | null }) { return { note: values.note === '' ? null : values.note } }
export function EditFixture({ record }: { record: { note: string | null } }) {
  return <CrudForm initialValues={toInitialValues(record)} fields={[]} onSubmit={async (values: { note: string | null }) => toUpdatePayload(values)} />
}
`
}

function correctedArtifacts(caseId: string, definition: CaseDefinition): Record<string, string> {
  const artifacts = { [definition.file]: correctedSource(caseId, definition) }
  if (caseId === 'OMH-115') {
    return {
      ...artifacts,
      'src/modules/deal_accessibility/backend/board/page.tsx': `
'use client'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { moveDealAccessibly } from '../../lib/move-deal'

export async function handleDealBoardAction(input: any, effects: any) {
  return moveDealAccessibly(input, effects)
}

export default function DealBoardPage() {
  const t = useT()
  const effects = {} as any
  return (
    <Page>
      <PageHeader title={t('deal_accessibility.board.title')} />
      <PageBody className="grid gap-4 text-muted-foreground md:grid-cols-2">
        <Button
          type="button"
          aria-label={t('deal_accessibility.board.move')}
          onClick={() => { void handleDealBoardAction({ accessGranted: true, keyboardEquivalent: true, focusTarget: 'deal-row' }, effects) }}
        >
          {t('deal_accessibility.board.move')}
        </Button>
        <Alert status="information"><span aria-live="polite">{t('deal_accessibility.board.status')}</span></Alert>
      </PageBody>
    </Page>
  )
}
`,
      'src/modules/deal_accessibility/backend/board/page.meta.ts': `export const metadata = { requireAuth: true, requireFeatures: ['deal_accessibility.view'] }\n`,
      'src/modules/deal_accessibility/i18n/en.json': '{"deal_accessibility":{"board":{"title":"Deal board","move":"Move deal","status":"Deal move status"}}}\n',
    }
  }
  if (caseId === 'OMH-130') {
    return {
      ...artifacts,
      'src/modules/demo_requests/frontend/request-demo/page.tsx': `
'use client'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { submitDemoRequest } from '../../lib/submit-demo-request'

export async function handleDemoRequest(input: any, effects: any) {
  return submitDemoRequest(input, effects)
}

export default function RequestDemoPage() {
  const t = useT()
  const effects = {} as any
  return (
    <form
      className="grid gap-4 bg-background text-foreground md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault()
        void handleDemoRequest({ scopeDerived: true, consentAccepted: true, focusTarget: 'demo-submit' }, effects)
      }}
    >
      <FormField label={t('demo_requests.form.email')}><Input name="email" aria-label={t('demo_requests.form.email')} /></FormField>
      <CheckboxField label={t('demo_requests.form.consent')} />
      <Button type="submit">{t('demo_requests.form.submit')}</Button>
      <Alert status="information"><span aria-live="polite">{t('demo_requests.form.status')}</span></Alert>
    </form>
  )
}
`,
      'src/modules/demo_requests/frontend/request-demo/page.meta.ts': 'export const metadata = { navHidden: true }\n',
      'src/modules/demo_requests/i18n/en.json': '{"demo_requests":{"form":{"email":"Work email","consent":"I consent to contact","submit":"Request demo","status":"Request status"}}}\n',
    }
  }
  if (caseId === 'OMH-137') {
    return {
      ...artifacts,
      'src/modules/setup_wizard/backend/setup/page.tsx': `
'use client'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { StepIndicator } from '@open-mercato/ui/primitives/step-indicator'
import { advanceSetupWizard } from '../../lib/advance-setup'

export async function handleSetupWizardAction(input: any, effects: any) {
  return advanceSetupWizard(input, effects)
}

export default function SetupWizardPage() {
  const t = useT()
  const effects = {} as any
  const loading = false
  if (loading) return <LoadingMessage message={t('setup_wizard.states.loading')} />
  return (
    <Page>
      <PageHeader title={t('setup_wizard.title')} />
      <PageBody className="grid gap-4 text-foreground md:grid-cols-2">
        <StepIndicator steps={[{ id: 'profile', label: t('setup_wizard.steps.profile'), status: 'current' }]} />
        <Button
          type="button"
          onClick={() => { void handleSetupWizardAction({ draftPersisted: true, transitionAllowed: true, focusTarget: 'wizard-next' }, effects) }}
        >
          {t('setup_wizard.actions.continue')}
        </Button>
        <Alert status="information"><span aria-live="polite">{t('setup_wizard.states.status')}</span></Alert>
      </PageBody>
    </Page>
  )
}
`,
      'src/modules/setup_wizard/backend/setup/page.meta.ts': `export const metadata = { requireAuth: true, requireFeatures: ['setup_wizard.manage'] }\n`,
      'src/modules/setup_wizard/i18n/en.json': '{"setup_wizard":{"title":"Business setup","steps":{"profile":"Profile"},"actions":{"continue":"Continue"},"states":{"loading":"Loading setup","status":"Setup status"}}}\n',
    }
  }
  if (caseId === 'OMH-149') {
    return {
      ...artifacts,
      'src/modules/smtp_email/integration.ts': `
import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const integration: IntegrationDefinition = {
  id: 'smtp_email', title: 'SMTP email', category: 'communication', providerKey: 'smtp',
  credentials: { fields: [{ key: 'password', label: 'Password', type: 'secret', required: true }] },
  healthCheck: { service: 'smtpEmailHealthCheck' },
}
export const integrations: IntegrationDefinition[] = [integration]
`,
      'src/modules/smtp_email/di.ts': `
import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { sendTransactionalEmail } from './lib/client'
import { smtpEmailHealthCheck } from './lib/health'

export const smtpEmailService = { send: sendTransactionalEmail }
export function register(container: AppContainer) {
  container.register({
    smtpEmailService: asValue(smtpEmailService),
    smtpEmailHealthCheck: asValue(smtpEmailHealthCheck),
  })
}
`,
      'src/modules/smtp_email/lib/health.ts': `export const smtpEmailHealthCheck = { async check() { return { status: 'healthy' } } }\n`,
      'src/modules.ts': `export const enabledModules = [{ id: 'smtp_email', from: '@app' }]\n`,
    }
  }
  if (caseId === 'OMH-150') {
    return {
      ...artifacts,
      'src/modules/card_payments/index.ts': `export const metadata = { id: 'card_payments', title: 'Card payments' }\n`,
      'src/modules/card_payments/integration.ts': `
import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'
export const integration: IntegrationDefinition = {
  id: 'card_payments', title: 'Card payments', category: 'payment', hub: 'payment_gateways', providerKey: 'card-payments',
  credentials: { fields: [{ key: 'apiKey', label: 'API key', type: 'secret', required: true }] },
  healthCheck: { service: 'cardPaymentsHealthCheck' },
}
export const integrations: IntegrationDefinition[] = [integration]
`,
      'src/modules/card_payments/di.ts': `
import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerGatewayAdapter, registerPaymentGatewayDescriptor, registerWebhookHandler } from '@open-mercato/shared/modules/payment_gateways/types'
import { cardPaymentAdapter } from './lib/adapter'
import { cardPaymentsHealthCheck } from './lib/health'
export function register(container: AppContainer) {
  registerGatewayAdapter(cardPaymentAdapter)
  registerWebhookHandler('card-payments', cardPaymentAdapter.verifyWebhook)
  registerPaymentGatewayDescriptor({ providerKey: 'card-payments', label: 'Card payments' })
  container.register({ cardPaymentsHealthCheck: asValue(cardPaymentsHealthCheck) })
}
`,
      'src/modules/card_payments/acl.ts': `export const features = ['card_payments.view', 'card_payments.configure']\nexport default features\n`,
      'src/modules/card_payments/setup.ts': `
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
export const setup: ModuleSetupConfig = { defaultRoleFeatures: { admin: ['card_payments.view', 'card_payments.configure'] } }
export default setup
`,
      'src/modules/card_payments/lib/adapter.ts': `
import type { GatewayAdapter } from '@open-mercato/shared/modules/payment_gateways/types'
import { createCardPayment } from './client'
export const cardPaymentAdapter: GatewayAdapter = {
  providerKey: 'card-payments',
  createSession: (input) => createCardPayment(input, (input as any).effects),
  async capture() { return { status: 'captured', capturedAmount: 0 } },
  async refund() { return { refundId: 'refund', status: 'refunded', refundedAmount: 0 } },
  async cancel() { return { status: 'cancelled' } },
  async getStatus() { return { status: 'pending', amount: 0, amountReceived: 0, currencyCode: 'USD' } },
  async verifyWebhook() { return { eventType: 'payment', eventId: 'event', data: {}, idempotencyKey: 'event', timestamp: new Date() } },
  mapStatus() { return 'pending' },
}
`,
      'src/modules/card_payments/lib/health.ts': `export const cardPaymentsHealthCheck = { async check() { return { status: 'healthy' } } }\n`,
      'src/modules.ts': `export const enabledModules = [{ id: 'card_payments', from: '@app' }]\n`,
    }
  }
  if (caseId === 'OMH-151') {
    return {
      ...artifacts,
      'src/modules/carrier_shipping/index.ts': `export const metadata = { id: 'carrier_shipping', title: 'Carrier shipping' }\n`,
      'src/modules/carrier_shipping/integration.ts': `
import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'
export const integration: IntegrationDefinition = {
  id: 'carrier_shipping', title: 'Carrier shipping', category: 'shipping', hub: 'shipping_carriers', providerKey: 'carrier-shipping',
  credentials: { fields: [{ key: 'apiToken', label: 'API token', type: 'secret', required: true }] },
  healthCheck: { service: 'carrierShippingHealthCheck' },
}
export const integrations: IntegrationDefinition[] = [integration]
`,
      'src/modules/carrier_shipping/di.ts': `
import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerShippingAdapter } from '@open-mercato/core/modules/shipping_carriers/lib/adapter-registry'
import { carrierShippingAdapter } from './lib/adapter'
import { carrierShippingHealthCheck } from './lib/health'
export function register(container: AppContainer) {
  registerShippingAdapter(carrierShippingAdapter)
  container.register({ carrierShippingHealthCheck: asValue(carrierShippingHealthCheck) })
}
`,
      'src/modules/carrier_shipping/acl.ts': `export const features = ['carrier_shipping.view', 'carrier_shipping.configure']\nexport default features\n`,
      'src/modules/carrier_shipping/setup.ts': `
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
export const setup: ModuleSetupConfig = { defaultRoleFeatures: { admin: ['carrier_shipping.view', 'carrier_shipping.configure'] } }
export default setup
`,
      'src/modules/carrier_shipping/lib/adapter.ts': `
import type { ShippingAdapter } from '@open-mercato/core/modules/shipping_carriers/lib/adapter'
import { bookCarrierShipment } from './client'
export const carrierShippingAdapter: ShippingAdapter = {
  providerKey: 'carrier-shipping',
  async calculateRates() { return [] },
  createShipment: (input) => bookCarrierShipment(input, (input as any).effects),
  async getTracking() { return { trackingNumber: 'tracking', status: 'in_transit', events: [] } },
  async cancelShipment() { return { status: 'cancelled' } },
  async verifyWebhook() { return { eventType: 'tracking', eventId: 'event', idempotencyKey: 'event', data: {}, timestamp: new Date() } },
  mapStatus() { return 'unknown' },
}
`,
      'src/modules/carrier_shipping/lib/health.ts': `export const carrierShippingHealthCheck = { async check() { return { status: 'healthy' } } }\n`,
      'src/modules.ts': `export const enabledModules = [{ id: 'carrier_shipping', from: '@app' }]\n`,
    }
  }
  if (caseId === 'OMH-181') {
    return {
      ...artifacts,
      'src/modules/order_risk/widgets/injection/order-risk-filter/widget.ts': `
export const orderRiskFilterWidget = {
  metadata: { id: 'order_risk.injection.order-risk-filter' },
  filters: [{
    id: 'order-risk',
    label: 'order_risk.filters.risk.label',
    type: 'select',
    strategy: 'server',
    queryParam: 'risk',
    options: [
      { value: 'high', label: 'order_risk.filters.risk.high' },
      { value: 'low', label: 'order_risk.filters.risk.low' },
    ],
  }],
}
`,
      'src/modules/order_risk/widgets/injection-table.ts': `
export const injectionTable = {
  'data-table:sales.orders:filters': [{ widgetId: 'order_risk.injection.order-risk-filter' }],
  'data-table:sales.orders:bulk-actions': [{ widgetId: 'order_risk.injection.order-risk-review' }],
}
`,
      'src/modules/order_risk/i18n/en.json': '{"order_risk":{"filters":{"risk":{"label":"Order risk","high":"High","low":"Low"}},"actions":{"review":{"label":"Review risk"}}}}\n',
    }
  }
  return artifacts
}

function writeFile(root: string, relative: string, source: string): void {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, source)
}

function stageTarget(caseId: string, corrected = false): string {
  const definition = cases[caseId]
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-business-oracles-')))
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  fs.symlinkSync(typescriptRoot, path.join(root, 'node_modules', 'typescript'), process.platform === 'win32' ? 'junction' : 'dir')
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"business-oracle-target","private":true}\n')
  for (const [relative, source] of Object.entries(seeds.fixtures[definition.fixture] ?? {})) writeFile(root, relative, source)
  if (corrected) {
    for (const [relative, source] of Object.entries(correctedArtifacts(caseId, definition))) writeFile(root, relative, source)
  }
  return root
}

function installFakeYarn(root: string): string {
  const bin = path.join(root, 'fake-bin')
  fs.mkdirSync(bin)
  const executable = path.join(bin, process.platform === 'win32' ? 'yarn.cmd' : 'yarn')
  if (process.platform === 'win32') {
    fs.writeFileSync(executable, '@echo off\r\nexit /b 0\r\n')
  } else {
    fs.writeFileSync(executable, '#!/usr/bin/env node\nprocess.exit(0)\n')
    fs.chmodSync(executable, 0o755)
  }
  return bin
}

function runOracle(oracle: string, root: string, caseId: string, phase: 'before' | 'after', env = process.env) {
  const result = spawnSync(process.execPath, [oracle, '--root', root, '--case', caseId, '--phase', phase, '--json'], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 10_000,
  })
  let parsed: OracleResult | undefined
  try { parsed = JSON.parse(result.stdout) as OracleResult } catch { /* assertions report raw output */ }
  return { ...result, parsed }
}

test('the 23 business writable cases have aligned controlled fixtures', () => {
  assert.equal(Object.keys(cases).length, 23)
  for (const [caseId, definition] of Object.entries(cases)) {
    const fixture = fixtureIndex.fixtures[definition.fixture]
    const seed = seeds.fixtures[definition.fixture]
    assert.ok(fixture, `${caseId}: fixture ${definition.fixture} is not registered`)
    assert.ok(seed, `${caseId}: fixture ${definition.fixture} has no controlled seed`)
    assert.deepEqual([...fixture.seededArtifacts].sort(), Object.keys(seed).sort(), `${caseId}: declared and seeded artifacts differ`)
    assert.equal(fixture.precondition, `${definition.validator} must fail`, `${caseId}: wrong trusted validator precondition`)
    assert.equal(typeof seed[definition.file], 'string', `${caseId}: behavior target is not seeded`)
  }
  for (const caseId of ['OMH-115', 'OMH-130', 'OMH-137', 'OMH-181']) {
    const definition = cases[caseId]
    const fixture = fixtureIndex.fixtures[definition.fixture]
    const catalogCase = catalogCases.find((entry) => entry.id === caseId)
    assert.deepEqual([...(catalogCase?.oracle?.expectedArtifacts ?? [])].sort(), [...fixture.seededArtifacts].sort(), `${caseId}: case and fixture artifacts differ`)
    assert.deepEqual(catalogCase?.allowedWrites, [`src/modules/${definition.file.split('/')[2]}/**`], `${caseId}: allowed writes do not cover the complete isolated UI module`)
  }
  for (const caseId of ['OMH-149', 'OMH-150', 'OMH-151']) {
    const definition = cases[caseId]
    const fixture = fixtureIndex.fixtures[definition.fixture]
    const catalogCase = catalogCases.find((entry) => entry.id === caseId)
    const expectedArtifacts = catalogCase?.oracle?.expectedArtifacts ?? []
    assert.deepEqual(expectedArtifacts.filter((artifact) => artifact !== 'src/modules.ts').sort(), [...fixture.seededArtifacts].sort(), `${caseId}: provider fixture must seed only new module artifacts`)
    assert.ok(expectedArtifacts.includes('src/modules.ts'), `${caseId}: activation remains a required output artifact`)
    assert.ok(!fixture.seededArtifacts.includes('src/modules.ts'), `${caseId}: fixture must not overwrite scaffold activation`)
    assert.deepEqual(catalogCase?.allowedWrites, [`src/modules/${definition.file.split('/')[2]}/**`, 'src/modules.ts'], `${caseId}: provider writes must cover its app module plus activation`)
  }
  assert.ok(fixtureIndex.fixtures['ui-public-lead-capture'].seededArtifacts.includes('src/modules/demo_requests/frontend/request-demo/page.tsx'))
  assert.ok(fixtureIndex.fixtures['ui-public-lead-capture'].seededArtifacts.includes('src/modules/demo_requests/frontend/request-demo/page.meta.ts'))
})

test('controlled seeds fail and corrected production seams pass both trusted oracles', { skip: !targetSandboxAvailable }, () => {
  for (const [caseId] of Object.entries(cases)) {
    const seededRoot = stageTarget(caseId)
    try {
      for (const oracle of ['OMH-163', 'OMH-164', 'OMH-165'].includes(caseId) ? [astOracle] : [astOracle, behaviorOracle]) {
        const before = runOracle(oracle, seededRoot, caseId, 'before')
        assert.equal(before.status, 1, `${caseId} seed unexpectedly passed ${path.basename(oracle)}\n${before.stdout}\n${before.stderr}`)
        assert.equal(before.parsed?.passed, false)
        assert.ok(before.parsed?.checks.some((check) => !check.passed), `${caseId}: seed produced no failed semantic check`)
      }
    } finally {
      fs.rmSync(seededRoot, { recursive: true, force: true })
    }

    const correctedRoot = stageTarget(caseId, true)
    const fakeBin = installFakeYarn(correctedRoot)
    const env = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}` }
    try {
      for (const oracle of ['OMH-163', 'OMH-164', 'OMH-165'].includes(caseId) ? [astOracle] : [astOracle, behaviorOracle]) {
        const after = runOracle(oracle, correctedRoot, caseId, 'after', env)
        assert.equal(after.status, 0, `${caseId} correction failed ${path.basename(oracle)}\n${after.stdout}\n${after.stderr}`)
        assert.equal(after.parsed?.passed, true)
        assert.ok(after.parsed?.checks.every((check) => check.passed), `${caseId}: correction left a semantic check failing`)
      }
    } finally {
      fs.rmSync(correctedRoot, { recursive: true, force: true })
    }
  }
})

test('behavior oracles inert imported helpers instead of executing target dependencies', { skip: !targetSandboxAvailable }, () => {
  const caseId = 'OMH-105'
  const root = stageTarget(caseId, true)
  const target = cases[caseId].file
  const source = fs.readFileSync(path.join(root, target), 'utf8')
  writeFile(root, target, `
import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/modules/commands'

const importedSchema = z.object({})
registerCommand({ id: 'harness.probe', schema: importedSchema })

${source}
`)
  try {
    const result = runOracle(behaviorOracle, root, caseId, 'after')
    assert.equal(result.status, 0, `${caseId}\n${result.stdout}\n${result.stderr}`)
    assert.equal(result.parsed?.passed, true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('generated tests reject common disabled, focused, todo, and expected-failure modifiers', () => {
  const scenarios = [
    ['describe.skip', `describe.skip('disabled suite', () => {})`],
    ['describe.only', `describe.only('focused suite', () => {})`],
    ['test.describe.skip', `test.describe.skip('disabled Playwright suite', () => {})`],
    ['test.describe.only', `test.describe.only('focused Playwright suite', () => {})`],
    ['it.skip', `it.skip('disabled spec', () => {})`],
    ['it.only', `it.only('focused spec', () => {})`],
    ['xtest', `xtest('disabled alias', () => {})`],
    ['xtest.each', `xtest.each([[1]])('disabled alias matrix', () => {})`],
    ['xit', `xit('disabled alias', () => {})`],
    ['xdescribe', `xdescribe('disabled alias suite', () => {})`],
    ['fit', `fit('focused alias', () => {})`],
    ['fdescribe', `fdescribe('focused alias suite', () => {})`],
    ['test.each(...).skip', `test.each([[1]])('matrix setup', () => {}); test.each([[1]]).skip('disabled matrix', () => {})`],
    ['test.each(...).only', `test.each([[1]]).only('focused matrix', () => {})`],
    ['test.skip.each', `test.skip.each([[1]])('disabled matrix', () => {})`],
    ['test.only.each', `test.only.each([[1]])('focused matrix', () => {})`],
    ['describe.each(...).skip', `describe.each([[1]]).skip('disabled matrix suite', () => {})`],
    ['describe.each(...).only', `describe.each([[1]]).only('focused matrix suite', () => {})`],
    ['test.concurrent.only', `test.concurrent.only('focused concurrent spec', () => {})`],
    ['test.concurrent.failing', `test.concurrent.failing('expected concurrent failure', () => {})`],
    ['test.fixme', `test.fixme('known broken Playwright spec', () => {})`],
    ['test.fail', `test.fail('expected Playwright failure', () => {})`],
    ['test.failing', `test.failing('expected Jest failure', () => {})`],
    ['test.todo', `test.todo('unfinished coverage')`],
    ['test.only', `test.only('focused spec', () => {})`],
    ['test.skip', `test.skip('disabled spec', () => {})`],
    ['test.step.skip', `test.step.skip('disabled Playwright step', async () => {})`],
    ['testInfo.fail', `testInfo.fail(true, 'expected Playwright failure')`],
    ['testInfo.fixme', `testInfo.fixme(true, 'known broken Playwright spec')`],
    ['testInfo.skip', `testInfo.skip(true, 'disabled at runtime')`],
    ['static bracket modifier', `test['only']('focused bracket spec', () => {})`],
    ['referenced modifier alias', `const disabledTest = test.skip; disabledTest('disabled alias spec', () => {})`],
  ] as const

  for (const [name, modifier] of scenarios) {
    const root = stageTarget('OMH-163', true)
    const target = cases['OMH-163'].file
    writeFile(root, target, `${fs.readFileSync(path.join(root, target), 'utf8')}\n${modifier}\n`)
    try {
      const result = runOracle(astOracle, root, 'OMH-163', 'before')
      assert.equal(result.status, 1, `${name} unexpectedly passed\n${result.stdout}\n${result.stderr}`)
      assert.equal(result.parsed?.checks.find((check) => check.id === 'business.test-unit-enabled')?.passed, false, name)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

test('tests nested in a skipped suite are not counted as enabled coverage', () => {
  const root = stageTarget('OMH-163', true)
  writeFile(root, cases['OMH-163'].file, `
describe.skip('quote approval', () => {
  test('rejects an already approved quote', async () => { await expect(Promise.reject(new Error('already approved'))).rejects.toThrow('already approved') })
  test('rejects the requester', async () => { await expect(Promise.reject(new Error('requester'))).rejects.toThrow('requester') })
  test('rolls back after an injected failure', async () => {
    const persist = jest.fn()
    await expect(Promise.reject(new Error('injected failure'))).rejects.toThrow('injected failure')
    expect(persist).toHaveBeenCalledTimes(0)
  })
})
`)
  try {
    const result = runOracle(astOracle, root, 'OMH-163', 'before')
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.equal(result.parsed?.checks.find((check) => check.id === 'business.test-unit-runner')?.passed, true)
    assert.equal(result.parsed?.checks.find((check) => check.id === 'business.test-unit-enabled')?.passed, false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('server lifecycle checks require every listen call to bind an exact loopback host', () => {
  const scenarios = [
    ['omitted host with decoy loopback URLs', `server.listen(0, resolve)`],
    ['wildcard host with decoy loopback URLs', `server.listen(0, '0.0.0.0', resolve)`],
    ['loopback host through a variable', `(() => { const host = '127.0.0.1'; server.listen(0, host, resolve) })()`],
    ['options without host', `server.listen({ port: 0 }, resolve)`],
    ['wildcard options host', `server.listen({ port: 0, host: '0.0.0.0' }, resolve)`],
    ['duplicate options host', `server.listen({ port: 0, host: '127.0.0.1', host: '0.0.0.0' }, resolve)`],
    ['spread-overridable options host', `server.listen({ port: 0, host: '127.0.0.1', ...{ host: '0.0.0.0' } }, resolve)`],
    ['computed-overridable options host', `server.listen({ port: 0, host: '127.0.0.1', ['ho' + 'st']: '0.0.0.0' }, resolve)`],
    ['unrelated host object plus omitted listen host', `(() => { const decoy = { host: '127.0.0.1' }; void decoy; server.listen(0, resolve) })()`],
    ['indirect listen invocation', `server.listen.call(server, 0, '127.0.0.1', resolve)`],
    ['one valid and one unsafe listen call', `server.listen(0, '127.0.0.1', () => server.listen(0, '0.0.0.0', resolve))`],
  ] as const

  for (const caseId of ['OMH-164', 'OMH-165'] as const) {
    for (const [name, replacement] of scenarios) {
      const root = stageTarget(caseId, true)
      const target = cases[caseId].file
      writeFile(root, target, fs.readFileSync(path.join(root, target), 'utf8').replace(
        `server.listen(0, '127.0.0.1', resolve)`,
        replacement,
      ))
      try {
        const result = runOracle(astOracle, root, caseId, 'before')
        const checkId = caseId === 'OMH-164' ? 'business.test-api-lifecycle' : 'business.test-browser-lifecycle'
        assert.equal(result.status, 1, `${caseId} ${name} unexpectedly passed\n${result.stdout}\n${result.stderr}`)
        assert.equal(result.parsed?.checks.find((check) => check.id === checkId)?.passed, false, `${caseId} ${name}`)
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    }
  }
})

test('server lifecycle checks accept the exact loopback host in listen options', () => {
  for (const caseId of ['OMH-164', 'OMH-165'] as const) {
    const root = stageTarget(caseId, true)
    const target = cases[caseId].file
    writeFile(root, target, fs.readFileSync(path.join(root, target), 'utf8').replace(
      `server.listen(0, '127.0.0.1', resolve)`,
      `server.listen({ port: 0, host: '127.0.0.1' }, resolve)`,
    ))
    try {
      const result = runOracle(astOracle, root, caseId, 'before')
      assert.equal(result.status, 0, `${caseId}\n${result.stdout}\n${result.stderr}`)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

test('business AST checks cannot be satisfied by a decoy export', () => {
  const root = stageTarget('OMH-093')
  writeFile(root, cases['OMH-093'].file, `
export async function mergeContacts() { throw new Error('not implemented') }
export async function decoy(input: any, effects: any) {
  await effects.reserveIdempotency(input.idempotencyKey)
  return effects.transaction(async () => {
    const result = await effects.apply(input)
    await effects.record({ idempotencyKey: input.idempotencyKey, result })
    return result
  })
}
`)
  try {
    const result = runOracle(astOracle, root, 'OMH-093', 'before')
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.equal(result.parsed?.checks.find((check) => check.id === 'business.command-seam')?.passed, false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('provider AST requires activation and canonical host registration beyond the behavior seam', () => {
  const scenarios = [
    { caseId: 'OMH-149', file: 'src/modules.ts', replace: ["{ id: 'smtp_email', from: '@app' }", ''], check: 'business.provider-activation' },
    { caseId: 'OMH-150', file: 'src/modules/card_payments/di.ts', replace: ['registerGatewayAdapter(cardPaymentAdapter)', 'void cardPaymentAdapter'], check: 'business.provider-payment-registration' },
    { caseId: 'OMH-150', file: 'src/modules/card_payments/di.ts', replace: ["registerWebhookHandler('card-payments', cardPaymentAdapter.verifyWebhook)", ''], check: 'business.provider-payment-registration' },
    { caseId: 'OMH-151', file: 'src/modules/carrier_shipping/di.ts', replace: ['registerShippingAdapter(carrierShippingAdapter)', 'void carrierShippingAdapter'], check: 'business.provider-shipping-registration' },
  ] as const
  for (const scenario of scenarios) {
    const root = stageTarget(scenario.caseId, true)
    const target = path.join(root, scenario.file)
    const [search, replacement] = scenario.replace
    fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace(search, replacement))
    try {
      const result = runOracle(astOracle, root, scenario.caseId, 'before')
      assert.equal(result.status, 1, `${scenario.caseId}\n${result.stdout}\n${result.stderr}`)
      assert.equal(result.parsed?.checks.find((check) => check.id === scenario.check)?.passed, false)
      assert.equal(result.parsed?.checks.find((check) => check.id === 'business.provider-seam')?.passed, true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

test('rendered UI policy rejects inline SVG, palette colors, and arbitrary Tailwind values', () => {
  const root = stageTarget('OMH-115', true)
  const page = path.join(root, 'src/modules/deal_accessibility/backend/board/page.tsx')
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace(
    '</PageBody>',
    '<svg className="text-red-600 w-[13px]" /></PageBody>',
  ))
  try {
    const result = runOracle(astOracle, root, 'OMH-115', 'before')
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.equal(result.parsed?.checks.find((check) => check.id === 'business.ui-policy')?.passed, false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('order-risk widgets must target the exact sales.orders filter and bulk-action hosts', () => {
  const root = stageTarget('OMH-181', true)
  const table = path.join(root, 'src/modules/order_risk/widgets/injection-table.ts')
  fs.writeFileSync(table, fs.readFileSync(table, 'utf8').replaceAll('data-table:sales.orders:', 'data-table:sales.quotes:'))
  try {
    const result = runOracle(astOracle, root, 'OMH-181', 'before')
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.equal(result.parsed?.checks.find((check) => check.id === 'business.table-filter-host')?.passed, false)
    assert.equal(result.parsed?.checks.find((check) => check.id === 'business.table-bulk-host')?.passed, false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('business behavior probes reject imports without executing target-controlled code', { skip: process.platform === 'win32' }, () => {
  const sentinel = path.join(os.tmpdir(), `om-business-oracle-sentinel-${process.pid}-${Date.now()}`)
  const root = stageTarget('OMH-093')
  writeFile(root, cases['OMH-093'].file, `
import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(sentinel)}, 'unsafe')
export async function mergeContacts() {}
`)
  try {
    const result = runOracle(behaviorOracle, root, 'OMH-093', 'after')
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
    assert.match(result.parsed?.failures.join(' ') ?? '', /must not execute imports/)
    assert.equal(fs.existsSync(sentinel), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(sentinel, { force: true })
  }
})
