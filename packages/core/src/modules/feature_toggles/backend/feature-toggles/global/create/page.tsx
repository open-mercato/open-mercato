"use client"
import { Page, PageBody } from "@open-mercato/ui/backend/Page";
import { CrudForm } from "@open-mercato/ui/backend/CrudForm";
import { createCrud } from "@open-mercato/ui/backend/utils/crud";
import { useRouter } from "next/navigation";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import { createFormGroups, createFieldDefinitions } from "../../../../components/formConfig";

export default function CreateFeatureTogglePage() {
  const router = useRouter();
  const t = useT();

  const initialValues = {
    identifier: '',
    name: '',
    description: '',
    category: '',
    type: '',
    defaultValue: null,
  }

  const fields = createFieldDefinitions(t);
  const formGroups = createFormGroups(t);

  return (
    <Page>
      <PageBody>
        <CrudForm
          title="Create Feature Toggle"
          backHref="/backend/feature-toggles/global"
          fields={fields}
          groups={formGroups}
          initialValues={initialValues}
          onSubmit={async (values) => {
            const payload: Record<string, unknown> = {
              identifier: values.identifier,
              name: values.name,
              description: values.description,
              category: values.category,
              type: values.type,
              defaultValue: values.defaultValue,
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
