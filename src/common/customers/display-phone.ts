import { PROJECTED_PHONE_PREFIX } from '../../modules/erp/customer-projection';

/**
 * The phone number to SHOW for a customer.
 *
 * `Customer.phone` is not purely a contact number: it is unique, NOT NULL, and
 * the login identifier for both the OTP and password flows. Customers
 * projected from the ERP have no usable number of their own - the feed states
 * one placeholder for 1,897 of them - so they are stored with a synthetic
 * `ERP-<CUSTOMER_CODE>` value. That keeps the column unique and keeps those
 * rows un-loginable, which is the point.
 *
 * It is NOT a phone number, so it must never reach a screen. Every customer
 * response runs through here: a synthetic value renders as an empty string,
 * which is what "we do not have a number for this distributor" looks like to
 * a client, rather than an ERP code sitting in a Phone column.
 *
 * Deliberately a display-time mapping rather than a change to what is stored.
 * Blanking the column is not open to us - it is NOT NULL and unique, and two
 * blanked rows would collide - and storing a real-looking placeholder would be
 * worse, because the OTP flow resolves accounts by exactly this value.
 */
export function displayPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone.startsWith(PROJECTED_PHONE_PREFIX) ? '' : phone;
}

/** True when a phone is the portal's own placeholder rather than a real number. */
export function isProjectedPhone(phone: string | null | undefined): boolean {
  return !!phone && phone.startsWith(PROJECTED_PHONE_PREFIX);
}

/**
 * The contact number to show for a customer, from the two places one can come
 * from.
 *
 * `stored` is `Customer.phone` - unique, and the login identifier. `fromErp`
 * is `PhoneNumber` on the ERP customer master, which is a contact detail and
 * nothing more.
 *
 * PRECEDENCE: the stored number wins when it is a real one, because that is
 * the number the account actually authenticates with and an admin needs to see
 * it. A customer projected from the ERP has only the synthetic placeholder
 * stored, so the feed's number is shown instead - which is the whole point:
 * the unique constraint on `phone` is why their real number was never stored,
 * and it must not be why it stays hidden.
 *
 * Empty string when neither source has one, never null, so the column renders
 * blank rather than "null".
 *
 * NOTE the feed's number is NOT unique - 1,897 customers share one placeholder
 * value - and it is deliberately not treated as an identity anywhere. It is
 * display only.
 */
export function contactPhone(
  stored: string | null | undefined,
  fromErp: string | null | undefined,
): string {
  const own = displayPhone(stored);
  if (own) return own;
  return fromErp?.trim() ?? '';
}
