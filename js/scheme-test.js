// scheme-test.js URLスキームの候補を実機で試し、○×を記録するテスト用ページ（scheme-test.html）
// 本番の画面からはリンクしていない。結果は localStorage の 'schemeTest' に保存する。
'use strict';

const ST_KEY = 'schemeTest';
const PLATFORM = detectPlatform();
const PLATFORM_NAME = { ios: 'iPhone', android: 'Android', other: 'PC（スマホで開いてください）' }[PLATFORM];
let stFilter = 'todo';

function stLoad() {
  try { return JSON.parse(localStorage.getItem(ST_KEY)) || {}; } catch (e) { return {}; }
}
function stSave(data) {
  try { localStorage.setItem(ST_KEY, JSON.stringify(data)); } catch (e) { showMessage('結果を保存できませんでした。'); }
}
/** 結果のキー：端末の種類ごとに分ける */
function stKey(pid, scheme) { return `${PLATFORM}|${pid}|${scheme}`; }

/** 端末で使えるプリセット */
const ST_APPS = PRESETS.filter(p => (PLATFORM === 'ios' ? p.iosAppId : PLATFORM === 'android' ? p.androidPackage : true));

/** 候補（プリセットの候補＋この端末で追加入力したもの） */
function stCandidates(p, data) {
  const extra = Object.keys(data)
    .filter(k => k.startsWith(`${PLATFORM}|${p.pid}|`))
    .map(k => k.split('|').slice(2).join('|'))
    .filter(s => !p.schemeCandidates.includes(s));
  return [...p.schemeCandidates, ...extra];
}

/** アプリの状態：ok（○あり）/ ng（全部×）/ todo（未テストあり） */
function stAppState(p, data) {
  const marks = stCandidates(p, data).map(s => data[stKey(p.pid, s)]);
  if (marks.includes('ok')) return 'ok';
  if (marks.length && marks.every(m => m === 'ng')) return 'ng';
  return 'todo';
}

/** 試す：iPhoneはそのまま、Androidはパッケージ名を付けたintent（別のアプリが開くのを防ぐ） */
function stTry(p, scheme) {
  if (PLATFORM === 'android' && p.androidPackage) {
    const m = scheme.match(/^([a-z][a-z0-9+.\-]*):(?:\/\/)?(.*)$/i);
    if (m) {
      // フォールバックURLを付けない：間違っていればGoogle Playが開く（＝×）
      window.location.href = `intent://${m[2]}#Intent;scheme=${m[1]};package=${p.androidPackage};end`;
      return;
    }
  }
  window.location.href = scheme;
}

