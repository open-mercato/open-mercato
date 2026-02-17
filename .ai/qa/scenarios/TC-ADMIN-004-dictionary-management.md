# Test Scenario 62: Manage Dictionary Entries

## Test ID
TC-ADMIN-004

## Category
System Administration

## Priority
Medium

## Description
Verify that lookup dictionaries (statuses, types, categories) can be managed with entries.

## Prerequisites
- User is logged in with `dictionaries.manage` feature
- Dictionary management page is accessible

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/config/dictionaries` | Dictionaries list displayed |
| 2 | Select a dictionary type | Dictionary details shown |
| 3 | View existing entries | Entries listed |
| 4 | Click "Add Entry" | Entry form appears |
| 5 | Enter entry value/label | Value accepted |
| 6 | Enter entry code | Code set |
| 7 | Set display order | Order configured |
| 8 | Set active/inactive status | Status set |
| 9 | Save entry | Entry is created |

## Expected Results
- Dictionary entry is created
- Entry appears in dictionary list
- Entry is available in dropdown/selections
- Order determines display sequence
- Inactive entries are hidden from selections
- Entry codes are unique within dictionary
- Labels can be localized (if i18n enabled)
- Entries can be reordered

## Edge Cases / Error Scenarios
- Duplicate entry code (validation error)
- Empty entry label (validation error)
- Delete entry used in records (may orphan or prevent)
- Rename entry code (may break references)
- Deactivate commonly used entry (warning)
- Dictionary with no entries (empty state)
- Maximum entries per dictionary (limit if any)
- Default entry designation
