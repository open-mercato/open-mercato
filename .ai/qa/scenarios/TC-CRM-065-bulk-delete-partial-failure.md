# Bulk Delete with Partial Dependency Failure

## Test ID
TC-CRM-065

## Category
Customer/CRM Management

## Priority
High

## Description
Verify that the People bulk-delete on the CRM list page surfaces per-failure diagnostics when at least one selected row cannot be deleted because of server-side business-integrity guards (e.g. linked deals returning `422 PERSON_HAS_DEPENDENTS`). The page must:

- delete the eligible rows,
- keep the blocked row visible in the list,
- show a single grouped failure toast that includes the dependency reason,
- show a partial-progress success toast describing how many rows were deleted and how many failed.

This closes the integration coverage gap called out for the bulk-delete UX rework.

## Prerequisites
- User logged in with `customers.people.manage` feature
- API token available for fixture creation
- Test environment isolated (fixtures clean up their own data)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create person A (`deletable`) via API | Person A exists, no linked deals |
| 2 | Create person B (`deletable`) via API | Person B exists, no linked deals |
| 3 | Create person C (`blocked`) via API | Person C exists |
| 4 | Create a deal linking person C via API | Deal references person C |
| 5 | Login and open `/backend/customers/people` | People list visible |
| 6 | Search to scope the list to the three fixtures | Only the 3 fixtures visible |
| 7 | Select rows A, B, and C | Bulk action bar shows "Delete selected" |
| 8 | Click "Delete selected" | Confirmation dialog opens |
| 9 | Confirm the bulk delete | `runBulkDelete` runs three DELETE requests |
| 10 | Observe the toast stack | One warning toast says "2 of 3 people deleted; 1 failed"; one error toast says "linked deals (1)" (the dependency reason for C) |
| 11 | Verify list contents | A and B disappear from the list; C remains visible |

## Expected Results
- 2 successful per-row deletes; the local row state is updated to remove A and B
- 1 failed per-row delete; the row for C is still visible
- One grouped failure toast surfaces the server-provided reason for the dependency block
- One partial-progress toast reports `{deleted: 2, total: 3, failed: 1}`
- The bulk operation produces one coalesced entry in the Last Operations banner (not three)

## Edge Cases / Error Scenarios
- All rows fail (no warning toast for partial progress; only grouped failure toasts)
- All rows succeed (success toast, no failure toasts, banner coalesces N entries into one)
- Single-row bulk select: no coalesce, the existing per-row undo behavior applies
- Network failure mid-batch: succeeded rows still update local state, the failure is grouped under its message bucket
