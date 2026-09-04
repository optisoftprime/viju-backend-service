import { contactPhone, displayPhone, isProjectedPhone } from './display-phone';

/**
 * The Phone column must carry a phone number or nothing at all.
 *
 * Customers projected from the ERP are stored with a synthetic
 * `ERP-<CUSTOMER_CODE>` phone, because the column is unique, NOT NULL and the
 * login identifier, and the feed states one placeholder number for 1,897
 * customers. That value keeps those rows un-loginable - it must never be
 * rendered as if it were a contact number.
 */
describe('displayPhone', () => {
  it('blanks the portal’s synthetic ERP placeholder', () => {
    expect(displayPhone('ERP-90002')).toBe('');
  });

  it('keeps a real number exactly as stored', () => {
    expect(displayPhone('+2348168584112')).toBe('+2348168584112');
  });

  it('does not blank a number that merely contains ERP-', () => {
    // Only the PREFIX marks a placeholder; a real number is never touched.
    expect(displayPhone('+234-ERP-001')).toBe('+234-ERP-001');
  });

  it('returns an empty string for a missing number, never null', () => {
    expect(displayPhone(null)).toBe('');
    expect(displayPhone(undefined)).toBe('');
    expect(displayPhone('')).toBe('');
  });

  it('identifies which rows have no real number', () => {
    expect(isProjectedPhone('ERP-90002')).toBe(true);
    expect(isProjectedPhone('+2348168584112')).toBe(false);
    expect(isProjectedPhone(null)).toBe(false);
  });
});

/**
 * The unique constraint on `Customer.phone` is why a projected customer's real
 * number was never stored. It must not also be why it stays hidden: the ERP
 * states one on the customer master, and that is a contact detail, not an
 * identity.
 */
describe('contactPhone', () => {
  it('shows the ERP number when the stored one is the placeholder', () => {
    // ABAYOMI (10110001) - a real, unique number the unique constraint kept
    // out of Customer.phone.
    expect(contactPhone('ERP-10110001', '09139580925')).toBe('09139580925');
  });

  it('prefers the stored number when it is a real one', () => {
    // The account authenticates with it, so an admin has to see THAT number.
    expect(contactPhone('+2348168584112', '09139580925')).toBe(
      '+2348168584112',
    );
  });

  it('shows the ERP number for a customer with no stored number at all', () => {
    expect(contactPhone(null, '08036443423')).toBe('08036443423');
  });

  it('returns an empty string when neither source has one', () => {
    expect(contactPhone('ERP-90002', null)).toBe('');
    expect(contactPhone('ERP-90002', undefined)).toBe('');
    expect(contactPhone(null, null)).toBe('');
  });

  it('trims a padded ERP value rather than passing whitespace through', () => {
    expect(contactPhone('ERP-90002', '  08036443423 ')).toBe('08036443423');
  });
});
