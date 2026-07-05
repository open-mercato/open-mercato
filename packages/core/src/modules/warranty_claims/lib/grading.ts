import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

export type ConditionGrade = 'A' | 'B' | 'C' | 'D'

export function isRestockableGrade(grade: ConditionGrade | null | undefined): boolean {
  return grade === 'A' || grade === 'B'
}

export function assertDispositionAllowedForGrade(
  grade: ConditionGrade | null | undefined,
  disposition: string | null | undefined,
): void {
  if (disposition === 'restock' && (grade === 'C' || grade === 'D')) {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.dispositionGradeConflict' })
  }
}

export function suggestedDispositionForGrade(grade: ConditionGrade | null | undefined): string | null {
  if (grade === 'A') return 'restock'
  if (grade === 'B') return 'repair'
  if (grade === 'C' || grade === 'D') return 'scrap'
  return null
}
