import { describe, expect, test } from '@jest/globals'
import { z } from 'zod'
import {
  staffTimeTaskCommentCreateSchema,
  staffTimeTaskCommentUpdateRequestSchema,
  staffTimeTaskCommentUpdateSchema,
} from '../validators'

const tenantId = '123e4567-e89b-12d3-a456-426614174000'
const organizationId = '123e4567-e89b-12d3-a456-426614174001'
const taskId = '123e4567-e89b-12d3-a456-426614174002'
const commentId = '123e4567-e89b-12d3-a456-426614174003'

describe('Staff task comment validators', () => {
  test('the create schema leaves visibility unset when the caller omits it', () => {
    const parsed = staffTimeTaskCommentCreateSchema.parse({ tenantId, organizationId, taskId, body: 'Hello' })

    expect(parsed.visibility).toBeUndefined()
  })

  test('the create schema accepts a customer visibility', () => {
    const parsed = staffTimeTaskCommentCreateSchema.parse({
      tenantId,
      organizationId,
      taskId,
      body: 'Hello',
      visibility: 'customer',
    })

    expect(parsed.visibility).toBe('customer')
  })

  test('the update schema stays a plain object a third party can extend', () => {
    expect(staffTimeTaskCommentUpdateSchema).toBeInstanceOf(z.ZodObject)
    const extended = staffTimeTaskCommentUpdateSchema.extend({ note: z.string().optional() })

    expect(extended.parse({ id: commentId, body: 'Edited', note: 'x' })).toEqual({
      id: commentId,
      body: 'Edited',
      note: 'x',
    })
  })

  test('the update schema keeps body required and accepts visibility additively', () => {
    expect(staffTimeTaskCommentUpdateSchema.safeParse({ id: commentId }).success).toBe(false)
    expect(staffTimeTaskCommentUpdateSchema.parse({ id: commentId, body: 'Edited', visibility: 'internal' })).toEqual({
      id: commentId,
      body: 'Edited',
      visibility: 'internal',
    })
  })

  test('the update request schema accepts a visibility-only change', () => {
    expect(staffTimeTaskCommentUpdateRequestSchema.parse({ id: commentId, visibility: 'customer' })).toEqual({
      id: commentId,
      visibility: 'customer',
    })
  })

  test('the update request schema requires a body or a visibility', () => {
    const result = staffTimeTaskCommentUpdateRequestSchema.safeParse({ id: commentId })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['body'])
  })
})
