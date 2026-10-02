import { resolveSeedProjectId } from '../resolveSeedProjectId'

const NONE = {
  runningProjectId: null,
  lastProjectId: null,
  visibleProjectIds: [],
  assignedProjectIds: [],
}

describe('resolveSeedProjectId', () => {
  describe('each rung in isolation', () => {
    it('rung 1 — seeds the running timer project', () => {
      expect(
        resolveSeedProjectId({
          ...NONE,
          runningProjectId: 'p-1',
          assignedProjectIds: ['p-1', 'p-2', 'p-3'],
        }),
      ).toBe('p-1')
    })

    it('rung 2 — seeds the persisted last-started project', () => {
      expect(
        resolveSeedProjectId({
          ...NONE,
          lastProjectId: 'p-2',
          assignedProjectIds: ['p-1', 'p-2', 'p-3'],
        }),
      ).toBe('p-2')
    })

    it('rung 3 — seeds the sole grid-visible project', () => {
      expect(
        resolveSeedProjectId({
          ...NONE,
          visibleProjectIds: ['p-3'],
          assignedProjectIds: ['p-1', 'p-2', 'p-3'],
        }),
      ).toBe('p-3')
    })

    it('rung 4 — seeds the sole assigned project', () => {
      expect(
        resolveSeedProjectId({ ...NONE, assignedProjectIds: ['p-9'] }),
      ).toBe('p-9')
    })

    it('rung 5 — seeds nothing when several assigned projects are equally plausible', () => {
      expect(
        resolveSeedProjectId({ ...NONE, assignedProjectIds: ['p-1', 'p-2'] }),
      ).toBeNull()
    })
  })

  describe('precedence', () => {
    it('rung 1 beats rungs 2, 3 and 4', () => {
      expect(
        resolveSeedProjectId({
          runningProjectId: 'p-run',
          lastProjectId: 'p-last',
          visibleProjectIds: ['p-visible'],
          assignedProjectIds: ['p-run', 'p-last', 'p-visible'],
        }),
      ).toBe('p-run')
    })

    it('rung 2 beats rungs 3 and 4', () => {
      expect(
        resolveSeedProjectId({
          runningProjectId: null,
          lastProjectId: 'p-last',
          visibleProjectIds: ['p-visible'],
          assignedProjectIds: ['p-last', 'p-visible'],
        }),
      ).toBe('p-last')
    })

    it('rung 3 beats rung 4 when it can apply at all', () => {
      // Rung 4 cannot fire here anyway (two assigned), which is the point:
      // grid visibility is the only thing that disambiguates.
      expect(
        resolveSeedProjectId({
          ...NONE,
          visibleProjectIds: ['p-2'],
          assignedProjectIds: ['p-1', 'p-2'],
        }),
      ).toBe('p-2')
    })
  })

  describe('ambiguity', () => {
    it('two visible projects yield null rather than a guess', () => {
      expect(
        resolveSeedProjectId({
          ...NONE,
          visibleProjectIds: ['p-1', 'p-2'],
          assignedProjectIds: ['p-1', 'p-2', 'p-3'],
        }),
      ).toBeNull()
    })

    it('counts only visible projects the picker can display', () => {
      // Two rows are visible in the grid but one is no longer assigned, so the
      // picker offers exactly one candidate and there is nothing to guess between.
      expect(
        resolveSeedProjectId({
          ...NONE,
          visibleProjectIds: ['p-1', 'p-stale'],
          assignedProjectIds: ['p-1', 'p-2'],
        }),
      ).toBe('p-1')
    })

    it('ignores duplicate ids when counting candidates', () => {
      expect(
        resolveSeedProjectId({
          ...NONE,
          visibleProjectIds: ['p-1', 'p-1'],
          assignedProjectIds: ['p-1', 'p-1', 'p-2'],
        }),
      ).toBe('p-1')
    })
  })

  describe('the not-assignable guard applies at every rung', () => {
    it('rejects a running project the picker cannot display', () => {
      expect(
        resolveSeedProjectId({
          ...NONE,
          runningProjectId: 'p-gone',
          assignedProjectIds: ['p-1', 'p-2'],
        }),
      ).toBeNull()
    })

    it('rejects a stale persisted project and does not fall through to it', () => {
      expect(
        resolveSeedProjectId({
          ...NONE,
          lastProjectId: 'p-gone',
          assignedProjectIds: ['p-1', 'p-2'],
        }),
      ).toBeNull()
    })

    it('rejects a visible project that is no longer assigned', () => {
      expect(
        resolveSeedProjectId({
          ...NONE,
          visibleProjectIds: ['p-gone'],
          assignedProjectIds: ['p-1', 'p-2'],
        }),
      ).toBeNull()
    })

    it('falls through from a rejected rung to a lower one that still holds', () => {
      expect(
        resolveSeedProjectId({
          runningProjectId: 'p-gone',
          lastProjectId: 'p-also-gone',
          visibleProjectIds: [],
          assignedProjectIds: ['p-only'],
        }),
      ).toBe('p-only')
    })
  })

  describe('empty inputs', () => {
    it('returns null when nothing is assigned', () => {
      expect(resolveSeedProjectId(NONE)).toBeNull()
    })

    it('returns null when nothing is assigned even with a running timer', () => {
      expect(
        resolveSeedProjectId({ ...NONE, runningProjectId: 'p-1', lastProjectId: 'p-1' }),
      ).toBeNull()
    })

    it('treats empty-string ids as absent', () => {
      expect(
        resolveSeedProjectId({
          ...NONE,
          runningProjectId: '',
          lastProjectId: '',
          assignedProjectIds: ['p-1', 'p-2'],
        }),
      ).toBeNull()
    })
  })
})
