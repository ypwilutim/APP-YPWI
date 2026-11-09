# Plan: Structure-Only DB Migration Auto-Run on Server Start

## Goal
Add one migration file that creates **all application tables (structure only, no seed data)** and is executed automatically on server start/restart via the existing `runSqlMigrations()` runner, without inserting duplicate rows.

## Target File
- `migrations/000_full_structure.sql` (sorts first; `.sql` is auto-picked by `runSqlMigrations()`)

## How It Auto-Runs (no server change needed)
`server.js` -> `startServer()` already calls `runSqlMigrations()`, which:
1. Ensures `migrations_history` exists.
2. Reads every `*.sql` in `migrations/`, sorted.
3. Executes each not-yet-recorded file via `db.runMultiple()`.
4. Records filename on success.

Because the new file uses `CREATE TABLE IF NOT EXISTS` only, re-running on an existing DB is a no-op and never inserts data.

## Content Rules
- Only DDL: `CREATE TABLE IF NOT EXISTS ...` with inline `PRIMARY KEY`, `AUTO_INCREMENT`, indexes, and `ENGINE=InnoDB ... CHARSET`.
- No `INSERT`, `UPDATE`, `DELETE`, or seed data.
- No `DELIMITER`, stored procedures, triggers, or `ALTER` statements that fail on existing tables.
- No phpMyAdmin boilerplate (`SET`, `START TRANSACTION`, `MODIFY ... AUTO_INCREMENT` blocks).

## Source Strategy (implementation agent)
Build the file by concatenating DDL from these well-formed sources, stripping any data statements:
1. `server.js` `ensureTable(...)` blocks (payment_admin_settings, spmb_*, kafalah_*, tahun_ajaran, semester).
2. Existing migration files with `CREATE TABLE IF NOT EXISTS`:
   - `2026_pakta_integritas.sql` (drop INSERT/UPDATE)
   - `2026_sdm_tables.sql` (drop seed INSERTs)
   - `2026_spmb_tables.sql`, `2026_whatsapp_inbound.sql`, `2026_payment_gateways.sql`, `2026_midtrans.sql`, `migrations/create_*_table.sql`, `migrations/add_tahun_ajaran.sql`
3. Tables only present in `struktur_db_hosting.sql`/`struktur_db_local.sql`: generate `CREATE TABLE IF NOT EXISTS` by merging each dump's CREATE + PK/AI/index lines into the table definition (inline), then discard the dump's trailing ALTER/AUTO_INCREMENT blocks.

## Risks / Notes
- Dropping seed INSERTs means config tables may start empty; code must tolerate missing rows or add `INSERT IGNORE` at runtime (as already done for `payment_admin_settings`).
- Column additions already handled by `ensureColumn`/`ensureColumnNullable` in `server.js`; the migration only needs base tables.
- Fresh DB test required to ensure all tables create cleanly.

## Validation
- Fresh DB: start server, confirm `[MIGRATION] Completed: 000_full_structure.sql` and all tables exist.
- Restart: confirm `[MIGRATION] Skipping already executed: 000_full_structure.sql`.
- `grep -iE "INSERT|UPDATE|DELETE|DELIMITER|ALTER TABLE" migrations/000_full_structure.sql` returns no matches (except comments).
