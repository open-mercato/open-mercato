'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

export default function SettingsPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/backend/config/system-status')
  }, [router])
  return <Spinner className="h-4 w-4" />
}
