import { isUsableDefaultAssigneeMembership } from '../ProjectFormSections'
import {
  DEFAULT_ASSIGNEE_PAGE_SIZE,
  chunkIds,
  classifyDefaultAssigneeCandidates,
  collectProjectMemberships,
  readProjectMembershipPage,
  resolveSelectedDefaultAssignee,
  type ProjectMemberRow,
  type ProjectMembershipPage,
} from '../projectDefaultAssignee'

const NOW = new Date(2026, 9, 14, 12, 0, 0)

describe('isUsableDefaultAssigneeMembership', () => {
  it('accepts an active, open-ended membership', () => {
    expect(isUsableDefaultAssigneeMembership({ status: 'active' }, 14, NOW)).toBe(true)
  })

  it('refuses a membership that is not active', () => {
    expect(isUsableDefaultAssigneeMembership({ status: 'inactive' }, 14, NOW)).toBe(false)
    expect(isUsableDefaultAssigneeMembership({}, 14, NOW)).toBe(false)
  })

  it('refuses a membership that has not started yet', () => {
    expect(isUsableDefaultAssigneeMembership({ status: 'active', assigned_start_date: '2026-10-20' }, 14, NOW)).toBe(false)
  })

  it('keeps an ended membership usable through the grace days, then refuses it', () => {
    expect(isUsableDefaultAssigneeMembership({ status: 'active', assigned_end_date: '2026-10-04' }, 14, NOW)).toBe(true)
    expect(isUsableDefaultAssigneeMembership({ status: 'active', assignedEndDate: '2026-09-20' }, 14, NOW)).toBe(false)
    expect(isUsableDefaultAssigneeMembership({ status: 'active', assigned_end_date: '2026-10-13' }, 0, NOW)).toBe(false)
  })
})

describe('default assignee membership pagination', () => {
  const SELECTED = '66666666-6666-4666-8666-666666666601'
  const OTHER = '66666666-6666-4666-8666-666666666602'

  function historicalPage(): ProjectMemberRow[] {
    return Array.from({ length: DEFAULT_ASSIGNEE_PAGE_SIZE }, (_, index) => ({
      staffMemberId: index % 2 === 0 ? SELECTED : `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`,
      status: 'inactive',
    }))
  }

  const pages: ProjectMembershipPage[] = [
    { items: historicalPage(), totalPages: 2 },
    {
      items: [
        { staffMemberId: SELECTED, status: 'active' },
        { staff_member_id: OTHER, status: 'active', assigned_start_date: '2026-01-01' },
      ],
      totalPages: 2,
    },
  ]

  it('traverses every membership page and keeps members eligible beyond page one', async () => {
    const fetchPage = jest.fn(async (page: number) => pages[page - 1])

    const collection = await collectProjectMemberships(fetchPage)
    const candidates = classifyDefaultAssigneeCandidates(collection.rows, 14, NOW)

    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(collection.truncated).toBe(false)
    expect(candidates).toEqual(expect.arrayContaining([
      { staffMemberId: SELECTED, active: true },
      { staffMemberId: OTHER, active: true },
    ]))
    expect(resolveSelectedDefaultAssignee(candidates, SELECTED, collection.truncated)).toEqual({
      candidate: { staffMemberId: SELECTED, active: true },
      unusable: false,
    })
    expect(resolveSelectedDefaultAssignee(candidates, OTHER, collection.truncated).unusable).toBe(false)
  })

  it('stops on a short page when the total is unknown', async () => {
    const fetchPage = jest.fn(async () => ({ items: [{ staffMemberId: OTHER, status: 'active' }], totalPages: null }))
    const collection = await collectProjectMemberships(fetchPage)
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(collection.truncated).toBe(false)
  })

  it('stops at the page cap and does not call an unseen selection unusable', async () => {
    const fetchPage = jest.fn(async () => ({ items: historicalPage(), totalPages: 50 }))
    const collection = await collectProjectMemberships(fetchPage, { maxPages: 3 })
    const candidates = classifyDefaultAssigneeCandidates(collection.rows, 14, NOW)

    expect(fetchPage).toHaveBeenCalledTimes(3)
    expect(collection.truncated).toBe(true)
    expect(resolveSelectedDefaultAssignee(candidates, OTHER, collection.truncated)).toEqual({ candidate: null, unusable: false })
    expect(resolveSelectedDefaultAssignee(candidates, SELECTED, collection.truncated).unusable).toBe(true)
  })

  it('flags a selection that is not a member once every page was read', () => {
    expect(resolveSelectedDefaultAssignee([], OTHER, false)).toEqual({ candidate: null, unusable: true })
    expect(resolveSelectedDefaultAssignee([], null, false)).toEqual({ candidate: null, unusable: false })
  })

  it('batches label lookups to the page size', () => {
    const ids = Array.from({ length: 205 }, (_, index) => `id-${index}`)
    expect(chunkIds(ids).map((batch) => batch.length)).toEqual([100, 100, 5])
  })
})

describe('default assignee membership page failures', () => {
  const MEMBER = '66666666-6666-4666-8666-666666666603'

  it('reads a successful page with its total', () => {
    expect(readProjectMembershipPage({ ok: true, result: { items: [{ staffMemberId: MEMBER }], totalPages: 3 } })).toEqual({
      items: [{ staffMemberId: MEMBER }],
      totalPages: 3,
    })
    expect(readProjectMembershipPage({ ok: true, result: { items: [] } })).toEqual({ items: [], totalPages: null })
  })

  it('refuses an HTTP error page instead of reading it as an empty last page', () => {
    expect(() => readProjectMembershipPage({ ok: false, result: { items: [] } })).toThrow()
    expect(() => readProjectMembershipPage({ ok: false, result: null })).toThrow()
  })

  it('refuses a successful response that carries no row list', () => {
    expect(() => readProjectMembershipPage({ ok: true, result: null })).toThrow()
    expect(() => readProjectMembershipPage({ ok: true, result: { items: 'nope' } })).toThrow()
  })

  it('fails the whole collection when a later page fails, rather than reporting a complete read', async () => {
    const fullPage = Array.from({ length: DEFAULT_ASSIGNEE_PAGE_SIZE }, () => ({ status: 'inactive' }))
    const fetchPage = jest.fn(async (page: number) =>
      readProjectMembershipPage(
        page === 1 ? { ok: true, result: { items: fullPage, totalPages: 2 } } : { ok: false, result: null },
      ),
    )
    await expect(collectProjectMemberships(fetchPage)).rejects.toThrow()
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('propagates a rejected page request', async () => {
    const fetchPage = jest.fn(async (): Promise<ProjectMembershipPage> => {
      throw new Error('network down')
    })
    await expect(collectProjectMemberships(fetchPage)).rejects.toThrow('network down')
  })
})
