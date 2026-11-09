"use client"

import * as React from 'react'
import { PublicFormRunnerPage } from '../../../ui/public'

export default function PersonalInvitationFormRunnerPage({ params }: { params?: { token?: string } }) {
  const token = params?.token ?? ''
  if (!token) return null
  return <PublicFormRunnerPage mode="personal" token={token} />
}
