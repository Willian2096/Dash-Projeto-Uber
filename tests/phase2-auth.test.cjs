'use strict';
const assert=require('node:assert/strict');
const A=require('../phase2-auth.js');

module.exports=async function(){
 let n=0;const t=(name,fn)=>{fn();n++;};

 t('canonical default',()=>assert.equal(A.getURL({href:'https://dash-projeto-uber.vercel.app/x?y=1'}),'https://dash-projeto-uber.vercel.app/'));
 t('branch preview goes canonical',()=>assert.equal(A.getURL({href:'https://dash-projeto-uber-git-feature-modulos-dashboard-will13-b9e8.vercel.app/'}),'https://dash-projeto-uber.vercel.app/'));
 t('unique preview goes canonical',()=>assert.equal(A.getURL({href:'https://dash-projeto-uber-abc123-will13-b9e8.vercel.app/'}),'https://dash-projeto-uber.vercel.app/'));
 t('foreign https goes canonical',()=>assert.equal(A.getURL({href:'https://example.com/'}),'https://dash-projeto-uber.vercel.app/'));
 t('undefined goes canonical',()=>assert.equal(A.getURL(),A.DEFAULT_SITE_URL));
 t('invalid goes canonical',()=>assert.equal(A.getURL({href:'not a url'}),A.DEFAULT_SITE_URL));
 t('localhost stays local',()=>assert.equal(A.getURL({href:'http://localhost:3000/test?q=1#x'}),'http://localhost:3000/'));
 t('127 stays local',()=>assert.equal(A.getURL({href:'http://127.0.0.1:4173/a'}),'http://127.0.0.1:4173/'));
 t('file protocol rejected',()=>assert.equal(A.getURL({href:'file:///tmp/index.html'}),A.DEFAULT_SITE_URL));
 t('normalizes canonical path',()=>assert.equal(A.getURL(null,'https://app.example.com/auth/callback?x=1'),'https://app.example.com/'));
 t('normalize strips fragments',()=>assert.equal(A.normalize('https://app.example.com/a?b=1#c'),'https://app.example.com/'));
 t('https localhost is canonical by policy',()=>assert.equal(A.getURL({href:'https://localhost:3000/'}),A.DEFAULT_SITE_URL));
 return n;
};
