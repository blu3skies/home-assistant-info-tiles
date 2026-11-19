'use strict';
const source=document.body.dataset.source, content=document.getElementById('content'), state=document.getElementById('state');
let snapshot=null, received=0;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=v=>new Date(v).toLocaleString('en-GB',{timeZone:'Europe/London'});
window.tileState = value=>{snapshot=value;received=Date.now();state.className=value.state==='ok'?'':'alert';state.textContent=(value.fixture?'DEVELOPMENT FIXTURES · ':'')+(value.state==='ok'?'Updated: ':value.state==='stale'?'STALE — upstream unavailable. Last success: ':'UNAVAILABLE — check server configuration. ')+(value.last_successful_update?stamp(value.last_successful_update):'');};
const minutes=v=>Math.max(0,Math.floor((new Date(v)-Date.now())/60000));
function render(){
 if(!snapshot||source==='carbon')return;
 const d=snapshot.data;
 if(snapshot.state!=='ok'&&(source==='buses'||source==='trains')){content.textContent='Live departures unavailable; cached departures are hidden.';return;}
 if(!d){content.textContent='Data unavailable';return;}
 if(source==='buses'){
 const rows=d.filter(b=>new Date(b.arrival)>Date.now());
 content.innerHTML=rows.length?'<table class="bus-table"><thead><tr><th>Line</th><th>Destination</th><th>In</th></tr></thead><tbody>'+rows.map(b=>`<tr><td>${esc(b.line)}</td><td>${esc(b.destination)}</td><td>${minutes(b.arrival)?minutes(b.arrival)+' min':'Due'}</td></tr>`).join('')+'</tbody></table>':'No upcoming bus departures.';
 } else if(source==='trains'){
 const rows=['1','2'].flatMap(p=>d[p]||[])
   .filter(t=>new Date(t.arrival).getTime()>Date.now()-60000||['cancelled','delayed','no report'].includes(t.etd.toLowerCase()))
   .sort((a,b)=>a.std.localeCompare(b.std));
 content.innerHTML=rows.length?'<table class="departures-table compact-trains"><thead><tr><th>Time</th><th>Destination</th><th>In / status</th></tr></thead><tbody>'+rows.map(t=>{
   const status=(t.etd||'On time'), late=!['on time','due',''].includes(status.toLowerCase());
   const untimed=['cancelled','delayed','no report'].includes(status.toLowerCase());
   const remaining=minutes(t.arrival);
   return `<tr><td class="time ${late?'late':'ontime'}">${esc(t.std)}</td><td>${esc(t.destination)}</td><td class="status ${late?'late':'ontime'}" title="${esc(status)}">${untimed?esc(status):(remaining<=1?'Due':remaining+' min')}${late&&!untimed?' · late':''}</td></tr>`;
 }).join('')+'</tbody></table>':'No upcoming train departures.';
 } else if(source==='tube'){
 const bad=d.filter(t=>t.severity!=='good'),good=d.filter(t=>t.severity==='good');
 content.innerHTML='<div class="tube-status-list">'+bad.map(t=>`<div class="tube-row ${esc(t.severity)}" style="--tube-color:${esc(t.color)}"><span class="tube-name">${esc(t.name)}</span><span class="tube-status-text">${esc(t.status)}</span>${t.reason?`<div class="tube-reason-container"><button type="button" class="reason-toggle" data-line="${esc(t.name)}">Show details</button></div>`:''}</div>`).join('')+(good.length?`<div class="tube-row tube-summary"><div class="tube-summary-swatches">${good.map(t=>`<span style="background:${esc(t.color)}"></span>`).join('')}</div><div class="tube-name"></div><div class="tube-status-text">${bad.length?'Good service on all other line'+(good.length===1?'':'s')+'.':'Good service on all lines.'}</div></div>`:'')+'</div>';

 }
}
async function refresh(){try{const r=await fetch('/api/'+source,{signal:AbortSignal.timeout(45000)});const value=await r.json();window.tileState(value);render();}catch(e){if(snapshot){snapshot.state='stale';window.tileState(snapshot);}else{window.tileState({state:'unavailable'});}render();}finally{setTimeout(refresh,Math.min(snapshot?.refresh_seconds||30,30)*1000);}}
if(source&&source!=='carbon'){refresh();setInterval(()=>{if(snapshot&&Date.now()-received>Math.max(snapshot.refresh_seconds*2000,60000)){snapshot.state='stale';}if(source!=='tube')render();},1000);}

if(source==='tube'){
 const dialog=document.createElement('dialog');
 dialog.className='tube-dialog';
 dialog.innerHTML='<div class="tube-dialog-header"><h2 id="tube-dialog-title"></h2><button type="button" aria-label="Close disruption details">×</button></div><div class="tube-dialog-reason"></div>';
 dialog.setAttribute('aria-labelledby','tube-dialog-title');
 document.body.append(dialog);
 document.querySelector('.tube-panel').append(state);
 dialog.querySelector('button').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
 content.addEventListener('click',event=>{
  const button=event.target.closest('.reason-toggle');
  if(!button)return;
  const line=snapshot.data.find(t=>t.name===button.dataset.line);
  if(!line)return;
  dialog.querySelector('h2').textContent=line.name+' — Details';
  dialog.querySelector('.tube-dialog-reason').textContent=line.reason;
  dialog.showModal();
 });
}
