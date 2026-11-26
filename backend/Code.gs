/**
 * AK PACK Fitness — Daily Collection backend (Google Apps Script + Google Sheets)
 *
 * Setup: see backend/README.md. In short:
 *   1. Paste this file into Extensions → Apps Script of a new Google Sheet.
 *   2. Run setup() once and copy the ACCESS KEY from the execution log.
 *   3. Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 *   4. Paste the web app URL + access key into the app: Admin → Cloud sync.
 *
 * The URL is public but every request must carry the access key.
 * 10 wrong keys lock the API for 10 minutes (protects against guessing).
 */

// Optional: set your own key here BEFORE running setup(). Leave '' to auto-generate.
var ACCESS_KEY_OVERRIDE = '';

var TABLES = {
  payments:  { sheet: 'Payments',  key: 'ID',           cols: ['ID','Date','Time','ClientName','MembershipID','Cash','UPI','Method','Purpose','Note','EnteredBy'] },
  members:   { sheet: 'Members',   key: 'MembershipID', cols: ['MembershipID','ClientName','Mobile','ExpiryDate'] },
  advances:  { sheet: 'Advances',  key: 'ID',           cols: ['ID','TrainerName','Amount','Date','Note'] },
  handovers: { sheet: 'Handovers', key: 'ID',           cols: ['ID','Date','Time','Direction','PersonName','Amount','HandedBy','Note'] },
  trainers:  { sheet: 'Trainers',  key: 'ID',           cols: ['ID','Name','Mobile'] },
  ptclients: { sheet: 'PTClients', key: 'ID',           cols: ['ID','TrainerID','ClientName','MembershipID','Mobile','Fee','StartDate','Note','PaymentID'] },
  closings:  { sheet: 'Closings',  key: 'Date',         cols: ['Date','Expected','Actual','ClosedAt'] },
  settings:  { sheet: 'Settings',  key: 'Key',          cols: ['Key','Value'] },
  activity:  { sheet: 'Activity',  key: 'ID',           cols: ['ID','Timestamp','Action','User'] }
};
var NUM_COLS = { Cash: 1, UPI: 1, Amount: 1, Expected: 1, Actual: 1, Fee: 1 };
var ACTIVITY_KEEP = 1000;

/* ---------- one-time setup ---------- */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABLES).forEach(function (t) { ensureSheet_(ss, TABLES[t]); });
  var props = PropertiesService.getScriptProperties();
  var key = ACCESS_KEY_OVERRIDE || props.getProperty('ACCESS_KEY') || Utilities.getUuid().replace(/-/g, '');
  props.setProperty('ACCESS_KEY', key);
  Logger.log('ACCESS KEY: ' + key);
  return key;
}

function ensureSheet_(ss, def) {
  var sh = ss.getSheetByName(def.sheet);
  if (sh) return sh;
  sh = ss.insertSheet(def.sheet);
  var headers = def.cols.concat(['_json']);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  // keep IDs, dates and phone numbers as plain text so Sheets never reformats them
  def.cols.forEach(function (c, i) {
    if (!NUM_COLS[c]) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  });
  return sh;
}

/* ---------- web app entry points ---------- */
function doGet() {
  return json_({ ok: true, service: 'AK PACK Daily Collection', time: new Date().toISOString() });
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!authorized_(req.key)) return json_({ ok: false, error: 'unauthorized' });
    var lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      if (req.action === 'ping') out = { ok: true, time: new Date().toISOString() };
      else if (req.action === 'pull') out = { ok: true, data: readAll_() };
      else if (req.action === 'sync') {
        var ops = Array.isArray(req.ops) ? req.ops : [];
        applyOps_(ops);
        out = { ok: true, applied: ops.length, data: readAll_() };
      } else out = { ok: false, error: 'unknown action' };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return json_(out);
}

