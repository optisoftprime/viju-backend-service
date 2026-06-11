#!/bin/sh
set -e

echo "==> Running Prisma migrations..."
npx prisma migrate deploy

# Optional DB seed, controlled by RUN_SEED. NOTE: the seed wipes and recreates
# transactional data, so keep this OFF (unset/false) anywhere with real data.
# Non-fatal: a seed failure must not stop the app from starting.
if [ "$RUN_SEED" = "true" ]; then
  echo "==> RUN_SEED=true → seeding database..."
  node dist/seed.js || echo "⚠️  Seed failed — continuing to start the app."
fi

echo "==> Starting application..."
exec node dist/main
