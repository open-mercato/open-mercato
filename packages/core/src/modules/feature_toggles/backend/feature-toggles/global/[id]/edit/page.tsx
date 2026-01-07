"use client"
import { Page, PageBody } from "@open-mercato/ui/backend/Page";
import { CrudField, CrudForm } from "@open-mercato/ui/backend/CrudForm";
import { E } from "@open-mercato/core/generated/entities.ids.generated";
import { useT } from "@/lib/i18n/context";
import * as React from 'react'
import { updateCrud } from "@open-mercato/ui/backend/utils/crud";
import { FeatureToggleItem, useFeatureToggleItem } from "@open-mercato/core/modules/feature_toggles/components/hooks/useFeatureToggleItem";


type FeatureToggleItemFormValues = {
    identifier: string
    name: string
    description: string
    category: string
    default_state: 'enabled' | 'disabled'
    fail_mode: 'fail_open' | 'fail_closed'
}

export default function EditFeatureTogglePage({ params }: { params?: { id?: string } }) {
    const [initialValues, setInitialValues] = React.useState<FeatureToggleItemFormValues | null>(null)
    const { id } = params ?? {}
    const t = useT()
    const fields: CrudField[] = [
        { id: 'identifier', label: 'Identifier', type: 'text', required: true },
        { id: 'name', label: 'Name', type: 'text', required: true },
        { id: 'description', label: 'Description', type: 'textarea', required: false },
        { id: 'category', label: 'Category', type: 'text', required: true },
        { id: 'default_state', label: 'Default State', type: 'select', required: true, options: [
            { label: 'Enabled', value: 'enabled' },
            { label: 'Disabled', value: 'disabled' },
        ] },
        { id: 'fail_mode', label: 'Fail Mode', type: 'select', required: true, options: [
            { label: 'Fail Open', value: 'fail_open' },
            { label: 'Fail Closed', value: 'fail_closed' },
        ] },
    ]
    
    const { data: featureToggleItem, isLoading } = useFeatureToggleItem(id)

    React.useEffect(() => {
        if (featureToggleItem) {
            setInitialValues({
                identifier: featureToggleItem.identifier,
                name: featureToggleItem.name,
                description: featureToggleItem.description,
                category: featureToggleItem.category,
                default_state: featureToggleItem.default_state ? 'enabled' : 'disabled',
                fail_mode: featureToggleItem.fail_mode as 'fail_open' | 'fail_closed',
            })
        }
    }, [featureToggleItem])

    return (
        <Page>
          <PageBody>
            <CrudForm
              title={t('feature_toggles.form.title.edit', 'Edit Feature Toggle')}
              backHref="/backend/feature-toggles/global"
              fields={fields}
              entityId={E.feature_toggles.feature_toggle}
              initialValues={initialValues ?? {}}
              isLoading={isLoading}
              loadingMessage={t('feature_toggles.form.loading', 'Loading feature toggles')}
              submitLabel={t('feature_toggles.form.action.save', 'Save')}
              cancelHref="/backend/feature-toggles/global"
              successRedirect={`/backend/feature-toggles/global`}
              onSubmit={async (values) => {
                if (!id) return
                const payload = {
                  id: id ? String(id) : '',
                  identifier: values.identifier,
                  name: values.name,
                  description: values.description,
                  category: values.category,
                  default_state: values.default_state === 'enabled' ? true : false,
                  failMode: values.fail_mode,
                }
                await updateCrud('feature_toggles/global', payload)
              }}
            />
          </PageBody>
        </Page>
      )
}
