import { test, expect } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  cancelProgressJob,
  createProgressJob,
  listProgressJobs,
  uniqueJobName,
  uniqueJobType,
} from './helpers/progress'

/**
 * TC-PROG-003: List progress jobs with pagination and filtering.
 * Covers GET /api/progress/jobs query surface: pagination, status filter
 * (single + comma-separated union), jobType filter, name search, createdAt
 * sorting, and the list item shape.
 *
 * Note on reachable statuses: the public API can only put a job into `pending`
 * (POST) or `cancelled` (DELETE on a cancellable pending job). `running` /
 * `completed` / `failed` are only reachable from workers via the service, so
 * this spec exercises the filter surface with `pending` and `cancelled`.
 * Every query is scoped by a per-run unique jobType so the assertions stay
 * deterministic regardless of any other jobs already present in the tenant.
 */
test.describe('TC-PROG-003: List progress jobs with pagination and filtering', () => {
  test('paginates a scoped set of jobs', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const jobType = uniqueJobType('qa-prog-003-page')
    const created: string[] = []
    try {
      for (let index = 0; index < 5; index += 1) {
        created.push(await createProgressJob(request, token, { jobType, name: uniqueJobName('QA Page') }))
      }

      const firstPage = await listProgressJobs(request, token, { jobType, page: 1, pageSize: 2 })
      expect(firstPage.total).toBe(5)
      expect(firstPage.page).toBe(1)
      expect(firstPage.pageSize).toBe(2)
      expect(firstPage.totalPages).toBe(3)
      expect(firstPage.items).toHaveLength(2)

      const lastPage = await listProgressJobs(request, token, { jobType, page: 3, pageSize: 2 })
      expect(lastPage.items).toHaveLength(1)

      // The three pages partition the five jobs with no overlap.
      const secondPage = await listProgressJobs(request, token, { jobType, page: 2, pageSize: 2 })
      const pagedIds = [...firstPage.items, ...secondPage.items, ...lastPage.items].map((job) => job.id)
      expect(new Set(pagedIds).size).toBe(5)
      expect(new Set(pagedIds)).toEqual(new Set(created))
    } finally {
      for (const id of created) await cancelProgressJob(request, token, id)
    }
  })

  test('filters by single status and by a comma-separated union', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const jobType = uniqueJobType('qa-prog-003-status')
    const created: string[] = []
    try {
      for (let index = 0; index < 4; index += 1) {
        created.push(await createProgressJob(request, token, { jobType, name: uniqueJobName('QA Status') }))
      }
      // Cancel two so the set spans both reachable statuses.
      const cancelled = [created[0], created[1]]
      for (const id of cancelled) await cancelProgressJob(request, token, id)
      const stillPending = [created[2], created[3]]

      const pendingOnly = await listProgressJobs(request, token, { jobType, status: 'pending', pageSize: 100 })
      expect(pendingOnly.items.every((job) => job.status === 'pending')).toBe(true)
      expect(new Set(pendingOnly.items.map((job) => job.id))).toEqual(new Set(stillPending))

      const cancelledOnly = await listProgressJobs(request, token, { jobType, status: 'cancelled', pageSize: 100 })
      expect(cancelledOnly.items.every((job) => job.status === 'cancelled')).toBe(true)
      expect(new Set(cancelledOnly.items.map((job) => job.id))).toEqual(new Set(cancelled))

      const union = await listProgressJobs(request, token, { jobType, status: 'pending,cancelled', pageSize: 100 })
      expect(new Set(union.items.map((job) => job.id))).toEqual(new Set(created))

      // No status param defaults to active-only (pending|running), so cancelled jobs drop out.
      const defaultView = await listProgressJobs(request, token, { jobType, pageSize: 100 })
      expect(new Set(defaultView.items.map((job) => job.id))).toEqual(new Set(stillPending))
    } finally {
      for (const id of created) await cancelProgressJob(request, token, id)
    }
  })

  test('filters by jobType', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const jobTypeA = uniqueJobType('qa-prog-003-typea')
    const jobTypeB = uniqueJobType('qa-prog-003-typeb')
    const created: string[] = []
    try {
      const aIds = [
        await createProgressJob(request, token, { jobType: jobTypeA, name: uniqueJobName('QA TypeA') }),
        await createProgressJob(request, token, { jobType: jobTypeA, name: uniqueJobName('QA TypeA') }),
      ]
      const bId = await createProgressJob(request, token, { jobType: jobTypeB, name: uniqueJobName('QA TypeB') })
      created.push(...aIds, bId)

      const onlyB = await listProgressJobs(request, token, { jobType: jobTypeB, pageSize: 100 })
      expect(onlyB.items.every((job) => job.jobType === jobTypeB)).toBe(true)
      expect(onlyB.items.map((job) => job.id)).toContain(bId)

      const onlyA = await listProgressJobs(request, token, { jobType: jobTypeA, pageSize: 100 })
      expect(onlyA.items.every((job) => job.jobType === jobTypeA)).toBe(true)
      expect(onlyA.items.map((job) => job.id)).not.toContain(bId)
    } finally {
      for (const id of created) await cancelProgressJob(request, token, id)
    }
  })

  test('searches by name case-insensitively', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const jobType = uniqueJobType('qa-prog-003-search')
    const nameToken = `QA003Search${Date.now()}`
    const created: string[] = []
    try {
      created.push(await createProgressJob(request, token, { jobType, name: `${nameToken} Alpha` }))
      created.push(await createProgressJob(request, token, { jobType, name: `${nameToken} Bravo` }))

      const exact = await listProgressJobs(request, token, { search: nameToken, pageSize: 100 })
      const exactIds = new Set(exact.items.map((job) => job.id))
      for (const id of created) expect(exactIds.has(id)).toBe(true)

      // ILIKE search is case-insensitive: lowercased token still matches.
      const lowered = await listProgressJobs(request, token, { search: nameToken.toLowerCase(), pageSize: 100 })
      const loweredIds = new Set(lowered.items.map((job) => job.id))
      for (const id of created) expect(loweredIds.has(id)).toBe(true)
    } finally {
      for (const id of created) await cancelProgressJob(request, token, id)
    }
  })

  test('sorts by createdAt ascending and descending', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const jobType = uniqueJobType('qa-prog-003-sort')
    const created: string[] = []
    try {
      for (let index = 0; index < 3; index += 1) {
        created.push(await createProgressJob(request, token, { jobType, name: uniqueJobName('QA Sort') }))
      }

      const ascending = await listProgressJobs(request, token, {
        jobType,
        sortField: 'createdAt',
        sortDir: 'asc',
        pageSize: 100,
      })
      const ascTimes = ascending.items.map((job) => new Date(job.createdAt ?? 0).getTime())
      for (let index = 1; index < ascTimes.length; index += 1) {
        expect(ascTimes[index]).toBeGreaterThanOrEqual(ascTimes[index - 1])
      }

      const descending = await listProgressJobs(request, token, {
        jobType,
        sortField: 'createdAt',
        sortDir: 'desc',
        pageSize: 100,
      })
      const descTimes = descending.items.map((job) => new Date(job.createdAt ?? 0).getTime())
      for (let index = 1; index < descTimes.length; index += 1) {
        expect(descTimes[index]).toBeLessThanOrEqual(descTimes[index - 1])
      }

      expect(new Set(ascending.items.map((job) => job.id))).toEqual(new Set(created))
    } finally {
      for (const id of created) await cancelProgressJob(request, token, id)
    }
  })

  test('returns the documented job fields', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const jobType = uniqueJobType('qa-prog-003-shape')
    let jobId: string | null = null
    try {
      jobId = await createProgressJob(request, token, { jobType, name: uniqueJobName('QA Shape'), totalCount: 50 })

      const result = await listProgressJobs(request, token, { jobType, pageSize: 100 })
      const job = result.items.find((item) => item.id === jobId)
      expect(job, 'created job should be present in the list').toBeTruthy()
      if (!job) return

      expect(typeof job.id).toBe('string')
      expect(job.jobType).toBe(jobType)
      expect(typeof job.name).toBe('string')
      expect(job.status).toBe('pending')
      expect(typeof job.progressPercent).toBe('number')
      expect(typeof job.processedCount).toBe('number')
      expect(job.totalCount).toBe(50)
      expect(typeof job.cancellable).toBe('boolean')
      expect(typeof job.createdAt).toBe('string')
      expect(typeof job.tenantId).toBe('string')
    } finally {
      await cancelProgressJob(request, token, jobId)
    }
  })
})
