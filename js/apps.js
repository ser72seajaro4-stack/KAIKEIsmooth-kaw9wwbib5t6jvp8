// apps.js アプリ登録・削除（F02）・お気に入り設定（F06）
//
// 一覧にないアプリは「ストアのリンクを貼り付けるだけ」で登録できる。
// App Store／Google Playの共有リンクからアプリ番号・パッケージ名を読み取り、起動に使う（home.js openApp）。
// URLスキームは「詳しい設定」で任意入力（知っている人だけ）。
'use strict';

const URL_PATTERN = /^[a-z][a-z0-9+.\-]*:/i; // 〇〇: で始まるURL（URLスキーム、https: など）

/**
 * ストアのリンクを読み取る
 * 戻り値：{ iosAppId, androidPackage, nameHint }（読み取れたものだけ）
 */
function parseStoreLinks(text) {
  const result = {};
  const ios = text.match(/(?:apps|itunes)\.apple\.com\/[^\s]*?\bid(\d{6,})/i);
  if (ios) result.iosAppId = ios[1];

  const slug = text.match(/apps\.apple\.com\/[a-z]{2}\/app\/([^\/\s?#]+)\/id\d+/i);
  if (slug) {
    try {
      const name = decodeURIComponent(slug[1]).replace(/-/g, ' ').trim();
      if (name) result.nameHint = name.slice(0, 30);
    } catch (e) { /* 名前の候補がなくても登録はできる */ }
  }

  const android = text.match(/play\.google\.com\/store\/apps\/details\?(?:[^\s#]*?&)?id=([A-Za-z][\w]*(?:\.\w+)+)/);
  if (android) result.androidPackage = android[1];
  return result;
}

/** S02 アプリ管理画面 */
function renderAppsManage() {
  const list = document.getElementById('apps-list');
  const apps = sortAppsByName(load(KEYS.APPS));
  document.getElementById('apps-empty').hidden = apps.length > 0;
  list.innerHTML = apps.map(a => `
    <li class="list-item">
      <button type="button" class="icon-pick" data-icon="${esc(a.id)}" aria-label="${esc(a.name)}のアイコンの画像を変える">
        ${appIconHtml(a, true)}<span class="icon-pick-badge" aria-hidden="true">📷</span>
      </button>
      <button type="button" class="list-main name-btn" data-edit="${esc(a.id)}" aria-label="${esc(a.name)}を編集">
        <span class="list-name">${esc(a.name)}</span>
      </button>
      <button type="button" class="icon-btn${a.favorite ? ' fav-on' : ''}" data-fav="${esc(a.id)}"
        aria-pressed="${a.favorite ? 'true' : 'false'}" aria-label="${esc(a.name)}をお気に入り${a.favorite ? 'から外す' : 'にする'}">${a.favorite ? '★' : '☆'}</button>
      <button type="button" class="icon-btn" data-edit="${esc(a.id)}" aria-label="${esc(a.name)}の名前・ジャンル・URLスキームを編集">✎</button>
      <button type="button" class="icon-btn del" data-del="${esc(a.id)}" aria-label="${esc(a.name)}を削除">削除</button>
    </li>`).join('');
  list.querySelectorAll('[data-fav]').forEach(b => b.addEventListener('click', () => toggleFavorite(b.dataset.fav)));
  list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => removeApp(b.dataset.del)));
  list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openAppEdit(b.dataset.edit)));
  list.querySelectorAll('[data-icon]').forEach(b => b.addEventListener('click', () => pickIcon(b.dataset.icon)));
}

const APP_NAME_MAX = 30;

/* ===== S02 の並び：あいうえお順 → ABC順 → その他（数字・記号など） ===== */

const nameCollator = new Intl.Collator('ja', { sensitivity: 'base', numeric: true });

/** 並べるためのグループ（0＝ひらがな・カタカナ・漢字、1＝英字、2＝その他）と、比べる文字 */
function nameSortKey(app) {
  const name = (app.name || '').normalize('NFKC');
  const first = [...name][0] || '';
  if (/[A-Za-z]/.test(first)) return [1, name.toLowerCase()];
  if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff々〆ヵヶ]/.test(first)) {
    // 漢字で始まる一覧のアプリは読み方で並べる（名前を変えていない時だけ）
    const p = app.presetId ? PRESETS.find(x => x.pid === app.presetId) : null;
    const reading = /[\u3400-\u4dbf\u4e00-\u9fff々〆]/.test(first) && p && p.name === app.name ? (p.kana || '').split(' ')[0] : '';
    // カタカナはひらがなにそろえる
    return [0, (reading || name).replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))];
  }
  return [2, name];
}

