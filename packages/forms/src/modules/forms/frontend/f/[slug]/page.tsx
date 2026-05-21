"use client"

import * as React from 'react'
import { useParams } from 'next/navigation'
import { PublicFormRunnerPage } from '../../../ui/public'

export default function OpenLinkFormRunnerPage() {
  const params = useParams<{ slug: string }>()
  const slug = String(params?.slug ?? '')
  return <PublicFormRunnerPage mode="open" slug={slug} />
}
