import { z } from 'zod'
import type { XeroApiClient, XeroQuota } from './api-client'
import { floorToSecond, keysetFilterBefore, parseXeroDate } from './dates'
import { XeroApiError } from './errors'

export const XERO_PAGE_SIZE = 1000

const contactRecordSchema = z.object({ ContactID: z.string().min(1), UpdatedDateUTC: z.string().min(1) }).passthrough()

const contactsPageSchema = z.object({
  Contacts: z.array(contactRecordSchema).default([]),
  pagination: z
    .object({ page: z.number().int(), pageSize: z.number().int(), pageCount: z.number().int(), itemCount: z.number().int() })
    .optional(),
})

export type XeroContactRecord = z.infer<typeof contactRecordSchema>

export type XeroKeysetPage = {
  /** Records of this page not already read at the keyset boundary, in Xero's order. */
  records: Array<{ record: XeroContactRecord; updatedAt: Date }>
  /** The `UpdatedDateUTC` of the page's last record; the keyset a cursor commits after the page. */
  lastUpdatedAt: Date | null
  date: Date | null
  quota: XeroQuota
  providerData: Record<string, unknown> | null
  drained: boolean
}

type ContactsClient = Pick<XeroApiClient, 'listContacts'>

function boundaryKey(record: XeroContactRecord): string {
  return `${record.ContactID}|${record.UpdatedDateUTC}`
}

/**
 * Walks `GET /Contacts` by keyset (App Spec § 6.7): each request sends `page=1` and
 * `If-Modified-Since` one second before the last record read, and records re-read at that boundary
 * are dropped by id and version, so a record edited during the walk is processed again at its new
 * position. Only when a whole page stays inside the boundary second (an overfull second) does the
 * walk request `page=2…` under the same filter. It ends on a short page or at `pagination.pageCount`.
 */
export async function* walkXeroContacts(input: {
  client: ContactsClient
  xeroOrganisationId: string
  startAfter: Date | null
  signal?: AbortSignal
  pageSize?: number
}): AsyncGenerator<XeroKeysetPage> {
  const pageSize = input.pageSize ?? XERO_PAGE_SIZE
  let filter: Date | null = input.startAfter ? keysetFilterBefore(input.startAfter) : null
  let page = 1
  let boundary = new Map<string, number>()

  for (;;) {
    if (input.signal?.aborted) throw input.signal.reason
    const response = await input.client.listContacts({ xeroOrganisationId: input.xeroOrganisationId, ifModifiedSince: filter, page, pageSize })
    const parsed = contactsPageSchema.safeParse(response.body)
    if (!parsed.success) throw new XeroApiError('transient', { cause: parsed.error })
    const contacts = parsed.data.Contacts
    const dated = contacts.map((record) => {
      const updatedAt = parseXeroDate(record.UpdatedDateUTC)
      if (!updatedAt) throw new XeroApiError('transient')
      return { record, updatedAt }
    })
    const fresh = dated.filter((entry) => !boundary.has(boundaryKey(entry.record)))
    const last = dated.at(-1) ?? null
    const pageCount = parsed.data.pagination?.pageCount ?? null
    const drained = contacts.length < pageSize || (pageCount !== null && page >= pageCount)

    yield {
      records: fresh,
      lastUpdatedAt: last?.updatedAt ?? null,
      date: response.date,
      quota: response.quota,
      providerData: response.providerData,
      drained,
    }
    if (drained || !last) return

    const nextFilter = keysetFilterBefore(last.updatedAt)
    for (const entry of dated) boundary.set(boundaryKey(entry.record), entry.updatedAt.getTime())
    if (filter !== null && nextFilter.getTime() <= floorToSecond(filter).getTime()) {
      page += 1
      continue
    }
    filter = nextFilter
    page = 1
    const keep = new Map<string, number>()
    for (const [key, time] of boundary) if (time >= filter.getTime()) keep.set(key, time)
    boundary = keep
  }
}
