import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { authFailure, captureAuthResponse, classifyAuthResponse, loginBrowserOptions, waitForManualSignIn } from './auth-diagnostics.mjs';

const loginRequest = { method: () => 'POST', url: () => 'https://www.lefrecce.it/PicoAuth/api/auth/login' };

test('a 403 HTML edge block overrides the misleading login page message without leaking secrets', async () => {
  const page = new EventEmitter();
  const secret = 'synthetic-password-and-token';
  const auth = await captureAuthResponse(page, async () => {
    assert.equal(page.listenerCount('response'), 1, 'listener must be installed before clicking');
    page.emit('response', {
      request: () => loginRequest,
      status: () => 403,
      headers: () => ({ 'content-type': 'text/html; charset=UTF-8' }),
      text: async () => `<html><title>Access Denied</title>errors.edgesuite.net ${secret}</html>`,
    });
  }, 50);
  assert.deepEqual(auth, { status: 403, contentType: 'text/html', error: 'site-access-blocked' });
  assert.equal(authFailure({ auth, pageMessage: 'Incorrect username or password' }),
    'Le Frecce blocked sign-in from this environment (HTTP 403 Access Denied); credentials were not verified');
  assert.doesNotMatch(JSON.stringify(auth), /synthetic-password|token|errors\.edgesuite/);
  assert.equal(page.listenerCount('response'), 0);
});

test('manual browser submission is observed after the login page opens', async () => {
  const page = new EventEmitter();
  const auth = await captureAuthResponse(page, async () => {
    assert.equal(page.listenerCount('response'), 1);
    setTimeout(() => page.emit('response', {
      request: () => loginRequest,
      status: () => 200,
      headers: () => ({ 'content-type': 'application/json' }),
      text: async () => '{"token":"synthetic-token"}',
    }), 5);
  }, 100);
  assert.deepEqual(auth, { status: 200, contentType: 'application/json', error: null });
  assert.doesNotMatch(JSON.stringify(auth), /synthetic-token/);
});

test('manual sign-in verifies the account before continuing', async () => {
  const page = new EventEmitter();
  let checks = 0;
  const state = await waitForManualSignIn(page, async () => {
    setTimeout(() => page.emit('response', {
      request: () => loginRequest, status: () => 200,
      headers: () => ({ 'content-type': 'application/json' }), text: async () => '{}',
    }), 1);
  }, async () => ({ signedIn: ++checks > 1, tripsReadable: checks > 1 }), 100, 1);
  assert.equal(checks, 2);
  assert.equal(state.signedIn, true);
  assert.equal(state.tripsReadable, true);
  assert.equal(state.how, 'manual browser sign-in');
});

test('manual sign-in stops after an HTML edge block', async () => {
  const page = new EventEmitter();
  let checks = 0;
  const state = await waitForManualSignIn(page, async () => {
    page.emit('response', {
      request: () => loginRequest, status: () => 403,
      headers: () => ({ 'content-type': 'text/html' }), text: async () => '<title>Access Denied</title>',
    });
  }, async () => { checks++; return { signedIn: false }; }, 100, 1);
  assert.equal(checks, 1);
  assert.equal(state.auth.error, 'site-access-blocked');
});

test('only an explicit structured credential error is called a credential rejection', () => {
  const auth = classifyAuthResponse({ status: 401, contentType: 'application/json', body: '{"error":"invalid_credentials","token":"synthetic-token"}' });
  assert.deepEqual(auth, { status: 401, contentType: 'application/json', error: 'credential-rejected' });
  assert.match(authFailure({ auth }), /explicitly rejected the credentials/);
  assert.doesNotMatch(JSON.stringify(auth), /synthetic-token/);
  assert.equal(classifyAuthResponse({ status: 403, contentType: 'application/json', body: '{"error":"invalid_credentials"}' }).error,
    'credential-rejected');
  const generic = classifyAuthResponse({ status: 401, contentType: 'text/html', body: 'Incorrect username or password' });
  assert.equal(generic.error, 'auth-http-error');
});

test('a site challenge is separate from a credential rejection', () => {
  const auth = classifyAuthResponse({ status: 403, contentType: 'application/json', body: '{"error":"captcha_required"}' });
  assert.equal(auth.error, 'site-challenge');
  assert.match(authFailure({ auth }), /additional sign-in challenge/);
});

test('a failed login request and a missing response have separate safe diagnoses', async () => {
  const failedPage = new EventEmitter();
  const failed = await captureAuthResponse(failedPage, async () => failedPage.emit('requestfailed', loginRequest), 50);
  assert.deepEqual(failed, { status: null, contentType: null, error: 'network-failure' });
  assert.match(authFailure({ auth: failed }), /before an HTTP response/);
  const missing = await captureAuthResponse(new EventEmitter(), async () => {}, 10);
  assert.deepEqual(missing, { status: null, contentType: null, error: 'auth-response-missing' });
  assert.match(authFailure({ auth: missing }), /No Le Frecce authentication response/);
});

test('login requires a visible graphical browser', () => {
  assert.deepEqual(loginBrowserOptions({ platform: 'linux', display: ':0' }), { headless: false });
  assert.throws(() => loginBrowserOptions({ platform: 'linux', display: '', waylandDisplay: '' }), /DISPLAY/);
  assert.throws(() => loginBrowserOptions({ headless: true, platform: 'linux', display: ':0' }), /remove --headless/);
});

test('a signed-in but different account is not called a bad password', () => {
  assert.match(authFailure({ tokenUnexpired: true, accountMatchesHolder: false }), /account holder/);
});

test('a trip API failure is reported separately from login', () => {
  assert.match(authFailure({ tokenUnexpired: true, accountMatchesTraveller: true, tripsReadable: false, tripStatus: 503 }), /HTTP 503/);
});

test('page text alone does not prove bad credentials or repeat arbitrary page content', () => {
  assert.equal(authFailure({ pageMessage: 'Incorrect username or password. synthetic-password' }),
    'Le Frecce login page showed an error; the authentication API did not verify bad credentials');
});

test('a headless run without a verified session directs the user to visible login', () => {
  assert.match(authFailure({ how: 'manual sign-in required' }), /run login in a visible browser/);
});
