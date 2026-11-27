"use client"
import { PortalPasswordForm } from '../PasswordForm'

export default function PortalVerifyPage({ params }: { params: { orgSlug: string } }) {
  return <PortalPasswordForm params={params} verify />
}
