import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./commute.mjs', import.meta.url));
const baseConfig = {
  traveller: { firstName: 'Example', lastName: 'Traveller', tuttoTrenoCardNumber: '123' },
  stations: { home: 'Example Home', work: 'Example Work' },
  legs: [{ id: 'outbound', from: 'home', to: 'work', service: 'IC', departAfter: '07:00', departBefore: '08:00', offerName: 'Free example', offerId: 123 }],
};

function run(command, flags, config = baseConfig) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'commute-validation-'));
  try {
    const configFile = path.join(folder, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify(config));
    const child = spawnSync(process.execPath, [script, command, `--config=${configFile}`, ...flags], { encoding: 'utf8', timeout: 5000 });
    if (child.error) throw child.error;
    return { code: child.status, result: JSON.parse(child.stdout.trim()) };
  } finally {
    if (!folder.startsWith(os.tmpdir() + path.sep)) throw new Error('unsafe temporary test path');
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

test('malformed day counts stop before opening a browser', () => {
  for (const [command, flag] of [['status', '--days=0'], ['status', '--days=Infinity'], ['book', '--count=oops']]) {
    const output = run(command, [flag]);
    assert.equal(output.code, 1);
    assert.equal(output.result.step, 'config');
    assert.match(output.result.error, /integer from 1 to 366/);
  }
});

test('an impossible recurring travel calendar stops instead of looping', () => {
  const extraHolidays = [];
  for (let month = 1; month <= 12; month++) {
    const daysInMonth = new Date(Date.UTC(2024, month, 0)).getUTCDate();
    for (let day = 1; day <= daysInMonth; day++) {
      extraHolidays.push(`${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
  }
  const output = run('status', ['--from=2030-01-01'], { ...baseConfig, window: { weekdays: [1], extraHolidays, workingDays: 1 } });
  assert.equal(output.code, 1);
  assert.match(output.result.error, /not enough eligible travel days/);
});

test('an invalid recurring holiday is rejected before a booking can be planned', () => {
  const output = run('book', ['--count=1'], { ...baseConfig, window: { extraHolidays: ['02-30'] } });
  assert.equal(output.code, 1);
  assert.match(output.result.error, /extraHolidays must contain valid/);
});

test('manual and headless login flags conflict before the browser is opened', () => {
  const output = run('login', ['--manual', '--headless']);
  assert.equal(output.code, 1);
  assert.equal(output.result.step, 'browser');
  assert.match(output.result.error, /remove --headless/);
});