function sortAppsByName(apps) {
  return apps
    .map(a => ({ a, k: nameSortKey(a) }))
    .sort((x, y) => x.k[0] - y.k[0] || nameCollator.compare(x.k[1], y.k[1]))
    .map(x => x.a);
}

/* ===== S12 アプリの編集（名前・ジャンル・URLスキーム）。✎ または名前をタップで開く ===== */

let editingAppId = null;
let editGenreDraft = new Set(); // 入れるジャンルのid
let editInitialUrl = '';

function openAppEdit(id) {
  editingAppId = id;
  editGenreDraft = null; // 開き直した時はジャンルを読み直す
  showScreen('app-edit');
}

/** 候補のタグ（タップで入力欄に入る） */
function renderSuggest(boxId, inputId, values) {
  const box = document.getElementById(boxId);
  box.hidden = !values.length;
  box.innerHTML = values.map(v => `<button type="button" class="chip" data-v="${esc(v)}">${esc(v)}</button>`).join('');
  box.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => { document.getElementById(inputId).value = b.dataset.v; }));
}

function renderAppEdit() {
  const app = load(KEYS.APPS).find(a => a.id === editingAppId);
  if (!app) { showScreen('apps'); return; }
  const preset = app.presetId ? PRESETS.find(p => p.pid === app.presetId) : null;
  document.getElementById('app-edit-head').innerHTML = `${appIconHtml(app, true)}<span class="list-name">${esc(app.name)}</span>`;

  document.getElementById('edit-name').value = app.name;
  renderSuggest('edit-name-suggest', 'edit-name', preset && preset.name !== app.name ? [preset.name] : []); // 元の名前に戻す
  setFieldError('edit-name', '');

  const key = appGenreKey(app);
  if (!editGenreDraft) editGenreDraft = new Set(getGenres().filter(g => !g.hidden && g.members.has(key)).map(g => g.id));
  renderEditGenres();

  editInitialUrl = launchState(app).confirmed || app.url || '';
  document.getElementById('edit-url').value = editInitialUrl;
  const cands = [...new Set(preset ? preset.schemeCandidates : schemeCandidates(app))];
  renderSuggest('edit-url-suggest', 'edit-url', cands);
  setFieldError('edit-url', '');
}

/** 入っているジャンル（上）と、ほかのジャンル（「＋ ほかのジャンルにも入れる」の中） */
function renderEditGenres() {
  const genres = getGenres().filter(g => !g.hidden);
  const chip = g => `<button type="button" class="chip" data-g="${esc(g.id)}" aria-pressed="${editGenreDraft.has(g.id) ? 'true' : 'false'}">${editGenreDraft.has(g.id) ? '✓ ' : ''}${esc(g.name)}</button>`;
  const inG = genres.filter(g => editGenreDraft.has(g.id));
  const box = document.getElementById('edit-genres');
  box.innerHTML = inG.length ? inG.map(chip).join('') : '<p class="field-hint">どのジャンルにも入っていません。</p>';
  document.getElementById('edit-genres-other').innerHTML = genres.filter(g => !editGenreDraft.has(g.id)).map(chip).join('');
  document.querySelectorAll('#edit-genres [data-g], #edit-genres-other [data-g]').forEach(b => b.addEventListener('click', () => {
    if (editGenreDraft.has(b.dataset.g)) editGenreDraft.delete(b.dataset.g); else editGenreDraft.add(b.dataset.g);
    renderEditGenres();
  }));
}

