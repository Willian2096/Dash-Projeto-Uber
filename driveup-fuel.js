/* DriveUp: pure fuel calculations. Sessions NEVER modify the odometer. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DriveUpFuel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const nonnegative = v => Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0;
  const positive = v => Number.isFinite(Number(v)) && Number(v) > 0;
  const hasReading = r => positive(r.odometer);
  const typeOf = r => String(r.fuelType || '').trim().toLowerCase();
  function ordered(state, until = '9999-12-31') {
    return (state.refuels || []).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') && r.date <= until)
      .map((r, i) => ({ r, i })).sort((a, b) => a.r.date.localeCompare(b.r.date) ||
        nonnegative(a.r.odometer) - nonnegative(b.r.odometer) || a.i - b.i).map(x => x.r);
  }
  function measurement(state, until) {
    const refs = ordered(state, until);
    let start = -1, result = null;
    refs.forEach((r, i) => {
      if (!r.fullTank || !hasReading(r)) return;
      if (start >= 0) {
        const cycle = refs.slice(start + 1, i + 1), first = refs[start];
        let previous = nonnegative(first.odometer);
        const valid = cycle.every(x => {
          const ok = hasReading(x) && nonnegative(x.odometer) >= previous && positive(x.liters) && typeOf(x) === typeOf(first);
          previous = nonnegative(x.odometer); return ok;
        });
        const distance = nonnegative(r.odometer) - nonnegative(first.odometer);
        const liters = cycle.reduce((s, x) => s + nonnegative(x.liters), 0);
        if (valid && distance > 0 && liters > 0) result = { value: distance / liters, distance, liters,
          start: first.date, end: r.date, fuelType: typeOf(r), refuelCount: cycle.length };
      }
      start = i;
    });
    if (result && typeOf(refs[refs.length - 1]) !== result.fuelType) return null;
    return result;
  }
  function adopted(state, until) {
    const measured = measurement(state, until);
    return measured ? { value: measured.value, kind: 'measured', measured } :
      { value: nonnegative(state.settings?.confirmedConsumption), kind: 'estimated', measured: null };
  }
  function priceAt(state, date) {
    const refs = ordered(state, date).filter(r => positive(r.price));
    return refs.length ? nonnegative(refs[refs.length - 1].price) : nonnegative(state.settings?.fuelPrice);
  }
  function baseline(state) {
    state.settings = state.settings || {};
    state.settings.preferences = state.settings.preferences || {};
    const p = state.settings.preferences;
    if (!p.fuelLegacyBaseline || p.fuelLegacyBaseline.version !== 1) {
      // Memory only. Persisted only by a later explicit user save, never on login.
      p.fuelLegacyBaseline = { version: 1, price: nonnegative(state.settings.fuelPrice),
        consumption: nonnegative(state.settings.confirmedConsumption) };
    }
    return p.fuelLegacyBaseline;
  }
  function snapshot(state, date, existing = null) {
    if (existing) {
      const b = baseline(state);
      return { fuelPrice: existing.fuelPrice != null ? nonnegative(existing.fuelPrice) : nonnegative(b.price),
        fuelConsumption: existing.fuelConsumption != null ? nonnegative(existing.fuelConsumption) : nonnegative(b.consumption) };
    }
    return { fuelPrice: priceAt(state, date), fuelConsumption: adopted(state, date).value };
  }
  function estimate(state, until) {
    const refs = ordered(state, until), latest = refs[refs.length - 1] || null;
    const consumption = adopted(state, until), c = consumption.value;
    const capacity = nonnegative(state.settings?.tankCapacity), current = nonnegative(state.settings?.currentOdometer);
    const out = { refs, latest, consumption, capacity, current, known: false, liters: null, range: null,
      percent: null, kmSince: null, price: priceAt(state, until), reason: '', warning: '' };
    if (!latest) { out.reason = 'Registre um abastecimento para estimar a autonomia.'; return out; }
    if (!positive(capacity)) { out.reason = 'Informe a capacidade do tanque nas configurações.'; return out; }
    if (!positive(c)) { out.reason = 'Informe o consumo estimado ou complete um ciclo entre tanques cheios.'; return out; }
    let anchor = -1;
    refs.forEach((r, i) => { if (r.fullTank && hasReading(r)) anchor = i; });
    if (anchor < 0) { out.reason = 'Sem referência de tanque cheio: não é possível saber o saldo no tanque.'; return out; }
    let liters = capacity, previous = nonnegative(refs[anchor].odometer);
    for (const r of refs.slice(anchor + 1)) {
      if (!hasReading(r) || nonnegative(r.odometer) < previous || !positive(r.liters)) {
        out.reason = 'Confira litros e leituras manuais dos abastecimentos.'; return out;
      }
      liters -= (nonnegative(r.odometer) - previous) / c;
      if (liters < -0.01) { out.reason = 'O histórico indica combustível insuficiente. Confira consumo e abastecimentos ausentes.'; return out; }
      liters = Math.max(0, liters) + nonnegative(r.liters);
      if (liters > capacity + 0.05) { out.reason = 'O saldo estimado ultrapassou o tanque. Confira consumo, capacidade e registros.'; return out; }
      liters = Math.min(capacity, liters);
      previous = nonnegative(r.odometer);
    }
    if (current < previous) { out.reason = 'Atualize manualmente o hodômetro: ele está abaixo da última leitura de abastecimento.'; return out; }
    const raw = liters - (current - previous) / c;
    if (raw < -0.01) out.warning = 'Autonomia estimada esgotada. Confira a leitura manual e registre o próximo abastecimento.';
    out.liters = Math.max(0, raw); out.range = out.liters * c;
    out.percent = Math.max(0, Math.min(100, out.liters / capacity * 100));
    out.kmSince = current - nonnegative(latest.odometer); out.known = true;
    return out;
  }
  function validateKm(total, trips) {
    if (![total, trips].every(x => Number.isFinite(Number(x)) && Number(x) >= 0)) return 'Informe quilômetros válidos, iguais ou maiores que zero.';
    return Number(trips) > Number(total) ? 'Km em corridas não pode ser maior que o Km total rodado.' : '';
  }
  return { nonnegative, ordered, measurement, adopted, priceAt, baseline, snapshot, estimate, validateKm };
});
