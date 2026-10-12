import test from 'node:test';
import assert from 'node:assert/strict';
import { fillRequiredField } from './booking-fields.mjs';

function fakePage(initial, present = true) {
  const field = {
    count: async () => Number(present),
    inputValue: async () => initial,
    fill: async (value) => { initial = value; },
  };
  return { locator: () => ({ filter: () => ({ first: () => field }) }), value: () => initial };
}

test('a prefilled passenger value from another booking is replaced', async () => {
  const page = fakePage('Previous Traveller');
  await fillRequiredField(page, '#name', 'Configured Traveller', 'traveller first name');
  assert.equal(page.value(), 'Configured Traveller');
});

test('a missing passenger field stops booking', async () => {
  await assert.rejects(fillRequiredField(fakePage('', false), '#card', '123', 'Tutto Treno card number'), /field is missing/);
});

test('a field that rejects the configured value stops booking', async () => {
  const page = { locator: () => ({ filter: () => ({ first: () => ({ count: async () => 1, inputValue: async () => '', fill: async () => {} }) }) }) };
  await assert.rejects(fillRequiredField(page, '#card', '123', 'Tutto Treno card number'), /did not retain/);
});