function saveAppEdit(e) {
  e.preventDefault();
  const apps = load(KEYS.APPS);
  const target = apps.find(a => a.id === editingAppId);
  if (!target) { showScreen('apps'); return; }
  const name = document.getElementById('edit-name').value.trim();
  const url = document.getElementById('edit-url').value.trim();
  let ok = true;
  if (!name) { setFieldError('edit-name', '名前を入力してください。'); ok = false; }
  else if ([...name].length > APP_NAME_MAX) { setFieldError('edit-name', `名前は${APP_NAME_MAX}文字までにしてください。`); ok = false; }
  else setFieldError('edit-name', '');
  if (url && (!URL_PATTERN.test(url) || /^\s*javascript:/i.test(url))) { setFieldError('edit-url', 'URLスキームは「example://」のように「〇〇:」で始めてください。'); ok = false; }
  else setFieldError('edit-url', '');
  if (!ok) return;

  let changed = false;
  if (name !== target.name) {
    const preset = target.presetId ? PRESETS.find(p => p.pid === target.presetId) : null;
    // 文字のアイコンも新しい名前の1文字目にする（一覧のアプリを元の名前に戻した時は、元のアイコンの文字に戻す）
    target.icon = preset && name === preset.name ? preset.icon : [...name][0];
    target.name = name;
    changed = true;
  }
  if (url !== editInitialUrl) {
    const rest = schemeCandidates(target).filter(c => c !== url);
    target.url = url;
    target.schemeCandidates = url ? [url, ...rest] : rest;
    target.launch = {}; // 試した結果をやり直す
    changed = true;
  }
  if (changed && !save(KEYS.APPS, apps)) return;
  if (!setAppGenres(appGenreKey(target), editGenreDraft)) return;
  showMessage('保存しました');
  showScreen('apps');
}

function initAppEdit() {
  document.getElementById('form-app-edit').addEventListener('submit', saveAppEdit);
  document.getElementById('btn-edit-genres-manage').addEventListener('click', () => openGenres('app-edit'));
}


/* ===== アイコンの画像（利用者の写真・ファイルから設定する） ===== */

const ICON_SIZE = 96;            // 保存する画像の大きさ（px）。表示は最大58pxなので、高精細な画面でもきれいに見える
const ICON_MAX_FILE = 20 * 1024 * 1024;
let iconTargetId = null;         // 画像を設定しているアプリ

/** アイコンをタップした時：画像を選ぶ（設定済みなら「選び直す」「元に戻す」を選べる） */
function pickIcon(id) {
  const app = load(KEYS.APPS).find(a => a.id === id);
  if (!app) return;
  iconTargetId = id;
  if (safeIconImage(app.iconImage)) {
    showMessage(`${app.name}のアイコン`, [
      { label: '画像を選び直す', onClick: openIconFile },
      { label: '元に戻す', onClick: () => setIconImage(id, '') },
    ]);
  } else openIconFile();
}

function openIconFile() {
  const input = document.getElementById('icon-file');
  input.value = '';
  input.click();
}

/** 選んだ画像を正方形に切り抜いて小さくし、data URL にする */
function makeIconImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        if (!side) throw new Error('empty');
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = ICON_SIZE;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        // 中央を正方形に切り抜く
        ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, ICON_SIZE, ICON_SIZE);
        // 透明な部分を残すためPNGを先に試し、大きすぎればJPEG（白い背景）にする
        let data = canvas.toDataURL('image/png');
        if (data.length > 40000) {
          const c2 = document.createElement('canvas');
          c2.width = c2.height = ICON_SIZE;
          const x = c2.getContext('2d');
          x.fillStyle = '#fff';
          x.fillRect(0, 0, ICON_SIZE, ICON_SIZE);
          x.drawImage(canvas, 0, 0);
          data = c2.toDataURL('image/jpeg', 0.85);
        }
        resolve(data);
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

async function onIconFileChosen(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file || !iconTargetId) return;
  if (!/^image\//.test(file.type) && !/\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(file.name)) {
    showMessage('画像のファイルを選んでください。');
    return;
  }
  if (file.size > ICON_MAX_FILE) { showMessage('画像が大きすぎます（20MBまで）。'); return; }
  try {
    setIconImage(iconTargetId, await makeIconImage(file));
  } catch (err) {
    showMessage('この画像は読み込めませんでした。PNG・JPEGなどの画像を選んでください。');
  }
}

