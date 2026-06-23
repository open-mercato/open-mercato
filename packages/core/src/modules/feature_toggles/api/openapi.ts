import { z } from 'zod'
import {
    toggleCreateSchema,
    toggleUpdateSchema,
    toggleTypeSchema,
    changeOverrideStateBaseSchema,
    overrideListQuerySchema,
    getToggleOverrideQuerySchema,
    featureToggleOverrideResponseSchema,
    overrideRowIdSchema,
} from '../data/validators'

export const featureTogglesTag = 'Feature Toggles'

export const featureToggleErrorSchema = z
    .object({
        error: z.string(),
        details: z.any().optional(),
    })
    .passthrough()

export const featureToggleSchema = z
    .object({
        id: z.string().uuid(),
        identifier: z.string(),
        name: z.string(),
        description: z.string().nullable().optional(),
        category: z.string().nullable().optional(),
        type: toggleTypeSchema,
        defaultValue: z.any().nullable().optional(),
        created_at: z.string().optional(),
        updated_at: z.string().optional(),
    })
    .passthrough()

export const featureToggleListResponseSchema = z.object({
    items: z.array(featureToggleSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    totalPages: z.number().int().min(1),
})

export { toggleCreateSchema, toggleUpdateSchema }

// Documents the actual override-list row shape returned by GET /api/feature_toggles/overrides
// (see lib/queries.ts → getOverrides). Each row reports whether the tenant has a
// per-tenant override via `isOverride`; inherited rows (no override) carry an
// empty-string `id` sentinel instead of a UUID, hence `overrideRowIdSchema`.
export const featureToggleOverrideSchema = z
    .object({
        id: overrideRowIdSchema,
        toggleId: z.string().uuid(),
        tenantName: z.string(),
        tenantId: z.string().uuid(),
        identifier: z.string(),
        name: z.string(),
        category: z.string(),
        isOverride: z.boolean(),
    })
    .passthrough()

export const featureToggleOverrideListResponseSchema = z.object({
    items: z.array(featureToggleOverrideSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    totalPages: z.number().int().min(1),
    isSuperAdmin: z.boolean(),
})


export { changeOverrideStateBaseSchema, overrideListQuerySchema, getToggleOverrideQuerySchema, featureToggleOverrideResponseSchema }

export const changeOverrideStateResponseSchema = z.object({
    ok: z.literal(true),
    overrideToggleId: z.string().uuid().nullable(),
})

export const checkResponseSchema = z.object({
    enabled: z.boolean(),
    source: z.enum(['override', 'default', 'fallback', 'missing']),
    toggleId: z.string(),
    identifier: z.string(),
    tenantId: z.string(),
}).passthrough()

export const checkStringResponseSchema = z.object({
    valueType: z.literal('string'),
    value: z.string(),
    source: z.enum(['override', 'default', 'fallback', 'missing']),
    toggleId: z.string(),
    identifier: z.string(),
    tenantId: z.string(),
}).passthrough()

export const checkNumberResponseSchema = z.object({
    valueType: z.literal('number'),
    value: z.number(),
    source: z.enum(['override', 'default', 'fallback', 'missing']),
    toggleId: z.string(),
    identifier: z.string(),
    tenantId: z.string(),
}).passthrough()

export const checkJsonResponseSchema = z.object({
    valueType: z.literal('json'),
    value: z.unknown(),
    source: z.enum(['override', 'default', 'fallback', 'missing']),
    toggleId: z.string(),
    identifier: z.string(),
    tenantId: z.string(),
}).passthrough()
