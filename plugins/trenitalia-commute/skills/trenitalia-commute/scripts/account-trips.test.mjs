import test from 'node:test';
import assert from 'node:assert/strict';
import { accountTrips, tripLegs, tripMatchesLeg } from './account-trips.mjs';

test('a complete empty trip list can prove there are no existing bookings', async () => {
  const calls = [];
  const trips = await accountTrips(async (_method, _path, body) => {
    calls.push(body.travelGroup);
    return { status: 200, json: { solutions: [] } };
  }, '2030-06-01', '2030-06-10');
  assert.deepEqual(calls, ['TICKET', 'SUBSCRIPTION']);
  assert.deepEqual(trips.items, []);
});

test('a later failed page stops booking even after earlier trips were found', async () => {
  const api = async (_method, _path, body) => body.offset === 0
    ? { status: 200, json: { solutions: Array.from({ length: 10 }, () => ({})) } }
    : { status: 503, json: null };
  await assert.rejects(accountTrips(api, '2030-06-01', '2030-06-10'), /TICKET page 10 failed \(HTTP 503\)/);
});

test('an unreadable subscription page stops booking after a valid ticket page', async () => {
  const api = async (_method, _path, body) => body.travelGroup === 'TICKET'
    ? { status: 200, json: { solutions: [] } }
    : { status: 200, json: { unexpected: [] } };
  await assert.rejects(accountTrips(api, '2030-06-01', '2030-06-10'), /SUBSCRIPTION page 0 failed/);
});

test('an unparsed active trip cannot be mistaken for no existing booking', () => {
  const parsed = tripLegs([{ description: 'Changed site format', departureDate: '2030-06-03T07:30:00', pnr: 'EXAMPLE' }]);
  assert.equal(parsed.unparsed, 1);
  assert.deepEqual(parsed.legs, []);
});

test('verification distinguishes two reservations on the same train', () => {
  const item = { description: 'Example Home (07:30) - Example Work (08:30)', departureDate: '2030-06-03T07:30:00' };
  const parsed = tripLegs([{ ...item, pnr: 'FIRST' }, { ...item, pnr: 'SECOND' }]);
  const config = { stations: { home: 'Example Home', work: 'Example Work' } };
  const leg = { from: 'home', to: 'work' };
  assert.equal(parsed.unparsed, 0);
  assert.equal(parsed.legs.filter((trip) => tripMatchesLeg(trip, leg, '2030-06-03', config)).length, 2);
});
