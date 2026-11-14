type EntityManagerOperations = Record<string, unknown>

export type TransactionalEntityManagerDouble = EntityManagerOperations & {
  begin: () => Promise<void>
  commit: () => Promise<void>
  rollback: () => Promise<void>
  isInTransaction: () => boolean
  transactional: <Result>(
    callback: (entityManager: TransactionalEntityManagerDouble) => Promise<Result> | Result,
  ) => Promise<Result>
  fork: () => TransactionalEntityManagerDouble
}

export function createTransactionalEntityManagerDouble<Operations extends EntityManagerOperations>(
  operations: Operations,
): Operations & TransactionalEntityManagerDouble {
  const createManager = (): Operations & TransactionalEntityManagerDouble => {
    let transactionActive = false
    const manager = {
      // Raw-SQL seams used by encryption policy lookups and other helpers that
      // bypass the ORM; tests override these when they need real rows.
      execute: async () => [],
      getConnection: () => ({ execute: async () => [] }),
      ...operations,
      begin: async () => {
        transactionActive = true
      },
      commit: async () => {
        transactionActive = false
      },
      rollback: async () => {
        transactionActive = false
      },
      isInTransaction: () => transactionActive,
      transactional: async <Result>(
        callback: (entityManager: TransactionalEntityManagerDouble) => Promise<Result> | Result,
      ): Promise<Result> => {
        const transactionalManager = createManager()
        await transactionalManager.begin()
        try {
          const result = await callback(transactionalManager)
          await transactionalManager.commit()
          return result
        } catch (error) {
          await transactionalManager.rollback()
          throw error
        }
      },
      fork: () => createManager(),
    }
    return manager
  }

  return createManager()
}
