import { z } from 'zod'
import type { CrudFormSectionClientMutationFact, CrudFormSectionMutationSurfaceFact } from '../../../modules/form-section-facts'
import { symbolicIdSchema } from './protocol'

const routeSegment = /^(?:[A-Za-z0-9_.-]+|\[[A-Za-z0-9_-]+\]|\[\.\.\.[A-Za-z0-9_-]+\]|\[\[\.\.\.[A-Za-z0-9_-]+\]\])$/
const routePattern = z.string().max(512).refine((path) => {
  if (!path.startsWith('/') || /^\/api(?:\/|$)/i.test(path)) return false
  const segments = path.replace(/\/+$/, '').slice(1).split('/')
  return segments.every((segment, index) => routeSegment.test(segment) && segment !== '.' && segment !== '..'
    && (!/^\[\[?\.\.\./.test(segment) || index === segments.length - 1))
})

export const crudFormSectionClientMutationFactSchema = z.strictObject({
  id: symbolicIdSchema,
  kind: z.enum(['parent-submit', 'parent-delete', 'section-action']),
  guardedFacade: z.strictObject({ method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE']), routePattern }),
  requestOperation: symbolicIdSchema.max(64),
  hostResourceKind: symbolicIdSchema,
  mutationResourceKind: symbolicIdSchema,
  optimisticLock: z.enum(['none', 'target-required', 'target-optional']),
})

export function projectCrudFormSectionClientMutationFact(
  { id, kind, guardedFacade, requestOperation, hostResourceKind, mutationResourceKind, optimisticLock }: CrudFormSectionMutationSurfaceFact,
): CrudFormSectionClientMutationFact {
  return { id, kind, guardedFacade, requestOperation, hostResourceKind, mutationResourceKind, optimisticLock }
}

export function parseCrudFormSectionClientMutationFacts(
  ids: readonly string[], input: unknown,
): CrudFormSectionClientMutationFact[] | null {
  const parsed = z.array(crudFormSectionClientMutationFactSchema).safeParse(input === undefined ? [] : input)
  if (!parsed.success || parsed.data.length !== ids.length) return null
  const unique = new Set(ids)
  if (unique.size !== ids.length || parsed.data.some(({ id }) => !unique.delete(id))) return null
  return parsed.data.sort((left, right) => left.id === right.id ? 0 : left.id < right.id ? -1 : 1)
}

export const crudSectionOperationMethods = { create: 'POST', update: 'PUT', delete: 'DELETE' } as const
export type CrudSectionRouteOperation = keyof typeof crudSectionOperationMethods

export function derivedCrudFormSectionClientMutationFact(input: {
  hostDescriptorId: string
  operation: CrudSectionRouteOperation
  route: string
  resourceKind: string
  versioned: boolean
}): CrudFormSectionClientMutationFact {
  const { hostDescriptorId, operation, route, resourceKind, versioned } = input
  return {
    id: `${hostDescriptorId}.${operation}`,
    kind: operation === 'delete' ? 'parent-delete' : 'parent-submit',
    guardedFacade: { method: crudSectionOperationMethods[operation], routePattern: route },
    requestOperation: operation,
    hostResourceKind: resourceKind,
    mutationResourceKind: resourceKind,
    optimisticLock: operation !== 'create' && versioned ? 'target-required' : 'none',
  }
}
