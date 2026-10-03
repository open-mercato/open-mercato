"use client"

import * as React from 'react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'

const ResourceDocumentsPanel = React.lazy(
  () => import('@open-mercato/document-generators/modules/document_generators/components/ResourceDocumentsPanel'),
)

const RESOURCE_KIND = 'sales.quote'

type ResourceContext = { resourceKind?: unknown; resourceId?: unknown }

export const DocumentQuoteGeneratorsTabWidget: React.FC<InjectionWidgetComponentProps<unknown, unknown>> = ({ context }) => {
  const { resourceKind, resourceId } = (context ?? {}) as ResourceContext
  if (resourceKind !== RESOURCE_KIND || typeof resourceId !== 'string' || !resourceId) return null
  return (
    <React.Suspense
      fallback={
        <div className="flex h-24 items-center justify-center">
          <Spinner />
        </div>
      }
    >
      <ResourceDocumentsPanel resourceKind={RESOURCE_KIND} resourceId={resourceId} />
    </React.Suspense>
  )
}

export default DocumentQuoteGeneratorsTabWidget
