"use client"

import * as React from 'react'
import { FormStudio } from './FormStudio'

export default function FormStudioPage({ params }: { params?: { id?: string } }) {
  const formId = params?.id ?? ''
  if (!formId) return null
  return <FormStudio formId={formId} />
}
