// icon.js ホーム画面アイコンの選択（設定画面）
// 選んだアイコンは、この端末のブラウザ内（localStorage の homeIcon）だけに保存する（同期・バックアップの対象外）。
// ホーム画面のアイコンは「ホーム画面に追加」した時に決まるため、
//   iPhone：<link rel="apple-touch-icon"> を、Android：<link rel="manifest">（manifests/icon-XX.json）を
// 選んだアイコンのものに差し替えておく。ページを開いた直後の差し替えは index.html の <head> 内のスクリプトで行う。
// アイコンの画像・マニフェスト・一覧（js/icon-choices.js）は tools/build_icons.py で作る。
'use strict';

const HOME_ICON_KEY = 'homeIcon';
const DEFAULT_ICON_ID = ICON_CHOICES[0].id; // 何も選んでいない時のアイコン（manifest.json と同じ）

/** いま選んでいるアイコンのID（選んでいない・今はないアイコンなら標準） */
function currentHomeIcon() {
  try {
    const id = localStorage.getItem(HOME_ICON_KEY);
    return id && ICON_CHOICES.some(c => c.id === id) ? id : DEFAULT_ICON_ID;
  } catch (e) {
    return DEFAULT_ICON_ID;
  }
}

/** アイコンIDごとのファイルの場所（標準のアイコンは manifest.json を使う） */
function homeIconPaths(id) {
  const base = `icons/choices/icon-${id}`;
  return {
    manifest: id === DEFAULT_ICON_ID ? 'manifest.json' : `manifests/icon-${id}.json`,
    touch: `${base}-180.png`, fav: `${base}-192.png`, thumb: `${base}-96.png`,
  };
}

/** <head> のリンクを選んだアイコンのものに差し替える */
function applyHomeIcon(id) {
  const p = homeIconPaths(id);
  const set = (rel, href) => {
    const link = document.querySelector(`link[rel="${rel}"]`);
    if (link && link.getAttribute('href') !== href) link.setAttribute('href', href);
  };
  set('manifest', p.manifest);
  set('apple-touch-icon', p.touch);
  set('icon', p.fav);
}

function iconName(id) {
  const c = ICON_CHOICES.find(x => x.id === id);
  return c ? c.name : '';
}

/** 設定画面のアイコン一覧を描く */
function renderIconSetting() {
  const current = currentHomeIcon();
  const img = document.getElementById('icon-current-img');
  img.src = homeIconPaths(current).fav;
  document.getElementById('icon-current-name').textContent = iconName(current);

  const box = document.getElementById('icon-choices');
  box.textContent = '';
  ICON_CHOICES.forEach(c => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-choice';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', c.id === current ? 'true' : 'false');
    btn.dataset.icon = c.id;
    const pic = document.createElement('img');
    pic.src = homeIconPaths(c.id).thumb;
    pic.alt = '';
    pic.loading = 'lazy';
    pic.width = 56;
    pic.height = 56;
    const label = document.createElement('span');
    label.textContent = c.id === DEFAULT_ICON_ID ? `${c.name}（標準）` : c.name;
    btn.append(pic, label);
    box.append(btn);
  });
}

function chooseHomeIcon(id) {
  if (id === currentHomeIcon()) return;
  try {
    if (id === DEFAULT_ICON_ID) localStorage.removeItem(HOME_ICON_KEY);
    else localStorage.setItem(HOME_ICON_KEY, id);
  } catch (e) {
    logError('X03', 'ホーム画面のアイコンの設定を保存できなかった', e, { icon: id });
    showMessage('アイコンの設定を保存できませんでした。');
    return;
  }
  applyHomeIcon(id);
  logInfo('X03', 'ホーム画面のアイコンを変えた', { icon: id, name: iconName(id) });
  renderIconSetting();
  showMessage(isStandalone()
    ? `アイコンを「${iconName(id)}」にしました。ホーム画面のアイコンは、ブラウザから追加し直すと変わります。`
    : `アイコンを「${iconName(id)}」にしました。このあと「ホーム画面に追加」をすると、このアイコンで追加されます。`);
}

function initIconSetting() {
  // 前に選んでいたアイコンが候補からなくなっていたら、標準に戻す
  try {
    const saved = localStorage.getItem(HOME_ICON_KEY);
    if (saved && !ICON_CHOICES.some(c => c.id === saved)) localStorage.removeItem(HOME_ICON_KEY);
  } catch (e) { /* 何もしない */ }
  applyHomeIcon(currentHomeIcon());
  document.getElementById('icon-choices').addEventListener('click', e => {
    const btn = e.target.closest('.icon-choice');
    if (btn) chooseHomeIcon(btn.dataset.icon);
  });
}
