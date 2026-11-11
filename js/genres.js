// genres.js ジャンル（アプリの分類）の作成・変更（S10 ジャンルの編集・S11 ジャンルの作成・変更）
//
// 標準のジャンル … tools/apps_data.py の CATEGORIES（1つ8件まで）。一覧のアプリは必ず1つのジャンルだけに入る（重複なし）。
//                   一覧にないアプリ（手入力で追加したもの）は「その他」。
// 利用者の変更 … 新しいジャンルを作る・標準のジャンルの名前やアプリを変える・標準のジャンルを隠す。
//                 変更したジャンルでは、1つのアプリを複数のジャンルに入れられる（重複あり）。
//
// 保存（localStorage の genreSettings。同期・バックアップの対象）：
//   { custom:   [{ id, name, members: [アプリのキー] }],                 … 自分で作ったジャンル
//     defaults: { 標準のジャンルのid: { name, added: [キー], removed: [キー], hidden } }, … 標準のジャンルへの変更
//     updatedAt }
// アプリのキー：一覧のアプリは 'p:'＋一覧のid（登録前でも登録後でも同じ）、手入力のアプリは 'a:'＋登録したアプリのid
'use strict';

const OTHER_GENRE = { id: 'other', name: 'その他' };
const GENRE_NAME_MAX = 20;

let genreReturn = 'apps';    // ジャンルの編集を閉じた時に戻る画面
let currentGenreId = null;   // S11で編集中のジャンル（新規は null）
let genreDraft = new Set();  // S11で選んでいるアプリのキー
let genreOrder = [];         // S11の並び（開いた時に入っていたアプリを先頭にする）

/* ===================== データ ===================== */

function loadGenreSettings() {
  const s = loadObject(KEYS.GENRES);
  return {
    custom: Array.isArray(s.custom) ? s.custom.filter(g => g && typeof g.id === 'string' && typeof g.name === 'string') : [],
    defaults: s.defaults && typeof s.defaults === 'object' && !Array.isArray(s.defaults) ? s.defaults : {},
    updatedAt: s.updatedAt || '',
  };
}

function saveGenreSettings(s) {
  return writeRaw(KEYS.GENRES, { custom: s.custom, defaults: s.defaults, updatedAt: new Date().toISOString() });
}

/** 標準のまま（何も変えていない）か */
function genreSettingsEmpty(s) {
  return !s.custom.length && !Object.keys(s.defaults).length;
}

function presetOf(app) {
  return app.presetId ? PRESETS.find(p => p.pid === app.presetId) : null;
}

/** 登録したアプリのキー */
function appGenreKey(app) {
  return presetOf(app) ? 'p:' + app.presetId : 'a:' + app.id;
}

/** 標準のジャンルに最初から入っているアプリのキー */
function defaultGenreMembers(id) {
  if (id === OTHER_GENRE.id) return load(KEYS.APPS).filter(a => !presetOf(a)).map(a => 'a:' + a.id);
  return PRESETS.filter(p => p.cat === id).map(p => 'p:' + p.pid);
}

const arr = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);

/** すべてのジャンル（自分で作ったもの → 標準の順）。members はアプリのキーの Set */
function getGenres() {
  const s = loadGenreSettings();
  const custom = s.custom.map(g => ({
    id: g.id, name: g.name, isDefault: false, hidden: false, edited: true, members: new Set(arr(g.members)),
  }));
  const defaults = [...PRESET_CATEGORIES, OTHER_GENRE].map(c => {
    const o = s.defaults[c.id] || {};
    const members = new Set(defaultGenreMembers(c.id));
    arr(o.removed).forEach(k => members.delete(k));
    arr(o.added).forEach(k => members.add(k));
    return {
      id: c.id, name: (typeof o.name === 'string' && o.name) || c.name, defaultName: c.name, isDefault: true,
      hidden: !!o.hidden, edited: !!(o.name || arr(o.added).length || arr(o.removed).length), members,
    };
  });
  return [...custom, ...defaults];
}

/**
 * 1つのアプリが入るジャンルを wanted（ジャンルのidの Set）にそろえる（S12 アプリの編集から）。
 * 最初のジャンルは「足した・外した」として記録するので、ほかのジャンルとの重複もできる。隠したジャンルは変えない。
 */
