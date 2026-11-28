import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Response } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

const teamsPath = '/backend/staff/teams'
const createPath = `${teamsPath}/create`
const codeLines = ['const first = 1', 'const second = 2']
const paragraph = 'Following paragraph survives.'

type DocumentProbe = { id: string; styleViolations: string[] }

async function documentNonce(response: Response | null): Promise<string> {
  expect(response?.status(), 'the team create document loads').toBe(200)
  const policy = await response?.headerValue('content-security-policy')
  const stylePolicy = policy?.split(';').map((directive) => directive.trim())
    .find((directive) => directive.startsWith('style-src '))
  expect(stylePolicy, 'run against the production style policy').not.toContain("'unsafe-inline'")
  const nonce = stylePolicy?.match(/'nonce-([^']+)'/)?.[1]
  if (!nonce) throw new Error('The enforcing stylesheet policy must include a document nonce')
  return nonce
}

async function expectActiveCodeMirrorStyles(editor: Locator, nonce: string) {
  const scroller = editor.locator('.cm-scroller')
  await expect(scroller).toHaveCSS('display', 'flex')
  await expect.poll(() => scroller.evaluate((element, expectedNonce) =>
    Array.from(element.ownerDocument.querySelectorAll('style')).some((style) => {
      const sheet = style.sheet
      return style.nonce === expectedNonce && sheet != null && !sheet.disabled
        && Array.from(sheet.cssRules).some((rule) =>
          rule instanceof CSSStyleRule && rule.style.display === 'flex' && element.matches(rule.selectorText))
    }), nonce), 'an active matching-nonce stylesheet supplies CodeMirror’s flex layout').toBe(true)
}

