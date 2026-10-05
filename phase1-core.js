/* Pure change planning and optimistic, per-record writes. No automatic deletions. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DriveUpPhase1=api;})(globalThis,function(){
'use strict';
const keys={user_settings:['user_id'],profiles:['id'],sessions:['user_id','id'],refuels:['user_id','id'],routines:['user_id','day_of_week'],strategies:['user_id','strategy_key'],weekly_checklists:['user_id','week_start'],monthly_goals:['user_id','month']};
const clone=x=>JSON.parse(JSON.stringify(x));
function stable(x){if(x===undefined)return 'undefined';if(x===null||typeof x!=='object')return JSON.stringify(x);if(Array.isArray(x))return '['+x.map(stable).join(',')+']';return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';}
const equal=(a,b)=>stable(a)===stable(b);
function id(table,row){if(!keys[table])throw Error('Tabela não permitida.');return table+':'+stable(keys[table].map(k=>row[k]));}
function cleanPreferences(p){const out=clone(p||{});delete out.monthlyGoals;return out;}
function patch(before,after,table){const out={};for(const k of Object.keys(after)){if(keys[table].includes(k)||['created_at','updated_at'].includes(k))continue;if(!equal(before?.[k],after[k]))out[k]=clone(after[k]);}return out;}
function plan(before,after){const changes=[];for(const [table,rows] of Object.entries(after)){for(const row of rows){const key=id(table,row),old=before.get(key);if(!old||Object.keys(patch(old,row,table)).length)changes.push({table,key,before:old||null,after:clone(row)});}}return changes;}
function overlap(rows,dates,source,exceptId){const other=source==='uber_pdf'?'manual':'uber_pdf',wanted=new Set(dates);return [...new Set(rows.filter(r=>r.id!==exceptId&&wanted.has(r.date||r.session_date)&&(r.source||'manual')===other).map(r=>r.date||r.session_date))].sort();}
function validGoal(month,goal,baseline){return /^\d{4}-(0[1-9]|1[0-2])$/.test(month)&&[goal,baseline].every(x=>Number.isFinite(Number(x))&&Number(x)>=0);}
function mergeJSON(before,after,remote){
  if(equal(before,after))return clone(remote===undefined?after:remote);
  if(after&&before&&remote&&typeof after==='object'&&typeof before==='object'&&typeof remote==='object'&&!Array.isArray(after)&&!Array.isArray(before)&&!Array.isArray(remote)){
    const out=clone(remote);for(const k of Object.keys(after)){if(['__proto__','constructor','prototype'].includes(k))throw Error('Campo inválido.');if(!equal(before[k],after[k]))out[k]=mergeJSON(before[k],after[k],remote[k]);}return out;
  }
  if(!equal(remote,before)&&!equal(remote,after))throw Error('Conflito: este campo mudou em outro acesso. Baixe o backup antes de recarregar.');
  return clone(after);
}
function result(r){if(r.error)throw Error(r.error.message||String(r.error));return r.data;}
function scope(q,table,row){for(const k of keys[table])q=q.eq(k,row[k]);return q;}
async function writeRecord(client,change,{exists=true,active=()=>true}={}){
  const {table,before,after}=change;if(!keys[table])throw Error('Tabela não permitida.');
  if(!active())throw Error('A conta mudou. Entre novamente.');
  const remote=result(await scope(client.from(table).select('*'),table,after).maybeSingle());
  if(!active())throw Error('A conta mudou. Entre novamente.');
  const delta=patch(before,after,table);
  if(!remote){
    if(before&&exists)throw Error('Conflito: o registro foi removido em outro acesso. Nada foi recriado.');
    const saved=result(await client.from(table).insert(after).select('*').single());return saved;
  }
  if(!before || !exists){
    if(Object.keys(delta).every(k=>equal(remote[k],after[k])))return remote;
    throw Error('Conflito: já existe um registro com esta identificação. Recarregue após salvar seu backup.');
  }
  const updates={};
  for(const [k,value] of Object.entries(delta)){
    if(k==='preferences')updates[k]=mergeJSON(before[k]||{},value,remote[k]||{});
    else{if(!equal(remote[k],before[k])&&!equal(remote[k],value)&&!((remote[k]==null||remote[k]==='')&&(before[k]==null||before[k]==='')))throw Error('Conflito em '+table+'.'+k+'. O registro mudou em outro acesso. Baixe o backup antes de recarregar.');updates[k]=value;}
  }
  if(!Object.keys(updates).length)return remote;
  let q=scope(client.from(table).update(updates),table,after);
  // Legacy tables have server-maintained updated_at triggers. Compare the exact
  // timestamp (including microseconds); preferences belong in the body, not the URL.
  if(typeof remote.updated_at==='string'&&remote.updated_at.length>0){
    q=q.eq('updated_at',remote.updated_at);
  }else{
    // monthly_goals has no updated_at: retain compare-and-set on its small values.
    // If an unversioned value is large, fail closed instead of issuing a huge URL.
    for(const k of Object.keys(updates)){
      const old=remote[k],value=typeof old==='object'&&old!==null?JSON.stringify(old):old;
      if(value!=null&&encodeURIComponent(String(value)).length>512)throw Error('Não foi possível verificar a versão deste registro. Baixe o backup antes de recarregar.');
      q=old==null?q.is(k,null):q.eq(k,value);
    }
  }
  const saved=result(await q.select('*').maybeSingle());
  if(!saved)throw Error('Conflito durante o salvamento. Nenhum valor concorrente foi substituído.');
  return saved;
}
return {keys,clone,stable,equal,id,cleanPreferences,patch,plan,overlap,validGoal,mergeJSON,result,scope,writeRecord};
});
