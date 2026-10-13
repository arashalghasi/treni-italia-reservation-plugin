const loginPath = '/PicoAuth/api/auth/login';

function isLoginRequest(request) {
  try { return request.method() === 'POST' && new URL(request.url()).pathname === loginPath; }
  catch { return false; }
}

export function classifyAuthResponse({ status = null, contentType = null, body = null } = {}) {
  const mimeType = String(contentType || '').split(';')[0].trim().toLowerCase();
  const safeType = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType) ? mimeType.slice(0, 80) : null;
  const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  const text = typeof body === 'string' ? body : '';
  let code = '';
  if (safeType === 'application/json' || safeType?.endsWith('+json')) {
    try {
      const document = JSON.parse(text);
      const explicit = document?.error ?? document?.code ?? document?.errorCode;
      if (typeof explicit === 'string') code = explicit.toLowerCase().replace(/[\s-]+/g, '_');
    } catch { /* an unreadable response is not proof of bad credentials */ }
  }
  let error = null;
  if (safeStatus === 403 && safeType === 'text/html' && /Access Denied|errors\.edgesuite\.net|Akamai/i.test(text)) {
    error = 'site-access-blocked';
  } else if ([400, 401, 403].includes(safeStatus) && ['invalid_grant', 'invalid_credentials', 'incorrect_credentials', 'bad_credentials'].includes(code)) {
    error = 'credential-rejected';
  } else if (/captcha|challenge|(^|_)otp(_|$)|(^|_)mfa(_|$)|two_factor/i.test(code)
    || ([401, 403, 429].includes(safeStatus) && /captcha|one.time.password|two.factor|verification challenge/i.test(text))) {
    error = 'site-challenge';
  } else if (safeStatus === null) {
    error = 'auth-response-missing';
  } else if (safeStatus >= 400) {
    error = 'auth-http-error';
  }
  return { status: safeStatus, contentType: safeType, error };
}

// Install both listeners before the click. The response body is inspected only in memory and never returned.
export async function captureAuthResponse(page, click, timeoutMilliseconds = 15000) {
  let timer;
  let resolveEvent;
  let settled = false;
  const removeListeners = () => {
    clearTimeout(timer);
    page.off('response', onResponse);
    page.off('requestfailed', onRequestFailed);
  };
  const settle = (value) => {
    if (settled) return;
    settled = true;
    removeListeners();
    resolveEvent(value);
  };
  const onResponse = (response) => {
    if (isLoginRequest(response.request())) settle({ response });
  };
  const onRequestFailed = (request) => {
    if (isLoginRequest(request)) settle({ failed: true });
  };
  const event = new Promise((resolve) => { resolveEvent = resolve; });
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);
  timer = setTimeout(() => settle({ missing: true }), timeoutMilliseconds);
  try {
    await click();
    const observed = await event;
    if (observed.failed) return { status: null, contentType: null, error: 'network-failure' };
    if (observed.missing) return { status: null, contentType: null, error: 'auth-response-missing' };
    const response = observed.response;
    let bodyTimer;
    const body = await Promise.race([
      response.text().catch(() => null),
      new Promise((resolve) => { bodyTimer = setTimeout(() => resolve(null), 3000); }),
    ]).finally(() => clearTimeout(bodyTimer));
    return classifyAuthResponse({ status: response.status(), contentType: response.headers()['content-type'], body });
  } finally {
    removeListeners();
  }
}

export function loginBrowserOptions({ manual = false, headless = false, platform = process.platform,
  display = process.env.DISPLAY, waylandDisplay = process.env.WAYLAND_DISPLAY } = {}) {
  if (manual && headless) throw new Error('login --manual needs a visible browser; remove --headless');
  if (manual && platform === 'linux' && !display && !waylandDisplay) {
    throw new Error('login --manual needs a graphical session (DISPLAY or WAYLAND_DISPLAY); run it on your computer');
  }
  return { headless: !!headless };
}

// Describe why an account session cannot be trusted for booking, without repeating page text or secrets.
export function authFailure(state) {
  const error = state.auth?.error;
  const status = state.auth?.status ?? 'unknown';
  if (error === 'site-access-blocked') return 'Le Frecce blocked sign-in from this environment (HTTP 403 Access Denied); credentials were not verified';
  if (error === 'credential-rejected') return `Le Frecce authentication API explicitly rejected the credentials (HTTP ${status})`;
  if (error === 'site-challenge') return 'Le Frecce requires an additional sign-in challenge; use login --manual in the plugin browser on your computer';
  if (error === 'network-failure') return 'Le Frecce sign-in request failed before an HTTP response; credentials were not verified';
  if (error === 'auth-response-missing') return 'No Le Frecce authentication response was observed; credentials were not verified';
  if (error === 'auth-http-error') return `Le Frecce sign-in failed (HTTP ${status}); credentials were not verified`;
  if (state.tokenUnexpired && (state.accountMatchesHolder ?? state.accountMatchesTraveller) === false) {
    return 'signed in, but the account name does not match the configured account holder';
  }
  if (state.tokenUnexpired && !state.tripsReadable) {
    return `signed in, but the trip list could not be read (HTTP ${state.tripStatus ?? 'unknown'})`;
  }
  if (state.how === 'no saved credential') return 'no saved credential in this workstation; run login --manual or save one locally';
  if (state.pageMessage) return 'Le Frecce login page showed an error; the authentication API did not verify bad credentials';
  return 'sign-in did not create a verified session; check the local browser window for a challenge or changed login flow';
}
