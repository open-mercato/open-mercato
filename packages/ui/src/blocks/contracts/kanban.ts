import type * as React from 'react'
import { z } from 'zod'
import { blockBasePropsSchema, callbackSchema, hasUniqueIds, slotSchema } from './shared'

export const kanbanCardSchema = z.looseObject({ id: z.string().min(1) })
export type KanbanCard = z.infer<typeof kanbanCardSchema>

export const kanbanColumnStatusSchema = z.enum(['loading', 'error', 'ready'])
export type KanbanColumnStatus = z.infer<typeof kanbanColumnStatusSchema>

export const kanbanColumnSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  count: z.number().int().nonnegative().optional(),
  remaining: z.number().int().nonnegative().optional(),
  summary: slotSchema.optional(),
  hasMore: z.boolean().optional(),
  status: kanbanColumnStatusSchema.optional(),
  errorMessage: z.string().optional(),
  cards: z.array(kanbanCardSchema),
})
export type KanbanColumn = z.infer<typeof kanbanColumnSchema>

export const kanbanMoveRejectionSchema = z.object({ reason: z.string().min(1) })
export type KanbanMoveRejection = z.infer<typeof kanbanMoveRejectionSchema>

export type KanbanCardRenderState = { pending: boolean; dragging: boolean }
export type KanbanDragPreviewState = { count: number }

export const kanbanPropsSchema = blockBasePropsSchema
  .extend({
    columns: z.array(kanbanColumnSchema),
    reorderable: z.boolean().optional(),
    onMove: callbackSchema<(cardId: string, toColumnId: string, toIndex: number) => Promise<void>>(),
    canMove: callbackSchema<(cardId: string, toColumnId: string) => true | KanbanMoveRejection>().optional(),
    onLoadMoreColumn: callbackSchema<(columnId: string) => Promise<void>>().optional(),
    onCardOpen: callbackSchema<(cardId: string) => void>().optional(),
    renderCard: callbackSchema<(card: KanbanCard, state: KanbanCardRenderState) => React.ReactNode>(),
    renderDragPreview: callbackSchema<(card: KanbanCard, state: KanbanDragPreviewState) => React.ReactNode>().optional(),
    columnHeader: callbackSchema<(column: KanbanColumn) => React.ReactNode>().optional(),
    columnFooter: callbackSchema<(column: KanbanColumn) => React.ReactNode>().optional(),
    emptyColumn: callbackSchema<(column: KanbanColumn) => React.ReactNode>().optional(),
    trailing: slotSchema.optional(),
  })
  .refine((props) => hasUniqueIds(props.columns), { message: 'Column ids must be unique', path: ['columns'] })
  .refine((props) => hasUniqueIds(props.columns.flatMap((column) => column.cards)), {
    message: 'Card ids must be unique across the board',
    path: ['columns'],
  })
  .refine((props) => !props.columns.some((column) => column.hasMore) || props.onLoadMoreColumn !== undefined, {
    message: 'hasMore requires onLoadMoreColumn',
    path: ['onLoadMoreColumn'],
  })
export type KanbanProps = z.infer<typeof kanbanPropsSchema>
