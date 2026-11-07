"use client"

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import CategorySuggestionsDataTable from '../../../components/categorySuggestions/CategorySuggestionsDataTable'

export default function CatalogCategorySuggestionsPage() {
  return (
    <Page>
      <PageBody>
        <CategorySuggestionsDataTable />
      </PageBody>
    </Page>
  )
}
