const italianDay = (day) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

// An incomplete trip list cannot prove that a leg is still unbooked.
export async function accountTrips(api, fromDay, toDay) {
  const items = [];
  const answers = [];
  for (const travelGroup of ['TICKET', 'SUBSCRIPTION']) {
    for (let offset = 0; offset < 500; offset += 10) {
      const response = await api('POST', '/travel/solutions', {
        travelGroup, searchType: 'DEPARTURE_DATE', fromDate: italianDay(fromDay), toDate: italianDay(toDay), code: null, limit: 10, offset,
      });
      answers.push(`${travelGroup}@${offset}:${response.status}`);
      const page = response.json?.solutions;
      if (response.status !== 200 || !Array.isArray(page)) {
        const error = new Error(`trip list ${travelGroup} page ${offset} failed (HTTP ${response.status}); booking stopped because existing reservations cannot be verified`);
        error.step = 'trips';
        throw error;
      }
      items.push(...page);
      if (page.length < 10) break;
      if (offset === 490) {
        const error = new Error(`trip list ${travelGroup} exceeded 500 records; narrow the date range before booking`);
        error.step = 'trips';
        throw error;
      }
    }
  }
  return { items, answers };
}

function toIsoDateTime(value) {
  if (/^\d{4}-\d\d-\d\d/.test(value)) return value.slice(0, 16).replace(' ', 'T');
  const italian = value.match(/^(\d\d)\/(\d\d)\/(\d{4})\D*(\d\d:\d\d)?/);
  return italian ? `${italian[3]}-${italian[2]}-${italian[1]}T${italian[4] || '00:00'}` : null;
}

export function tripLegs(items) {
  const legs = new Map();
  const unparsedItems = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') { unparsedItems.push(item); continue; }
    if (/CANCEL|REFUND|ANNULL|RIMBORS/i.test(item.statusDescription || '')) continue;
    const route = String(item.description || '').match(/^(.+?)\s*\((\d\d:\d\d)\)\s*-\s*(.+?)\s*\((\d\d:\d\d)\)/);
    const departure = toIsoDateTime(String(item.departureDate || ''));
    if (!route || !departure) { unparsedItems.push(item); continue; }
    const key = `${route[1]}|${route[3]}|${departure}|${item.pnr || ''}`;
    if (!legs.has(key)) legs.set(key, { origin: route[1], destination: route[3], departure, pnr: item.pnr || null, type: item.typeDescription || null });
  }
  return { legs: [...legs.values()], unparsed: unparsedItems.length, unparsedItems };
}

export function tripMatchesLeg(trip, leg, day, config) {
  return trip.departure.slice(0, 10) === day
    && trip.origin.toLowerCase().startsWith(config.stations[leg.from].toLowerCase())
    && trip.destination.toLowerCase().startsWith(config.stations[leg.to].toLowerCase());
}
