# Fix JavaScript Syntax Errors in sdm-dashboard.js

## Issues Found

### 1. Duplicate `CACHE_TTL` Declaration (Lines 16 and 74)
- Line 16: `const CACHE_TTL = 5 * 60 * 1000;` (in the CACHE SYSTEM section)
- Line 74: `const CACHE_TTL = 5 * 60 * 1000; // 5 minutes` (duplicate in UTILITY section)
- **Error**: `Uncaught SyntaxError: Identifier 'CACHE_TTL' has already been declared`
- Both are in the global scope, causing a SyntaxError

### 2. Multiple `kategori` declarations in different functions
Multiple `const kategori = ...` declarations in different functions (lines 923, 961, 994, 1005, 1172, 1755, 2023). These are in different function scopes so they don't cause runtime errors, but TypeScript may flag them. These are in different function scopes so they don't cause runtime errors.

### 3. Duplicate cache systems
There are two separate cache systems:
1. Lines 8-57: `KPI_CACHE` object with `window.kpiCache` (old system)
2. Lines 60-113: `kpiCache` object with `lastFetch` (new system)

Both systems exist and have overlapping functionality, which could cause confusion.

## Plan

### Fix 1: Remove duplicate `CACHE_TTL` declaration (Line 74)
- Remove the duplicate `const CACHE_TTL` declaration at line 74
- Keep the one at line 16 (in the CACHE SYSTEM section)

### Fix 2: Remove duplicate `CACHE_TTL` in the second cache system
The second cache system (lines 60-113) has its own `CACHE_TTL` at line 74. Since we have two separate cache systems, we should either:
- Keep only one cache system, or
- Remove the duplicate CACHE_TTL and use the one from the first cache system

Since the second cache system (lines 60-113) uses `CACHE_TTL` in its `isCacheValid` function (line 80), we should either:
- Remove line 74 and make the second system use the global `CACHE_TTL` from line 16, or
- Remove the first `CACHE_TTL` and keep the second one

Best approach: Keep the first `CACHE_TTL` (line 16) and remove the duplicate at line 74. The second cache system will then use the global `CACHE_TTL`.

### Fix 3: Address multiple `kategori` declarations
The `kategori` declarations are in different function scopes, so they don't cause runtime errors. However, TypeScript flags them. These are in different function scopes so they're technically fine in JavaScript, but we could consider:
- Renaming some to be more specific (e.g., `kategoriFilter`, `kategoriSelect`)
- Or leaving as-is since they're in different scopes

Since they're in different function scopes, this is technically valid JavaScript. We can leave them as-is or rename for clarity.

## Implementation Plan

### Step 1: Remove duplicate `CACHE_TTL` at line 74
### Step 2: Verify the second cache system uses the global `CACHE_TTL`
### Step 4: Consider renaming `kategori` variables for clarity (optional, low priority)

## Files to Modify
- `public/sdm-dashboard.js`

## Testing
After fixes, verify:
1. No more "Identifier 'CACHE_TTL' has already been declared" error
2. Application loads without syntax errors
3. KPI functionality still works correctly