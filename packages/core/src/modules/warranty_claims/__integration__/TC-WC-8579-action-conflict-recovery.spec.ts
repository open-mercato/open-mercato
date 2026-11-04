import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type APIResponse, type Page, type Request, type Response, type Route } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import { test, type RecoveryAction, type RecoveryFixture } from './helpers/actionConflictFixtures'
import {
  OPTIMISTIC_LOCK_HEADER,
  readClaim,
  readClaimLine,
  receiveClaimLine,
  requestJson,
  updateClaim,
  updateClaimLine,
} from './helpers'

type FlashEntry = { message: string; type: string }
type ObservedWindow = typeof window & { warrantyConflictFlashes: FlashEntry[] }

function actionPath(action: RecoveryAction) {
  return `/api/warranty_claims/${action === 'label' ? 'return-label' : 'receiving'}`
}

function actionButton(page: Page, action: RecoveryAction) {
  const name = action === 'label' ? 'Generate return label' : action === 'release' ? 'Release' : 'Grade / Receive'
  return page.getByRole('button', { name, exact: true })
}

function isActionResponse(response: Response, action: RecoveryAction) {
  return new URL(response.url()).pathname === actionPath(action) && response.request().method() === 'POST'
}

async function openClaim(page: Page, recovery: RecoveryFixture, action: RecoveryAction) {
  await acknowledgeGlobalNotices(page)
  await getAuthToken(page.request, recovery.email, recovery.password)
  await page.goto(`/backend/warranty_claims/${recovery.claim.id}`)
  await expect(actionButton(page, action)).toBeEnabled()
  await page.evaluate(() => {
    const observed = window as ObservedWindow
    observed.warrantyConflictFlashes = []
    window.addEventListener('flash', (event) => {
      observed.warrantyConflictFlashes.push((event as CustomEvent<FlashEntry>).detail)
    })
  })
}

function readFlashes(page: Page) {
  return page.evaluate(() => (window as ObservedWindow).warrantyConflictFlashes)
}

async function prepareAction(page: Page, action: RecoveryAction, notes?: string) {
  if (action !== 'grading') return
  await actionButton(page, action).click()
  await expect(page.getByRole('dialog', { name: 'Grade received line' })).toBeVisible()
  if (notes) await page.getByRole('textbox', { name: 'Inspection notes', exact: true }).fill(notes)
}

function submitAction(page: Page, action: RecoveryAction) {
  return action === 'grading'
    ? page.getByRole('dialog', { name: 'Grade received line' }).getByRole('button', { name: 'Save', exact: true }).click()
    : actionButton(page, action).click()
}

function expectRequestVersion(request: Request, recovery: RecoveryFixture, action: RecoveryAction, updatedAt: string | null) {
  expect(updatedAt).toBeTruthy()
  expect(request.headers()[OPTIMISTIC_LOCK_HEADER]).toBe(updatedAt)
  const body: unknown = request.postDataJSON()
  expect(body).toMatchObject(action === 'label'
    ? { claimId: recovery.claim.id, updatedAt }
    : { lineId: recovery.line.id, updatedAt })
  if (action === 'release') expect(body).toMatchObject({ action: 'release' })
}

async function concurrentEdit(request: APIRequestContext, recovery: RecoveryFixture, action: RecoveryAction) {
  const notes = `Concurrent inspection ${randomUUID()}`
  const label = {
    labelUrl: `https://labels.test.invalid/${recovery.claim.id}.pdf`,
    trackingNumber: `TRACK-${recovery.claim.id}`,
    carrier: `Carrier ${recovery.claim.id}`,
  }
  let mutation: APIResponse
  if (action === 'label') {
    mutation = await requestJson(request, 'POST', actionPath(action), recovery.writerToken, {
      claimId: recovery.claim.id, manual: true, ...label, updatedAt: recovery.claim.updatedAt,
    }, recovery.claim.updatedAt)
  } else if (action === 'grading') {
    mutation = await receiveClaimLine(request, recovery.writerToken, {
      lineId: recovery.line.id, conditionGrade: 'B', inspectionNotes: notes, updatedAt: recovery.line.updatedAt,
    })
  } else {
    mutation = await updateClaimLine(request, recovery.writerToken, {
      id: recovery.line.id, claimId: recovery.claim.id, inspectionNotes: notes,
    }, recovery.line.updatedAt)
  }
  expect(mutation.status(), await mutation.text()).toBe(200)
  if (action !== 'label') {
    const current = await readClaim(request, recovery.writerToken, recovery.claim.id)
    const parentUpdate = await updateClaim(request, recovery.writerToken, {
      id: recovery.claim.id, vendorRef: `Concurrent parent ${randomUUID()}`,
    }, current.updatedAt)
    expect(parentUpdate.status(), await parentUpdate.text()).toBe(200)
  }
  const [claim, line] = await Promise.all([
    readClaim(request, recovery.writerToken, recovery.claim.id),
    readClaimLine(request, recovery.writerToken, recovery.claim.id, recovery.line.id),
  ])
  expect(claim.updatedAt).not.toBe(recovery.claim.updatedAt)
  expect(claim.updatedAt).toBeTruthy()
  expect(line.updatedAt).toBeTruthy()
  expect(line.updatedAt, 'the retry must distinguish line and parent versions').not.toBe(claim.updatedAt)
  if (action !== 'label') expect(line.updatedAt).not.toBe(recovery.line.updatedAt)
  return { claim, line, notes, label }
}

