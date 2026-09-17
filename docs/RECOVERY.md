# Backup and recovery

Cooper's items, settings, encrypted provider credentials, and undo history live in one database.
Keep the database backup and `COOPER_ENCRYPTION_KEY` separately; a database restore without the
matching encryption key cannot read saved Google or iCloud credentials. Never put database URLs,
keys, backup contents, or provider tokens in a ticket or application log.

## Hosted PostgreSQL

Before public launch, verify the database provider's backup schedule, retention, and restore
permissions in its dashboard. Record the latest successful backup time and perform a restore into
a **separate disposable database**. The repository and Render environment template do not create
or prove that a hosted backup exists.

For a manual backup using the database provider's direct PostgreSQL connection, set the standard
libpq connection variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`) in a secure
shell session, then run:

```bash
pg_dump --format=custom --no-owner --file=cooper-backup.dump
```

Store the dump in restricted, encrypted storage away from the running API. Use a newly created,
empty database for the restoration test, with its own libpq connection variables:

```bash
pg_restore --no-owner --exit-on-error --dbname="$PGDATABASE" cooper-backup.dump
```

Start the same Cooper build against the restored database. Confirm `/health` returns `200`, sign
in with a test account, check that expected items and settings appear, and verify that
the latest migrations match the build. Do not run the restore against the live database during a
test. Record the backup timestamp, restore date, result, and time taken without user data or
secrets. Recheck after schema changes and periodically thereafter.

For an incident, stop API writes and the Gmail sync timer first. Determine the last known good
backup and the amount of data that would be lost. Restore into a new database, validate it as
above, then switch the server-side `COOPER_DATABASE_URL` to that database and restart the API.
Keep the old database isolated until reconciliation is complete. Reconnect provider accounts if
their saved credentials cannot be decrypted with the restored key.

## Local SQLite

Use SQLite's online backup API while the application may be running; do not copy an active
`cooper.db` file directly. The local backup and disposable restore were exercised on 2026-09-17
with `sqlite3.Connection.backup()`, `PRAGMA integrity_check`, and matching row counts for all
three tables. This does not validate hosted PostgreSQL backups.
