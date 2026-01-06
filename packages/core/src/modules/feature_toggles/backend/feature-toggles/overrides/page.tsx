"use client"

import { Page, PageBody } from "@open-mercato/ui/backend/Page";
import { ContextHelp } from "@open-mercato/ui/backend/ContextHelp";
import { useT } from "@/lib/i18n/context";
import OverridesTable from "../../../components/OverridesTable";

export default function FeatureToggleOverridesPage() {
  const t = useT()

  return (
    <Page>
      <PageBody>
        <OverridesTable />
      </PageBody>
    </Page>
  )
}

