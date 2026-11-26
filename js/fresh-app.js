/* AK PACK FITNESS — fresh local-first application
   No login, PIN, Apps Script dependency, or hidden account state.
   Data is stored in this browser on this device. Export backups regularly. */
const DB_KEY='akpf_fresh_v1';
const $=s=>document.querySelector(s);
const $$=s=>Array.from(document.querySelectorAll(s));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const money=n=>'₹'+(Number(n)||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=prefix=>prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7);
const defaults=()=>({version:1,members:[],payments:[],advances:[],handovers:[],trainers:[],ptclients:[],closings:{},settings:{GymName:'AK PACK Fitness',Currency:'INR'},activity:[]});
let db=loadDB(), activeTab='collection';
function loadDB(){try{const v=JSON.parse(localStorage.getItem(DB_KEY));return v&&v.version===1?{...defaults(),...v,settings:{...defaults().settings,...v.settings}}:defaults()}catch{return defaults()}}
function save(){try{localStorage.setItem(DB_KEY,JSON.stringify(db));$('#sync-text').textContent='Saved';$('#sync-dot').className='dot ok';scheduleSync()}catch(e){$('#sync-text').textContent='Storage full';$('#sync-dot').className='dot err';toast('Could not save. Export a backup and free device storage.')}}
function log(action){db.activity.unshift({Action:action,User:'Local device',Timestamp:new Date().toISOString()});db.activity=db.activity.slice(0,100);save()}
function toast(s){const t=$('#toast');t.textContent=s;t.classList.add('show');clearTimeout(window.__toastTimer);window.__toastTimer=setTimeout(()=>t.classList.remove('show'),2600)}
function showModal(html){$('#modal-root').innerHTML='<div class="modal-backdrop" id="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">'+html+'<button class="btn secondary" id="modal-cancel">Cancel</button></div></div>';$('#modal-cancel').onclick=closeModal;$('#modal-backdrop').onclick=e=>{if(e.target.id==='modal-backdrop')closeModal()}}
function closeModal(){$('#modal-root').innerHTML=''}
function sum(a,k){return a.reduce((n,x)=>n+(Number(x[k])||0),0)}
function dayPayments(date=today()){return db.payments.filter(p=>p.Date===date)}
function summary(date=today()){const rows=dayPayments(date),cash=sum(rows,'Cash'),upi=sum(rows,'UPI'),previous=previousClosing(date);return{rows,cash,upi,total:cash+upi,previous,closing:previous+cash}}
function previousClosing(date){const prior=Object.keys(db.closings).filter(d=>d<date).sort().pop();if(prior)return Number(db.closings[prior].Actual)||0;return 0}
function fmt(d){return d?String(d).slice(0,10):'—'}
function recordPayment(data,trainerId){const rec={ID:uid('PAY'),Date:today(),Time:new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}),EnteredBy:'Local',...data};db.payments.push(rec);afterPayment(rec,trainerId);log('Payment recorded');save();renderAll()}
function renderAll(){const s=summary();$('#topbar-title').textContent=db.settings.GymName||'AK PACK Fitness';document.title=(db.settings.GymName||'AK PACK Fitness')+' — Daily Collection';$('#topbar-role').textContent='Local workspace';$('#collection-date').textContent=new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'short',year:'numeric'});$('#stat-clients').textContent=s.rows.length;$('#stat-total').textContent=money(s.total);$('#stat-cash').textContent=money(s.cash);$('#stat-upi').textContent=money(s.upi);$('#stat-prev').textContent=money(s.previous);$('#stat-closing').textContent=money(s.closing);
const close=db.closings[today()];$('#day-status-badge').innerHTML=close?'<span class="badge ok">Day closed</span>':'<span class="badge info">Day open</span>';
$('#today-payments-list').innerHTML=s.rows.length?s.rows.slice().reverse().map(paymentHTML).join(''):'<div class="empty">No payments recorded today. Add the first collection to get started.</div>';
renderDetails();renderMembers();renderAdvances();renderPT();renderHandovers();renderAdmin();$('#sync-text').textContent='Saved';$('#sync-dot').className='dot ok'}
function paymentHTML(p){return '<div class="row" data-id="'+esc(p.ID)+'"><div><div class="row-main">'+esc(p.ClientName)+'</div><div class="row-sub">'+esc(p.Purpose||'')+' · '+esc(p.Method||'')+' · '+esc(p.Time||'')+'</div></div><div class="row-actions"><div class="row-amt">'+money(Number(p.Cash||0)+Number(p.UPI||0))+'</div><button class="btn ghost tiny edit-payment">Edit</button><button class="btn danger tiny delete-payment">Del</button></div></div>'}
function navigate(tab){activeTab=tab;$$('nav.bottomnav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));$$('.tab-view').forEach(v=>v.classList.toggle('active',v.id==='tab-'+tab));if(tab==='details')renderDetails();if(tab==='members')renderMembers();if(tab==='advances')renderAdvances();if(tab==='pt')renderPT();if(tab==='admin')renderAdmin()}
$$('nav.bottomnav button').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.tab)));
function paymentForm(p){const editing=!!p;showModal('<h3>'+(editing?'Edit collection':'Record collection')+'</h3><label>Member / client name</label><input id="pay-name" value="'+esc(p?.ClientName||'')+'" placeholder="Enter name"><label>Membership ID</label><input id="pay-mid" inputmode="numeric" value="'+esc(p?.MembershipID||'')+'" placeholder="Optional numeric ID"><div class="field-row"><div><label>Cash (₹)</label><input id="pay-cash" type="number" min="0" value="'+(p?.Cash??0)+'"></div><div><label>UPI (₹)</label><input id="pay-upi" type="number" min="0" value="'+(p?.UPI??0)+'"></div></div><label>Purpose</label><select id="pay-purpose"><option>Renewal</option><option>New Membership</option><option>Cardio</option><option>Personal Training</option><option>Other</option></select><div id="pay-trainer-wrap" class="hidden"><label>Trainer</label><select id="pay-trainer">'+trainerOptions(p&&(db.ptclients.find(x=>x.PaymentID===p.ID)||{}).TrainerID)+'</select></div><label>Note</label><input id="pay-note" value="'+esc(p?.Note||'')+'" placeholder="Optional note"><button class="btn" id="pay-save">Save collection</button>');if(p)$('#pay-purpose').value=p.Purpose||'Renewal';const syncTr=()=>$('#pay-trainer-wrap').classList.toggle('hidden',$('#pay-purpose').value!=='Personal Training');$('#pay-purpose').onchange=syncTr;syncTr();$('#pay-save').onclick=()=>{const name=$('#pay-name').value.trim(),mid=$('#pay-mid').value.trim(),cash=Number($('#pay-cash').value)||0,upi=Number($('#pay-upi').value)||0;if(!name||cash+upi<=0||cash<0||upi<0){toast('Enter a name and a positive amount.');return}if(mid&&!/^\d+$/.test(mid)){toast('Membership ID must contain digits only.');return}const isPT=$('#pay-purpose').value==='Personal Training',trainerId=isPT?$('#pay-trainer').value:'';if(isPT&&!trainerId){toast('Add a trainer in the PT tab first, then pick one here.');return}if(editing){Object.assign(p,{ClientName:name,MembershipID:mid,Cash:cash,UPI:upi,Method:cash&&upi?'Both':cash?'Cash':'UPI',Purpose:$('#pay-purpose').value,Note:$('#pay-note').value.trim()});afterPayment(p,trainerId);log('Collection edited')}else recordPayment({ClientName:name,MembershipID:mid,Cash:cash,UPI:upi,Method:cash&&upi?'Both':cash?'Cash':'UPI',Purpose:$('#pay-purpose').value,Note:$('#pay-note').value.trim()},trainerId);save();closeModal();renderAll();toast((editing?'Collection updated':'Collection saved on this device')+autoNote)}}
$('#open-add-payment').onclick=()=>paymentForm();
$('#today-payments-list').addEventListener('click',e=>{const row=e.target.closest('[data-id]');if(!row)return;const p=db.payments.find(x=>x.ID===row.dataset.id);if(e.target.closest('.edit-payment'))paymentForm(p);if(e.target.closest('.delete-payment')&&confirm('Delete this collection entry?')){db.payments=db.payments.filter(x=>x.ID!==p.ID);db.ptclients=db.ptclients.filter(x=>x.PaymentID!==p.ID);log('Collection deleted');save();renderAll()}});
$('#open-close-day').onclick=()=>{const s=summary();if(db.closings[today()]){toast('Today is already closed.');return}showModal('<h3>Close daily collection</h3><p class="row-sub">Expected closing cash: <strong>'+money(s.closing)+'</strong></p><label>Actual cash counted (₹)</label><input type="number" id="close-actual" value="'+s.closing+'"><button class="btn" id="close-save">Confirm day close</button>');$('#close-save').onclick=()=>{const amount=Number($('#close-actual').value);if(!Number.isFinite(amount)||amount<0){toast('Enter a valid amount');return}db.closings[today()]={Expected:s.closing,Actual:amount,ClosedAt:new Date().toISOString()};log('Daily collection closed');save();closeModal();renderAll();toast('Day closed and saved locally')}}
function renderDetails(){const date=$('#details-date-filter')?.value||today();if($('#details-date-filter')&&!$('#details-date-filter').value)$('#details-date-filter').value=today();const rows=dayPayments(date),cash=sum(rows,'Cash'),upi=sum(rows,'UPI');$('#details-summary').innerHTML='<div class="stat"><div class="num">'+money(cash+upi)+'</div><div class="label">Total</div></div><div class="stat"><div class="num">'+money(cash)+'</div><div class="label">Cash</div></div><div class="stat"><div class="num">'+money(upi)+'</div><div class="label">UPI</div></div>';$('#details-list').innerHTML=rows.length?rows.slice().reverse().map(paymentHTML).join(''):'<div class="empty">No collection entries for this date.</div>'}
$('#details-date-filter').addEventListener('change',renderDetails);
$('#details-list').addEventListener('click',e=>{const row=e.target.closest('[data-id]');if(!row)return;const p=db.payments.find(x=>x.ID===row.dataset.id);if(e.target.closest('.edit-payment'))paymentForm(p);if(e.target.closest('.delete-payment')&&confirm('Delete this collection entry?')){db.payments=db.payments.filter(x=>x.ID!==p.ID);db.ptclients=db.ptclients.filter(x=>x.PaymentID!==p.ID);log('Collection deleted');save();renderAll()}});
function renderMembers(q=''){const list=$('#members-list');if(!list)return;const rows=db.members.filter(m=>(m.ClientName+' '+m.Mobile+' '+m.MembershipID).toLowerCase().includes(q.toLowerCase()));list.innerHTML=rows.length?rows.map(m=>'<div class="row" data-mid="'+esc(m.MembershipID)+'"><div><div class="row-main">'+esc(m.ClientName)+'</div><div class="row-sub">#'+esc(m.MembershipID)+' · '+esc(m.Mobile||'No phone')+' · Expires '+esc(fmt(m.ExpiryDate))+'</div></div><div class="row-actions"><span class="badge '+(m.ExpiryDate&&m.ExpiryDate<today()?'err':'ok')+'">'+(m.ExpiryDate&&m.ExpiryDate<today()?'Expired':'Active')+'</span><button class="btn ghost tiny edit-member">Edit</button><button class="btn danger tiny delete-member">Del</button></div></div>').join(''):'<div class="empty">No members yet. Add a member to begin building your register.</div>'}
$('#member-search').addEventListener('input',e=>renderMembers(e.target.value));
function memberForm(m){showModal('<h3>'+(m?'Edit member':'Add member')+'</h3><label>Full name</label><input id="mem-name" value="'+esc(m?.ClientName||'')+'"><label>Membership ID (numbers only)</label><input id="mem-id" inputmode="numeric" '+(m?'disabled':'')+' value="'+esc(m?.MembershipID||String(Math.max(0,...db.members.map(x=>Number(x.MembershipID)||0))+1))+'"><label>Mobile</label><input id="mem-mobile" inputmode="tel" value="'+esc(m?.Mobile||'')+'"><label>Expiry date</label><input id="mem-expiry" type="date" value="'+esc(m?.ExpiryDate||'')+'"><button class="btn" id="mem-save">Save member</button>');$('#mem-save').onclick=()=>{const name=$('#mem-name').value.trim(),id=$('#mem-id').value.trim();if(!name||!/^\d+$/.test(id)){toast('Enter a name and numeric membership ID.');return}if(!m&&db.members.some(x=>x.MembershipID===id)){toast('That membership ID already exists.');return}if(m)Object.assign(m,{ClientName:name,Mobile:$('#mem-mobile').value.trim(),ExpiryDate:$('#mem-expiry').value});else db.members.push({MembershipID:id,ClientName:name,Mobile:$('#mem-mobile').value.trim(),ExpiryDate:$('#mem-expiry').value});log(m?'Member updated':'Member added');save();closeModal();renderAll()}}
$('#open-add-member').onclick=()=>memberForm();
$('#members-list').addEventListener('click',e=>{const row=e.target.closest('[data-mid]');if(!row)return;const m=db.members.find(x=>x.MembershipID===row.dataset.mid);if(e.target.closest('.edit-member'))memberForm(m);if(e.target.closest('.delete-member')&&confirm('Delete this member? Payment history will remain.')){db.members=db.members.filter(x=>x!==m);log('Member deleted');save();renderAll()}});
function cycle(){const d=new Date((today()));const day=d.getDate();const start=new Date(d.getFullYear(),d.getMonth()-(day<12?1:0),12);const end=new Date(start.getFullYear(),start.getMonth()+1,11);return{start:start.toLocaleDateString('en-CA'),end:end.toLocaleDateString('en-CA')}}
let cycleOffset=0;
function cycleForOffset(){const t=new Date(today()),d=t.getDate();const base=new Date(t.getFullYear(),t.getMonth()-(d<12?1:0)+cycleOffset,12);return{start:base.toLocaleDateString('en-CA'),end:new Date(base.getFullYear(),base.getMonth()+1,11).toLocaleDateString('en-CA')}}
function renderAdvances(){const c=cycleForOffset();$('#advance-cycle-label').textContent=c.start+' → '+c.end;const rows=db.advances.filter(a=>a.Date>=c.start&&a.Date<=c.end);const totals={};rows.forEach(a=>totals[a.TrainerName]=(totals[a.TrainerName]||0)+Number(a.Amount||0));$('#advance-totals').innerHTML=Object.keys(totals).length?Object.entries(totals).map(([n,v])=>'<div class="row"><div class="row-main">'+esc(n)+'</div><div class="row-amt">'+money(v)+'</div></div>').join(''):'<div class="empty">No advances in this cycle.</div>';$('#advance-entries').innerHTML=rows.length?rows.slice().reverse().map(a=>'<div class="row" data-id="'+esc(a.ID)+'"><div><div class="row-main">'+esc(a.TrainerName)+'</div><div class="row-sub">'+esc(a.Date)+' · '+esc(a.Note||'')+'</div></div><div class="row-actions"><div class="row-amt">'+money(a.Amount)+'</div><button class="btn danger tiny del-advance">Del</button></div></div>').join(''):'<div class="empty">No entries in this cycle.</div>'}
$('#cycle-prev').onclick=()=>{cycleOffset--;renderAdvances()};$('#cycle-next').onclick=()=>{cycleOffset++;renderAdvances()};
$('#open-add-advance').onclick=()=>{showModal('<h3>Record trainer advance</h3><label>Trainer name</label><input id="adv-name" placeholder="Trainer name"><label>Amount (₹)</label><input id="adv-amount" type="number" min="1"><label>Note</label><input id="adv-note"><button class="btn" id="adv-save">Save advance</button>');$('#adv-save').onclick=()=>{const name=$('#adv-name').value.trim(),amount=Number($('#adv-amount').value);if(!name||amount<=0){toast('Enter trainer and positive amount');return}db.advances.push({ID:uid('ADV'),TrainerName:name,Amount:amount,Date:today(),Note:$('#adv-note').value.trim()});log('Trainer advance recorded');save();closeModal();renderAdvances()}}
$('#advance-entries').addEventListener('click',e=>{const row=e.target.closest('[data-id]');if(!row||!e.target.closest('.del-advance'))return;if(confirm('Delete this advance?')){db.advances=db.advances.filter(a=>a.ID!==row.dataset.id);log('Advance deleted');save();renderAdvances()}});
function renderHandovers(){const opening=summary().closing;let balance=opening;const rows=db.handovers.filter(h=>h.Date===today());rows.forEach(h=>balance+=(h.Direction==='IN'?1:-1)*Number(h.Amount));$('#cash-handover-start').textContent=money(opening);$('#cash-handover-balance').textContent=money(balance);$('#cash-handover-list').innerHTML=rows.length?rows.slice().reverse().map(h=>'<div class="row"><div><div class="row-main">'+(h.Direction==='IN'?'Received from ':'Handed to ')+esc(h.PersonName)+'</div><div class="row-sub">'+esc(h.Time)+' · '+esc(h.HandedBy)+' · '+esc(h.Note||'')+'</div></div><div class="row-amt">'+(h.Direction==='IN'?'+':'−')+money(h.Amount)+'</div></div>').join(''):'<div class="empty">No cash movements recorded today.</div>'}
$('#open-cash-handover').onclick=()=>{showModal('<h3>Record cash movement</h3><label>Direction</label><select id="ho-direction"><option value="OUT">Cash handed out</option><option value="IN">Cash received</option></select><label>Person</label><input id="ho-person"><label>Amount (₹)</label><input id="ho-amount" type="number" min="1"><label>Handled by</label><input id="ho-by" value="Reception"><label>Note</label><input id="ho-note"><button class="btn" id="ho-save">Save movement</button>');$('#ho-save').onclick=()=>{const amount=Number($('#ho-amount').value),person=$('#ho-person').value.trim();if(!person||amount<=0){toast('Enter person and valid amount');return}db.handovers.push({ID:uid('HO'),Date:today(),Time:new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}),Direction:$('#ho-direction').value,PersonName:person,Amount:amount,HandedBy:$('#ho-by').value.trim(),Note:$('#ho-note').value.trim()});log('Cash movement recorded');save();closeModal();renderHandovers()}}
function renderAdmin(){if(!$('#setting-gymname'))return;$('#setting-gymname').value=db.settings.GymName||'';$('#settings-list').innerHTML=Object.entries(db.settings).filter(([k])=>k!=='GymName').map(([k,v])=>'<div class="row"><div class="row-main">'+esc(k)+'</div><div class="row-sub">'+esc(v)+'</div></div>').join('')||'<div class="empty">No additional settings.</div>';$('#activity-list').innerHTML=db.activity.slice(0,40).map(a=>'<div class="row"><div><div class="row-main">'+esc(a.Action)+'</div><div class="row-sub">'+esc(a.User)+' · '+new Date(a.Timestamp).toLocaleString('en-IN')+'</div></div></div>').join('')||'<div class="empty">Activity will appear here as you use the app.</div>'}
$('#save-gymname').onclick=()=>{const n=$('#setting-gymname').value.trim();if(!n){toast('Enter a gym name');return}db.settings.GymName=n;log('Gym name updated');save();renderAll();toast('Gym name saved')};
$('#save-setting').onclick=()=>{const k=$('#setting-key').value.trim(),v=$('#setting-value').value.trim();if(!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k)){toast('Enter a valid setting key');return}db.settings[k]=v;log('Setting updated: '+k);save();renderAdmin();$('#setting-key').value='';$('#setting-value').value=''};
$('#export-data').onclick=()=>{const blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='ak-pack-fitness-backup-'+today()+'.json';a.click();URL.revokeObjectURL(url);toast('Backup exported')};
$('#import-data').onclick=()=>$('#import-file').click();
$('#import-file').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const parsed=JSON.parse(await f.text());if(parsed.version!==1||!Array.isArray(parsed.members)||!Array.isArray(parsed.payments))throw Error('Invalid AK PACK backup');if(!confirm('Replace the data currently stored on this device with this backup?'))return;db={...defaults(),...parsed};save();renderAll();toast('Backup restored')}catch(err){toast('Import failed: '+err.message)}finally{e.target.value=''}};
$('#reset-data').onclick=()=>{if(!confirm('This permanently clears all data stored in this browser. Export a backup first. Continue?'))return;db=defaults();try{localStorage.removeItem(SK)}catch(e){}save();renderAll();toast('Local workspace reset')};
$('#activity-list').addEventListener('click',()=>{});
function init(){const root=$('#app-screen');root.classList.remove('hidden');$('#nav-admin')?.classList.remove('hidden');($('#admin-script-url')||{}).textContent='Local-first storage · no external backend connected';$('#topbar-role').textContent='Local workspace';$('#login-screen')?.remove();$('#open-add-payment').textContent='+ Record collection';renderAll();navigate('collection');cloudInit()}
/* ---------- Members auto-add + Personal Training ---------- */
let autoNote='',ptOffset=0;
function ensureMember(name,mid,mobile){
  mid=String(mid||'').trim();name=String(name||'').trim();
  const found=mid?db.members.find(x=>x.MembershipID===mid):db.members.find(x=>String(x.ClientName).trim().toLowerCase()===name.toLowerCase());
  if(found)return{id:found.MembershipID,created:false};
  if(!mid)mid=String(Math.max(0,...db.members.map(x=>Number(x.MembershipID)||0))+1);
  db.members.push({MembershipID:mid,ClientName:name,Mobile:mobile||'',ExpiryDate:''});
  log('Member added automatically');
  return{id:mid,created:true}}
