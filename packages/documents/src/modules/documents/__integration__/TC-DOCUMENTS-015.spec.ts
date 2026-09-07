import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { Client } from 'pg'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  ensureManagedCollabSidecar,
  type ManagedCollabSidecar,
} from './helpers/collabSidecar'

export const integrationMeta = {
  dependsOnModules: ['documents'],
}

type CreatedRecord = {
  id: string
  updatedAt: string
}

type TestUser = {
  id: string
  email: string
  password: string
  name: string
  token: string
}

type CollabTokenBody = {
  url?: string | null
}

type ContentBody = {
  contentText?: string | null
}

type CommentNode = {
  id?: string
  body?: string
  anchor?: unknown
  replies?: CommentNode[]
}

type CommentListBody = {
  items?: CommentNode[]
}

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const EDITOR_FEATURES = [
  'documents.view',
  'documents.create',
  'documents.edit',
  'documents.share',
]
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i

function expectUpdatedAt(value: unknown, message: string): string {
  expect(typeof value === 'string' && value.length > 0, message).toBe(true)
  return value as string
}

function uniqueEmail(label: string, stamp: number): string {
  return `tc-documents-015-${label}-${stamp}-${Math.floor(Math.random() * 1_000_000)}@example.com`
}

function policyPassword(label: string, stamp: number): string {
  return `Docs015${label}1!${stamp}`
}

async function createTestUser(
  request: APIRequestContext,
  adminToken: string,
  input: {
    label: string
    stamp: number
    organizationId: string
    roleId: string
  },
): Promise<TestUser> {
  const email = uniqueEmail(input.label, input.stamp)
  const password = policyPassword(input.label, input.stamp)
  const name = `TC Documents 015 ${input.label} ${input.stamp}`
  const id = await createUserFixture(request, adminToken, {
    email,
    password,
    organizationId: input.organizationId,
    roles: [input.roleId],
    name,
  })
  const token = await getAuthToken(request, email, password)
  return { id, email, password, name, token }
}

async function createDocument(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<CreatedRecord> {
  const response = await apiRequest(request, 'POST', '/api/documents', {
    token,
    data: { title, folderId: null },
  })
  const body = await readJsonSafe<{ id?: string; updatedAt?: string }>(response)
  expect(response.status(), 'POST /api/documents should return 201').toBe(201)
  return {
    id: expectId(body?.id, 'document create response should include id'),
    updatedAt: expectUpdatedAt(body?.updatedAt, 'document create response should include updatedAt'),
  }
}

async function putContent(
  request: APIRequestContext,
  token: string,
  documentId: string,
  text: string,
): Promise<void> {
  const response = await apiRequest(
    request,
    'PUT',
    `/api/documents/${encodeURIComponent(documentId)}/content`,
    { token, data: { contentHtml: `<p>${text}</p>`, contentText: text } },
  )
  expect(response.status(), 'PUT document content should return 200').toBe(200)
}

async function shareWithUser(
  request: APIRequestContext,
  token: string,
  documentId: string,
  userId: string,
): Promise<CreatedRecord> {
  const response = await apiRequest(
    request,
    'POST',
    `/api/documents/${encodeURIComponent(documentId)}/shares`,
    {
      token,
      data: { principalType: 'user', principalId: userId, permission: 'editor' },
    },
  )
  const body = await readJsonSafe<{ id?: string; updatedAt?: string }>(response)
  expect(response.status(), 'editor share should return 201').toBe(201)
  return {
    id: expectId(body?.id, 'share create response should include id'),
    updatedAt: expectUpdatedAt(body?.updatedAt, 'share create response should include updatedAt'),
  }
}

async function createComment(
  request: APIRequestContext,
  token: string,
  documentId: string,
  body: string,
  anchor: unknown,
): Promise<string> {
  const response = await apiRequest(
    request,
    'POST',
    `/api/documents/${encodeURIComponent(documentId)}/comments`,
    { token, data: { body, anchor, parentCommentId: null } },
  )
  const payload = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), `create comment ${body}`).toBe(201)
  return expectId(payload?.id, 'comment create response should include id')
}

