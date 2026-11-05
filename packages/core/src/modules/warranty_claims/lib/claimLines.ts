import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type ClaimLinesPage = {
  items?: unknown[]
  totalPages?: number
}

export async function loadClaimLines(claimId: string, errorMessage: string): Promise<{ items: unknown[] }> {
  const readPage = (page: number) => readApiResultOrThrow<ClaimLinesPage>(
    `/api/warranty_claims/lines?claimId=${encodeURIComponent(claimId)}&page=${page}&pageSize=100&sortField=lineNo&sortDir=asc`,
    undefined,
    { fallback: { items: [] }, errorMessage },
  )
  const firstPage = await readPage(1)
  const items = [...(firstPage.items ?? [])]
  const totalPages = firstPage.totalPages ?? 1
  for (let page = 2; page <= totalPages; page += 1) {
    const payload = await readPage(page)
    items.push(...(payload.items ?? []))
  }
  return { items }
}
