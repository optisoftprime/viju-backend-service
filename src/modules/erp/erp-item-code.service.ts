import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * ITEM_DESCRIPTION -> ITEM_CODE, learned from the WHOLE sales-order feed.
 *
 * ─── Why this exists ────────────────────────────────────────────────────
 *
 * The ERP states ITEM_CODE on only 56,769 of 993,983 line rows - 5.7%. A
 * product is therefore usually coded SOMEWHERE in the feed but not on the
 * rows a given query happens to touch: `750ml water(L-水)` carries
 * `101020104` on 218 of its 221,464 rows, so a distributor whose own orders
 * miss those 218 saw `itemCode: null` for a product the ERP names perfectly
 * well.
 *
 * Aggregating name -> code across the whole feed fixes that. It costs 7-10
 * seconds, which is far too slow to run per request, so it is cached and
 * refreshed in the BACKGROUND: a request never waits for it. Before the first
 * build lands, callers fall back to the product specification sheet and the
 * answer is merely less complete, never wrong.
 *
 * ─── What it cannot do ──────────────────────────────────────────────────
 *
 * 58 of the feed's 152 products carry no code on any row - packaging film,
 * water-pump dispensers, biscuit freight and a handful of drink variants.
 * The specification sheet covers 25 of those; the rest have no code to state
 * and stay null. Nothing is invented.
 */
@Injectable()
export class ErpItemCodeService {
  private readonly logger = new Logger(ErpItemCodeService.name);

  /** Empty until the first build lands. Never null, so reads need no guard. */
  private codes = new Map<string, string>();
  private builtAt = 0;
  /** Single-flight: one build at a time, however many requests arrive. */
  private building: Promise<void> | null = null;

  /** Long, because ERP item codes essentially never change. */
  private static readonly TTL_MS = 6 * 60 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The code for a product name, or null.
   *
   * Kicks off a refresh when the cache is cold or stale but does NOT wait for
   * it - the caller gets today's answer now rather than a slow one.
   */
  codeFor(productName: string | null): string | null {
    if (!productName) return null;
    this.refreshIfStale();
    return this.codes.get(productName) ?? null;
  }

  /** For tests and for a caller that genuinely wants the built map. */
  async ready(): Promise<void> {
    this.refreshIfStale();
    if (this.building) await this.building;
  }

  private refreshIfStale(): void {
    if (this.building) return;
    if (Date.now() - this.builtAt < ErpItemCodeService.TTL_MS) return;
    this.building = this.build().finally(() => {
      this.building = null;
    });
    // Deliberately not awaited. A failed build must not reject into whichever
    // request happened to trigger it.
    void this.building;
  }

  private async build(): Promise<void> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        { name: string | null; code: string | null }[]
      >(
        // Filtered to coded rows FIRST, so the group-by runs over 56,769 rows
        // rather than the whole feed.
        //
        // min() where a name carries several codes: 11 products do, because
        // one ERP name spans several sizes. Picking deterministically is what
        // the per-query aggregate already did; the alternative is to state no
        // code at all for a product the ERP does name.
        `SELECT so.payload->>'ITEM_DESCRIPTION' AS name,
                min(nullif(so.payload->>'ITEM_CODE', '')) AS code
           FROM erp_raw.raw_sales_order so
          WHERE so.object_type = 'SALES_ORDER'
            AND nullif(so.payload->>'ITEM_CODE', '') IS NOT NULL
          GROUP BY 1`,
      );
      const next = new Map<string, string>();
      for (const row of rows) {
        if (row.name && row.code) next.set(row.name, row.code);
      }
      // Only adopt a build that found something. An empty result means the
      // feed is absent or the query was cut short; keeping the previous map is
      // better than blanking every code.
      if (next.size > 0) {
        this.codes = next;
        this.builtAt = Date.now();
        this.logger.log(`Item-code map built: ${next.size} products.`);
      } else {
        this.logger.warn(
          'Item-code lookup returned no rows; keeping the previous map.',
        );
      }
    } catch (e) {
      this.logger.error(
        `Could not build the item-code map: ${(e as Error).message}. ` +
          'Codes fall back to the product specification sheet.',
      );
      // Back off for a minute rather than retrying on every request.
      this.builtAt = Date.now() - ErpItemCodeService.TTL_MS + 60_000;
    }
  }
}
