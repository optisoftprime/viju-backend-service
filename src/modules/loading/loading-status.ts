import { ConflictException, HttpStatus } from '@nestjs/common';
import { LoadingRequestStatus } from '@prisma/client';

/**
 * The loading lifecycle, in the two vocabularies it is spoken in.
 *
 * The database enum is the long form the schema has always used
 * (PENDING_ASSIGNMENT / LOADING_IN_PROGRESS). The portals speak the short
 * form the loading and regional screens are built around
 * (PENDING / IN_PROGRESS). Rather than migrate the enum — which every
 * existing row, index and query depends on — the boundary translates, exactly
 * like the ERP's BP_CLUSTER_CODE does for regions.
 *
 * Both spellings are accepted on input so existing clients keep working;
 * responses always use the short form.
 */

export const API_LOADING_STATUS_VALUES = [
  'PENDING',
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export type ApiLoadingStatus = (typeof API_LOADING_STATUS_VALUES)[number];

const API_BY_DB: Readonly<Record<LoadingRequestStatus, ApiLoadingStatus>> =
  Object.freeze({
    PENDING_ASSIGNMENT: 'PENDING',
    ASSIGNED: 'ASSIGNED',
    LOADING_IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
  });

const DB_BY_API: Readonly<Record<ApiLoadingStatus, LoadingRequestStatus>> =
  Object.freeze({
    PENDING: LoadingRequestStatus.PENDING_ASSIGNMENT,
    ASSIGNED: LoadingRequestStatus.ASSIGNED,
    IN_PROGRESS: LoadingRequestStatus.LOADING_IN_PROGRESS,
    COMPLETED: LoadingRequestStatus.COMPLETED,
    CANCELLED: LoadingRequestStatus.CANCELLED,
  });

/** Every spelling a client may send for a status filter. */
export const ACCEPTED_LOADING_STATUS_VALUES = [
  ...API_LOADING_STATUS_VALUES,
  ...Object.values(LoadingRequestStatus),
] as const;

/** Database enum -> the value returned by the API. */
export function toApiStatus(status: LoadingRequestStatus): ApiLoadingStatus {
  return API_BY_DB[status];
}

/**
 * P-1 — the wording a distributor reads in a push/bell notification.
 *
 * The notification text is prose aimed at a distributor ("Your loading status
 * is now: Loading in Progress"), so it must never carry an enum in either
 * vocabulary — neither LOADING_IN_PROGRESS nor IN_PROGRESS is something to
 * show a customer. Kept beside the two enum maps above so a new status cannot
 * gain a spelling without also gaining a label.
 */
const LABEL_BY_DB: Readonly<Record<LoadingRequestStatus, string>> =
  Object.freeze({
    PENDING_ASSIGNMENT: 'Pending Assignment',
    ASSIGNED: 'Assigned',
    LOADING_IN_PROGRESS: 'Loading in Progress',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
  });

/** Database enum -> human-readable label for customer-facing copy (P-1). */
export function toStatusLabel(status: LoadingRequestStatus): string {
  return LABEL_BY_DB[status];
}

/**
 * Client value -> database enum. Accepts either vocabulary; returns null for
 * anything unrecognised so callers can decide between ignoring and rejecting.
 */
export function toDbStatus(value: string): LoadingRequestStatus | null {
  if (value in DB_BY_API) return DB_BY_API[value as ApiLoadingStatus];
  if (value in LoadingRequestStatus) return value as LoadingRequestStatus;
  return null;
}

/**
 * Legal forward transitions for the loading officer (LO-04).
 * ASSIGNED -> IN_PROGRESS -> COMPLETED, and nothing else: a completed load
 * cannot be reopened, and a load cannot skip straight to completed without
 * having been started.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Partial<Record<LoadingRequestStatus, LoadingRequestStatus[]>>
> = Object.freeze({
  // L-1 - CANCELLED is legal from PENDING, ASSIGNED and IN_PROGRESS. A
  // COMPLETED load is final: cancelling one answers 409, which is the API
  // being the control rather than trusting the button to be hidden.
  [LoadingRequestStatus.PENDING_ASSIGNMENT]: [LoadingRequestStatus.CANCELLED],
  [LoadingRequestStatus.ASSIGNED]: [
    LoadingRequestStatus.LOADING_IN_PROGRESS,
    LoadingRequestStatus.COMPLETED,
    LoadingRequestStatus.CANCELLED,
  ],
  [LoadingRequestStatus.LOADING_IN_PROGRESS]: [
    LoadingRequestStatus.COMPLETED,
    LoadingRequestStatus.CANCELLED,
  ],
});

/**
 * L-1 - can this load still be called off?
 *
 * COMPLETED and CANCELLED are both terminal. Exposed so the cancel routes can
 * answer 409 with the same wording as the status route rather than inventing
 * their own.
 */
export function assertCancellable(from: LoadingRequestStatus): void {
  assertLoadingTransition(from, LoadingRequestStatus.CANCELLED);
}

/**
 * Rejects an illegal transition with a 409 carrying a machine-readable
 * `code`, rather than silently accepting it.
 */
export function assertLoadingTransition(
  from: LoadingRequestStatus,
  to: LoadingRequestStatus,
): void {
  if (from === to) return;
  if (ALLOWED_TRANSITIONS[from]?.includes(to)) return;

  throw new ConflictException({
    message:
      from === LoadingRequestStatus.COMPLETED
        ? 'A completed load cannot be reopened.'
        : `A load in ${toApiStatus(from)} cannot move to ${toApiStatus(to)}.`,
    code: 'INVALID_STATUS_TRANSITION',
    statusCode: HttpStatus.CONFLICT,
  });
}
