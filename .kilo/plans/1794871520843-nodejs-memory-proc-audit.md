# Node.js Memory & NPROC Audit Report

**Project:** YPWI Lutim Application  
**Date:** 2026-11-16  
**Purpose:** Identify causes of high PMEM/NPROC leading to `cagefs_enter: Unable to fork` on cPanel/Phusion Passenger

---

## 1. Spawning Child Processes (NPROC Primary Cause)

### Critical Findings:

| File | Issue | Lines | Impact |
|------|-------|-------|--------|
| `package.json` | **Puppeteer** dependency (`^25.11.0`) — launches full Chrome instance per usage. Most memory-heavy dependency in the stack. | — | **HIGH** — Each Puppeteer session spawns `chrome` process, consuming 200MB-1GB RAM and a full PID. If used repeatedly without proper cleanup, NPROC will exhaust quickly. |
| `src/utils/whatsappBaileys.js` | Baileys socket initialized conditionally; `global` state `isReady` prevents re-spawn, but `sendWhatsAppMessage` in `server.js:518` requires re-importing module each call. | 54-69 | **MEDIUM** — Each `require('./src/utils/whatsappBaileys')` could re-initialize socket if not properly cached. |
| `src/routes/whatsapp.js` | No child process spawn, but heavy DB polling and message routing. | — | **LOW** — Database-bound, not process-bound. |
| `multer` configs (selfie, teacher) | Uses `diskStorage` — writes to disk, does NOT keep files in RAM. | 76-227 | **LOW** — Disk-backed, memory-safe. |

### Recommendations:
- **Remove Puppeteer** if not critically needed (PDF generation via `pdfkit`/`pdfmake` is already available). If required for screenshot generation, implement a process pool with max concurrency and proper process death/recycling.
- **Cache Baileys module** — Ensure `require` is called once and the socket is reused. The current `server.js:270-276` conditional init is okay, but remove the `require` inside `sendWhatsAppMessage` and use the already-initialized module.
- **Limit concurrent multer uploads** — Already limited via `limits: { files: 1 }`, but ensure no other unbounded spawns exist.

---

## 2. Database Connection & Connection Pooling

### Critical Findings:

| File | Issue | Lines | Impact |
|------|-------|-------|--------|
| `db.js` | `connectionLimit: 10` is reasonable, and `query()` properly releases connection in `finally` block. However, `getConnection()` re-initializes pool if `pool` is null — if `initializeDatabase` fails, subsequent requests will keep failing silently. | 20-57 | **LOW-MEDIUM** — Pool size is appropriate for shared hosting. |
| `server.js:sendEmail` (line 557-641) | Creates new `nodemailer.createTransport()` on every email send. No connection pooling for SMTP. Under high load, SMTP servers may throttle or drop connections, forcing new connections each time. | 644-659 | **LOW** — Email sending is typically sporadic, not a major NPROC source. |
| `billing.js:generateBilling` (line 520-592) | Iterates all students and makes individual DB queries per month. For 1000 students × 12 months = 12,000 queries in one cron run. No batching. | 540-592 | **MEDIUM** — Could hold many connections simultaneously if not rate-limited. |
| `scheduler.js:runAutoBillReminder` (line 141-307) | Loops over students with individual `db.query()` calls inside a `for` loop. No connection limiting. For tenants with hundreds of students, this will accumulate connections. | 196-293 | **MEDIUM** — Similar issue to billing generation. |

### Recommendations:
- **Keep `connectionLimit: 5-10`** in `db.js` — this is appropriate for shared hosting/cPanel with Phusion Passenger.
- **Always release connections** — The existing `finally` blocks in `query()`, `runMultiple()`, and `transaction()` are correct. Verify no code path escapes the `finally`.
- **Add connection timeout** — Already `connectTimeout: 30000` in `db.js`, good.
- **Batch billing queries** — Instead of individual queries per student/month, use a single query with `GROUP BY` or temporary tables to reduce round-trips.
- **Use `pool.query()` directly** for simple reads/writes instead of wrapping every operation in `getConnection()` — this reduces overhead and ensures connections are properly returned.

---

## 3. Memory Leaks & Global State (PMEM Primary Cause)

### Critical Findings:

