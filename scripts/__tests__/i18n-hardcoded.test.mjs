import test from 'node:test'
import assert from 'node:assert/strict'

import {
  HARDCODED_KINDS,
  buildAllowlistMatchers,
  filterFindings,
  findingIsAllowlisted,
  looksEnglishPhrase,
  scanLine,
  scanText,
} from '../i18n-hardcoded-scanner.mjs'

test('looksEnglishPhrase accepts two-word user labels and rejects technical strings', () => {
  assert.equal(looksEnglishPhrase('Close menu'), true)
  assert.equal(looksEnglishPhrase('Hello World.'), true)
  assert.equal(looksEnglishPhrase('Sign in'), true)
  assert.equal(looksEnglishPhrase('Close'), false, 'single word falls below minWords=2')
  assert.equal(looksEnglishPhrase('POST'), false, 'all-caps HTTP verb')
  assert.equal(looksEnglishPhrase('application/json'), false, 'mime type prefix is technical')
  assert.equal(looksEnglishPhrase('module.entity.title'), false, 'dotted identifier looks like an i18n key')
  assert.equal(looksEnglishPhrase(''), false, 'empty string')
  assert.equal(looksEnglishPhrase('[internal] Bus missing'), false, '[internal] prefix is opted out')
})

test('scanText detects JSX text nodes with two or more English words', () => {
  const text = [
    '<div>',
    '  <p>Hello World</p>',
    '  <p>{t("docs.title")}</p>',
    '  <p>Edit profile</p>',
    '</div>',
  ].join('\n')

  const findings = scanText(text, { file: 'frontend/page.tsx' })
  const jsxTextValues = findings.filter((f) => f.kind === HARDCODED_KINDS.jsxText).map((f) => f.value)
  assert.deepEqual(jsxTextValues.sort(), ['Edit profile', 'Hello World'])
})

test('scanText ignores JSX nodes already wrapped by t()/translate()', () => {
  const text = '<button>{t("auth.login.submit")}</button>'
  const findings = scanText(text, { file: 'frontend/auth.tsx' })
  assert.deepEqual(findings, [])
})

test('scanText detects ternary branches expressed as JSX text on separate lines', () => {
  const text = [
    '<span>',
    '  {condition ? <strong>Active Subscription</strong> : <strong>No Subscription</strong>}',
    '</span>',
  ].join('\n')
  const findings = scanText(text, { file: 'frontend/billing.tsx' })
  const jsxTexts = findings.filter((f) => f.kind === HARDCODED_KINDS.jsxText).map((f) => f.value).sort()
  assert.deepEqual(jsxTexts, ['Active Subscription', 'No Subscription'])
})

test('scanText flags user-visible JSX attributes and ignores technical attribute values', () => {
  const text = [
    '<button aria-label="Close menu" />',
    '<input placeholder="Search products" />',
    '<input placeholder="POST" />',
    '<a title="Go home" />',
    '<a title="/api/health" />',
  ].join('\n')

  const findings = scanText(text, { file: 'frontend/widgets/Header.tsx' })
  const attrFindings = findings
    .filter((f) => f.kind === HARDCODED_KINDS.jsxAttr)
    .map((f) => `${f.attribute}=${f.value}`)
    .sort()
  assert.deepEqual(attrFindings, [
    'aria-label=Close menu',
    'placeholder=Search products',
    'title=Go home',
  ])
})

test('scanText catches throw / createCrudFormError / toast literals while honouring [internal] prefix', () => {
  const text = [
    "throw new Error('Failed to load profile')",
    "throw new Error('[internal] Event bus missing in container')",
    "createCrudFormError('You cannot delete this record')",
    "toast.error('Something went wrong')",
    "toast.success('Profile saved successfully')",
    "raiseCrudError('Permission denied')",
  ].join('\n')

  const findings = scanText(text, { file: 'backend/commands/actions.ts' })
  const byKind = new Map()
  for (const f of findings) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, [])
    byKind.get(f.kind).push(f.value)
  }

  assert.deepEqual(byKind.get(HARDCODED_KINDS.throwError), ['Failed to load profile'])
  assert.deepEqual(byKind.get(HARDCODED_KINDS.crudFormError), ['You cannot delete this record'])
  assert.deepEqual(byKind.get(HARDCODED_KINDS.raiseCrudError), ['Permission denied'])
  assert.deepEqual(
    (byKind.get(HARDCODED_KINDS.toastCall) ?? []).sort(),
    ['Profile saved successfully', 'Something went wrong'],
  )
})

