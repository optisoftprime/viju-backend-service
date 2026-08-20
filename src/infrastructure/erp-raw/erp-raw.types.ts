import { Region } from '../../common/region/region.constants';

/**
 * Read models over the `erp_raw` schema — the landing area the ERP ingest
 * writes into before a separate projector copies rows into the application
 * tables.
 *
 * Nothing here writes. The ingest and projection jobs live outside this
 * service; the portal only reads `erp_raw` to reconcile what it holds locally
 * against what the ERP actually has.
 */

/** Freshness of one ingest/projection job. */
export interface ErpSyncJob {
  job: string;
  status: string;
  lastFinishedAt: Date | null;
  rowsFetched: number | null;
  rowsProjected: number | null;
}

export interface ErpSyncStatus {
  /** Most recent successful finish across every job, or null. */
  lastSyncAt: Date | null;
  jobs: ErpSyncJob[];
}

/**
 * Customer counts as the ERP sees them, next to what has actually been
 * projected locally.
 */
export interface ErpCustomerCounts {
  /** Every row in the ERP customer feed, including other tenants'. */
  erpTotal: number;
  /** Rows whose BP_CLUSTER_CODE maps to a Viju region (1-5). */
  vijuTotal: number;
  /** Rows whose region cannot be mapped — quarantined, not counted as Viju. */
  unmappedRegionCount: number;
  /** Mappable rows per region. */
  byRegion: Partial<Record<Region, number>>;
  /** When the customer feed was last ingested. */
  lastSyncAt: Date | null;
}

/** One ERP customer row that could not be region-mapped. */
export interface ErpUnmappedCustomer {
  erpId: string;
  name: string | null;
  phone: string | null;
  /** The raw, unmapped BP_CLUSTER_CODE exactly as the ERP sent it. */
  bpClusterCode: string | null;
  bpClusterName: string | null;
  lastSeenAt: Date | null;
}

/** ERP-side detail for one customer, for parity on the detail screen. */
export interface ErpCustomerDetail {
  erpId: string;
  name: string | null;
  phone: string | null;
  region: Region | null;
  /** Raw BP_CLUSTER_CODE, kept for diagnostics when region is null. */
  bpClusterCode: string | null;
  /** Latest effective credit limit (CREDIT_AMT), or null when none on file. */
  creditLimit: number | null;
  /**
   * Ship-to address from the most recent sales delivery. The ERP customer
   * master carries no address field, so this is the closest truth available.
   */
  address: string | null;
  /** When this customer row was last seen in the ERP feed. */
  lastErpSyncAt: Date | null;
}

/** The movement types a statement line can be. */
export const STATEMENT_LINE_TYPES = [
  'INVOICE',
  'PAYMENT',
  'TRANSPORT_ALLOWANCE',
  'REFUND',
  'RETURN',
] as const;
export type StatementLineType = (typeof STATEMENT_LINE_TYPES)[number];

/**
 * One ledger movement, before the running balance is applied.
 *
 * `debit` increases what the distributor owes (invoices); `credit` reduces it
 * (payments, allowances, refunds, returns). Exactly one of the two carries a
 * value — the other is 0, never null.
 */
export interface ErpStatementMovement {
  date: Date;
  type: StatementLineType;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  /** ERP row ordering key, used to break ties on identical timestamps. */
  sequence: number;
}
