# Fix Syntax Error: Duplicate CACHE_TTL Declaration

## Issue
The file `public/sdm-dashboard.js` has a duplicate declaration of `CACHE_TTL` constant:
- Line 16: `const CACHE_TTL = 5 * 60 * 1000; // 5 minutes` (in CACHE SYSTEM section)
- Line 74: `const CACHE_TTL = 5 * 60 * 1000; // 5 minutes` (duplicate in UTILITY section)

This causes: `Uncaught SyntaxError: Identifier 'CACHE_TTL' has already been declared`

## Fix Required
Remove the duplicate declaration at line 74. The global `CACHE_TTL` at line 16 is already available and used by the cache helper functions.

## Fix Plan
1. Remove line 74: `const CACHE_TTL = 5 * 60 * 1000; // 5 minutes`
2. The global `CACHE_TTL` at line 16 will be used by the `isCacheValid` function at line 80

## Files to Modify
- `public/sdm-dashboard.js` - Remove duplicate `CACHE_TTL` declaration at line 74

## Validation
After fix, verify:
1. No more "Identifier 'CACHE_TTL' has already been declared" error
2. Page loads without JavaScript syntax errors
3. KPI functionality still works correctly