for (const width of [1440, 390]) {
  test(`TC-STAFF-8590: Markdown CodeMirror under production CSP at ${width}px`, async ({ page, request }) => {
    const admin = await getAuthToken(request, 'superadmin')
    const { organizationId, tenantId } = getTokenContext(await getAuthToken(request, 'admin'))
    const fixtureName = `qa-markdown-csp-${randomUUID()}`
    const email = `${fixtureName}@example.test`
    const password = `Markdown1!${randomUUID()}`
    let roleId: string | undefined
    let userId: string | undefined
    let loggedIn = false

    await page.setViewportSize({ width, height: 1000 })
    await page.addInitScript(() => {
      const probe: DocumentProbe = { id: crypto.randomUUID(), styleViolations: [] }
      Object.assign(window, { markdownCspProbe: probe })
      document.addEventListener('securitypolicyviolation', (event) => {
        if (event.effectiveDirective.startsWith('style-src')) {
          probe.styleViolations.push(`${event.effectiveDirective}: ${event.blockedURI}`)
        }
      })
    })

    const readProbe = () => page.evaluate(() => {
      const probe = (window as Window & { markdownCspProbe?: DocumentProbe }).markdownCspProbe
      if (!probe) throw new Error('The document CSP probe was not installed')
      return probe
    })
    const description = page.getByRole('group', { name: 'Description', exact: true })
    const sourceMode = description.getByRole('radio', { name: 'Source mode', exact: true })
    const richTextMode = description.getByRole('radio', { name: 'Rich text', exact: true })
    const sourceEditor = description.locator('.mdxeditor-source-editor .cm-editor')
    const richEditor = description.locator('.mdxeditor-rich-text-editor .cm-editor')
    const language = description.getByRole('combobox', { name: 'Language', exact: true })
    const javaScript = page.getByRole('option', { name: 'JavaScript', exact: true })
    const teamCreates: string[] = []

    page.on('request', (outgoing) => {
      if (outgoing.method() === 'POST' && new URL(outgoing.url()).pathname === '/api/staff/teams') {
        teamCreates.push(outgoing.url())
      }
    })

    try {
      roleId = await createRoleFixture(request, admin, { name: fixtureName, tenantId })
      await setRoleAclFeatures(request, admin, {
        roleId, features: ['staff.manage_team'], organizations: [organizationId],
      })
      userId = await createUserFixture(request, admin, { email, password, organizationId, roles: [roleId] })
      const login = await page.request.post('/api/auth/login', {
        form: { email, password, remember: 'on' },
      })
      expect(login.status(), 'owned staff user can sign in').toBe(200)
      loggedIn = true

      const nonce = await documentNonce(await page.goto(createPath))
      const { id: initialDocument } = await readProbe()
      await sourceMode.click()
      await expectActiveCodeMirrorStyles(sourceEditor, nonce)

      await page.getByRole('link', { name: /back/i }).and(page.locator(`a[href="${teamsPath}"]`)).click()
      await expect(page).toHaveURL(new RegExp(`${teamsPath}$`))
      await page.getByRole('link', { name: 'Add team', exact: true }).first().click()
      await expect(page).toHaveURL(new RegExp(`${createPath}$`))
      await sourceMode.click()
      await expectActiveCodeMirrorStyles(sourceEditor, nonce)
      expect(await readProbe()).toEqual({ id: initialDocument, styleViolations: [] })

      const reloadedNonce = await documentNonce(await page.reload())
      expect(reloadedNonce).not.toBe(nonce)
      await sourceMode.click()
      await expectActiveCodeMirrorStyles(sourceEditor, reloadedNonce)
      const reloadedDocument = await readProbe()
      expect(reloadedDocument.id).not.toBe(initialDocument)
      expect(reloadedDocument.styleViolations).toEqual([])

      await sourceEditor.locator('.cm-content').fill(['```typescript', ...codeLines, '```', '', paragraph].join('\n'))
      await richTextMode.click()

      await expect(richEditor.locator('.cm-line')).toHaveText(codeLines)
      await expectActiveCodeMirrorStyles(richEditor, reloadedNonce)
      await expect.poll(() => richEditor.evaluate((editor) => {
        const lines = Array.from(editor.querySelectorAll('.cm-content .cm-line'))
        return Array.from(editor.querySelectorAll('.cm-lineNumbers .cm-gutterElement'))
          .filter((gutter) => ['1', '2'].includes(gutter.textContent?.trim() ?? ''))
          .map((gutter, index) => {
            const line = lines[index]
            return {
              number: gutter.textContent?.trim(),
              aligned: line != null
                && Math.abs(gutter.getBoundingClientRect().top - line.getBoundingClientRect().top) <= 1,
            }
          })
      }), 'each gutter number aligns with its code line').toEqual([
        { number: '1', aligned: true },
        { number: '2', aligned: true },
      ])

      expect((await readProbe()).styleViolations).toEqual([])

      await language.click()
      await expect(javaScript).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(javaScript).toBeHidden()
      await expect(language).toHaveText('typescript')
      await language.click()
      await javaScript.click()
      await expect(language).toHaveText('JavaScript')
      await expect(richEditor.locator('.cm-content')).toHaveAttribute('data-language', 'javascript')
      await expect(richEditor.locator('.cm-line')).toHaveText(codeLines)

      const { styleViolations: violationsAfterLanguageMenu } = await readProbe()
      await sourceMode.click()
      await expectActiveCodeMirrorStyles(sourceEditor, reloadedNonce)
      await richTextMode.click()
      await description.getByRole('button', { name: 'Delete code block', exact: true }).click()
      await expect(richEditor).toHaveCount(0)
      await expect(description.getByText(paragraph, { exact: true })).toBeVisible()

      expect((await readProbe()).styleViolations, 'editor mode changes and deletion add no CSP violations')
        .toEqual(violationsAfterLanguageMenu)
      expect(teamCreates).toEqual([])
    } finally {
      try {
        if (loggedIn) {
          const logout = await page.request.post('/api/auth/logout', { maxRedirects: 0 })
          expect(logout.status(), 'owned session logs out').toBe(303)
        }
      } finally {
        try {
          if (userId) {
            const removed = await apiRequest(request, 'DELETE', `/api/auth/users?id=${userId}`, { token: admin })
            expect(removed.ok(), 'owned user cleanup succeeds').toBe(true)
          }
        } finally {
          if (roleId) {
            const removed = await apiRequest(request, 'DELETE', `/api/auth/roles?id=${roleId}`, { token: admin })
            expect(removed.ok(), 'owned role cleanup succeeds').toBe(true)
          }
        }
      }
    }
  })
}
