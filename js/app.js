/* =========================================================================
   AK PACK FITNESS — FRONTEND v2
   Modular, framework-free, mobile-first. Talks to a Google Apps Script
   web app (Code.gs) which uses a Google Sheet as the database.
   Set SCRIPT_URL below after deploying the Apps Script as a Web App.
   ========================================================================= */

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwB5uQTsgBK_dePnrCJDRMXOWbBkOde4jOvERc2vjxnkRx_5VtcpQw-QLwlyergvqEQTg/exec";

const LS_KEYS = { AUTH: 'akpf_auth', QUEUE: 'akpf_queue', CACHE: 'akpf_cache' };
const BUSINESS_TIME_ZONE = 'Asia/Kolkata';
let lastSuccessfulSyncAt = null;
let detailsRequestSequence = 0;
let advancesRequestSequence = 0;
let enterAppSequence = 0;
let storageAccount = null;
let modalPreviousFocus = null;
let modalKeydownHandler = null;

let state = {
  auth: null,
  bootstrap: null,
  online: navigator.onLine,
  syncing: false,
  advances: null,
  advanceViewDate: null,   // any date inside the cycle currently being viewed
  detailsDate: null,
  cashHandovers: [],
  cashHandoverBalance: null,
  cashHandoverOpening: null
};

// ---------------- storage helpers ----------------
function scopedStorageKey(base, username = state.auth && state.auth.username){
  const account = String(username || (state.auth && state.auth.username) || storageAccount || 'anonymous').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '_');
  return base + ':' + account;
}
function safeStorageGet(key){ try { return localStorage.getItem(key); } catch(e){ return null; } }
function safeStorageSet(key, value){
  try { localStorage.setItem(key, value); return true; }
  catch(e){ toast('Local storage is unavailable or full. Pending changes may not be saved on this device.'); return false; }
}
function saveAuth(a){ state.auth = a; storageAccount = a && a.username || storageAccount; safeStorageSet(LS_KEYS.AUTH, JSON.stringify(a)); }
function loadAuth(){ try { return JSON.parse(safeStorageGet(LS_KEYS.AUTH)); } catch(e){ return null; } }
function clearAuth(){ if (state.auth && state.auth.username) storageAccount = state.auth.username; state.auth = null; try { localStorage.removeItem(LS_KEYS.AUTH); } catch(e) {} }
function showLoginForExpiredSession(message){
  closeModal();
  clearAuth(); state.bootstrap = null; state.advances = null; state.detailsRows = null;
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('nav-admin').classList.add('hidden');
  toast(message || 'Your session has expired. Sign in again; pending operations have been preserved.');
}

function getQueue(){
  const key = scopedStorageKey(LS_KEYS.QUEUE);
  const scoped = safeStorageGet(key);
  if (scoped !== null){ try { const q = JSON.parse(scoped); return Array.isArray(q) ? q : []; } catch(e){ return []; } }
  // Safely migrate only legacy queued operations whose stored username matches
  // the currently authenticated account. Never import ambiguous cross-account data.
  const owner = state.auth && state.auth.username || storageAccount;
  const legacyRaw = safeStorageGet(LS_KEYS.QUEUE);
  if (!owner || !legacyRaw) return [];
  try{
    const legacy = JSON.parse(legacyRaw);
    if (!Array.isArray(legacy)) return [];
    const mine = legacy.filter(item=>String(item && item.username || '').toLowerCase() === String(owner).toLowerCase());
    if (mine.length && safeStorageSet(key, JSON.stringify(mine))){
      const remaining = legacy.filter(item=>!mine.includes(item));
      safeStorageSet(LS_KEYS.QUEUE, JSON.stringify(remaining));
    }
    return mine;
  } catch(e){ return []; }
}
function setQueue(q){ return safeStorageSet(scopedStorageKey(LS_KEYS.QUEUE), JSON.stringify(q)); }
function pushQueue(item){ const q = getQueue(); q.push(item); if (!setQueue(q)) throw new Error('Could not safely store this operation for later synchronization.'); updateSyncPill(); }

function saveCache(data){ state.bootstrap = data; safeStorageSet(scopedStorageKey(LS_KEYS.CACHE), JSON.stringify(data)); }
function loadCache(){ try { return JSON.parse(safeStorageGet(scopedStorageKey(LS_KEYS.CACHE))); } catch(e){ return null; } }

// ---------------- API ----------------
async function apiCall(action, params, {queueOnFail=false} = {}){
  // params is merged first, then action/username/token are applied last so a
  // form field (e.g. a new trainer's own "username") can never overwrite
  // the logged-in user's own credentials.
  const payload = Object.assign({}, params, {
    action,
    username: state.auth ? state.auth.username : undefined,
    token: state.auth ? state.auth.token : undefined
  });
  if (!navigator.onLine){
    if (queueOnFail){ pushQueue(payload); return { ok:true, queued:true }; }
    throw new Error('offline');
  }
  let res;
  try{
    res = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight on Apps Script
      body: JSON.stringify(payload)
    });
  } catch(err){
    // Only queue when the browser already knows it is offline. A failed response
    // while still online can mean the server saved the record but its reply was lost.
    if (queueOnFail && !navigator.onLine){ pushQueue(payload); return { ok:true, queued:true }; }
    if (queueOnFail) throw new Error('Could not confirm the server result. Check the records before retrying to avoid a duplicate.');
    throw err;
  }
  let json;
  try { json = await res.json(); }
  catch(err){ throw new Error('The server response could not be read. The operation may need verification before retrying.'); }
  if (!res.ok || !json || json.ok !== true){
    const message = (json && json.error) || 'Request failed';
    if (/unauthori[sz]ed|invalid token|session expired|authentication required|not logged in/i.test(message)){
      showLoginForExpiredSession('Your session may have expired. Sign in again; pending operations have been preserved.');
    }
    throw new Error(message);
  }
  return json;
}

async function flushQueue(){
  if (state.syncing) return;
  const queue = getQueue();
  if (!queue.length || !navigator.onLine) { updateSyncPill(); return; }
  state.syncing = true; updateSyncPill();
  const remaining = [];
  for (let i=0; i<queue.length; i++){
    const item = queue[i];
    if (item._syncError){ remaining.push(item); continue; }
    try{
      const queuedPayload = Object.assign({}, item, { username: state.auth && state.auth.username || item.username, token: state.auth && state.auth.token || item.token });
      const res = await fetch(SCRIPT_URL, {
        method:'POST',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body: JSON.stringify(queuedPayload)
      });
      const json = await res.json();
      if (!res.ok || !json || json.ok !== true){
        // Keep rejected operations visible for manual recovery; never discard them silently.
        remaining.push(Object.assign({}, item, { _syncError: (json && json.error) || 'Server rejected operation' }));
      }
    } catch(e){
      // A response can be lost after a successful server write. Pause this item
      // for manual review instead of retrying it automatically and risking a duplicate.
      remaining.push(Object.assign({}, item, { _syncError: 'Outcome unknown; verify the record before retrying.' }), ...queue.slice(i+1));
      setQueue(remaining);
      state.syncing = false; updateSyncPill();
      return;
    }
  }
  setQueue(remaining);
  state.syncing = false;
  if (remaining.length === 0){ lastSuccessfulSyncAt = new Date(); await refreshBootstrap(); }
  updateSyncPill();
}

