# Test Scenario 23: Category Create Requires Specific Organization Context

## Test ID
TC-CAT-018

## Category
Catalog Management

## Priority
High

## Type
UI Test

## Description
Verify that category creation is blocked when global `All organizations` scope is selected, so user must choose a specific organization before submit.

## Prerequisites
- User is logged in as `admin`
- User has `catalog.categories.manage` feature
- Organization switcher is visible in backend header

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/catalog/categories` | Categories page loads |
| 2 | Set organization dropdown to `All organizations` | Selector value is empty/global |
| 3 | Go to `/backend/catalog/categories/create` | Create form loads |
| 4 | Fill `Name` field | Form accepts input |
| 5 | Click `Create` | Create request is blocked in UI for invalid org scope |

## Expected Results
- No `POST /api/catalog/categories` is sent while organization scope is global.
- User is required to switch to a specific organization before create.

## Edge Cases / Error Scenarios
- User with single organization (global option unavailable)
- Organization selection changes while form is open
- Direct URL access to create page with global scope cookie

