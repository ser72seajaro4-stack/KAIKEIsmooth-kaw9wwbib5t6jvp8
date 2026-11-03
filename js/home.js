// home.js ホーム画面（F01 一覧表示・F03 起動・F04 履歴記録・F05 並び替え・F10 注意表示）
'use strict';

const HISTORY_DAYS = 30;
const LAUNCH_WAIT_MS = 2500; // 起動できたかを判定するまでの待ち時間（実機で調整する）

/** 30日より古い起動履歴を削除する（本アプリの起動時に呼ぶ） */
function purgeHistory() {
  const limit = Date.now() - HISTORY_DAYS * 86400000;
  const history = load(KEYS.HISTORY);
  const kept = history.filter(h => Date.parse(h.launchedAt) >= limit);
  if (kept.length !== history.length) save(KEYS.HISTORY, kept);
}

/**
 * 並び替え（F05）
 * ①お気に入りが先頭 ②直近30日の起動回数が多い順 ③同数は最終利用日時が新しい順 ④履歴なしは登録順で末尾
 */
function sortApps(apps, history) {
  const limit = Date.now() - HISTORY_DAYS * 86400000;
  const stat = {};
  for (const h of history) {
    const t = Date.parse(h.launchedAt);
    if (!(t >= limit)) continue;
    const s = stat[h.appId] || (stat[h.appId] = { count: 0, last: 0 });
    s.count += 1;
    if (t > s.last) s.last = t;
  }
  return [...apps].sort((a, b) => {
    if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
    const sa = stat[a.id] || { count: 0, last: 0 };
    const sb = stat[b.id] || { count: 0, last: 0 };
    if (sa.count !== sb.count) return sb.count - sa.count;
    if (sa.last !== sb.last) return sb.last - sa.last;
    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });
}

/** 起動履歴を記録する（F04） */
function recordLaunch(appId) {
  const history = load(KEYS.HISTORY);
  history.push({ id: newId(), appId, launchedAt: new Date().toISOString() });
  save(KEYS.HISTORY, history);
}

/** アプリを起動する（F03）：履歴を記録してから起動する */
function launchApp(appId) {
  const app = load(KEYS.APPS).find(a => a.id === appId);
  if (!app) {
    showMessage('このアプリは削除されています。');
    return;
  }
  recordLaunch(app.id);
  openApp(app);
}

/*
 * ===== アプリの起動とストアへの切り替え（iPhoneとAndroidの違い） =====
 *
 * 【iPhone（Safari）】
 *  - Webページから「アプリが入っているか」を調べる方法はない。
 *  - URLスキームで開けなかった時、Safariは「アドレスが無効です」と表示するだけで、ページには何も知らされない。
 *    そこで約2秒たっても画面が切り替わらなければ失敗とみなす（tryScheme）。
 *  - 失敗した後に自動でApp Storeへ移動させると、タップ（ユーザー操作）からの移動ではないためSafariに止められることがある。
 *    そのため「App Storeで開く」ボタンを出し、利用者のタップで開く。
 *  - App Storeは itms-apps:// で開く。https://apps.apple.com を開くとSafariの中でWebページが表示されることがあるが、
 *    itms-apps:// ならApp Storeアプリが直接開き、インストール済みなら「開く」で起動できる。
 *
 * 【Android（Chrome）】
 *  - intent URLが使える。パッケージ名とURLスキームを組み合わせると、アプリが入っていれば直接起動し、
 *    起動できなければChromeが自動で S.browser_fallback_url（Google Playのページ）を開く。判定をこちらで書く必要がない。
 *  - URLスキームが分からないアプリは、ランチャー画面を直接呼ぶことができない（ChromeはBROWSABLEな画面しか開けない）。
 *    そこでGoogle Playアプリのアプリページを intent（scheme=market, package=com.android.vending）で開き、「開く」から起動する。
 *    Google Playが入っていない端末では、Chromeが自動でWeb版のGoogle Playを開く。
 */

