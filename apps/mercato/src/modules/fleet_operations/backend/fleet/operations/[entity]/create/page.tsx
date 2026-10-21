"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  buildOperationsEntityConfigs,
  isOperationsEntityKey,
  toPayload,
  type OperationsEntityKey,
} from '../../../../../lib/entityConfig'

export default function CreateOperationsRecordPage({ params }: { params?: { entity?: string } }) {
  const t = useT()
  const entityKey = params?.entity ?? ''
  if (!isOperationsEntityKey(entityKey)) {
    return (
      <Page>
        <PageBody>
          <p className="text-sm text-muted-foreground">{t('fleet_operations.errors.unknownEntity', 'Unknown operations record type.')}</p>
        </PageBody>
      </Page>
    )
  }
  return <CreateOperationsRecordForm entityKey={entityKey} />
}

function CreateOperationsRecordForm({ entityKey }: { entityKey: OperationsEntityKey }) {
  const t = useT()
  const router = useRouter()
  const configs = buildOperationsEntityConfigs(t)
  const config = configs[entityKey]
  const initialValues = React.useMemo(() => {
    const values: Record<string, unknown> = {}
    for (const field of config.fields) {
      if (field.type !== 'custom' && field.defaultValue !== undefined) values[field.id] = field.defaultValue
    }
    return values
  }, [config.fields])

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={`${t('fleet_operations.list.new', 'New record')} — ${config.title}`}
          titleHeadingLevel={1}
          backHref="/backend/fleet/operations"
          fields={config.fields}
          initialValues={initialValues}
          submitLabel={t('fleet_operations.form.create', 'Create')}
          cancelHref="/backend/fleet/operations"
          onSubmit={async (values) => {
            await createCrud(config.apiPath.replace(/^\/api\//, ''), toPayload(values as Record<string, unknown>))
            flash(t('fleet_operations.form.created', 'Record created.'), 'success')
            router.push(`/backend/fleet/operations?tab=${config.key}`)
          }}
        />
      </PageBody>
    </Page>
  )
}
