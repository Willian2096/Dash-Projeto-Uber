'use strict';
const assert=require('node:assert/strict');
const P=require('../phase1-core.js');
const OLD='2026-10-05T18:30:00.123456+00:00';
const NEW='2026-10-05T18:30:00.123457+00:00';
const uid='11111111-1111-4111-8111-111111111111';
// PostgREST-shaped, in-memory test double: no network or real user records.
function mock(seed){
 const rows=P.clone(seed),requests=[];let beforeWrite=null,afterRead=null,writeError=null;
 const client={from(table){
  let method='GET',body=null;const filters=[],url=new URL('https://test.invalid/rest/v1/'+table);
  const q={select(value){url.searchParams.set('select',value);return q;},eq(k,v){filters.push([k,v]);url.searchParams.append(k,'eq.'+v);return q;},is(k,v){filters.push([k,v]);url.searchParams.append(k,'is.'+v);return q;},
   update(value){method='PATCH';body=P.clone(value);return q;},insert(value){method='POST';body=P.clone(value);return q;},maybeSingle:execute,single:execute};
  async function execute(){
   requests.push({method,table,url:url.href,filters:P.clone(filters),body:P.clone(body)});
   if(method!=='GET'&&writeError)return {data:null,error:{message:writeError}};
   if(method!=='GET'&&beforeWrite){const f=beforeWrite;beforeWrite=null;f(rows);}
   const matches=(rows[table]||[]).filter(row=>filters.every(([k,v])=>P.equal(row[k],typeof row[k]==='object'&&row[k]!==null&&typeof v==='string'?JSON.parse(v):v)));
   let row=matches[0]||null;
   if(method==='POST'){row=P.clone(body);(rows[table]??=[]).push(row);}
   if(method==='PATCH'&&row){Object.assign(row,body);if(row.updated_at)row.updated_at=NEW;}
   const data=P.clone(row);
   if(method==='GET'&&afterRead){const f=afterRead;afterRead=null;f(rows);}
   return {data,error:null};
  }
  return q;
 }};
 return {client,rows,requests,race(fn){beforeWrite=fn;},onRead(fn){afterRead=fn;},fail(message){writeError=message;}};
}
const settings=preferences=>({user_id:uid,preferences,updated_at:OLD});
const change=(table,before,after)=>({table,before,after});
const writes=db=>db.requests.filter(r=>r.method!=='GET');
const bigPreferences=()=>({darkTheme:true,weeklyRoutines:Object.fromEntries(Array.from({length:1500},(_,i)=>['week-'+i,{morning:'active',start:'06:00',end:'08:00',note:'Ação planejada '+('x'.repeat(640))}]))});
async function run(){let count=0;const test=async(name,fn)=>{await fn();count++;console.log('PASS version guard:',name);};
 await test('large preferences are in the body, never in filters',async()=>{
  const before=settings(bigPreferences()),after=P.clone(before);after.preferences.darkTheme=false;
  const db=mock({user_settings:[before]});await P.writeRecord(db.client,change('user_settings',before,after));
  const req=writes(db)[0];assert.ok(JSON.stringify(req.body).length>1000000);assert.ok(req.url.length<400);assert.ok(!req.url.includes('preferences='));assert.deepEqual(req.filters,[['user_id',uid],['updated_at',OLD]]);assert.equal(db.rows.user_settings[0].preferences.darkTheme,false);
 });
 await test('URL size is independent of preferences size',async()=>{
  const lengths=[];for(const prefs of [{darkTheme:true},bigPreferences()]){const before=settings(prefs),after=P.clone(before);after.preferences.darkTheme=false;const db=mock({user_settings:[before]});await P.writeRecord(db.client,change('user_settings',before,after));lengths.push(writes(db)[0].url.length);}assert.equal(lengths[0],lengths[1]);
 });
 await test('timestamp microseconds and offset are preserved exactly',async()=>{
  const before=settings({darkTheme:true}),db=mock({user_settings:[before]});await P.writeRecord(db.client,change('user_settings',before,settings({darkTheme:false})));assert.equal(new URL(writes(db)[0].url).searchParams.get('updated_at'),'eq.'+OLD);
 });
 await test('same preference changed before reading raises conflict',async()=>{
  const before=settings({count:1}),db=mock({user_settings:[{...before,preferences:{count:3},updated_at:NEW}]});await assert.rejects(()=>P.writeRecord(db.client,change('user_settings',before,{...before,preferences:{count:2}})),/Conflito/);assert.equal(writes(db).length,0);
 });
 await test('unrelated remote preferences merge without overwriting them',async()=>{
  const before=settings({a:1,b:1}),db=mock({user_settings:[{...before,preferences:{a:1,b:9},updated_at:NEW}]});await P.writeRecord(db.client,change('user_settings',before,{...before,preferences:{a:2,b:1}}));assert.deepEqual(db.rows.user_settings[0].preferences,{a:2,b:9});assert.equal(writes(db)[0].filters.at(-1)[1],NEW);
 });
 await test('change between read and write is rejected atomically',async()=>{
  const before=settings({a:1}),db=mock({user_settings:[before]});db.race(rows=>{rows.user_settings[0].preferences.a=9;rows.user_settings[0].updated_at=NEW;});await assert.rejects(()=>P.writeRecord(db.client,change('user_settings',before,{...before,preferences:{a:2}})),/Conflito durante/);assert.equal(db.rows.user_settings[0].preferences.a,9);
 });
 await test('any intervening row revision blocks a stale write',async()=>{
  const before={...settings({a:1}),profile_name:'Original'},db=mock({user_settings:[before]});db.race(rows=>{rows.user_settings[0].profile_name='Outro acesso';rows.user_settings[0].updated_at=NEW;});await assert.rejects(()=>P.writeRecord(db.client,change('user_settings',before,{...before,preferences:{a:2}})),/Conflito durante/);assert.equal(db.rows.user_settings[0].profile_name,'Outro acesso');assert.equal(db.rows.user_settings[0].preferences.a,1);
 });
 await test('unchanged row does not issue an update',async()=>{
  const before=settings({a:1}),db=mock({user_settings:[before]});await P.writeRecord(db.client,change('user_settings',before,P.clone(before)));assert.equal(writes(db).length,0);
 });
 await test('long session note uses short version filter',async()=>{
  const before={user_id:uid,id:'s1',note:'Observação '.repeat(20000),minutes:60,updated_at:OLD},after={...before,note:before.note+' fim'},db=mock({sessions:[before]});await P.writeRecord(db.client,change('sessions',before,after));assert.ok(writes(db)[0].url.length<400);assert.deepEqual(Object.keys(writes(db)[0].body),['note']);
 });
 await test('same session field conflict is still detected',async()=>{
  const before={user_id:uid,id:'s1',note:'Original',updated_at:OLD},db=mock({sessions:[{...before,note:'A',updated_at:NEW}]});await assert.rejects(()=>P.writeRecord(db.client,change('sessions',before,{...before,note:'B'})),/Conflito/);assert.equal(writes(db).length,0);
 });
 await test('monthly goals without timestamps retain field comparison',async()=>{
  const before={user_id:uid,month:'2026-10-01',goal:100,baseline:0},db=mock({monthly_goals:[before]});await P.writeRecord(db.client,change('monthly_goals',before,{...before,goal:200}));assert.deepEqual(writes(db)[0].filters,[['user_id',uid],['month','2026-10-01'],['goal',100]]);assert.equal(db.rows.monthly_goals[0].goal,200);
 });
 await test('monthly goals remain protected during a race',async()=>{
  const before={user_id:uid,month:'2026-10-01',goal:100,baseline:0},db=mock({monthly_goals:[before]});db.race(rows=>rows.monthly_goals[0].goal=300);await assert.rejects(()=>P.writeRecord(db.client,change('monthly_goals',before,{...before,goal:200})),/Conflito durante/);assert.equal(db.rows.monthly_goals[0].goal,300);
 });
 await test('large unversioned value fails safely before sending a request',async()=>{
  const before={user_id:uid,preferences:bigPreferences()},after=P.clone(before);after.preferences.darkTheme=false;const db=mock({user_settings:[before]});await assert.rejects(()=>P.writeRecord(db.client,change('user_settings',before,after)),/versão deste registro/);assert.equal(writes(db).length,0);assert.equal(db.rows.user_settings[0].preferences.darkTheme,true);
 });
 await test('small unversioned preferences remain compatible',async()=>{
  const before={user_id:uid,preferences:{a:1}},db=mock({user_settings:[before]});await P.writeRecord(db.client,change('user_settings',before,{...before,preferences:{a:2}}));assert.equal(db.rows.user_settings[0].preferences.a,2);
 });
 await test('null field still uses is.null without timestamp',async()=>{
  const before={user_id:uid,id:'s1',note:null},db=mock({sessions:[before]});await P.writeRecord(db.client,change('sessions',before,{...before,note:'Salvo'}));assert.equal(new URL(writes(db)[0].url).searchParams.get('note'),'is.null');
 });
 await test('read and write stay scoped to the same user',async()=>{
  const before=settings({a:1}),other={...before,user_id:'other'},db=mock({user_settings:[before,other]});await P.writeRecord(db.client,change('user_settings',before,{...before,preferences:{a:2}}));assert.equal(db.rows.user_settings[1].preferences.a,1);assert.ok(db.requests.every(r=>r.filters.some(([k,v])=>k==='user_id'&&v===uid)));
 });
 await test('remote deletion is never silently recreated',async()=>{
  const before=settings({a:1}),db=mock({user_settings:[]});await assert.rejects(()=>P.writeRecord(db.client,change('user_settings',before,{...before,preferences:{a:2}})),/removido/);assert.equal(writes(db).length,0);
 });
 await test('account change after read cancels update',async()=>{
  const before=settings({a:1}),db=mock({user_settings:[before]});let active=true;db.onRead(()=>active=false);await assert.rejects(()=>P.writeRecord(db.client,change('user_settings',before,{...before,preferences:{a:2}}),{active:()=>active}),/conta mudou/);assert.equal(writes(db).length,0);
 });
 await test('failed update preserves caller state and can be retried',async()=>{
  const before=settings({a:1}),after={...before,preferences:{a:2}},original=P.clone(after),db=mock({user_settings:[before]});db.fail('Rede indisponível');await assert.rejects(()=>P.writeRecord(db.client,change('user_settings',before,after)),/Rede/);assert.deepEqual(after,original);assert.equal(db.rows.user_settings[0].preferences.a,1);db.fail(null);await P.writeRecord(db.client,change('user_settings',before,after));assert.equal(db.rows.user_settings[0].preferences.a,2);
 });
 await test('client timestamp does not enter update payload',async()=>{
  const before=settings({a:1}),db=mock({user_settings:[before]});await P.writeRecord(db.client,change('user_settings',before,{...before,preferences:{a:2},updated_at:'2099-01-01T00:00:00Z'}));assert.deepEqual(Object.keys(writes(db)[0].body),['preferences']);assert.equal(writes(db)[0].filters.at(-1)[1],OLD);
 });
 await test('updating a session does not touch odometer or other records',async()=>{
  const before={user_id:uid,id:'s1',note:'A',updated_at:OLD},db=mock({sessions:[before,{...before,id:'s2'}],user_settings:[{user_id:uid,current_odometer:5000}]});await P.writeRecord(db.client,change('sessions',before,{...before,note:'B'}));assert.equal(db.rows.user_settings[0].current_odometer,5000);assert.equal(db.rows.sessions[1].note,'A');assert.ok(db.requests.every(r=>r.table==='sessions'));
 });
 await test('original input objects are unchanged on conflict',async()=>{
  const before=settings({a:1}),after={...before,preferences:{a:2}},copies=P.clone([before,after]),db=mock({user_settings:[{...before,preferences:{a:3}}]});await assert.rejects(()=>P.writeRecord(db.client,change('user_settings',before,after)),/Conflito/);assert.deepEqual([before,after],copies);
 });
 console.log('Version-guard tests:',count,'passed. In-memory only; no live database writes.');return count;
}
module.exports=run;if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