async function listComments(
  request: APIRequestContext,
  token: string,
  documentId: string,
): Promise<CommentNode[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/documents/${encodeURIComponent(documentId)}/comments`,
    { token },
  )
  const body = await readJsonSafe<CommentListBody>(response)
  expect(response.status(), 'GET document comments should return 200').toBe(200)
  return body?.items ?? []
}

function flattenComments(comments: CommentNode[]): CommentNode[] {
  return comments.flatMap((comment) => [comment, ...flattenComments(comment.replies ?? [])])
}

function findCommentByBody(comments: CommentNode[], body: string): CommentNode | null {
  return flattenComments(comments).find((comment) => comment.body === body) ?? null
}

async function deleteShareIfExists(
  request: APIRequestContext,
  token: string | null,
  documentId: string | null,
  share: CreatedRecord | null,
): Promise<void> {
  if (!token || !documentId || !share) return
  await request.fetch(`${BASE_URL}/api/documents/${encodeURIComponent(documentId)}/shares`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER_NAME]: share.updatedAt,
    },
    data: { id: share.id },
  }).catch(() => undefined)
}

async function deleteDocumentIfExists(
  request: APIRequestContext,
  token: string | null,
  document: CreatedRecord | null,
): Promise<void> {
  if (!token || !document) return
  await request.fetch(`${BASE_URL}/api/documents/${encodeURIComponent(document.id)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      [OPTIMISTIC_LOCK_HEADER_NAME]: document.updatedAt,
    },
  }).catch(() => undefined)
}

function resolveAppRoot(): string {
  const configured = process.env.OM_TEST_APP_ROOT?.trim()
  return configured ? path.resolve(configured) : path.resolve(process.cwd(), 'apps/mercato')
}

function readEnvValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key]
  const candidates = [
    path.resolve(resolveAppRoot(), '.env'),
    path.resolve(process.cwd(), 'apps/mercato/.env'),
    path.resolve(process.cwd(), '.env'),
  ]
  for (const candidate of candidates) {
    try {
      const content = readFileSync(candidate, 'utf8')
      const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'))
      if (match?.[1]) return match[1].trim()
    } catch {
      continue
    }
  }
  return undefined
}

async function withDatabase<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const connectionString = readEnvValue('DATABASE_URL')
  if (!connectionString) {
    throw new Error('[internal] DATABASE_URL is required for historical document-comment fixtures')
  }
  const client = new Client({ connectionString })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

async function replacePersistedAnchor(input: {
  commentId: string
  documentId: string
  tenantId: string
  organizationId: string
  anchor: Record<string, unknown>
}): Promise<void> {
  await withDatabase(async (client) => {
    const result = await client.query(
      `update document_comments
          set anchor = $1::jsonb, updated_at = now()
        where id = $2
          and document_id = $3
          and tenant_id = $4
          and organization_id = $5`,
      [
        JSON.stringify(input.anchor),
        input.commentId,
        input.documentId,
        input.tenantId,
        input.organizationId,
      ],
    )
    expect(result.rowCount, 'historical comment fixture should update exactly one scoped row').toBe(1)
  })
}

async function deleteCommentsForDocument(input: {
  documentId: string | null
  tenantId: string | null
  organizationId: string | null
}): Promise<void> {
  if (!input.documentId || !input.tenantId || !input.organizationId) return
  await withDatabase(async (client) => {
    await client.query(
      `delete from document_comments
        where document_id = $1
          and tenant_id = $2
          and organization_id = $3`,
      [input.documentId, input.tenantId, input.organizationId],
    )
  })
}

