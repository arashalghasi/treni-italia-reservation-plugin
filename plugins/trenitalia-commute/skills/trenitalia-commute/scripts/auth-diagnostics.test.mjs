import test from 'node:test';
import assert from 'node:assert/strict';
import { authFailure } from './auth-diagnostics.mjs';

test('a signed-in but different account is not called a bad password', () => {
  assert.match(authFailure({ tokenUnexpired: true, accountMatchesHolder: false }), /account holder/);
});

test('a trip API failure is reported separately from login', () => {
  assert.match(authFailure({ tokenUnexpired: true, accountMatchesTraveller: true, tripsReadable: false, tripStatus: 503 }), /HTTP 503/);
});

test('the site login message is kept without line breaks', () => {
  assert.equal(authFailure({ pageMessage: 'Incorrect username\n or password.' }), 'Le Frecce sign-in page: Incorrect username or password.');
});

test('missing local credential gives a portable manual path', () => {
  assert.match(authFailure({ how: 'no saved credential' }), /login --manual/);
});