const recoveryCases = [
  { action: 'grading', variant: 'stale' },
  { action: 'label', variant: 'stale' },
  { action: 'release', variant: 'stale' },
  { action: 'grading', variant: 'enterprise fallback' },
  { action: 'label', variant: 'enterprise fallback' },
] as const

for (const { action, variant } of recoveryCases) {
  test.describe(`TC-WC-8579: ${action} ${variant}`, () => {
    test.use({ recoveryAction: action })

    test('409 → one reachable Refresh → retry 200 with the refreshed record version', async ({ page, request, recovery }) => {
      await openClaim(page, recovery, action)
      await prepareAction(page, action, 'Unsaved stale browser inspection')
      const statuses: number[] = []
      page.on('response', (response) => {
        if (isActionResponse(response, action)) statuses.push(response.status())
      })
      let captureRoute: (route: Route) => void = () => undefined
      const heldRequest = new Promise<Route>((resolve) => { captureRoute = resolve })
      await page.route(`**${actionPath(action)}`, captureRoute, { times: 1 })
      let fresh: Awaited<ReturnType<typeof concurrentEdit>> | undefined
      const [conflict] = await Promise.all([
        page.waitForResponse((response) => isActionResponse(response, action)),
        (async () => {
          await submitAction(page, action)
          const route = await heldRequest
          expectRequestVersion(route.request(), recovery, action, action === 'label' ? recovery.claim.updatedAt : recovery.line.updatedAt)
          try {
            fresh = await concurrentEdit(request, recovery, action)
          } finally {
            if (variant === 'stale') {
              await route.continue()
            } else {
              await route.fulfill({ status: 409, json: {
                error: 'Record conflict detected', code: 'record_lock_conflict',
                lock: {
                  resourceKind: action === 'label' ? 'warranty_claims.claim' : 'warranty_claims.claim_line',
                  resourceId: action === 'label' ? recovery.claim.id : recovery.line.id,
                  token: randomUUID(),
                },
                conflict: { id: randomUUID(), baseActionLogId: randomUUID(), incomingActionLogId: randomUUID() },
              } })
            }
          }
        })(),
      ])
      expect(conflict.status()).toBe(409)
      expect(fresh).toBeDefined()
      const current = fresh!
      const expectedVersion = action === 'label' ? current.claim.updatedAt : current.line.updatedAt
      expect(await conflict.json()).toMatchObject(variant === 'stale'
        ? {
          code: 'optimistic_lock_conflict', currentUpdatedAt: expectedVersion,
          expectedUpdatedAt: action === 'label' ? recovery.claim.updatedAt : recovery.line.updatedAt,
        }
        : { code: 'record_lock_conflict' })
      const banner = page.getByRole('alert').filter({ hasText: 'Record changed' })
      await expect(banner).toHaveCount(1)
      await expect(banner).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(1)
      await expect(actionButton(page, action)).toBeEnabled()
      expect(await readFlashes(page), 'a conflict must not emit success or generic error feedback').toEqual([])
      expect(await readClaimLine(request, recovery.writerToken, recovery.claim.id, recovery.line.id)).toMatchObject({
        updatedAt: current.line.updatedAt, conditionGrade: current.line.conditionGrade,
        quarantineStatus: current.line.quarantineStatus, inspectionNotes: current.line.inspectionNotes,
      })
      expect((await readClaim(request, recovery.writerToken, recovery.claim.id)).updatedAt).toBe(current.claim.updatedAt)
      const refresh = banner.getByRole('button', { name: 'Refresh', exact: true })
      await refresh.click({ trial: true })
      await refresh.focus()
      await expect(refresh).toBeFocused()
      const [claimsRead, linesRead] = await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === '/api/warranty_claims'
          && new URL(response.url()).searchParams.get('ids') === recovery.claim.id && response.request().method() === 'GET'),
        page.waitForResponse((response) => new URL(response.url()).pathname === '/api/warranty_claims/lines'
          && new URL(response.url()).searchParams.get('claimId') === recovery.claim.id && response.request().method() === 'GET'),
        refresh.press('Enter'),
      ])
      expect(claimsRead.status()).toBe(200)
      expect(linesRead.status()).toBe(200)
      expect(await claimsRead.json()).toMatchObject({ items: expect.arrayContaining([
        expect.objectContaining({ id: recovery.claim.id, updatedAt: current.claim.updatedAt }),
      ]) })
      expect(await linesRead.json()).toMatchObject({ items: expect.arrayContaining([
        expect.objectContaining({ id: recovery.line.id, updatedAt: current.line.updatedAt }),
      ]) })
      await expect(banner).toHaveCount(0)
      await expect(actionButton(page, action)).toBeEnabled()
      await prepareAction(page, action)
      if (action === 'grading') {
        await expect(page.getByRole('combobox', { name: 'Condition grade', exact: true })).toHaveText('Grade B')
        await expect(page.getByRole('textbox', { name: 'Inspection notes', exact: true })).toHaveValue(current.notes)
      }
      const [retry] = await Promise.all([
        page.waitForResponse((response) => isActionResponse(response, action)),
        submitAction(page, action),
      ])
      expect(retry.status()).toBe(200)
      expectRequestVersion(retry.request(), recovery, action, expectedVersion)
      if (action === 'label') {
        expect(await retry.json()).toEqual({ status: 'notConfigured' })
        await expect(page.getByRole('button', { name: 'Save return label', exact: true })).toBeVisible()
        await expect(page.getByRole('textbox', { name: 'Tracking number', exact: true })).toHaveValue(current.label.trackingNumber)
        await expect(page.getByRole('link', { name: 'Open label', exact: true })).toHaveAttribute('href', current.label.labelUrl)
        expect(await readClaim(request, recovery.writerToken, recovery.claim.id)).toMatchObject({
          returnLabelUrl: current.label.labelUrl, returnTrackingNumber: current.label.trackingNumber,
          returnCarrier: current.label.carrier, updatedAt: current.claim.updatedAt,
        })
        expect(await readFlashes(page)).toEqual([{
          type: 'info', message: 'No return label provider is configured. Enter label details manually.',
        }])
      } else {
        const success = action === 'grading' ? 'Receiving details saved.' : 'Line released from quarantine.'
        await expect(page.getByText(success, { exact: true })).toBeVisible()
        await expect(page.getByRole('dialog')).toHaveCount(0)
        const saved = await readClaimLine(request, recovery.writerToken, recovery.claim.id, recovery.line.id)
        expect(saved.updatedAt).not.toBe(current.line.updatedAt)
        expect(saved).toMatchObject({
          conditionGrade: action === 'grading' ? 'B' : 'D',
          quarantineStatus: action === 'grading' ? 'none' : 'released', inspectionNotes: current.notes,
        })
        if (action === 'release') await expect(actionButton(page, action)).toHaveCount(0)
        expect(await readFlashes(page)).toEqual([{ type: 'success', message: success }])
      }
      await expect(banner).toHaveCount(0)
      expect(statuses).toEqual([409, 200])
    })
  })
}

