'use strict';
const assert=require('node:assert/strict');
const S=require('../pdf-text-sanitize.js');
module.exports=async function(){
 let n=0;const t=(name,fn)=>{fn();n++;console.log('PASS PDF sanitize:',name);};
 t('removes NUL from labels',()=>assert.equal(S.text('Uber\u0000X'),'UberX'));
 t('preserves accents and emoji',()=>assert.equal(S.text('Transferência 🚗'),'Transferência 🚗'));
 t('replaces lone high surrogate',()=>assert.equal(S.text('A\uD800B'),'A�B'));
 t('replaces lone low surrogate',()=>assert.equal(S.text('A\uDC00B'),'A�B'));
 t('preserves valid surrogate pair',()=>assert.equal(S.text('A\uD83D\uDE97B'),'A🚗B'));
 t('deep sanitizes transaction payload',()=>assert.deepEqual(S.deep({event_label:'Corrida\u0000',nested:['A\uD800B'],n:1}),{event_label:'Corrida',nested:['A�B'],n:1}));
 t('null and numbers unchanged',()=>{assert.equal(S.deep(null),null);assert.equal(S.deep(12.3),12.3);});
 t('sanitized JSON contains no nul escape',()=>assert.equal(JSON.stringify(S.deep({x:'a\u0000b'})).includes('\\u0000'),false));
 return n;
};
