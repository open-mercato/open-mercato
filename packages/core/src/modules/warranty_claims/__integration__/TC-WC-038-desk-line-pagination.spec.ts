import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { readJsonSafe as parseJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  createClaimFixture,
  readClaim,
  requestJson,
  submitAndExpect,
  transitionAndExpect,
  uniqueLabel,
  type ClaimLineItem,
  type PagedItems,
} from './helpers'

async function readLinePage(request: APIRequestContext, token: string, claimId: string, page: number) {
  const response = await requestJson(request, 'GET',
    `/api/warranty_claims/lines?claimId=${claimId}&page=${page}&pageSize=100&sortField=lineNo&sortDir=asc`, token)
  expect(response.status()).toBe(200)
  const payload = await readJsonSafe<PagedItems<ClaimLineItem>>(response)
  expect(payload).toBeTruthy()
  return payload!
}

async function cleanupClaim(request: APIRequestContext, token: string, claimId: string) {
  let claim = await readClaim(request, token, claimId)
  if (claim.status === 'received' || claim.status === 'inspecting') {
    const firstPage = await readLinePage(request, token, claimId, 1)
    const lines = [...(firstPage.items ?? [])]
    for (let page = 2; page <= (firstPage.totalPages ?? 1); page += 1) {
      lines.push(...((await readLinePage(request, token, claimId, page)).items ?? []))
    }
    for (const line of lines) {
      const response = await requestJson(request, 'DELETE', `/api/warranty_claims/lines?id=${line.id}`, token, undefined, line.updatedAt)
      expect(response.status(), 'cleanup should delete each fixture line').toBe(200)
    }
    if (claim.status === 'received') claim = await transitionAndExpect(request, token, claim, 'inspecting')
    claim = await transitionAndExpect(request, token, claim, 'resolved')
  }
  if (claim.status === 'resolved') claim = await transitionAndExpect(request, token, claim, 'closed')
  if (claim.status === 'closed') claim = await transitionAndExpect(request, token, claim, 'in_review')
  if (claim.status !== 'draft' && claim.status !== 'cancelled') {
    claim = await transitionAndExpect(request, token, claim, 'cancelled')
  }
  claim = await readClaim(request, token, claimId)
  const response = await requestJson(request, 'DELETE', `/api/warranty_claims?id=${claimId}`, token, undefined, claim.updatedAt)
  expect(response.status(), 'cleanup should delete the fixture claim').toBe(200)
}

test.describe('TC-WC-038: every accepted line is available in the claims desk', () => {
  for (const lineCount of [101, 200]) {
    test.describe(`${lineCount}-line claim`, () => {
      let token: string
      const stamp = uniqueLabel(`tc-wc-038-${lineCount}`)
      const productName = `${stamp} last line`
      let claimId: string | null = null
      let recoveryClaimId: string | null = null
      let lastLine: ClaimLineItem

      test.beforeAll(async ({ request }) => {
        token = await getAuthToken(request, 'admin')
        let claim = await createClaimFixture(request, token, {
          claimType: 'warranty',
          customerName: stamp,
          reasonCode: 'defective',
          currencyCode: 'USD',
          lines: Array.from({ length: lineCount }, (_, index) => ({
            lineNo: index + 1,
            productName: index === lineCount - 1 ? productName : `${stamp} part ${index + 1}`,
            qtyClaimed: 1,
            creditAmount: 10,
          })),
        })
        claimId = claim.id!
        const lastPage = await readLinePage(request, token, claimId, 2)
        const line = lastPage.items?.find((item) => item.lineNo === lineCount)
        expect(line?.id).toBeTruthy()
        lastLine = line!
        claim = await submitAndExpect(request, token, claim)
        for (const status of ['in_review', 'approved', 'awaiting_return', 'received']) {
          claim = await transitionAndExpect(request, token, claim, status)
        }
      })

      test.afterAll(async ({ request }) => {
        try {
          if (recoveryClaimId) await cleanupClaim(request, token, recoveryClaimId)
        } finally {
          if (claimId) await cleanupClaim(request, token, claimId)
        }
      })

      test(`inspects, receives and selects line ${lineCount} for recovery`, async ({ page, request }) => {
        expect(claimId).toBeTruthy()
        const sourceClaimId = claimId!
        await login(page, 'admin')
        await page.goto(`/backend/warranty_claims/${sourceClaimId}`)
        await expect(page.getByRole('row').filter({ hasText: productName })).toHaveCount(1)
        const receivingButton = page.getByRole('button', { name: 'Grade / Receive', exact: true }).nth(lineCount - 1)
        await expect(receivingButton).toBeVisible()
        await receivingButton.click()
        const receivingDialog = page.getByRole('dialog', { name: 'Grade received line' })
        await receivingDialog.getByLabel('Inspection notes').fill(stamp)
        const received = page.waitForResponse((response) =>
          response.url().endsWith('/api/warranty_claims/receiving') && response.request().method() === 'POST')
        await receivingDialog.getByRole('button', { name: 'Save', exact: true }).click()
        const receivedResponse = await received
        expect(receivedResponse.status()).toBe(200)
        expect(receivedResponse.request().postDataJSON()).toMatchObject({ lineId: lastLine.id })
        expect(receivedResponse.request().headers()['x-om-ext-optimistic-lock-expected-updated-at']).toBe(lastLine.updatedAt)
        await expect(receivingDialog).toBeHidden()

        let currentLine = (await readLinePage(request, token, sourceClaimId, 2)).items!.find((line) => line.id === lastLine.id)!
        for (const lineStatus of ['approved', 'resolved']) {
          const response = await requestJson(request, 'PUT', '/api/warranty_claims/lines', token, {
            id: currentLine.id, claimId: sourceClaimId, lineStatus, disposition: 'credit', qtyApproved: 1,
          }, currentLine.updatedAt)
          expect(response.status()).toBe(200)
          currentLine = (await readLinePage(request, token, sourceClaimId, 2)).items!.find((line) => line.id === lastLine.id)!
        }
        await page.reload()
        const actionsButton = page.getByRole('button', { name: 'Actions', exact: true })
        await actionsButton.focus()
        if (await actionsButton.getAttribute('aria-expanded') !== 'true') {
          await actionsButton.press('Enter')
        }
        const recoveryAction = page.getByRole('menuitem', { name: 'Create vendor recovery', exact: true })
        await expect(recoveryAction).toBeVisible()
        await recoveryAction.press('Enter')
        const recoveryDialog = page.getByRole('dialog', { name: 'Create vendor recovery' })
        await expect(recoveryDialog.getByRole('checkbox', { name: `Line ${lineCount} — ${productName}` })).toBeChecked()
        await recoveryDialog.locator('[data-crud-field-id="vendorName"]').getByRole('textbox').fill(`${stamp} vendor`)
        const recovered = page.waitForResponse((response) =>
          response.url().endsWith('/api/warranty_claims/vendor-recovery') && response.request().method() === 'POST')
        await recoveryDialog.getByRole('button', { name: 'Create vendor recovery', exact: true }).click()
        const recoveryResponse = await recovered
        const recoveryBody = await parseJsonSafe<{ claimId?: string }>(await recoveryResponse.text())
        recoveryClaimId = recoveryBody?.claimId ?? null
        expect(recoveryResponse.status()).toBe(200)
        expect(recoveryResponse.request().postDataJSON()).toMatchObject({ lineIds: [lastLine.id] })
        expect(recoveryClaimId).toBeTruthy()
      })
    })
  }
})
