import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export async function assertTimeEntrySegmentRangeOrdered(
  startedAt: Date,
  endedAt: Date | null | undefined,
  field: 'startedAt' | 'endedAt',
): Promise<void> {
  if (!endedAt || endedAt.getTime() >= startedAt.getTime()) return
  const { translate } = await resolveTranslations()
  const message = translate('staff.timesheets.errors.segmentEndBeforeStart', 'A segment cannot end before it starts.')
  throw new CrudHttpError(400, { code: 'segment_end_before_start', error: message, fieldErrors: { [field]: message } })
}
