'use client'

import { extensionPoints } from '@open-mercato/core/modules/sales/extension-points'
import { resolveExtensionPointPattern } from '@open-mercato/shared/modules/widgets/extension-points'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'

export type SalesDocumentExtensionContext<TRecord extends { id: string }> = {
  kind: 'order' | 'quote'
  documentId: string | null
  record: TRecord | null
  formId: string
  resourceKind: 'sales.order' | 'sales.quote'
  resourceId?: string
  retryLastMutation: () => Promise<boolean>
  organizationId: string | null
  tenantId: string | null
}

type SalesDocumentExtensionSpotProps<TRecord extends { id: string }> = {
  surface: 'stage-bar' | 'closure'
  context: SalesDocumentExtensionContext<TRecord>
  data: TRecord
  onDataChange: (data: TRecord) => void
}

export function SalesDocumentExtensionSpot<TRecord extends { id: string }>({
  surface,
  context,
  data,
  onDataChange,
}: SalesDocumentExtensionSpotProps<TRecord>) {
  const pattern = surface === 'stage-bar'
    ? extensionPoints.hosts.documentStageBar.pattern
    : extensionPoints.hosts.documentClosure.pattern

  return (
    <InjectionSpot
      spotId={resolveExtensionPointPattern(pattern, { kind: context.kind })}
      context={context}
      data={data}
      onDataChange={onDataChange}
    />
  )
}