test('scanText flags English CrudHttpError bodies and skips translated, internal and non-literal ones', () => {
  const text = [
    "throw new CrudHttpError(422, { error: 'This link has active transactions and cannot be edited' })",
    'throw new CrudHttpError(400, { error: `Invalid target payload for queue ${queue}` })',
    "throw new CrudHttpError(status, { error: \"Record not found\", code: 'missing' })",
    "throw new CrudHttpError(400, { error: '[internal] redo snapshot unavailable' })",
    "throw new CrudHttpError(403, { error: translate('checkout.errors.locked', 'Link is locked') })",
    "throw new CrudHttpError(403, { error: t('checkout.errors.locked') })",
    'throw new CrudHttpError(404, { error: message })',
    "throw new CrudHttpError(404, { error: 'checkout.errors.notFound' })",
    "throw new CrudHttpError(401, { error: 'Unauthorized' })",
  ].join('\n')

  const findings = scanText(text, { file: 'backend/commands/links.ts' })
  assert.deepEqual(
    findings.map((f) => `${f.kind}:${f.line}:${f.value}`),
    [
      'crud-http-error:1:This link has active transactions and cannot be edited',
      'crud-http-error:2:Invalid target payload for queue ${queue}',
      'crud-http-error:3:Record not found',
    ],
  )
})

test('scanText flags English messages passed to the shared CrudHttpError helpers', () => {
  const text = [
    "throw notFound('Checkout link not found')",
    "throw conflict('Notification action already executed')",
    "throw forbidden(`Access to ${resource} denied`)",
    "const link = assertFound(await em.findOne(CheckoutLink, { id }), 'Checkout link not found')",
    "throw notFound('[internal] link snapshot missing')",
    "throw forbidden(translate('checkout.errors.forbidden', 'Access denied'))",
    'throw conflict(message)',
    "throw badRequest('uom.unit_not_found')",
    "const record = assertFound(row, 'checkout.errors.notFound')",
    "const deal = assertFound(await em.findOne(Deal, { id }), translate('customers.errors.deal_not_found', 'Deal not found'))",
    "const deal = assertFound(row, t('customers.errors.deal_not_found'))",
    'notFound()',
    "router.notFound('Page is missing')",
  ].join('\n')

  const findings = scanText(text, { file: 'backend/commands/links.ts' })
  assert.deepEqual(
    findings.map((f) => `${f.kind}:${f.line}:${f.value}`),
    [
      'crud-http-error:1:Checkout link not found',
      'crud-http-error:2:Notification action already executed',
      'crud-http-error:3:Access to ${resource} denied',
      'crud-http-error:4:Checkout link not found',
    ],
  )
})

test('looksEnglishPhrase rejects single-dot and interpolated i18n keys', () => {
  assert.equal(looksEnglishPhrase('uom.unit_not_found'), false)
  assert.equal(looksEnglishPhrase('eudr.errors.${result.errorKey}'), false)
  assert.equal(looksEnglishPhrase('Unit not found.'), true)
})

test('scanText flags English NextResponse.json / Response.json error bodies once each', () => {
  const text = [
    "return NextResponse.json({ error: 'Invalid company id' }, { status: 400 })",
    "return Response.json({ error: 'Webhook signature mismatch' }, { status: 401 })",
    'return NextResponse.json({ error: `Unknown provider ${provider}` }, { status: 404 })',
    "return NextResponse.json({ error: '[internal] container not ready' }, { status: 500 })",
    "return NextResponse.json({ error: translate('customers.errors.invalidId', 'Invalid id') }, { status: 400 })",
    "return NextResponse.json({ error: t('customers.errors.invalidId') }, { status: 400 })",
    'return NextResponse.json({ error: reason }, { status: 400 })',
    "return NextResponse.json({ error: 'customers.errors.invalidId' }, { status: 400 })",
    "return NextResponse.json({ ok: true, error: 'Not a leading key' })",
  ].join('\n')

  const findings = scanText(text, { file: 'api/companies/route.ts' })
  assert.deepEqual(
    findings.map((f) => `${f.kind}:${f.line}:${f.value}`),
    [
      'json-error-response:1:Invalid company id',
      'json-error-response:2:Webhook signature mismatch',
      'json-error-response:3:Unknown provider ${provider}',
    ],
  )
})

