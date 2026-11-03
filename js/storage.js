// storage.js データの読み書き（詳細設計書 7.1・7.2・7.5）
// データは端末のブラウザ内（localStorage）に保存する。
// 同期（js/sync.js）を始めた場合だけ、同期先のサーバーにも保存される。
'use strict';

const KEYS = {
  APPS: 'apps',
  HISTORY: 'launchHistory',
  POINTS: 'points',
  SHOPS: 'shops',
  NOTICE: 'noticeShown',
  TOMBSTONES: 'syncTombstones', // 削除した記録（同期で別の端末から復活しないようにする）
  GENRES: 'genreSettings',      // ジャンルの作成・変更（js/genres.js）
};

/** 1件ずつ「いつ変わったか」を記録するキー（同期・読み込みで合わせる時に、新しい方を残すため） */
const STAMPED_KEYS = [KEYS.APPS, KEYS.POINTS, KEYS.SHOPS];

/** キーの配列を読み出す。なければ・壊れていれば空配列 */
function load(key) {
  try {
    const text = localStorage.getItem(key);
    if (!text) return [];
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch (e) {
    return [];
  }
}

/** オブジェクトを読む（なければ空オブジェクト） */
function loadObject(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (e) {
    return {};
  }
}

/** updatedAt を除いた中身（変わったかどうかの比較用） */
function contentOf(item) {
  const { updatedAt, ...rest } = item;
  return JSON.stringify(rest);
}

/**
 * 変わった記録に updatedAt を付け、消えた記録を削除記録（tombstone）に残す。
 * 各画面のコードは今までどおり save() を呼ぶだけでよい。
 */
function stampChanges(key, list) {
  const now = new Date().toISOString();
  const prev = load(key);
  const prevById = new Map(prev.map(p => [p.id, p]));
  list.forEach(item => {
    const before = prevById.get(item.id);
    if (!before || contentOf(before) !== contentOf(item) || !item.updatedAt) item.updatedAt = now;
  });
  const ids = new Set(list.map(i => i.id));
  const removed = prev.filter(p => !ids.has(p.id));
  if (removed.length) {
    const tomb = loadObject(KEYS.TOMBSTONES);
    tomb[key] = tomb[key] || {};
    removed.forEach(p => { tomb[key][p.id] = now; });
    writeRaw(KEYS.TOMBSTONES, tomb);
  }
}

/** そのまま書き込む（同期・読み込みで、合わせた結果を書き戻す時に使う） */
function writeRaw(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    showMessage('データを保存できませんでした。ブラウザの設定を確認してください。');
    return false;
  }
}

/** 配列をJSON文字列にして保存する。失敗時はメッセージを出してfalse */
function save(key, list) {
  if (STAMPED_KEYS.includes(key)) stampChanges(key, list);
  const ok = writeRaw(key, list);
  // 同期を使っている時は、少し待ってからまとめて同期する
  if (ok && typeof scheduleSync === 'function' && key !== KEYS.NOTICE) scheduleSync();
  return ok;
}

/** true/false の記録を読む（noticeShown用） */
function loadFlag(key) {
  try {
    return localStorage.getItem(key) === 'true';
  } catch (e) {
    return false;
  }
}

/** true/false の記録を保存する */
function saveFlag(key, value) {
  try {
    localStorage.setItem(key, String(!!value));
  } catch (e) {
    /* 保存できなくても動作は続ける */
  }
}

/** アプリ本体、その起動履歴、店舗の紐付けをまとめて削除する */
function deleteApp(appId) {
  save(KEYS.APPS, load(KEYS.APPS).filter(a => a.id !== appId));
  save(KEYS.HISTORY, load(KEYS.HISTORY).filter(h => h.appId !== appId));
  save(KEYS.SHOPS, load(KEYS.SHOPS).map(s => ({ ...s, appIds: (s.appIds || []).filter(id => id !== appId) })));
}
