"use client"

import * as React from 'react'
import { PublicFormRunnerPage } from '../../../ui/public'

export default function OpenLinkFormRunnerPage({ params }: { params?: { slug?: string } }) {
  const slug = params?.slug ?? ''
  if (!slug) return null
  return <PublicFormRunnerPage mode="open" slug={slug} />
}