| File | Issue | Lines | Impact |
|------|-------|-------|--------|
| `src/routes/auth.js:299-304` | **`global.tempOtps`** — OTP storage in global object with **no cleanup**. Every password reset adds a new entry: `global.tempOtps[email] = {...}`. Over time, this grows unbounded and never expires unless the OTP is used/expired (but even expired entries persist if the reset flow is interrupted). | 299-304 | **CRITICAL** — This is a **direct memory leak**. In a long-running Node process (cPanel/Passenger), `tempOtps` will consume increasing RAM until OOM kill. |
| `src/utils/skPdfTemplate.js:13-27` | **`cachedImages`** — All template images (kop, bismillah, stempel, ttd) are read via `fs.readFileSync` once and cached in `cachedImages` variable. If many different SK PDFs are generated with different image sets, memory grows. The check `if (cachedImages) return cachedImages` means it's cached **forever** for the process lifetime. | 13-27 | **HIGH** — Images can be 100KB-500KB each. With many template variations, this accumulates. |
| `src/utils/whatsappTemplate.js:25-39` | **`templateStructureCache`** — Map cache with TTL (`TEMPLATE_CACHE_TTL_MS = 5min`), but if many different template names are used, the Map grows. `Map` does not auto-evict entries unless manually cleared. | 25-39 | **MEDIUM** — Minor, but could contribute under heavy template usage. |
| `src/utils/whatsappTemplate.js:71-129` | **`headerMediaIdCache`** — Plain object cache with no TTL. If many templates are configured with different header images, this grows unbounded. | 71-129 | **MEDIUM** — Similar to above. |
| `server.js:global.sendWhatsAppMessage` (line 554) | Assigns function to `global` — could prevent GC if references are held. | 554 | **LOW** — Single function reference, minimal impact. |

### Recommendations:
- **Fix `global.tempOtps` leak** — Add TTL-based cleanup. Either:
  - Use a `Map` with expiration check before inserting, OR
  - Clean up expired entries periodically (e.g., at the start of each request or via a setInterval), OR
  - Store OTPs in a database table with TTL instead of in-memory global.
- **Fix `cachedImages` in skPdfTemplate.js** — Add TTL or size limit:
  ```js
  // Example: limit to 1 cached set, or add TTL
  let cachedImages = null;
  let cachedAt = 0;
  function loadImagesBase64() {
    const TTL = 24 * 60 * 60 * 1000; // 24 hours
    if (cachedImages && Date.now() - cachedAt < TTL) return cachedImages;
    // ... load and cache
    cachedImages = result;
    cachedAt = Date.now();
    return result;
  }
  ```
- **Fix `headerMediaIdCache`** — Add same TTL or LRU mechanism.
- **Run `node --max-old-space-size=512`** or set environment variable to limit Node heap size in production.

---

## 4. Background Jobs, Cron & Interval

### Critical Findings:

| File | Issue | Lines | Impact |
|------|-------|-------|--------|
| `scheduler.js:cron.schedule` (lines 499, 502, 505, 679) | Four cron jobs running at different times. Potential overlap if any job takes longer than its interval: <br>• `0 0 * * *` — `runAutoBillGeneration` at midnight<br>• `0 7 * * *` — `runAutoBillReminder` at 07:00<br>• `0 8 1 * *` — `runAutoMonthlyInvoiceGeneration` on 1st at 08:00<br>• `0 0 * * *` — `runAutoSkGeneration` at midnight | 499, 502, 505, 679 | **MEDIUM** — If `runAutoBillGeneration` or `runAutoSkGeneration` takes >24h to complete, the next run will start before the previous finishes, accumulating pending work. |
| `runAutoBillReminder` (line 217-293) | Loops over ALL students with arrears and sends WhatsApp one-by-one with `rateLimitedSend`. If there are 500 students, this takes 500 × 1.5s = 12.5 minutes of continuous DB + API calls. No concurrency limit. | 217-293 | **MEDIUM** — Could overlap with next day's run if students count is very high. |
| `runAutoMonthlyInvoiceGeneration` (line 345-496) | Runs on 1st of month at 08:00. Loops over all students for all tenants, sends WhatsApp + email. Similar sequential bottleneck. | 345-496 | **MEDIUM** — Same concern. |

### Recommendations:
- **Add `startOnPrevJob = false` or overlap protection** — Check if previous cron run is still running before starting a new one. Use a flag/file lock.
- **Add concurrency limiting** to `sendBillTemplateWithRetry` — Use a semaphore/queue with max concurrent sends (e.g., max 5 at a time) instead of sequential processing.
- **Add error boundaries** — If a cron job throws unhandled, it should not prevent the next scheduled run.
- **Consider spreading `runAutoBillReminder` across multiple hours** — Instead of all at 07:00, process a batch per hour.

---

## 5. Phusion Passenger Compatibility

### Critical Findings:

