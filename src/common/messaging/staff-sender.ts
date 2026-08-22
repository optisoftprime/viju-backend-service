import { StaffRole } from '@prisma/client';

/**
 * S-1 — the author of a staff-written ticket reply or chat message.
 *
 * `senderType` alone only says STAFF vs CUSTOMER, so an admin, a regional
 * admin and the account officer who owns the account were indistinguishable in
 * a thread: every one of them rendered as a flat "Staff". This block names who
 * actually wrote it.
 *
 * `role` is the wire enum, never display text — the client maps it to a label,
 * so backend copy changes cannot break the UI.
 */
export interface StaffSender {
  id: string;
  name: string;
  role: StaffRole;
}

/** The Prisma `select` that produces a StaffSender. One definition, reused. */
export const STAFF_SENDER_SELECT = {
  id: true,
  name: true,
  role: true,
} as const;

/**
 * Attaches `staff` to one row.
 *
 * Present ONLY on a staff-authored row. A customer-authored message carries
 * `staff: null` even though the row still stores a `staffId` — on a
 * customer-sent message that column is the officer the message was routed TO,
 * and naming them as the sender would be wrong.
 */
export function withStaffSender<
  T extends { senderType: string; staff?: StaffSender | null },
>(row: T): Omit<T, 'staff'> & { staff: StaffSender | null } {
  const { staff, ...rest } = row;
  return {
    ...rest,
    staff: row.senderType === 'STAFF' ? (staff ?? null) : null,
  };
}

/** Applies `withStaffSender` across a list. */
export function withStaffSenders<
  T extends { senderType: string; staff?: StaffSender | null },
>(rows: T[]) {
  return rows.map(withStaffSender);
}
