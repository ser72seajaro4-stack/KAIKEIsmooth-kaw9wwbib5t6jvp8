// sync.js データの移行・複数端末での共有（S09 データの移行・同期）
//
// ① バックアップ（ファイルで移す）：データを1つのJSONファイルに書き出し、別の端末で読み込む。サーバー不要。
// ② 同期：同期コードごとにサーバー（api/sync.php）にデータを置き、同じコードを入れた端末どうしで共有する。
//    ログインはなし。同期コードを知っている人はデータを見られるので、人に教えない。
//
// 合わせ方（マージ）：アプリ・ポイント・お店は1件ずつ updatedAt（最後に変わった時刻）を比べ、新しい方を残す。
//   削除した記録は削除記録（syncTombstones）を残し、別の端末から復活しないようにする。
//   起動履歴は全部の端末の分を合わせ、30日より古いもの・削除したアプリの分を除く。
'use strict';

const SYNC_SETTINGS_KEY = 'syncSettings';    // { code, version, lastSyncAt, lastError }
const SYNC_API = 'api/sync.php';
const SYNC_DEBOUNCE_MS = 3000;
const TOMBSTONE_KEEP_DAYS = 90;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0/O・1/I など見間違えやすい文字を除く
const EXPORT_FORMAT = 1;

/* ===================== データのまとめ・合わせ方 ===================== */

/** この端末のデータを1つにまとめる */
function collectData() {
  return {
    apps: load(KEYS.APPS),
    points: load(KEYS.POINTS),
    shops: load(KEYS.SHOPS),
    launchHistory: load(KEYS.HISTORY),
    tombstones: loadObject(KEYS.TOMBSTONES),
    genres: loadObject(KEYS.GENRES),
  };
}

/** まとめたデータをこの端末に書き戻す（updatedAt は付け直さない） */
function applyData(data) {
  writeRaw(KEYS.APPS, data.apps || []);
  writeRaw(KEYS.POINTS, data.points || []);
  writeRaw(KEYS.SHOPS, data.shops || []);
  writeRaw(KEYS.HISTORY, data.launchHistory || []);
  writeRaw(KEYS.TOMBSTONES, data.tombstones || {});
  if (data.genres && typeof data.genres === 'object') writeRaw(KEYS.GENRES, data.genres);
}

/** ジャンルの設定は、最後に変えた方をまるごと残す */
function mergeGenres(a, b) {
  const ok = g => g && typeof g === 'object' && !Array.isArray(g);
  if (!ok(b)) return ok(a) ? a : {};
  if (!ok(a)) return b;
  return timeOf(b.updatedAt) > timeOf(a.updatedAt) ? b : a;
}

function timeOf(s) {
  const t = Date.parse(s || '');
  return Number.isFinite(t) ? t : 0;
}

/** 削除記録を合わせる（新しい方の時刻を残し、古すぎるものは捨てる） */
function mergeTombstones(a, b) {
  const out = {};
  const limit = Date.now() - TOMBSTONE_KEEP_DAYS * 86400000;
  [a || {}, b || {}].forEach(t => {
    Object.keys(t).forEach(key => {
      Object.entries(t[key] || {}).forEach(([id, at]) => {
        if (timeOf(at) < limit) return;
        out[key] = out[key] || {};
        if (!out[key][id] || timeOf(at) > timeOf(out[key][id])) out[key][id] = at;
      });
    });
  });
  return out;
}

/** 1種類の記録（アプリ・ポイント・お店）を合わせる */
function mergeRecords(localList, remoteList, tomb) {
  const byId = new Map();
  const order = [];
  [localList || [], remoteList || []].forEach(list => list.forEach(item => {
    if (!item || typeof item.id !== 'string') return;
    const cur = byId.get(item.id);
    if (!cur) { byId.set(item.id, item); order.push(item.id); }
    else if (timeOf(item.updatedAt) > timeOf(cur.updatedAt)) byId.set(item.id, item);
  }));
  return order
    .map(id => byId.get(id))
    .filter(item => !(tomb && tomb[item.id] && timeOf(tomb[item.id]) >= timeOf(item.updatedAt)));
}

