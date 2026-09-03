import { displayPhone, isProjectedPhone } from './display-phone';

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
