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
