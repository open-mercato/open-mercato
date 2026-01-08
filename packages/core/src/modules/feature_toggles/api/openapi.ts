import { z } from 'zod'
import {
    toggleCreateSchema,
    toggleUpdateSchema,
    changeOverrideStateBaseSchema,
    overrideListQuerySchema,
    getToggleOverrideQuerySchema,
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
        fail_mode: z.string(),
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

export const featureToggleOverrideResponseSchema = z.object({
    id: z.string(),
    state: z.enum(['enabled', 'disabled', 'inherit']),
    tenantName: z.string(),
    tenantId: z.string(),
})

export { changeOverrideStateBaseSchema, overrideListQuerySchema, getToggleOverrideQuerySchema }

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