/** アイコンの画像を保存する（空文字で元の文字アイコンに戻す） */
function setIconImage(id, data) {
  const apps = load(KEYS.APPS);
  const app = apps.find(a => a.id === id);
  if (!app) return;
  if (data) app.iconImage = data; else delete app.iconImage;
  if (save(KEYS.APPS, apps)) {
    renderAppsManage();
    showMessage(data ? 'アイコンの画像を変えました' : 'アイコンを元に戻しました');
  }
}


/** お気に入り（★）のオン・オフ（F06） */
function toggleFavorite(id) {
  const apps = load(KEYS.APPS);
  const app = apps.find(a => a.id === id);
  if (!app) return;
  app.favorite = !app.favorite;
  if (save(KEYS.APPS, apps)) renderAppsManage();
}

/** 削除（確認後、起動履歴と店舗の紐付けも削除） */
async function removeApp(id) {
  const app = load(KEYS.APPS).find(a => a.id === id);
  if (!app) return;
  const yes = await confirmDialog(`「${app.name}」を削除しますか？\nこのアプリの起動履歴と、お店への紐付けも削除されます。`, { okLabel: '削除する', danger: true });
  if (!yes) return;
  deleteApp(id);
  renderAppsManage();
  showMessage('削除しました');
}

/** 同じアプリがすでに登録されているか */
function findDuplicate(apps, cand) {
  return apps.find(a =>
    (cand.presetId && a.presetId === cand.presetId) ||
    (cand.iosAppId && a.iosAppId === cand.iosAppId) ||
    (cand.androidPackage && a.androidPackage === cand.androidPackage) ||
    (cand.url && a.url === cand.url));
}

/** 新しいアプリを登録する */
function addApp(fields) {
  const apps = load(KEYS.APPS);
  apps.push({
    id: newId(),
    name: fields.name,
    url: fields.url || '',
    schemeCandidates: fields.schemeCandidates || (fields.url ? [fields.url] : []),
    iosAppId: fields.iosAppId || '',
    androidPackage: fields.androidPackage || '',
    presetId: fields.presetId || '',
    icon: fields.icon || fields.name.slice(0, 1),
    favorite: false,
    createdAt: new Date().toISOString(),
  });
  return save(KEYS.APPS, apps);
}

let presetCat = 'all'; // S03で選んでいるカテゴリ
let multiMode = false;  // まとめて選ぶモード
const multiSelected = new Set(); // まとめて選んだプリセットのid（検索・カテゴリを変えても残す）

/** ひらがな→カタカナ、全角英数→半角、小文字にそろえる（検索用） */
function normalizeForSearch(s) {
  return s
    .replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[\s・\-‐（）()]/g, '')
    .toLowerCase();
}

/** この端末で使えるプリセットか（iPhoneにAndroid専用アプリは出さない等） */
function presetAvailable(p, platform) {
  if (platform === 'ios') return !!p.iosAppId;
  if (platform === 'android') return !!p.androidPackage;
  return true;
}

/** ジャンルの切り替えボタン（一覧のアプリが入っているジャンルだけ。ジャンルは js/genres.js） */
function presetGenres() {
  const platform = detectPlatform();
  return genresFor(PRESETS.filter(p => presetAvailable(p, platform)).map(p => 'p:' + p.pid));
}

function renderPresetCats() {
  const genres = presetGenres();
  if (!genres.some(g => g.id === presetCat)) presetCat = 'all';
  renderGenreChips('preset-cats', genres, presetCat, id => {
    presetCat = id;
    renderPresetCats();
    renderPresetList();
  }, 'app-add');
}