/** 2つのデータを合わせる（どちらの端末の変更も失わない） */
function mergeData(local, remote) {
  const tombstones = mergeTombstones(local.tombstones, remote.tombstones);
  const apps = mergeRecords(local.apps, remote.apps, tombstones.apps);
  const points = mergeRecords(local.points, remote.points, tombstones.points);
  const appIds = new Set(apps.map(a => a.id));
  const shops = mergeRecords(local.shops, remote.shops, tombstones.shops)
    .map(s => ({ ...s, appIds: (s.appIds || []).filter(id => appIds.has(id)) }));

  const limit = Date.now() - 30 * 86400000;
  const seen = new Set();
  const launchHistory = [...(local.launchHistory || []), ...(remote.launchHistory || [])]
    .filter(h => h && h.id && !seen.has(h.id) && seen.add(h.id))
    .filter(h => appIds.has(h.appId) && timeOf(h.launchedAt) >= limit)
    .sort((x, y) => timeOf(x.launchedAt) - timeOf(y.launchedAt));

  const genres = mergeGenres(local.genres, remote.genres);
  return { apps, points, shops, launchHistory, tombstones, genres };
}

/** 読み込んだデータの形を確かめる。だめならエラーの文を返す */
function validateImport(obj) {
  if (!obj || typeof obj !== 'object') return 'KAIKEI smoothのバックアップではありません。';
  const data = obj.data && typeof obj.data === 'object' ? obj.data : obj;
  if (obj.app && obj.app !== 'kaikei-smooth') return 'KAIKEI smoothのバックアップではありません。';
  for (const k of ['apps', 'points', 'shops', 'launchHistory']) {
    if (data[k] !== undefined && !Array.isArray(data[k])) return 'ファイルの中身が壊れています。';
  }
  if (!data.apps && !data.points && !data.shops) return 'KAIKEI smoothのバックアップではありません。';
  return '';
}

/* ===================== バックアップ（ファイルで移す） ===================== */

function backupObject() {
  return { app: 'kaikei-smooth', format: EXPORT_FORMAT, exportedAt: new Date().toISOString(), data: collectData() };
}

function backupFileName() {
  return `kaikei-smooth-backup-${today().replace(/-/g, '')}.json`;
}

/** ファイルに保存（iPhoneは「ファイル」アプリ、Androidは「ダウンロード」に保存される） */
function exportToFile() {
  const blob = new Blob([JSON.stringify(backupObject(), null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  showMessage('バックアップファイルを保存しました');
}

/** テキストでコピー（自分宛てのメールやメモに貼って移す時用） */
function exportToClipboard() {
  const text = JSON.stringify(backupObject());
  const box = document.getElementById('backup-text');
  box.value = text;
  const fallback = () => {
    box.hidden = false;
    box.focus();
    box.select();
    showMessage('下の欄を全選択してコピーしてください。');
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => showMessage('コピーしました。新しい端末の「テキストから読み込む」に貼り付けてください。'), fallback);
  } else fallback();
}

/** 読み込む（mode: 'merge'＝合わせる / 'replace'＝置き換える） */
async function importBackup(text, mode) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) {
    showMessage('読み込めませんでした。バックアップのファイル（.json）か、コピーしたテキストを使ってください。');
    return;
  }
  const err = validateImport(obj);
  if (err) { showMessage(err); return; }
  const incoming = obj.data && typeof obj.data === 'object' ? obj.data : obj;
  const n = (incoming.apps || []).length, m = (incoming.points || []).length;
  const msg = mode === 'replace'
    ? `アプリ${n}件・ポイント${m}件のデータで、この端末のデータを置き換えます。\n今この端末にあるデータは消えます。`
    : `アプリ${n}件・ポイント${m}件のデータを、この端末のデータと合わせます。\n同じものは新しい方が残ります。`;
  const yes = await confirmDialog(msg, { okLabel: mode === 'replace' ? '置き換える' : '合わせる', danger: mode === 'replace' });
  if (!yes) return;

  const data = mode === 'replace'
    ? mergeData({ apps: [], points: [], shops: [], launchHistory: [], tombstones: {} }, incoming)
    : mergeData(collectData(), incoming);
  if (mode === 'replace') {
    // 置き換えた時、この端末にだけあった記録が同期で戻ってこないように削除記録を付ける
    const now = new Date().toISOString();
    const keep = { apps: new Set(data.apps.map(a => a.id)), points: new Set(data.points.map(a => a.id)), shops: new Set(data.shops.map(a => a.id)) };
    const local = collectData();
    ['apps', 'points', 'shops'].forEach(k => (local[k] || []).forEach(item => {
      if (!keep[k].has(item.id)) { data.tombstones[k] = data.tombstones[k] || {}; data.tombstones[k][item.id] = now; }
    }));
  }
  applyData(data);
  showMessage('読み込みました');
  scheduleSync(0);
  renderSyncScreen();
}