function afterPayment(rec,trainerId){
  autoNote='';
  const r=ensureMember(rec.ClientName,rec.MembershipID,'');
  rec.MembershipID=r.id;if(r.created)autoNote=' · added to Members #'+r.id;
  const i=db.ptclients.findIndex(x=>x.PaymentID===rec.ID);
  if(rec.Purpose==='Personal Training'&&trainerId){
    const base={TrainerID:trainerId,ClientName:rec.ClientName,MembershipID:rec.MembershipID,Fee:(Number(rec.Cash)||0)+(Number(rec.UPI)||0),StartDate:rec.Date,Note:rec.Note||'',PaymentID:rec.ID};
    if(i>=0)Object.assign(db.ptclients[i],base);else{db.ptclients.push({ID:uid('PT'),Mobile:'',...base});autoNote+=' · added to PT'}
  }else if(i>=0)db.ptclients.splice(i,1)}
function trainerOptions(sel){return db.trainers.length?db.trainers.map(t=>'<option value="'+esc(t.ID)+'"'+(t.ID===sel?' selected':'')+'>'+esc(t.Name)+'</option>').join(''):'<option value="">No trainers yet</option>'}
const pad2=n=>String(n).padStart(2,'0');
const ymd=(y,m,d)=>{const x=new Date(y,m,d);return x.getFullYear()+'-'+pad2(x.getMonth()+1)+'-'+pad2(x.getDate())};
const dmy=d=>new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
/* PT cycle: 15th of a month to the 14th of the next month (inclusive) */
function ptRange(off,ref){const t=(ref||today()).split('-').map(Number),b=(t[2]>=15?t[1]-1:t[1]-2)+(off||0);return{start:ymd(t[0],b,15),end:ymd(t[0],b+1,14)}}
function renderPT(){
  const list=$('#pt-list');if(!list)return;
  const r=ptRange(ptOffset);
  $('#pt-cycle-label').textContent=dmy(r.start)+' → '+dmy(r.end);
  $('#pt-cycle-badge').innerHTML=ptOffset===0?'<span class="badge info">Current</span>':'';
  const sel=$('#pt-trainer-filter'),keep=sel.value;
  sel.innerHTML='<option value="">All trainers</option>'+db.trainers.map(t=>'<option value="'+esc(t.ID)+'">'+esc(t.Name)+'</option>').join('');
  sel.value=db.trainers.some(t=>t.ID===keep)?keep:'';
  const f=sel.value,rows=db.ptclients.filter(c=>c.StartDate>=r.start&&c.StartDate<=r.end&&(!f||c.TrainerID===f));
  $('#pt-summary').innerHTML='<div class="stat"><div class="num">'+db.trainers.length+'</div><div class="label">Trainers</div></div><div class="stat"><div class="num">'+rows.length+'</div><div class="label">PT clients this cycle</div></div><div class="stat dark wide"><div class="num">'+money(sum(rows,'Fee'))+'</div><div class="label">PT fees this cycle</div></div>';
  const tr=db.trainers.filter(t=>!f||t.ID===f);
  list.innerHTML=tr.length?tr.map(t=>{const cs=rows.filter(c=>c.TrainerID===t.ID);
    return '<div class="card" data-tid="'+esc(t.ID)+'"><div class="section-head"><div><h2>'+esc(t.Name)+'</h2><div class="row-sub">'+esc(t.Mobile||'No phone')+' · '+cs.length+' client'+(cs.length===1?'':'s')+' · '+money(sum(cs,'Fee'))+'</div></div><div class="row-actions"><button class="btn ghost tiny edit-trainer">Edit</button><button class="btn danger tiny del-trainer">Del</button></div></div>'+
    (cs.length?cs.map(c=>'<div class="row" data-cid="'+esc(c.ID)+'"><div><div class="row-main">'+esc(c.ClientName)+'</div><div class="row-sub">'+(c.MembershipID?'#'+esc(c.MembershipID)+' · ':'')+esc(c.Mobile||'No phone')+' · Joined '+esc(dmy(c.StartDate))+'</div></div><div class="row-actions"><div class="row-amt">'+money(c.Fee)+'</div><button class="btn ghost tiny edit-pt">Edit</button><button class="btn danger tiny del-pt">Del</button></div></div>').join(''):'<div class="empty">No PT clients in this cycle.</div>')+'</div>'}).join(''):'<div class="card"><div class="empty">No trainers yet. Tap “Add trainer” to begin.</div></div>'}
