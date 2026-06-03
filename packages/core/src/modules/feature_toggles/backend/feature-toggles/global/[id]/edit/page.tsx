"use client"
import { Page, PageBody } from "@open-mercato/ui/backend/Page";
import { CrudForm } from "@open-mercato/ui/backend/CrudForm";
import { E } from "#generated/entities.ids.generated";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import * as React from 'react'
import { updateCrud } from "@open-mercato/ui/backend/utils/crud";
import { useFeatureToggleItem } from "@open-mercato/core/modules/feature_toggles/components/hooks/useFeatureToggleItem";
import { createFieldDefinitions, createFormGroups } from "@open-mercato/core/modules/feature_toggles/components/formConfig";


export default function EditFeatureTogglePage({ params }: { params?: { id?: string } }) {
  const { id } = params ?? {}
  const t = useT()
  const fields = createFieldDefinitions(t);
  const formGroups = createFormGroups(t);

  const { data: featureToggleItem, isLoading } = useFeatureToggleItem(id)

  // Derive the form's initial values synchronously from the loaded record. Using
  // a useState+useEffect here caused #2452: `isLoading` flips to false one render
  // before the effect set `initialValues`, so CrudForm mounted with `{}` and the
  // `type` SELECT captured an empty value (text inputs re-sync from the prop, the
  // select does not). Deriving here means the value is present in the same render
  // the data arrives; the `key` below also forces a clean remount on load.
  const initialValues = React.useMemo(() => {
    if (!featureToggleItem) return null
    return {
      id: featureToggleItem.id ?? (id ? String(id) : ''),
      identifier: featureToggleItem.identifier,
      name: featureToggleItem.name,
      description: featureToggleItem.description,
      category: featureToggleItem.category,
      type: featureToggleItem.type,
      defaultValue: featureToggleItem.defaultValue,
    }
  }, [featureToggleItem, id])

  return (
    <Page>
      <PageBody>
        <CrudForm
          key={initialValues ? 'ft-edit-loaded' : 'ft-edit-loading'}
          title={t('feature_toggles.form.title.edit', 'Edit Feature Toggle')}
          backHref="/backend/feature-toggles/global"
          versionHistory={{ resourceKind: 'feature_toggles.global', resourceId: id ? String(id) : '' }}
          fields={fields}
          entityId={E.feature_toggles.feature_toggle}
          initialValues={initialValues ?? {}}
          optimisticLockUpdatedAt={featureToggleItem?.updatedAt ?? null}
          isLoading={isLoading}
          groups={formGroups}
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

              type: values.type,
              defaultValue: values.defaultValue,
            }
            await updateCrud('feature_toggles/global', payload)
          }}
        />
      </PageBody>
    </Page>
  )
}
