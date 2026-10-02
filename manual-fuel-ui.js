/* Installed by scripts/build-preview.cjs before the original app starts. */
function manualFuelEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function manualFuelRender() {
  DriveUpFuel.baseline(state);
  const m = DriveUpFuel.estimate(state, localToday()), c = m.consumption.value, latest = m.latest;
  const text = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  const mode = m.consumption.kind === 'measured' ? 'Medido entre tanques cheios' : 'Estimado nas configurações';
  const known = m.known, liters = known ? `${num(m.liters,1)} L` : '—';
  const range = known ? `${num(m.range,0)} km` : '—';
  const detail = (name, value) => `<div class="detail-row"><span>${manualFuelEsc(name)}</span><strong>${manualFuelEsc(value)}</strong></div>`;
  text('fuelAvg', c > 0 ? `${num(c,1)} km/L` : '—');
  const avgSub = document.getElementById('fuelAvg')?.closest('.card')?.querySelector('.sub');
  if (avgSub) avgSub.textContent = mode;
  text('fuelCostKmTop', c > 0 && m.price > 0 ? money(m.price/c) : '—');
  text('fuelLastSpend', latest ? money(+latest.total||0) : '—');
  text('fuelCurrentOdometer', `${num(m.current,1)} km`);
  text('fuelRangeTop', range); text('fuelRangeNow', range);
  text('fuelTankPct', known ? `${num(m.percent,0)}%` : '—');
  document.getElementById('fuelRing')?.style.setProperty('--pct', `${known ? m.percent*3.6 : 0}deg`);
  text('fuelLitersNow', liters);
  text('fuelLitersPct', known ? `de ${num(m.capacity,1)} L (${num(m.percent,0)}%)` : 'Saldo ainda não determinado');
  text('fuelRangeLiters', known ? `com ${liters} estimados no tanque` : m.reason);
  text('fuelFullRange', c > 0 && m.capacity > 0 ? `${num(c*m.capacity,0)} km` : '—');
  text('fuelFullRangeSub', `Capacidade ${num(m.capacity,1)} L · consumo ${num(c,1)} km/L`);
  text('fuelTankCapacity', m.capacity > 0 ? `${num(m.capacity,1)} L` : 'Não informada');
  text('fuelAutonomySubtitle', `${mode}. O hodômetro é atualizado somente por uma leitura digitada por você.`);
  text('fuelEstimateNote', m.reason || m.warning || 'Autonomia estimada na última leitura manual. As sessões não alteram o hodômetro nem o saldo do tanque. Registre todos os abastecimentos.');
  const summary = document.getElementById('fuelCurrentSummary');
  if (summary) summary.innerHTML = latest ? `<div class="detail-list">${
    detail('Data do abastecimento', brDate(latest.date)) +
    detail('Hodômetro no abastecimento', `${num(+latest.odometer||0,1)} km`) +
    detail('Hodômetro atual (manual)', `${num(m.current,1)} km`) +
    detail('Km desde o abastecimento', m.kmSince != null ? `${num(m.kmSince,1)} km` : 'Confira a leitura manual') +
    detail('Litros adicionados', `${num(+latest.liters||0,3)} L`) +
    detail('Valor pago', money(+latest.total||0)) +
    detail('Abastecimento', latest.fullTank ? 'Tanque cheio confirmado' : 'Parcial') +
    detail('Saldo estimado no tanque', liters)
  }</div><div class="fuel-current-highlight"><div><b>Autonomia estimada</b><div class="sub">${manualFuelEsc(mode)}</div></div><b>${range}</b></div>` : '<div class="note">Nenhum abastecimento registrado.</div>';
  const history = document.getElementById('refuelHistory');
  if (history) {
    history.innerHTML = m.refs.length ? `<div style="overflow:auto"><table class="fuel-history-table"><thead><tr><th>Data</th><th>Posto</th><th>Litros</th><th>Preço/L</th><th>Total</th><th>Hodômetro</th><th>Tanque</th><th></th></tr></thead><tbody>${[...m.refs].reverse().map(r => `<tr><td>${brDate(r.date)}</td><td>${manualFuelEsc(r.station||'—')}</td><td>${num(+r.liters||0,3)} L</td><td>${money(+r.price||0)}</td><td>${money(+r.total||0)}</td><td>${num(+r.odometer||0,1)} km</td><td>${r.fullTank?'Cheio':'Parcial'}</td><td><button type="button" class="icon-btn" data-edit-refuel="${manualFuelEsc(r.id)}" title="Editar abastecimento"><i data-lucide="pencil"></i></button></td></tr>`).join('')}</tbody></table></div>` : '<div class="note">Nenhum abastecimento registrado.</div>';
    history.querySelectorAll('[data-edit-refuel]').forEach(b => b.onclick = () => openEditRefuel(b.dataset.editRefuel));
  }
  const efficiency = document.getElementById('fuelEfficiency'), cycle = m.consumption.measured;
  if (efficiency) efficiency.innerHTML = `<div class="fuel-efficiency-big">${c>0 ? num(c,1)+' km/L':'—'}</div><div class="sub">${mode}</div><div class="note fuel-efficiency-info"><i data-lucide="info"></i><span>${cycle ? `${brDate(cycle.start)} a ${brDate(cycle.end)}: ${num(cycle.distance,1)} km ÷ ${num(cycle.liters,3)} L repostos. Inclui os abastecimentos parciais do intervalo; não inclui os litros do primeiro tanque cheio. A medição pressupõe o registro de todos os abastecimentos.` : 'Para medir o consumo, registre duas leituras de tanque cheio e todos os abastecimentos entre elas. Até lá, informe um consumo estimado nas configurações.'}</span></div>`;
  if (window.lucide) lucide.createIcons();
}
function manualFuelSaveRefuel(event) {
  event.preventDefault();
  const f = refuelForm, o = Object.fromEntries(new FormData(f));
  let liters = Number(o.liters), price = Number(o.price), totalValue = Number(o.total);
  const fail = (name, message) => { f.elements[name].setCustomValidity(message); f.elements[name].reportValidity(); };
  ['date','liters','price','total','odometer'].forEach(n => f.elements[n].setCustomValidity(''));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date||'') || o.date > localToday()) return fail('date','Informe a data real do abastecimento, até hoje.');
  if (!(liters>0) && totalValue>0 && price>0) liters = totalValue/price;
  if (!(price>0) && totalValue>0 && liters>0) price = totalValue/liters;
  if (!(totalValue>0) && liters>0 && price>0) totalValue = liters*price;
  if (!(Number.isFinite(liters) && liters>0)) return fail('liters','Informe os litros abastecidos.');
  if (!(Number.isFinite(price) && price>0)) return fail('price','Informe o preço por litro.');
  if (!(Number.isFinite(totalValue) && totalValue>0)) return fail('total','Informe o total pago.');
  if (Math.abs(liters*price-totalValue)>Math.max(0.06,liters*0.006)) return fail('total','Litros × preço não corresponde ao total. Confira os dados da bomba.');
  const odo = Number(o.odometer);
  if (!String(o.odometer||'').trim() || !Number.isFinite(odo) || odo<=0) return fail('odometer','Informe a leitura real do hodômetro neste abastecimento.');
  const capacity = Number(state.settings.tankCapacity)||0;
  if (capacity>0 && liters>capacity+0.05) return fail('liters','Os litros ultrapassam a capacidade do tanque. Confira os dados e a capacidade configurada.');
  DriveUpFuel.baseline(state);
  const payload = {date:o.date,station:String(o.station||'').trim(),liters,price,total:totalValue,odometer:odo,
    fuelType:o.fuelType||'Gasolina',fullTank:!!f.fullTank.checked,note:String(o.note||'').trim()};
  if (editingRefuelId!==null) {
    const index=state.refuels.findIndex(r=>String(r.id)===String(editingRefuelId));
    if (index<0) return fail('date','Registro não encontrado. Feche e tente novamente.');
    state.refuels[index]={...state.refuels[index],...payload};
  } else state.refuels.push({id:crypto.randomUUID(),...payload});
  const latest=DriveUpFuel.ordered(state,localToday()).at(-1);
  if (latest?.price>0) state.settings.fuelPrice=+latest.price;
  // Explicit consent to use this TYPED reading, never a session-derived sum.
  if (f.elements.updateCurrentOdometer.checked) state.settings.currentOdometer=odo;
  editingRefuelId=null; refuelModal.close(); save();
}
function manualFuelSaveOdometer(event) {
  event.preventDefault();
  const input=odometerForm.odometer, value=Number(input.value);
  input.setCustomValidity('');
  if (input.value==='' || !Number.isFinite(value) || value<0) {
    input.setCustomValidity('Informe uma leitura válida, igual ou maior que zero.'); input.reportValidity(); return;
  }
  state.settings.currentOdometer=value; odometerModal.close(); save();
}
function manualFuelValidatePdf(days) {
  for (const d of days) {
    const card=pdfDailyComplements.querySelector(`[data-pdf-day="${d.date}"]`); if(!card)continue;
    const input=k=>card.querySelector(`[data-pdf-field="${k}"]`);
    const total=input('totalKm'),trip=input('tripKm');
    trip?.setCustomValidity('');
    const message=DriveUpFuel.validateKm(total?.value||0,trip?.value||0);
    if(message){trip?.setCustomValidity(message);trip?.reportValidity();throw new Error(`${brDate(d.date)}: ${message}`);}
    if(parseDurationText(input('duration')?.value||'')===null)throw new Error(`${brDate(d.date)}: informe o tempo no formato h:mm.`);
  }
}
function manualFuelInstall() {
  const manual=document.getElementById('manualSessionPanel');
  if(manual)manual.insertAdjacentHTML('afterbegin','<div class="note" style="margin-bottom:12px">Km em corridas e km total ficam no histórico para análise e estimativa de custo. Eles não alteram o hodômetro nem a autonomia do tanque.</div>');
  refuelForm.odometer.closest('label').firstChild.textContent='Hodômetro no abastecimento (manual)';
  refuelForm.odometer.closest('label').insertAdjacentHTML('afterend','<label style="grid-column:1/-1;display:flex;align-items:center;gap:8px"><input name="updateCurrentOdometer" type="checkbox" checked style="width:auto;margin:0">Usar esta leitura digitada como hodômetro atual</label>');
  refuelForm.fullTank.defaultChecked=false;refuelForm.fullTank.checked=false;
  ['date','liters','price','total','odometer'].forEach(n=>refuelForm.elements[n].addEventListener('input',()=>refuelForm.elements[n].setCustomValidity('')));
  odometerForm.odometer.addEventListener('input',()=>odometerForm.odometer.setCustomValidity(''));
  const input=document.getElementById('configConsumption');
  if(input){
    const label=input.previousElementSibling;if(label?.tagName==='LABEL')label.textContent='Consumo estimado (km/L)';
    input.closest('.field').insertAdjacentHTML('afterend','<div class="field"><label for="configTankCapacity">Capacidade do tanque (L)</label><input id="configTankCapacity" type="number" step="0.1" min="0" placeholder="Ex.: 15"></div>');
  }
  const oldRenderSettings=renderSettings;
  renderSettings=function(){oldRenderSettings();const cap=document.getElementById('configTankCapacity');if(cap)cap.value=state.settings.tankCapacity||'';};
  const oldSave=saveSettings;
  document.getElementById('saveSettingsTop').onclick=()=>{
    const cap=document.getElementById('configTankCapacity'),cons=document.getElementById('configConsumption'),p=document.getElementById('configFuelPrice');
    for(const el of [cap,cons,p]){if(el && (!Number.isFinite(Number(el.value))||Number(el.value)<0)){el.setCustomValidity('Informe um valor igual ou maior que zero.');el.reportValidity();return;}el?.setCustomValidity('');}
    DriveUpFuel.baseline(state);state.settings.tankCapacity=Number(cap?.value)||0;oldSave();
  };
}