/* ---------- auth ---------- */
function authorized_(key) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('fails') || 0);
  if (fails >= 10) return false;
  var good = PropertiesService.getScriptProperties().getProperty('ACCESS_KEY') || '';
  var ok = good.length >= 12 && safeEq_(String(key || ''), good);
  if (!ok) cache.put('fails', String(fails + 1), 600);
  return ok;
}
function safeEq_(a, b) {
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---------- sheet <-> record helpers ---------- */
function sheet_(def) {
  return ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), def); // creates missing sheets automatically
}
function rows_(def) {
  var sh = sheet_(def);
  var n = sh.getLastRow();
  var w = def.cols.length + 1;
  return { sh: sh, w: w, rows: n < 2 ? [] : sh.getRange(2, 1, n - 1, w).getValues() };
}
function toRecord_(def, row) {
  var rec = {};
  try { rec = JSON.parse(row[def.cols.length] || '{}'); } catch (err) { rec = {}; }
  def.cols.forEach(function (c, i) {
    var v = row[i];
    if (NUM_COLS[c]) { var num = Number(v); rec[c] = (v === '' || isNaN(num)) ? 0 : num; }
    else rec[c] = String(v === null || v === undefined ? '' : v);
  });
  return rec;
}
function toRow_(def, rec) {
  var row = def.cols.map(function (c) {
    var v = rec[c];
    if (v === undefined || v === null) return NUM_COLS[c] ? 0 : '';
    return v;
  });
  row.push(JSON.stringify(rec));
  return row;
}

/* ---------- apply changes from the app ---------- */
function applyOps_(ops) {
  var byTable = {};
  ops.forEach(function (o) {
    if (o && TABLES[o.t] && o.id !== undefined && o.id !== '') (byTable[o.t] = byTable[o.t] || []).push(o);
  });
  Object.keys(byTable).forEach(function (t) {
    var def = TABLES[t];
    var d = rows_(def);
    var keyIdx = def.cols.indexOf(def.key);
    var list = d.rows.slice();
    var index = {};
    list.forEach(function (r, i) { index[String(r[keyIdx])] = i; });
    byTable[t].forEach(function (o) {
      var id = String(o.id);
      if (o.op === 'put' && o.rec && typeof o.rec === 'object') {
        o.rec[def.key] = id;
        var row = toRow_(def, o.rec);
        if (index[id] !== undefined) list[index[id]] = row;
        else { index[id] = list.length; list.push(row); }
      } else if (o.op === 'del' && index[id] !== undefined) {
        list[index[id]] = null;
        delete index[id];
      }
    });
    list = list.filter(function (r) { return r !== null; });
    if (t === 'activity' && list.length > ACTIVITY_KEEP) list = list.slice(list.length - ACTIVITY_KEEP);
    var last = d.sh.getLastRow();
    if (last > 1) d.sh.getRange(2, 1, last - 1, d.w).clearContent();
    if (list.length) d.sh.getRange(2, 1, list.length, d.w).setValues(list);
  });
}

/* ---------- read everything for the app ---------- */
function readAll_() {
  var out = { payments: [], members: [], advances: [], handovers: [], trainers: [], ptclients: [], closings: {}, settings: {}, activity: [] };
  ['payments', 'members', 'advances', 'handovers', 'trainers', 'ptclients'].forEach(function (t) {
    var def = TABLES[t];
    out[t] = rows_(def).rows
      .filter(function (r) { return String(r[def.cols.indexOf(def.key)]) !== ''; })
      .map(function (r) { return toRecord_(def, r); });
  });
  rows_(TABLES.closings).rows.forEach(function (r) {
    if (String(r[0]) === '') return;
    var rec = toRecord_(TABLES.closings, r);
    var date = rec.Date; delete rec.Date;
    out.closings[date] = rec;
  });
  rows_(TABLES.settings).rows.forEach(function (r) {
    if (String(r[0]) !== '') out.settings[String(r[0])] = String(r[1]);
  });
  out.activity = rows_(TABLES.activity).rows
    .filter(function (r) { return String(r[0]) !== ''; })
    .map(function (r) { return toRecord_(TABLES.activity, r); })
    .sort(function (a, b) { return a.Timestamp < b.Timestamp ? 1 : -1; })
    .slice(0, 100);
  return out;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}