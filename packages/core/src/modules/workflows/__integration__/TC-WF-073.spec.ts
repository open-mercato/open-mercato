import { randomInt } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildMinimalDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

type WorkflowListBody = {
  data?: Array<{ id: string; workflowName?: string }>
  items?: Array<{ id: string }>
  pagination?: { total: number; limit: number; offset: number; hasMore: boolean }
  total?: number
  page?: number
  pageSize?: number
}

const offsetInvalidQueries = [
  'limit=101',
  'limit=999999999',
  'limit=-1',
  'limit=abc',
  'limit=1.5',
  'limit=Infinity',
  'offset=100001',
  'offset=-1',
  'offset=abc',
  'offset=1.5',
]

const pageInvalidQueries = [
  'pageSize=101',
  'pageSize=999999999',
  'pageSize=-1',
  'pageSize=abc',
  'pageSize=1.5',
  'pageSize=Infinity',
  'page=1002&pageSize=100',
  'page=-1',
  'page=abc',
  'page=1.5',
]

test.describe('TC-WF-073: bounded workflow list pagination', () => {
  test('definition pages use consistent case-sensitive byte ordering', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const nonce = randomInt(1000000)
    const prefix = `QA Pagination C ${timestamp} ${nonce}-`
    const definitionIds: string[] = []

    try {
      for (const [index, suffix] of ['c', 'D', 'a', 'B'].entries()) {
        const payload = buildMinimalDefinitionPayload(timestamp, `-collation-${nonce}-${index}`)
        definitionIds.push(await createWorkflowDefinitionFixture(request, token, {
          ...payload,
          workflowName: `${prefix}${suffix}`,
        }))
      }

      const pages: Array<Array<{ id: string; workflowName?: string }>> = []
      for (const offset of [0, 2]) {
        const response = await apiRequest(
          request, 'GET', `/api/workflows/definitions?search=${encodeURIComponent(prefix)}&limit=2&offset=${offset}`, { token },
        )
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<WorkflowListBody>(response)
        expect(body?.pagination).toEqual({ total: 4, limit: 2, offset, hasMore: offset === 0 })
        expect(body?.data).toHaveLength(2)
        pages.push(body?.data ?? [])
      }

      expect(pages.flat().map((row) => row.workflowName)).toEqual(['B', 'D', 'a', 'c'].map((suffix) => `${prefix}${suffix}`))
      expect(new Set(pages.flat().map((row) => row.id)).size).toBe(4)
    } finally {
      for (const definitionId of definitionIds) {
        await deleteWorkflowDefinitionIfExists(request, token, definitionId)
      }
    }
  })

  for (const target of ['definitions', 'instances', 'instance events', 'events'] as const) {
    test(`${target} reject invalid pagination and retain valid fixture pages`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      const payload = buildMinimalDefinitionPayload(Date.now(), `-pagination-${randomInt(1000000)}`)
      let definitionId: string | null = null
      let instanceId: string | null = null

      try {
        definitionId = await createWorkflowDefinitionFixture(request, token, payload)
        if (target !== 'definitions') {
          instanceId = await startWorkflowInstanceFixture(request, token, { workflowId: payload.workflowId })
          await pollWorkflowInstance(request, token, instanceId, (instance) => instance.status === 'COMPLETED')
        }

        const basePath = target === 'instance events'
          ? `/api/workflows/instances/${encodeURIComponent(instanceId!)}/events?`
          : target === 'events'
            ? `/api/workflows/events?workflowInstanceId=${encodeURIComponent(instanceId!)}&`
            : `/api/workflows/${target}?workflowId=${encodeURIComponent(payload.workflowId)}&`
        const usesPageNumbers = target === 'events'

        for (const query of usesPageNumbers ? pageInvalidQueries : offsetInvalidQueries) {
          const response = await apiRequest(request, 'GET', `${basePath}${query}`, { token })

          expect(response.status(), `${target} must reject ${query}`).toBe(400)
          expect(await readJsonSafe<Record<string, unknown>>(response)).toHaveProperty('error')
        }

        const firstPageResponse = await apiRequest(
          request, 'GET', `${basePath}${usesPageNumbers ? 'page=1&pageSize=1' : 'limit=1&offset=0'}`, { token },
        )
        const secondPageResponse = await apiRequest(
          request, 'GET', `${basePath}${usesPageNumbers ? 'page=2&pageSize=1' : 'limit=1&offset=1'}`, { token },
        )
        expect(firstPageResponse.status()).toBe(200)
        expect(secondPageResponse.status()).toBe(200)
        const firstPage = await readJsonSafe<WorkflowListBody>(firstPageResponse)
        const secondPage = await readJsonSafe<WorkflowListBody>(secondPageResponse)
        const firstRows = firstPage?.data ?? firstPage?.items ?? []
        const secondRows = secondPage?.data ?? secondPage?.items ?? []

        expect(firstRows).toHaveLength(1)
        if (target === 'definitions' || target === 'instances') {
          expect(firstRows[0].id).toBe(target === 'definitions' ? definitionId : instanceId)
          expect(secondRows).toEqual([])
          expect(firstPage?.pagination).toEqual({ total: 1, limit: 1, offset: 0, hasMore: false })
          expect(secondPage?.pagination).toEqual({ total: 1, limit: 1, offset: 1, hasMore: false })
        } else {
          expect(secondRows).toHaveLength(1)
          expect(secondRows[0].id).not.toBe(firstRows[0].id)
          if (usesPageNumbers) {
            expect(firstPage).toMatchObject({ page: 1, pageSize: 1 })
            expect(secondPage).toMatchObject({ page: 2, pageSize: 1 })
            expect(firstPage?.total).toBeGreaterThanOrEqual(2)
          } else {
            expect(firstPage?.pagination).toMatchObject({ limit: 1, offset: 0, hasMore: true })
            expect(secondPage?.pagination).toMatchObject({ limit: 1, offset: 1 })
            expect(firstPage?.pagination?.total).toBeGreaterThanOrEqual(2)
          }
        }

        const lastPageResponse = await apiRequest(
          request, 'GET', `${basePath}${usesPageNumbers ? 'page=100001&pageSize=1' : 'limit=1&offset=100000'}`, { token },
        )
        expect(lastPageResponse.status()).toBe(200)
        const lastPage = await readJsonSafe<WorkflowListBody>(lastPageResponse)
        expect(lastPage?.data ?? lastPage?.items).toEqual([])
        if (usesPageNumbers) expect(lastPage).toMatchObject({ page: 100001, pageSize: 1 })
        else expect(lastPage?.pagination).toMatchObject({ limit: 1, offset: 100000, hasMore: false })
      } finally {
        await cancelWorkflowInstanceIfExists(request, token, instanceId)
        await deleteWorkflowDefinitionIfExists(request, token, definitionId)
      }
    })
  }
})