function stRender() {
  const data = stLoad();
  document.getElementById('st-platform').textContent = `この端末：${PLATFORM_NAME}（${ST_APPS.length}アプリ）`;

  const states = ST_APPS.map(p => stAppState(p, data));
  const count = s => states.filter(x => x === s).length;
  document.getElementById('st-summary').innerHTML =
    `<span>○ 開けた ${count('ok')}</span><span>× 全滅 ${count('ng')}</span><span>未テスト ${count('todo')}</span>`;

  const filters = [['todo', '未テスト'], ['ok', '○'], ['ng', '×'], ['all', 'すべて']];
  const fBox = document.getElementById('st-filters');
  fBox.innerHTML = filters.map(([id, name]) =>
    `<button type="button" class="chip" data-f="${id}" aria-pressed="${id === stFilter}">${name}</button>`).join('');
  fBox.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => { stFilter = b.dataset.f; stRender(); }));

  const list = ST_APPS.filter((p, i) => stFilter === 'all' || states[i] === stFilter);
  const box = document.getElementById('st-list');
  box.innerHTML = list.map(p => {
    const rows = stCandidates(p, data).map(s => {
      const mark = data[stKey(p.pid, s)] || '';
      return `<div class="st-row">
        <button type="button" class="st-try" data-try="${esc(p.pid)}" data-s="${esc(s)}">${esc(s)}</button>
        <button type="button" class="st-mark ok" data-mark="ok" data-pid="${esc(p.pid)}" data-s="${esc(s)}" aria-pressed="${mark === 'ok'}" aria-label="${esc(s)}で開けた">○</button>
        <button type="button" class="st-mark ng" data-mark="ng" data-pid="${esc(p.pid)}" data-s="${esc(s)}" aria-pressed="${mark === 'ng'}" aria-label="${esc(s)}で開けなかった">×</button>
      </div>`;
    }).join('');
    return `<section class="st-app">
      <div class="st-app-head">
        <span class="app-icon sm" style="background:${iconColor(p.name)}" aria-hidden="true">${esc(p.icon)}</span>
        <span class="st-app-name">${esc(p.name)}</span>
        <span class="st-level ${esc(p.schemeLevel)}">${{ T: '開けた', N: 'ストアを開く' }[p.schemeLevel] || ''}</span>
      </div>
      ${rows}
      <form class="st-custom" data-custom="${esc(p.pid)}">
        <input type="text" placeholder="ほかの候補を入力（例：example://）" autocapitalize="off" autocomplete="off" spellcheck="false" aria-label="${esc(p.name)}のほかの候補">
        <button type="submit" class="btn btn-ghost">追加</button>
      </form>
    </section>`;
  }).join('') || '<p class="empty-text">該当するアプリはありません。</p>';

  box.querySelectorAll('[data-try]').forEach(b => b.addEventListener('click', () => {
    stTry(PRESETS.find(p => p.pid === b.dataset.try), b.dataset.s);
  }));
  box.querySelectorAll('[data-mark]').forEach(b => b.addEventListener('click', () => {
    const d = stLoad();
    const key = stKey(b.dataset.pid, b.dataset.s);
    d[key] = d[key] === b.dataset.mark ? '' : b.dataset.mark; // 同じボタンをもう一度押すと取り消し
    stSave(d);
    stRender();
  }));
  box.querySelectorAll('[data-custom]').forEach(f => f.addEventListener('submit', e => {
    e.preventDefault();
    let s = f.querySelector('input').value.trim();
    if (!s) return;
    if (!/:/.test(s)) s += '://';
    if (!/^[a-z][a-z0-9+.\-]*:/i.test(s)) { showMessage('「example://」の形で入力してください。'); return; }
    const d = stLoad();
    const key = stKey(f.dataset.custom, s);
    if (!(key in d)) d[key] = '';
    stSave(d);
    stRender();
  }));
}

/** チームに送る結果テキスト */
function stResultText() {
  const data = stLoad();
  const lines = [`URLスキーム テスト結果（${PLATFORM_NAME}・${new Date().toLocaleString('ja-JP')}）`, `UA: ${navigator.userAgent}`, ''];
  ST_APPS.forEach(p => {
    const marks = stCandidates(p, data).map(s => [s, data[stKey(p.pid, s)] || '']);
    if (!marks.some(([, m]) => m)) return;
    lines.push(`${p.name}（${p.pid}）: ` + marks.map(([s, m]) => `${s} ${m === 'ok' ? '○' : m === 'ng' ? '×' : '－'}`).join(' / '));
  });
  if (lines.length === 3) lines.push('（まだ結果がありません）');
  return lines.join('\n');
}

document.getElementById('st-copy').addEventListener('click', () => {
  const text = stResultText();
  const out = document.getElementById('st-output');
  out.value = text;
  out.hidden = false;
  const done = () => showMessage('結果をコピーしました。チャットに貼り付けてください。');
  const fallback = () => { out.focus(); out.select(); showMessage('下の欄を全選択してコピーしてください。'); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
});

document.getElementById('st-clear').addEventListener('click', async () => {
  const yes = await confirmDialog(`${PLATFORM_NAME}のテスト結果をすべて消しますか？`, { okLabel: '消す', danger: true });
  if (!yes) return;
  const d = stLoad();
  Object.keys(d).filter(k => k.startsWith(`${PLATFORM}|`)).forEach(k => delete d[k]);
  stSave(d);
  document.getElementById('st-output').hidden = true;
  stRender();
});

// 他のアプリから戻ってきたら描き直す
document.addEventListener('visibilitychange', () => { if (!document.hidden) stRender(); });
stRender();
