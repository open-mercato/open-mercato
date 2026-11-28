import type * as React from 'react'
import { z } from 'zod'
import {
  blockActionSchema,
  blockBasePropsSchema,
  blockToneSchema,
  callbackSchema,
  hasUniqueIds,
  hasUniqueKeys,
  iconNameSchema,
  isoDateTimeSchema,
  slotSchema,
} from './shared'

export const commentThreadAuthorSchema = z.object({
  name: z.string().min(1),
  avatarUrl: z.string().min(1).optional(),
})
export type CommentThreadAuthor = z.infer<typeof commentThreadAuthorSchema>

export const commentThreadCommentSchema = z
  .object({
    id: z.string().min(1),
    author: commentThreadAuthorSchema,
    body: z.string(),
    createdAt: isoDateTimeSchema,
    editedAt: isoDateTimeSchema.optional(),
    visibility: z.string().min(1).optional(),
    own: z.boolean().optional(),
    pending: z.boolean().optional(),
    failed: z.boolean().optional(),
    actions: z.array(blockActionSchema).optional(),
  })
  .refine((comment) => hasUniqueKeys(comment.actions), { message: 'Action keys must be unique', path: ['actions'] })
  .refine((comment) => !(comment.pending === true && comment.failed === true), {
    message: 'A comment is either pending or failed, not both',
    path: ['failed'],
  })
export type CommentThreadComment = z.infer<typeof commentThreadCommentSchema>

export const commentThreadVisibilityOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  icon: iconNameSchema.optional(),
  tone: blockToneSchema.optional(),
})
export type CommentThreadVisibilityOption = z.infer<typeof commentThreadVisibilityOptionSchema>

export const commentThreadOrderSchema = z.enum(['asc', 'desc'])
export type CommentThreadOrder = z.infer<typeof commentThreadOrderSchema>

export const commentThreadVariantSchema = z.enum(['card', 'plain'])
export type CommentThreadVariant = z.infer<typeof commentThreadVariantSchema>

export const commentThreadHeadingLevelSchema = z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)])
export type CommentThreadHeadingLevel = z.infer<typeof commentThreadHeadingLevelSchema>

function hasUniqueValues(options: ReadonlyArray<{ value: string }> | undefined): boolean {
  if (!options) return true
  return new Set(options.map((option) => option.value)).size === options.length
}

function isKnownVisibility(options: ReadonlyArray<{ value: string }> | undefined, value: string | undefined): boolean {
  if (value === undefined) return true
  return Boolean(options?.some((option) => option.value === value))
}

export const commentThreadPropsSchema = blockBasePropsSchema
  .extend({
    comments: z.array(commentThreadCommentSchema),
    currentUser: commentThreadAuthorSchema.optional(),
    groupConsecutive: z.boolean().optional(),
    order: commentThreadOrderSchema.optional(),
    variant: commentThreadVariantSchema.optional(),
    title: z.string().min(1).optional(),
    count: z.number().int().nonnegative().optional(),
    headingLevel: commentThreadHeadingLevelSchema.optional(),
    canComment: z.boolean().optional(),
    composerDisabledReason: z.string().min(1).optional(),
    placeholder: z.string().min(1).optional(),
    composerLabel: z.string().min(1).optional(),
    postLabel: z.string().min(1).optional(),
    value: z.string().optional(),
    onValueChange: callbackSchema<(value: string) => void>().optional(),
    maxLength: z.number().int().positive().optional(),
    visibilityOptions: z.array(commentThreadVisibilityOptionSchema).min(2).optional(),
    visibilityLabel: z.string().min(1).optional(),
    visibility: z.string().min(1).optional(),
    defaultVisibility: z.string().min(1).optional(),
    onVisibilityChange: callbackSchema<(visibility: string) => void>().optional(),
    onPost: callbackSchema<(body: string, visibility?: string) => void | Promise<void>>().optional(),
    posting: z.boolean().optional(),
    postErrorMessage: z.string().min(1).optional(),
    onCommentAction: callbackSchema<(commentId: string, actionKey: string) => void | Promise<void>>().optional(),
    onRetryComment: callbackSchema<(commentId: string) => void>().optional(),
    onLoadEarlier: callbackSchema<() => void | Promise<void>>().optional(),
    hasEarlier: z.boolean().optional(),
    loadingEarlier: z.boolean().optional(),
    composerExtras: slotSchema.optional(),
    renderBody: callbackSchema<(comment: CommentThreadComment) => React.ReactNode>().optional(),
    emptyTitle: z.string().min(1).optional(),
    emptyDescription: z.string().min(1).optional(),
  })
  .refine((props) => hasUniqueIds(props.comments), { message: 'Comment ids must be unique', path: ['comments'] })
  .refine((props) => hasUniqueValues(props.visibilityOptions), {
    message: 'Visibility option values must be unique',
    path: ['visibilityOptions'],
  })
  .refine((props) => isKnownVisibility(props.visibilityOptions, props.visibility), {
    message: 'visibility must be one of visibilityOptions',
    path: ['visibility'],
  })
  .refine((props) => isKnownVisibility(props.visibilityOptions, props.defaultVisibility), {
    message: 'defaultVisibility must be one of visibilityOptions',
    path: ['defaultVisibility'],
  })
  .refine((props) => props.canComment === false || props.onPost !== undefined, {
    message: 'onPost is required unless canComment is false',
    path: ['onPost'],
  })
  .refine((props) => props.composerDisabledReason === undefined || props.canComment === false, {
    message: 'composerDisabledReason requires canComment: false',
    path: ['composerDisabledReason'],
  })
  .refine((props) => props.value === undefined || props.onValueChange !== undefined, {
    message: 'value requires onValueChange',
    path: ['onValueChange'],
  })
  .refine((props) => props.visibility === undefined || props.onVisibilityChange !== undefined, {
    message: 'visibility requires onVisibilityChange',
    path: ['onVisibilityChange'],
  })
  .refine((props) => !props.comments.some((comment) => comment.actions?.length) || props.onCommentAction !== undefined, {
    message: 'comment actions require onCommentAction',
    path: ['onCommentAction'],
  })
  .refine((props) => props.hasEarlier !== true || props.onLoadEarlier !== undefined, {
    message: 'hasEarlier requires onLoadEarlier',
    path: ['onLoadEarlier'],
  })
export type CommentThreadProps = z.infer<typeof commentThreadPropsSchema>
