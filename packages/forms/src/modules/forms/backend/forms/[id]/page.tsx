"use client"

import * as React from 'react'
import { useParams } from 'next/navigation'
import { FormStudio } from './FormStudio'

export default function FormStudioPage() {
  const params = useParams<{ id: string }>()
  const formId = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params!.id[0] : ''
  if (!formId) return null
  return <FormStudio formId={formId} />
}