/** iPhoneでホーム画面に追加したWebアプリとして動いているか */
function isStandalone() {
  return window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

/** ストアのページ（Web版）のURL */
function storeWebUrl(app, platform) {
  if (platform === 'ios' && app.iosAppId) return `https://apps.apple.com/jp/app/id${app.iosAppId}`;
  if (platform === 'android' && app.androidPackage) return `https://play.google.com/store/apps/details?id=${app.androidPackage}`;
  if (app.iosAppId) return `https://apps.apple.com/jp/app/id${app.iosAppId}`;
  if (app.androidPackage) return `https://play.google.com/store/apps/details?id=${app.androidPackage}`;
  return '';
}

/**
 * この端末でストアアプリを直接開くためのURL
 *  iPhone：itms-apps://apps.apple.com/jp/app/id〇〇（App Storeアプリが開く）
 *  Android：intent://details?id=〇〇#Intent;scheme=market;package=com.android.vending;…（Google Playアプリが開く）
 */
function storeLink(app, platform) {
  if (platform === 'ios' && app.iosAppId) {
    return { url: `itms-apps://apps.apple.com/jp/app/id${app.iosAppId}`, label: 'App Storeで開く' };
  }
  if (platform === 'android' && app.androidPackage) {
    const web = storeWebUrl(app, 'android');
    return {
      url: `intent://details?id=${app.androidPackage}#Intent;scheme=market;package=com.android.vending;S.browser_fallback_url=${encodeURIComponent(web)};end`,
      label: 'Google Playで開く',
    };
  }
  return null;
}

/**
 * Android（Chrome）用のintent URL
 * アプリが入っていれば直接起動し、起動できなければChromeが自動でGoogle Playのページを開く。
 */
function androidIntentUrl(scheme, pkg, fallbackUrl) {
  const m = scheme.match(/^([a-z][a-z0-9+.\-]*):(?:\/\/)?(.*)$/i);
  if (!m) return null;
  return `intent://${m[2]}#Intent;scheme=${m[1]};package=${pkg};S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;
}

/** URLへ移動する（アプリ・ストアの呼び出し。テストで差し替えられるよう1か所にまとめる） */
function navigateTo(url) {
  window.location.href = url;
}

/** 本アプリの外のWebページを別画面で開く */
function openExternal(url) {
  const w = window.open(url, '_blank');
  if (w) w.opener = null;
  else window.location.href = url;
}

/** ストアを開く（iPhone・AndroidはストアアプリのURL、それ以外はWeb版） */
function openStore(app) {
  const platform = detectPlatform();
  const link = storeLink(app, platform);
  if (link) {
    navigateTo(link.url);
    return true;
  }
  const web = storeWebUrl(app, platform);
  if (web) {
    openExternal(web);
    return true;
  }
  return false;
}

/*
 * ===== 候補を順番に試して、開けた方法を覚える =====
 * 1つのアプリに起動方法の候補（URLスキーム・公式アプリリンク）が複数ある時は、全部を持っておき、
 * 外れたら自動で次の候補を試す。開けた候補はその端末の種類（iPhone／Android）ごとに自動で覚え、
 * 次からはそれだけを使う。利用者に「開けたか」を聞くことはしない。
 */

/** そのアプリの候補の一覧 */
function schemeCandidates(app) {
  if (Array.isArray(app.schemeCandidates) && app.schemeCandidates.length) return app.schemeCandidates;
  const preset = app.presetId && typeof PRESETS !== 'undefined' ? PRESETS.find(p => p.pid === app.presetId) : null;
  const list = preset ? preset.schemeCandidates.slice() : [];
  if (app.url && !list.includes(app.url)) list.unshift(app.url);
  return list;
}

/**
 * 登録済みのアプリのURLスキームを、最新のプリセット（テスト結果）に合わせる。
 * 2026/10/30 のテスト結果で、開けたものはそのURLスキームだけ、開けなかったものはURLスキームなし（ストアを開く）にした。
 * 一覧から追加したアプリだけが対象（✎ で入れたURLスキームも、テスト結果で置き換える）。端末ごとに1回だけ行う。
 */
const SCHEME_DATA_VERSION = '2026-10-30';
const SCHEME_VERSION_KEY = 'schemeDataVersion';

function migrateSchemes() {
  let done = '';
  try { done = localStorage.getItem(SCHEME_VERSION_KEY) || ''; } catch (e) { return; }
  if (done === SCHEME_DATA_VERSION) return;
  const apps = load(KEYS.APPS);
  let changed = false;
  apps.forEach(a => {
    const p = a.presetId ? PRESETS.find(x => x.pid === a.presetId) : null;
    if (!p) return;
    a.url = p.url;
    a.schemeCandidates = p.schemeCandidates.slice();
    a.launch = {}; // 前の候補で試した結果は使わない
    changed = true;
  });
  if (changed && !save(KEYS.APPS, apps)) return; // 保存できなければ次回もう一度
  try { localStorage.setItem(SCHEME_VERSION_KEY, SCHEME_DATA_VERSION); } catch (e) { /* 次回もう一度 */ }
}

/** この端末の種類での、候補の試し具合 { index：次に試す番号, confirmed：開けた候補 } */
function launchState(app) {
  const s = (app.launch && app.launch[detectPlatform()]) || {};
  return { index: s.index || 0, confirmed: s.confirmed || '' };
}

function saveLaunchState(appId, state) {
  if (!appId) return;
  const apps = load(KEYS.APPS);
  const a = apps.find(x => x.id === appId);
  if (!a) return;
  a.launch = a.launch || {};
  a.launch[detectPlatform()] = state;
  save(KEYS.APPS, apps);
}

/**
 * 起動の本体（履歴は記録しない。アプリ追加画面の「試しに起動」でも使う）
 *  ① 開けた候補を覚えていれば、それで開く
 *  ② まだなら、次の候補を試す
 *  ③ 候補がない・全部だめだった時は、ストアのページを開く（ストアの「開く」で起動）
 */
function openApp(app) {
  const cands = schemeCandidates(app);
  const st = launchState(app);
  const target = st.confirmed || cands[st.index] || '';
  if (target) {
    attemptLaunch(app, target, { cands, index: st.confirmed ? -1 : st.index });
    return;
  }
  // 直接開く方法が全部外れていた（アプリが入っていなかった）時は、戻ってきた時に「更新して開く」ボタンを出す
  if (cands.length && (app.iosAppId || app.androidPackage)) offerRetryOnReturn(app);
  if (openStore(app)) return;
  const platform = detectPlatform();
  if (platform === 'ios') showMessage('このアプリはiPhone版の情報（App Storeのリンク）が登録されていません。iPhoneでは使えないアプリの可能性があります。');
  else if (platform === 'android') showMessage('このアプリはAndroid版の情報（Google Playのリンク）が登録されていません。Androidでは使えないアプリの可能性があります。');
  else showMessage('この端末では起動できません。スマートフォンで使ってください。');
}

/**
 * 本アプリの画面が他のアプリに切り替わったかを、待ち時間のあとに知らせる。
 * 画面が隠れた（visibilitychange・pagehide）時だけ「切り替わった」とする。
 * blur は数えない：iPhoneで「アドレスが無効です」が出ただけでも起きることがあり、外れを当たりと間違えるため。
 */
function watchLeave(callback) {
  let left = false;
  const markLeft = () => { if (document.hidden) left = true; };
  const onLeave = () => { left = true; };
  document.addEventListener('visibilitychange', markLeft);
  window.addEventListener('pagehide', onLeave);
  setTimeout(() => {
    document.removeEventListener('visibilitychange', markLeft);
    window.removeEventListener('pagehide', onLeave);
    callback(left);
  }, LAUNCH_WAIT_MS);
}

/** Androidで候補が外れた時に、Google Playではなく本アプリに戻ってくるためのURL（#kf=アプリID.番号） */
function launchFailUrl(appId, index) {
  return location.href.split('#')[0] + '#kf=' + encodeURIComponent(appId || 'test') + '.' + index;
}

/**
 * Androidで外れて戻ってきた（#kf=…）時の処理。
 * 同じ画面のままハッシュだけ変わる場合は attemptLaunch 側で扱うので、ここではハッシュを消すだけ。
 * Chromeが画面を読み込み直した場合は、ここで外れを記録する。
 */
function handleLaunchFailHash() {
  const m = location.hash.match(/^#kf=([^.]+)\.(-?\d+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (launchPending) return;
  const appId = decodeURIComponent(m[1]);
  const index = Number(m[2]);
  const app = load(KEYS.APPS).find(a => a.id === appId);
  if (!app) return;
  const st = launchState(app);
  if (index === -1 && st.confirmed) saveLaunchState(app.id, { index: 0, confirmed: '' }); // 覚えていた方法で開けなかった
  else if (st.index === index && !st.confirmed) saveLaunchState(app.id, { index: index + 1, confirmed: '' });
}

let launchPending = false; // 起動を試している最中か

/**
 * 1つの候補で開いてみる。利用者に「開きましたか？」とは聞かず、結果は自動で判断する。
 *  ・画面が他のアプリに切り替わった → 開けたとみなし、次からはその方法で開く
 *  ・切り替わらなかった → 外れ。すぐ次の候補を試し、全部外れたらストアを開く
 * ctx.index：候補の番号（-1 は「開けたと覚えている候補」）
 * ctx.auto ：前の候補が外れて自動で続けて試している時は true（タップ直後ではないので、
 *            ブラウザに止められて開けなかっただけかもしれない。そのため外れとして記録しない）
 */
function attemptLaunch(app, target, ctx) {
  const platform = detectPlatform();
  const isWeb = /^https?:/i.test(target);
  let url = target;
  if (!isWeb && platform === 'android' && app.androidPackage) {
    // パッケージ名を指定するので、同じスキームの別アプリは開かない。
    // 外れた時はGoogle Playへ飛ばさず本アプリへ戻ってくる（#kf）。Google Playに飛ぶと画面が切り替わるため、
    // 「開けた」と間違えて覚えてしまう（アプリを入れていない時にストアが開くのを当たりと記録してしまう）
    url = androidIntentUrl(target, app.androidPackage, launchFailUrl(app.id, ctx.index)) || target;
  }

  launchPending = true;
  watchLeave(left => {
    launchPending = false;
    if (/^#kf=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    if (left || isWeb) {
      // 開けた（公式アプリリンクは、未インストールならリンク側でストアに案内される）
      if (ctx.index !== -1) saveLaunchState(app.id, { index: ctx.index, confirmed: target });
      return;
    }
    if (ctx.index === -1) {
      // 前は開けた方法で開けなかった（アプリを消した・アプリ側でスキームが変わった等）→ 最初から試し直す
      saveLaunchState(app.id, { index: 0, confirmed: '' });
      if (ctx.cands.length) attemptLaunch(app, ctx.cands[0], { cands: ctx.cands, index: 0, auto: true });
      else launchFailed(app);
      return;
    }
    const next = ctx.index + 1;
    if (!ctx.auto) saveLaunchState(app.id, { index: next, confirmed: '' });
    if (next < ctx.cands.length) attemptLaunch(app, ctx.cands[next], { cands: ctx.cands, index: next, auto: true });
    else launchFailed(app);
  });

  try {
    if (isWeb) openExternal(url);
    else navigateTo(url);
  } catch (e) { /* 失敗は watchLeave で扱う */ }
}

function storeLabel(platform) {
  return platform === 'ios' ? 'App Storeで開く' : platform === 'android' ? 'Google Playで開く' : 'ストアで開く';
}

/** 直接開けなかった時：ストアを開く（ブラウザに止められた時のため、ボタンも出しておく） */
function launchFailed(app) {
  const platform = detectPlatform();
  showMessage(`${app.name}を直接開けませんでした。`, [
    { label: storeLabel(platform), onClick: () => openStore(app) },
  ]);
  offerRetryOnReturn(app);
  openStore(app);
}

/**
 * ストアから本アプリに戻ってきた時に、「更新して開く」ボタンを出す。
 * ストアでアプリをインストールした後に押すと、開けなかった方法をもう一度試して直接開く。
 */
function offerRetryOnReturn(app) {
  let wentAway = false;
  const h = () => {
    if (document.hidden) { wentAway = true; return; }
    if (!wentAway) return;
    document.removeEventListener('visibilitychange', h);
    setTimeout(() => showMessage(`${app.name}をインストールした時は、このボタンで直接開けるようになります。`, [
      { label: '↻ 更新して開く', onClick: () => retryLaunch(app.id) },
    ]), 300);
  };
  document.addEventListener('visibilitychange', h);
  setTimeout(() => document.removeEventListener('visibilitychange', h), 10 * 60 * 1000); // 10分たったら出さない
}

/** 1つのアプリの起動方法をやり直して、すぐ開く（タップから呼ぶので、最初の方法はブラウザに止められない） */
function retryLaunch(appId) {
  saveLaunchState(appId, { index: 0, confirmed: '' });
  const app = load(KEYS.APPS).find(a => a.id === appId);
  if (app) openApp(app);
}

/** 開けなかった方法の記録を全部消す（アプリを後からインストールした時用。開けた方法は残す） */
function resetFailedLaunches() {
  const apps = load(KEYS.APPS);
  let n = 0;
  apps.forEach(a => {
    const st = a.launch && a.launch[detectPlatform()];
    if (st && !st.confirmed && st.index > 0) { a.launch[detectPlatform()] = { index: 0, confirmed: '' }; n++; }
  });
  if (n) save(KEYS.APPS, apps);
  return n;
}

/** アイコン1つ分のHTML */
function appTileHtml(app) {
  return `<button type="button" class="app-tile" data-launch="${esc(app.id)}" aria-label="${esc(app.name)}を起動">
    ${app.favorite ? '<span class="fav-badge" aria-hidden="true">★</span>' : ''}
    ${appIconHtml(app, false)}
    <span class="app-label">${esc(app.name)}</span>
  </button>`;
}

/** グリッドにアイコンを並べ、タップで起動する */
function renderAppGrid(gridId, apps) {
  const grid = document.getElementById(gridId);
  grid.innerHTML = apps.map(appTileHtml).join('');
  grid.querySelectorAll('[data-launch]').forEach(btn => {
    btn.addEventListener('click', () => launchApp(btn.dataset.launch));
  });
}

/** 期限お知らせ欄（F08の結果を表示するだけ） */
function renderAlerts() {
  const area = document.getElementById('alert-area');
  const alerts = getAlerts();
  area.innerHTML = alerts.map(a => `
    <button type="button" class="alert alert-${a.level}" data-alert="${esc(a.id)}">
      <span class="alert-main">${esc(a.name)}の期限が近づいています</span>
      <span class="alert-days">${a.days === 0 ? '今日まで' : `残り${a.days}日`}</span>
    </button>`).join('');
  area.querySelectorAll('[data-alert]').forEach(btn => {
    btn.addEventListener('click', () => showScreen('points'));
  });
}

/* ===== ホーム画面の検索・ジャンルの絞り込み（アプリ追加画面と同じ形） ===== */

let homeCat = 'all'; // ホームで選んでいるジャンル（ジャンルは js/genres.js）

/** 検索に使う文字：今の名前・一覧での名前・読み方（ひらがな）・備考 */
function appSearchWords(app) {
  const p = app.presetId ? PRESETS.find(x => x.pid === app.presetId) : null;
  return [app.name, ...(p ? [p.name, p.note, ...(p.kana || '').split(' ')] : [])];
}

/** 登録済みのアプリが入っているジャンルだけをタグにする（「すべて」が先頭）。選んでいるジャンルを返す。
 *  ホームは使うだけの画面なので、ジャンルの編集などの編集機能は置かない（編集は「登録」画面から） */
function renderHomeCats(apps) {
  const genres = genresFor(apps.map(appGenreKey));
  const current = genres.find(g => g.id === homeCat);
  if (!current) homeCat = 'all'; // 選んでいたジャンルのアプリが消えた・ジャンルを消した
  renderGenreChips('home-cats', genres, homeCat, id => { homeCat = id; renderHomeGrid(); }, null);
  document.getElementById('home-cats').hidden = genres.length < 2; // ジャンルが1つだけなら絞り込む意味がないので出さない
  return current || null;
}

/** 検索・ジャンルで絞り込んだアプリを並べる */
function renderHomeGrid() {
  const apps = sortApps(load(KEYS.APPS), load(KEYS.HISTORY));
  document.getElementById('home-empty').hidden = apps.length > 0;
  document.getElementById('home-filter').hidden = apps.length === 0;
  const genre = renderHomeCats(apps);
  const q = normalizeForSearch(document.getElementById('home-query').value || '');
  const list = apps.filter(a =>
    (!genre || genre.members.has(appGenreKey(a))) &&
    (!q || appSearchWords(a).some(w => normalizeForSearch(w || '').includes(q))));
  document.getElementById('home-no-hit').hidden = !(apps.length && !list.length);
  // 「すべて」で検索もしていない時は、お気に入り・最後に使った時期ごとに分けて表示する
  const grouped = !genre && !q && list.length > 0;
  document.getElementById('app-groups').hidden = !grouped;
  document.getElementById('app-grid').hidden = grouped;
  if (grouped) renderAppGroups(list);
  else renderAppGrid('app-grid', list);
}

/** ホームの段落：上から順に、当てはまる最初の段落に入れる（同じアプリは2回出さない） */
const HOME_GROUPS = [
  { id: 'fav', title: '★ お気に入り', test: (a) => !!a.favorite },
  { id: 'd1', title: '24時間以内に使ったアプリ', test: (a, last, now) => last >= now - 86400000 },
  { id: 'd3', title: '3日以内に使ったアプリ', test: (a, last, now) => last >= now - 3 * 86400000 },
  { id: 'd7', title: '1週間以内に使ったアプリ', test: (a, last, now) => last >= now - 7 * 86400000 },
  { id: 'd30', title: '1か月以内に使ったアプリ', test: (a, last, now) => last >= now - 30 * 86400000 },
  { id: 'old', title: '1か月以上使っていないアプリ', test: () => true },
];

/** お気に入り・最後に使った時期ごとの段落に分けて並べる（段落の中の並びは sortApps のまま。空の段落は出さない） */
function renderAppGroups(apps) {
  const now = Date.now();
  const last = {};
  load(KEYS.HISTORY).forEach(h => {
    const t = Date.parse(h.launchedAt);
    if (t > (last[h.appId] || 0)) last[h.appId] = t;
  });
  const groups = HOME_GROUPS.map(g => ({ ...g, apps: [] }));
  apps.forEach(a => groups.find(g => g.test(a, last[a.id] || 0, now)).apps.push(a));
  const box = document.getElementById('app-groups');
  box.innerHTML = groups.filter(g => g.apps.length).map(g => `
    <section class="app-group" aria-labelledby="group-${g.id}">
      <h2 class="app-group-title" id="group-${g.id}">${esc(g.title)}<span class="app-group-count">${g.apps.length}</span></h2>
      <div class="app-grid">${g.apps.map(appTileHtml).join('')}</div>
    </section>`).join('');
  box.querySelectorAll('[data-launch]').forEach(btn => {
    btn.addEventListener('click', () => launchApp(btn.dataset.launch));
  });
}

/** S01 ホーム画面 */
function renderHome() {
  renderHomeGrid();
  renderAlerts();
}

/** 初回起動時の注意表示（F10） */
async function showFirstNotice() {
  if (loadFlag(KEYS.NOTICE)) return;
  await confirmDialog(
    'データはこの端末のブラウザ内に保存されます。\n機種変更・ブラウザの変更・閲覧データの削除をするとデータは消えます。\n\n右上の「⚙ 設定」から、バックアップファイルの保存や、複数の端末での同期ができます。\niPhoneでは、共有メニューの「ホーム画面に追加」から使うと、データが消えにくくなります。',
    { okLabel: 'わかりました', alertOnly: true }
  );
  saveFlag(KEYS.NOTICE, true);
}

/** プリセットのアプリをすべて登録する（この端末で使えるものだけ・登録済みは飛ばす） */
async function addAllPresets() {
  const platform = detectPlatform();
  const apps = load(KEYS.APPS);
  const targets = PRESETS.filter(p => presetAvailable(p, platform) &&
    !findDuplicate(apps, { presetId: p.pid, iosAppId: p.iosAppId, androidPackage: p.androidPackage }));
  if (!targets.length) { showMessage('追加できるアプリはありません'); return; }
  const ok = await confirmDialog(`対応しているアプリ${targets.length}件をすべて登録します。\n使わないアプリは、あとでアプリ管理画面から削除できます。`, { okLabel: '全部追加する' });
  if (!ok) return;
  const now = Date.now();
  targets.forEach((p, i) => apps.push({
    id: newId() + i, name: p.name, url: p.url, schemeCandidates: p.schemeCandidates,
    iosAppId: p.iosAppId, androidPackage: p.androidPackage, presetId: p.pid,
    icon: p.icon, favorite: false, createdAt: new Date(now + i).toISOString(), // 一覧の並びをプリセット順にする
  }));
  if (save(KEYS.APPS, apps)) showMessage(`${targets.length}件のアプリを登録しました`);
  renderHome();
}

/** 動作を試すためのサンプルデータ（ホームが空のときだけ表示） */
function loadSampleData() {
  const now = Date.now();
  const iso = msAgo => new Date(now - msAgo).toISOString();
  const day = 86400000;
  const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return formatDate(d); };

  const apps = PRESETS.slice(0, 4).map((p, i) => ({
    id: newId() + i, name: p.name, url: p.url, schemeCandidates: p.schemeCandidates, iosAppId: p.iosAppId, androidPackage: p.androidPackage, presetId: p.pid,
    icon: p.icon, favorite: i === 2, createdAt: iso((10 - i) * day),
  }));
  const history = [];
  [[0, 5], [1, 2], [3, 2]].forEach(([idx, count]) => {
    for (let k = 0; k < count; k++) history.push({ id: newId() + idx + k, appId: apps[idx].id, launchedAt: iso((k + 1) * day + idx * 3600000) });
  });
  const points = [
    { id: newId() + 'a', name: '楽天ポイント（サンプル）', amount: 1280, expiry: plus(2), notifyDays: null, memo: '期間限定ポイント' },
    { id: newId() + 'b', name: 'dポイント（サンプル）', amount: 540, expiry: plus(6), notifyDays: 10, memo: '' },
    { id: newId() + 'c', name: 'Pontaポイント（サンプル）', amount: 3020, expiry: plus(45), notifyDays: null, memo: '' },
    { id: newId() + 'd', name: 'Vポイント（サンプル）', amount: 120, expiry: plus(-3), notifyDays: null, memo: '' },
  ];
  save(KEYS.APPS, apps);
  save(KEYS.HISTORY, history);
  save(KEYS.POINTS, points);
  save(KEYS.SHOPS, [{ id: newId() + 's', name: 'セブン-イレブン（サンプル）', appIds: [apps[0].id, apps[3].id] }]);
  showMessage('サンプルデータを入れました');
  renderHome();
}
