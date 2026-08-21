/**
 * Seeds the internally managed staff roster (PRD "Change in User Source").
 *
 * Two accounts for every managed role in every region:
 *
 *   ADMIN            x2   organisation-wide, no region (an ADMIN never has one)
 *   REGIONAL_ADMIN   x2   per region  = 10
 *   OFFICER          x2   per region  = 10   ("account officer")
 *   LOADING_OFFICER  x2   per region  = 10
 *                                       ---
 *                                        32
 *
 * Deliberately SEPARATE from seed.ts, which opens by deleting every staff row
 * plus the transactional tables. This script only ever upserts the 32 rows
 * below, keyed on email, and touches nothing else — so it is safe to run
 * against a shared environment.
 *
 * Idempotent: re-running restores the roster to a known-good state, which
 * includes clearing any deactivation an admin applied while testing.
 *
 *   npm run db:seed:staff
 */
import { PrismaClient, Region, StaffRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Same shared dev password as seed.ts — see DEV_CREDENTIALS.md. */
const STAFF_PASSWORD = 'Staff@123';

/** Regions in BP_CLUSTER_CODE order, with the slug used in seeded emails. */
const REGIONS: Array<{ region: Region; slug: string }> = [
  { region: 'LAGOS', slug: 'lagos' },
  { region: 'EASTERN', slug: 'eastern' },
  { region: 'SOUTH_SOUTH', slug: 'southsouth' },
  { region: 'WESTERN', slug: 'western' },
  { region: 'NORTH', slug: 'north' },
];

/**
 * Two names per region per role. Kept explicit rather than generated so the
 * roster reads like real data in the portal's lists and pickers.
 */
const NAMES: Record<string, Record<Region, [string, string]>> = {
  REGIONAL_ADMIN: {
    LAGOS: ['Ngozi Okafor', 'Tunde Bakare'],
    EASTERN: ['Chidera Anyanwu', 'Emeka Nwosu'],
    SOUTH_SOUTH: ['Preye Amaso', 'Itoro Effiong'],
    WESTERN: ['Yewande Ogunbiyi', 'Segun Alabi'],
    NORTH: ['Musa Aliyu', 'Hauwa Danjuma'],
  },
  OFFICER: {
    LAGOS: ['Funmi Adelaja', 'Ifeoma Balogun'],
    EASTERN: ['Chukwuma Eze', 'Adaeze Obiora'],
    SOUTH_SOUTH: ['Ebiere Tamuno', 'Oghenero Ejiro'],
    WESTERN: ['Bolanle Adeyemi', 'Kayode Sanusi'],
    NORTH: ['Aisha Bello', 'Sanusi Garba'],
  },
  LOADING_OFFICER: {
    LAGOS: ['Ifeanyi Okonkwo', 'Basirat Lawal'],
    EASTERN: ['Obinna Udeh', 'Nkiru Chukwu'],
    SOUTH_SOUTH: ['Tonye Briggs', 'Mercy Akpan'],
    WESTERN: ['Bisi Adewale', 'Femi Oyelaran'],
    NORTH: ['Zainab Yusuf', 'Ibrahim Tanko'],
  },
};

/** Email local-part prefix per role. */
const EMAIL_PREFIX: Record<string, string> = {
  REGIONAL_ADMIN: 'regional',
  OFFICER: 'officer',
  LOADING_OFFICER: 'loader',
};

interface StaffSeed {
  email: string;
  name: string;
  phone: string;
  role: StaffRole;
  region: Region | null;
}

/**
 * Phone numbers come from a dedicated +2349010000xxx block so they cannot
 * collide with the +2348000000xxx roster in seed.ts. Staff.phone is unique.
 */
function phoneFor(index: number): string {
  return `+23490100${String(index).padStart(5, '0')}`;
}

function buildRoster(): StaffSeed[] {
  const roster: StaffSeed[] = [];
  let n = 1;

  // The two bootstrap admins. Organisation-wide, so region stays null —
  // createOfficer() refuses a region on an ADMIN for the same reason.
  for (const [i, name] of ['Grace Adeyemi', 'Daniel Eshiet'].entries()) {
    roster.push({
      email: `admin${i + 1}@viju.local`,
      name,
      phone: phoneFor(n++),
      role: 'ADMIN',
      region: null,
    });
  }

  for (const role of [
    'REGIONAL_ADMIN',
    'OFFICER',
    'LOADING_OFFICER',
  ] as const) {
    for (const { region, slug } of REGIONS) {
      for (const [i, name] of NAMES[role][region].entries()) {
        roster.push({
          email: `${EMAIL_PREFIX[role]}.${slug}${i + 1}@viju.local`,
          name,
          phone: phoneFor(n++),
          role,
          region,
        });
      }
    }
  }

  return roster;
}

async function main() {
  const roster = buildRoster();
  const password = await bcrypt.hash(STAFF_PASSWORD, 10);

  console.log(
    `\n🌱 Seeding ${roster.length} internally managed staff accounts...\n`,
  );

  // Admins first: the first one is recorded as the creator of everyone else,
  // so the audit trail (createdBy) is populated the way a real provisioning
  // run would leave it. The bootstrap admins themselves have no creator.
  const admins = roster.filter((s) => s.role === 'ADMIN');
  const rest = roster.filter((s) => s.role !== 'ADMIN');

  const created: Array<StaffSeed & { id: string }> = [];

  for (const s of admins) {
    const row = await upsert(s, password, null);
    created.push({ ...s, id: row.id });
  }
  const provisioningAdminId = created[0].id;

  for (const s of rest) {
    const row = await upsert(s, password, provisioningAdminId);
    created.push({ ...s, id: row.id });
  }

  report(created);
}

/**
 * Upsert one account. On re-run the row is returned to the seeded baseline:
 * active, with the deactivation stamps cleared, so a roster left half-retired
 * by manual testing comes back clean.
 */
function upsert(s: StaffSeed, password: string, createdById: string | null) {
  const baseline = {
    name: s.name,
    phone: s.phone,
    role: s.role,
    region: s.region,
    password,
    isActive: true,
    deactivatedAt: null,
    deactivatedById: null,
    reactivatedAt: null,
    reactivatedById: null,
  };
  return prisma.staff.upsert({
    where: { email: s.email },
    update: baseline,
    create: { ...baseline, email: s.email, createdById },
    select: { id: true },
  });
}

function report(created: Array<StaffSeed & { id: string }>) {
  const width = Math.max(...created.map((s) => s.email.length));
  let role = '';
  for (const s of created) {
    if (s.role !== role) {
      role = s.role;
      console.log(`\n  ${role}`);
    }
    console.log(
      `    ${s.email.padEnd(width)}  ${STAFF_PASSWORD}  ` +
        `${(s.region ?? '—').padEnd(11)}  ${s.name}`,
    );
  }
  console.log(
    `\n✅ ${created.length} accounts ready. ` +
      `Sign in at POST /api/v1/auth/staff/web-login ` +
      `with { username: <email>, code: "${STAFF_PASSWORD}" }.\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
