// sync.js データの移行（S09 設定のバックアップ）
//
// バックアップ（ファイルで移す）：データを1つのJSONファイルに書き出し、別の端末で読み込む。サーバー不要。
//
// 合わせ方（マージ）：アプリ・ポイント・お店は1件ずつ updatedAt（最後に変わった時刻）を比べ、新しい方を残す。
//   削除した記録は削除記録（syncTombstones）を残し、読み込んだバックアップから復活しないようにする。
//   起動履歴は両方の分を合わせ、30日より古いもの・削除したアプリの分を除く。
'use strict';

const OLD_SYNC_SETTINGS_KEY = 'syncSettings'; // 以前の同期機能の設定。残っていたら消す
const TOMBSTONE_KEEP_DAYS = 90;
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

/** 2つのデータを合わせる（どちらの変更も失わない） */
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

/** ログ用の件数 */
function backupCounts(d) {
  return { アプリ: (d.apps || []).length, ポイント: (d.points || []).length, お店: (d.shops || []).length };
}

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
  logInfo('X02', 'バックアップをファイルに保存した', backupCounts(collectData()));
  showMessage('バックアップファイルを保存しました');
}

/** テキストでコピー（自分宛てのメールやメモに貼って移す時用） */
function exportToClipboard() {
  const text = JSON.stringify(backupObject());
  const box = document.getElementById('backup-text');
  box.value = text;
  const fallback = err => {
    if (err) logError('X02', 'バックアップをクリップボードにコピーできなかった（手でコピーしてもらう）', err);
    box.hidden = false;
    box.focus();
    box.select();
    showMessage('下の欄を全選択してコピーしてください。');
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      logInfo('X02', 'バックアップをテキストでコピーした', backupCounts(collectData()));
      showMessage('コピーしました。新しい端末の「テキストから読み込む」に貼り付けてください。');
    }, fallback);
  } else fallback();
}

/** 読み込む（mode: 'merge'＝合わせる / 'replace'＝置き換える） */
async function importBackup(text, mode) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) {
    logError('X02', 'バックアップを読み込めなかった（形式が違う）', e, { 文字数: text.length });
    showMessage('読み込めませんでした。バックアップのファイル（.json）か、コピーしたテキストを使ってください。');
    return;
  }
  const err = validateImport(obj);
  if (err) {
    logError('X02', 'バックアップを読み込めなかった（中身が違う）', null, { 理由: err });
    showMessage(err);
    return;
  }
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
    // 置き換えた時、この端末にだけあった記録が後で別のバックアップから戻ってこないように削除記録を付ける
    const now = new Date().toISOString();
    const keep = { apps: new Set(data.apps.map(a => a.id)), points: new Set(data.points.map(a => a.id)), shops: new Set(data.shops.map(a => a.id)) };
    const local = collectData();
    ['apps', 'points', 'shops'].forEach(k => (local[k] || []).forEach(item => {
      if (!keep[k].has(item.id)) { data.tombstones[k] = data.tombstones[k] || {}; data.tombstones[k][item.id] = now; }
    }));
  }
  applyData(data);
  logInfo('X02', mode === 'replace' ? 'バックアップを読み込んで置き換えた' : 'バックアップを読み込んで合わせた', backupCounts(data));
  showMessage('読み込みました');
  renderSyncScreen();
}

/* ===================== 画面（S09） ===================== */

function renderSyncScreen() {
  const d = collectData();
  document.getElementById('backup-summary').textContent =
    `この端末のデータ：アプリ${d.apps.length}件・ポイント${d.points.length}件・お店${d.shops.length}件`;
  document.getElementById('backup-text').hidden = true;
}

/** S09のボタンなどを設定する（app.js の init から呼ぶ） */
function initSyncScreen() {
  try { localStorage.removeItem(OLD_SYNC_SETTINGS_KEY); } catch (e) { /* 何もしない */ }

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
}

function importMode() {
  const r = document.querySelector('input[name="import-mode"]:checked');
  return r ? r.value : 'merge';
}
