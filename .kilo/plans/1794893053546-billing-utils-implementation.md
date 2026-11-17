# BSI Import Fix Plan

## Current Issues

1. **Server restart required** - Node.js caches modules; updated `billing.js` not loaded
2. **VA matching fails** - `students.va_number` stored as "BSI 8322318765503018" but BSI sends raw digits "8322318765503018"
3. **Table schema** - Need to ensure `payment_bsi_transactions` matches required structure
4. **Field normalization** - BSI JSON uses different field names than CSV parser expects

## Required Fixes

### 1. Restart Server (Immediate)
```bash
# Restart Node.js process to reload billing.js
pm2 restart all  # or pkill node && npm start
```

### 2. VA Matching Fix (Already Applied)
- `billing.js` line 87-90: Query now strips "BSI ", spaces, dashes from stored `va_number` before comparing

### 3. Verify Table Schema
Current schema in `billing.js` `ensureBillingTables()`:
```sql
payment_bsi_transactions:
- id, tenant_id, transaction_id (UNIQUE)
- source_account, sender_name
- beneficiary_va, va_name
- billing_number, additional_info, remarks, transaction_date, periode
- amount, channel, transfer_type, status
- matched_student_id, is_matched, created_at
```

This matches user requirements ✓

### 4. Field Normalization (Already Applied)
- `bsi-import.js` normalizes JSON fields (`va_number`, `nominal`, `tanggal_transaksi`, etc.) to CSV header names before passing to billing

### 5. Balance Recalculation
- `recalcStudent()` sums: paid bills + incoming payments - outstanding bills
- Updates `saldo_siswa`

## Validation Steps

1. Restart server
2. Re-run import with test data
3. Verify `payment_bsi_transactions` has 10 rows
4. Verify `matched_student_id` and `is_matched=1` for matched VAs
4. Verify `incoming_payments` has matched rows
5. Verify `saldo_siswa` updated for matched students
6. Response should show: `X baris incoming disimpan, 0 duplikat dilewati, Y siswa dihitung ulang saldonya`

## Edge Cases

- Duplicate import (same transaction_id) → should skip via UNIQUE constraint
- VA not in students table → saved to `payment_bsi_transactions` only, `is_matched=0`
- Status "Suspect" → still saved, matched if VA exists
- Multiple transactions same VA → all matched, balance sums all

## Files Modified

- `src/utils/billing.js` - Core logic (table creation, insert, matching, recalc)
- `src/routes/bsi-import.js` - Field normalization for JSON input