function trainerForm(t){
  showModal('<h3>'+(t?'Edit trainer':'Add trainer')+'</h3><label>Trainer name</label><input id="tr-name" value="'+esc(t?.Name||'')+'" placeholder="Trainer name"><label>Mobile</label><input id="tr-mobile" inputmode="tel" value="'+esc(t?.Mobile||'')+'" placeholder="Optional"><button class="btn" id="tr-save">Save trainer</button>');
  $('#tr-save').onclick=()=>{const name=$('#tr-name').value.trim(),mobile=$('#tr-mobile').value.trim();
    if(!name){toast('Enter the trainer name');return}
    if(db.trainers.some(x=>x!==t&&x.Name.trim().toLowerCase()===name.toLowerCase())){toast('That trainer already exists');return}
    if(t)Object.assign(t,{Name:name,Mobile:mobile});else db.trainers.push({ID:uid('TR'),Name:name,Mobile:mobile});
    log(t?'Trainer updated':'Trainer added');save();closeModal();renderAll()}}
function ptClientForm(c){
  if(!db.trainers.length){toast('Add a trainer first');return}
  const f=$('#pt-trainer-filter').value;
  showModal('<h3>'+(c?'Edit PT client':'Add PT client')+'</h3><label>Trainer</label><select id="pc-trainer">'+trainerOptions(c?.TrainerID||f)+'</select><label>Client name</label><input id="pc-name" value="'+esc(c?.ClientName||'')+'" placeholder="Client name"><label>Membership ID</label><input id="pc-mid" inputmode="numeric" value="'+esc(c?.MembershipID||'')+'" placeholder="Optional numeric ID"><label>Mobile</label><input id="pc-mobile" inputmode="tel" value="'+esc(c?.Mobile||'')+'" placeholder="Optional"><div class="field-row"><div><label>PT fee (₹)</label><input id="pc-fee" type="number" min="0" value="'+(c?.Fee??0)+'"></div><div><label>Start date</label><input id="pc-date" type="date" value="'+esc(c?.StartDate||today())+'"></div></div><label>Note</label><input id="pc-note" value="'+esc(c?.Note||'')+'" placeholder="Optional note"><button class="btn" id="pc-save">Save PT client</button>');
  $('#pc-save').onclick=()=>{const name=$('#pc-name').value.trim(),mid=$('#pc-mid').value.trim(),fee=Number($('#pc-fee').value)||0,date=$('#pc-date').value,tid=$('#pc-trainer').value;
    if(!tid||!name||!date||fee<0){toast('Enter trainer, client name and start date');return}
    if(mid&&!/^\d+$/.test(mid)){toast('Membership ID must contain digits only.');return}
    const m=ensureMember(name,mid,$('#pc-mobile').value.trim());
    const data={TrainerID:tid,ClientName:name,MembershipID:m.id,Mobile:$('#pc-mobile').value.trim(),Fee:fee,StartDate:date,Note:$('#pc-note').value.trim()};
    if(c)Object.assign(c,data);else db.ptclients.push({ID:uid('PT'),PaymentID:'',...data});
    log(c?'PT client updated':'PT client added');save();closeModal();renderAll();toast(m.created?'Saved · added to Members #'+m.id:'PT client saved')}}
