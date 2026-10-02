/* Phase 1 preview integration. No cloud write occurs during login. */
var phase1LoadedRaw={},phase1Base=new Map(),phase1Raw=new Map(),phase1Goals=new Map(),phase1DirtyGoals=new Set();
var phase1Ready=false,phase1Owner=null,phase1Busy=null,phase1Again=false,phase1Epoch=0,phase1Daily=[],phase1DailyKey='',phase1Status='';
function phase1Rows(){
 const uid=currentUser?.id;if(!uid)return {};
 const settings=cloudSettingsRow(uid);delete settings.goal;delete settings.baseline;delete settings.reference_date;
 settings.preferences=DriveUpPhase1.cleanPreferences(settings.preferences);
 return {user_settings:[settings],profiles:[{id:uid,full_name:state.settings.profileName||null}],
 sessions:cloudSessionRows(uid),refuels:cloudRefuelRows(uid),routines:cloudRoutineRows(uid),strategies:cloudStrategyRows(uid),weekly_checklists:cloudChecklistRows(uid),
 monthly_goals:[...phase1DirtyGoals].map(month=>({user_id:uid,month:month+'-01',goal:+state.settings.preferences.monthlyGoals[month].goal||0,baseline:+state.settings.preferences.monthlyGoals[month].baseline||0}))};
}
function phase1Remember(){
 phase1Base=new Map();phase1Raw=new Map();
 for(const [table,rows] of Object.entries(phase1Rows()))for(const row of rows)phase1Base.set(DriveUpPhase1.id(table,row),DriveUpPhase1.clone(row));
 for(const [table,rows] of Object.entries(phase1LoadedRaw))for(const row of rows||[])phase1Raw.set(DriveUpPhase1.id(table,row),DriveUpPhase1.clone(row));
 for(const row of phase1Goals.values()){const key=DriveUpPhase1.id('monthly_goals',row);phase1Base.set(key,DriveUpPhase1.clone(row));phase1Raw.set(key,DriveUpPhase1.clone(row));}
}
function phase1Signature(){return DriveUpPhase1.stable({sessions:state.sessions,baseline:DriveUpFuel.baseline(state)});}
function phase1Notice(message,error=false){
 phase1Status=message;const box=document.getElementById('phase1Status');if(!box)return;
 box.hidden=!message;box.dataset.error=String(error);box.querySelector('span').textContent=message;
 box.querySelectorAll('button').forEach(b=>{b.hidden=!error;b.style.display=error?'inline-flex':'none';});
}
async function phase1ReadAll(table,uid,order){
 const out=[];for(let start=0;;start+=500){const r=await dbClient.from(table).select('*').eq('user_id',uid).order(order).range(start,start+499);if(r.error)throw r.error;out.push(...r.data);if(r.data.length<500)return out;}
}
async function phase1RefreshDaily(){
 const uid=currentUser?.id,epoch=phase1Epoch;if(!uid)return;
 const signature=phase1Signature(),data=await phase1ReadAll('driveup_daily_totals',uid,'session_date');
 if(uid!==currentUser?.id||epoch!==phase1Epoch)return;
 phase1Daily=data;phase1DailyKey=signature;
}
async function phase1Flush(){
 if(!phase1Ready||!currentUser||currentUser.id!==phase1Owner)throw Error('Aguarde o carregamento da conta.');
 clearTimeout(syncTimer);if(phase1Busy){phase1Again=true;return phase1Busy;}
 const uid=currentUser.id,epoch=phase1Epoch,active=()=>currentUser?.id===uid&&phase1Epoch===epoch&&phase1Ready;
 phase1Busy=(async()=>{
  do{
   phase1Again=false;const current=phase1Rows(),changes=DriveUpPhase1.plan(phase1Base,current);
   // Persist the previously captured legacy fuel reference only on an explicit save.
   const settings=current.user_settings[0],skey=DriveUpPhase1.id('user_settings',settings),stored=phase1Raw.get(skey);
   if(!stored?.preferences?.fuelLegacyBaseline&&changes.length){
    let sc=changes.find(c=>c.key===skey);
    if(!sc){sc={table:'user_settings',key:skey,before:DriveUpPhase1.clone(phase1Base.get(skey)),after:DriveUpPhase1.clone(settings)};changes.unshift(sc);}
    if(sc.before?.preferences)delete sc.before.preferences.fuelLegacyBaseline;
   }
   if(changes.length)phase1Notice('Salvando '+changes.length+' registro(s) alterado(s)…');
   for(const change of changes){
    if(!active())throw Error('A conta mudou durante o salvamento.');
    if(change.table==='user_settings'&&change.before&&phase1Raw.has(change.key))change.before.preferences=DriveUpPhase1.cleanPreferences(phase1Raw.get(change.key).preferences);
    if(change.table==='profiles'&&change.before&&phase1Raw.has(change.key))change.before.full_name=phase1Raw.get(change.key).full_name;
    const saved=await DriveUpPhase1.writeRecord(dbClient,change,{exists:phase1Raw.has(change.key),active});
    if(!active())throw Error('A conta mudou durante o salvamento.');
    phase1Base.set(change.key,DriveUpPhase1.clone(change.after));phase1Raw.set(change.key,saved);
    if(change.table==='monthly_goals'){
     phase1Goals.set(change.after.month,saved);
     const key=change.after.month.slice(0,7),now=state.settings.preferences.monthlyGoals[key];
     if(+now.goal===+change.after.goal&&+now.baseline===+change.after.baseline)phase1DirtyGoals.delete(key);
    }
   }
  }while(phase1Again);
  await phase1RefreshDaily();if(active()){phase1Notice('Sincronizado · totais diários confirmados pelo banco');renderAll();}
 })();
 try{return await phase1Busy;}catch(err){phase1Notice('Não foi possível concluir: '+(err.message||err)+'. Seus dados pendentes continuam neste navegador.',true);throw err;}finally{phase1Busy=null;}
}
async function phase1CheckOverlap(dates,source,exceptId){
 const uid=currentUser?.id;if(!uid)throw Error('Entre na conta antes de salvar.');
 const other=source==='uber_pdf'?'manual':'uber_pdf';
 const r=await dbClient.from('sessions').select('id,session_date,source').eq('user_id',uid).eq('source',other).in('session_date',dates);
 if(r.error)throw r.error;if(uid!==currentUser?.id)throw Error('A conta mudou.');
 const conflicts=DriveUpPhase1.overlap(r.data||[],dates,source,exceptId);
 if(!conflicts.length)return {proceed:true,allow:false};
 const proceed=window.confirm('Possível duplicidade em '+conflicts.map(brDate).join(', ')+'.\n\nJá existem lançamentos '+(other==='manual'?'manuais':'importados de PDF')+' nesse(s) dia(s). Manter os dois pode contar ganhos e quilômetros duas vezes.\n\nOK: manter ambos porque são trabalhos diferentes.\nCancelar: revisar o Histórico. Nada será apagado automaticamente.');
 return {proceed,allow:proceed};
}
async function phase1ImportPdf(){
 if(!pendingPdfImport){setPdfStatus('Selecione um PDF.','error');return;}
 if(!phase1Ready||!currentUser){setPdfStatus('Aguarde o carregamento da conta.','error');return;}
 if(confirmPdfImport.disabled)return;
 confirmPdfImport.disabled=true;
 try{
  const p=pendingPdfImport,uid=currentUser.id;manualFuelValidatePdf(p.days);
  await phase1Flush();
  const overlap=await phase1CheckOverlap(p.days.map(d=>d.date),'uber_pdf');if(!overlap.proceed){setPdfStatus('Importação cancelada para revisão. Nenhum registro foi excluído.','info');return;}
  const days=p.days.map(d=>{
   const card=pdfDailyComplements.querySelector('[data-pdf-day="'+d.date+'"]');if(!card)throw Error('Falta o complemento de '+brDate(d.date));
   const val=k=>card.querySelector('[data-pdf-field="'+k+'"]')?.value||'';
   const existing=state.sessions.find(s=>s.source==='uber_pdf'&&s.sourceKey==='uber:'+d.date),snap=DriveUpFuel.snapshot(state,d.date,existing);
   const raw=existing?phase1Raw.get(DriveUpPhase1.id('sessions',{user_id:uid,id:existing.id})):null;
   return {date:d.date,tip:Number(val('tip'))||0,minutes:parseDurationText(val('duration'))||0,km:Number(val('totalKm'))||0,trip_km:Number(val('tripKm'))||0,strategy_key:existing?.strategy||state.settings.defaultStrategy||'seletiva',fuel_price:snap.fuelPrice,fuel_consumption:snap.fuelConsumption,expected_updated_at:raw?.updated_at||null};
  });
  const transactions=p.transactions.map(t=>({fingerprint:t.fingerprint,processed_at:t.processedAt,event_at:t.eventAt,event_label:t.label,event_kind:t.kind,service_type:t.serviceType,earnings:t.earnings,expense:t.expense,transfer:t.transfer,balance:t.balance}));
  setPdfStatus('Salvando importação e recalculando os dias no banco…','info');
  const r=await dbClient.rpc('driveup_import_pdf_v1',{p_transactions:transactions,p_days:days,p_file_name:p.fileName,p_report_start:p.period.start,p_report_end:p.period.end,p_allow_overlap:overlap.allow});
  if(r.error)throw r.error;
  // The RPC commits transactions, daily sessions and the log together or rolls back all.
  if(uid!==currentUser?.id)throw Error('A importação foi salva na conta anterior. Entre novamente para consultar.');
  pendingPdfImport=null;
  try{await loadCloudState(currentUser);}catch(err){throw Error('A importação foi salva, mas o painel não foi recarregado. Atualize a página para consultar: '+err.message);}
  setPdfStatus('Importação salva: '+r.data.new_transactions+' transação(ões) nova(s). Totais recalculados no banco; hodômetro mantido.','ok');
  sessionModal.close();
 }catch(err){setPdfStatus(err.message||'Não foi possível importar. Nenhuma confirmação de sucesso foi emitida.','error');}
 finally{confirmPdfImport.disabled=false;}
}
function phase1Install(){
 const oldLoad=loadCloudState,oldSetGoal=setMonthlyGoal,oldDayRows=dayRows,oldManual=sessionForm.onsubmit,oldDelete=deleteSessionConfirmed,oldClear=clearCloudData;
 loadCloudState=async function(user){
  phase1Ready=false;phase1Epoch++;phase1Owner=user.id;phase1Daily=[];phase1DailyKey='';phase1DirtyGoals.clear();
  await oldLoad(user);
  const [goals,profile]=await Promise.all([phase1ReadAll('monthly_goals',user.id,'month'),dbClient.from('profiles').select('id,full_name').eq('id',user.id).maybeSingle()]);
  if(profile.error)throw profile.error;if(currentUser?.id!==user.id)throw Error('A conta mudou durante o carregamento.');
  phase1Goals=new Map(goals.map(g=>[g.month,g]));
  phase1LoadedRaw.profiles=profile.data?[profile.data]:[];
  const store=ensureMonthlyGoals();goals.forEach(g=>store[g.month.slice(0,7)]={goal:+g.goal||0,baseline:+g.baseline||0});
  DriveUpFuel.baseline(state);phase1Remember();
  localStorage.setItem(KEY,JSON.stringify(state));
  await phase1RefreshDaily();phase1Ready=true;renderAll();phase1Notice('Fase 1 · sincronizado · hodômetro manual');
 };
 setMonthlyGoal=function(month,goal,baseline){if(!DriveUpPhase1.validGoal(month,goal,baseline||0))throw Error('Informe um mês válido, meta e acumulado-base não negativos.');oldSetGoal(month,goal,baseline);phase1DirtyGoals.add(month);};
 scheduleCloudSync=function(){if(!phase1Ready||!currentUser||!cloudReady)return;clearTimeout(syncTimer);phase1Notice('Alterações pendentes de sincronização…');syncTimer=setTimeout(()=>phase1Flush().catch(()=>{}),350);};
 syncStateToCloud=phase1Flush;
 dayRows=function(){
  if(!phase1Ready||phase1DailyKey!==phase1Signature())return oldDayRows();
  return phase1Daily.filter(d=>d.session_date.slice(0,7)===selectedMonthKey()).map(d=>({date:d.session_date,gross:+d.gross,net:+d.net,mins:+d.minutes,km:+d.km,tripKm:+d.trip_km,rides:+d.rides,sessions:+d.sessions}));
 };
 let manualBusy=false;
 sessionForm.onsubmit=async function(event){
  event.preventDefault();if(manualBusy)return;manualBusy=true;
  try{
   if(!phase1Ready)throw Error('Aguarde o carregamento da conta.');
   const error=DriveUpFuel.validateKm(sessionForm.km.value||0,sessionForm.tripKm.value||0);if(error)throw Error(error);
   if(parseDurationText(sessionForm.duration.value)===null)throw Error('Use h:mm para o tempo.');
   const existing=editingSessionId===null?null:state.sessions.find(s=>String(s.id)===String(editingSessionId));
   if(existing?.source==='uber_pdf'){sessionForm.date.value=existing.date;sessionForm.gross.value=existing.gross;sessionForm.rides.value=existing.rides;sessionForm.period.value=existing.period;}
   const check=await phase1CheckOverlap([sessionForm.date.value],existing?.source||'manual',existing?.id);if(!check.proceed)return;
   oldManual.call(this,event);
  }catch(err){window.alert(err.message||String(err));}finally{manualBusy=false;}
 };
 const oldOpenEdit=openEditSession,oldOpenNew=openSession;
 function pdfFields(readonly){['date','gross','rides'].forEach(k=>sessionForm[k].readOnly=readonly);sessionForm.period.style.pointerEvents=readonly?'none':'';sessionForm.period.setAttribute('aria-disabled',String(readonly));}
 openEditSession=function(id){oldOpenEdit(id);pdfFields(state.sessions.find(s=>String(s.id)===String(id))?.source==='uber_pdf');};
 openSession=function(){oldOpenNew();pdfFields(false);};
 confirmPdfImport.onclick=phase1ImportPdf;
 deleteSessionConfirmed=async function(){
  try{await phase1Flush();await oldDelete();await phase1RefreshDaily();renderAll();}catch(err){phase1Notice(err.message||String(err),true);}
 };
 document.getElementById('confirmDeleteSession').onclick=deleteSessionConfirmed;
 clearCloudData=async function(){
  await oldClear();const uid=currentUser?.id;if(uid){const r=await dbClient.from('monthly_goals').delete().eq('user_id',uid);if(r.error)throw r.error;}
  phase1Goals.clear();phase1DirtyGoals.clear();phase1Daily=[];phase1DailyKey='';if(currentUser)await loadCloudState(currentUser);
 };
 const box=document.createElement('div');box.id='phase1Status';box.className='note';box.style.marginBottom='12px';box.setAttribute('role','status');box.setAttribute('aria-live','polite');box.hidden=true;
 box.innerHTML='<span></span> <button type="button" class="btn ghost" hidden>Tentar novamente</button> <button type="button" class="btn ghost" hidden>Baixar backup</button>';
 document.querySelector('main.content').prepend(box);
 box.querySelectorAll('button')[0].onclick=()=>phase1Flush().catch(()=>{});box.querySelectorAll('button')[1].onclick=exportJson;
 const oldRenderPdf=renderPdfDailyCards;renderPdfDailyCards=function(...args){oldRenderPdf(...args);document.querySelectorAll('.pdf-odo-hint').forEach(el=>el.textContent='Os quilômetros ficam no histórico. O hodômetro é sempre manual. O total do dia é recalculado pelo banco.');};
 const oldHistory=renderHistory;renderHistory=function(){oldHistory();let note=document.getElementById('phase1Overlap');if(!note){note=document.createElement('div');note.id='phase1Overlap';note.className='note';document.getElementById('page-historico').prepend(note);}const dates=DriveUpPhase1.overlap(state.sessions,state.sessions.map(s=>s.date),'uber_pdf').filter(date=>state.sessions.some(s=>s.date===date&&s.source==='uber_pdf'));note.hidden=!dates.length;note.textContent=dates.length?'Atenção: há registros manuais e PDF em '+dates.map(brDate).join(', ')+'. Confira se representam trabalhos diferentes; ambos entram nos totais.':'';};
 const saveSettingsButton=document.getElementById('saveSettingsTop'),oldSave=saveSettingsButton.onclick;
 saveSettingsButton.onclick=function(){try{if(!phase1Ready)throw Error('Aguarde o carregamento.');if(!DriveUpPhase1.validGoal(configGoalMonth.value,configGoal.value,configBaseline.value))throw Error('Confira o mês, a meta e o acumulado-base.');oldSave();}catch(err){window.alert(err.message);}};
 const logout=document.getElementById('testLogout');logout?.addEventListener('click',event=>{if(phase1Busy||DriveUpPhase1.plan(phase1Base,phase1Rows()).length){event.preventDefault();event.stopImmediatePropagation();phase1Notice('Salve as alterações pendentes ou baixe seu backup antes de sair.',true);}},true);
 window.addEventListener('beforeunload',event=>{if(phase1Ready&&(phase1Busy||DriveUpPhase1.plan(phase1Base,phase1Rows()).length)){event.preventDefault();event.returnValue='';}});
}
