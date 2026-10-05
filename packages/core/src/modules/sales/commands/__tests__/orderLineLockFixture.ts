type OrderLineLockQuery = {
  select: (column: string) => OrderLineLockQuery
  where: (column: string, operator: '=' | 'is', value: string | null) => OrderLineLockQuery
  forNoKeyUpdate: () => OrderLineLockQuery
  executeTakeFirst: () => Promise<{ id: string }>
}

export function createOrderLineLockKyselyFixture(orderId: string) {
  const query: OrderLineLockQuery = {
    select: () => query,
    where: () => query,
    forNoKeyUpdate: () => query,
    executeTakeFirst: async () => ({ id: orderId }),
  }
  return { selectFrom: () => query }
}