$('#open-add-trainer').onclick=()=>trainerForm();
$('#open-add-pt').onclick=()=>ptClientForm();
$('#pt-prev').onclick=()=>{ptOffset--;renderPT()};$('#pt-next').onclick=()=>{ptOffset++;renderPT()};
$('#pt-trainer-filter').addEventListener('change',renderPT);
$('#pt-list').addEventListener('click',e=>{
  const card=e.target.closest('[data-tid]');if(!card)return;const t=db.trainers.find(x=>x.ID===card.dataset.tid),row=e.target.closest('[data-cid]');
  if(row){const c=db.ptclients.find(x=>x.ID===row.dataset.cid);
    if(e.target.closest('.edit-pt'))ptClientForm(c);
    if(e.target.closest('.del-pt')&&confirm('Remove this PT client entry? The collection entry stays.')){db.ptclients=db.ptclients.filter(x=>x!==c);log('PT client removed');save();renderAll()}return}
  if(e.target.closest('.edit-trainer'))trainerForm(t);
  if(e.target.closest('.del-trainer')){if(db.ptclients.some(x=>x.TrainerID===t.ID)){toast('Remove this trainer’s PT clients first');return}
    if(confirm('Delete trainer '+t.Name+'?')){db.trainers=db.trainers.filter(x=>x!==t);log('Trainer deleted');save();renderAll()}}});

