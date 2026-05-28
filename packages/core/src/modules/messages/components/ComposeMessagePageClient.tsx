"use client"

import { useRouter } from 'next/navigation'
import { MessageComposer } from '@open-mercato/ui/backend/messages'
// UMES extension surface — compose page injection spot (SPEC-045d §9.3a).
// Channel provider packages inject "composer capabilities" widgets here
// (character limit warnings, channel format selector, attachment scoping, etc.).
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'

export function ComposeMessagePageClient() {
  const router = useRouter()

  return (
    <div className="space-y-4">
      {/*
        Standalone widget mount above the composer — NOT CrudForm field
        resolution. This page is not a CrudForm, so the `crud-form:*:fields`
        field-event pipeline (onFieldChange, value transformers, etc.) does
        not apply here. Provider packages render composer-capability widgets
        (character-limit warnings, channel format selectors, attachment
        scoping) into this spot purely as additional UI siblings.
      */}
      <InjectionSpot
        spotId="crud-form:messages:message:fields"
        context={{ form: 'compose' }}
        data={{}}
      />
      <MessageComposer
        inline
        variant="compose"
        onCancel={() => {
          router.push('/backend/messages')
        }}
        onSuccess={(result) => {
          router.push('/backend/messages')
        }}
      />
    </div>
  )
}