function setAppGenres(key, wanted) {
  const s = loadGenreSettings();
  let changed = false;
  getGenres().filter(g => !g.hidden).forEach(g => {
    const want = wanted.has(g.id);
    if (g.members.has(key) === want) return;
    changed = true;
    if (g.isDefault) {
      const base = new Set(defaultGenreMembers(g.id));
      const o = { name: '', hidden: false, ...(s.defaults[g.id] || {}) };
      o.added = arr(o.added).filter(k => k !== key);
      o.removed = arr(o.removed).filter(k => k !== key);
      if (want && !base.has(key)) o.added.push(key);
      if (!want && base.has(key)) o.removed.push(key);
      if (!o.name && !o.added.length && !o.removed.length && !o.hidden) delete s.defaults[g.id];
      else s.defaults[g.id] = o;
    } else {
      const c = s.custom.find(x => x.id === g.id);
      c.members = want ? [...arr(c.members), key] : arr(c.members).filter(k => k !== key);
    }
  });
  if (!changed) return true;
  const ok = saveGenreSettings(s);
  if (ok) logInfo('X01', 'アプリの入るジャンルを変えた', { app: key, ジャンル: [...wanted].join(',') });
  return ok;
}

/** タグに出すジャンル：隠していないもので、keys のアプリが1つ以上入っているもの */
function genresFor(keys) {
  const set = new Set(keys);
  return getGenres().filter(g => !g.hidden && [...g.members].some(k => set.has(k)));
}

/** ジャンルのタグ（「すべて」＋ジャンル）を描く。from を渡した時だけ最後に「✎ ジャンルを編集」を付ける（ホームでは付けない） */
function renderGenreChips(boxId, genres, selected, onSelect, from) {
  const box = document.getElementById(boxId);
  box.innerHTML = [{ id: 'all', name: 'すべて' }, ...genres].map(g =>
    `<button type="button" class="chip" data-cat="${esc(g.id)}" aria-pressed="${g.id === selected ? 'true' : 'false'}">${esc(g.name)}</button>`
  ).join('') + (from ? '<button type="button" class="chip chip-edit" data-genre-edit>✎ ジャンルを編集</button>' : '');
  box.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => onSelect(b.dataset.cat)));
  if (from) box.querySelector('[data-genre-edit]').addEventListener('click', () => openGenres(from));
}

/* ===================== S10 ジャンルの編集 ===================== */

function openGenres(from) {
  genreReturn = from || 'home';
  showScreen('genres');
}

/** 選べるアプリ（この端末で使える一覧のアプリ＋手入力で登録したアプリ） */
function genreCandidates() {
  const platform = detectPlatform();
  const apps = load(KEYS.APPS);
  const registered = new Set(apps.map(appGenreKey));
  return [
    ...PRESETS.filter(p => presetAvailable(p, platform)).map(p => ({
      key: 'p:' + p.pid, name: p.name, words: [p.name, p.note, ...(p.kana || '').split(' ')],
      icon: `<span class="app-icon sm" style="background:${iconColor(p.name)}" aria-hidden="true">${esc(p.icon)}</span>`,
      registered: registered.has('p:' + p.pid),
    })),
    ...apps.filter(a => !presetOf(a)).map(a => ({
      key: 'a:' + a.id, name: a.name, words: [a.name], icon: appIconHtml(a, true), registered: true,
    })),
  ];
}

function renderGenres() {
  const cands = genreCandidates();
  const nameOf = new Map(cands.map(c => [c.key, c.name]));
  const genres = getGenres();
  document.getElementById('genres-list').innerHTML = genres.map(g => {
    const names = [...g.members].filter(k => nameOf.has(k)).map(k => nameOf.get(k));
    const badge = g.hidden ? '<span class="badge badge-none">非表示</span>'
      : !g.isDefault ? '<span class="badge badge-ok">自分で作成</span>'
      : g.edited ? '<span class="badge badge-warning">変更あり</span>' : '';
    const sub = names.length ? `${names.length}件：${names.slice(0, 4).join('・')}${names.length > 4 ? '…' : ''}` : 'アプリが入っていません';
    return `<li class="list-item${g.hidden ? ' is-hidden' : ''}">
      <button type="button" class="shop-open" data-genre="${esc(g.id)}">
        <div class="list-name">${esc(g.name)} ${badge}</div>
        <div class="list-sub">${esc(sub)}</div>
      </button>
      <span class="genre-chev" aria-hidden="true">›</span>
    </li>`;
  }).join('');
  document.querySelectorAll('#genres-list [data-genre]').forEach(b => b.addEventListener('click', () => openGenreEdit(b.dataset.genre)));
  document.getElementById('btn-genres-reset').disabled = genreSettingsEmpty(loadGenreSettings());
}

