import { expect, type APIRequestContext, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { extractOperation, undoByToken } from '@open-mercato/core/helpers/integration/undoHarness'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const ARCHIVED_READ_ONLY_MESSAGE = 'Archived documents are read-only.'

export const integrationMeta = {
  dependsOnModules: ['documents', 'audit_logs'],
}

type Mutation = {
  id?: string
  archivedAt?: string | null
  updatedAt?: string
}

type DocumentDetail = Mutation & {
  capabilities?: {
    canArchive?: boolean
    canEdit?: boolean
  }
}

type DocumentList = {
  items?: Mutation[]
}

type ErrorBody = {
  error?: string
}

type TestUser = {
  id: string
  roleId: string
  token: string
}

const PASSWORD = 'DocsArchive1!Pass'

async function createDocument(request: APIRequestContext, token: string, title: string) {
  const response = await apiRequest(request, 'POST', '/api/documents', {
    token,
    data: { title, folderId: null },
  })
  const body = await readJsonSafe<Mutation>(response)
  expect(response.status()).toBe(201)
  return {
    id: expectId(body?.id, 'document id'),
    updatedAt: expectId(body?.updatedAt, 'document updatedAt'),
  }
}

async function createEditor(
  request: APIRequestContext,
  adminToken: string,
  input: { stamp: number; organizationId: string },
): Promise<TestUser> {
  const roleId = await createRoleFixture(request, adminToken, {
    name: `TC-DOCUMENTS-019 editor ${input.stamp}`,
  })
  await setRoleAclFeatures(request, adminToken, {
    roleId,
    features: ['documents.view', 'documents.edit'],
    organizations: null,
  })
  const email = `tc-documents-019-editor-${input.stamp}@example.com`
  const id = await createUserFixture(request, adminToken, {
    email,
    password: PASSWORD,
    organizationId: input.organizationId,
    roles: [roleId],
    name: 'Documents 019 editor',
  })
  return { id, roleId, token: await getAuthToken(request, email, PASSWORD) }
}

async function getDocument(
  request: APIRequestContext,
  token: string,
  documentId: string,
): Promise<DocumentDetail> {
  const response = await apiRequest(request, 'GET', `/api/documents/${documentId}`, { token })
  const body = await readJsonSafe<DocumentDetail>(response)
  expect(response.status()).toBe(200)
  return body ?? {}
}

async function expectArchivedError(
  response: Parameters<typeof readJsonSafe>[0],
  label: string,
): Promise<void> {
  const body = await readJsonSafe<ErrorBody>(response)
  expect(response.status(), label).toBe(403)
  expect(body?.error, label).toBe(ARCHIVED_READ_ONLY_MESSAGE)
}

test.describe('TC-DOCUMENTS-019: archive lifecycle', () => {
  test('enforces archive visibility, mutation clamps, permissions, locking, and undo', async ({ request }) => {
    const stamp = Date.now()
    let adminToken: string | null = null
    let document: Mutation | null = null
    let editor: TestUser | null = null
    let editorShare: Mutation | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const scope = getTokenScope(adminToken)
      document = await createDocument(request, adminToken, `TC-DOCUMENTS-019 ${stamp}`)

      const initialDetail = await getDocument(request, adminToken, expectId(document.id, 'document id'))
      expect(initialDetail.archivedAt).toBeNull()
      expect(initialDetail.capabilities).toMatchObject({ canArchive: true, canEdit: true })

      editor = await createEditor(request, adminToken, {
        stamp,
        organizationId: scope.organizationId,
      })
      const shareResponse = await apiRequest(request, 'POST', `/api/documents/${document.id}/shares`, {
        token: adminToken,
        data: { principalType: 'user', principalId: editor.id, permission: 'editor' },
      })
      editorShare = await readJsonSafe<Mutation>(shareResponse)
      expect(shareResponse.status()).toBe(201)
      expectId(editorShare?.id, 'editor share id')
      expectId(editorShare?.updatedAt, 'editor share updatedAt')

      const commentResponse = await apiRequest(request, 'POST', `/api/documents/${document.id}/comments`, {
        token: adminToken,
        data: { body: `Archive lifecycle comment ${stamp}`, parentCommentId: null },
      })
      const comment = await readJsonSafe<Mutation>(commentResponse)
      expect(commentResponse.status()).toBe(201)
      const commentId = expectId(comment?.id, 'comment id')
      const commentUpdatedAt = expectId(comment?.updatedAt, 'comment updatedAt')

      const versionResponse = await apiRequest(request, 'POST', `/api/documents/${document.id}/versions`, {
        token: adminToken,
        data: {},
      })
      const version = await readJsonSafe<Mutation>(versionResponse)
      expect([200, 201]).toContain(versionResponse.status())
      const versionId = expectId(version?.id, 'version id')

      const editorDetail = await getDocument(request, editor.token, expectId(document.id, 'document id'))
      expect(editorDetail.capabilities).toMatchObject({ canArchive: false, canEdit: true })
      const deniedArchive = await request.fetch(`/api/documents/${document.id}/archive`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${editor.token}`,
          [OPTIMISTIC_LOCK_HEADER_NAME]: expectId(editorDetail.updatedAt, 'editor detail updatedAt'),
        },
      })
      const deniedArchiveBody = await readJsonSafe<ErrorBody>(deniedArchive)
      expect(deniedArchive.status()).toBe(403)
      expect(deniedArchiveBody?.error).toBeTruthy()

      const freshDetail = await getDocument(request, adminToken, expectId(document.id, 'document id'))
      document.updatedAt = expectId(freshDetail.updatedAt, 'fresh document updatedAt')
      const staleArchive = await request.fetch(`/api/documents/${document.id}/archive`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          [OPTIMISTIC_LOCK_HEADER_NAME]: new Date(
            Date.parse(document.updatedAt) - 1000,
          ).toISOString(),
        },
      })
      expect(staleArchive.status()).toBe(409)

      const archiveResponse = await request.fetch(`/api/documents/${document.id}/archive`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          [OPTIMISTIC_LOCK_HEADER_NAME]: document.updatedAt,
        },
      })
      const archived = await readJsonSafe<Mutation>(archiveResponse)
      expect(archiveResponse.status()).toBe(200)
      expect(archived).toMatchObject({ id: document.id })
      expect(archived?.archivedAt).toBeTruthy()
      document.updatedAt = expectId(archived?.updatedAt, 'archived document updatedAt')
      const archiveOperation = extractOperation(archiveResponse)
      expect(archiveOperation?.undoToken, 'archive response should advertise undo').toBeTruthy()

      for (const query of ['', '?archived=exclude']) {
        const listResponse = await apiRequest(
          request,
          'GET',
          `/api/documents${query}${query ? '&' : '?'}page=1&pageSize=100`,
          { token: adminToken },
        )
        const list = await readJsonSafe<DocumentList>(listResponse)
        expect(listResponse.status()).toBe(200)
        expect(list?.items?.some((item) => item.id === document?.id)).toBe(false)
      }

      for (const archivedFilter of ['include', 'only']) {
        const listResponse = await apiRequest(
          request,
          'GET',
          `/api/documents?archived=${archivedFilter}&page=1&pageSize=100`,
          { token: adminToken },
        )
        const list = await readJsonSafe<DocumentList>(listResponse)
        expect(listResponse.status()).toBe(200)
        expect(list?.items?.some((item) => item.id === document?.id)).toBe(true)
      }

      const archivedDetail = await getDocument(request, adminToken, expectId(document.id, 'document id'))
      expect(archivedDetail.archivedAt).toBeTruthy()
      expect(archivedDetail.capabilities).toMatchObject({ canArchive: true, canEdit: false })

      await expectArchivedError(
        await apiRequest(request, 'PUT', `/api/documents/${document.id}/content`, {
          token: adminToken,
          data: { contentHtml: '<p>archived write</p>', contentText: 'archived write' },
        }),
        'content write while archived',
      )
      await expectArchivedError(
        await apiRequest(request, 'POST', `/api/documents/${document.id}/comments`, {
          token: adminToken,
          data: { body: 'archived comment', parentCommentId: null },
        }),
        'comment create while archived',
      )
      await expectArchivedError(
        await request.fetch(`/api/documents/${document.id}/comments`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${adminToken}`,
            'Content-Type': 'application/json',
            [OPTIMISTIC_LOCK_HEADER_NAME]: commentUpdatedAt,
          },
          data: { id: commentId, resolved: true },
        }),
        'comment resolve while archived',
      )
      await expectArchivedError(
        await apiRequest(request, 'POST', `/api/documents/${document.id}/shares`, {
          token: adminToken,
          data: { principalType: 'role', principalId: editor.roleId, permission: 'viewer' },
        }),
        'share create while archived',
      )
      await expectArchivedError(
        await apiRequest(request, 'POST', `/api/documents/${document.id}/links`, {
          token: adminToken,
          data: {
            entityType: 'document',
            entityId: document.id,
            label: `Archived link ${stamp}`,
            href: `/backend/documents/${document.id}`,
            source: 'related-panel',
          },
        }),
        'link create while archived',
      )
      await expectArchivedError(
        await apiRequest(request, 'POST', `/api/documents/${document.id}/versions`, {
          token: adminToken,
          data: {},
        }),
        'version create while archived',
      )
      await expectArchivedError(
        await request.fetch(`/api/documents/${document.id}/versions/${versionId}/restore`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${adminToken}`,
            [OPTIMISTIC_LOCK_HEADER_NAME]: document.updatedAt,
          },
        }),
        'version restore while archived',
      )

      const unarchiveResponse = await request.fetch(`/api/documents/${document.id}/unarchive`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          [OPTIMISTIC_LOCK_HEADER_NAME]: document.updatedAt,
        },
      })
      const unarchived = await readJsonSafe<Mutation>(unarchiveResponse)
      expect(unarchiveResponse.status()).toBe(200)
      expect(unarchived).toMatchObject({ id: document.id, archivedAt: null })
      document.updatedAt = expectId(unarchived?.updatedAt, 'unarchived document updatedAt')

      const contentResponse = await apiRequest(request, 'PUT', `/api/documents/${document.id}/content`, {
        token: adminToken,
        data: { contentHtml: '<p>restored write</p>', contentText: 'restored write' },
      })
      expect(contentResponse.status()).toBe(200)

      const beforeRearchive = await getDocument(request, adminToken, expectId(document.id, 'document id'))
      document.updatedAt = expectId(beforeRearchive.updatedAt, 'document updatedAt before rearchive')
      const rearchiveResponse = await request.fetch(`/api/documents/${document.id}/archive`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          [OPTIMISTIC_LOCK_HEADER_NAME]: document.updatedAt,
        },
      })
      const rearchived = await readJsonSafe<Mutation>(rearchiveResponse)
      expect(rearchiveResponse.status()).toBe(200)
      expect(rearchived?.archivedAt).toBeTruthy()
      document.updatedAt = expectId(rearchived?.updatedAt, 'rearchived document updatedAt')
      const rearchiveOperation = extractOperation(rearchiveResponse)
      const rearchiveUndoToken = expectId(rearchiveOperation?.undoToken, 'rearchive undo token')

      const undoResponse = await undoByToken(request, adminToken, rearchiveUndoToken)
      expect(undoResponse.ok(), 'undo archive should succeed').toBe(true)
      const afterUndo = await getDocument(request, adminToken, expectId(document.id, 'document id'))
      expect(afterUndo.archivedAt).toBeNull()
      expect(afterUndo.capabilities).toMatchObject({ canArchive: true, canEdit: true })
      document.updatedAt = expectId(afterUndo.updatedAt, 'document updatedAt after undo')
    } finally {
      if (adminToken && document?.id) {
        const cleanupDetail = await apiRequest(request, 'GET', `/api/documents/${document.id}`, {
          token: adminToken,
        }).then((response) => readJsonSafe<DocumentDetail>(response)).catch(() => null)
        if (cleanupDetail?.archivedAt && cleanupDetail.updatedAt) {
          const cleanupUnarchive = await request.fetch(`/api/documents/${document.id}/unarchive`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${adminToken}`,
              [OPTIMISTIC_LOCK_HEADER_NAME]: cleanupDetail.updatedAt,
            },
          }).catch(() => null)
          if (cleanupUnarchive) {
            const body = await readJsonSafe<Mutation>(cleanupUnarchive)
            document.updatedAt = body?.updatedAt ?? document.updatedAt
          }
        } else if (cleanupDetail?.updatedAt) {
          document.updatedAt = cleanupDetail.updatedAt
        }
        if (editorShare?.id && editorShare.updatedAt) {
          await request.fetch(`/api/documents/${document.id}/shares`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${adminToken}`,
              'Content-Type': 'application/json',
              [OPTIMISTIC_LOCK_HEADER_NAME]: editorShare.updatedAt,
            },
            data: { id: editorShare.id },
          }).catch(() => undefined)
        }
        await request.fetch(`/api/documents/${document.id}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${adminToken}`,
            ...(document.updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: document.updatedAt } : {}),
          },
        }).catch(() => undefined)
      }
      await deleteUserIfExists(request, adminToken, editor?.id ?? null)
      await deleteRoleIfExists(request, adminToken, editor?.roleId ?? null)
    }
  })
})
