import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { uuidPrefixRange } from '../../data/validators'

/**
 * `GET /executions?q=` — what the Processes list search box actually matches.
 *
 * The list's identifier column renders `subject_label`, falling back to the
 * first eight hex characters of the workflow instance id when the process
 * carries no subject reference (`mapProcessListRow`). For an execution started
 * from the Studio — no business subject at all — that fallback is the ONLY
 * identifier the operator can see, so matching `subject_label` alone made the
 * search unable to find the value printed beside it.
 *
 * The id branch is an inclusive uuid RANGE rather than an `ilike`: the column is
 * `uuid`, and `uuid ~~* text` has no operator in Postgres. uuid ordering is
 * bytewise — identical to hex-string order — so `$gte`/`$lte` over the padded
 * bounds is exact, index-usable prefix semantics. `uuidPrefixRange` lowercases
 * and strips dashes, which is what makes the displayed upper-case short form
 * (`05CF8116`) and a pasted full id both resolve.
 *
 * Returns the OR branches for one term, or `null` when there is nothing to
 * search. Callers place them under a `$or` key: every branch names a column of
 * the execution row itself, so tenant/organization scoping — applied separately
 * by the CRUD factory — is untouched.
 */
export function buildExecutionSearchBranches(raw: string): Record<string, unknown>[] | null {
  const term = raw.trim()
  if (!term) return null
  const branches: Record<string, unknown>[] = [
    { subject_label: { $ilike: buildIlikeTerm(term) } },
  ]
  const range = uuidPrefixRange(term)
  if (range) branches.push({ workflow_instance_id: { $gte: range.from, $lte: range.to } })
  return branches
}
