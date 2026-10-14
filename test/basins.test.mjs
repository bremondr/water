import test from 'node:test';
import assert from 'node:assert/strict';
import { povodi } from '../basins.mjs';

test('assigns stations to povodí from the hydrological order number', () => {
  const cases = {
    '1-01-01-0010': 'Povodí Labe',      // upper Elbe
    '1-05-02-0310': 'Povodí Labe',      // Jizera
    '1-14-03-1020': 'Povodí Labe',      // Ploučnice
    '1-14-01-0920': 'Povodí Ohře',      // Bílina
    '1-12-03-0030': 'Povodí Labe',      // Labe at Mělník, below the Vltava confluence
    '1-12-01-0050': 'Povodí Vltavy',    // Vltava in Prague
    '1-08-05-0120': 'Povodí Vltavy',    // Otava
    '1-10-01-0010': 'Povodí Vltavy',    // Berounka basin
    '1-13-02-0100': 'Povodí Ohře',
    '2-03-01-0100': 'Povodí Odry',
    '4-15-01-0010': 'Povodí Moravy',
    '4-02-01-0050': 'Ostatní',          // Řezná: Danube basin outside Povodí Moravy
    '': 'Ostatní',
  };
  for (const [hlgp, expected] of Object.entries(cases)) assert.equal(povodi(hlgp), expected, hlgp);
  assert.equal(povodi(undefined), 'Ostatní');
});
