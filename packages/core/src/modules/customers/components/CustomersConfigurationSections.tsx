"use client"

import * as React from 'react'
import { AddressFormatSettings } from './AddressFormatSettings'
import PipelineSettings from './PipelineSettings'
import DictionarySettings from './DictionarySettings'

function SettingsSectionSkeleton() {
  return <section className="min-h-32 rounded-lg border bg-background p-4" aria-hidden="true" />
}

export default function CustomersConfigurationSections() {
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <>
        <SettingsSectionSkeleton />
        <SettingsSectionSkeleton />
        <SettingsSectionSkeleton />
      </>
    )
  }

  return (
    <>
      <AddressFormatSettings />
      <PipelineSettings />
      <DictionarySettings />
    </>
  )
}
