'use client'

import { detailsSection, statusSection, titleSection } from './todo-showcase-sections.client'

export const crudFormSectionRuntime = {
  id: 'example.todo-showcase-update',
  roundTripId: 'example.todo-showcase-update@v4',
  sectionDescriptors: [titleSection, detailsSection, statusSection],
} as const
