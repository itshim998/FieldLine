# Supabase PostgreSQL Production Architecture & Migration Authority

FieldLine supports two database providers:

- **SQLite** for deterministic local development and offline test/demo workflows.
- **PostgreSQL on Supabase** for persistent production deployment.

---

## 1. Production Migration Authority

In production, **Supabase GitHub Integration is the sole authoritative schema-migration authority**.

```text
GitHub main
    ↓
Supabase production deployment
    ↓
supabase/migrations/*.sql applied by Supabase
    ↓
Render / FieldLine backend deployment
```

### Flow & Invariants:
1. **Migrations apply first**: Schema changes are committed to `supabase/migrations/` and deployed automatically by the Supabase GitHub Integration.
2. **Backend does NOT run migrations**: FieldLine backend running on Render does **not** compete with Supabase over migration execution.
3. **Configuration**:
   ```env
   DATABASE_PROVIDER=postgres
   DATABASE_AUTO_MIGRATE=false
   ```
4. **Local Development Exception**: For local or non-Supabase PostgreSQL instances, migrations can be applied by explicitly setting `DATABASE_AUTO_MIGRATE=true`. In production, this must always remain `false`.

---

## 2. Startup & Schema-Readiness Check

Since the production application does not execute migrations on startup, it enforces safe fail-fast startup semantics:

```text
Initialize PostgreSQL shared pool (1-5 connections)
       ↓
Verify database connectivity (SELECT 1)
       ↓
Verify schema readiness (all 13 critical tables exist)
       ↓
Golden Demo check / seed (only if AUTO_SEED_DEMO=true)
       ↓
Recover stale processing jobs
       ↓
Recover stale anomaly notification leases
       ↓
Start background workers (document ingestion & anomaly outbox)
       ↓
Start HTTP & WebSocket servers
```

If the database is unmigrated or missing any critical domain/operational table:
- Startup immediately **halts** with a safe diagnostic:
  `FieldLine database schema is not ready. Missing table(s): <tables>. Apply pending Supabase migrations before starting the backend.`
- Workers and HTTP server **never** start against an incomplete schema.
- Credentials, passwords, and SQL secrets are never dumped in diagnostics.

---

## 3. PostgreSQL TLS Configuration

FieldLine connects to Supabase PostgreSQL via the Session Pooler (port 5432) or Transaction Pooler (port 6543) over TLS (`DATABASE_SSL=true`).

### Why `DATABASE_SSL_REJECT_UNAUTHORIZED=false` is default:
Supabase pooler instances utilize internal certificate chains that terminate with Supabase's private root certificate. Connecting with Node's standard Mozilla CA store with `rejectUnauthorized: true` produces `SELF_SIGNED_CERT_IN_CHAIN` unless Supabase's root CA certificate is specifically mounted and passed to Node.

Therefore:
- `DATABASE_SSL=true` enables SSL/TLS encryption.
- `DATABASE_SSL_REJECT_UNAUTHORIZED=false` allows TLS encryption while accommodating Supabase's certificate chain.
- If a custom root certificate is provided, set `DATABASE_SSL_CA=/path/to/root.crt` and `DATABASE_SSL_REJECT_UNAUTHORIZED=true`.

---

## 4. Auto-Seeding Safety

- `AUTO_SEED_DEMO` defaults to `false` in `env.ts`.
- The application will **never** automatically populate demo data into an empty production database unless `AUTO_SEED_DEMO=true` is explicitly provided.
- For the SIH presentation environment on Render, `AUTO_SEED_DEMO="true"` is explicitly declared in `render.yaml`.
- The `seedGoldenDemo` runner is idempotent: if the project `PROJ-REF-U4` already exists with its canonical 30 activities and schedule, it returns existing metadata without duplicating rows or relationships.

---

## 5. Summary of Production Environment Variables

| Variable | Recommended Production Value | Description |
|---|---|---|
| `DATABASE_PROVIDER` | `postgres` | Selects PostgreSQL driver |
| `DATABASE_URL` | `postgresql://postgres.[REF]:[PASS]@aws-0-[REGION].pooler.supabase.com:5432/postgres` | Supabase connection string |
| `DATABASE_AUTO_MIGRATE` | `false` | Supabase GitHub Integration manages migrations |
| `DATABASE_SSL` | `true` | Enables encrypted TLS connection |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | `false` | Accommodates Supabase pooler certificate chain |
| `DATABASE_POOL_MIN` | `1` | Shared pool minimum connections |
| `DATABASE_POOL_MAX` | `5` | Shared pool maximum connections |
| `AUTO_SEED_DEMO` | `false` (or `true` for SIH demo) | Prevents unintended demo seeding |