async function resetAllGenres() {
  const yes = await confirmDialog('自分で作ったジャンルを削除し、標準のジャンルを最初の状態に戻しますか？\n登録したアプリは消えません。', { okLabel: '元に戻す', danger: true });
  if (!yes) return;
  if (saveGenreSettings({ custom: [], defaults: {} })) {
    logInfo('X01', 'ジャンルをすべて最初の状態に戻した');
    showMessage('ジャンルを最初の状態に戻しました');
  }
  renderGenres();
}

/* ===================== S11 ジャンルの作成・変更 ===================== */

function openGenreEdit(id) {
  currentGenreId = id || null;
  const g = id ? getGenres().find(x => x.id === id) : null;
  genreDraft = new Set(g ? g.members : []);
  genreOrder = genreCandidates().map(c => c.key).sort((a, b) => (genreDraft.has(b) ? 1 : 0) - (genreDraft.has(a) ? 1 : 0));
  showScreen('genre-edit');
}

function renderGenreEdit() {
  const g = currentGenreId ? getGenres().find(x => x.id === currentGenreId) : null;
  if (currentGenreId && !g) { showScreen('genres'); return; }
  document.getElementById('screen-title').textContent = g ? 'ジャンルを変更' : 'ジャンルを作る';
  document.getElementById('genre-name').value = g ? g.name : '';
  document.getElementById('genre-query').value = '';
  document.getElementById('genre-visible-row').hidden = !(g && g.isDefault);
  document.getElementById('genre-visible').checked = !(g && g.hidden);
  document.getElementById('btn-delete-genre').hidden = !(g && !g.isDefault);
  document.getElementById('btn-genre-restore').hidden = !(g && g.isDefault && (g.edited || g.hidden));
  document.getElementById('genre-note').textContent = g && g.isDefault
    ? `標準のジャンルです（最初の名前：${g.defaultName}）。アプリを入れたり外したりすると、ほかのジャンルにも入っているアプリをここにも入れられます。`
    : '好きなアプリを選んでジャンルを作れます。ほかのジャンルに入っているアプリも選べます。';
  setFieldError('genre-name', '');
  renderGenreChecks();
}

/** アプリの一覧（チェックの状態は genreDraft に持つので、検索しても消えない） */
function renderGenreChecks() {
  const cands = new Map(genreCandidates().map(c => [c.key, c]));
  const others = new Map(); // アプリのキー → ほかに入っているジャンルの名前
  getGenres().filter(g => g.id !== currentGenreId && !g.hidden).forEach(g => g.members.forEach(k => {
    if (!others.has(k)) others.set(k, []);
    others.get(k).push(g.name);
  }));
  const order = [...genreOrder.filter(k => cands.has(k)), ...[...cands.keys()].filter(k => !genreOrder.includes(k))];
  const q = normalizeForSearch(document.getElementById('genre-query').value || '');
  const list = order.map(k => cands.get(k)).filter(c => !q || c.words.some(w => normalizeForSearch(w || '').includes(q)));
  const box = document.getElementById('genre-app-checks');
  box.innerHTML = list.map(c => {
    const sub = [c.registered ? '登録済み' : '', others.has(c.key) ? `ほかのジャンル：${others.get(c.key).join('・')}` : ''].filter(Boolean).join(' ／ ');
    return `<label class="check">
      <input type="checkbox" value="${esc(c.key)}" ${genreDraft.has(c.key) ? 'checked' : ''}>
      ${c.icon}
      <span class="check-text"><span>${esc(c.name)}</span>${sub ? `<span class="list-sub">${esc(sub)}</span>` : ''}</span>
    </label>`;
  }).join('');
  document.getElementById('genre-no-hit').hidden = list.length > 0;
  updateGenreCount();
}

