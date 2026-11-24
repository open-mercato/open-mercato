import type * as React from 'react'
import { z } from 'zod'
import { blockBasePropsSchema, callbackSchema, hasUniqueIds, slotSchema } from './shared'

export const kanbanCardSchema = z.looseObject({ id: z.string().min(1) })
export type KanbanCard = z.infer<typeof kanbanCardSchema>

export const kanbanColumnSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  count: z.number().int().nonnegative().optional(),
  summary: slotSchema.optional(),
  hasMore: z.boolean().optional(),
  cards: z.array(kanbanCardSchema),
})
export type KanbanColumn = z.infer<typeof kanbanColumnSchema>

export const kanbanMoveRejectionSchema = z.object({ reason: z.string().min(1) })
export type KanbanMoveRejection = z.infer<typeof kanbanMoveRejectionSchema>

export const kanbanPropsSchema = blockBasePropsSchema
  .extend({
    columns: z.array(kanbanColumnSchema),
    onMove: callbackSchema<(cardId: string, toColumnId: string, toIndex: number) => Promise<void>>(),
    canMove: callbackSchema<(cardId: string, toColumnId: string) => true | KanbanMoveRejection>().optional(),
    onLoadMoreColumn: callbackSchema<(columnId: string) => Promise<void>>().optional(),
    onCardOpen: callbackSchema<(cardId: string) => void>().optional(),
    renderCard: callbackSchema<(card: KanbanCard) => React.ReactNode>(),
    columnHeader: callbackSchema<(column: KanbanColumn) => React.ReactNode>().optional(),
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
