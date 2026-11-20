'use client'

import { z } from 'zod'
import { TodoShowcaseSync } from './components/TodoShowcaseSync'
import { defineCrudFormFieldGranularSection } from '@open-mercato/ui/backend/crud-form-field-granular'

export const crudFormSectionRuntime = defineCrudFormFieldGranularSection({
  id: 'example.todo-showcase-status',
  roundTripId: 'example.todo-showcase-status@v2',
  group: { id: 'status', title: 'example.todoShowcase.groups.status', component: TodoShowcaseSync },
  fields: [{ id: 'is_done', type: 'checkbox', label: 'example.todoShowcase.fields.done', labelKey: 'example.todoShowcase.fields.done' }],
  fieldPayloadPaths: { is_done: ['is_done'] },
  fieldSchemas: { is_done: z.boolean().default(false) },
  refinements: [],
  projectField: { is_done: (value) => ({ is_done: value }) },
})
