// Prisma stops auto-loading .env as soon as a config file is present
// ("Prisma config detected, skipping environment variable loading"), so the
// datasource url in prisma/schema/index.prisma would resolve to undefined.
// This import restores it and must stay first.
import 'dotenv/config';

import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration.
 *
 * This exists to fix a real bug: the schema lives in a folder
 * (`prisma/schema/`, multi-file), and Prisma resolves the migrations
 * directory relative to the schema path. With the previous
 * `package.json#prisma.schema = "prisma/schema"` setting it therefore looked
 * for migrations under `prisma/schema/migrations`, found none, and reported
 * "No migration found in prisma/migrations" while claiming the database was
 * up to date. `prisma migrate deploy` silently applied nothing.
 *
 * That is how `20260618000000_add_staff_last_login` ended up applied to the
 * database (its columns exist) without ever being recorded in
 * `_prisma_migrations`. Pointing `migrations.path` at the real directory makes
 * `migrate deploy` / `migrate status` work again.
 *
 * NOTE: when this file is present, Prisma ignores the `prisma` block in
 * package.json entirely — so `schema` and the seed command have to be declared
 * here, not there.
 */
export default defineConfig({
  // Multi-file schema: every *.prisma under this folder is loaded.
  schema: path.join('prisma', 'schema'),

  migrations: {
    // The directory that actually holds the migrations, and the whole reason
    // this config file exists.
    path: path.join('prisma', 'migrations'),

    // Moved from package.json#prisma.seed, which is no longer read.
    seed: 'ts-node prisma/seed.ts',
  },
});
