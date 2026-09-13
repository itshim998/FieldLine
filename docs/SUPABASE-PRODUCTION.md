# Supabase PostgreSQL Production Persistence

FieldLine supports two database providers:

- **SQLite** for deterministic local development and offline test/demo workflows.
- **PostgreSQL on Supabase** for persistent production deployment.

The production database is selected with:

```env
DATABASE_PROVIDER=postgres
DATABASE_URL=<Supabase PostgreSQL connection string>
DATABASE_SSL=true
```

The PostgreSQL schema is managed from the version-controlled migrations under `supabase/migrations/`. Production schema changes should be made through repository migrations rather than by manually editing the Supabase tables.

For the production application, the FieldLine backend connects directly to PostgreSQL. Supabase's Data API is not required for the backend persistence path.

Keep database credentials server-side. Never commit `DATABASE_URL`, database passwords, or other production secrets to the repository.
