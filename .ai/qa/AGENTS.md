# QA Integration Testing Instructions

## How to Test

### UI Testing (Playwright MCP)

Use Playwright MCP to execute UI test scenarios. The browser automation handles navigation, form interactions, and visual verification.

```bash
# Example: Navigate and interact
mcp__playwright__browser_navigate({ url: "http://localhost:3000/backend/login" })
mcp__playwright__browser_snapshot()
mcp__playwright__browser_fill_form({ fields: [...] })
mcp__playwright__browser_click({ element: "Submit button", ref: "..." })
```

**Workflow:**
1. Navigate to the target URL
2. Take a snapshot to identify element refs
3. Interact with elements (click, type, fill forms)
4. Verify expected results via snapshots or assertions

### API Testing (cURL)

Use cURL for direct API endpoint testing.

```bash
# Login and get token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@acme.com", "password": "secret"}'

# Authenticated request
curl -X GET http://localhost:3000/api/customers/companies \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json"
```

---

## Default Credentials

These accounts are created via `mercato init` command:

| Role | Email | Password |
|------|-------|----------|
| Superadmin | `superadmin@acme.com` | `secret` |
| Admin | `admin@acme.com` | `secret` |
| Employee | `employee@acme.com` | `secret` |

**Note:** Superadmin has access to all features across all tenants. Admin has full access within their organization. Employee has limited access based on role configuration.

---

## Results Presentation

Present test results in a table format:

### Test Run Summary

| Test ID | Test Name | Status | Notes |
|---------|-----------|--------|-------|
| TC-AUTH-001 | User Login Success | PASS | |
| TC-AUTH-002 | Invalid Credentials | PASS | |
| TC-AUTH-003 | Remember Me | FAIL | Session not persisted |
| TC-CAT-001 | Product Creation | PASS | |

### Summary Statistics

| Metric | Count |
|--------|-------|
| Total Tests | X |
| Passed | X |
| Failed | X |
| Skipped | X |
| Pass Rate | X% |

### Failed Tests Detail

For each failed test, include:
- **Test ID**: TC-XXX-XXX
- **Failure Step**: Step number where failure occurred
- **Expected**: What should have happened
- **Actual**: What actually happened
- **Screenshot/Evidence**: If applicable

---

## How to Update Test Cases

1. **Locate the test file** in `.ai/qa/` directory
2. **Edit the relevant sections**:
   - Update test steps if flow changed
   - Modify expected results if behavior changed
   - Add new edge cases as discovered
3. **Maintain consistency**:
   - Keep the same markdown structure
   - Update the test scenario number if title changes significantly
   - Ensure prerequisites are still accurate
4. **Version control**: Commit changes with descriptive message

**Example update:**
```markdown
## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to login | Login page displayed |
| 2 | Enter valid email | Email accepted |       <!-- Updated step -->
| 3 | Enter valid password | Password masked |   <!-- New step -->
| 4 | Click "Sign In" | Dashboard displayed |
```

---

## How to Create New Test Cases

### Naming Convention

```
TC-[CATEGORY]-[XXX]-[title].md
```

- **TC**: Test Case prefix
- **CATEGORY**: Module category code (see below)
- **XXX**: 3-digit sequential number
- **title**: Kebab-case descriptive title

### Category Codes

| Code | Category |
|------|----------|
| AUTH | Authentication & User Management |
| CAT | Catalog Management |
| SALES | Sales Management |
| CRM | Customer/CRM Management |
| ADMIN | System Administration |
| INT | Integration Scenarios |
| API-SYS | System & Maintenance APIs |
| API-ENT | Custom Fields & Entities APIs |
| API-BULK | Bulk Operations APIs |
| API-AUD | Audit & Business Rules APIs |
| API-SEARCH | Search & Lookup APIs |
| API-FT | Feature Toggles APIs |
| API-VIEW | Perspectives & Views APIs |
| API-ONBOARD | Onboarding APIs |
| API-AUTH | API Authentication & Security |
| API-ERR | API Error Handling & Edge Cases |
| API-DASH | Dashboard & Widget APIs |
| API-DOCS | OpenAPI & Documentation APIs |

### Template Structure

```markdown
# Test Scenario [NUMBER]: [TITLE]

## Test ID
TC-[CATEGORY]-[XXX]

## Category
[Category Name]

## Priority
[High/Medium/Low]

## Type
[UI Test / API Test]

## Description
[Brief description of what this test validates]

## Prerequisites
- [Prerequisite 1]
- [Prerequisite 2]

## API Endpoint (for API tests)
`[METHOD] /api/path`

## Request Body (for API tests, if applicable)
```json
{
  "field": "value"
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | [Action] | [Expected] |
| 2 | [Action] | [Expected] |

## Expected Response (for API tests)
```json
{
  "success": true
}
```

## Expected Results
- [Final expected outcome 1]
- [Final expected outcome 2]

## Edge Cases / Error Scenarios
- [Edge case 1]
- [Edge case 2]
```

### Best Practices

1. **One scenario per file**: Keep tests atomic and focused
2. **Clear prerequisites**: List all setup requirements
3. **Specific steps**: Each step should be actionable
4. **Measurable results**: Expected results should be verifiable
5. **Include edge cases**: Document error scenarios and boundary conditions
6. **Set priority**: High for critical paths, Medium for standard flows, Low for edge cases