/* ===================== 同期 ===================== */

function syncSettings() {
  return loadObject(SYNC_SETTINGS_KEY);
}

function saveSyncSettings(s) {
  try { localStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* 次回やり直す */ }
}

/** 同期コードを作る（例：K7QM-2XPA-9DRT-HV4N。約80ビットの乱数） */
function newSyncCode() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, b => CODE_CHARS[b % 32]).join('');
  return chars.match(/.{4}/g).join('-');
}

/** 入力されたコードを整える（小文字・空白・ハイフンなしでも受け付ける） */
function normalizeCode(input) {
  const s = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== 16 || /[^A-HJ-NP-Z2-9]/.test(s)) return '';
  return s.match(/.{4}/g).join('-');
}

/** 同期APIを呼ぶ */
async function callSyncApi(body) {
  const res = await fetch(SYNC_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  let json = {};
  try { json = await res.json(); } catch (e) { throw new Error('server'); }
  return { status: res.status, json };
}

let syncTimer = null;
let syncRunning = false;

/** 少し待ってから同期する（続けて保存した時に1回にまとめる） */
function scheduleSync(delay = SYNC_DEBOUNCE_MS) {
  if (!syncSettings().code) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow({ silent: true }), delay);
}

/**
 * 同期する：サーバーのデータを取ってきて、この端末のデータと合わせ、両方に書き戻す。
 * 他の端末が同時に書き込んでいたら（409）、もう一度やり直す。
 */
async function syncNow({ silent = false } = {}) {
  const s = syncSettings();
  if (!s.code || syncRunning) return false;
  if (!navigator.onLine) {
    if (!silent) showMessage('通信できないため、同期できませんでした。通信できる場所でもう一度試してください。');
    return false;
  }
  syncRunning = true;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const got = await callSyncApi({ action: 'get', code: s.code });
      if (got.status === 404 && s.version > 0) {
        // 一度同期できたのに見つからない＝ほかの端末で同期先が削除された。作り直さずに、この端末の同期を終える
        try { localStorage.removeItem(SYNC_SETTINGS_KEY); } catch (e) { /* 何もしない */ }
        clearTimeout(syncTimer);
        if (currentScreen === 'sync') renderSyncScreen();
        showMessage('同期先のデータが削除されたため、この端末の同期を終了しました。この端末のデータは残っています。');
        return false;
      }
      if (got.status !== 200 && got.status !== 404) throw new Error(got.json.error || 'server');
      const remote = got.status === 200 ? got.json.data || {} : {};
      const merged = mergeData(collectData(), remote);
      const put = await callSyncApi({ action: 'put', code: s.code, baseVersion: got.json.version || 0, data: merged });
      if (put.status === 409) continue;
      if (put.status !== 200) throw new Error(put.json.error || 'server');
      applyData(merged);
      saveSyncSettings({ ...syncSettings(), version: put.json.version, lastSyncAt: new Date().toISOString(), lastError: '' });
      refreshAfterSync();
      if (!silent) showMessage('同期しました');
      return true;
    }
    throw new Error('busy');
  } catch (e) {
    const msg = e.message === 'busy'
      ? 'ほかの端末と同時に同期していたため、うまくいきませんでした。'
      : '同期先のサーバーにつながりませんでした。';
    saveSyncSettings({ ...syncSettings(), lastError: msg });
    if (!silent) showMessage(msg + 'しばらくしてからもう一度試してください。');
    if (currentScreen === 'sync') renderSyncScreen();
    return false;
  } finally {
    syncRunning = false;
  }
}