async function authenticatedContext(browser: Browser, user: TestUser): Promise<BrowserContext> {
  const scope = getTokenScope(user.token)
  const context = await browser.newContext({ baseURL: BASE_URL })
  await context.addCookies([
    { name: 'auth_token', value: user.token, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_selected_tenant', value: scope.tenantId, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_selected_org', value: scope.organizationId, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_demo_notice_ack', value: 'ack', url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_cookie_notice_ack', value: 'ack', url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_feedback_suppress', value: '1', url: BASE_URL, sameSite: 'Lax' },
  ])
  return context
}

async function openDocumentPage(
  context: BrowserContext,
  documentId: string,
  expectedText: string,
  options: { requireLive?: boolean } = {},
): Promise<Page> {
  const page = await context.newPage()
  await page.goto(`/backend/documents/${encodeURIComponent(documentId)}`, {
    waitUntil: 'domcontentloaded',
  })
  const editor = page.locator('.ProseMirror').first()
  await expect(editor).toBeVisible()
  await expect(editor).toContainText(expectedText)
  if (options.requireLive) {
    await expect(page.getByText('Live', { exact: true }).first()).toBeVisible()
  }
  return page
}

function healthUrlFromWebSocketUrl(value: string): string {
  const url = new URL(value)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = '/healthz'
  url.search = ''
  url.hash = ''
  return url.toString()
}

async function requireLiveSidecar(
  request: APIRequestContext,
  token: string,
  documentId: string,
): Promise<void> {
  const tokenResponse = await apiRequest(
    request,
    'GET',
    `/api/documents/${encodeURIComponent(documentId)}/collab-token`,
    { token },
  )
  const tokenBody = await readJsonSafe<CollabTokenBody>(tokenResponse)
  expect(tokenResponse.status(), 'collaboration token should mint in the sidecar-enabled harness').toBe(200)
  test.skip(!tokenBody?.url, 'Documents collaboration sidecar URL is not configured')

  // A sidecar that is configured but down must fail this run rather than skip
  // it: skipping would report green for exactly the collaboration behaviour
  // these assertions exist to protect.
  const healthUrl = healthUrlFromWebSocketUrl(tokenBody?.url as string)
  const healthResponse = await request.get(healthUrl).catch(() => null)
  expect(
    healthResponse,
    `configured collaboration sidecar at ${healthUrl} did not answer its health probe`,
  ).not.toBeNull()
  expect(healthResponse?.status(), 'configured collaboration sidecar should be ready').toBe(200)
}

async function editorText(page: Page): Promise<string> {
  return page.locator('.ProseMirror').first().evaluate((editor) => {
    const clone = editor.cloneNode(true) as HTMLElement

    // Collaboration carets are ProseMirror widget decorations. Their visible
    // user labels live inside the editor DOM, but they are not document text.
    clone.querySelectorAll('.collaboration-carets__caret').forEach((caret) => caret.remove())

    return Array.from(clone.childNodes)
      .map((node) => node.textContent ?? '')
      .join('\n')
      .trimEnd()
  })
}

async function expectEditorText(page: Page, expected: string): Promise<void> {
  await expect.poll(() => editorText(page)).toBe(expected)
}

async function selectEditorRange(
  page: Page,
  start: number,
  length: number,
  expectedSelection?: string,
): Promise<void> {
  const editor = page.locator('.ProseMirror').first()
  await editor.focus()

  await editor.evaluate((root, rangeInput) => {
    const textNodes: Text[] = []
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement
        return parent?.closest('.collaboration-carets__caret')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT
      },
    })
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      textNodes.push(node as Text)
    }

    const locate = (absoluteOffset: number): { node: Text; offset: number } => {
      let remaining = absoluteOffset
      for (const node of textNodes) {
        const size = node.data.length
        if (remaining <= size) return { node, offset: remaining }
        remaining -= size
      }
      const last = textNodes.at(-1)
      if (!last || remaining !== 0) throw new Error(`Editor offset ${absoluteOffset} is outside its text content`)
      return { node: last, offset: last.data.length }
    }

    const from = locate(rangeInput.start)
    const to = locate(rangeInput.start + rangeInput.length)
    const range = root.ownerDocument.createRange()
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
    const selection = root.ownerDocument.defaultView?.getSelection()
    if (!selection) throw new Error('Browser selection is unavailable')
    selection.removeAllRanges()
    selection.addRange(range)

    // Programmatic ranges emit selectionchange inconsistently across browser
    // engines. Dispatching the native document event makes ProseMirror consume
    // the final range as one transaction, which is also what CollaborationCaret
    // publishes through Yjs awareness.
    root.ownerDocument.dispatchEvent(new Event('selectionchange'))
  }, { start, length })

  if (expectedSelection !== undefined) {
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
      .toBe(expectedSelection)
  }
}

