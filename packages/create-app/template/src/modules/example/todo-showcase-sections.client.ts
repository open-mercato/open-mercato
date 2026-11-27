'use client'

import { z } from 'zod'
import { defineCrudFormFieldGranularSection } from '@open-mercato/ui/backend/crud-form-field-granular'

export const titleSection = defineCrudFormFieldGranularSection({
  id: 'example.todo-title',
  roundTripId: 'example.todo-title@v1',
  group: { id: 'title', title: 'example.todos.form.fields.title.label' },
  fields: [{ id: 'title', type: 'text', label: 'example.todos.form.fields.title.label', labelKey: 'example.todos.form.fields.title.label', required: true }],
  fieldPayloadPaths: { title: ['title'] },
  fieldSchemas: { title: z.string().trim().min(1).max(200) },
  projectField: { title: (value) => ({ title: value }) },
  refinements: [],
})

export const detailsSection = defineCrudFormFieldGranularSection({
  id: 'example.todo-details',
  roundTripId: 'example.todo-details@v2',
  group: { id: 'details', title: 'example.todos.form.groups.details' },
  fields: [
    { id: 'notes', type: 'textarea', label: 'example.todos.form.fields.notes.label', labelKey: 'example.todos.form.fields.notes.label' },
    { id: 'cf_priority', type: 'number', label: 'example.todos.table.column.priority', labelKey: 'example.todos.table.column.priority' },
    {
      id: 'cf_severity', type: 'select', label: 'example.todos.table.column.severity', labelKey: 'example.todos.table.column.severity',
      options: [
        { value: 'low', label: 'example.todoShowcase.severity.low', labelKey: 'example.todoShowcase.severity.low' },
        { value: 'medium', label: 'example.todoShowcase.severity.medium', labelKey: 'example.todoShowcase.severity.medium' },
        { value: 'high', label: 'example.todoShowcase.severity.high', labelKey: 'example.todoShowcase.severity.high' },
      ],
    },
  ],
  ownedCustomFieldIds: ['priority', 'severity'],
  customFieldDefinitionSetId: 'example.todo-showcase-fields',
  fieldPayloadPaths: { notes: ['notes'], cf_priority: ['customFields.priority'], cf_severity: ['customFields.severity'] },
  fieldSchemas: {
    notes: z.string().max(4000).nullable().optional(),
    cf_priority: z.preprocess((value) => value === '' || value == null ? undefined : Number(value), z.number().int().min(1).max(5).optional()),
    cf_severity: z.enum(['low', 'medium', 'high']).optional(),
  },
  projectField: {
    notes: (value) => value === undefined ? {} : { notes: value },
    cf_priority: (value) => value === undefined ? {} : { customFields: { priority: value } },
    cf_severity: (value) => value === undefined ? {} : { customFields: { severity: value } },
  },
  refinements: [],
})

export const statusSection = defineCrudFormFieldGranularSection({
  id: 'example.todo-status',
  roundTripId: 'example.todo-status@v1',
  group: { id: 'status', title: 'example.todos.form.groups.status' },
  fields: [{ id: 'is_done', type: 'checkbox', label: 'example.todos.form.fields.isDone.label', labelKey: 'example.todos.form.fields.isDone.label' }],
  fieldPayloadPaths: { is_done: ['is_done'] },
  fieldSchemas: { is_done: z.boolean().default(false) },
  refinements: [],
  projectField: { is_done: (value) => ({ is_done: value }) },
})