test('allowlist kind filter applies to the CrudHttpError and JSON error body kinds', () => {
  const matchers = buildAllowlistMatchers({
    entries: [{ kind: HARDCODED_KINDS.jsonErrorResponse, reason: 'machine-facing webhook endpoint' }],
  })
  const findings = scanText(
    [
      "return NextResponse.json({ error: 'Webhook signature mismatch' }, { status: 401 })",
      "throw new CrudHttpError(422, { error: 'Link is locked for editing' })",
    ].join('\n'),
    { file: 'api/webhook/route.ts' },
  )
  const { kept, allowlisted } = filterFindings(findings, matchers)
  assert.deepEqual(kept.map((f) => f.kind), [HARDCODED_KINDS.crudHttpError])
  assert.deepEqual(allowlisted.map(({ finding }) => finding.kind), [HARDCODED_KINDS.jsonErrorResponse])
})

test('scanLine reports column metadata so report rows are actionable', () => {
  const findings = scanLine('  <p>Privacy Policy</p>', { file: 'frontend/legal.tsx', lineNumber: 7 })
  assert.equal(findings.length, 1)
  assert.equal(findings[0].kind, HARDCODED_KINDS.jsxText)
  assert.equal(findings[0].file, 'frontend/legal.tsx')
  assert.equal(findings[0].line, 7)
  assert.ok(findings[0].column > 1, 'column is 1-indexed relative to the line')
})

test('buildAllowlistMatchers + findingIsAllowlisted support file/line/match/kind filters', () => {
  const allowlist = {
    entries: [
      { file: 'frontend/privacy/page.tsx', reason: 'legal body deferred to legal review' },
      { match: 'Heritage', reason: 'brand name' },
      { kind: HARDCODED_KINDS.throwError, match: '^Permission denied$', reason: 'low-noise auth string' },
    ],
  }
  const matchers = buildAllowlistMatchers(allowlist)

  const findingInLegal = {
    kind: HARDCODED_KINDS.jsxText,
    value: 'Long legal sentence',
    file: 'packages/content/src/modules/content/frontend/privacy/page.tsx',
    line: 12,
    column: 1,
    raw: '>Long legal sentence<',
  }
  const brandFinding = {
    kind: HARDCODED_KINDS.jsxAttr,
    attribute: 'title',
    value: 'Heritage Collection',
    file: 'packages/core/src/modules/example/frontend/landing.tsx',
    line: 3,
    column: 4,
    raw: 'title="Heritage Collection"',
  }
  const otherFinding = {
    kind: HARDCODED_KINDS.jsxAttr,
    attribute: 'title',
    value: 'New Customer',
    file: 'packages/core/src/modules/customers/frontend/page.tsx',
    line: 9,
    column: 3,
    raw: 'title="New Customer"',
  }
  const allowedThrow = {
    kind: HARDCODED_KINDS.throwError,
    value: 'Permission denied',
    file: 'packages/core/src/modules/auth/lib/guard.ts',
    line: 2,
    column: 1,
    raw: "throw new Error('Permission denied')",
  }

  assert.ok(findingIsAllowlisted(findingInLegal, matchers), 'file-only allowlist entry hides legal body')
  assert.ok(findingIsAllowlisted(brandFinding, matchers), 'global match entry hides brand string')
  assert.equal(findingIsAllowlisted(otherFinding, matchers), null, 'unrelated finding stays in results')
  assert.ok(findingIsAllowlisted(allowedThrow, matchers), 'kind + regex match works')

  const { kept, allowlisted } = filterFindings([findingInLegal, brandFinding, otherFinding, allowedThrow], matchers)
  assert.deepEqual(kept.map((f) => f.value), ['New Customer'])
  assert.equal(allowlisted.length, 3)
})

test('scanText returns empty array for files without hardcoded literals', () => {
  const text = [
    'import { useT } from "@open-mercato/shared/lib/i18n/context"',
    'export function Greeting() {',
    '  const t = useT()',
    '  return <p>{t("greeting.title")}</p>',
    '}',
  ].join('\n')
  assert.deepEqual(scanText(text, { file: 'frontend/Greeting.tsx' }), [])
})