/** 同期でデータが変わった時、いま開いている画面を描き直す（入力中の画面は描き直さない） */
function refreshAfterSync() {
  if (['home', 'apps', 'points', 'shops', 'sync'].includes(currentScreen)) SCREENS[currentScreen].render();
}

/** 同期を始める（新しい同期コードを作り、この端末のデータを置く） */
async function startSync() {
  if (!navigator.onLine) { showMessage('通信できる場所で始めてください。'); return; }
  for (let i = 0; i < 3; i++) {
    const code = newSyncCode();
    try {
      const put = await callSyncApi({ action: 'put', code, baseVersion: 0, data: collectData() });
      if (put.status === 409) continue; // 同じコードがすでにある（まず起きない）
      if (put.status !== 200) throw new Error('server');
      saveSyncSettings({ code, version: put.json.version, lastSyncAt: new Date().toISOString(), lastError: '' });
      renderSyncScreen();
      showMessage('同期を始めました。ほかの端末で同期コードを入れてください。');
      return;
    } catch (e) {
      showMessage('同期先のサーバーにつながりませんでした。サーバー（PHP）が使える場所で開いているか確認してください。');
      return;
    }
  }
}

/** ほかの端末で作った同期コードで、この端末をつなぐ */
async function joinSync(input) {
  const code = normalizeCode(input);
  if (!code) { setFieldError('sync-code-input', '同期コードは16文字です（例：K7QM-2XPA-9DRT-HV4N）。'); return; }
  setFieldError('sync-code-input', '');
  if (!navigator.onLine) { showMessage('通信できる場所でつないでください。'); return; }
  let got;
  try { got = await callSyncApi({ action: 'get', code }); } catch (e) {
    showMessage('同期先のサーバーにつながりませんでした。');
    return;
  }
  if (got.status === 404) { setFieldError('sync-code-input', 'この同期コードは見つかりませんでした。入力をもう一度確かめてください。'); return; }
  if (got.status !== 200) { showMessage('同期先のサーバーでエラーが起きました。'); return; }
  const remote = got.json.data || {};
  const local = collectData();
  const hasLocal = local.apps.length || local.points.length || local.shops.length;
  const yes = await confirmDialog(
    `同期先のデータ（アプリ${(remote.apps || []).length}件・ポイント${(remote.points || []).length}件）とつなぎます。` +
    (hasLocal ? `\nこの端末にあるデータ（アプリ${local.apps.length}件・ポイント${local.points.length}件）も合わせて、両方の端末で使えるようにします。` : ''),
    { okLabel: 'つなぐ' });
  if (!yes) return;
  saveSyncSettings({ code, version: got.json.version, lastSyncAt: '', lastError: '' });
  const ok = await syncNow({ silent: true });
  renderSyncScreen();
  showMessage(ok ? 'つなぎました。これからはどちらの端末で変えても同じデータになります。' : 'つなぎましたが、同期に失敗しました。「今すぐ同期」を押してください。');
}

/** この端末の同期をやめる（同期先のデータは残る） */
async function stopSync() {
  const yes = await confirmDialog('この端末の同期をやめますか？\nこの端末のデータと、同期先のデータはどちらも残ります。', { okLabel: 'やめる' });
  if (!yes) return;
  clearTimeout(syncTimer);
  try { localStorage.removeItem(SYNC_SETTINGS_KEY); } catch (e) { /* 何もしない */ }
  renderSyncScreen();
  showMessage('この端末の同期をやめました');
}

/** 同期先のデータを消す（ほかの端末も同期できなくなる） */
async function deleteRemote() {
  const s = syncSettings();
  if (!s.code) return;
  const yes = await confirmDialog('同期先（サーバー）のデータを削除しますか？\nこの同期コードを使っているほかの端末も、同期できなくなります。各端末のデータは残ります。', { okLabel: '削除する', danger: true });
  if (!yes) return;
  try {
    const r = await callSyncApi({ action: 'delete', code: s.code });
    if (r.status !== 200) throw new Error('server');
  } catch (e) {
    showMessage('削除できませんでした。通信できる場所でもう一度試してください。');
    return;
  }
  try { localStorage.removeItem(SYNC_SETTINGS_KEY); } catch (e) { /* 何もしない */ }
  renderSyncScreen();
  showMessage('同期先のデータを削除しました');
}

