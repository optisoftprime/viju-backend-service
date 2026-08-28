import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * CB-1 — who performed an action, at the shape a table cell renders.
 *
 * `role` is the WIRE ENUM (`OFFICER`, `REGIONAL_ADMIN`, `LOADING_OFFICER`),
 * never display text: the portal maps it through `formatRole()` so it reads
 * "Account Officer" rather than "OFFICER", and two clients rendering the same
 * enum cannot word it differently.
 *
 * The role carries as much weight as the name here — "who do I ask about
 * this" has a different answer for a loading officer at the depot than for the
 * regional admin who overruled them.
 */
export interface ActorRef {
  id: string;
  name: string;
  role: string;
}

/**
 * Resolves a set of staff ids to `{ id, name, role }`, in ONE query.
 *
 * Deliberately a lookup rather than a Prisma relation on `cancelledById`.
 * Adding the relation would mean a migration to create a foreign key on a
 * table that already holds data, for a field that is read on a minority of
 * rows — this keeps CB-1 a zero-migration change and costs one extra query per
 * page, only when a page actually contains cancelled rows.
 *
 * Ids that no longer resolve (a staff row removed outside this service) simply
 * do not appear in the map, and the caller renders `null` — the same as a row
 * that was never cancelled by anyone.
 */
export async function actorsByIdFor(
  prisma: PrismaService,
  ids: (string | null | undefined)[],
): Promise<Map<string, ActorRef>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();

  const staff = await prisma.staff.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, role: true },
  });
  return new Map(staff.map((s) => [s.id, s]));
}

/** The `cancelledBy` value for one row, or null when there is nobody to name. */
export function actorOf(
  actors: Map<string, ActorRef>,
  id: string | null | undefined,
): ActorRef | null {
  return id ? (actors.get(id) ?? null) : null;
}
