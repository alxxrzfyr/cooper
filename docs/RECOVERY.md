# Backup and recovery

Use this runbook for database backups, restore tests, and data incidents. Deployment rollback is in
[WORKFLOW.md](WORKFLOW.md#rollback-and-incidents).

## Protect the recovery material

The database holds planning data, settings, encrypted provider credentials, undo, and AI accounting.
Keep backups in restricted encrypted storage away from the API. Store the matching
`COOPER_ENCRYPTION_KEY` separately. Without it, restored Google and iCloud credentials cannot be
read. Never put keys, database URLs, backup contents, or provider tokens in logs or tickets.

## Hosted PostgreSQL

### Verify and back up

Before public launch, confirm the provider dashboard's backup schedule, retention, restore
permissions, and latest successful backup. The repository and Render template do not create or
prove hosted backups.

For a manual backup, set libpq variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`)
privately for the provider's direct PostgreSQL connection, then run:

```bash
pg_dump --format=custom --no-owner --file=cooper-backup.dump
```

### Test a restore

1. Create a **separate disposable empty database**. Change the libpq variables to that destination.
   Never test against production. In a Bash-compatible shell, run:

   ```bash
   pg_restore --no-owner --exit-on-error --dbname="$PGDATABASE" cooper-backup.dump
   ```

2. Start the same Cooper build against the restored database with the matching encryption key.
   Confirm `/health` returns 200, test-account sign-in works, expected items and settings appear,
   and migrations match the build.
3. Record backup timestamp, restore date, result, and elapsed time without secrets or user data.
   Repeat after schema changes and periodically thereafter.

### Recover an incident

1. Stop API writes and the Gmail timer.
2. Identify the last known good backup and expected data loss.
3. Restore into a new database and validate using the restore checklist above.
4. After approval, change server-side `COOPER_DATABASE_URL` and restart. Isolate the old database
   until reconciliation is complete. Reconnect accounts if saved credentials cannot be decrypted.

## Local SQLite

Use `sqlite3.Connection.backup()` for an online backup. Do not copy an active `cooper.db` directly.
Restore into a disposable database first and check integrity and expected data before using it.

**Historical evidence, 2026-09-17:** local backup and restore used the online API,
`PRAGMA integrity_check`, and matching row counts for the three planning tables present then. This
is not evidence for the later AI tables or hosted PostgreSQL backups.
