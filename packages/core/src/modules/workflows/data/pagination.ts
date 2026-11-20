import { z } from 'zod'

const paginationIntegerSchema = z.preprocess(
  (value) => typeof value === 'string' && !/^\d+$/.test(value) ? Number.NaN : value,
  z.coerce.number().int(),
)

export const WORKFLOW_LIST_MAX_OFFSET = 100_000
export const WORKFLOW_LIST_OFFSET_ERROR = 'WORKFLOW_LIST_OFFSET_EXCEEDED'

export function getWorkflowListPageBounds(total: number, pageSize: number) {
  const lastAccessiblePage = Math.floor(WORKFLOW_LIST_MAX_OFFSET / pageSize) + 1
  return {
    lastAccessiblePage,
    totalPages: Math.min(Math.ceil(total / pageSize), lastAccessiblePage),
    reachableTotal: Math.min(total, lastAccessiblePage * pageSize),
  }
}

export const workflowListPaginationSchema = z.object({
  limit: paginationIntegerSchema.pipe(z.number().int().min(1).max(100)).default(50),
  offset: paginationIntegerSchema.pipe(z.number().int().min(0).max(WORKFLOW_LIST_MAX_OFFSET)).default(0),
})

export const workflowEventPageSchema = z.object({
  page: paginationIntegerSchema.pipe(z.number().int().min(1).max(WORKFLOW_LIST_MAX_OFFSET + 1)).default(1),
  pageSize: workflowListPaginationSchema.shape.limit,
}).refine(({ page, pageSize }) => (page - 1) * pageSize <= WORKFLOW_LIST_MAX_OFFSET, {
  path: ['page'],
})
