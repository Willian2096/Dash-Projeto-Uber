'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../phase1-core.js');
function mockDB(seed={}){
 const tables=P.clone(seed),writes=[];let race=null,failure=null;
 function from(table){let mode='select',payload,filters=[],start=0,end=Infinity;
  const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},is(k,v){filters.push([k,v]);return q;},in(k,v){filters.push([k,v,'in']);return q;},order(){return q;},range(a,b){start=a;end=b;return q;},update(v){mode='update';payload=P.clone(v);return q;},insert(v){mode='insert';payload=P.clone(v);return q;},delete(){mode='delete';return q;},then(a,b){return run(false).then(a,b);},maybeSingle(){return run(true);},single(){return run(true);}};
  async function run(single){
   if(mode!=='select'&&failure===table)return {data:null,error:{message:'Falha de rede simulada'}};
   if(mode!=='select'&&race){const f=race;race=null;f(tables);}
   const match=row=>filters.every(([k,v,op])=>op==='in'?v.includes(row[k]):P.equal(row[k],typeof row[k]==='object'&&typeof v==='string'?JSON.parse(v):v));
   tables[table]=tables[table]||[];let found=tables[table].filter(match).slice(start,end+1);
   if(mode==='insert'){tables[table].push(payload);found=[payload];writes.push({table,mode,payload});}
   if(mode==='update'){found.forEach(r=>Object.assign(r,payload));writes.push({table,mode,payload,count:found.length});}
   if(mode==='delete'){tables[table]=tables[table].filter(r=>!match(r));writes.push({table,mode});}
   return {data:P.clone(single?found[0]||null:found),error:null};
  }
  return q;
 }
 return {from,tables,writes,setRace(f){race=f;},fail(table){failure=table;}};
}
async function run(){let count=0;
 const test=async(name,fn)=>{await fn();count++;console.log('PASS Fase 1:',name);};
 const row={user_id:'u1',id:'s1',gross:100,tip:0,minutes:60,note:null};
 const before=new Map([[P.id('sessions',row),row]]);
 await test('canonical equality ignores property order',()=>assert.ok(P.equal({b:2,a:1},{a:1,b:2})));
 await test('unchanged records generate no writes',()=>assert.equal(P.plan(before,{sessions:[{...row}]}).length,0));
 await test('only changed record is planned',()=>{const r2={...row,id:'s2'};const b=new Map([...before,[P.id('sessions',r2),r2]]);assert.deepEqual(P.plan(b,{sessions:[{...row,minutes:90},r2]}).map(x=>x.after.id),['s1']);});
 await test('removing local row never schedules implicit deletion',()=>assert.equal(P.plan(before,{sessions:[]}).length,0));
 await test('new records are planned separately',()=>assert.equal(P.plan(before,{sessions:[row,{...row,id:'s2'}]}).length,1));
 await test('unsupported table is refused',()=>assert.throws(()=>P.id('auth.users',row)));
 await test('legacy JSON goals are excluded from preferences writes',()=>assert.deepEqual(P.cleanPreferences({monthlyGoals:{a:1},darkTheme:true}),{darkTheme:true}));
 await test('same month has stable composite key',()=>assert.equal(P.id('monthly_goals',{user_id:'u',month:'2026-10-01'}),'monthly_goals:["u","2026-10-01"]'));
 for(const [m,g,b,expected] of [['2026-10',500,0,true],['2026-13',1,0,false],['2026-00',1,0,false],['2026-10',-1,0,false],['2026-10',1,-1,false],['2026-10',Infinity,0,false],['2026-10',0,0,true]])await test('goal validation '+[m,g,b].join('/'),()=>assert.equal(P.validGoal(m,g,b),expected));
 const source=[{id:'1',date:'2026-10-01',source:'manual'},{id:'2',date:'2026-10-02',source:'uber_pdf'}];
 await test('PDF warns about a manual day',()=>assert.deepEqual(P.overlap(source,['2026-10-01'],'uber_pdf'),['2026-10-01']));
 await test('manual warns about PDF day',()=>assert.deepEqual(P.overlap(source,['2026-10-02'],'manual'),['2026-10-02']));
 await test('same source is not a manual/PDF overlap',()=>assert.deepEqual(P.overlap(source,['2026-10-01'],'manual'),[]));
 await test('editing same identifier can be excluded',()=>assert.deepEqual(P.overlap(source,['2026-10-02'],'manual','2'),[]));
 await test('other dates do not warn',()=>assert.deepEqual(P.overlap(source,['2026-10-03'],'manual'),[]));
 await test('per-record update sends only changed columns',async()=>{const db=mockDB({sessions:[row,{...row,id:'s2'}]});await P.writeRecord(db,{table:'sessions',before:row,after:{...row,minutes:90}});assert.deepEqual(db.writes[0].payload,{minutes:90});assert.equal(db.tables.sessions[1].minutes,60);});
 await test('unrelated concurrent column is preserved',async()=>{const db=mockDB({sessions:[{...row,tip:10}]});await P.writeRecord(db,{table:'sessions',before:row,after:{...row,minutes:90}});assert.equal(db.tables.sessions[0].tip,10);});
 await test('same concurrent column is not overwritten',async()=>{const db=mockDB({sessions:[{...row,minutes:120}]});await assert.rejects(()=>P.writeRecord(db,{table:'sessions',before:row,after:{...row,minutes:90}}),/Conflito/);assert.equal(db.writes.length,0);});
 await test('deleted remote record is not recreated',async()=>{const db=mockDB({sessions:[]});await assert.rejects(()=>P.writeRecord(db,{table:'sessions',before:row,after:{...row,minutes:90}}),/removido/);assert.equal(db.writes.length,0);});
 await test('explicit new record is inserted',async()=>{const db=mockDB();await P.writeRecord(db,{table:'sessions',before:null,after:row},{exists:false});assert.equal(db.writes[0].mode,'insert');});
 await test('new row collision is not overwritten',async()=>{const db=mockDB({sessions:[{...row,minutes:5}]});await assert.rejects(()=>P.writeRecord(db,{table:'sessions',before:null,after:row},{exists:false}),/Conflito/);assert.equal(db.writes.length,0);});
 await test('retry of successful insert is idempotent',async()=>{const db=mockDB({sessions:[row]});await P.writeRecord(db,{table:'sessions',before:null,after:row},{exists:false});assert.equal(db.writes.length,0);});
 await test('account change cancels the write',async()=>{const db=mockDB();await assert.rejects(()=>P.writeRecord(db,{table:'sessions',before:null,after:row},{active:()=>false}),/conta/);assert.equal(db.writes.length,0);});
 await test('atomic comparison detects a write between read and update',async()=>{const db=mockDB({sessions:[row]});db.setRace(t=>t.sessions[0].minutes=150);await assert.rejects(()=>P.writeRecord(db,{table:'sessions',before:row,after:{...row,minutes:90}}),/Conflito/);assert.equal(db.tables.sessions[0].minutes,150);});
 await test('network failure leaves backend data unchanged',async()=>{const db=mockDB({sessions:[row]});db.fail('sessions');await assert.rejects(()=>P.writeRecord(db,{table:'sessions',before:row,after:{...row,minutes:90}}),/rede/);assert.equal(db.tables.sessions[0].minutes,60);});
 await test('JSON changes preserve other preference fields',()=>assert.deepEqual(P.mergeJSON({a:1,b:1},{a:2,b:1},{a:1,b:3,extra:true}),{a:2,b:3,extra:true}));
 await test('same JSON field conflict is detected',()=>assert.throws(()=>P.mergeJSON({a:1},{a:2},{a:3}),/Conflito/));
 await test('nested preference changes merge safely',()=>assert.deepEqual(P.mergeJSON({r:{a:1,b:1}},{r:{a:2,b:1}},{r:{a:1,b:9}}),{r:{a:2,b:9}}));
 await test('key filters do not touch another user',async()=>{const db=mockDB({sessions:[row,{...row,user_id:'u2'}]});await P.writeRecord(db,{table:'sessions',before:row,after:{...row,minutes:90}});assert.equal(db.tables.sessions[1].minutes,60);});
 // Integration of the actual Phase 1 browser functions, with an isolated DB stub.
 const elements=new Map();function node(){return {style:{},dataset:{},value:'',textContent:'',hidden:false,children:[],setAttribute(){},setCustomValidity(){},reportValidity(){},addEventListener(){},prepend(){},querySelector(){return node();},querySelectorAll(){return [node(),node()];}};}
 const document={getElementById(id){if(!elements.has(id))elements.set(id,node());return elements.get(id);},querySelector(){return node();},querySelectorAll(){return [];},createElement(){return node();}};
 const db=mockDB({user_settings:[{user_id:'u1',fuel_price:6,confirmed_consumption:30,profile_name:'Test',preferences:{selectedMonth:'2026-10',monthlyGoals:{'2026-09':{goal:100,baseline:5}}}}],profiles:[{id:'u1',full_name:'Test'}],sessions:[{...row,session_date:'2026-10-01',source:'manual',updated_at:'2026-10-01T00:00:00Z'}],refuels:[],routines:[],strategies:[],weekly_checklists:[],monthly_goals:[],driveup_daily_totals:[]});
 const state={settings:{fuelPrice:6,confirmedConsumption:30,profileName:'Test',currentOdometer:5000,preferences:{selectedMonth:'2026-10',monthlyGoals:{'2026-09':{goal:100,baseline:5}},fuelLegacyBaseline:{version:1,price:6,consumption:30}}},sessions:[{...row,session_date:'2026-10-01',source:'manual'}]};
 const form={onsubmit(){},km:node(),tripKm:node(),duration:node(),date:node(),gross:node(),rides:node(),period:node()};
 const ctx=vm.createContext({console,document,window:{confirm:()=>true,alert(){},addEventListener(){}},state,dbClient:db,currentUser:{id:'u1'},cloudReady:true,syncTimer:null,KEY:'test',localStorage:{setItem(){}},setTimeout:()=>1,clearTimeout(){},sessionForm:form,confirmPdfImport:{},pendingPdfImport:null,editingSessionId:null,
 cloudSettingsRow:()=>({user_id:'u1',goal:0,baseline:0,reference_date:'2026-10-01',fuel_price:state.settings.fuelPrice,confirmed_consumption:state.settings.confirmedConsumption,profile_name:state.settings.profileName,preferences:state.settings.preferences}),
 cloudSessionRows:()=>P.clone(state.sessions),cloudRefuelRows:()=>[],cloudRoutineRows:()=>[],cloudStrategyRows:()=>[],cloudChecklistRows:()=>[],ensureMonthlyGoals:()=>state.settings.preferences.monthlyGoals,
 setMonthlyGoal:(m,g,b)=>state.settings.preferences.monthlyGoals[m]={goal:g,baseline:b},dayRows:()=>[],selectedMonthKey:()=>state.settings.preferences.selectedMonth,renderAll(){},renderHistory(){},renderPdfDailyCards(){},deleteSessionConfirmed:async()=>{},clearCloudData:async()=>{},openEditSession(){},openSession(){},exportJson(){},brDate:x=>x,
 DriveUpFuel:{baseline:()=>state.settings.preferences.fuelLegacyBaseline,validateKm:()=>''},parseDurationText:()=>60,
 configGoalMonth:{value:'2026-10'},configGoal:{value:500},configBaseline:{value:0}});
 vm.runInContext(fs.readFileSync(require.resolve('../phase1-core.js'),'utf8')+'\n'+fs.readFileSync(require.resolve('../phase1-ui.js'),'utf8'),ctx);
 ctx.loadCloudState=async()=>{ctx.phase1LoadedRaw={};for(const t of ['user_settings','profiles','sessions','refuels','routines','strategies','weekly_checklists'])ctx.phase1LoadedRaw[t]=P.clone(db.tables[t]||[]);};
 ctx.phase1Install();await ctx.loadCloudState({id:'u1'});
 await test('login reads goals and does not write any records',()=>assert.equal(db.writes.length,0));
 await test('legacy goal remains available without migration',()=>{assert.equal(state.settings.preferences.monthlyGoals['2026-09'].goal,100);assert.equal(db.tables.monthly_goals.length,0);});
 ctx.setMonthlyGoal('2026-10',500,10);await ctx.phase1Flush();
 await test('explicit save inserts only the edited monthly goal',()=>{assert.equal(db.tables.monthly_goals.length,1);assert.equal(db.tables.monthly_goals[0].month,'2026-10-01');assert.equal(db.tables.monthly_goals[0].goal,500);});
 await test('legacy monthly JSON is preserved in the database',()=>assert.equal(db.tables.user_settings[0].preferences.monthlyGoals['2026-09'].goal,100));
 const w=db.writes.length;await ctx.phase1Flush();
 await test('second unchanged sync writes nothing',()=>assert.equal(db.writes.length,w));
 state.sessions[0].minutes=180;await ctx.phase1Flush();
 await test('browser sync updates just the changed session columns',()=>{const w=db.writes.filter(x=>x.table==='sessions').at(-1);assert.deepEqual(w.payload,{minutes:180});assert.equal(state.settings.currentOdometer,5000);});
 state.sessions[0].minutes=200;db.fail('sessions');await assert.rejects(()=>ctx.phase1Flush());
 await test('failed sync retains pending local data and visible error',()=>{assert.equal(state.sessions[0].minutes,200);assert.equal(db.tables.sessions[0].minutes,180);assert.match(ctx.phase1Status,/Não foi possível/);});
 db.fail(null);await ctx.phase1Flush();
 await test('explicit retry saves the retained change',()=>assert.equal(db.tables.sessions[0].minutes,200));
 await test('odometer remains manual after all sync operations',()=>assert.equal(state.settings.currentOdometer,5000));
 let rpcCalls=[],rpcFailure=null,pdfMessages=[],closed=0;
 db.rpc=async(name,args)=>{rpcCalls.push({name,args});return rpcFailure?{error:{message:rpcFailure},data:null}:{error:null,data:{new_transactions:1,duplicate_transactions:0,sessions:[]}};};
 ctx.setPdfStatus=(message,type)=>pdfMessages.push({message,type});ctx.sessionModal={close(){closed++;}};
 ctx.manualFuelValidatePdf=()=>{};ctx.DriveUpFuel.snapshot=()=>({fuelPrice:6,fuelConsumption:30});
 ctx.pdfDailyComplements={querySelector(){return {querySelector(sel){const k=sel.match(/="(.*?)"/)[1];return {value:{tip:'2',duration:'1:00',totalKm:'90',tripKm:'70'}[k]||''};}};}};
 const pending=date=>({fileName:'fixture.pdf',period:{start:'2026-10-01T00:00:00',end:'2026-10-07T00:00:00'},days:[{date}],transactions:[{fingerprint:'fixture',eventAt:date+'T19:00:00',processedAt:date+'T19:00:00',label:'Moto',kind:'service',serviceType:'Moto',earnings:100,expense:0,transfer:0,balance:100}]});
 ctx.loadCloudState=async()=>{};
 await test('installed PDF button uses the atomic import handler',()=>assert.equal(ctx.confirmPdfImport.onclick,ctx.phase1ImportPdf));
 ctx.pendingPdfImport=pending('2026-10-02');await ctx.phase1ImportPdf();
 await test('PDF import uses exactly one atomic RPC',()=>{assert.equal(rpcCalls.length,1);assert.equal(rpcCalls[0].name,'driveup_import_pdf_v1');});
 await test('PDF RPC carries both km fields and fuel snapshot',()=>{const d=rpcCalls[0].args.p_days[0];assert.equal(d.km,90);assert.equal(d.trip_km,70);assert.equal(d.fuel_price,6);assert.equal(d.fuel_consumption,30);});
 await test('new import sends no invented concurrency token',()=>assert.equal(rpcCalls[0].args.p_days[0].expected_updated_at,null));
 await test('successful import leaves manual odometer unchanged',()=>{assert.equal(state.settings.currentOdometer,5000);assert.equal(closed,1);});
 ctx.manualFuelValidatePdf=()=>{throw Error('Km inválido');};ctx.pendingPdfImport=pending('2026-10-02');await ctx.phase1ImportPdf();
 await test('invalid complement stops before RPC',()=>{assert.equal(rpcCalls.length,1);assert.equal(pdfMessages.at(-1).type,'error');});
 ctx.manualFuelValidatePdf=()=>{};ctx.window.confirm=()=>false;ctx.pendingPdfImport=pending('2026-10-01');await ctx.phase1ImportPdf();
 await test('cancelled manual/PDF overlap does not import or delete',()=>{assert.equal(rpcCalls.length,1);assert.equal(db.writes.filter(x=>x.mode==='delete').length,0);});
 ctx.window.confirm=()=>true;rpcFailure='Conflito no banco';const draft=pending('2026-10-02');ctx.pendingPdfImport=draft;await ctx.phase1ImportPdf();
 await test('failed RPC retains the import draft and does not report success',()=>{assert.equal(ctx.pendingPdfImport,draft);assert.equal(pdfMessages.at(-1).type,'error');assert.equal(closed,1);});
 console.log('Fase 1 tests:',count,'passed. All database writes in these tests were simulated.');return count;
}
module.exports=run;if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
