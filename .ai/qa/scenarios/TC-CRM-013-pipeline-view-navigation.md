# Test Scenario 56: Pipeline View Navigation

## Test ID
TC-CRM-013

## Category
Customer/CRM Management

## Priority
Medium

## Description
Verify that the deal pipeline view provides visual representation of deals across stages with drag-and-drop functionality.

## Prerequisites
- User is logged in with `customers.deals.view` feature
- Multiple deals exist in various pipeline stages
- Pipeline stages are configured

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/customers/deals/pipeline` | Pipeline board displayed |
| 2 | Observe pipeline columns | Columns match configured stages |
| 3 | View deals in each column | Deal cards shown per stage |
| 4 | Verify deal card information | Shows name, value, customer |
| 5 | Click on deal card | Deal detail opens |
| 6 | Drag deal to different stage | Deal moves between columns |
| 7 | Use filters | Deals filtered by criteria |
| 8 | Switch to list view (if available) | Alternative view shown |

## Expected Results
- Pipeline board shows all stages as columns
- Deals appear as cards in respective stages
- Deal cards show key information (name, value, customer)
- Drag-and-drop updates deal stage
- Column headers show deal count and total value
- Filters work across pipeline (owner, date, value)
- Responsive design for different screen sizes
- Keyboard navigation (if accessible)

## Edge Cases / Error Scenarios
- Very long deal name (truncated with tooltip)
- Many deals in one stage (scrollable or paginated)
- Empty stages (shown with zero count)
- Stage with no deals after filtering (still visible)
- Concurrent drag by two users (conflict handling)
- Drag to won/lost stage (may trigger confirmation)
- Mobile/touch drag-and-drop (if supported)
- Performance with hundreds of deals
