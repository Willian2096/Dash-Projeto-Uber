/* Home chart: gross/net are two views of the same saved daily rows. No DB writes. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.DriveUpOverviewChart=api;
})(globalThis,function(){
  'use strict';
  const metric=value=>value==='gross'?'gross':'net';
  const finite=value=>Number.isFinite(Number(value))?Number(value):0;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function model(rows,selected='net'){
    const key=metric(selected),gross=key==='gross';
    const points=(Array.isArray(rows)?rows:[]).map(row=>({date:String(row.date||''),value:finite(row[key])})).sort((a,b)=>a.date.localeCompare(b.date));
    const sum=points.reduce((a,p)=>a+p.value,0),average=points.length?sum/points.length:0;
    let min=0,max=0;points.forEach(p=>{min=Math.min(min,p.value);max=Math.max(max,p.value);});
    const span=max-min||1;
    const lower=min<0?min-span*.12:0,upper=max>0?max+span*.12:(min<0?0:1);
    return {key,points,average,sum,lower,upper,label:gross?'Bruto por dia':'Líquido por dia',
      title:gross?'Evolução dos ganhos brutos por dia':'Evolução do líquido por dia',
      subtitle:gross?'Ganhos das sessões, incluindo gorjetas, antes dos custos.':'Ganhos das sessões após combustível e despesas consideradas.',
      empty:'Nenhuma sessão no mês selecionado.'};
  }
  function svgContent(m,money,date){
    const W=820,H=290,L=92,R=26,T=18,B=42,pw=W-L-R,ph=H-T-B;
    const xp=i=>L+(m.points.length===1?pw/2:i/(m.points.length-1)*pw);
    const yp=v=>T+ph-(v-m.lower)/(m.upper-m.lower)*ph;
    let h='<title>'+escape(m.title)+'</title><desc>'+escape(m.subtitle)+'</desc>';
    if(!m.points.length)return h+'<text x="410" y="145" text-anchor="middle" fill="currentColor">'+escape(m.empty)+'</text>';
    h+='<defs><linearGradient id="overviewArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--green)" stop-opacity=".28"/><stop offset="100%" stop-color="var(--green)" stop-opacity=".02"/></linearGradient></defs>';
    for(let i=0;i<=4;i++){
      const v=m.lower+(m.upper-m.lower)*i/4,y=yp(v);
      h+=`<line x1="${L}" y1="${y}" x2="${W-R}" y2="${y}" stroke="rgba(87,162,216,.16)" stroke-dasharray="3 4"/><text x="${L-12}" y="${y+4}" text-anchor="end" fill="#ffffff">${escape(money(v))}</text>`;
    }
    const baseline=yp(0),avgY=yp(m.average),pts=m.points.map((p,i)=>`${xp(i)},${yp(p.value)}`).join(' ');
    h+=`<line x1="${L}" y1="${baseline}" x2="${W-R}" y2="${baseline}" stroke="rgba(155,187,212,.35)"/>`;
    h+=`<polygon points="${xp(0)},${baseline} ${pts} ${xp(m.points.length-1)},${baseline}" fill="url(#overviewArea)"/>`;
    h+=`<line data-chart-average="${m.average}" x1="${L}" y1="${avgY}" x2="${W-R}" y2="${avgY}" stroke="var(--blue)" stroke-width="2" stroke-dasharray="7 6"/>`;
    h+=`<polyline data-income-series="${m.key}" points="${pts}" fill="none" stroke="var(--green)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`;
    const step=Math.max(1,Math.ceil(m.points.length/8));
    m.points.forEach((p,i)=>{
      const x=xp(i),y=yp(p.value),label=date(p.date)+' • '+m.label+' • '+money(p.value);
      h+=`<circle cx="${x}" cy="${y}" r="6" fill="var(--green)"/><circle cx="${x}" cy="${y}" r="14" fill="transparent" tabindex="0" aria-label="${escape(label)}" data-chart-tooltip="${escape(encodeURIComponent(label))}"><title>${escape(label)}</title></circle>`;
      if(i%step===0||i===m.points.length-1)h+=`<text x="${x}" y="${H-13}" text-anchor="middle" fill="#ffffff">${escape(date(p.date).slice(0,5))}</text>`;
    });
    return h;
  }
  function createRenderer({document,getOwner=()=>'',getStorage=()=>null,money=v=>String(v),date=v=>v}){
    const choices=new Map();
    const ownerKey=()=>String(getOwner()||'guest');
    const storageKey=owner=>'driveup:overview-income:'+owner;
    function read(owner){
      if(choices.has(owner))return choices.get(owner);
      try{return metric(getStorage()?.getItem(storageKey(owner)));}catch(_){return 'net';}
    }
    function remember(owner,value){
      choices.set(owner,metric(value));
      try{getStorage()?.setItem(storageKey(owner),metric(value));}catch(_){}
    }
    function draw(rows){
      const svg=document.getElementById('overviewChart');if(!svg)return;
      const panel=svg.closest('.overview-chart-panel');if(!panel)return;
      const select=panel.querySelector('.overview-chart-range'),owner=ownerKey(),m=model(rows,read(owner));
      if(select){
        select.id='overviewIncomeMetric';select.setAttribute('aria-label','Visualização do gráfico: ganhos brutos ou líquidos');
        select.innerHTML='<option value="net">Ganhos líquidos</option><option value="gross">Ganhos brutos</option>';
        select.value=m.key;
        select.onchange=()=>{if(ownerKey()!==owner)return;remember(owner,select.value);draw(rows);};
      }
      const title=panel.querySelector('h2'),subtitle=panel.querySelector('.overview-chart-heading .sub'),legend=panel.querySelector('.overview-chart-legend');
      if(title)title.textContent=m.title;if(subtitle)subtitle.textContent=m.subtitle;
      if(legend)legend.innerHTML='<span class="item"><i class="dot"></i>'+escape(m.label)+'</span><span class="item"><i class="dash"></i>Média do período ('+escape(money(m.average))+')</span>';
      svg.setAttribute('role','img');svg.setAttribute('aria-label',m.title);svg.setAttribute('data-income-metric',m.key);
      svg.innerHTML=svgContent(m,money,date);
    }
    return draw;
  }
  return {metric,model,svgContent,createRenderer};
});
