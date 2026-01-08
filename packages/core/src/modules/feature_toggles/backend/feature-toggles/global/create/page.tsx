"use client"
import { Page, PageBody } from "@open-mercato/ui/backend/Page";
import { CrudForm } from "@open-mercato/ui/backend/CrudForm";
import { CrudField } from "@open-mercato/ui/backend/CrudForm";
import { createCrud } from "@open-mercato/ui/backend/utils/crud";
import { useRouter } from "next/navigation";
export default function CreateFeatureTogglePage() {
  const router = useRouter()
  const initialValues = {
    defaultState: 'enabled',
    failMode: 'fail_closed',
    identifier: '',
    name: '',
    description: '',
    category: '',
  }

  const fields: CrudField[] = [
    { id: 'identifier', label: 'Identifier', type: 'text', required: true },
    { id: 'name', label: 'Name', type: 'text', required: true },
    { id: 'description', label: 'Description', type: 'textarea', required: false },
    { id: 'category', label: 'Category', type: 'text', required: false },
    {
      id: 'defaultState', label: 'Default State', type: 'select', required: true, options: [
        { label: 'Enabled', value: 'enabled' },
        { label: 'Disabled', value: 'disabled' },
      ]
    },
    {
      id: 'failMode', label: 'Fail Mode', type: 'select', required: true, options: [
        { label: 'Fail Open', value: 'fail_open' },
        { label: 'Fail Closed', value: 'fail_closed' },
      ]
    },
  ]

  return (
    <Page>
      <PageBody>
        <CrudForm
          title="Create Feature Toggle"
          backHref="/backend/feature-toggles/global"
          fields={fields}
          initialValues={initialValues}
          onSubmit={async (values) => {
            const defaultState =
              values.defaultState === 'enabled' ? true : values.defaultState === 'disabled' ? false : false

            const payload: Record<string, unknown> = {
              identifier: values.identifier,
              name: values.name,
              description: values.description,
              category: values.category,
              defaultState,
              failMode: values.failMode,
            }

            await createCrud<{ id?: string }>('feature_toggles/global', payload)
            router.push('/backend/feature-toggles/global')
            router.refresh()
          }}
        />
      </PageBody>
    </Page>
  )
}
