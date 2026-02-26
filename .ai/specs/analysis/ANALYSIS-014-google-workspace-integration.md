# Integration Feasibility Analysis — Google Docs / Drive / Sheets

## Overview
- Google Workspace APIs: Drive API v3, Sheets API v4, Docs API v1
- Multiple hubs: `data_sync` (Sheets), `storage_providers` (Drive), custom (Docs)
- Module IDs: Extensions to `sync_google_workspace` + `storage_google_drive`
- Overall Feasibility: **Full for Sheets, Medium for Drive, Low for Docs generation**

## Google Sheets (data_sync hub)

### Already Specced in SPEC-045g
- Product import via DataSyncAdapter — fully designed
- `spreadsheets.values.get` for reading ranges
- Delta detection via row hash comparison
- Column auto-detection via header row keywords
- Scheduled background sync

### Extensions Beyond SPEC-045g
| Capability | Hub | Feasibility | Notes |
|-----------|-----|-------------|-------|
| Product import | data_sync | High | Reference implementation |
| Customer import | data_sync | High | Same pattern, different mapping |
| Order data export | data_sync | Medium | Write to reporting spreadsheet |
| Write back to Sheets | data_sync | Medium | Concurrent write conflicts |
| Real-time changes | data_sync | Low | No webhook for cell changes |

### Sheets API
- Rate limits: 60 req/min writes, 300 req/min reads
- Auth: OAuth 2.0 with `spreadsheets.readonly` (already in sync_google_workspace)
- Write scope: `spreadsheets` (read+write)

## Google Drive (storage_providers hub)

### StorageAdapter Mapping
| Method | Drive API | Feasibility |
|--------|----------|-------------|
| upload | POST /upload/drive/v3/files (resumable) | Full |
| download | GET /files/{fileId}?alt=media | Full |
| delete | DELETE /files/{fileId} | Full (trash by default) |
| getSignedUrl | **NOT AVAILABLE** — no pre-signed URLs like S3 | Gap |
| list | GET /files?q='{folderId}' in parents | Full |
| exists | files.list with name filter or catch 404 | Full |

### The Signed URL Gap
Drive does NOT provide pre-signed URLs equivalent to S3. Options:
1. Make file publicly readable (not acceptable for private docs)
2. Domain-restricted sharing
3. Service account with delegation (complex)

**Drive suitable for public assets (product images), NOT for private documents.**

### Drive Feasibility
| Capability | Rating (1-5) | Notes |
|-----------|-------------|-------|
| Upload files | 4 / Good | Resumable for large files |
| Download files | 5 / Excellent | Direct with auth |
| Delete files | 4 / Good | Trash by default |
| List files | 4 / Good | Query syntax |
| Signed URLs | 1 / Infeasible | No S3-equivalent |
| Public asset storage | 3 / Moderate | Works with public sharing |
| Private document storage | 2 / Difficult | No time-limited access |

## Google Docs (Document Generation — No Hub Fit)

### Approaches
1. **Template-based** (recommended): Copy template → ReplaceAllText → export PDF
2. **Programmatic**: Create blank → InsertText/CreateParagraph. Very verbose
3. **PDF Export**: GET /files/{docId}/export?mimeType=application/pdf

### Docs Feasibility
| Capability | Rating (1-5) | Notes |
|-----------|-------------|-------|
| Template-based generation | 3 / Moderate | Copy + replace works for simple docs |
| Complex documents | 2 / Difficult | Verbose API for tables/formatting |
| PDF export | 5 / Excellent | Simple endpoint |

### No Current Hub Fit
Closest to `data_sync` export but really a document generation use case. Future `document_generators` hub category recommended.

## Shared Authentication
- All APIs use Google OAuth 2.0
- Credentials shared via `sync_google_workspace` bundle
- Additional scopes: `drive.file`, `spreadsheets`
- Sensitive scopes require Google verification

## Key Challenges
1. **OAuth app verification**: Sensitive scopes require weeks-long verification. Use `drive.file` (minimal)
2. **Drive is NOT object storage**: Hierarchical folders, naming conflicts, no content-addressable storage. S3/MinIO preferred
3. **No real-time Sheets events**: `users.watch` detects file modification, not cell changes
4. **Sheets write contention**: 60 req/min write limit + no concurrent edit management
5. **Docs API verbosity**: Invoice tables require many API calls

## Recommended Strategy
1. **Extend `sync_google_workspace`**: Customer import, order export, write-back
2. **Add `storage_google_drive`**: Document as public assets only
3. **Defer Docs generation**: Utility function for templates, future hub

## Gaps Summary
- Drive: no signed URL support (critical StorageAdapter gap)
- Sheets: no real-time change detection
- Docs: no hub fit
- Drive: not suitable for private storage
- Estimated effort: **2-3 weeks** (Sheets), **2 weeks** (Drive), **3-4 weeks** (Docs)