/** プリセットの一覧（検索・カテゴリで絞り込み） */
function renderPresetList() {
  const platform = detectPlatform();
  const apps = load(KEYS.APPS);
  const q = normalizeForSearch(document.getElementById('preset-query').value || '');
  // アプリ名・備考・読み方（ひらがな）のどれかに含まれていれば表示する
  const hit = p => [p.name, p.note, ...(p.kana || '').split(' ')].some(s => normalizeForSearch(s || '').includes(q));
  const genre = presetCat === 'all' ? null : presetGenres().find(g => g.id === presetCat);
  const list = PRESETS.filter(p =>
    presetAvailable(p, platform) &&
    (!genre || genre.members.has('p:' + p.pid)) &&
    (!q || hit(p)));

  const box = document.getElementById('preset-list');
  box.innerHTML = list.map(p => {
    const done = !!findDuplicate(apps, { presetId: p.pid, iosAppId: p.iosAppId, androidPackage: p.androidPackage });
    const sub = done ? '登録済み' : p.note;
    const picked = multiMode && multiSelected.has(p.pid);
    const pressed = multiMode && !done ? ` aria-pressed="${picked ? 'true' : 'false'}"` : '';
    return `<button type="button" class="preset${picked ? ' picked' : ''}" data-preset="${esc(p.pid)}" ${done ? 'disabled' : ''}${pressed}>
      ${multiMode && !done ? `<span class="pick-mark" aria-hidden="true">${picked ? '✓' : ''}</span>` : ''}
      <span class="app-icon sm" style="background:${iconColor(p.name)}" aria-hidden="true">${esc(p.icon)}</span>
      <span class="preset-name">${esc(p.name)}${sub ? `<br><span class="preset-state">${esc(sub)}</span>` : ''}</span>
    </button>`;
  }).join('');
  box.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
    if (multiMode) togglePick(b.dataset.preset);
    else addPreset(b.dataset.preset);
  }));
  presetShown = list;
  updateMultiBar();

  const total = PRESETS.filter(p => presetAvailable(p, platform)).length;
  document.getElementById('preset-count').textContent = `${list.length}件を表示中（全${total}件）`;
  document.getElementById('preset-empty').hidden = list.length > 0;
}

/* ===== まとめて追加（複数選択） ===== */

let presetShown = []; // 今表示しているプリセット（「表示中をすべて選ぶ」用）

/** 登録済みでないプリセットか */
function presetAddable(p, apps) {
  return !findDuplicate(apps, { presetId: p.pid, iosAppId: p.iosAppId, androidPackage: p.androidPackage });
}

/** まとめて選ぶモードのオン・オフ */
function setMultiMode(on) {
  multiMode = on;
  multiSelected.clear();
  const btn = document.getElementById('btn-multi');
  btn.textContent = on ? '選ぶのをやめる' : 'まとめて選ぶ';
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  renderPresetList();
}

/** 1件の選択を切り替える */
function togglePick(pid) {
  if (multiSelected.has(pid)) multiSelected.delete(pid);
  else multiSelected.add(pid);
  renderPresetList();
}

/** 表示中（検索・カテゴリで絞り込んだもの）の未登録アプリをすべて選ぶ。全部選んでいれば外す */
function pickAllShown() {
  const apps = load(KEYS.APPS);
  const targets = presetShown.filter(p => presetAddable(p, apps)).map(p => p.pid);
  const allPicked = targets.length && targets.every(id => multiSelected.has(id));
  targets.forEach(id => (allPicked ? multiSelected.delete(id) : multiSelected.add(id)));
  renderPresetList();
}

/** 下のバー・ボタンの表示を今の選択に合わせる */
function updateMultiBar() {
  document.getElementById('multi-bar').hidden = !multiMode;
  const allBtn = document.getElementById('btn-multi-all');
  allBtn.hidden = !multiMode;
  if (multiMode) {
    const apps = load(KEYS.APPS);
    const targets = presetShown.filter(p => presetAddable(p, apps));
    const allPicked = targets.length && targets.every(p => multiSelected.has(p.pid));
    allBtn.textContent = allPicked ? '表示中の選択を外す' : '表示中をすべて選ぶ';
    allBtn.disabled = !targets.length;
  }
  const n = multiSelected.size;
  const add = document.getElementById('btn-multi-add');
  add.disabled = n === 0;
  add.textContent = n ? `選んだ${n}件を追加` : 'アプリを選んでください';
}

