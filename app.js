'use strict';
/* ===== Pure logic (testable) ===== */
const KEY='moneyhub.v1';
function blank(){return{version:1,settings:{payFreq:'biweekly'},bills:[],stock:[],preferred:[],deals:[],deductions:[],college:[]}}
// Money: parse to integer cents without floats
function parseCents(v){
  if(typeof v==='number'&&Number.isInteger(v))return v*100;
  let s=String(v==null?'':v).trim().replace(/[$,\s]/g,'');if(s==='')return 0;
  let neg=false;if(s[0]==='('&&s.endsWith(')')){neg=true;s=s.slice(1,-1)}if(s[0]==='-'){neg=true;s=s.slice(1)}
  if(!/^\d*(\.\d*)?$/.test(s))return NaN;
  let[w,f='']=s.split('.');w=w||'0';
  let c=BigInt(w)*100n+BigInt((f+'00').slice(0,2));
  if(f.length>2&&f[2]>='5')c+=1n;
  const n=Number(c);return neg?-n:n;
}
function fmt(c){c=Math.trunc(c||0);const neg=c<0;c=Math.abs(c);const d=String(Math.floor(c/100)).replace(/\B(?=(\d{3})+(?!\d))/g,',');return(neg?'-':'')+'$'+d+'.'+String(c%100).padStart(2,'0')}
const PER_YEAR={weekly:52,biweekly:26,semimonthly:24,monthly:12};
// monthly cents -> per paycheck cents (annualized, rounded half up, integer math)
function perPaycheck(monthly,freq){const n=PER_YEAR[freq]||26;const a=monthly*12;return Math.floor((2*a+n)/(2*n))}
// dates as YYYY-MM-DD, day arithmetic in UTC
function toDay(s){const[y,m,d]=s.split('-').map(Number);return Date.UTC(y,m-1,d)/864e5}
function fromDay(n){const t=new Date(n*864e5);return t.toISOString().slice(0,10)}
function todayStr(){const t=new Date();return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0')}
function dim(y,m){return new Date(Date.UTC(y,m,0)).getUTCDate()}
// next due date on/after `from`
function nextDue(b,from){
  if(b.dueType==='fixed'){const day=+b.dueDay;if(!day)return null;let[y,m]=from.split('-').map(Number);
    for(let i=0;i<3;i++){const dd=Math.min(day,dim(y,m));const s=y+'-'+String(m).padStart(2,'0')+'-'+String(dd).padStart(2,'0');if(s>=from)return s;m++;if(m>12){m=1;y++}}return null}
  if(!b.lastDue||!(+b.cycleDays>0))return null;const c=+b.cycleDays;let d=toDay(b.lastDue);const f=toDay(from);
  if(d<f)d+=Math.ceil((f-d)/c)*c;return fromDay(d)}
// all due dates for bill in month 'YYYY-MM'
function dueInMonth(b,ym){const[y,m]=ym.split('-').map(Number);const out=[];
  if(b.dueType==='fixed'){const day=+b.dueDay;if(day)out.push({date:ym+'-'+String(Math.min(day,dim(y,m))).padStart(2,'0'),est:false});return out}
  if(!b.lastDue||!(+b.cycleDays>0))return out;const c=+b.cycleDays,start=toDay(ym+'-01'),end=toDay(ym+'-'+dim(y,m));
  let d=toDay(b.lastDue);if(d<start)d+=Math.ceil((start-d)/c)*c;else d-=Math.floor((d-start)/c)*c;
  for(;d<=end;d+=c)out.push({date:fromDay(d),est:fromDay(d)!==b.lastDue});return out}
// CSV
function parseCSV(t){t=String(t).replace(/^\uFEFF/,'');const rows=[];let r=[],f='',q=false;
  for(let i=0;i<t.length;i++){const ch=t[i];
    if(q){if(ch==='"'){if(t[i+1]==='"'){f+='"';i++}else q=false}else f+=ch}
    else if(ch==='"')q=true;else if(ch===','){r.push(f);f=''}else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&t[i+1]==='\n')i++;r.push(f);rows.push(r);r=[];f=''}else f+=ch}
  if(f!==''||r.length){r.push(f);rows.push(r)}
  const clean=rows.filter(x=>x.some(v=>v.trim()!==''));if(!clean.length)return[];
  const h=clean[0].map(x=>x.trim().toLowerCase());return clean.slice(1).map(x=>{const o={};h.forEach((k,i)=>o[k]=(x[i]||'').trim());return o})}
