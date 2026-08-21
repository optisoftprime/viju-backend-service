/**
 * Message returned whenever a deactivated staff account tries to
 * authenticate — at login, at refresh, and on any request carrying a token
 * minted before the deactivation (US-15.5).
 *
 * The web client renders the API `message` verbatim, so it lives in one place
 * and every path uses the same wording.
 */
export const DEACTIVATED_ACCOUNT_MESSAGE =
  'This account has been deactivated. Contact an administrator.';

/**
 * Returned when ERP credentials are presented for a role this service now
 * manages (ADMIN, REGIONAL_ADMIN, OFFICER, LOADING_OFFICER) and no local
 * account exists. The ERP no longer provisions these — an ADMIN must create
 * the account through POST /admin/officers first.
 */
export const NOT_PROVISIONED_MESSAGE =
  'No account exists for these credentials. Ask an administrator to create one.';

/**
 * Returned when an internally managed account exists but has no local
 * password yet — typically a row that predates admin-managed provisioning and
 * used to authenticate straight against the ERP. The password-reset flow
 * (/auth/staff/password-reset/request) sets one.
 */
export const PASSWORD_NOT_SET_MESSAGE =
  'This account has no password yet. Use "Forgot password" to set one, or contact an administrator.';
