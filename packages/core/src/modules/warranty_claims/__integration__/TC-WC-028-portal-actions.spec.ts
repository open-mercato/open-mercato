import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import {
  OPTIMISTIC_LOCK_HEADER,
  cancelThenDeleteClaimIfPossible,
  createClaimFixture,
  readClaim,
  readWarrantyClaimSettings,
  restoreWarrantyClaimSettings,
  saveWarrantyClaimSettings,
  transitionClaim,
  uniqueLabel,
} from './helpers'
import { CUSTOMER_VISIBLE_ATTACHMENT_TAG } from '../lib/attachmentVisibility'

type PortalActionResponse = {
  ok?: boolean
  claimId?: string
  status?: string
  error?: string
}

type PortalClaimDetail = {
  item?: {
    id?: string
    status?: string
  }
}

type PortalEvents = {
  items?: Array<{
    kind?: string
    payload?: Record<string, unknown> | null
    actorCustomerId?: string | null
  }>
}

function portalActionUrl(claimId: string, action: 'submit' | 'withdraw'): string {
  return `/api/warranty_claims/portal/claims/${encodeURIComponent(claimId)}/${action}`
}

test.describe('TC-WC-028: warranty claims portal submit and withdraw actions', () => {
  test('portal customers can submit their own drafts and withdraw pre-review claims only', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    const stamp = uniqueLabel('tc-wc-028')
    const settingsBefore = await readWarrantyClaimSettings(request, adminToken)

    let roleId: string | null = null
    let companyAId: string | null = null
    let companyBId: string | null = null
    let userAId: string | null = null
    let userBId: string | null = null
    let submitClaimId: string | null = null
    let withdrawDraftClaimId: string | null = null
    let inReviewClaimId: string | null = null
    let attachmentId: string | null = null

    try {
      await saveWarrantyClaimSettings(request, adminToken, {
        autoApproveEnabled: false,
        autoApproveMaxAmount: null,
        autoApproveCurrencyCode: null,
        autoApproveRequireInWarranty: true,
      }, settingsBefore.updatedAt)

      const anonymousSubmit = await request.post(portalActionUrl(randomUUID(), 'submit'))
      expect(anonymousSubmit.status(), 'portal submit should require customer auth').toBe(401)
      const anonymousWithdraw = await request.post(portalActionUrl(randomUUID(), 'withdraw'))
      expect(anonymousWithdraw.status(), 'portal withdraw should require customer auth').toBe(401)

      roleId = (await createCustomerRoleFixture(request, adminToken, {
        features: ['portal.account.manage'],
      })).id
      companyAId = await createCustomerCompanyFixture(request, adminToken, `QA WC Actions A ${stamp}`)
      companyBId = await createCustomerCompanyFixture(request, adminToken, `QA WC Actions B ${stamp}`)
      const userA = await createCustomerUserFixture(request, adminToken, {
        roleIds: [roleId],
        customerEntityId: companyAId,
        displayName: `QA WC Actions User A ${stamp}`,
      })
      userAId = userA.id
      const userB = await createCustomerUserFixture(request, adminToken, {
        roleIds: [roleId],
        customerEntityId: companyBId,
        displayName: `QA WC Actions User B ${stamp}`,
      })
      userBId = userB.id

      const sessionA = await portalLogin(request, { email: userA.email, password: userA.password, tenantId })
      const sessionB = await portalLogin(request, { email: userB.email, password: userB.password, tenantId })

      const submitDraft = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerId: companyAId,
        reasonCode: 'defective',
        lines: [
          {
            lineNo: 1,
            sku: `WC-028-SUBMIT-${stamp}`,
            faultDescription: 'Portal submit action target',
            qtyClaimed: 1,
          },
        ],
      })
      submitClaimId = submitDraft.id
      expect(submitDraft.status, 'staff-created claim should start as draft').toBe('draft')

      const crossCustomerSubmit = await request.post(portalActionUrl(submitClaimId!, 'submit'), {
        headers: portalCookieHeaders(sessionB),
      })
      expect(crossCustomerSubmit.status(), 'customer B must not submit customer A draft').toBe(404)

      const submitResponse = await request.post(portalActionUrl(submitClaimId!, 'submit'), {
        headers: portalCookieHeaders(sessionA),
      })
      expect(submitResponse.status(), 'customer A should submit own draft').toBe(200)
      const submitBody = await readJsonSafe<PortalActionResponse>(submitResponse)
      expect(submitBody?.ok).toBe(true)
      expect(submitBody?.status, 'portal submit should land on submitted with auto-approve disabled').toBe('submitted')

      const staffView = await readClaim(request, adminToken, submitClaimId!)
      expect(staffView.status).toBe('submitted')
      expect(staffView.submittedAt, 'portal submit should stamp submittedAt').toBeTruthy()

      const detailAfterSubmit = await request.get(`/api/warranty_claims/portal/claims/${submitClaimId}`, {
        headers: portalCookieHeaders(sessionA),
      })
      expect(detailAfterSubmit.status()).toBe(200)
      const detailBody = await readJsonSafe<PortalClaimDetail>(detailAfterSubmit)
      expect(detailBody?.item?.status).toBe('submitted')

      const eventsAfterSubmit = await request.get(
        `/api/warranty_claims/portal/events?claimId=${encodeURIComponent(submitClaimId!)}`,
        { headers: portalCookieHeaders(sessionA) },
      )
      expect(eventsAfterSubmit.status(), 'customer A should read own claim timeline').toBe(200)
      const submitEvents = await readJsonSafe<PortalEvents>(eventsAfterSubmit)
      const submittedEvent = (submitEvents?.items ?? []).find(
        (item) => item.kind === 'status_changed' && item.payload?.from === 'draft' && item.payload?.to === 'submitted',
      )
      expect(submittedEvent, 'timeline should show the draft -> submitted event to the customer').toBeTruthy()
      expect(submittedEvent?.actorCustomerId, 'portal submit should be attributed to the customer').toBe(companyAId)

      const resubmit = await request.post(portalActionUrl(submitClaimId!, 'submit'), {
        headers: portalCookieHeaders(sessionA),
      })
      expect(resubmit.status(), 'submitting a non-draft claim should return 400').toBe(400)

      const crossCustomerWithdraw = await request.post(portalActionUrl(submitClaimId!, 'withdraw'), {
        headers: portalCookieHeaders(sessionB),
      })
      expect(crossCustomerWithdraw.status(), 'customer B must not withdraw customer A claim').toBe(404)

      const staleWithdraw = await request.post(portalActionUrl(submitClaimId!, 'withdraw'), {
        headers: portalCookieHeaders(sessionA, { [OPTIMISTIC_LOCK_HEADER]: '2000-01-01T00:00:00.000Z' }),
      })
      expect(staleWithdraw.status(), 'a stale optimistic-lock token should be rejected with 409').toBe(409)

      const withdrawSubmitted = await request.post(portalActionUrl(submitClaimId!, 'withdraw'), {
        headers: portalCookieHeaders(sessionA),
      })
      expect(withdrawSubmitted.status(), 'customer A should withdraw own submitted claim').toBe(200)
      const withdrawSubmittedBody = await readJsonSafe<PortalActionResponse>(withdrawSubmitted)
      expect(withdrawSubmittedBody?.status).toBe('cancelled')
      const cancelledView = await readClaim(request, adminToken, submitClaimId!)
      expect(cancelledView.status).toBe('cancelled')

      const eventsAfterWithdraw = await request.get(
        `/api/warranty_claims/portal/events?claimId=${encodeURIComponent(submitClaimId!)}`,
        { headers: portalCookieHeaders(sessionA) },
      )
      const withdrawEvents = await readJsonSafe<PortalEvents>(eventsAfterWithdraw)
      const cancelledEvent = (withdrawEvents?.items ?? []).find(
        (item) => item.kind === 'status_changed' && item.payload?.to === 'cancelled',
      )
      expect(cancelledEvent, 'timeline should show the cancellation to the customer').toBeTruthy()
      expect(cancelledEvent?.actorCustomerId, 'portal withdraw should be attributed to the customer').toBe(companyAId)

      const withdrawDraft = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerId: companyAId,
        reasonCode: 'defective',
        lines: [
          {
            lineNo: 1,
            sku: `WC-028-DRAFT-${stamp}`,
            faultDescription: 'Portal withdraw-from-draft target',
            qtyClaimed: 1,
          },
        ],
      })
      withdrawDraftClaimId = withdrawDraft.id
      const withdrawFromDraft = await request.post(portalActionUrl(withdrawDraftClaimId!, 'withdraw'), {
        headers: portalCookieHeaders(sessionA),
      })
      expect(withdrawFromDraft.status(), 'customer A should withdraw own draft claim').toBe(200)
      const draftCancelledView = await readClaim(request, adminToken, withdrawDraftClaimId!)
      expect(draftCancelledView.status).toBe('cancelled')

      const intakeCreate = await request.post('/api/warranty_claims/portal/claims', {
        headers: portalCookieHeaders(sessionA, { 'Content-Type': 'application/json' }),
        data: {
          reasonCode: 'defective',
          lines: [
            {
              sku: `WC-028-REVIEW-${stamp}`,
              faultDescription: 'Portal claim moved to review',
              qtyClaimed: 1,
            },
          ],
        },
      })
      expect(intakeCreate.status(), 'portal intake should create and submit a claim').toBe(201)
      inReviewClaimId = (await readJsonSafe<{ claimId?: string }>(intakeCreate))?.claimId ?? null
      expect(inReviewClaimId, 'portal intake should return claimId').toBeTruthy()

      const attachmentName = `wc-028-${stamp}.txt`
      const intakeUpload = await request.fetch('/api/warranty_claims/portal/attachments', {
        method: 'POST',
        headers: portalCookieHeaders(sessionA),
        multipart: {
          claimId: inReviewClaimId!,
          file: {
            name: attachmentName,
            mimeType: 'text/plain',
            buffer: Buffer.from(`intake staged attachment ${stamp}`, 'utf8'),
          },
        },
      })
      expect(intakeUpload.status(), 'attachment staged at intake should upload onto the created claim').toBe(200)
      attachmentId = (await readJsonSafe<{ item?: { id?: string } }>(intakeUpload))?.item?.id ?? null
      expect(attachmentId, 'intake attachment upload should return item.id').toBeTruthy()
      const intakeAttachments = await request.get(
        `/api/warranty_claims/portal/attachments?claimId=${encodeURIComponent(inReviewClaimId!)}`,
        { headers: portalCookieHeaders(sessionA) },
      )
      expect(intakeAttachments.status()).toBe(200)
      const intakeAttachmentsBody = await readJsonSafe<{ items?: Array<{ id?: string; fileName?: string }> }>(intakeAttachments)
      expect(
        intakeAttachmentsBody?.items?.some((item) => item.id === attachmentId && item.fileName === attachmentName),
        'intake attachment should be listed on the created claim',
      ).toBe(true)

      const staffClaim = await readClaim(request, adminToken, inReviewClaimId!)
      const toReview = await transitionClaim(
        request,
        adminToken,
        { id: inReviewClaimId!, toStatus: 'in_review' },
        staffClaim.updatedAt,
      )
      expect(toReview.status(), 'staff should move the claim to in_review').toBe(200)

      const withdrawInReview = await request.post(portalActionUrl(inReviewClaimId!, 'withdraw'), {
        headers: portalCookieHeaders(sessionA),
      })
      expect(withdrawInReview.status(), 'withdraw must be rejected once staff owns the claim').toBe(400)
      const stillInReview = await readClaim(request, adminToken, inReviewClaimId!)
      expect(stillInReview.status, 'rejected withdraw must not change the status').toBe('in_review')

      const submitInReview = await request.post(portalActionUrl(inReviewClaimId!, 'submit'), {
        headers: portalCookieHeaders(sessionA),
      })
      expect(submitInReview.status(), 'submit must be rejected for non-draft claims').toBe(400)
    } finally {
      await restoreWarrantyClaimSettings(request, adminToken, settingsBefore)
      await deleteAttachmentIfExists(request, adminToken, attachmentId)
      await cancelThenDeleteClaimIfPossible(request, adminToken, inReviewClaimId)
      await cancelThenDeleteClaimIfPossible(request, adminToken, withdrawDraftClaimId)
      await cancelThenDeleteClaimIfPossible(request, adminToken, submitClaimId)
      await deleteCustomerUserFixture(request, adminToken, userBId)
      await deleteCustomerUserFixture(request, adminToken, userAId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
      await deleteCustomerCompanyFixture(request, adminToken, companyBId)
      await deleteCustomerCompanyFixture(request, adminToken, companyAId)
    }
  })

  test('rejects oversize and executable portal attachment uploads server-side', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    const stamp = uniqueLabel('tc-wc-028-reject')

    let roleId: string | null = null
    let companyId: string | null = null
    let userId: string | null = null
    let claimId: string | null = null

    try {
      roleId = (await createCustomerRoleFixture(request, adminToken, {
        features: ['portal.account.manage'],
      })).id
      companyId = await createCustomerCompanyFixture(request, adminToken, `QA WC Reject Uploads ${stamp}`)
      const user = await createCustomerUserFixture(request, adminToken, {
        roleIds: [roleId],
        customerEntityId: companyId,
        displayName: `QA WC Reject Uploads User ${stamp}`,
      })
      userId = user.id
      const session = await portalLogin(request, { email: user.email, password: user.password, tenantId })

      const claim = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerId: companyId,
        reasonCode: 'defective',
        lines: [
          {
            lineNo: 1,
            sku: `WC-028-REJECT-${stamp}`,
            faultDescription: 'Portal upload rejection target',
            qtyClaimed: 1,
          },
        ],
      })
      claimId = claim.id

      const executableUpload = await request.fetch('/api/warranty_claims/portal/attachments', {
        method: 'POST',
        headers: portalCookieHeaders(session),
        multipart: {
          claimId: claimId!,
          file: {
            name: `wc-028-${stamp}.exe`,
            mimeType: 'application/octet-stream',
            buffer: Buffer.from('MZ fake executable payload', 'utf8'),
          },
        },
      })
      expect(executableUpload.status(), 'executable filenames should be rejected with 400').toBe(400)
      const executableBody = await readJsonSafe<{ ok?: boolean; error?: string }>(executableUpload)
      expect(executableBody?.ok).toBe(false)
      expect(executableBody?.error, 'executable rejection should explain the block').toContain('Executable file types')

      // 27MB clears both the 25MB per-file limit and the 26MB Content-Length allowance,
      // so a 413 is returned regardless of which guard fires first.
      const oversized = Buffer.alloc(27 * 1024 * 1024, 0x61)
      const oversizeUpload = await request.fetch('/api/warranty_claims/portal/attachments', {
        method: 'POST',
        headers: portalCookieHeaders(session),
        multipart: {
          claimId: claimId!,
          file: {
            name: `wc-028-${stamp}.bin`,
            mimeType: 'application/octet-stream',
            buffer: oversized,
          },
        },
      })
      expect(oversizeUpload.status(), 'oversize uploads should be rejected with 413').toBe(413)
      const oversizeBody = await readJsonSafe<{ ok?: boolean; error?: string }>(oversizeUpload)
      expect(oversizeBody?.ok).toBe(false)
      expect(oversizeBody?.error, 'oversize rejection should explain the block').toContain('exceeds the maximum upload size')

      const listAfterRejects = await request.get(
        `/api/warranty_claims/portal/attachments?claimId=${encodeURIComponent(claimId!)}`,
        { headers: portalCookieHeaders(session) },
      )
      expect(listAfterRejects.status()).toBe(200)
      const listBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(listAfterRejects)
      expect(listBody?.items ?? [], 'rejected uploads must not create attachments').toHaveLength(0)
    } finally {
      await cancelThenDeleteClaimIfPossible(request, adminToken, claimId)
      await deleteCustomerUserFixture(request, adminToken, userId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
      await deleteCustomerCompanyFixture(request, adminToken, companyId)
    }
  })

  test('portal attachment list and download only serve customer-visible attachments', async ({ request }) => {
    // Contract under test: portal uploads stamp the CUSTOMER_VISIBLE_ATTACHMENT_TAG
    // storageMetadata tag, and the portal list/download endpoints only serve
    // attachments carrying that tag.
    const CLAIM_ATTACHMENT_ENTITY_ID = 'warranty_claims:warranty_claim'

    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    const stamp = uniqueLabel('tc-wc-028-visibility')

    let roleId: string | null = null
    let companyId: string | null = null
    let userId: string | null = null
    let claimId: string | null = null
    let portalAttachmentId: string | null = null
    let staffAttachmentId: string | null = null

    try {
      roleId = (await createCustomerRoleFixture(request, adminToken, {
        features: ['portal.account.manage'],
      })).id
      companyId = await createCustomerCompanyFixture(request, adminToken, `QA WC Visibility ${stamp}`)
      const user = await createCustomerUserFixture(request, adminToken, {
        roleIds: [roleId],
        customerEntityId: companyId,
        displayName: `QA WC Visibility User ${stamp}`,
      })
      userId = user.id
      const session = await portalLogin(request, { email: user.email, password: user.password, tenantId })

      const claim = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerId: companyId,
        reasonCode: 'defective',
        lines: [
          {
            lineNo: 1,
            sku: `WC-028-VISIBILITY-${stamp}`,
            faultDescription: 'Portal visibility split target',
            qtyClaimed: 1,
          },
        ],
      })
      claimId = claim.id

      const portalUpload = await request.fetch('/api/warranty_claims/portal/attachments', {
        method: 'POST',
        headers: portalCookieHeaders(session),
        multipart: {
          claimId: claimId!,
          file: {
            name: `wc-028-customer-${stamp}.txt`,
            mimeType: 'text/plain',
            buffer: Buffer.from(`customer visible upload ${stamp}`, 'utf8'),
          },
        },
      })
      expect(portalUpload.status(), 'portal upload should succeed').toBe(200)
      const portalUploadBody = await readJsonSafe<{ item?: { id?: string; tags?: string[] } }>(portalUpload)
      portalAttachmentId = portalUploadBody?.item?.id ?? null
      expect(portalAttachmentId, 'portal upload should return item.id').toBeTruthy()
      expect(
        portalUploadBody?.item?.tags ?? [],
        'portal uploads should be stamped with the customer-visible tag',
      ).toContain(CUSTOMER_VISIBLE_ATTACHMENT_TAG)

      const staffAttachment = await uploadAttachmentFixture(request, adminToken, {
        entityId: CLAIM_ATTACHMENT_ENTITY_ID,
        recordId: claimId!,
        fileName: `wc-028-staff-${stamp}.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from(`internal staff note ${stamp}`, 'utf8'),
      })
      staffAttachmentId = staffAttachment.id
      expect(
        staffAttachment.tags,
        'the staff fixture must stay untagged for the visibility assertion to be meaningful',
      ).not.toContain(CUSTOMER_VISIBLE_ATTACHMENT_TAG)

      const portalList = await request.get(
        `/api/warranty_claims/portal/attachments?claimId=${encodeURIComponent(claimId!)}`,
        { headers: portalCookieHeaders(session) },
      )
      expect(portalList.status()).toBe(200)
      const portalListBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(portalList)
      const listedIds = (portalListBody?.items ?? []).map((item) => item.id)
      expect(listedIds, 'portal list should include the customer upload').toContain(portalAttachmentId)
      expect(listedIds, 'portal list must hide untagged staff attachments').not.toContain(staffAttachmentId)

      const staffDownload = await request.get(
        `/api/warranty_claims/portal/attachments?attachmentId=${encodeURIComponent(staffAttachmentId!)}`,
        { headers: portalCookieHeaders(session) },
      )
      expect(staffDownload.status(), 'portal download of an untagged staff attachment must 404').toBe(404)

      const ownDownload = await request.get(
        `/api/warranty_claims/portal/attachments?attachmentId=${encodeURIComponent(portalAttachmentId!)}`,
        { headers: portalCookieHeaders(session) },
      )
      expect(ownDownload.status(), 'the customer should still download their own upload').toBe(200)
    } finally {
      await deleteAttachmentIfExists(request, adminToken, staffAttachmentId)
      await deleteAttachmentIfExists(request, adminToken, portalAttachmentId)
      await cancelThenDeleteClaimIfPossible(request, adminToken, claimId)
      await deleteCustomerUserFixture(request, adminToken, userId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
      await deleteCustomerCompanyFixture(request, adminToken, companyId)
    }
  })
})
