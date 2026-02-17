# Test Scenario 16: Rate Limiting on Authentication Endpoints

## Test ID
TC-AUTH-016

## Category
Authentication & Security

## Priority
High

## Description
Verify that authentication endpoints (login and password reset) enforce rate limiting, returning proper 429 responses with standard rate-limit headers when request limits are exceeded, and that successful authentication resets the per-user counter.

## Prerequisites
- Application is running and accessible
- Rate limiting is enabled (default in-memory strategy)
- Default rate limit configs: login compound = 5 pts/60s, reset compound = 3 pts/60s
- A valid user account exists (admin@acme.com / secret)

## Test Steps

### Test 1: Login rate limit — returns 429 after exceeding compound limit
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send 6 POST requests to `/api/auth/login` with the same unique email and wrong password | First 5 requests return non-429 status |
| 2 | Inspect the 6th response | Status is 429 |
| 3 | Check response headers | `Retry-After` is present, `X-RateLimit-Limit` = 5, `X-RateLimit-Remaining` = 0 |
| 4 | Check response body | Contains `error` field with rate limit message |

### Test 2: Login rate limit — different emails get independent limits
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send 5 POST requests to `/api/auth/login` with email-A and wrong password | Requests consume email-A's compound bucket |
| 2 | Send 1 POST request to `/api/auth/login` with email-B and wrong password | Response is NOT 429 (email-B has its own bucket) |

### Test 3: Password reset rate limit — returns 429 after exceeding compound limit
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send 4 POST requests to `/api/auth/reset` with the same unique email | First 3 requests return 200 |
| 2 | Inspect the 4th response | Status is 429 |
| 3 | Check response headers | `Retry-After` is present, `X-RateLimit-Limit` = 3, `X-RateLimit-Remaining` = 0 |
| 4 | Check response body | Contains `error` field |

### Test 4: Login — successful login resets compound counter
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send 4 failed login attempts for admin@acme.com | Requests consume 4 of 5 compound points |
| 2 | Send 1 successful login with correct password | Response is 200 and compound counter is reset |
| 3 | Send 1 more failed login attempt | Response is NOT 429 (counter was reset by successful login) |

## Expected Results
- Rate-limited requests receive HTTP 429 with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers
- Different email addresses maintain independent compound rate limit buckets
- Successful authentication resets the compound rate limit counter for that user/IP combination
- The API continues to accept requests from other users even when one user is rate-limited

## Edge Cases / Error Scenarios
- Rate limiter service unavailable (fail-open: requests should still be allowed)
- IP cannot be determined from request headers (fail-open)
- Very rapid concurrent requests from same IP with different emails (IP-only layer may trigger first)