function updateSyncPill(){
  const dot = document.getElementById('sync-dot');
  const text = document.getElementById('sync-text');
  if (!dot || !text) return;
  const q = getQueue();
  if (!navigator.onLine){
    dot.className = 'dot err'; text.textContent = 'Offline · ' + q.length + ' pending';
  } else if (state.syncing){
    dot.className = 'dot warn'; text.textContent = 'Syncing…';
  } else if (q.length){
    const rejected = q.filter(item=>item._syncError).length;
    dot.className = 'dot warn'; text.textContent = rejected ? rejected + ' failed · ' + q.length + ' pending' : q.length + ' pending';
  } else if (lastSuccessfulSyncAt){
    dot.className = 'dot ok'; text.textContent = 'Synced · ' + lastSuccessfulSyncAt.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
  } else {
    dot.className = 'dot warn'; text.textContent = 'Connected';
  }
}

window.addEventListener('online', () => { state.online = true; updateSyncPill(); flushQueue(); });
window.addEventListener('offline', () => { state.online = false; updateSyncPill(); });
document.getElementById('sync-pill').addEventListener('click', ()=>{
  const queue = getQueue();
  if (!queue.length){ toast(lastSuccessfulSyncAt ? 'Last successful sync: ' + lastSuccessfulSyncAt.toLocaleString('en-IN') : 'No pending operations.'); return; }
  const rows = queue.map((item,i)=>`<div class="row"><div><div class="row-main">${escapeHtml(item.action || 'Pending operation')}</div><div class="row-sub">${item._syncError ? 'Failed: ' + escapeHtml(item._syncError) : 'Waiting to sync'} · #${i+1}</div></div></div>`).join('');
  showModal(`<h3>Sync queue</h3><p class="row-sub">${queue.length} operation(s) are waiting. Failed operations are kept for review. If a response was lost, verify the record before retrying to avoid duplicates.</p><div>${rows}</div><button class="btn" id="retry-queue">Retry failed operations</button>`);
  document.getElementById('retry-queue').addEventListener('click', async (event)=>{
    const btn = event.currentTarget; if (btn.disabled) return;
    const currentQueue = getQueue();
    const hasUnknownOutcome = currentQueue.some(item=>/Outcome unknown|Could not confirm|response could not be read/i.test(item._syncError || ''));
    if (hasUnknownOutcome && !confirm('At least one operation may already have been saved by the server. Retrying without checking the records could create a duplicate. Have you verified the records and still want to retry?')) return;
    btn.disabled = true; btn.textContent = 'Retrying…';
    const retryable = currentQueue.map(item=>{ const copy = Object.assign({},item); delete copy._syncError; return copy; });
    if (!setQueue(retryable)){ toast('Could not update the local sync queue.'); btn.disabled = false; btn.textContent = 'Retry failed operations'; return; }
    closeModal(); await flushQueue(); updateSyncPill();
  });
});

// ---------------- toast ----------------
let toastTimer;
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2600);
}

