"use client"
import { Page, PageBody } from "@open-mercato/ui/backend/Page";
import * as React from 'react'
import { useFeatureToggleItem } from "@open-mercato/core/modules/feature_toggles/components/hooks/useFeatureToggleItem";
import { FeatureToggleDetailsCard } from "@open-mercato/core/modules/feature_toggles/components/FeatureToggleDetailsCard";
import { FeatureToggleOverrideCard } from "@open-mercato/core/modules/feature_toggles/components/FeatureToggleOverrideCard";

export default function FeatureToggleDetailsPage({ params }: { params?: { id?: string } }) {
  const id = params?.id ?? ''
  const { data: featureToggleItem } = useFeatureToggleItem(id)

  return (
    <Page>
      <PageBody>
        <FeatureToggleDetailsCard featureToggleItem={featureToggleItem ?? undefined} />
        {id && <FeatureToggleOverrideCard toggleId={id} />}
      </PageBody>
    </Page>
  )
}

