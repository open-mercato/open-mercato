"use client"
import { Page, PageBody } from "@open-mercato/ui/backend/Page";
import { FeatureTogglesTable } from "../../../components/FeatureTogglesTable";
import { ContextHelp } from "@open-mercato/ui/backend/ContextHelp";
import { useT } from "@open-mercato/shared/lib/i18n/context";

export default function FeatureTogglesPage() {
  const t = useT()
  return (
    <Page>
      <PageBody>
        <FeatureTogglesTable />
      </PageBody>
    </Page>
  )
}
