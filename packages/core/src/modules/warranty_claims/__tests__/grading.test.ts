import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  assertDispositionAllowedForGrade,
  isRestockableGrade,
  suggestedDispositionForGrade,
  type ConditionGrade,
} from '../lib/grading'

describe('warranty claim grading', () => {
  test('marks A and B as restockable grades', () => {
    expect(isRestockableGrade('A')).toBe(true)
    expect(isRestockableGrade('B')).toBe(true)
    expect(isRestockableGrade('C')).toBe(false)
    expect(isRestockableGrade('D')).toBe(false)
  })

  test('blocks restock for C and D grades', () => {
    const blockedGrades: ConditionGrade[] = ['C', 'D']
    for (const grade of blockedGrades) {
      expect(() => assertDispositionAllowedForGrade(grade, 'restock')).toThrow(CrudHttpError)
      try {
        assertDispositionAllowedForGrade(grade, 'restock')
      } catch (error) {
        expect(error).toMatchObject({
          status: 400,
          body: { error: 'warranty_claims.errors.dispositionGradeConflict' },
        })
      }
    }
  })

  test('allows restock for A and B grades', () => {
    expect(() => assertDispositionAllowedForGrade('A', 'restock')).not.toThrow()
    expect(() => assertDispositionAllowedForGrade('B', 'restock')).not.toThrow()
  })

  test('allows non-restock dispositions for any grade and null grade', () => {
    const grades: Array<ConditionGrade | null> = ['A', 'B', 'C', 'D', null]
    for (const grade of grades) {
      expect(() => assertDispositionAllowedForGrade(grade, 'repair')).not.toThrow()
      expect(() => assertDispositionAllowedForGrade(grade, 'scrap')).not.toThrow()
      expect(() => assertDispositionAllowedForGrade(grade, null)).not.toThrow()
    }
  })

  test('suggests dispositions from grade', () => {
    expect(suggestedDispositionForGrade('A')).toBe('restock')
    expect(suggestedDispositionForGrade('B')).toBe('repair')
    expect(suggestedDispositionForGrade('C')).toBe('scrap')
    expect(suggestedDispositionForGrade('D')).toBe('scrap')
    expect(suggestedDispositionForGrade(null)).toBeNull()
    expect(suggestedDispositionForGrade(undefined)).toBeNull()
  })
})
