// ČHMÚ station metadata has no "povodí" field (PROVOZOVATEL is the gauge operator, not the basin), so derive
// the state-enterprise basin from the hydrological order number (HLGP4, e.g. 1-14-03-1020). Approximate.
export function povodi(hlgp) {
  const [a, b, c] = (hlgp || '').split('-');
  const k = `${a}-${b}`;
  if (['1-01', '1-02', '1-03', '1-04', '1-05'].includes(k)) return 'Povodí Labe';
  if (k === '1-14') return c === '01' ? 'Povodí Ohře' : 'Povodí Labe';      // 1-14-01 = Bílina
  if (k === '1-12') return c === '03' ? 'Povodí Labe' : 'Povodí Vltavy';    // 1-12-03 = Labe below Vltava
  if (['1-06', '1-07', '1-08', '1-09', '1-10', '1-11'].includes(k)) return 'Povodí Vltavy';
  if (k === '1-13' || k === '1-15') return 'Povodí Ohře';
  if (a === '2') return 'Povodí Odry';
  if (a === '4' && b !== '02') return 'Povodí Moravy';
  return 'Ostatní';
}