/** 同期用のURL（QRコードにする。読み取ると本アプリが開き、コードが入った状態になる） */
function syncJoinUrl(code) {
  return `${location.origin}${location.pathname}#sync=${code}`;
}

/** URLの #sync=〇〇 で開かれた時に、つなぐか聞く */
function handleSyncHash() {
  const m = location.hash.match(/^#sync=([A-Za-z0-9-]{16,19})$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  const code = normalizeCode(m[1]);
  if (!code) return;
  if (syncSettings().code === code) { showScreen('sync'); return; }
  showScreen('sync');
  document.getElementById('sync-code-input').value = code;
  joinSync(code);
}

/* ===================== 画面（S09） ===================== */

function formatDateTime(iso) {
  const t = timeOf(iso);
  if (!t) return 'まだ';
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** QRコード（SVG）を描く */
function renderQr(el, text) {
  if (typeof qrcode !== 'function') { el.hidden = true; return; }
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  el.hidden = false;
}

function renderSyncScreen() {
  const s = syncSettings();
  const on = !!s.code;
  document.getElementById('sync-off').hidden = on;
  document.getElementById('sync-on').hidden = !on;
  if (on) {
    document.getElementById('sync-code').textContent = s.code;
    document.getElementById('sync-last').textContent = `最後に同期：${formatDateTime(s.lastSyncAt)}`;
    const err = document.getElementById('sync-error');
    err.textContent = s.lastError || '';
    err.hidden = !s.lastError;
    const url = syncJoinUrl(s.code);
    document.getElementById('sync-url').textContent = url;
    renderQr(document.getElementById('sync-qr'), url);
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    document.getElementById('sync-local-note').hidden = !local;
  } else {
    setFieldError('sync-code-input', '');
  }
  const d = collectData();
  document.getElementById('backup-summary').textContent =
    `この端末のデータ：アプリ${d.apps.length}件・ポイント${d.points.length}件・お店${d.shops.length}件`;
  document.getElementById('backup-text').hidden = true;
}

function copySyncCode() {
  const code = syncSettings().code;
  if (!code) return;
  const done = () => showMessage('同期コードをコピーしました');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, () => showMessage(`同期コード：${code}`));
  else showMessage(`同期コード：${code}`);
}

/** S09のボタンなどを設定する（app.js の init から呼ぶ） */
function initSyncScreen() {
  document.getElementById('btn-sync-start').addEventListener('click', startSync);
  document.getElementById('form-sync-join').addEventListener('submit', e => {
    e.preventDefault();
    joinSync(document.getElementById('sync-code-input').value);
  });
  document.getElementById('btn-sync-now').addEventListener('click', () => syncNow());
  document.getElementById('btn-sync-copy').addEventListener('click', copySyncCode);
  document.getElementById('btn-sync-stop').addEventListener('click', stopSync);
  document.getElementById('btn-sync-delete').addEventListener('click', deleteRemote);

  document.getElementById('btn-export-file').addEventListener('click', exportToFile);
  document.getElementById('btn-export-copy').addEventListener('click', exportToClipboard);
  document.getElementById('import-file').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { showMessage('ファイルが大きすぎます。バックアップのファイルを選んでください。'); return; }
    importBackup(await file.text(), importMode());
  });
  document.getElementById('btn-import-text').addEventListener('click', () => {
    const text = document.getElementById('import-text').value.trim();
    if (!text) { showMessage('コピーしたテキストを貼り付けてください。'); return; }
    importBackup(text, importMode()).then(() => { document.getElementById('import-text').value = ''; });
  });

  // 他のアプリから戻ってきた時・通信が戻った時に同期する
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleSync(500); });
  window.addEventListener('online', () => scheduleSync(500));
}

function importMode() {
  const r = document.querySelector('input[name="import-mode"]:checked');
  return r ? r.value : 'merge';
}
