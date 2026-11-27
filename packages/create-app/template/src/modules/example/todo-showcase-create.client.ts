'use client'

import { detailsSection, statusSection, titleSection } from './todo-showcase-sections.client'

export const crudFormSectionRuntime = {
  id: 'example.todo-showcase-create',
  roundTripId: 'example.todo-showcase-create@v4',
  sectionDescriptors: [titleSection, detailsSection, statusSection],
} as const
