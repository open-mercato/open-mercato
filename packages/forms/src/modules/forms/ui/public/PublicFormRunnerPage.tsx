"use client"

import * as React from 'react'
import { EmbeddedForm, type EmbeddedFormSource } from './EmbeddedForm'

/**
 * Shared bootstrap for the two public runner entry points (`/f/:slug` open
 * links and `/i/:token` personal invitations). It delegates the entire
 * resolve-context → start → mount flow to the shared `<EmbeddedForm>` primitive
 * and supplies only the minimal centered page chrome. No portal auth.
 */
export type PublicFormRunnerPageProps =
  | { mode: 'open'; slug: string }
  | { mode: 'personal'; token: string }

export function PublicFormRunnerPage(props: PublicFormRunnerPageProps) {
  const source: EmbeddedFormSource =
    props.mode === 'open'
      ? { kind: 'distribution', slug: props.slug }
      : { kind: 'invitation', token: props.token }
  return (
    <PublicLayout>
      <EmbeddedForm source={source} />
    </PublicLayout>
  )
}

function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-2xl">{children}</div>
    </main>
  )
}
