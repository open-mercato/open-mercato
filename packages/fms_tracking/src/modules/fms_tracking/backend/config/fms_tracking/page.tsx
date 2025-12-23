"use client";
import { Page, PageHeader, PageBody } from "@open-mercato/ui/backend/Page";
import { useT } from "@/lib/i18n/context";
import FreighttechTrackingSettings from "./freighttech";


export default function FreightTrackingAdminIndex() {
  const t = useT();

  return (
    <Page>
      <PageHeader title={t("fms_tracking.settings.configuration")} />
      <PageBody>
          <FreighttechTrackingSettings />
      </PageBody>
    </Page>
  );
}
