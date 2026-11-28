type SalesDocumentLockQuery = {
  select: (column: string) => SalesDocumentLockQuery
  where: (column: string, operator: '=' | 'is', value: string | null) => SalesDocumentLockQuery
  forNoKeyUpdate: () => SalesDocumentLockQuery
  executeTakeFirst: () => Promise<{ id: string }>
}

export function createSalesDocumentLockKyselyFixture(documentId: string) {
  const query: SalesDocumentLockQuery = {
    select: () => query,
    where: () => query,
    forNoKeyUpdate: () => query,
    executeTakeFirst: async () => ({ id: documentId }),
  }
  return { selectFrom: () => query }
}
