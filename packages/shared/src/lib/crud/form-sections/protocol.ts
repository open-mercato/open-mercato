import { z } from 'zod'

function reportNonCanonicalIds(
  ids: readonly string[],
  path: string,
  context: z.RefinementCtx,
): void {
  if (ids.some((id, index) => index !== 0 && ids[index - 1] >= id)) {
    context.addIssue({ code: 'custom', path: [path], message: 'Expected unique IDs in lexical order' })
  }
}

function requireCreateResourceAbsenceAndUniqueCanonicalRoundTrips(
  input: { formOperation: 'create' | 'update'; hostResourceId?: string; clientRoundTripIds: string[] },
  context: z.RefinementCtx,
): void {
  if ((input.formOperation === 'create') !== (input.hostResourceId === undefined)) {
    context.addIssue({ code: 'custom', path: ['hostResourceId'], message: 'Host resource ID is required only for update' })
  }
  reportNonCanonicalIds(input.clientRoundTripIds, 'clientRoundTripIds', context)
}

function requireUniqueCanonicalIds(
  input: { activeSectionIds: string[]; acceptedContributionIds: string[] },
  context: z.RefinementCtx,
): void {
  reportNonCanonicalIds(input.activeSectionIds, 'activeSectionIds', context)
  reportNonCanonicalIds(input.acceptedContributionIds, 'acceptedContributionIds', context)
}

export const symbolicIdSchema = z.string().min(1).max(160)
  .regex(/^[a-z0-9][a-z0-9._:/-]*$/)
export const resourceIdSchema = z.string().min(1).max(256)
  .regex(/^[\x21-\x2b\x2d-\x7e]+$/)
export const roundTripIdSchema = z.string().min(3).max(192)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/)
export const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const policyTokenSchema = z.string().min(1).max(4096)
  .regex(/^[A-Za-z0-9_-]+$/)

export const resolveCrudFormSectionsRequestSchema = z.object({
  hostId: symbolicIdSchema,
  formVariant: symbolicIdSchema,
  formOperation: z.enum(['create', 'update']),
  hostResourceKind: symbolicIdSchema,
  hostResourceId: resourceIdSchema.optional(),
  clientManifestFingerprint: fingerprintSchema,
  clientRoundTripIds: z.array(roundTripIdSchema).max(128),
}).strict().superRefine(requireCreateResourceAbsenceAndUniqueCanonicalRoundTrips)

export const readyResolveCrudFormSectionsResponseSchema = z.object({
  state: z.literal('ready'),
  fingerprint: fingerprintSchema,
  policyToken: policyTokenSchema,
  activeSectionIds: z.array(symbolicIdSchema).max(128),
  acceptedContributionIds: z.array(symbolicIdSchema).max(128),
}).strict().superRefine(requireUniqueCanonicalIds)

export const failedResolveCrudFormSectionsResponseSchema = z.object({
  state: z.literal('failed'),
  code: z.literal('crud_form_section_policy_invalid'),
}).strict()

export const resolveCrudFormSectionsResponseSchema = z.discriminatedUnion('state', [
  readyResolveCrudFormSectionsResponseSchema,
  failedResolveCrudFormSectionsResponseSchema,
])

export type ResolveCrudFormSectionsRequest = z.infer<typeof resolveCrudFormSectionsRequestSchema>
export type ResolveCrudFormSectionsResponse = z.infer<typeof resolveCrudFormSectionsResponseSchema>

export const crudFormSectionsResolvePath = '/extensions/crud-form-sections/resolve'
export const crudFormSectionsResolveMaxBytes = 16 * 1024
export const crudFormSectionsPolicyMaxBytes = 3072

export const crudFormSectionsPrivateHeaders = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
}

export const crudFormSectionPolicyTokenBodySchema = z.object({
  protocol: z.literal('crud-form-sections/v1'),
  schemaVersion: z.literal(1),
  hostId: symbolicIdSchema,
  formVariant: symbolicIdSchema,
  formOperation: z.enum(['create', 'update']),
  hostResourceKind: symbolicIdSchema,
  hostResourceId: resourceIdSchema.optional(),
  contributionIds: z.array(symbolicIdSchema).max(128),
  roundTripIds: z.array(roundTripIdSchema).max(128),
  capabilityIds: z.array(symbolicIdSchema).max(128),
  orderedActiveSectionIds: z.array(symbolicIdSchema).max(128),
  clientManifestFingerprint: fingerprintSchema,
  fingerprint: fingerprintSchema,
}).strict().superRefine((input, context) => {
  requireCreateResourceAbsenceAndUniqueCanonicalRoundTrips({
    formOperation: input.formOperation,
    hostResourceId: input.hostResourceId,
    clientRoundTripIds: input.roundTripIds,
  }, context)
  reportNonCanonicalIds(input.contributionIds, 'contributionIds', context)
  reportNonCanonicalIds(input.capabilityIds, 'capabilityIds', context)
  if (new Set(input.orderedActiveSectionIds).size !== input.orderedActiveSectionIds.length) {
    context.addIssue({ code: 'custom', path: ['orderedActiveSectionIds'], message: 'Expected unique section IDs' })
  }
})

export type CrudFormSectionPolicyTokenBody = z.infer<typeof crudFormSectionPolicyTokenBodySchema>