async function submitCommentFromComposer(page: Page, body: string): Promise<void> {
  const textarea = page.getByPlaceholder('Write a comment…').first()
  const composer = textarea.locator('xpath=ancestor::form')
  const createResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'POST' && url.pathname.endsWith('/comments')
  })
  await textarea.fill(body)
  await composer.getByRole('button', { name: 'Comment', exact: true }).click()
  expect((await createResponse).status(), 'UI comment creation should complete before API verification').toBe(201)
  await expect(textarea).toHaveValue('')
  await expect(page.getByText(body, { exact: true })).toBeVisible()
}

async function openAnchoredCommentComposer(page: Page): Promise<void> {
  const selectionMenu = page.locator('div.z-popover').filter({
    has: page.getByRole('button', { name: 'Bold', exact: true }),
  })
  await expect(selectionMenu, 'selected text should open exactly one formatting menu').toHaveCount(1)
  await expect(selectionMenu).toBeVisible()

  const commentAction = selectionMenu.getByRole('button', { name: 'Comment', exact: true })
  await expect(commentAction, 'selection menu should expose the anchored-comment action').toHaveCount(1)
  await commentAction.click()

  // The application captures the relative anchor before asynchronously moving
  // focus into the composer. Waiting for that focus proves the intended UX ran
  // and prevents the test itself from collapsing the editor selection first.
  await expect(page.getByPlaceholder('Write a comment…').first()).toBeFocused()
}

async function expectRemoteEditorSelection(page: Page, expected: string): Promise<void> {
  const matchingSelection = page.locator('.ProseMirror-yjs-selection').filter({ hasText: expected })
  await expect(
    matchingSelection,
    `remote collaboration state should expose the complete ${expected} selection`,
  ).toHaveCount(1)
  await expect(matchingSelection).toHaveText(expected)
}

async function visibleAndAccessibleText(page: Page): Promise<string> {
  const bodyText = await page.locator('body').innerText()
  const labels = await page.locator('[aria-label], [title]').evaluateAll((elements) => elements.flatMap((element) => {
    const ariaLabel = element.getAttribute('aria-label')
    const title = element.getAttribute('title')
    return [ariaLabel, title].filter((value): value is string => Boolean(value))
  }))
  return `${bodyText}\n${labels.join('\n')}`
}

