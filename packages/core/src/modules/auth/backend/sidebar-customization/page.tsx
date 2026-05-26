'use client'
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { SidebarCustomizationEditor } from '@open-mercato/ui/backend/sidebar/SidebarCustomizationEditor'

export default function SidebarCustomizationPage() {
  const router = useRouter()
  const goBack = React.useCallback(() => {
    router.push('/backend/settings')
  }, [router])

  return (
    <div className="space-y-4">
      <SidebarCustomizationEditor onCanceled={goBack} />
    </div>
  )
}