// ---------------- money / date fmt ----------------
function money(n){ n = Number(n)||0; return '₹' + n.toLocaleString('en-IN'); }
function todayISO(){
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
  const part = Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${part.year}-${part.month}-${part.day}`;
}
function hasValue(obj, key){ return Object.prototype.hasOwnProperty.call(obj || {}, key) && obj[key] !== null && obj[key] !== undefined && obj[key] !== ''; }
function isValidAmount(value, {allowZero=true}={}){ return Number.isFinite(value) && (allowZero ? value >= 0 : value > 0); }
function dateOnlyInBusinessZone(value){
  if (!value) return '';
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:BUSINESS_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
  const p = Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function isExpiredDate(value){ const date = dateOnlyInBusinessZone(value); return !!date && date < todayISO(); }
function fmt(d){ if(!d) return '—'; const s = String(d); return s.length>10 ? s.slice(0,10) : s; }
function fmtDateTime(d){
  if(!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-IN') + ' ' + dt.toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'});
}
// Mirrors the 12th-to-11th cycle logic in Code.gs, for client-side navigation.
function advanceCycleFor(dateStr){
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr||'')) ? new Date(Number(dateStr.slice(0,4)), Number(dateStr.slice(5,7))-1, Number(dateStr.slice(8,10))) : new Date(dateStr);
  if (Number.isNaN(d.getTime())) return { start: todayISO(), end: todayISO() };
  const year = d.getFullYear(), month = d.getMonth(), day = d.getDate();
  let start, end;
  if (day >= 12){ start = new Date(year, month, 12); end = new Date(year, month+1, 11); }
  else { start = new Date(year, month-1, 12); end = new Date(year, month, 11); }
  return { start: isoDate(start), end: isoDate(end) };
}
function isoDate(d){ return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10); }

// ================= LOGIN =================
document.getElementById('login-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const pin = document.getElementById('login-pin').value.trim();
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  errEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Signing in…';
  try{
    const res = await fetch(SCRIPT_URL, {
      method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
      body: JSON.stringify({ action:'login', username, pin })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Login failed');
    saveAuth(json.data);
    await enterApp();
  } catch(err){
    errEl.textContent = err.message === 'Failed to fetch'
      ? 'Could not reach the server. Check your connection.'
      : err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Sign in';
  }
});

document.getElementById('logout-btn').addEventListener('click', ()=>{
  clearAuth();
  state.bootstrap = null; state.advances = null; state.detailsRows = null;
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('nav-admin').classList.add('hidden');
  document.querySelectorAll('nav.bottomnav button').forEach(b=>b.classList.toggle('active', b.dataset.tab==='collection'));
  document.querySelectorAll('.tab-view').forEach(v=>v.classList.toggle('active', v.id==='tab-collection'));
});

// ================= APP BOOTSTRAP =================
async function enterApp(){
  const session = ++enterAppSequence;
  if (!state.auth) return;
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  document.getElementById('topbar-role').textContent = (state.auth.name || state.auth.username) + ' · ' + state.auth.role;
  document.getElementById('admin-script-url').textContent = SCRIPT_URL;
  document.getElementById('nav-admin').classList.toggle('hidden', state.auth.role !== 'Admin');

  // Cache keys are account-scoped; never render a previous user's cached data.
  state.bootstrap = null; state.advances = null;
  const cached = loadCache();
  if (cached && session === enterAppSequence) { state.bootstrap = cached; renderAll(); }

  await refreshBootstrap();
  if (session !== enterAppSequence || !state.auth) return;
  await flushQueue();
  updateSyncPill();

  state.advanceViewDate = todayISO();
  await loadAdvances();
}

async function refreshBootstrap(){
  const requestUsername = state.auth && state.auth.username;
  const requestToken = state.auth && state.auth.token;
  try{
    const json = await apiCall('bootstrap', {});
    if (!state.auth || state.auth.username !== requestUsername || state.auth.token !== requestToken) return;
    if (!json.data || typeof json.data !== 'object' || !Array.isArray(json.data.members) || !Array.isArray(json.data.todayDetails)) throw new Error('The server returned incomplete collection data.');
    saveCache(json.data);
    lastSuccessfulSyncAt = new Date();
    renderAll();
    updateSyncPill();
  } catch(e){
    if (!state.bootstrap) toast('Could not load current data. ' + e.message);
  }
}

function renderAll(){
  if (!state.bootstrap) return;
  applyBranding();
  renderCollectionTab();
  loadCashHandovers();
  renderDetailsTab();
  renderMembersTab();
  if (state.auth.role === 'Admin') renderAdminTab();
}

function applyBranding(){
  const name = (state.bootstrap.settings && state.bootstrap.settings.GymName) || 'AK Pack Fitness';
  document.getElementById('topbar-title').textContent = name;
  document.getElementById('login-brand-name').textContent = name;
  document.title = name;
}

// ================= NAV =================
document.querySelectorAll('nav.bottomnav button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('nav.bottomnav button').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab-view').forEach(v=>v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ================= COLLECTION TAB =================
function renderCollectionTab(){
  const b = state.bootstrap;
  document.getElementById('collection-date').textContent = b.today;
  const s = b.todaySummary || {};
  document.getElementById('stat-clients').textContent = hasValue(s,'TotalClients') ? Number(s.TotalClients) : (b.todayDetails||[]).length;
  document.getElementById('stat-total').textContent = money(hasValue(s,'TotalCollection') ? s.TotalCollection : sumField(b.todayDetails,'Cash')+sumField(b.todayDetails,'UPI'));
  document.getElementById('stat-cash').textContent = money(hasValue(s,'TotalCash') ? s.TotalCash : sumField(b.todayDetails,'Cash'));
  document.getElementById('stat-upi').textContent = money(hasValue(s,'TotalUPI') ? s.TotalUPI : sumField(b.todayDetails,'UPI'));
  document.getElementById('stat-prev').textContent = money(s.PreviousDayCash !== undefined ? s.PreviousDayCash : b.previousDayCash);
  const closing = s.ClosingCash !== undefined ? s.ClosingCash : (Number(b.previousDayCash||0) + sumField(b.todayDetails,'Cash'));
  document.getElementById('stat-closing').textContent = money(closing);

  const statusEl = document.getElementById('day-status-badge');
  const isClosed = s.Status === 'CLOSED';
  statusEl.innerHTML = isClosed
    ? '<span class="badge ok">Day closed' + (s.ClosedBy ? ' · ' + escapeHtml(s.ClosedBy) : '') + '</span>'
    : '<span class="badge info">Day open</span>';

  const list = document.getElementById('today-payments-list');
  const payments = (b.todayDetails||[]).slice().reverse();
  list.innerHTML = payments.length ? payments.map(p => paymentRowHtml(p)).join('') : '<div class="empty">No payments recorded yet today.</div>';
  bindPaymentRowActions(list);
}
function sumField(arr, f){ return (arr||[]).reduce((s,x)=>s+(Number(x[f])||0),0); }

function paymentRowHtml(p){
  const isAdmin = state.auth.role === 'Admin';
  return `
    <div class="row" data-id="${escapeAttr(p.ID)}">
      <div>
        <div class="row-main">${escapeHtml(p.ClientName)}</div>
        <div class="row-sub">${escapeHtml(p.Purpose||'')} · ${escapeHtml(p.Method||'')} · by ${escapeHtml(p.EnteredBy||'')}${p._pending ? ' · <strong>Pending sync</strong>' : ''}</div>
      </div>
      <div class="row-actions">
        <div class="row-amt">${money(Number(p.Cash||0)+Number(p.UPI||0))}</div>
        ${isAdmin && !p._pending ? `
          <button class="btn ghost tiny act-edit-payment">Edit</button>
          <button class="btn danger tiny act-del-payment">Del</button>` : ''}
      </div>
    </div>`;
}
function bindPaymentRowActions(container){
  container.querySelectorAll('.act-edit-payment').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.closest('.row').dataset.id;
      const source = (state.bootstrap.todayDetails||[]).concat(state.detailsRows||[]);
      const entry = source.find(x=>String(x.ID)===String(id));
      if (entry) openEditPaymentModal(entry);
    });
  });
  container.querySelectorAll('.act-del-payment').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.closest('.row').dataset.id;
      if (!confirm('Delete this payment entry? This cannot be undone.')) return;
      try{
        await apiCall('deleteRecord', { sheet:'Collection Details', keyCol:'ID', keyVal:id });
        toast('Entry deleted.');
        await refreshBootstrap();
        if (state.detailsDate) await loadDetailsFor(state.detailsDate);
      } catch(err){ toast('Could not delete: ' + err.message); }
    });
  });
}


// ---------------- reception cash handovers ----------------
function baseReceptionCash(){
  const b = state.bootstrap || {};
  const s = b.todaySummary || {};
  if (s.ClosingCash !== undefined && s.ClosingCash !== null && s.ClosingCash !== '') return Number(s.ClosingCash) || 0;
  return (Number(b.previousDayCash || 0) + sumField(b.todayDetails || [], 'Cash'));
}
function renderCashHandovers(){
  const openingEl = document.getElementById('cash-handover-start');
  const balanceEl = document.getElementById('cash-handover-balance');
  const listEl = document.getElementById('cash-handover-list');
  if (!openingEl || !balanceEl || !listEl) return;
  const opening = state.cashHandoverOpening === null ? baseReceptionCash() : Number(state.cashHandoverOpening || 0);
  const entries = Array.isArray(state.cashHandovers) ? state.cashHandovers : [];
  const computed = entries.reduce((balance, entry)=> balance + (String(entry.Direction || 'OUT').toUpperCase() === 'IN' ? Number(entry.Amount || 0) : -Number(entry.Amount || 0)), opening);
  const balance = state.cashHandoverBalance === null ? computed : Number(state.cashHandoverBalance || 0);
  openingEl.textContent = money(opening);
  balanceEl.textContent = money(balance);
  listEl.innerHTML = entries.length ? entries.slice().reverse().map(entry=>{
    const incoming = String(entry.Direction || 'OUT').toUpperCase() === 'IN';
    const amount = Number(entry.Amount || 0);
    return `<div class="row">
      <div style="min-width:0;flex:1">
        <div class="row-main">${incoming ? 'Cash received from' : 'Cash handed to'} ${escapeHtml(entry.RecipientName || entry.PersonName || 'Unknown')}</div>
        <div class="row-sub">${escapeHtml(entry.Date || todayISO())} · ${escapeHtml(entry.Time || entry.Timestamp || '')}${entry.HandedBy ? ' · By ' + escapeHtml(entry.HandedBy) : ''}${entry.Note ? ' · ' + escapeHtml(entry.Note) : ''}</div>
      </div>
      <div class="row-amt" style="color:${incoming ? 'var(--ok)' : 'var(--err)'}">${incoming ? '+' : '−'}${money(amount)}</div>
    </div>`;
  }).join('') : '<div class="empty">No cash handovers recorded today.</div>';
}
async function loadCashHandovers(){
  const listEl = document.getElementById('cash-handover-list');
  if (!listEl || !state.auth) return;
  listEl.innerHTML = '<div class="empty">Loading cash movements…</div>';
  try{
    const res = await apiCall('getCashHandovers', { date: todayISO() });
    const data = res.data || {};
    state.cashHandovers = Array.isArray(data.entries) ? data.entries : (Array.isArray(data.handovers) ? data.handovers : []);
    state.cashHandoverOpening = data.openingBalance !== undefined ? Number(data.openingBalance) : baseReceptionCash();
    state.cashHandoverBalance = data.balance !== undefined ? Number(data.balance) : null;
    renderCashHandovers();
  } catch(err){
    listEl.innerHTML = '<div class="empty">Cash handover history is not connected yet. The backend must support getCashHandovers.</div>';
    console.warn('Cash handover history unavailable:', err.message);
  }
}
function openCashHandoverModal(){
  const available = Number(document.getElementById('cash-handover-balance')?.textContent.replace(/[^0-9.-]/g,'') || 0);
  showModal(`
    <h3>Record cash movement</h3>
    <p class="row-sub">Current reception balance: <strong>${money(available)}</strong></p>
    <label>Movement</label>
    <select id="ch-direction"><option value="OUT">Cash handed to someone</option><option value="IN">Cash received at reception</option></select>
    <label>Person who handed over the cash</label>
    <input type="text" id="ch-handed-by" value="${escapeAttr(state.auth && (state.auth.name || state.auth.username) || '')}" placeholder="Enter name" required>
    <label>Person who received / gave the cash</label>
    <input type="text" id="ch-person" placeholder="Admin, trainer, client, etc." required>
    <label>Amount (₹)</label>
    <input type="number" id="ch-amount" min="1" step="0.01" placeholder="0.00" required>
    <label>Remarks (optional)</label>
    <input type="text" id="ch-note" placeholder="Reason or reference">
    <button class="btn" id="ch-submit">Save cash movement</button>
  `);
  document.getElementById('ch-submit').addEventListener('click', async event=>{
    const btn = event.currentTarget;
    if (btn.disabled) return;
    const direction = document.getElementById('ch-direction').value;
    const handedBy = document.getElementById('ch-handed-by').value.trim();
    const personName = document.getElementById('ch-person').value.trim();
    const amountRaw = document.getElementById('ch-amount').value;
    const amount = amountRaw === '' ? NaN : Number(amountRaw);
    const note = document.getElementById('ch-note').value.trim();
    const currentBalance = Number(document.getElementById('cash-handover-balance')?.textContent.replace(/[^0-9.-]/g,'') || 0);
    if (!handedBy || !personName){ toast('Enter both names.'); return; }
    if (!isValidAmount(amount,{allowZero:false})){ toast('Enter an amount greater than zero.'); return; }
    if (direction === 'OUT' && amount > currentBalance){ toast('The handover exceeds the cash currently available at reception.'); return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try{
      const res = await apiCall('addCashHandover', {
        date: todayISO(), direction, handedBy, personName, amount, note,
        timestamp: new Date().toISOString()
      });
      closeModal();
      toast(res.queued ? 'Cash movement queued for sync.' : 'Cash movement recorded.');
      await loadCashHandovers();
    } catch(err){
      toast('Could not save cash movement: ' + err.message);
      btn.disabled = false; btn.textContent = 'Save cash movement';
    }
  });
}
document.getElementById('open-cash-handover')?.addEventListener('click', openCashHandoverModal);

document.getElementById('open-add-payment').addEventListener('click', ()=> openPaymentModal());
document.getElementById('open-close-day').addEventListener('click', ()=> openCloseDayModal());

function openPaymentModal(){
  const b = state.bootstrap;
  const memberOptions = (b.members||[]).map(m=>`<option value="${escapeAttr(m.MembershipID)}">${escapeHtml(m.ClientName)} (${escapeHtml(m.MembershipID)})</option>`).join('');
  showModal(`
    <h3>Add payment</h3>
    <label>Client name</label>
    <input type="text" id="pf-name" list="pf-members" required>
    <datalist id="pf-members">${memberOptions}</datalist>
    <label>Membership ID (optional)</label>
    <input type="text" id="pf-mid">
    <div class="field-row">
      <div><label>Cash (₹)</label><input type="number" id="pf-cash" min="0" value="0"></div>
      <div><label>UPI (₹)</label><input type="number" id="pf-upi" min="0" value="0"></div>
    </div>
    <label>Purpose</label>
    <select id="pf-purpose">
      <option>New Membership</option>
      <option selected>Renewal</option>
      <option>Cardio</option>
    </select>
    <label>Note (optional)</label>
    <input type="text" id="pf-note">
    <button class="btn" id="pf-submit">Save payment</button>
  `);
  document.getElementById('pf-submit').addEventListener('click', async (event)=>{
    const submitBtn = event.currentTarget;
    if (submitBtn.disabled) return;
    const name = document.getElementById('pf-name').value.trim();
    const mid = document.getElementById('pf-mid').value.trim();
    const cashRaw = document.getElementById('pf-cash').value;
    const upiRaw = document.getElementById('pf-upi').value;
    const cash = cashRaw === '' ? 0 : Number(cashRaw);
    const upi = upiRaw === '' ? 0 : Number(upiRaw);
    const purpose = document.getElementById('pf-purpose').value;
    const note = document.getElementById('pf-note').value.trim();
    if (!name){ toast('Client name is required.'); return; }
    if (!isValidAmount(cash) || !isValidAmount(upi)){ toast('Cash and UPI must be valid non-negative amounts.'); return; }
    if (cash===0 && upi===0){ toast('Enter a cash or UPI amount.'); return; }
    if (mid && !/^\d+$/.test(mid)){ toast('Membership ID must contain numbers only.'); return; }
    if (mid){
      const matchedMember = (b.members||[]).find(m=>String(m.MembershipID)===mid || (/^\d+$/.test(String(m.MembershipID)) && Number(m.MembershipID)===Number(mid)));
      if (!matchedMember && !confirm('This Membership ID is not in the current member list. Record this payment anyway?')) return;
      if (matchedMember && String(matchedMember.ClientName||'').trim().toLowerCase() !== name.toLowerCase() && !confirm('This Membership ID belongs to ' + matchedMember.ClientName + ', not ' + name + '. Continue anyway?')) return;
    }
    submitBtn.disabled = true; submitBtn.textContent = 'Saving…';
    const localId = 'pay_' + Date.now() + '_' + Math.floor(Math.random()*1000000);
    const params = { clientName:name, membershipId:mid, cash, upi, purpose, note,
                      date: todayISO(), clientLocalId: localId };

    try{
      const res = await apiCall('addPayment', params, { queueOnFail:true });
      if (res.queued){
        closeModal();
        state.bootstrap.todayDetails = state.bootstrap.todayDetails || [];
        state.bootstrap.todayDetails.push({ ID:localId, ClientName:name, MembershipID:mid, Cash:cash, UPI:upi, Method: cash&&upi?'Both':(cash?'Cash':(upi?'UPI':'')), Purpose:purpose, Note:note, EnteredBy: state.auth.name, _pending:true });
        saveCache(state.bootstrap); renderCollectionTab();
        toast('Saved on this device; waiting to sync.');
      } else {
        closeModal(); toast('Payment saved.'); await refreshBootstrap(); await loadCashHandovers();
      }
    } catch(err){
      toast('Could not save: ' + err.message);
      const uncertain = /Could not confirm|response could not be read/i.test(err.message);
      submitBtn.disabled = uncertain; submitBtn.textContent = uncertain ? 'Result unknown — verify first' : 'Save payment';
    }
  });
}

function openEditPaymentModal(entry){
  showModal(`
    <h3>Edit payment</h3>
    <label>Client name</label><input type="text" id="ef-name" value="${escapeAttr(entry.ClientName)}">
    <label>Membership ID</label><input type="text" id="ef-mid" value="${escapeAttr(entry.MembershipID||'')}">
    <div class="field-row">
      <div><label>Cash (₹)</label><input type="number" id="ef-cash" value="${Number(entry.Cash)||0}"></div>
      <div><label>UPI (₹)</label><input type="number" id="ef-upi" value="${Number(entry.UPI)||0}"></div>
    </div>
    <label>Purpose</label>
    <select id="ef-purpose">
      <option ${entry.Purpose==='New Membership'?'selected':''}>New Membership</option>
      <option ${entry.Purpose==='Renewal'?'selected':''}>Renewal</option>
      <option ${entry.Purpose==='Cardio'?'selected':''}>Cardio</option>
    </select>
    <label>Note</label><input type="text" id="ef-note" value="${escapeAttr(entry.Note||'')}">
    <button class="btn" id="ef-submit">Save correction</button>
  `);
  document.getElementById('ef-submit').addEventListener('click', async (event)=>{
    const btn = event.currentTarget; if (btn.disabled) return;
    const cashRaw = document.getElementById('ef-cash').value;
    const upiRaw = document.getElementById('ef-upi').value;
    const updates = {
      id: entry.ID,
      ClientName: document.getElementById('ef-name').value.trim(),
      MembershipID: document.getElementById('ef-mid').value.trim(),
      Cash: cashRaw === '' ? NaN : Number(cashRaw),
      UPI: upiRaw === '' ? NaN : Number(upiRaw),
      Purpose: document.getElementById('ef-purpose').value,
      Note: document.getElementById('ef-note').value.trim()
    };
    if (!updates.ClientName || !isValidAmount(updates.Cash) || !isValidAmount(updates.UPI) || (updates.Cash===0 && updates.UPI===0)){ toast('Enter a client name and valid cash/UPI amounts; total must be greater than zero.'); return; }
    if (updates.MembershipID && !/^\d+$/.test(updates.MembershipID)){ toast('Membership ID must contain numbers only.'); return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try{
      await apiCall('updatePaymentEntry', updates);
      closeModal(); toast('Entry corrected.'); await refreshBootstrap();
      if (state.detailsDate) await loadDetailsFor(state.detailsDate);
    } catch(err){ toast('Could not save correction: ' + err.message); btn.disabled = false; btn.textContent = 'Save correction'; }
  });
}

function openCloseDayModal(){
  const b = state.bootstrap;
  const s = b.todaySummary || {};
  if (s.Status === 'CLOSED'){ toast('Today’s collection is already marked closed.'); return; }
  const expected = s.ClosingCash !== undefined ? s.ClosingCash : (Number(b.previousDayCash||0) + sumField(b.todayDetails,'Cash'));
  showModal(`
    <h3>Close today's collection</h3>
    <p class="row-sub">Expected closing cash: <strong>${money(expected)}</strong></p>
    <label>Actual cash counted (₹)</label>
    <input type="number" id="cd-actual" value="${expected}">
    <p class="row-sub">If this doesn't match the expected amount, the difference is recorded automatically.</p>
    <button class="btn" id="cd-submit">Close day</button>
  `);
  document.getElementById('cd-submit').addEventListener('click', async (event)=>{
    const btn = event.currentTarget;
    if (btn.disabled) return;
    const actualRaw = document.getElementById('cd-actual').value;
    const actual = actualRaw === '' ? NaN : Number(actualRaw);
    if (!isValidAmount(actual)){ toast('Enter a valid non-negative closing cash amount.'); return; }
    if (!navigator.onLine){ toast('Connect to the internet before closing the day.'); return; }
    btn.disabled = true; btn.textContent = 'Closing…';
    try{
      await apiCall('closeDay', { date: todayISO(), actualClosingCash: actual });
      closeModal(); toast('Day closed.'); await refreshBootstrap(); await loadCashHandovers();
    } catch(err){ toast('Could not close day: ' + err.message); btn.disabled = false; btn.textContent = 'Close day'; }
  });
}

// ================= DETAILS TAB (any date) =================
const detailsInput = document.getElementById('details-date-filter');
detailsInput.addEventListener('change', ()=> loadDetailsFor(detailsInput.value));

function renderDetailsTab(){
  if (!detailsInput.value) detailsInput.value = state.bootstrap.today;
  loadDetailsFor(detailsInput.value);
}

async function loadDetailsFor(date){
  state.detailsDate = date;
  const requestId = ++detailsRequestSequence;
  const requestUsername = state.auth && state.auth.username;
  const requestToken = state.auth && state.auth.token;
  const list = document.getElementById('details-list');
  const summaryEl = document.getElementById('details-summary');
  list.innerHTML = '<div class="empty">Loading…</div>';
  try{
    const res = await apiCall('getCollectionDetails', { date });
    if (requestId !== detailsRequestSequence || !state.auth || state.auth.username !== requestUsername || state.auth.token !== requestToken) return;
    if (!res.data || !Array.isArray(res.data.details)) throw new Error('Invalid collection details response');
    state.detailsRows = res.data.details;
    const s = res.data.summary || {};
    summaryEl.innerHTML = `
      <div class="stat"><div class="num">${res.data.details.length}</div><div class="label">Entries</div></div>
      <div class="stat"><div class="num">${money((hasValue(s,'TotalCash') ? Number(s.TotalCash) : sumField(res.data.details,'Cash')) + (hasValue(s,'TotalUPI') ? Number(s.TotalUPI) : sumField(res.data.details,'UPI')))}</div><div class="label">Total</div></div>`;
    const rows = res.data.details.slice().reverse();
    list.innerHTML = rows.length ? rows.map(p=>paymentRowHtml(p)).join('') : '<div class="empty">No entries for this date.</div>';
    bindPaymentRowActions(list);
  } catch(err){
    if (requestId !== detailsRequestSequence || !state.auth || state.auth.username !== requestUsername || state.auth.token !== requestToken) return;
    summaryEl.innerHTML = '';
    list.innerHTML = '<div class="empty">Could not load — check your connection.</div>';
  }
}

// ================= ADVANCES TAB (cycle navigation) =================
document.getElementById('open-add-advance').addEventListener('click', ()=>{
  const b = state.bootstrap;
  const trainerOptions = (b.trainers||[]).map(t=>`<option value="${escapeAttr(t.Name)}">${escapeHtml(t.Name)}</option>`).join('');
  showModal(`
    <h3>Add trainer advance</h3>
    <label>Trainer</label>
    <select id="af-trainer">${trainerOptions || '<option value="">No trainers yet</option>'}</select>
    <label>Amount (₹)</label>
    <input type="number" id="af-amount" min="0">
    <label>Note (optional)</label>
    <input type="text" id="af-note">
    <button class="btn" id="af-submit">Save advance</button>
  `);
  document.getElementById('af-submit').addEventListener('click', async (event)=>{
    const btn = event.currentTarget; if (btn.disabled) return;
    const trainerName = document.getElementById('af-trainer').value;
    const amountRaw = document.getElementById('af-amount').value;
    const amount = amountRaw === '' ? NaN : Number(amountRaw);
    const note = document.getElementById('af-note').value.trim();
    if (!trainerName || !isValidAmount(amount, {allowZero:false})){ toast('Select a trainer and enter an amount greater than zero.'); return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try{
      const res = await apiCall('addAdvance', { trainerName, amount, note, date: todayISO() }, { queueOnFail:true });
      closeModal(); toast(res.queued ? 'Saved on this device; waiting to sync.' : 'Advance recorded.');
      if (!res.queued) await loadAdvances();
    } catch(err){ toast('Could not save: ' + err.message); btn.disabled = false; btn.textContent = 'Save advance'; }
  });
});

document.getElementById('cycle-prev').addEventListener('click', ()=>{
  const cyc = advanceCycleFor(state.advanceViewDate);
  const prevDay = new Date(cyc.start); prevDay.setDate(prevDay.getDate()-1);
  state.advanceViewDate = isoDate(prevDay);
  loadAdvances();
});
document.getElementById('cycle-next').addEventListener('click', ()=>{
  const cyc = advanceCycleFor(state.advanceViewDate);
  const nextDay = new Date(cyc.end); nextDay.setDate(nextDay.getDate()+1);
  state.advanceViewDate = isoDate(nextDay);
  loadAdvances();
});

async function loadAdvances(){
  const requestId = ++advancesRequestSequence;
  const requestUsername = state.auth && state.auth.username;
  const requestToken = state.auth && state.auth.token;
  const cycleStart = advanceCycleFor(state.advanceViewDate || todayISO()).start;
  try{
    const res = await apiCall('getAdvances', { cycleStart });
    if (requestId !== advancesRequestSequence || !state.auth || state.auth.username !== requestUsername || state.auth.token !== requestToken) return;
    if (!res.data || !res.data.cycle || !Array.isArray(res.data.entries)) throw new Error('Invalid advances response');
    state.advances = res.data;
    renderAdvancesTab();
  } catch(e){ if (requestId === advancesRequestSequence && state.auth && state.auth.username === requestUsername && state.auth.token === requestToken) toast('Could not load trainer advances: ' + e.message); }
}

function renderAdvancesTab(){
  const a = state.advances;
  const cycleEl = document.getElementById('advance-cycle-label');
  const totalsEl = document.getElementById('advance-totals');
  const entriesEl = document.getElementById('advance-entries');
  if (!a){ cycleEl.textContent = 'Loading cycle…'; totalsEl.innerHTML=''; entriesEl.innerHTML=''; return; }
  const isCurrent = !!(a.currentCycle && a.cycle.start === a.currentCycle.start);
  cycleEl.innerHTML = escapeHtml(a.cycle.start) + ' → ' + escapeHtml(a.cycle.end) + (isCurrent ? ' <span class="badge info">Current</span>' : '');
  const totalsKeys = Object.keys(a.totals || {});
  totalsEl.innerHTML = totalsKeys.length ? totalsKeys.map(name=>`
    <div class="row"><div class="row-main">${escapeHtml(name)}</div><div class="row-amt">${money(a.totals[name])}</div></div>
  `).join('') : '<div class="empty">No advances taken this cycle.</div>';

  const isAdmin = state.auth.role === 'Admin';
  const entries = (a.entries||[]).slice().reverse();
  entriesEl.innerHTML = entries.length ? entries.map(e=>`
    <div class="row" data-id="${escapeAttr(e.ID)}">
      <div><div class="row-main">${escapeHtml(e.TrainerName)}</div><div class="row-sub">${escapeHtml(fmt(e.Date))} ${e.Note?('· '+escapeHtml(e.Note)):''}</div></div>
      <div class="row-actions">
        <div class="row-amt">${money(e.Amount)}</div>
        ${isAdmin ? `<button class="btn ghost tiny act-edit-adv">Edit</button><button class="btn danger tiny act-del-adv">Del</button>` : ''}
      </div>
    </div>`).join('') : '<div class="empty">No entries in this cycle.</div>';

  entriesEl.querySelectorAll('.act-edit-adv').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.closest('.row').dataset.id;
      const entry = (a.entries||[]).find(x=>String(x.ID)===String(id));
      if (entry) openEditAdvanceModal(entry);
    });
  });
  entriesEl.querySelectorAll('.act-del-adv').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.closest('.row').dataset.id;
      if (!confirm('Delete this advance entry?')) return;
      try{
        await apiCall('deleteRecord', { sheet:'Trainer Advances', keyCol:'ID', keyVal:id });
        toast('Advance deleted.');
        await loadAdvances();
      } catch(err){ toast('Could not delete: ' + err.message); }
    });
  });
}

function openEditAdvanceModal(entry){
  showModal(`
    <h3>Edit advance</h3>
    <label>Trainer name</label><input type="text" id="eaf-trainer" value="${escapeAttr(entry.TrainerName)}">
    <label>Amount (₹)</label><input type="number" id="eaf-amount" value="${Number(entry.Amount)||0}">
    <label>Date</label><input type="date" id="eaf-date" value="${escapeAttr(fmt(entry.Date))}">
    <label>Note</label><input type="text" id="eaf-note" value="${escapeAttr(entry.Note||'')}">
    <button class="btn" id="eaf-submit">Save correction</button>
  `);
  document.getElementById('eaf-submit').addEventListener('click', async ()=>{
    const amountRaw = document.getElementById('eaf-amount').value;
    const updates = {
      id: entry.ID,
      trainerName: document.getElementById('eaf-trainer').value.trim(),
      amount: amountRaw === '' ? NaN : Number(amountRaw),
      date: document.getElementById('eaf-date').value,
      note: document.getElementById('eaf-note').value.trim()
    };
    if (!updates.trainerName || !isValidAmount(updates.amount,{allowZero:false}) || !/^\d{4}-\d{2}-\d{2}$/.test(updates.date)){ toast('Enter a trainer, a positive amount, and a valid date.'); return; }
    const btn = document.getElementById('eaf-submit'); if (btn.disabled) return; btn.disabled = true; btn.textContent = 'Saving…';
    try{
      await apiCall('updateAdvance', updates);
      closeModal(); toast('Advance corrected.'); await loadAdvances();
    } catch(err){ toast('Could not save correction: ' + err.message); btn.disabled = false; btn.textContent = 'Save correction'; }
  });
}

// ================= MEMBERS TAB =================
let memberSearchTimer;
document.getElementById('member-search').addEventListener('input', (e)=>{
  clearTimeout(memberSearchTimer);
  memberSearchTimer = setTimeout(()=>renderMembersTab(e.target.value), 200);
});
function renderMembersTab(q){
  q = (q||'').toLowerCase();
  const members = (state.bootstrap.members||[]).filter(m=>!q ||
    String(m.ClientName).toLowerCase().includes(q) ||
    String(m.Mobile).toLowerCase().includes(q) ||
    String(m.MembershipID).toLowerCase().includes(q));
  const list = document.getElementById('members-list');
  const isAdmin = state.auth.role === 'Admin';
  list.innerHTML = members.length ? members.map(m=>{
    const expired = isExpiredDate(m.ExpiryDate);
    return `<div class="row" data-mid="${escapeAttr(m.MembershipID)}">
      <div>
        <div class="row-main">${escapeHtml(m.ClientName)}</div>
        <div class="row-sub">${escapeHtml(m.MembershipID)} · ${escapeHtml(m.Mobile||'')} · exp ${escapeHtml(fmt(m.ExpiryDate))}${m._pending ? ' · <strong>Pending sync</strong>' : ''}</div>
      </div>
      <div class="row-actions">
        <span class="badge ${expired?'err':'ok'}">${expired?'Expired':'Active'}</span>
        ${isAdmin ? `<button class="btn ghost tiny act-edit-member">Edit</button><button class="btn danger tiny act-del-member">Del</button>` : ''}
      </div>
    </div>`;
  }).join('') : '<div class="empty">No members found.</div>';

  list.querySelectorAll('.act-edit-member').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const mid = btn.closest('.row').dataset.mid;
      const m = (state.bootstrap.members||[]).find(x=>String(x.MembershipID)===String(mid));
      if (m) openEditMemberModal(m);
    });
  });
  list.querySelectorAll('.act-del-member').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const mid = btn.closest('.row').dataset.mid;
      if (!confirm('Delete this member record? Their payment history stays in Collection Details.')) return;
      try{
        await apiCall('deleteRecord', { sheet:'Members', keyCol:'MembershipID', keyVal:mid });
        toast('Member deleted.');
        await refreshBootstrap();
      } catch(err){ toast('Could not delete: ' + err.message); }
    });
  });
}

document.getElementById('open-add-member').addEventListener('click', ()=>{
  showModal(`
    <h3>Add member</h3>
    <label>Client name</label><input type="text" id="mf-name" required>
    <label>Membership ID</label><input type="text" id="mf-id" required>
    <label>Mobile number</label><input type="tel" id="mf-mobile">
    <label>Membership expiry date</label><input type="date" id="mf-expiry">
    <button class="btn" id="mf-submit">Save member</button>
  `);
  document.getElementById('mf-submit').addEventListener('click', async ()=>{
    const clientName = document.getElementById('mf-name').value.trim();
    const membershipId = document.getElementById('mf-id').value.trim();
    const mobile = document.getElementById('mf-mobile').value.trim();
    const expiryDate = document.getElementById('mf-expiry').value;
    if (!clientName || !membershipId){ toast('Name and Membership ID are required.'); return; }
    if (!/^\d+$/.test(membershipId)){ toast('Membership ID must contain numbers only.'); return; }
    const existing = (state.bootstrap.members||[]).some(m=>String(m.MembershipID)===membershipId || (String(m.MembershipID).match(/^\d+$/) && Number(m.MembershipID)===Number(membershipId)));
    if (existing){ toast('That Membership ID already exists.'); return; }
    const btn = document.getElementById('mf-submit'); if (btn.disabled) return; btn.disabled = true; btn.textContent = 'Saving…';
    try{
      const res = await apiCall('addMember', { clientName, membershipId, mobile, expiryDate }, { queueOnFail:true });
      closeModal();
      if (res.queued){
        state.bootstrap.members = state.bootstrap.members || [];
        state.bootstrap.members.push({ MembershipID:membershipId, ClientName:clientName, Mobile:mobile, ExpiryDate:expiryDate, _pending:true });
        saveCache(state.bootstrap); renderMembersTab(document.getElementById('member-search').value);
        toast('Member saved on this device; waiting to sync.');
      } else { toast('Member added.'); await refreshBootstrap(); }
    } catch(err){ toast('Could not save: ' + err.message); btn.disabled = false; btn.textContent = 'Save member'; }
  });
});

function openEditMemberModal(m){
  showModal(`
    <h3>Edit member</h3>
    <label>Client name</label><input type="text" id="emf-name" value="${escapeAttr(m.ClientName)}">
    <label>Membership ID</label><input type="text" value="${escapeAttr(m.MembershipID)}" disabled style="opacity:.6;">
    <label>Mobile number</label><input type="tel" id="emf-mobile" value="${escapeAttr(m.Mobile||'')}">
    <label>Membership expiry date</label><input type="date" id="emf-expiry" value="${escapeAttr(fmt(m.ExpiryDate))}">
    <button class="btn" id="emf-submit">Save changes</button>
  `);
  document.getElementById('emf-submit').addEventListener('click', async ()=>{
    const updates = {
      membershipId: m.MembershipID,
      ClientName: document.getElementById('emf-name').value.trim(),
      Mobile: document.getElementById('emf-mobile').value.trim(),
      ExpiryDate: document.getElementById('emf-expiry').value
    };
    if (!updates.ClientName){ toast('Client name is required.'); return; }
    const btn = document.getElementById('emf-submit'); if (btn.disabled) return; btn.disabled = true; btn.textContent = 'Saving…';
    try{
      await apiCall('updateMember', updates);
      closeModal(); toast('Member updated.'); await refreshBootstrap();
    } catch(err){ toast('Could not save: ' + err.message); btn.disabled = false; btn.textContent = 'Save changes'; }
  });
}

// ================= ADMIN TAB =================
function renderAdminTab(){
  const trainers = (state.bootstrap.trainers||[]);
  const list = document.getElementById('trainers-list');
  list.innerHTML = trainers.length ? trainers.map((t,i)=>`
    <div class="row" data-trainer-index="${i}">
      <div><div class="row-main">${escapeHtml(t.Name)}</div><div class="row-sub">@${escapeHtml(t.Username)}</div></div>
      <button type="button" class="btn ghost small act-remove-trainer">Remove</button>
    </div>`).join('') : '<div class="empty">No trainers added yet.</div>';
  list.querySelectorAll('.act-remove-trainer').forEach(btn=>btn.addEventListener('click',()=>{
    const row = btn.closest('[data-trainer-index]'); const trainer = trainers[Number(row.dataset.trainerIndex)];
    if (trainer) deleteTrainer(String(trainer.Username));
  }));

  document.getElementById('setting-gymname').value = (state.bootstrap.settings && state.bootstrap.settings.GymName) || '';
  renderSettingsList();
  loadActivity();
}

document.getElementById('open-add-trainer').addEventListener('click', ()=>{
  showModal(`
    <h3>Add trainer / staff</h3>
    <label>Full name</label><input type="text" id="tf-name" required>
    <label>Username</label><input type="text" id="tf-username" required>
    <label>PIN (4+ digits)</label><input type="password" inputmode="numeric" id="tf-pin" required>
    <button class="btn" id="tf-submit">Add trainer</button>
  `);
  document.getElementById('tf-submit').addEventListener('click', async ()=>{
    const name = document.getElementById('tf-name').value.trim();
    const newUsername = document.getElementById('tf-username').value.trim();
    const pin = document.getElementById('tf-pin').value.trim();
    if (!name || !newUsername || !pin){ toast('All fields are required.'); return; }
    if (!/^\d{4,}$/.test(pin)){ toast('PIN must contain at least 4 digits.'); return; }
    const btn = document.getElementById('tf-submit'); if (btn.disabled) return; btn.disabled = true; btn.textContent = 'Adding…';
    try{
      await apiCall('addTrainer', { name, newUsername, pin });
      closeModal(); toast('Trainer added.'); await refreshBootstrap();
    } catch(err){ toast('Could not add trainer: ' + err.message); btn.disabled = false; btn.textContent = 'Add trainer'; }
  });
});

async function deleteTrainer(username){
  if (!confirm('Remove this trainer\'s access?')) return;
  try{
    await apiCall('deleteTrainer', { targetUsername: username });
    toast('Trainer removed.');
    await refreshBootstrap();
  } catch(err){ toast('Could not remove: ' + err.message); }
}

document.getElementById('save-gymname').addEventListener('click', async ()=>{
  const value = document.getElementById('setting-gymname').value.trim();
  if (!value){ toast('Gym name cannot be empty.'); return; }
  try{
    await apiCall('updateSetting', { key:'GymName', value });
    toast('Gym name updated.');
    await refreshBootstrap();
  } catch(err){ toast('Could not save: ' + err.message); }
});

document.getElementById('save-setting').addEventListener('click', async ()=>{
  const key = document.getElementById('setting-key').value.trim();
  const value = document.getElementById('setting-value').value.trim();
  if (!key){ toast('Setting key is required.'); return; }
  if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)){ toast('Use a setting key starting with a letter and containing only letters, numbers, or underscores (max 40 characters).'); return; }
  try{
    const res = await apiCall('updateSetting', { key, value });
    state.bootstrap.settings = res.data;
    saveCache(state.bootstrap);
    document.getElementById('setting-key').value = '';
    document.getElementById('setting-value').value = '';
    toast('Setting saved.');
    renderSettingsList();
  } catch(err){ toast('Could not save: ' + err.message); }
});

function renderSettingsList(){
  const settings = (state.bootstrap.settings) || {};
  const list = document.getElementById('settings-list');
  const keys = Object.keys(settings).filter(k=>k!=='GymName');
  list.innerHTML = keys.length ? keys.map(k=>`
    <div class="row"><div class="row-main">${escapeHtml(k)}</div><div class="row-sub">${escapeHtml(settings[k])}</div></div>
  `).join('') : '<div class="empty">No extra settings yet.</div>';
}

async function loadActivity(){
  try{
    const res = await apiCall('getActivityLog', { limit: 40 });
    const list = document.getElementById('activity-list');
    const rows = res.data || [];
    list.innerHTML = rows.length ? rows.map(r=>`
      <div class="row">
        <div><div class="row-main">${escapeHtml(r.Action)}</div><div class="row-sub">${escapeHtml(r.User)} · ${escapeHtml(fmtDateTime(r.Timestamp))}</div></div>
      </div>`).join('') : '<div class="empty">No activity yet.</div>';
  } catch(e){
    const list = document.getElementById('activity-list');
    if (list) list.innerHTML = '<div class="empty">Activity log unavailable. Check your connection or permissions.</div>';
  }
}

// ================= MODAL =================
function showModal(innerHtml){
  const root = document.getElementById('modal-root');
  modalPreviousFocus = document.activeElement;
  root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${innerHtml}<button class="btn secondary" id="modal-cancel">Cancel</button></div></div>`;
  document.getElementById('modal-backdrop').addEventListener('click', (e)=>{ if(e.target.id==='modal-backdrop') closeModal(); });
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  const modal = root.querySelector('.modal');
  const focusables = ()=>Array.from(modal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(el=>!el.hidden);
  const first = focusables()[0]; if (first) first.focus();
  modalKeydownHandler = (e)=>{
    if (e.key === 'Escape'){ e.preventDefault(); closeModal(); return; }
    if (e.key === 'Tab'){
      const items = focusables(); if (!items.length){ e.preventDefault(); return; }
      const firstItem = items[0], lastItem = items[items.length-1];
      if (e.shiftKey && document.activeElement === firstItem){ e.preventDefault(); lastItem.focus(); }
      else if (!e.shiftKey && document.activeElement === lastItem){ e.preventDefault(); firstItem.focus(); }
    }
  };
  document.addEventListener('keydown', modalKeydownHandler);
}
function closeModal(){
  document.getElementById('modal-root').innerHTML = '';
  if (modalKeydownHandler){ document.removeEventListener('keydown', modalKeydownHandler); modalKeydownHandler = null; }
  const previous = modalPreviousFocus; modalPreviousFocus = null;
  if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus();
}

// ================= utils =================
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s){ return escapeHtml(s); }

// ================= boot =================
(function init(){
  const auth = loadAuth();
  if (auth && auth.token){
    state.auth = auth; storageAccount = auth.username || null;
    enterApp().catch(err=>toast('Could not open the app: ' + err.message));
  }
  updateSyncPill();
  setInterval(()=>{ if(navigator.onLine) flushQueue(); }, 20000);
})();