/* ---------- Optional cloud sync (Google Apps Script + Google Sheets) ----------
   Local data always works offline. When connected, changes are diffed against the last
   synced snapshot and pushed to the Apps Script backend; the server state is pulled back. */
var CK='akpf_cloud_v1',SK='akpf_cloud_snap_v1',cloud=loadCloud(),syncTimer=null,syncBusy=false,syncAgain=false;
function loadCloud(){try{return JSON.parse(localStorage.getItem(CK))||{}}catch(e){return{}}}
function storeCloud(){try{localStorage.setItem(CK,JSON.stringify(cloud))}catch(e){}}
function cloudOn(){return!!(cloud.url&&cloud.key)}
function loadSnap(){try{return JSON.parse(localStorage.getItem(SK))||{}}catch(e){return{}}}
function storeSnap(m){try{localStorage.setItem(SK,JSON.stringify(m))}catch(e){}}
function setSync(text,kind){var t=$('#sync-text'),d=$('#sync-dot');if(t)t.textContent=text;if(d)d.className='dot '+kind}
function tableMaps(d){
  var m={payments:{},members:{},advances:{},handovers:{},trainers:{},ptclients:{},closings:{},settings:{},activity:{}};
  (d.payments||[]).forEach(function(r){m.payments[r.ID]=JSON.stringify(r)});
  (d.members||[]).forEach(function(r){if(r.MembershipID)m.members[r.MembershipID]=JSON.stringify(r)});
  (d.advances||[]).forEach(function(r){m.advances[r.ID]=JSON.stringify(r)});
  (d.handovers||[]).forEach(function(r){m.handovers[r.ID]=JSON.stringify(r)});(d.trainers||[]).forEach(function(r){m.trainers[r.ID]=JSON.stringify(r)});(d.ptclients||[]).forEach(function(r){m.ptclients[r.ID]=JSON.stringify(r)});
  Object.keys(d.closings||{}).forEach(function(k){m.closings[k]=JSON.stringify(Object.assign({Date:k},d.closings[k]))});
  Object.keys(d.settings||{}).forEach(function(k){m.settings[k]=JSON.stringify({Key:k,Value:String(d.settings[k])})});
  (d.activity||[]).forEach(function(a){m.activity[a.Timestamp+'|'+a.Action]=JSON.stringify(a)});
  return m}