/** 選んだアプリをまとめて登録する */
function addPicked() {
  const apps = load(KEYS.APPS);
  const targets = PRESETS.filter(p => multiSelected.has(p.pid) && presetAddable(p, apps));
  if (!targets.length) return;
  const now = Date.now();
  targets.forEach((p, i) => apps.push({
    id: newId() + i, name: p.name, url: p.url, schemeCandidates: p.schemeCandidates,
    iosAppId: p.iosAppId, androidPackage: p.androidPackage, presetId: p.pid,
    icon: p.icon, favorite: false, createdAt: new Date(now + i).toISOString(),
  }));
  if (save(KEYS.APPS, apps)) {
    showMessage(`${targets.length}件のアプリを追加しました`);
    showScreen('apps');
  }
}

/* ===== データのリセット（S02） ===== */

/** すべてのデータを消す。2回確認する（1回目：消える内容、2回目：本当にいいか） */
async function resetAllData() {
  const counts = [
    ['登録したアプリ', load(KEYS.APPS).length],
    ['ポイント', load(KEYS.POINTS).length],
    ['お店', load(KEYS.SHOPS).length],
    ['起動履歴', load(KEYS.HISTORY).length],
  ];
  const genreSet = loadGenreSettings();
  if (!genreSettingsEmpty(genreSet)) counts.push(['ジャンルの変更（自分で作ったジャンルなど）', genreSet.custom.length + Object.keys(genreSet.defaults).length]);
  if (counts.every(([, n]) => n === 0)) { showMessage('消すデータはありません'); return; }
  const first = await confirmDialog(
    'データをリセットしますか？\n次のデータがすべて消えます。\n\n' +
    counts.map(([name, n]) => `・${name}：${n}件`).join('\n') +
    '\n\n残しておきたい場合は、先にこの画面の「ファイルに保存」で保存してください。',
    { okLabel: '次へ', danger: true });
  if (!first) return;
  const second = await confirmDialog('本当にリセットしてよろしいですか？\nこの操作は元に戻せません。', { okLabel: 'リセットする', danger: true });
  if (!second) return;
  // save() を通して消す（削除の記録が残り、古いバックアップを合わせて読み込んでも復活しない）
  const ok = [KEYS.APPS, KEYS.POINTS, KEYS.SHOPS, KEYS.HISTORY].map(k => save(k, [])).every(Boolean) &&
    (genreSettingsEmpty(genreSet) || saveGenreSettings({ custom: [], defaults: {} }));
  renderAppsManage();
  renderSyncScreen();
  showMessage(ok ? 'データをリセットしました' : '一部のデータを消せませんでした。もう一度試してください。');
}

/** S03 アプリ追加画面 */
function renderAppAdd() {
  document.getElementById('preset-query').value = '';
  presetCat = 'all';
  multiMode = false;
  multiSelected.clear();
  document.getElementById('btn-multi').textContent = 'まとめて選ぶ';
  document.getElementById('btn-multi').setAttribute('aria-pressed', 'false');
  renderPresetCats();
  renderPresetList();

  renderStoreSteps();
  ['app-store', 'app-name', 'app-url'].forEach(id => {
    document.getElementById(id).value = '';
    setFieldError(id, '');
  });
  document.getElementById('app-advanced').open = false;
  updateStoreDetected();
}

/** 端末に合わせて、ストアのリンクのコピー方法を表示する */
function renderStoreSteps() {
  const platform = detectPlatform();
  const ios = ['App Storeで、追加したいアプリのページを開く', 'アプリ名の右にある共有ボタン（□↑）→「リンクをコピー」', '下の欄に貼り付ける'];
  const android = ['Google Playで、追加したいアプリのページを開く', '右上の「︙」→「共有」→「コピー」', '下の欄に貼り付ける'];
  const steps = platform === 'ios' ? ios : platform === 'android' ? android : null;
  const el = document.getElementById('store-steps');
  el.innerHTML = steps
    ? `<ol>${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`
    : '<p>iPhoneはApp Store、AndroidはGoogle Playで、追加したいアプリのページの「共有」からリンクをコピーし、下の欄に貼り付けます。</p>';
}

