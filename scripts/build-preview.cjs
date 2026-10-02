/* Preview-only reproducible bundle. The audited index.html remains untouched.
   Run: node scripts/build-preview.cjs. Never serve the unbuilt source as the new version. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm'),assert=require('node:assert/strict');
if(process.env.VERCEL_ENV==='production')throw new Error('Preview-only change. Production requires separate approval.');
const root=path.resolve(__dirname,'..');
require(path.join(root,'tests/fuel.test.cjs'));
const base=fs.readFileSync(path.join(root,'index.html'),'utf8');
const blob=crypto.createHash('sha1').update(`blob ${Buffer.byteLength(base)}\0`).update(base).digest('hex');
assert.equal(blob,'8ddb028592ef8490b737306789f63b83f32af80f','The audited source changed. Rebase and review the transformations.');
let html=base,patches=0;
function once(needle,replacement){
  const count=typeof needle==='string'?html.split(needle).length-1:[...html.matchAll(new RegExp(needle.source,needle.flags.includes('g')?needle.flags:needle.flags+'g'))].length;
  assert.equal(count,1,'Expected exactly one patch match: '+needle.toString().slice(0,120));
  html=html.replace(needle,()=>replacement);patches++;
}
function load(){
  try{
    const x=JSON.parse(localStorage.getItem(KEY)),base=clone(zeroState);
    if(!x||typeof x!=='object')return base;
    return {settings:{...base.settings,...x.settings,preferences:{...base.settings.preferences,...(x.settings?.preferences||{})}},
      fuelTest:{...base.fuelTest,...x.fuelTest},routine:{...base.routine,...x.routine},
      sessions:Array.isArray(x.sessions)?x.sessions:[],refuels:Array.isArray(x.refuels)?x.refuels:[],
      customStrategies:Array.isArray(x.customStrategies)?x.customStrategies:[],
      weeklyChecklist:x.weeklyChecklist&&typeof x.weeklyChecklist==='object'?x.weeklyChecklist:{}};
  }catch(_){return clone(zeroState);}
}
once(/^function load\(\)\{[^\n]*\}let state=load\(\);/m,load.toString()+'let state=load();');
once('tankCapacity:15,currentOdometer:0','tankCapacity:0,currentOdometer:0');
// Never import old local data into a cloud account automatically on login.
once(/^  if\(!dbHasData&&hasLocal&&\(!owner\|\|owner===uid\)\)\{[\s\S]*?^  \}/m,'  // Cloud reads are authoritative; no automatic local-data migration.');
once('period_breakdown:x.periodBreakdown||{}}))}',"period_breakdown:x.periodBreakdown||{},fuel_price:x.fuelPrice==null?null:+x.fuelPrice,fuel_consumption:x.fuelConsumption==null?null:+x.fuelConsumption}))}");
once("periodBreakdown:(x.period_breakdown&&typeof x.period_breakdown==='object')?x.period_breakdown:{}", "periodBreakdown:(x.period_breakdown&&typeof x.period_breakdown==='object')?x.period_breakdown:{},fuelPrice:x.fuel_price==null?null:+x.fuel_price,fuelConsumption:x.fuel_consumption==null?null:+x.fuel_consumption");
once('c=+state.settings.confirmedConsumption||0,p=+state.settings.fuelPrice||0;', 'c=DriveUpFuel.snapshot(state,s.date,s).fuelConsumption,p=DriveUpFuel.snapshot(state,s.date,s).fuelPrice;');
once('const payload={date:o.date,period:o.period','const payload={...DriveUpFuel.snapshot(state,o.date,currentEditing),date:o.date,period:o.period');
once('const p=pendingPdfImport,uid=currentUser.id;','const p=pendingPdfImport,uid=currentUser.id;manualFuelValidatePdf(p.days);');
once('    let odometerDelta=0;','    // Session kilometers are information only; odometer updates are manual.');
once('      odometerDelta+=totalKm-oldApplied;','      // No odometer delta is applied.');
once('const item={...(existing||{}),id:existing?.id||crypto.randomUUID()', 'const item={...(existing||{}),...DriveUpFuel.snapshot(state,d.date,existing),id:existing?.id||crypto.randomUUID()');
once('odometerAppliedKm:totalKm','odometerAppliedKm:+existing?.odometerAppliedKm||0');
once('    if(odometerDelta!==0)state.settings.currentOdometer=Math.max(0,(+state.settings.currentOdometer||0)+odometerDelta);','    // Preserve the latest manually entered odometer reading.');
once(/Hodômetro atualizado em [^\n]*? km\./,'Quilômetros salvos no histórico; hodômetro mantido.');
once(/^function renderFuel\(\)\{[^\n]*\}/m,'function renderFuel(){return manualFuelRender();}');
once(/^refuelForm\.onsubmit=e=>\{[\s\S]*?^\};/m,'refuelForm.onsubmit=manualFuelSaveRefuel;');
once(/^odometerForm\.onsubmit=e=>\{[^\n]*\};/m,'odometerForm.onsubmit=manualFuelSaveOdometer;');
once('  refuelForm.fullTank.checked=true;','  refuelForm.fullTank.checked=false;refuelForm.elements.updateCurrentOdometer.checked=true;');
once('  refuelForm.fullTank.checked=!!r.fullTank;','  refuelForm.fullTank.checked=!!r.fullTank;refuelForm.elements.updateCurrentOdometer.checked=false;');
const core=fs.readFileSync(path.join(root,'driveup-fuel.js'),'utf8'),ui=fs.readFileSync(path.join(root,'manual-fuel-ui.js'),'utf8');
once("<script>\nconst KEY=",'<script>\n'+core+'\n'+ui+'\nconst KEY=');
once('bindChartTooltips();\nrenderAll();\ninitializeAuth();','manualFuelInstall();\nbindChartTooltips();\nrenderAll();\ninitializeAuth();');
assert.ok(!html.includes('odometerDelta'),'A session-driven odometer update remains.');
assert.ok(!html.includes('currentOdometer=Math.max'),'An implicit odometer update remains.');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim());
scripts.forEach((source,i)=>new vm.Script(source,{filename:'built-script-'+i+'.js'}));
async function integration(){
  const F=require(path.join(root,'driveup-fuel.js'));
  let n=0;
  const check=(name,fn)=>{fn();n++;console.log('PASS integration:',name);};
  const source=scripts.find(s=>s.includes("const KEY='projetoUberDashboard_v8'"));assert.ok(source);
  const manual=source.match(/^sessionForm\.onsubmit=e=>\{[^\n]*\};/m)?.[0];assert.ok(manual);
  const pdf=source.match(/^confirmPdfImport\.onclick=async\(\)=>\{[\s\S]*?^\};/m)?.[0];assert.ok(pdf);
  const field=value=>({value:String(value),setCustomValidity(v){this.error=v;},reportValidity(){}});
  const state={settings:{currentOdometer:2000,confirmedConsumption:27,fuelPrice:6.84,tankCapacity:15,preferences:{}},sessions:[],refuels:[]};
  const o={date:'2026-10-02',period:'Noite',strategy:'seletiva',gross:'100',tip:'2',duration:'3:18',rides:'10',km:'81',tripKm:'60',note:''};
  const form={...Object.fromEntries(Object.entries(o).map(([k,v])=>[k,field(v)])),values:o,reset(){}};
  let writes=0;
  const ctx=vm.createContext({DriveUpFuel:F,state,sessionForm:form,editingSessionId:null,editingRefuelId:null,
    FormData:class{constructor(f){return Object.entries(f.values);}},crypto,console,
    parseDurationText:v=>!v?0:/^\d+:\d{2}$/.test(v)?Number(v.split(':')[0])*60+Number(v.split(':')[1]):null,
    sessionModal:{close(){}},refuelModal:{close(){}},odometerModal:{close(){}},save(){},
    localToday:()=> '2026-10-02',money:v=>String(v),num:v=>String(v),brDate:v=>v,
    KEY:'test',localStorage:{setItem(){}},setTimeout:fn=>fn(),currentUser:{id:'fake-test-user'},confirmPdfImport:{},
    dbClient:{from(){return {async upsert(){writes++;return{error:null};},async insert(){writes++;return{error:null};}}}},
    async syncStateToCloud(){},async refreshUberReportTransactions(){},setPdfStatus(){},renderAll(){}});
  vm.runInContext(ui,ctx);vm.runInContext(manual,ctx);
  ctx.sessionForm.onsubmit({preventDefault(){}});
  check('manual session saves both km values without changing odometer',()=>{assert.equal(state.sessions[0].km,81);assert.equal(state.sessions[0].tripKm,60);assert.equal(state.settings.currentOdometer,2000);assert.equal(state.sessions[0].fuelPrice,6.84);});
  ctx.editingSessionId=state.sessions[0].id;o.km='100';ctx.sessionForm.onsubmit({preventDefault(){}});
  check('editing session keeps odometer and snapshot',()=>{assert.equal(state.sessions.length,1);assert.equal(state.sessions[0].km,100);assert.equal(state.settings.currentOdometer,2000);assert.equal(state.sessions[0].fuelConsumption,27);});
  ctx.editingSessionId=null;o.km='10';o.tripKm='20';ctx.sessionForm.onsubmit({preventDefault(){}});
  check('invalid manual km does not create a session',()=>assert.equal(state.sessions.length,1));
  const vals={totalKm:field(81),tripKm:field(60),duration:field('3:18'),tip:field(0)};
  ctx.pdfDailyComplements={querySelector(){return{querySelector(selector){return vals[selector.match(/="(.*?)"/)[1]];}}}};
  const pending=()=>({transactions:[],days:[{date:'2026-10-02',period:'Noite',earnings:120,rides:10}],period:{start:'2026-10-01',end:'2026-10-02'},fileName:'fake-test.pdf',newTransactions:[],duplicates:0,newServiceEarnings:0});
  vm.runInContext(pdf,ctx);ctx.pendingPdfImport=pending();await ctx.confirmPdfImport.onclick();
  check('PDF session keeps odometer and saves both km fields',()=>{const s=state.sessions.find(s=>s.source==='uber_pdf');assert.equal(s.km,81);assert.equal(s.tripKm,60);assert.equal(s.odometerAppliedKm,0);assert.equal(state.settings.currentOdometer,2000);});
  ctx.pendingPdfImport=pending();vals.totalKm.value='90';await ctx.confirmPdfImport.onclick();
  check('reimport updates the same session without adding odometer km',()=>{assert.equal(state.sessions.filter(s=>s.source==='uber_pdf').length,1);assert.equal(state.settings.currentOdometer,2000);});
  const beforeWrites=writes;ctx.pendingPdfImport=pending();vals.tripKm.value='100';await ctx.confirmPdfImport.onclick();
  check('invalid PDF kilometers fail before cloud writes',()=>assert.equal(writes,beforeWrites));
  const v={date:'2026-10-02',liters:'5',price:'6',total:'30',odometer:'2200',station:'Teste',fuelType:'Gasolina',note:''};
  const rf={values:v,elements:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,field(x)])),fullTank:{checked:true}};
  rf.elements.updateCurrentOdometer={checked:false};ctx.refuelForm=rf;ctx.manualFuelSaveRefuel({preventDefault(){}});
  check('refuel without manual-reading consent leaves current odometer unchanged',()=>{assert.equal(state.settings.currentOdometer,2000);assert.equal(state.refuels[0].odometer,2200);});
  rf.elements.updateCurrentOdometer.checked=true;v.odometer='2300';ctx.manualFuelSaveRefuel({preventDefault(){}});
  check('explicit use of typed reading updates odometer to exact value',()=>assert.equal(state.settings.currentOdometer,2300));
  ctx.odometerForm={odometer:field(2400)};ctx.manualFuelSaveOdometer({preventDefault(){}});
  check('manual odometer form stores an absolute reading',()=>assert.equal(state.settings.currentOdometer,2400));
  ctx.odometerForm.odometer.value='-5';ctx.manualFuelSaveOdometer({preventDefault(){}});
  check('negative manual reading is refused',()=>assert.equal(state.settings.currentOdometer,2400));
  const calc=source.slice(source.indexOf('function calc(s){'),source.indexOf('function allRows(){'));vm.runInContext(calc,ctx);
  const before=ctx.calc(state.sessions[0]).fuel;state.settings.fuelPrice=10;state.settings.confirmedConsumption=20;
  check('financial history does not change with new configured values',()=>assert.equal(ctx.calc(state.sessions[0]).fuel,before));
  console.log(`Integration tests: ${n} passed. No live database calls were made.`);
  return n;
}
integration().then(count=>{
  const dist=path.join(root,'dist');fs.mkdirSync(dist,{recursive:true});fs.writeFileSync(path.join(dist,'index.html'),html);
  for(const name of ['app.css','app.js'])if(fs.existsSync(path.join(root,name)))fs.copyFileSync(path.join(root,name),path.join(dist,name));
  fs.writeFileSync(path.join(dist,'preview-build.json'),JSON.stringify({version:'manual-fuel-2026-10-02',sourceBlob:blob,patches,unitTests:28,integrationTests:count,production:false}));
  console.log(`Preview built: ${patches} checked patches, syntax validation, 28 unit tests, ${count} integration tests.`);
}).catch(err=>{console.error(err);process.exitCode=1;});
