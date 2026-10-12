// Describe why an account session cannot be trusted for booking, without logging credentials or tokens.
export function authFailure(state) {
  if (state.tokenUnexpired && (state.accountMatchesHolder ?? state.accountMatchesTraveller) === false) {
    return 'signed in, but the account name does not match the configured account holder';
  }
  if (state.tokenUnexpired && !state.tripsReadable) {
    return `signed in, but the trip list could not be read (HTTP ${state.tripStatus ?? 'unknown'})`;
  }
  if (state.pageMessage) return `Le Frecce sign-in page: ${state.pageMessage.replace(/\s+/g, ' ').slice(0, 160)}`;
  if (state.how === 'no saved credential') return 'no saved credential in this workstation; run login --manual or save one locally';
  return 'sign-in did not create a verified session; check the local browser window for a challenge or changed login flow';
}
