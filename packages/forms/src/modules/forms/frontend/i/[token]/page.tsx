"use client"

import * as React from 'react'
import { useParams } from 'next/navigation'
import { PublicFormRunnerPage } from '../../../ui/public'

export default function PersonalInvitationFormRunnerPage() {
  const params = useParams<{ token: string }>()
  const token = String(params?.token ?? '')
  return <PublicFormRunnerPage mode="personal" token={token} />
}
