// shops.js 店舗ショートカット管理（F11・追加機能）
// 店舗の選択は利用者が手動で行う（位置情報は使わない）。
'use strict';

let currentShopId = null; // S07で表示中、またはS08で編集中のお店（新規はnull）

/** S06 店舗ショートカット一覧 */
function renderShops() {
  const list = document.getElementById('shops-list');
  const shops = load(KEYS.SHOPS);
  const apps = load(KEYS.APPS);
  document.getElementById('shops-empty').hidden = shops.length > 0;
  list.innerHTML = shops.map(s => {
    const names = (s.appIds || []).map(id => apps.find(a => a.id === id)).filter(Boolean).map(a => a.name);
    return `<li class="list-item">
      <button type="button" class="shop-open" data-open="${esc(s.id)}">
        <div class="list-name">${esc(s.name)}</div>
        <div class="list-sub">${names.length ? esc(names.join('・')) : 'アプリが紐付いていません'}</div>
      </button>
      <button type="button" class="icon-btn" data-edit="${esc(s.id)}" aria-label="${esc(s.name)}を編集">✎</button>
    </li>`;
  }).join('');
  list.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openShopApps(b.dataset.open)));
  list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openShopEdit(b.dataset.edit)));
}

function openShopApps(id) {
  currentShopId = id;
  showScreen('shop-apps');
}

/** S07 店舗別アプリ表示（紐付けたアプリだけ。並びはホームと同じ規則） */
function renderShopApps() {
  const shop = load(KEYS.SHOPS).find(s => s.id === currentShopId);
  if (!shop) { showScreen('shops'); return; }
  document.getElementById('screen-title').textContent = shop.name;
  const ids = new Set(shop.appIds || []);
  const apps = sortApps(load(KEYS.APPS).filter(a => ids.has(a.id)), load(KEYS.HISTORY));
  document.getElementById('shop-apps-empty').hidden = apps.length > 0;
  renderAppGrid('shop-app-grid', apps);
}

function openShopEdit(id) {
  currentShopId = id || null;
  showScreen('shop-edit');
}

/** S08 店舗ショートカット編集 */
function renderShopEdit() {
  const shop = currentShopId ? load(KEYS.SHOPS).find(s => s.id === currentShopId) : null;
  if (currentShopId && !shop) currentShopId = null;
  document.getElementById('screen-title').textContent = shop ? 'お店を編集' : 'お店を追加';
  document.getElementById('shop-name').value = shop ? shop.name : '';
  document.getElementById('btn-delete-shop').hidden = !shop;
  setFieldError('shop-name', '');
  setFieldError('shop-apps', '');

  const selected = new Set(shop ? shop.appIds : []);
  const apps = load(KEYS.APPS);
  const box = document.getElementById('shop-app-checks');
  box.innerHTML = apps.length
    ? apps.map(a => `<label class="check">
        <input type="checkbox" value="${esc(a.id)}" ${selected.has(a.id) ? 'checked' : ''}>
        ${appIconHtml(a, true)}
        <span>${esc(a.name)}</span>
      </label>`).join('')
    : '<p class="empty-text">先に「登録」からアプリを登録してください。</p>';
}

function saveShop(e) {
  e.preventDefault();
  const name = document.getElementById('shop-name').value.trim();
  const appIds = [...document.querySelectorAll('#shop-app-checks input:checked')].map(i => i.value);
  let ok = true;
  if (!name) { setFieldError('shop-name', 'お店の名前を入力してください。'); ok = false; }
  else setFieldError('shop-name', '');
  if (appIds.length === 0) { setFieldError('shop-apps', '使うアプリを1つ以上選んでください。'); ok = false; }
  else setFieldError('shop-apps', '');
  if (!ok) return;

  const shops = load(KEYS.SHOPS);
  const item = { id: currentShopId || newId(), name, appIds };
  const idx = shops.findIndex(s => s.id === item.id);
  if (idx >= 0) shops[idx] = item; else shops.push(item);
  if (save(KEYS.SHOPS, shops)) {
    showMessage(idx >= 0 ? '保存しました' : 'お店を追加しました');
    showScreen('shops');
  }
}

async function removeShop() {
  const shop = load(KEYS.SHOPS).find(s => s.id === currentShopId);
  if (!shop) return;
  const yes = await confirmDialog(`「${shop.name}」を削除しますか？\n登録したアプリは削除されません。`, { okLabel: '削除する', danger: true });
  if (!yes) return;
  save(KEYS.SHOPS, load(KEYS.SHOPS).filter(s => s.id !== shop.id));
  showMessage('削除しました');
  showScreen('shops');
}
