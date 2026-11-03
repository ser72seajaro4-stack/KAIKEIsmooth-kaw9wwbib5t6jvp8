// app.js 起動時の初期化・画面切替・下部メニュー（詳細設計書 2章・3章）
'use strict';

/** 画面ID → section・タイトル・表示処理・戻り先・下部メニューの位置 */
const SCREENS = {
  'home':       { section: 'screen-home',       title: 'KAIKEI smooth',     render: () => renderHome(),        back: null,     tab: 'home' },
  'apps':       { section: 'screen-apps',       title: '登録したアプリ',   render: () => renderAppsManage(),  back: null,     tab: 'apps' },
  'app-add':    { section: 'screen-app-add',    title: 'アプリを追加',     render: () => renderAppAdd(),      back: 'apps',   tab: 'apps' },
  'points':     { section: 'screen-points',     title: 'ポイント',         render: () => renderPoints(),      back: null,     tab: 'points' },
  'point-edit': { section: 'screen-point-edit', title: 'ポイント',         render: () => renderPointEdit(),   back: 'points', tab: 'points' },
  'shops':      { section: 'screen-shops',      title: 'お店ごとのアプリ', render: () => renderShops(),       back: null,     tab: 'shops' },
  'shop-apps':  { section: 'screen-shop-apps',  title: 'お店',             render: () => renderShopApps(),    back: 'shops',  tab: 'shops' },
  'shop-edit':  { section: 'screen-shop-edit',  title: 'お店',             render: () => renderShopEdit(),    back: 'shops',  tab: 'shops' },
  'app-edit':   { section: 'screen-app-edit',   title: 'アプリを編集',     render: () => renderAppEdit(),     back: 'apps',   tab: 'apps' },
  'genres':     { section: 'screen-genres',     title: 'ジャンルの編集',   render: () => renderGenres(),      back: () => genreReturn, tab: () => SCREENS[genreReturn].tab },
  'genre-edit': { section: 'screen-genre-edit', title: 'ジャンル',         render: () => renderGenreEdit(),   back: 'genres', tab: () => SCREENS[genreReturn].tab },
  'sync':       { section: 'screen-sync',       title: '設定',             render: () => { renderIconSetting(); renderSyncScreen(); }, back: 'home', tab: '' },
};

let currentScreen = 'home';

/** 戻り先・下部メニューの位置は、開き方で変わる画面もある（ジャンルの編集） */
const screenValue = v => (typeof v === 'function' ? v() : v);

/** 指定した画面だけを表示し、他を非表示にする */
function showScreen(id) {
  const conf = SCREENS[id];
  if (!conf) return;
  currentScreen = id;
  Object.values(SCREENS).forEach(s => { document.getElementById(s.section).hidden = s.section !== conf.section; });
  document.getElementById('screen-title').textContent = conf.title;
  document.getElementById('btn-back').hidden = !screenValue(conf.back);
  document.getElementById('btn-settings').hidden = id === 'sync';
  document.querySelectorAll('.tab').forEach(t => {
    if (t.dataset.tab === screenValue(conf.tab)) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  conf.render();
  window.scrollTo(0, 0);
}

function init() {
  purgeHistory();
  migrateSchemes(); // 登録済みアプリのURLスキームをテスト結果に合わせる

  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showScreen(t.dataset.tab)));
  document.getElementById('btn-back').addEventListener('click', () => {
    const back = screenValue(SCREENS[currentScreen].back);
    if (back) showScreen(back);
  });

  document.getElementById('btn-empty-add').addEventListener('click', () => showScreen('app-add'));
  document.getElementById('btn-sample').addEventListener('click', loadSampleData);
  document.getElementById('btn-add-all').addEventListener('click', addAllPresets);
  document.getElementById('btn-add-app').addEventListener('click', () => showScreen('app-add'));
  document.getElementById('form-app-manual').addEventListener('submit', addManual);
  document.getElementById('btn-test-app').addEventListener('click', testManual);
  document.getElementById('app-store').addEventListener('input', updateStoreDetected);
  document.getElementById('preset-query').addEventListener('input', renderPresetList);
  document.getElementById('home-query').addEventListener('input', renderHomeGrid);
  document.getElementById('btn-multi').addEventListener('click', () => setMultiMode(!multiMode));
  document.getElementById('btn-multi-cancel').addEventListener('click', () => setMultiMode(false));
  document.getElementById('btn-multi-all').addEventListener('click', pickAllShown);
  document.getElementById('btn-multi-add').addEventListener('click', addPicked);
  document.getElementById('btn-reset-data').addEventListener('click', resetAllData);
  initTip('btn-refresh-tip', 'refresh-tip');
  document.getElementById('icon-file').addEventListener('change', onIconFileChosen);
  document.getElementById('btn-refresh-launch').addEventListener('click', () => {
    const n = resetFailedLaunches();
    showMessage(n ? `${n}件のアプリの起動方法を更新しました。次のタップで直接開くのを試します。` : '更新が必要なアプリはありませんでした。');
  });

  document.getElementById('btn-add-point').addEventListener('click', () => openPointEdit(null));
  document.getElementById('form-point').addEventListener('submit', savePoint);
  document.getElementById('btn-delete-point').addEventListener('click', removePoint);

  document.getElementById('btn-add-shop').addEventListener('click', () => openShopEdit(null));
  document.getElementById('form-shop').addEventListener('submit', saveShop);
  document.getElementById('btn-delete-shop').addEventListener('click', removeShop);

  // 他のアプリから戻ってきた時、日付が変わっている場合に備えてホームを描き直す
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentScreen === 'home') renderHome();
  });

  document.getElementById('btn-settings').addEventListener('click', () => showScreen('sync'));
  document.getElementById('btn-note-sync').addEventListener('click', () => showScreen('sync'));
  initSyncScreen();
  initIconSetting(); // ホーム画面のアイコン（設定画面）
  initGenres();      // ジャンルの作成・変更
  initAppEdit();     // アプリの編集（名前・ジャンル・URLスキーム）

  showScreen('home');
  showFirstNotice();
  registerServiceWorker();
  handleSyncHash();      // QRコード（#sync=〇〇）から開かれた時
  handleLaunchFailHash(); // Androidで起動に失敗して戻ってきた時（#kf=〇〇）
  scheduleSync(300);     // 同期中なら起動時に同期する
}

/** ツールチップ：ボタンをタップで開閉。外側をタップ・Escキー・画面の切り替えで閉じる */
function initTip(btnId, tipId) {
  const btn = document.getElementById(btnId);
  const tip = document.getElementById(tipId);
  const set = open => { tip.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
  btn.addEventListener('click', e => { e.stopPropagation(); set(tip.hidden); });
  document.addEventListener('click', e => { if (!tip.hidden && !tip.contains(e.target)) set(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => set(false)));
}

/** オフライン動作（F09）：Service Workerを登録する */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 登録できない環境では通常どおり動く */ });
  } catch (e) {
    /* 同上 */
  }
}

document.addEventListener('DOMContentLoaded', init);
window.addEventListener('hashchange', handleSyncHash);
window.addEventListener('hashchange', handleLaunchFailHash);
