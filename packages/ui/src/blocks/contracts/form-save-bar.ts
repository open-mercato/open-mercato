import { z } from 'zod'
import {
  blockActionSchema,
  blockBasePropsSchema,
  callbackSchema,
  hasUniqueKeys,
  isoDateTimeSchema,
  slotSchema,
} from './shared'

export const formSaveStateSchema = z.enum(['idle', 'dirty', 'saving', 'saved', 'failed'])
export type FormSaveState = z.infer<typeof formSaveStateSchema>

export const formSaveBarPlacementSchema = z.enum(['floating', 'container', 'inline'])
export type FormSaveBarPlacement = z.infer<typeof formSaveBarPlacementSchema>

export const formSaveBarPropsSchema = blockBasePropsSchema
  .extend({
    saveState: formSaveStateSchema,
    message: z.string().min(1).optional(),
    savedAt: isoDateTimeSchema.optional(),
    formId: z.string().min(1).optional(),
    onSave: callbackSchema<() => void | Promise<void>>().optional(),
    saveLabel: z.string().min(1).optional(),
    resetLabel: z.string().min(1).optional(),
    saveDisabledReason: z.string().min(1).optional(),
    onReset: callbackSchema<() => void>().optional(),
    actions: z.array(blockActionSchema).optional(),
    onAction: callbackSchema<(actionKey: string) => void | Promise<void>>().optional(),
    placement: formSaveBarPlacementSchema.optional(),
    alwaysVisible: z.boolean().optional(),
    leading: slotSchema.optional(),
    trailing: slotSchema.optional(),
  })
  .refine((props) => hasUniqueKeys(props.actions), { message: 'Action keys must be unique', path: ['actions'] })
  .refine((props) => props.formId !== undefined || props.onSave !== undefined, {
    message: 'formId or onSave is required',
    path: ['onSave'],
  })
  .refine((props) => !props.actions?.length || props.onAction !== undefined, {
    message: 'actions require onAction',
    path: ['onAction'],
  })
export type FormSaveBarProps = z.infer<typeof formSaveBarPropsSchema>
