"use client"

import * as React from 'react'
import { DistributionsPanel } from '../../../../ui/admin/forms/[id]/distributions/DistributionsPanel'

export default function FormDistributionsPage({ params }: { params?: { id?: string } }) {
  const formId = params?.id ?? ''
  return <DistributionsPanel formId={formId} />
}
