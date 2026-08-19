#!/bin/sh
set -e

echo "==> Running Prisma migrations..."
npx prisma migrate deploy

# NOTE: the DB is intentionally NOT seeded on boot — seeding wipes
# transactional data. Run it on demand instead (compiled seed is in the image):
#   docker compose -p viju run --rm --entrypoint node app dist/seed.js
echo "==> Starting application..."
exec node dist/main