| File | Issue | Lines | Impact |
|------|-------|-------|--------|
| `server.js:88-99` | `helmet()` with `contentSecurityPolicy: false` and other policies disabled "for IP access". Not a direct resource issue, but removes security headers that could cause browser reflows or CSP violations in shared hosting environments. | 95-99 | **LOW** — Security, not resource. |
| `server.js:102-114` | Custom headers set on every response: `Strict-Transport-Security: max-age=0`, `COOP`, `COEP` disabled. No direct resource impact. | 102-114 | **LOW** |
| `server.js:135-136` | `app.use(limiter)` and `app.use('/api/auth/login', authLimiter)` are **commented out**! No rate limiting is active on `/api` routes. | 135-136 | **MEDIUM** — Without rate limiting, attackers can send unlimited requests, consuming DB connections, CPU, and memory. |
| `server.js:process.on('unhandledRejection')` and `uncaughtException` (lines 4-12) | Prevents process exit on errors, which is good for Passenger stability, but swallowing errors silently can cause infinite retries or resource leaks if errors are not properly logged. | 4-12 | **MEDIUM** — Errors are logged but process stays up; could mask memory leaks. |
| `server.js:72-73` | `SECRET_KEY` default: `'ypwi-secret-key-2026'` — hardcoded default is weak but not a resource issue. | 73 | **LOW** |
| No `NODE_ENV` enforcement — `dotenv.config()` loads `.env` but there's no check to ensure production mode disables dev features. | — | **MEDIUM** — If someone accidentally runs with nodemon in production, it will watch for file changes, spawn extra processes, and increase memory usage. |

### Recommendations:
- **Enable rate limiters** — Uncomment `app.use(limiter)` and `app.use('/api/auth/login', authLimiter)` at minimum. Consider adding IP-based limits per route.
- **Set `NODE_ENV=production`** explicitly in `.env` and add runtime check:
  ```js
  if (process.env.NODE_ENV !== 'production') {
    console.warn('⚠️ NODE_ENV is not set to production!');
  }
  ```
- **Remove or restrict nodemon** for production — Ensure `start` script uses `node server.js` only, not `nodemon server.js`.
- **Passenger port management** — The `PORT = process.env.PORT || 3000` is correct. Passenger will override `process.env.PORT`, so do not hardcode port. Current code is compatible.
- **Ensure only one HTTP server** — Only one `express()` app is created, so no double-server issue. Good.

---

## Summary of Critical Issues

| Priority | Issue | File | Line | Fix |
|----------|-------|------|------|-----|
| **1** | `global.tempOtps` unbounded growth | `src/routes/auth.js` | 299-304 | Add TTL-based cleanup or move to DB |
| **2** | `cachedImages` in skPdfTemplate.js forever cache | `src/utils/skPdfTemplate.js` | 13-27 | Add TTL or size limit |
| **3** | Puppeteer dependency — memory/process heavy | `package.json` | — | Remove if not needed; otherwise implement process pool |
| **4** | Cron jobs potential overlap | `scheduler.js` | 499, 502, 505, 679 | Add run-in-progress flag / file lock |
| **5** | Rate limiters commented out | `server.js` | 135-136 | Uncomment and configure |
| **6** | `headerMediaIdCache` unbounded | `src/utils/whatsappTemplate.js` | 71-129 | Add TTL/LRU |
| **7** | TemplateStructureCache Map growth | `src/utils/whatsappTemplate.js` | 25-39 | Add size limit or manual clearing |

---

## Immediate Fixes (Order of Priority)

1. **Fix `global.tempOtps` memory leak** in `src/routes/auth.js` — Add a Map with TTL cleanup, or use database storage.
2. **Fix `cachedImages` in `skPdfTemplate.js`** — Add TTL-based cache invalidation.
3. **Uncomment rate limiters** in `server.js` — Enable `app.use(limiter)` and `app.use('/api/auth/login', authLimiter)`.
4. **Add cron overlap protection** in `scheduler.js` — Use a PID file or Redis lock to prevent overlapping runs.
5. **Review Puppeteer usage** — Determine if it's needed; if so, implement concurrent process limit.

---

## Validation Steps After Fixes

1. Restart the application and monitor `top`/`ps` for NPROC and PMEM.
2. Run password reset flow 10+ times and verify `global.tempOtps` size does not grow unbounded.
3. Generate 50+ SK PDFs and verify memory usage remains stable (not growing with each generation).
4. Run cron jobs manually and verify no overlapping execution.
5. Verify `npm run start` (without nodemon) and `NODE_ENV=production` settings.