test.describe('TC-DOCUMENTS-015: durable CRDT comment anchors', () => {
  test('keeps historical anchors readable, rejects them on new writes, and preserves readable keyboard mentions', async ({ browser, request }) => {
    test.slow()
    const stamp = Date.now()
    const legacyText = 'Legacy target remains readable'
    const legacyBody = `TC-DOCUMENTS-015 legacy ${stamp}`
    const historicalFixtures = [
      {
        body: `TC-DOCUMENTS-015 empty historical ${stamp}`,
        anchor: {},
      },
      {
        body: `TC-DOCUMENTS-015 extra historical ${stamp}`,
        anchor: { from: 1, to: 7, extra: true },
      },
      {
        body: `TC-DOCUMENTS-015 unknown historical ${stamp}`,
        anchor: { kind: 'historical-anchor', opaque: 'LEGACY_OPAQUE_SENTINEL' },
      },
    ] as const

    let adminToken: string | null = null
    let roleId: string | null = null
    let author: TestUser | null = null
    let collaborator: TestUser | null = null
    let document: CreatedRecord | null = null
    let share: CreatedRecord | null = null
    let tenantId: string | null = null
    let organizationId: string | null = null
    let context: BrowserContext | null = null
    let collabSidecar: ManagedCollabSidecar | null = null

    try {
      // Comment anchors are CRDT state: without a reachable sidecar the editor re-mounts into
      // single-user mode and clicking a comment no longer selects its anchored range.
      collabSidecar = await ensureManagedCollabSidecar(BASE_URL)
      adminToken = await getAuthToken(request, 'admin')
      const adminScope = getTokenScope(adminToken)
      tenantId = adminScope.tenantId
      organizationId = adminScope.organizationId
      roleId = await createRoleFixture(request, adminToken, {
        name: `TC-DOCUMENTS-015 compatibility ${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: EDITOR_FEATURES,
        organizations: null,
      })
      author = await createTestUser(request, adminToken, {
        label: 'author', stamp, organizationId, roleId,
      })
      collaborator = await createTestUser(request, adminToken, {
        label: 'mention-target', stamp, organizationId, roleId,
      })
      document = await createDocument(
        request,
        author.token,
        `TC-DOCUMENTS-015 compatibility ${stamp}`,
      )
      await putContent(request, author.token, document.id, legacyText)
      share = await shareWithUser(request, author.token, document.id, collaborator.id)

      await createComment(request, author.token, document.id, legacyBody, { from: 1, to: 7 })
      for (const fixture of historicalFixtures) {
        const commentId = await createComment(request, author.token, document.id, fixture.body, null)
        await replacePersistedAnchor({
          commentId,
          documentId: document.id,
          tenantId,
          organizationId,
          anchor: fixture.anchor,
        })
      }

      const persistedComments = await listComments(request, author.token, document.id)
      expect(findCommentByBody(persistedComments, legacyBody)?.anchor).toEqual({ from: 1, to: 7 })
      for (const fixture of historicalFixtures) {
        expect(
          findCommentByBody(persistedComments, fixture.body)?.anchor,
          `historical anchor for ${fixture.body} should remain readable without rewrite`,
        ).toEqual(fixture.anchor)
      }

      for (const [index, fixture] of historicalFixtures.entries()) {
        const response = await apiRequest(
          request,
          'POST',
          `/api/documents/${encodeURIComponent(document.id)}/comments`,
          {
            token: author.token,
            data: {
              body: `TC-DOCUMENTS-015 rejected ${stamp} ${index}`,
              anchor: fixture.anchor,
              parentCommentId: null,
            },
          },
        )
        expect(response.status(), 'new writes must reject historical anchor shapes').toBe(400)
      }

      const selectedTextWrite = await apiRequest(
        request,
        'POST',
        `/api/documents/${encodeURIComponent(document.id)}/comments`,
        {
          token: author.token,
          data: {
            body: `TC-DOCUMENTS-015 rejected selected text ${stamp}`,
            anchor: {
              version: 2,
              relativeFrom: 'AQIDBA==',
              relativeTo: 'AQIDBA==',
              quote: legacyText,
            },
            parentCommentId: null,
          },
        },
      )
      expect(selectedTextWrite.status(), 'new v2 anchors must reject duplicated selected text').toBe(400)

      context = await authenticatedContext(browser, author)
      const page = await openDocumentPage(context, document.id, legacyText)

      await expect(page.getByText('Referenced text changed', { exact: true })).toHaveCount(3)
      await expect(page.getByText('LEGACY_OPAQUE_SENTINEL', { exact: false })).toHaveCount(0)

      await page.getByText(legacyBody, { exact: true }).click()
      await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
        .toBe('Legacy')

      const textarea = page.getByPlaceholder('Write a comment…').first()
      await page.getByRole('button', { name: 'Mention', exact: true }).click()
      const mentionSearch = page.getByRole('combobox', { name: 'Search people…' })
      await mentionSearch.fill(collaborator.email)
      await expect(page.getByRole('option').filter({ hasText: collaborator.name })).toBeVisible()
      await mentionSearch.press('Enter')
      await expect(textarea).toHaveValue(new RegExp(`@${collaborator.name}`))
      await textarea.press('End')
      await textarea.type('keyboard mention')
      const mentionComposer = textarea.locator('xpath=ancestor::form')
      await mentionComposer.getByRole('button', { name: 'Comment', exact: true }).click()
      await expect(page.getByText(`@${collaborator.name}`, { exact: false }).first()).toBeVisible()

      const readablePage = await visibleAndAccessibleText(page)
      expect(readablePage).not.toContain('LEGACY_OPAQUE_SENTINEL')
      expect(readablePage).not.toMatch(UUID_PATTERN)
    } finally {
      await context?.close().catch(() => undefined)
      await deleteCommentsForDocument({ documentId: document?.id ?? null, tenantId, organizationId })
        .catch(() => undefined)
      await deleteShareIfExists(request, adminToken, document?.id ?? null, share)
      await deleteDocumentIfExists(request, adminToken, document)
      await deleteUserIfExists(request, adminToken, collaborator?.id ?? null)
      await deleteUserIfExists(request, adminToken, author?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
      await collabSidecar?.stop()
    }
  })

  test('tracks the intended range through two-user edits and degrades safely after deletion and reconnect', async ({ browser, request }) => {
    test.slow()
    const stamp = Date.now()
    const before = 'Before '
    const target = 'TARGET'
    const after = ' After'
    const prefix = 'PREFIX '
    const inside = 'X'
    const suffix = ' SUFFIX'
    const initialText = `${before}${target}${after}`
    const movedTarget = `TAR${inside}GET`
    const editedText = `${prefix}${before}${movedTarget}${after}${suffix}`
    const deletedText = `${prefix}${before}${after}${suffix}`
    // The Yjs/editor model preserves the two spaces left at the deletion
    // boundary. REST contentText is the canonical plain-text projection used
    // by search/export and intentionally collapses adjacent HTML whitespace.
    const canonicalDeletedContentText = deletedText.replace(/\s+/g, ' ').trim()
    const commentBody = `TC-DOCUMENTS-015 relative anchor ${stamp}`

    let adminToken: string | null = null
    let roleId: string | null = null
    let author: TestUser | null = null
    let collaborator: TestUser | null = null
    let document: CreatedRecord | null = null
    let share: CreatedRecord | null = null
    let tenantId: string | null = null
    let organizationId: string | null = null
    let authorContext: BrowserContext | null = null
    let collaboratorContext: BrowserContext | null = null
    let reconnectContext: BrowserContext | null = null
    let collabSidecar: ManagedCollabSidecar | null = null

    try {
      // This test drives two live peers through the CRDT, so it owns its own
      // sidecar exactly like the anchor test above rather than depending on one
      // another spec happened to leave running.
      collabSidecar = await ensureManagedCollabSidecar(BASE_URL)
      adminToken = await getAuthToken(request, 'admin')
      const adminScope = getTokenScope(adminToken)
      tenantId = adminScope.tenantId
      organizationId = adminScope.organizationId
      roleId = await createRoleFixture(request, adminToken, {
        name: `TC-DOCUMENTS-015 realtime ${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: EDITOR_FEATURES,
        organizations: null,
      })
      author = await createTestUser(request, adminToken, {
        label: 'realtime-author', stamp, organizationId, roleId,
      })
      collaborator = await createTestUser(request, adminToken, {
        label: 'realtime-collaborator', stamp, organizationId, roleId,
      })
      document = await createDocument(
        request,
        author.token,
        `TC-DOCUMENTS-015 realtime ${stamp}`,
      )
      await putContent(request, author.token, document.id, initialText)
      share = await shareWithUser(request, author.token, document.id, collaborator.id)
      await requireLiveSidecar(request, author.token, document.id)

      authorContext = await authenticatedContext(browser, author)
      const authorPage = await openDocumentPage(
        authorContext,
        document.id,
        initialText,
        { requireLive: true },
      )
      collaboratorContext = await authenticatedContext(browser, collaborator)
      const collaboratorPage = await openDocumentPage(
        collaboratorContext,
        document.id,
        initialText,
        { requireLive: true },
      )

      await selectEditorRange(authorPage, before.length, target.length, target)
      await expectRemoteEditorSelection(collaboratorPage, target)
      await openAnchoredCommentComposer(authorPage)
      await submitCommentFromComposer(authorPage, commentBody)

      const anchoredComment = findCommentByBody(
        await listComments(request, author.token, document.id),
        commentBody,
      )
      expect(anchoredComment?.anchor).toMatchObject({ version: 2 })
      expect(Object.keys(anchoredComment?.anchor as Record<string, unknown>).sort()).toEqual([
        'relativeFrom',
        'relativeTo',
        'version',
      ])
      expect(JSON.stringify(anchoredComment?.anchor)).not.toContain(target)

      await authorPage.getByText(commentBody, { exact: true }).click()
      await expect.poll(() => authorPage.evaluate(() => window.getSelection()?.toString() ?? ''))
        .toBe(target)

      await selectEditorRange(collaboratorPage, 0, 0)
      await collaboratorPage.keyboard.type(prefix)
      await expectEditorText(authorPage, `${prefix}${initialText}`)

      await selectEditorRange(
        collaboratorPage,
        prefix.length + before.length + 3,
        0,
      )
      await collaboratorPage.keyboard.type(inside)
      await expectEditorText(authorPage, `${prefix}${before}${movedTarget}${after}`)

      const beforeSuffix = `${prefix}${before}${movedTarget}${after}`
      await selectEditorRange(collaboratorPage, beforeSuffix.length, 0)
      await collaboratorPage.keyboard.type(suffix)
      await expectEditorText(authorPage, editedText)

      await authorPage.getByText(commentBody, { exact: true }).click()
      await expect.poll(() => authorPage.evaluate(() => window.getSelection()?.toString() ?? ''))
        .toBe(movedTarget)

      await selectEditorRange(
        collaboratorPage,
        prefix.length + before.length,
        movedTarget.length,
        movedTarget,
      )
      await expectRemoteEditorSelection(authorPage, movedTarget)
      await collaboratorPage.keyboard.press('Backspace')
      await expectEditorText(authorPage, deletedText)

      await authorPage.getByText(commentBody, { exact: true }).click()
      await expect(authorPage.getByText('Referenced text changed', { exact: true }).last()).toBeVisible()

      const deletedTargetComment = findCommentByBody(
        await listComments(request, author.token, document.id),
        commentBody,
      )
      expect(deletedTargetComment?.anchor).toEqual(anchoredComment?.anchor)
      expect(JSON.stringify(deletedTargetComment?.anchor)).not.toContain(target)
      expect(JSON.stringify(deletedTargetComment?.anchor)).not.toContain(movedTarget)

      const persistedDocumentId = document.id
      const persistedAuthorToken = author.token

      await collaboratorContext.close()
      collaboratorContext = null
      await authorContext.close()
      authorContext = null

      await expect.poll(async () => {
        const response = await apiRequest(
          request,
          'GET',
          `/api/documents/${encodeURIComponent(persistedDocumentId)}/content`,
          { token: persistedAuthorToken },
        )
        const content = await readJsonSafe<ContentBody>(response)
        return content?.contentText ?? null
      }).toBe(canonicalDeletedContentText)

      reconnectContext = await authenticatedContext(browser, author)
      const reconnectPage = await openDocumentPage(
        reconnectContext,
        document.id,
        deletedText,
        { requireLive: true },
      )
      await reconnectPage.getByText(commentBody, { exact: true }).click()
      await expect(reconnectPage.getByText('Referenced text changed', { exact: true }).last()).toBeVisible()
      expect(await visibleAndAccessibleText(reconnectPage)).not.toMatch(UUID_PATTERN)
    } finally {
      await reconnectContext?.close().catch(() => undefined)
      await collaboratorContext?.close().catch(() => undefined)
      await authorContext?.close().catch(() => undefined)
      await deleteCommentsForDocument({ documentId: document?.id ?? null, tenantId, organizationId })
        .catch(() => undefined)
      await deleteShareIfExists(request, adminToken, document?.id ?? null, share)
      await deleteDocumentIfExists(request, adminToken, document)
      await deleteUserIfExists(request, adminToken, collaborator?.id ?? null)
      await deleteUserIfExists(request, adminToken, author?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
      await collabSidecar?.stop()
    }
  })
})
