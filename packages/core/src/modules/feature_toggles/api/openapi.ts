import { z } from 'zod'
import {
    toggleCreateSchema,
    toggleUpdateSchema,
    changeOverrideStateBaseSchema,
    overrideListQuerySchema,
    getToggleOverrideQuerySchema,
    featureToggleOverrideResponseSchema,
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
        default_state: z.boolean(),

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

export const featureToggleOverrideSchema = z
    .object({
        id: z.string().uuid(),
        toggleId: z.string().uuid(),
        overrideState: z.enum(['enabled', 'disabled', 'inherit']),
        identifier: z.string(),
        name: z.string(),
        category: z.string().nullable().optional(),
        defaultState: z.boolean(),
        tenantName: z.string().nullable().optional(),
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