for (const action of ['release', 'label'] as const) {
  test.describe(`TC-WC-8579: ${action} ordinary error`, () => {
    test.use({ recoveryAction: action })

    test('422 retains ordinary error feedback without a conflict or false success', async ({ page, request, recovery }) => {
      await openClaim(page, recovery, action)
      await page.route(`**${actionPath(action)}`, (route) => route.fulfill({
        status: 422, json: { error: 'warranty_claims.errors.invalidInput' },
      }), { times: 1 })
      const [response] = await Promise.all([
        page.waitForResponse((candidate) => isActionResponse(candidate, action)),
        submitAction(page, action),
      ])
      expect(response.status()).toBe(422)
      await expect(page.getByText('Invalid input', { exact: true }).first()).toBeVisible()
      await expect(actionButton(page, action)).toBeEnabled()
      await expect(page.getByRole('alert').filter({ hasText: 'Record changed' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(0)
      expect(await readFlashes(page)).toEqual([{ type: 'error', message: 'Invalid input' }])
      expect((await readClaim(request, recovery.writerToken, recovery.claim.id)).updatedAt).toBe(recovery.claim.updatedAt)
      expect((await readClaimLine(request, recovery.writerToken, recovery.claim.id, recovery.line.id)).updatedAt).toBe(recovery.line.updatedAt)
    })
  })
}