function updateGenreCount() {
  const shown = new Set(genreCandidates().map(c => c.key));
  document.getElementById('genre-count').textContent = `${[...genreDraft].filter(k => shown.has(k)).length}件を選択中`;
}

function onGenreCheck(e) {
  const input = e.target.closest('input[type="checkbox"]');
  if (!input) return;
  if (input.checked) genreDraft.add(input.value); else genreDraft.delete(input.value);
  updateGenreCount();
}

function saveGenre(e) {
  e.preventDefault();
  const name = document.getElementById('genre-name').value.trim();
  const genres = getGenres();
  const g = currentGenreId ? genres.find(x => x.id === currentGenreId) : null;
  let err = '';
  if (!name) err = 'ジャンルの名前を入力してください。';
  else if ([...name].length > GENRE_NAME_MAX) err = `名前は${GENRE_NAME_MAX}文字までにしてください。`;
  else if (name === 'すべて' || genres.some(x => x.id !== currentGenreId && x.name === name)) err = '同じ名前のジャンルがあります。ほかの名前にしてください。';
  setFieldError('genre-name', err);
  if (err) return;

  const s = loadGenreSettings();
  const members = [...genreDraft];
  if (g && g.isDefault) {
    const base = new Set(defaultGenreMembers(g.id));
    const o = {
      name: name !== g.defaultName ? name : '',
      added: members.filter(k => !base.has(k)),
      removed: [...base].filter(k => !genreDraft.has(k)),
      hidden: !document.getElementById('genre-visible').checked,
    };
    if (!o.name && !o.added.length && !o.removed.length && !o.hidden) delete s.defaults[g.id];
    else s.defaults[g.id] = o;
  } else if (g) {
    s.custom = s.custom.map(x => (x.id === g.id ? { id: g.id, name, members } : x));
  } else {
    s.custom.push({ id: 'g' + newId(), name, members });
  }
  if (saveGenreSettings(s)) {
    logInfo('X01', g ? 'ジャンルを更新した' : 'ジャンルを作った', { id: g ? g.id : s.custom[s.custom.length - 1].id, name, アプリ: members.length });
    showMessage(g ? '保存しました' : `ジャンル「${name}」を作りました`);
    showScreen('genres');
  }
}

async function removeGenre() {
  const g = getGenres().find(x => x.id === currentGenreId);
  if (!g || g.isDefault) return;
  const yes = await confirmDialog(`ジャンル「${g.name}」を削除しますか？\n入っているアプリは消えません。`, { okLabel: '削除する', danger: true });
  if (!yes) return;
  const s = loadGenreSettings();
  s.custom = s.custom.filter(x => x.id !== g.id);
  if (saveGenreSettings(s)) {
    logInfo('X01', 'ジャンルを削除した', { id: g.id, name: g.name });
    showMessage('削除しました');
  }
  showScreen('genres');
}

async function restoreGenre() {
  const g = getGenres().find(x => x.id === currentGenreId);
  if (!g || !g.isDefault) return;
  const yes = await confirmDialog(`「${g.name}」を最初の状態（${g.defaultName}）に戻しますか？`, { okLabel: '元に戻す' });
  if (!yes) return;
  const s = loadGenreSettings();
  delete s.defaults[g.id];
  if (saveGenreSettings(s)) {
    logInfo('X01', 'ジャンルを最初の状態に戻した', { id: g.id, name: g.defaultName });
    showMessage('最初の状態に戻しました');
  }
  openGenreEdit(g.id);
}

function initGenres() {
  document.getElementById('btn-add-genre').addEventListener('click', () => openGenreEdit(null));
  document.getElementById('btn-genres-reset').addEventListener('click', resetAllGenres);
  document.getElementById('btn-apps-genres').addEventListener('click', () => openGenres('apps'));
  document.getElementById('form-genre').addEventListener('submit', saveGenre);
  document.getElementById('genre-app-checks').addEventListener('change', onGenreCheck);
  document.getElementById('genre-query').addEventListener('input', renderGenreChecks);
  document.getElementById('btn-delete-genre').addEventListener('click', removeGenre);
  document.getElementById('btn-genre-restore').addEventListener('click', restoreGenre);
}
