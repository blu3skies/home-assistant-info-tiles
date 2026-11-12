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
 content.innerHTML='<div class="departures-grid">'+['1','2'].map(p=>'<section><table class="departures-table"><thead><tr><th>Time</th><th>Destination</th><th>Plat</th><th>Status</th></tr></thead><tbody><tr><td colspan="4" class="platform-header">Platform '+p+'</td></tr>'+((d[p]||[]).filter(t=>new Date(t.arrival).getTime()>Date.now()-60000||['cancelled','delayed','no report'].includes(t.etd.toLowerCase())).map(t=>{const late=!['on time','due',''].includes(t.etd.toLowerCase()), timed=!['cancelled','delayed','no report'].includes(t.etd.toLowerCase());return `<tr><td class="time ${late?'late':'ontime'}">${esc(t.std)}</td><td>${esc(t.destination)}${t.operatorCode?' ('+esc(t.operatorCode)+')':''}</td><td>${p}</td><td class="status ${late?'late':'ontime'}">${esc(t.etd||'On time')}${timed?' ('+(minutes(t.arrival)<=1?'Due':minutes(t.arrival)+' mins')+')':''}</td></tr>`;}).join('')||'<tr><td colspan="4">No departures for this platform.</td></tr>')+'</tbody></table></section>').join('')+'</div>';
 } else if(source==='tube'){
 // Preserve open details during polling; native details stays inside the iframe.
 const open=new Set([...content.querySelectorAll('details[open]')].map(e=>e.dataset.line));
 const bad=d.filter(t=>t.severity!=='good'),good=d.filter(t=>t.severity==='good');
 content.innerHTML=bad.map(t=>`<section><div class="tube-row ${esc(t.severity)}" style="--tube-color:${esc(t.color)}"><span class="tube-name">${esc(t.name)}</span><span class="tube-status-text">${esc(t.status)}</span></div>${t.reason?`<details class="tube-details" data-line="${esc(t.name)}" ${open.has(t.name)?'open':''}><summary>Show details — ${esc(t.name)}</summary><p>${esc(t.reason)}</p></details>`:''}</section>`).join('')+(good.length?`<div class="tube-summary"><div class="tube-summary-swatches">${good.map(t=>`<span style="background:${esc(t.color)}"></span>`).join('')}</div><div class="tube-status-text">${bad.length?'Good service on all other line'+(good.length===1?'':'s')+'.':'Good service on all lines.'}</div></div>`:'');
 }
}
async function refresh(){try{const r=await fetch('/api/'+source,{signal:AbortSignal.timeout(45000)});const value=await r.json();window.tileState(value);render();}catch(e){if(snapshot){snapshot.state='stale';window.tileState(snapshot);}else{window.tileState({state:'unavailable'});}render();}finally{setTimeout(refresh,Math.min(snapshot?.refresh_seconds||30,30)*1000);}}
if(source&&source!=='carbon'){refresh();setInterval(()=>{if(snapshot&&Date.now()-received>Math.max(snapshot.refresh_seconds*2000,60000)){snapshot.state='stale';}if(source!=='tube')render();},1000);}
