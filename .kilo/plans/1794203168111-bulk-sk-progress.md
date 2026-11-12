# Plan: Add Progress Tracking to Bulk Generate SK

## Current State
- Bulk generate runs sequentially (DB inserts + PDF + Drive)
- No progress feedback - user waits blindly for 3-10 minutes
- Response only returns after ALL processing complete

## Requirements
1. **Progress percentage** (0-100%)
2. **Count generated** (e.g., "45/300 guru")
3. **Current guru being processed** (optional)
4. **Real-time updates** on frontend

## Architecture Options

### Option A: In-Memory Progress Store + Polling (Simplest)
- Store progress in `Map<jobId, ProgressData>` in server memory
- Frontend polls `/api/sk-guru/bulk-progress/:jobId` every 1-2s
- Cleanup after completion

### Option B: Server-Sent Events (SSE)
- Single HTTP connection streams progress updates
- More efficient, but requires connection handling

### Option C: Redis + Polling (Production-ready)
- Store progress in Redis with TTL
- Works across multiple server instances

**Recommendation: Option A** for simplicity (single server), can upgrade to C later.

## Implementation Plan

### Backend Changes (`src/routes/sk-guru.js`)

1. **Generate unique jobId** for each bulk request
2. **Store progress** in global Map:
   ```javascript
   const bulkProgress = new Map(); // jobId -> { total, processed, current, status, errors[] }
   ```
3. **Update progress** in the PDF generation loop
4. **New endpoint**: `GET /api/sk-guru/bulk-progress/:jobId`

### Frontend Changes (`public/js/admin-dashboard.js`)

1. **Generate jobId** on bulk generate click
2. **Start polling** progress endpoint
3. **Show modal** with:
   - Progress bar (0-100%)
   - Text: "Generated 45/300 (15%)"
   - Current guru name
   - Cancel button (optional)
4. **On complete**: show results, close modal

### Progress Data Structure
```javascript
{
  jobId: "sk-bulk-1234567890",
  total: 300,
  processed: 45,
  current: "Ahmad S.Pd",
  status: "processing", // "processing", "completed", "failed"
  startedAt: Date,
  completedAt: Date,
  errors: []
}
```

## API Changes

### POST `/api/sk-guru/bulk-generate`
**Request**: same + `jobId` (optional, generated if not provided)
**Response**: 
```json
{
  "success": true,
  "jobId": "sk-bulk-1234567890",
  "message": "Bulk generate started. Poll /api/sk-guru/bulk-progress/{jobId} for progress."
}
```

### GET `/api/sk-guru/bulk-progress/:jobId`
**Response**:
```json
{
  "success": true,
  "data": {
    "jobId": "sk-bulk-1234567890",
    "total": 300,
    "processed": 45,
    "percentage": 15,
    "current": "Ahmad S.Pd",
    "status": "processing",
    "generated": [...],
    "skipped": [...],
    "errors": [...]
  }
}
```

## Files to Modify
1. `src/routes/sk-guru.js` - Add progress tracking + new endpoint
2. `public/js/admin-dashboard.js` - Add `bulkGenerateSK()` with progress modal
3. `public/school-admin.html` - Add progress modal HTML (or create dynamically)

## Cleanup
- Remove progress from Map after 1 hour (or on client complete)
- Max 100 concurrent jobs in memory