function diffOps(cur,snap){var ops=[];Object.keys(cur).forEach(function(t){var c=cur[t],o=snap[t]||{};Object.keys(c).forEach(function(id){if(o[id]!==c[id])ops.push({op:'put',t:t,id:id,rec:JSON.parse(c[id])})});if(t!=='activity')Object.keys(o).forEach(function(id){if(!(id in c))ops.push({op:'del',t:t,id:id})})});return ops}
async function cloudPost(body){var ac=new AbortController(),to=setTimeout(function(){ac.abort()},25000);try{var r=await fetch(cloud.url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(Object.assign({key:cloud.key},body)),signal:ac.signal});if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(to)}}
function scheduleSync(){if(!cloudOn())return;setSync('Pending','wn');clearTimeout(syncTimer);syncTimer=setTimeout(function(){cloudSync()},1500)}
function applyRemote(d){db.payments=d.payments||[];db.members=d.members||[];db.advances=d.advances||[];db.handovers=d.handovers||[];if(d.trainers)db.trainers=d.trainers;if(d.ptclients)db.ptclients=d.ptclients;db.closings=d.closings||{};db.settings=Object.assign({},defaults().settings,d.settings||{});db.activity=d.activity||[];try{localStorage.setItem(DB_KEY,JSON.stringify(db))}catch(e){}storeSnap(tableMaps(db));renderAll()}
async function cloudSync(manual){
  if(!cloudOn())return;
  if(syncBusy){syncAgain=true;return}
  if(!navigator.onLine){setSync('Offline','err');if(manual)toast('Offline — changes are kept on this device');return}
  syncBusy=true;setSync('Syncing…','wn');
  try{
    var cur=tableMaps(db),ops=diffOps(cur,loadSnap());
    var dels=ops.filter(function(o){return o.op==='del'}).length;
    if(dels>25&&!confirm('This will delete '+dels+' records from Google Sheets. Continue?')){setSync('Paused','err');return}
    var res=await cloudPost({action:'sync',ops:ops});
    if(!res||!res.ok)throw Error((res&&res.error)||'Bad response');
    if(JSON.stringify(tableMaps(db))!==JSON.stringify(cur)){storeSnap(cur);syncAgain=true}
    else applyRemote(res.data);
    cloud.last=Date.now();storeCloud();setSync('Synced','ok');cloudStatus();
  }catch(e){setSync('Sync failed','err');if(manual)toast('Sync failed: '+(e.name==='AbortError'?'timed out':e.message))}
  finally{syncBusy=false;if(syncAgain){syncAgain=false;scheduleSync()}}
}
function cloudStatus(){
  var el=$('#cloud-status'),p=$('#sync-pill'),r=$('#topbar-role');
  if(p)p.title=cloudOn()?'Tap to sync with Google Sheets':'Changes are saved in this browser only';
  if(r)r.textContent=cloudOn()?'Google Sheets sync':'Local workspace';
  if(el)el.textContent=cloudOn()?('Connected to Google Sheets'+(cloud.last?' · last sync '+new Date(cloud.last).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'')):'Not connected. Data stays on this device.'}
