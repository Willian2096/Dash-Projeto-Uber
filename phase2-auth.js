/* DriveUp Fase 2 — canonical auth redirects. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DriveUpAuthRedirect=api;})(globalThis,function(){
'use strict';
const DEFAULT_SITE_URL='https://dash-projeto-uber.vercel.app/';

function normalize(url){
  try{
    const parsed=new URL(String(url||''));
    if(parsed.protocol!=='https:'&&parsed.protocol!=='http:')throw Error('protocol');
    parsed.pathname='/';parsed.search='';parsed.hash='';
    return parsed.toString();
  }catch(_){return DEFAULT_SITE_URL;}
}

function isLocal(url){
  try{
    const parsed=new URL(String(url||''));
    return parsed.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(parsed.hostname);
  }catch(_){return false;}
}

function getURL(locationLike,canonical=DEFAULT_SITE_URL){
  const canonicalURL=normalize(canonical);
  const href=typeof locationLike==='string'?locationLike:locationLike&&locationLike.href;
  // Local development must remain local. Every deployed environment redirects
  // to the canonical app URL so auth emails never depend on ephemeral previews.
  return isLocal(href)?normalize(href):canonicalURL;
}

return {DEFAULT_SITE_URL,normalize,isLocal,getURL};
});
