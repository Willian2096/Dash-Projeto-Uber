/* DriveUp Fase 2 — sanitize PDF strings for PostgreSQL JSON/text. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DriveUpPdfSanitize=api;})(globalThis,function(){
'use strict';
function text(value){
  if(value==null)return value;
  const s=String(value).replace(/\u0000/g,'');
  let out='';
  for(let i=0;i<s.length;i++){
    const c=s.charCodeAt(i);
    if(c>=0xD800&&c<=0xDBFF){
      const next=s.charCodeAt(i+1);
      if(next>=0xDC00&&next<=0xDFFF){out+=s[i]+s[i+1];i++;}else out+='\uFFFD';
    }else if(c>=0xDC00&&c<=0xDFFF)out+='\uFFFD';
    else out+=s[i];
  }
  return out;
}
function deep(value){
  if(typeof value==='string')return text(value);
  if(Array.isArray(value))return value.map(deep);
  if(value&&typeof value==='object'){
    const out={};for(const [k,v] of Object.entries(value))out[text(k)]=deep(v);return out;
  }
  return value;
}
return {text,deep};
});
