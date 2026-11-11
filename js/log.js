// log.js ログ出力（運用担当者向け：障害の原因調査・利用状況の分析）
//
// チームで統一するきまり（README「ログ出力」も参照）
//  ・レベルは2つ：INFO＝各機能が正常に処理を完了した時 / ERROR＝処理中に異常が起きた時
//  ・機能名は LOG_FUNCS の機能ID（F01〜F11・X01〜X04・SYS）で指定する。ここにない機能IDは使わない
//  ・形式（1行）：日時 レベル [機能ID 機能名] メッセージ 詳細（key=value をスペース区切り）#セッション
//      例）2026-11-11 16:05:12.345 INFO  [F07 ポイント情報管理] ポイントを追加した id=m3k9x2 #a1b2
//  ・保存先：この端末のブラウザの localStorage（キー appLog）。DB・サーバーには保存しない
//    新しい方から最大 LOG_MAX 件を残す。設定画面の「ログ」からファイル（.log）に保存・消去できる
//  ・ブラウザの開発者ツールのコンソールにも同じ1行を出す
//  ・メモ・パスワードなどの個人的な内容はログに書かない（IDと名前・件数程度にする）
'use strict';

const LOG_KEY = 'appLog';
const LOG_MAX = 1000;          // 残す件数（古いものから消す）
const LOG_MSG_MAX = 300;       // 1件の文字数の上限

/** 機能ID → 機能名（ログの機能名はここで統一する） */
const LOG_FUNCS = {
  F01: 'ホーム表示',
  F02: 'アプリ登録',
  F03: 'アプリ起動',
  F04: '起動履歴記録',
  F05: '並び替え',
  F06: 'アプリ管理',
  F07: 'ポイント情報管理',
  F08: '有効期限お知らせ',
  F09: 'オフライン動作',
  F10: '初回注意表示',
  F11: '店舗ショートカット',
  X01: 'ジャンル',
  X02: 'データ移行',
  X03: 'ホーム画面アイコン',
  X04: 'データリセット',
  SYS: 'システム共通',
};

/** ページを開くたびに変わる短いID（同じ回の操作をまとめて追えるようにする） */
const LOG_SESSION = Math.random().toString(36).slice(2, 6);

/** ログを読む（壊れていれば空） */
function readLogs() {
  try {
    const v = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

/** ログを書く。容量が足りない時は古い半分を消してもう一度試す（それでもだめならコンソールだけ） */
function writeLogs(list) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(list));
  } catch (e) {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(Math.floor(list.length / 2)))); } catch (e2) { /* 保存しない */ }
  }
}

/** 詳細（オブジェクト）を「key=value」の並びにする */
function logDetailText(detail) {
  if (detail === undefined || detail === null || detail === '') return '';
  if (typeof detail !== 'object') return String(detail);
  return Object.entries(detail)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v).replace(/\s+/g, ' ')}`)
    .join(' ');
}

/** エラー（Error・文字列など）を短い文字にする */
function errorText(err) {
  if (!err) return '';
  if (err instanceof Error) {
    const at = (err.stack || '').split('\n').map(s => s.trim()).find(s => /^at |@/.test(s)) || '';
    return `${err.name}: ${err.message}${at ? ' (' + at.replace(/^at /, '') + ')' : ''}`;
  }
  return typeof err === 'object' ? JSON.stringify(err) : String(err);
}

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

/** 日時を「2026-11-11 16:05:12.345」（端末の時刻）にする */
function logTimeText(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** 1件を統一形式の1行にする */
function formatLogLine(e) {
  const name = LOG_FUNCS[e.fn] || '不明な機能';
  return `${logTimeText(e.t)} ${e.level.padEnd(5)} [${e.fn} ${name}] ${e.msg}${e.detail ? ' ' + e.detail : ''} #${e.sid}`;
}

/** ログを1件記録する（各機能からは logInfo / logError を使う） */
function writeLog(level, fn, msg, detail) {
  try {
    if (!LOG_FUNCS[fn]) fn = 'SYS';
    const entry = {
      t: new Date().toISOString(),
      level,
      fn,
      msg: String(msg || '').slice(0, LOG_MSG_MAX),
      detail: logDetailText(detail).slice(0, LOG_MSG_MAX),
      sid: LOG_SESSION,
    };
    const line = formatLogLine(entry);
    if (level === 'ERROR') console.error(line); else console.info(line);
    const list = readLogs();
    list.push(entry);
    writeLogs(list.length > LOG_MAX ? list.slice(list.length - LOG_MAX) : list);
  } catch (e) {
    /* ログのせいでアプリが止まらないようにする */
  }
}

/** INFO：機能が正常に処理を完了した時 */
function logInfo(fn, msg, detail) {
  writeLog('INFO', fn, msg, detail);
}

/** ERROR：処理中に異常が起きた時。err には catch した Error などを渡す */
function logError(fn, msg, err, detail) {
  const d = typeof detail === 'object' && detail ? { ...detail } : (detail ? { info: detail } : {});
  if (err) d.error = errorText(err);
  writeLog('ERROR', fn, msg, d);
}

/** 想定していないエラー（どの機能でも catch されなかったもの）も記録する */
window.addEventListener('error', e => {
  const where = e.filename ? `${e.filename.split('/').pop()}:${e.lineno}:${e.colno}` : '';
  logError('SYS', '想定外のエラーが起きた', e.error || e.message, { where });
});
window.addEventListener('unhandledrejection', e => {
  logError('SYS', '想定外のエラーが起きた（非同期処理）', e.reason);
});

/* ===================== 設定画面の「ログ」 ===================== */

function renderLogSetting() {
  const list = readLogs();
  const errors = list.filter(e => e.level === 'ERROR').length;
  document.getElementById('log-summary').textContent =
    list.length ? `記録しているログ：${list.length}件（うちERROR ${errors}件）` : '記録しているログはありません。';
  document.getElementById('log-recent').textContent = list.slice(-30).reverse().map(formatLogLine).join('\n');
}

/** ログをファイル（.log）に保存する */
function exportLogs() {
  const list = readLogs();
  if (!list.length) { showMessage('保存するログはありません'); return; }
  const header = `# KAIKEI smooth ログ  保存日時=${logTimeText(new Date().toISOString())}  件数=${list.length}  端末=${detectPlatform()}\n`;
  const blob = new Blob([header + list.map(formatLogLine).join('\n') + '\n'], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kaikei-smooth-log-${today().replace(/-/g, '')}.log`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  logInfo('SYS', 'ログをファイルに保存した', { 件数: list.length });
  showMessage('ログを保存しました');
}

async function clearLogs() {
  const yes = await confirmDialog('記録しているログをすべて消しますか？\n登録したアプリやポイントは消えません。', { okLabel: '消す', danger: true });
  if (!yes) return;
  const n = readLogs().length;
  writeLogs([]);
  logInfo('SYS', 'ログを消去した', { 件数: n });
  renderLogSetting();
  showMessage('ログを消しました');
}

function initLogSetting() {
  document.getElementById('btn-log-export').addEventListener('click', exportLogs);
  document.getElementById('btn-log-clear').addEventListener('click', clearLogs);
}