/** 貼り付けたリンクの読み取り結果を表示し、アプリ名が空なら候補を入れる */
function updateStoreDetected() {
  const text = document.getElementById('app-store').value;
  const found = parseStoreLinks(text);
  const out = document.getElementById('store-detected');
  const items = [];
  if (found.iosAppId) items.push(`App Storeのアプリ（id${found.iosAppId}）`);
  if (found.androidPackage) items.push(`Google Playのアプリ（${found.androidPackage}）`);
  out.textContent = items.length ? `✓ ${items.join('、')}を読み取りました` : '';
  out.hidden = !items.length;
  if (items.length) setFieldError('app-store', '');

  const nameInput = document.getElementById('app-name');
  if (found.nameHint && !nameInput.value.trim()) nameInput.value = found.nameHint;
}

function addPreset(pid) {
  const p = PRESETS.find(x => x.pid === pid);
  if (!p) return;
  if (findDuplicate(load(KEYS.APPS), { presetId: p.pid, iosAppId: p.iosAppId, androidPackage: p.androidPackage })) {
    showMessage(`${p.name}はすでに登録されています`);
    return;
  }
  if (addApp({ name: p.name, url: p.url, schemeCandidates: p.schemeCandidates, iosAppId: p.iosAppId, androidPackage: p.androidPackage, presetId: p.pid, icon: p.icon })) {
    showMessage(`${p.name}を追加しました`);
    showScreen('apps');
  }
}

/**
 * 手入力欄を読み取ってチェックする
 * forTest：試しに起動（アプリ名は不要）
 * 戻り値：問題なければ登録内容、だめならnull（エラーは各欄に表示）
 */
function readManualForm(forTest) {
  const storeText = document.getElementById('app-store').value.trim();
  const name = document.getElementById('app-name').value.trim();
  const url = document.getElementById('app-url').value.trim();
  const found = parseStoreLinks(storeText);
  const platform = detectPlatform();
  let ok = true;

  // 起動用URL（任意）
  if (url && (!URL_PATTERN.test(url) || /^\s*javascript:/i.test(url))) {
    document.getElementById('app-advanced').open = true;
    setFieldError('app-url', '起動用URLは「example://」のように「〇〇:」で始めてください。');
    ok = false;
  } else setFieldError('app-url', '');

  // ストアのリンク（URLスキームを入れた場合は省略できる）
  if (storeText && !found.iosAppId && !found.androidPackage) {
    setFieldError('app-store', 'App StoreかGoogle Playのアプリのページのリンクを貼り付けてください。');
    ok = false;
  } else if (!storeText && !url) {
    setFieldError('app-store', 'ストアのリンクを貼り付けてください。');
    ok = false;
  } else if (!url && platform === 'ios' && !found.iosAppId) {
    setFieldError('app-store', 'これはGoogle Play（Android）のリンクです。iPhoneではApp Storeのリンクを貼り付けてください。');
    ok = false;
  } else if (!url && platform === 'android' && !found.androidPackage) {
    setFieldError('app-store', 'これはApp Store（iPhone）のリンクです。AndroidではGoogle Playのリンクを貼り付けてください。');
    ok = false;
  } else setFieldError('app-store', '');

  if (!forTest) {
    if (!name) { setFieldError('app-name', 'アプリ名を入力してください。'); ok = false; }
    else setFieldError('app-name', '');
  }
  if (!ok) return null;
  return { name: name || 'テスト', url, iosAppId: found.iosAppId || '', androidPackage: found.androidPackage || '' };
}

/** 試しに起動（登録・履歴の記録はしない） */
function testManual() {
  const cand = readManualForm(true);
  if (cand) openApp(cand);
}

/** 手入力での追加 */
function addManual(e) {
  e.preventDefault();
  const cand = readManualForm(false);
  if (!cand) return;
  const dup = findDuplicate(load(KEYS.APPS), cand);
  if (dup) {
    setFieldError('app-store', `このアプリは「${dup.name}」としてすでに登録されています。`);
    return;
  }
  if (addApp(cand)) {
    showMessage(`${cand.name}を追加しました`);
    showScreen('apps');
  }
}