async function cloudConnect(){
  var url=$('#cloud-url').value.trim(),key=$('#cloud-key').value.trim();
  if(!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)){toast('Enter the full Apps Script web app URL');return}
  if(key.length<12){toast('Enter the access key from setup()');return}
  var old={url:cloud.url,key:cloud.key};cloud.url=url;cloud.key=key;setSync('Connecting…','wn');
  try{var r=await cloudPost({action:'ping'});if(!r||!r.ok)throw Error((r&&r.error)||'Rejected');storeCloud();cloudStatus();toast('Connected to Google Sheets');cloudSync(true)}
  catch(e){cloud.url=old.url;cloud.key=old.key;setSync(cloudOn()?'Synced':'Saved','ok');toast('Could not connect: '+e.message)}
}
function cloudDisconnect(){
  if(!cloudOn()){toast('Not connected');return}
  if(!confirm('Disconnect from Google Sheets? Data stays on this device and in the sheet.'))return;
  cloud={};storeCloud();try{localStorage.removeItem(SK)}catch(e){}$('#cloud-key').value='';$('#cloud-url').value='';setSync('Saved','ok');cloudStatus();toast('Disconnected')}
function cloudInit(){
  var u=$('#cloud-url'),k=$('#cloud-key');if(u)u.value=cloud.url||'';if(k)k.value=cloud.key||'';
  $('#sync-pill').onclick=function(){cloudOn()?cloudSync(true):toast('Local only. Add your Apps Script URL in Admin → Cloud sync.')};
  $('#cloud-save').onclick=cloudConnect;$('#cloud-off').onclick=cloudDisconnect;
  $('#cloud-sync').onclick=function(){cloudOn()?cloudSync(true):toast('Connect first')};
  window.addEventListener('online',function(){cloudSync()});
  window.addEventListener('offline',function(){if(cloudOn())setSync('Offline','err')});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)cloudSync()});
  setInterval(function(){if(!document.hidden)cloudSync()},60000);
  cloudStatus();if(cloudOn())cloudSync();
}
init();