function csvCell(v){v=v==null?'':String(v);return/[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
function toCSV(h,rows){return[h.join(','),...rows.map(r=>h.map(k=>csvCell(r[k])).join(','))].join('\r\n')+'\r\n'}
const yes=v=>/^(y|yes|true|1|x)$/i.test(String(v||'').trim());
const uid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36);
const TEMPLATES={
 bills:{cols:['name','amount','pay_from','due_type','due_day','last_due','cycle_days','autopay','category','notes','new_amount','new_amount_from'],
  guide:{name:'Bill name (required)',amount:'Monthly amount, like 45.99',pay_from:'Account or card it is paid from',due_type:'fixed or varies',due_day:'For fixed: day of month 1-31',last_due:'For varies: last due date YYYY-MM-DD',cycle_days:'For varies: days between bills, like 30',autopay:'yes or no',category:'Optional label',notes:'Optional notes',new_amount:'Optional: amount after a change, like 29.99',new_amount_from:'Month the new amount starts, YYYY-MM'},
  map:o=>({id:uid(),name:o.name,cents:parseCents(o.amount),payFrom:o.pay_from||'',dueType:(o.due_type||'').toLowerCase().startsWith('v')?'varies':'fixed',dueDay:o.due_day?+o.due_day:'',lastDue:o.last_due||'',cycleDays:o.cycle_days?+o.cycle_days:'',autopay:yes(o.autopay),category:o.category||'',notes:o.notes||'',changes:o.new_amount&&/^\d{4}-\d{2}$/.test(o.new_amount_from||'')?[{from:o.new_amount_from,cents:parseCents(o.new_amount)}]:[],paid:{}})},
 stock:{cols:['item','qty','min_qty','location','unit','notes'],
  guide:{item:'Item name (required)',qty:'How many you have now (whole number)',min_qty:'Buy more when at or below this',location:'Pantry, garage, etc.',unit:'Optional: rolls, cans',notes:'Optional'},
  map:o=>({id:uid(),name:o.item,qty:parseInt(o.qty)||0,min:parseInt(o.min_qty)||0,location:o.location||'',unit:o.unit||'',notes:o.notes||''})},
 deductions:{cols:['date','category','description','amount','receipt_note'],
  guide:{date:'YYYY-MM-DD',category:'business, work, home, or other',description:'What it was (required)',amount:'Amount, like 12.50',receipt_note:'Where the receipt is saved'},
  map:o=>({id:uid(),date:o.date||'',category:['business','work','home','other'].includes((o.category||'').toLowerCase())?o.category.toLowerCase():'other',desc:o.description,cents:parseCents(o.amount),receipt:o.receipt_note||''})}};
const KEYNAME={bills:'name',stock:'item',deductions:'description'};
function importCSV(state,type,text){const T=TEMPLATES[type];const rows=parseCSV(text);let added=0,bad=[];
  rows.forEach((o,i)=>{if(!o[KEYNAME[type]]){bad.push(i+2);return}const x=T.map(o);if(x.cents!==undefined&&isNaN(x.cents)){bad.push(i+2);return}state[type].push(x);added++});return{added,bad}}
function validBackup(o){if(!o||typeof o!=='object')return false;const b=blank();for(const k of Object.keys(b))if(k!=='version'&&k!=='settings'&&!Array.isArray(o[k]||[]))return false;return true}
function mergeBackup(o){const b=blank();for(const k of Object.keys(b))if(o[k]!==undefined)b[k]=o[k];b.settings=Object.assign(blank().settings,o.settings||{});return b}
function amountFor(b,ym){let c=b.cents||0;(b.changes||[]).slice().sort((x,y)=>x.from<y.from?-1:1).forEach(x=>{if(x.from<=ym)c=x.cents});return c}
function sum(a,f){return a.reduce((s,x)=>s+(f(x)||0),0)}
const EXAMPLE={bills:[{name:'Example Electric',cents:9500,payFrom:'Example Checking',dueType:'varies',lastDue:'',cycleDays:30,autopay:false,category:'Utility'},{name:'Example Rent',cents:120000,payFrom:'Example Checking',dueType:'fixed',dueDay:1,autopay:true,category:'Housing'},{name:'Example Phone',cents:5999,payFrom:'Example Card',dueType:'fixed',dueDay:15,autopay:true,category:'Phone'}],
 stock:[{name:'Example Paper Towels',qty:1,min:2,location:'Example Pantry',unit:'rolls'},{name:'Example Dish Soap',qty:3,min:1,location:'Example Kitchen',unit:'bottles'}],
 preferred:[{name:'Example Brand Detergent',store:'Example Store',notes:'Sample only'}],
 deals:[{app:'Ibotta',item:'Example Cereal rebate',cents:100,expires:'',done:false}],
 deductions:[{date:'',category:'work',desc:'Example Work Supplies',cents:2499,receipt:'Example: photo in Files'}],
 college:[{type:'Books',desc:'Example Textbook',cents:8900,date:''}]};
function addExample(s){const t=todayStr();for(const k of Object.keys(EXAMPLE))EXAMPLE[k].forEach(x=>{const y=Object.assign({id:uid(),example:true},x);if(k==='bills'){y.paid={};if(y.dueType==='varies')y.lastDue=t}if('date'in y&&!y.date)y.date=t;s[k].push(y)})}
function removeExample(s){for(const k of Object.keys(EXAMPLE))s[k]=s[k].filter(x=>!x.example)}
if(typeof module!=='undefined')module.exports={amountFor,parseCents,fmt,perPaycheck,nextDue,dueInMonth,parseCSV,toCSV,importCSV,blank,validBackup,mergeBackup,addExample,removeExample,TEMPLATES};

/* ===== UI ===== */
if(typeof document!=='undefined'){
let S=load();let tab='bills',sub={},calMonth=todayStr().slice(0,7);
function load(){try{const r=localStorage.getItem(KEY);if(r){const o=JSON.parse(r);if(validBackup(o))return mergeBackup(o)}}catch(e){}return blank()}
let idb;try{const rq=indexedDB.open('moneyhub',1);rq.onupgradeneeded=()=>rq.result.createObjectStore('kv');rq.onsuccess=()=>{idb=rq.result;
  if(!localStorage.getItem(KEY)){const g=idb.transaction('kv').objectStore('kv').get(KEY);g.onsuccess=()=>{if(g.result&&validBackup(g.result)){S=mergeBackup(g.result);save();render()}}}}}catch(e){}
function save(){const j=JSON.stringify(S);try{localStorage.setItem(KEY,j)}catch(e){}try{idb&&idb.transaction('kv','readwrite').objectStore('kv').put(JSON.parse(j),KEY)}catch(e){}
  const el=document.getElementById('saved');if(el)el.textContent='Saved on this device '+new Date().toLocaleTimeString()}
if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().then(p=>{S._persist=p});
if('serviceWorker'in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('sw.js').catch(()=>{});
const $=s=>document.querySelector(s);const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TABS=[['bills','Bills'],['cal','Calendar'],['shop','Coupons'],['stock','Stock'],['tax','Taxes'],['college','College'],['settings','Settings']];
function nav(){$('#nav').innerHTML=TABS.map(([k,l])=>`<button data-tab="${k}" class="${k===tab?'on':''}">${l}</button>`).join('')}
function subnav(t,opts){const cur=sub[t]||opts[0][0];sub[t]=cur;return`<div class="sub">${opts.map(([k,l])=>`<button data-sub="${t}:${k}" class="${k===cur?'on':''}">${l}</button>`).join('')}</div>`}
function download(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}
const exBanner=()=>Object.keys(EXAMPLE).some(k=>S[k].some(x=>x.example))?`<div class="banner">Example data is showing. <button class="sec" data-act="rmex">Remove example data</button></div>`:'';
function emptyNote(t){return`<p class="muted">Nothing here yet. ${t}</p>`}
function V(){
 const t=todayStr(),ym=t.slice(0,7);
 if(tab==='bills'){const tot=sum(S.bills,b=>amountFor(b,ym)),pf=S.settings.payFreq;
  return exBanner()+`<div class="card"><h2>Bills and finances</h2><div class="row"><div><div class="muted">Monthly total</div><div class="good" style="font-size:24px">${fmt(tot)}</div></div><div><div class="muted">Set aside per paycheck (${pf})</div><div class="good" style="font-size:24px">${fmt(perPaycheck(tot,pf))}</div></div></div>
  <p class="muted">Paid this month (${ym}): ${S.bills.filter(b=>b.paid&&b.paid[ym]).length} of ${S.bills.length}. Change pay frequency in Settings.</p></div>
  <div class="card"><h3>Your bills</h3>${S.bills.length?S.bills.map(b=>{const nd=nextDue(b,t);const pm=[ym,addM(ym,-1),addM(ym,-2)];const cur=amountFor(b,ym);
   return`<div class="item"><b>${esc(b.name)}</b> ${fmt(cur)} <span class="muted">(${fmt(perPaycheck(cur,pf))} per paycheck)</span><br>${(b.changes||[]).filter(x=>x.from>ym).map(x=>`<span class="warn">Changes to ${fmt(x.cents)} from ${esc(x.from)}</span><br>`).join('')}${b.notes?`<span class="muted">Note: ${esc(b.notes)}</span><br>`:''}
   <span class="muted">${b.payFrom?'From '+esc(b.payFrom)+' | ':''}${b.dueType==='fixed'?'Due day '+esc(b.dueDay):'Varies, every '+esc(b.cycleDays)+' days'}${b.autopay?' | Autopay':''}</span><br>
   Next due: <b>${nd||'add a due date'}</b>${b.dueType==='varies'&&nd?' <span class="warn">(estimate)</span>':''}
   ${pm.map(m=>`<label class="chk"><input type="checkbox" data-paid="${b.id}:${m}" ${b.paid&&b.paid[m]?'checked':''}> Paid for ${m}</label>`).join('')}
   <button class="sec" data-edit="bills:${b.id}">Edit</button><button class="del" data-del="bills:${b.id}">Delete</button></div>`}).join(''):emptyNote('Add a bill below or import a CSV in Settings.')}</div>
  ${billForm(editing.bills)}`}
 if(tab==='cal'){const[y,m]=calMonth.split('-').map(Number);const first=new Date(Date.UTC(y,m-1,1)).getUTCDay();const ev={};
  S.bills.forEach(b=>dueInMonth(b,calMonth).forEach(d=>(ev[d.date]=ev[d.date]||[]).push({b,est:d.est})));
  let cells=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="h">${d}</div>`).join('')+'<div class="h"></div>'.repeat(first).replace(/class="h"/g,'');
  for(let d=1;d<=dim(y,m);d++){const ds=calMonth+'-'+String(d).padStart(2,'0');cells+=`<div class="${ds===t?'today':''}"><b>${d}</b>${(ev[ds]||[]).map(e=>`<div class="ev ${e.est?'est':''} ${e.b.paid&&e.b.paid[calMonth]?'paid':''}">${esc(e.b.name)} ${fmt(amountFor(e.b,calMonth))}</div>`).join('')}</div>`}
  const list=Object.keys(ev).sort().map(d=>ev[d].map(e=>`<div class="item">${d}: <b>${esc(e.b.name)}</b> ${fmt(amountFor(e.b,calMonth))}${e.est?' <span class="warn">estimate</span>':''}${e.b.paid&&e.b.paid[calMonth]?' <span class="good">paid</span>':''}</div>`).join('')).join('');
  return`<div class="card"><h2>Due-date calendar</h2><div class="row"><button class="sec" data-cal="-1">Previous</button><h3 style="text-align:center">${calMonth}</h3><button class="sec" data-cal="1">Next</button></div>
  <div class="cal">${cells}</div><p class="muted">Yellow = estimated from last due date plus cycle days. Gray = marked paid.</p></div><div class="card"><h3>This month's list</h3>${list||emptyNote('Add bills with due dates to fill the calendar.')}</div>`}
 if(tab==='shop')return subnav('shop',[['guide','Step-by-step'],['calc','Money maker'],['deals','Deals'],['pref','Preferred'],['apps','Apps']])+shopView();
 if(tab==='stock'){const low=S.stock.filter(x=>x.qty<=x.min);
  return exBanner()+`<div class="card"><h2>Home stock</h2>${low.length?`<p class="bad">${low.length} item(s) low on stock</p>`:''}${S.stock.length?S.stock.map(x=>`<div class="item"><b>${esc(x.name)}</b> ${x.qty<=x.min?'<span class="bad">LOW</span>':''}<br><span class="muted">${esc(x.location)} | have ${x.qty} ${esc(x.unit||'')}, buy at ${x.min}</span><br>
   <button class="sec" data-qty="${x.id}:-1">- 1</button><button class="sec" data-qty="${x.id}:1">+ 1</button><button class="sec" data-edit="stock:${x.id}">Edit</button><button class="del" data-del="stock:${x.id}">Delete</button></div>`).join(''):emptyNote('Add items below or import a CSV in Settings.')}</div>
  <div class="card"><h3>Shopping list (auto from low stock)</h3>${low.length?'<ul>'+low.map(x=>`<li>${esc(x.name)}: buy ${Math.max(1,x.min-x.qty+1)}</li>`).join('')+'</ul>':emptyNote('Low items show up here.')}</div>${stockForm(editing.stock)}`}
 if(tab==='tax'){const cats=['business','work','home','other'];
  return exBanner()+`<div class="card"><h2>Tax deductions log</h2><table><tr><th>Category</th><th>Total</th></tr>${cats.map(c=>`<tr><td>${c}</td><td>${fmt(sum(S.deductions.filter(d=>d.category===c),d=>d.cents))}</td></tr>`).join('')}<tr><th>All</th><th>${fmt(sum(S.deductions,d=>d.cents))}</th></tr></table>
  <button data-act="taxcsv">Export CSV</button><p class="muted">Tracking only, not tax advice. Rules change every year; confirm what counts with a tax professional.</p></div>
  <div class="card">${S.deductions.length?S.deductions.map(d=>`<div class="item"><b>${esc(d.desc)}</b> ${fmt(d.cents)}<br><span class="muted">${esc(d.date)} | ${esc(d.category)}${d.receipt?' | Receipt: '+esc(d.receipt):''}</span><br><button class="del" data-del="deductions:${d.id}">Delete</button></div>`).join(''):emptyNote('Log a deduction below.')}</div>
  <div class="card"><h3>Add deduction</h3><form data-form="deductions"><label>Date<input type="date" name="date" value="${t}"></label><label>Category<select name="category">${cats.map(c=>`<option>${c}</option>`).join('')}</select></label><label>Description<input name="desc" required></label><label>Amount<input name="amount" inputmode="decimal" required></label><label>Receipt note<input name="receipt" placeholder="Where the receipt is saved"></label><button>Add</button></form></div>`}
 if(tab==='college'){const types=['Tuition','Books','Fees','Exam fees','Loan payments','Other'];
  return exBanner()+`<div class="card"><h2>College costs</h2><table>${types.map(x=>`<tr><td>${x}</td><td>${fmt(sum(S.college.filter(c=>c.type===x),c=>c.cents))}</td></tr>`).join('')}<tr><th>Total</th><th>${fmt(sum(S.college,c=>c.cents))}</th></tr></table></div>
  <div class="card">${S.college.length?S.college.map(c=>`<div class="item"><b>${esc(c.desc)}</b> ${fmt(c.cents)} <span class="muted">${esc(c.type)} ${esc(c.date)}</span> <button class="del" data-del="college:${c.id}">Delete</button></div>`).join(''):emptyNote('Add a cost below.')}</div>
  <div class="card"><h3>Add cost</h3><form data-form="college"><label>Type<select name="type">${types.map(x=>`<option>${x}</option>`).join('')}</select></label><label>Description<input name="desc" required></label><label>Amount<input name="amount" inputmode="decimal" required></label><label>Date<input type="date" name="date" value="${t}"></label><button>Add</button></form></div>
  <div class="card"><h3>Education tax benefits (general info)</h3><ul><li><b>Lifetime Learning Credit:</b> up to 20% of qualified tuition and fees, any year of school, income limits apply.</li><li><b>American Opportunity Tax Credit:</b> first four years of undergrad, at least half-time; tuition, fees and required books count.</li><li><b>Student loan interest deduction:</b> interest paid on qualified student loans, income limits apply.</li><li>You cannot claim both credits for the same student in the same year. Keep Form 1098-T and 1098-E.</li></ul><p class="warn">Limits change yearly. Confirm with a tax pro or irs.gov.</p></div>`}
 if(tab==='settings')return`<div class="card"><h2>Settings</h2><label>Pay frequency<select data-set="payFreq">${Object.keys(PER_YEAR).map(k=>`<option ${S.settings.payFreq===k?'selected':''}>${k}</option>`).join('')}</select></label>
  <p class="muted">Your data saves automatically on this phone after every change. ${S._persist?'Storage is marked persistent.':'Add to Home Screen for the most reliable saving.'} Make a backup now and then.</p></div>
  <div class="card"><h3>Backup</h3><button data-act="export">Download backup (JSON)</button><label>Restore a backup<input type="file" accept=".json,application/json" data-import="json"></label></div>
  <div class="card"><h3>Import from a spreadsheet (CSV)</h3>${Object.keys(TEMPLATES).map(k=>`<h3>${k}</h3><button class="sec" data-tpl="${k}">Download blank ${k} template</button><label>Upload ${k} CSV<input type="file" accept=".csv,text/csv" data-import="${k}"></label><details><summary>Column guide</summary><table>${Object.entries(TEMPLATES[k].guide).map(([c,g])=>`<tr><td><b>${c}</b></td><td>${g}</td></tr>`).join('')}</table></details>`).join('')}</div>
  <div class="card"><h3>Example data</h3><p class="muted">Off by default. Fake sample items, all named "Example".</p><button class="sec" data-act="addex">Load example data</button><button class="sec" data-act="rmex">Remove example data</button></div>
  <div class="card"><h3>Delete all my data</h3><button class="del" data-act="wipe">Delete all my data</button></div>`}
function addM(ym,n){let[y,m]=ym.split('-').map(Number);m+=n;while(m<1){m+=12;y--}while(m>12){m-=12;y++}return y+'-'+String(m).padStart(2,'0')}
const editing={};
function billForm(id){const b=S.bills.find(x=>x.id===id)||{dueType:'fixed'};return`<div class="card"><h3>${id?'Edit bill':'Add a bill'}</h3><form data-form="bills" data-id="${id||''}">
 <label>Bill name<input name="name" required value="${esc(b.name)}"></label><label>Monthly amount<input name="amount" inputmode="decimal" required value="${b.cents!=null?(fmt(b.cents).slice(1)):''}"></label>
 <label>Pay from (account or card)<input name="payFrom" value="${esc(b.payFrom)}"></label>
 <label>Due date rule<select name="dueType"><option value="fixed" ${b.dueType==='fixed'?'selected':''}>Same day every month</option><option value="varies" ${b.dueType==='varies'?'selected':''}>Varies (estimate it)</option></select></label>
 <div class="row"><label>Day of month (fixed)<input name="dueDay" type="number" min="1" max="31" value="${esc(b.dueDay)}"></label><label>Last due date (varies)<input name="lastDue" type="date" value="${esc(b.lastDue)}"></label><label>Days between bills<input name="cycleDays" type="number" min="1" value="${esc(b.cycleDays||'')}"></label></div>
 <label>Notes<input name="notes" value="${esc(b.notes)}"></label><label class="chk"><input type="checkbox" name="autopay" ${b.autopay?'checked':''}> Autopay</label><button>${id?'Save':'Add bill'}</button>${id?'<button type="button" class="sec" data-cancel="bills">Cancel</button>':''}</form></div>`}
function stockForm(id){const x=S.stock.find(s=>s.id===id)||{};return`<div class="card"><h3>${id?'Edit item':'Add stock item'}</h3><form data-form="stock" data-id="${id||''}"><label>Item<input name="name" required value="${esc(x.name)}"></label><div class="row"><label>Have<input name="qty" type="number" min="0" value="${x.qty??''}"></label><label>Buy more at<input name="min" type="number" min="0" value="${x.min??''}"></label></div><label>Location<input name="location" value="${esc(x.location)}"></label><label>Unit<input name="unit" value="${esc(x.unit)}"></label><button>${id?'Save':'Add item'}</button></form></div>`}
const APPS=[['Ibotta','https://ibotta.com','Cash back on groceries and household items; add offers before you shop.'],['Fetch','https://fetch.com','Scan any receipt for points; works on every receipt.'],['Coupons.com','https://www.coupons.com','Printable and digital manufacturer coupons.'],['Checkout 51','https://www.checkout51.com','Weekly cash-back offers, scan receipt.'],['Upside','https://www.upside.com','Cash back on gas, groceries and restaurants.'],['Rakuten','https://www.rakuten.com','Cash back for online shopping.'],['RetailMeNot','https://www.retailmenot.com','Promo codes for online orders.'],['Capital One Shopping','https://capitaloneshopping.com','Finds lower prices and codes online; free, no card needed.'],['Walmart','https://www.walmart.com','Walmart Cash rewards and pickup.'],['CVS','https://www.cvs.com','ExtraCare coupons and ExtraBucks.'],['Kroger','https://www.kroger.com','Digital coupons and fuel points.'],['Target','https://www.target.com','Target Circle deals.'],['Dollar General','https://www.dollargeneral.com','DG digital coupons and $5 off $25 deals.'],['Walgreens','https://www.walgreens.com','myWalgreens cash rewards and clip coupons.'],['Dollar Tree','https://www.dollartree.com','Accepts manufacturer coupons.']];
function shopView(){const s=sub.shop;
 if(s==='guide')return`<div class="card"><h2>Couponing order of operations</h2><ol>
 <li><b>Plan:</b> check the store's weekly ad and your low-stock list.</li><li><b>Clip store digital coupons</b> in the store app (they load to your account or phone number).</li>
 <li><b>Add manufacturer coupons</b> (paper or digital). Most stores let you stack one store coupon plus one manufacturer coupon per item.</li>
 <li><b>Check rebate apps</b> (Ibotta, Fetch, Checkout 51) and add offers <i>before</i> you shop.</li><li><b>Pay with a discounted gift card</b> if you have one, and use store rewards (ExtraBucks, Walmart Cash).</li>
 <li><b>At checkout:</b> scan store loyalty first, then coupons. Watch the receipt for every discount.</li><li><b>After:</b> scan the receipt in each app in this order: apps with item offers first (Ibotta), then any-receipt apps (Fetch, Checkout 51). Some offers expire within days.</li>
 <li><b>Log it:</b> add pending rebates under Deals so you can watch them pay out.</li></ol><p class="muted">Store coupon policies change; check each store's policy page.</p></div>`;
 if(s==='calc')return`<div class="card"><h2>Money maker calculator</h2><form data-form="calc"><label>Shelf price<input name="p" inputmode="decimal"></label><label>Coupons total<input name="c" inputmode="decimal"></label><label>Rebates total<input name="r" inputmode="decimal"></label><label>Store rewards earned<input name="w" inputmode="decimal"></label><button>Calculate</button></form><div id="calcout"></div><p class="muted">Net = price - coupons - rebates - rewards. Below $0.00 means you make money.</p></div>`;
 if(s==='deals'){const g={};S.deals.forEach(d=>(g[d.app]=g[d.app]||[]).push(d));return exBanner()+`<div class="card"><h2>Deals and rebates</h2>${Object.keys(g).length?Object.keys(g).sort().map(a=>`<h3>${esc(a)} <span class="muted">${fmt(sum(g[a].filter(d=>!d.done),d=>d.cents))} pending</span></h3>${g[a].map(d=>`<div class="item"><label class="chk"><input type="checkbox" data-done="${d.id}" ${d.done?'checked':''}> ${esc(d.item)} ${fmt(d.cents)} ${d.expires?'<span class="muted">expires '+esc(d.expires)+'</span>':''}</label><button class="del" data-del="deals:${d.id}">Delete</button></div>`).join('')}`).join(''):emptyNote('Track a rebate below.')}</div>
  <div class="card"><h3>Add deal</h3><form data-form="deals"><label>App or store<input name="app" list="applist" required></label><datalist id="applist">${APPS.map(a=>`<option>${a[0]}</option>`).join('')}</datalist><label>Item or offer<input name="item" required></label><label>Value<input name="amount" inputmode="decimal"></label><label>Expires<input name="expires" type="date"></label><button>Add</button></form></div>`}
 if(s==='pref')return exBanner()+`<div class="card"><h2>Preferred products</h2>${S.preferred.length?S.preferred.map(p=>`<div class="item"><b>${esc(p.name)}</b> <span class="muted">${esc(p.store)} ${esc(p.notes)}</span> <button class="del" data-del="preferred:${p.id}">Delete</button></div>`).join(''):emptyNote('Add your go-to brands below.')}</div><div class="card"><form data-form="preferred"><label>Product<input name="name" required></label><label>Best store<input name="store"></label><label>Notes (size, price to beat)<input name="notes"></label><button>Add</button></form></div>`;
 return`<div class="card"><h2>Apps</h2>${APPS.map(a=>`<div class="item"><a href="${a[1]}" target="_blank" rel="noopener"><b>${a[0]}</b></a><br><span class="muted">${a[2]}</span></div>`).join('')}</div>
 <div class="card"><h3>Recommended setup</h3><ul><li>One item-offer app (Ibotta) plus one any-receipt app (Fetch) covers most groceries.</li><li>Install the store app for every store you shop weekly so digital coupons load automatically.</li><li>Use Rakuten or Capital One Shopping only for online orders.</li><li>Upside for gas if you fill up at participating stations.</li></ul></div>`}
function render(){nav();$('#app').innerHTML=V()}
document.addEventListener('click',e=>{const el=e.target.closest('button,[data-paid],[data-done]');if(!el)return;const d=el.dataset;
 if(d.tab){tab=d.tab;render();scrollTo(0,0);return}if(d.sub){const[t,k]=d.sub.split(':');sub[t]=k;render();return}
 if(d.cal){calMonth=addM(calMonth,+d.cal);render();return}
 if(d.paid){const[id,m]=d.paid.split(':');const b=S.bills.find(x=>x.id===id);b.paid=b.paid||{};b.paid[m]=el.checked;save();render();return}
 if(d.done){const x=S.deals.find(x=>x.id===d.done);x.done=el.checked;save();render();return}
 if(d.del){const[k,id]=d.del.split(':');if(confirm('Delete this?')){S[k]=S[k].filter(x=>x.id!==id);save();render()}return}
 if(d.edit){const[k,id]=d.edit.split(':');editing[k]=id;render();document.querySelector(`form[data-form="${k}"]`).scrollIntoView();return}
 if(d.cancel){editing[d.cancel]=null;render();return}
 if(d.qty){const[id,n]=d.qty.split(':');const x=S.stock.find(s=>s.id===id);x.qty=Math.max(0,x.qty+ +n);save();render();return}
 if(d.tpl){const T=TEMPLATES[d.tpl];download(d.tpl+'-template.csv',T.cols.join(',')+'\r\n','text/csv');return}
 const a=d.act;if(!a)return;
 if(a==='export')download('money-hub-backup-'+todayStr()+'.json',JSON.stringify(Object.assign({},S,{_persist:undefined}),null,2),'application/json');
 if(a==='taxcsv')download('deductions-'+todayStr()+'.csv',toCSV(['date','category','description','amount','receipt_note'],S.deductions.map(x=>({date:x.date,category:x.category,description:x.desc,amount:fmt(x.cents).replace(/[$,]/g,''),receipt_note:x.receipt}))),'text/csv');
 if(a==='addex'){removeExample(S);addExample(S);save();render()}if(a==='rmex'){removeExample(S);save();render()}
 if(a==='wipe'&&confirm('Delete ALL your data on this phone? Download a backup first if you want to keep it.')&&confirm('Are you sure? This cannot be undone.')){S=blank();save();render()}});
document.addEventListener('change',e=>{const el=e.target;if(el.dataset.set){S.settings[el.dataset.set]=el.value;save();render()}
 if(el.dataset.import){const f=el.files[0];if(!f)return;const type=el.dataset.import;f.text().then(txt=>{
  if(type==='json'){let o;try{o=JSON.parse(txt)}catch(_){return alert('That file is not a valid backup.')}if(!validBackup(o))return alert('That file is not a Money Hub backup.');if(confirm('Replace everything on this phone with this backup?')){S=mergeBackup(o);save();render();alert('Backup restored.')}}
  else{const r=importCSV(S,type,txt);save();render();alert(`Added ${r.added} ${type} row(s).`+(r.bad.length?` Skipped rows: ${r.bad.join(', ')} (missing name or bad amount).`:''))}})}});
document.addEventListener('submit',e=>{e.preventDefault();const f=e.target,k=f.dataset.form,v=Object.fromEntries(new FormData(f));
 if(k==='calc'){const n=parseCents(v.p)-parseCents(v.c)-parseCents(v.r)-parseCents(v.w);$('#calcout').innerHTML=isNaN(n)?'<p class="bad">Check the numbers.</p>':`<p style="font-size:22px">Net: <b class="${n<0?'good':''}">${fmt(n)}</b> ${n<0?'<span class="good">Money maker!</span>':n===0?'Free':''}</p>`;return}
 const c=parseCents(v.amount||'0');if(isNaN(c))return alert('Enter the amount like 12.34');
 if(k==='bills'){const o={name:v.name,cents:c,payFrom:v.payFrom,dueType:v.dueType,dueDay:v.dueDay?+v.dueDay:'',lastDue:v.lastDue,cycleDays:v.cycleDays?+v.cycleDays:'',autopay:!!v.autopay,notes:v.notes||''};
  const ex=S.bills.find(x=>x.id===f.dataset.id);if(ex)Object.assign(ex,o);else S.bills.push(Object.assign({id:uid(),paid:{}},o));editing.bills=null}
 if(k==='stock'){const o={name:v.name,qty:parseInt(v.qty)||0,min:parseInt(v.min)||0,location:v.location,unit:v.unit};const ex=S.stock.find(x=>x.id===f.dataset.id);if(ex)Object.assign(ex,o);else S.stock.push(Object.assign({id:uid()},o));editing.stock=null}
 if(k==='deductions')S.deductions.push({id:uid(),date:v.date,category:v.category,desc:v.desc,cents:c,receipt:v.receipt});
 if(k==='college')S.college.push({id:uid(),type:v.type,desc:v.desc,cents:c,date:v.date});
 if(k==='deals')S.deals.push({id:uid(),app:v.app,item:v.item,cents:c,expires:v.expires,done:false});
 if(k==='preferred')S.preferred.push({id:uid(),name:v.name,store:v.store,notes:v.notes});
 save();render()});
render();
}
