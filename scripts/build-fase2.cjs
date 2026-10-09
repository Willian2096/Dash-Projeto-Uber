'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
if(process.env.VERCEL_ENV==='production')throw Error('Fase 2 is preview-only until explicit production validation.');
if(process.env.VERCEL_GIT_COMMIT_REF&&process.env.VERCEL_GIT_COMMIT_REF!=='feature/modulos-dashboard')throw Error('Unexpected deployment branch.');

const base=spawnSync(process.execPath,[path.join(root,'scripts/build-fase1.cjs')],{cwd:root,stdio:'inherit',env:{...process.env,VERCEL_ENV:'preview'}});
if(base.status!==0)process.exit(base.status||1);

(async()=>{
 const authTests=await require(path.join(root,'tests/phase2-auth.test.cjs'))();
 const fuelOverviewTests=await require(path.join(root,'tests/fuel-overview.test.cjs'))();
 const target=path.join(root,'dist/index.html');let html=fs.readFileSync(target,'utf8');
 const once=(needle,replacement)=>{assert.equal(html.split(needle).length-1,1,'Patch point changed: '+needle);html=html.replace(needle,()=>replacement);};
 const old='https://dash-projeto-uber-git-feature-modulos-dashboard-will13-b9e8.vercel.app';
 const auth=fs.readFileSync(path.join(root,'phase2-auth.js'),'utf8');

 once("const SUPABASE_URL='https://kskddwcbrdqavkmagupf.supabase.co';",auth+"\nconst SUPABASE_URL='https://kskddwcbrdqavkmagupf.supabase.co';");
 once("emailRedirectTo:'"+old+"'", "emailRedirectTo:DriveUpAuthRedirect.getURL(window.location)");
 once("redirectTo:'"+old+"'", "redirectTo:DriveUpAuthRedirect.getURL(window.location)");
 const chart=fs.readFileSync(path.join(root,'overview-income-chart.js'),'utf8');
 once('phase1Install();\nbindChartTooltips();',chart+'\nphase1Install();\ndrawOverviewChart=DriveUpOverviewChart.createRenderer({document,getOwner:()=>currentUser?.id||"guest",getStorage:()=>window.sessionStorage,money,date:brDate});\nbindChartTooltips();');

 assert.equal(html.includes(old),false,'Legacy branch auth URL still present');
 assert.ok(html.includes('emailRedirectTo:DriveUpAuthRedirect.getURL(window.location)'));
 assert.ok(html.includes('redirectTo:DriveUpAuthRedirect.getURL(window.location)'));
 assert.equal((html.match(/DriveUpAuthRedirect\.getURL\(window\.location\)/g)||[]).length,2);
 assert.ok(html.includes('drawOverviewChart=DriveUpOverviewChart.createRenderer('));
 assert.ok(html.includes('balanceAdjusted: false'));
 assert.ok(!html.includes('odometerDelta'));
 for(const [i,m] of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].entries())if(m[1].trim())new vm.Script(m[1],{filename:'fase2-built-'+i+'.js'});
 fs.writeFileSync(target,html);

 const file=path.join(root,'dist/preview-build.json'),previous=JSON.parse(fs.readFileSync(file,'utf8'));
 fs.writeFileSync(file,JSON.stringify({...previous,version:'fase2-fuel-overview-2026-10-09',phase2AuthTests:authTests,fuelOverviewTests,totalTests:previous.totalTests+authTests+fuelOverviewTests,production:false,authRedirect:'canonical-site-url',canonicalSiteUrl:'https://dash-projeto-uber.vercel.app/',fuelAutonomy:'refill-restarts-depleted-estimate',overviewMetrics:['net','gross'],commit:process.env.VERCEL_GIT_COMMIT_SHA||null}));
 console.log('Fase 2 preview built. Tests passed:',previous.totalTests+authTests+fuelOverviewTests);
})().catch(err=>{console.error(err);process.exitCode=1;});
