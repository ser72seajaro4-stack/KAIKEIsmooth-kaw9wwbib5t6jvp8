// points.js ポイント情報管理（F07）・有効期限お知らせ（F08）
'use strict';

const DEFAULT_NOTIFY_DAYS = 7;
const DANGER_DAYS = 3;

let editingPointId = null; // S05で編集中のポイント（新規はnull）

/**
 * ポイントの期限状態を返す
 * level: 'expired'（失効済み・灰）/ 'danger'（残り3日以内・赤）/ 'warning'（お知らせ対象・黄）/ 'ok' / 'none'（期限なし）
 */
function pointStatus(p) {
  if (!p.expiry) return { days: null, level: 'none' };
  const days = daysUntil(p.expiry);
  const notify = p.notifyDays || DEFAULT_NOTIFY_DAYS;
  if (days < 0) return { days, level: 'expired' };
  if (days <= notify) return { days, level: days <= DANGER_DAYS ? 'danger' : 'warning' };
  return { days, level: 'ok' };
}

/** 有効期限が近い順。期限なしは末尾（同じ場合は名前順） */
function sortPoints(points) {
  return [...points].sort((a, b) => {
    if (!a.expiry && !b.expiry) return a.name.localeCompare(b.name, 'ja');
    if (!a.expiry) return 1;
    if (!b.expiry) return -1;
    return a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0;
  });
}

/** ホーム用のお知らせ一覧（残り日数がお知らせ日数以下で、まだ失効していないもの） */
function getAlerts() {
  return load(KEYS.POINTS)
    .map(p => ({ point: p, ...pointStatus(p) }))
    .filter(a => a.level === 'warning' || a.level === 'danger')
    .sort((a, b) => a.days - b.days)
    .map(a => ({ id: a.point.id, name: a.point.name, amount: a.point.amount, days: a.days, level: a.level }));
}

function daysText(st) {
  if (st.level === 'none') return '期限なし';
  if (st.level === 'expired') return '失効済み';
  if (st.days === 0) return '今日まで';
  return `残り${st.days}日`;
}

/** S04 ポイント一覧 */
function renderPoints() {
  const list = document.getElementById('points-list');
  const points = sortPoints(load(KEYS.POINTS));
  document.getElementById('points-empty').hidden = points.length > 0;
  list.innerHTML = points.map(p => {
    const st = pointStatus(p);
    const badgeClass = { none: 'badge-none', expired: 'badge-expired', danger: 'badge-danger', warning: 'badge-warning', ok: 'badge-ok' }[st.level];
    const expiryText = p.expiry ? `${displayDate(p.expiry)}まで` : '有効期限の登録なし';
    return `<li>
      <button type="button" class="list-item point-row${st.level === 'expired' ? ' is-expired' : ''}" data-point="${esc(p.id)}">
        <div class="list-main">
          <div class="list-name">${esc(p.name)}</div>
          <div class="list-sub">${esc(expiryText)} <span class="badge ${badgeClass}">${daysText(st)}</span></div>
          ${p.memo ? `<div class="list-sub">${esc(p.memo)}</div>` : ''}
        </div>
        <div class="point-amount">${Number(p.amount).toLocaleString('ja-JP')}<small>pt</small></div>
      </button>
    </li>`;
  }).join('');
  list.querySelectorAll('[data-point]').forEach(btn => {
    btn.addEventListener('click', () => openPointEdit(btn.dataset.point));
  });
}

/** S05を開く（idなしで新規） */
function openPointEdit(id) {
  editingPointId = id || null;
  showScreen('point-edit');
}

/** S05 ポイント登録・編集 */
function renderPointEdit() {
  const p = editingPointId ? load(KEYS.POINTS).find(x => x.id === editingPointId) : null;
  if (editingPointId && !p) editingPointId = null;
  document.getElementById('screen-title').textContent = p ? 'ポイントを編集' : 'ポイントを追加';
  document.getElementById('point-name').value = p ? p.name : '';
  document.getElementById('point-amount').value = p ? String(p.amount) : '';
  document.getElementById('point-expiry').value = p && p.expiry ? p.expiry : '';
  document.getElementById('point-notify').value = p && p.notifyDays ? String(p.notifyDays) : '';
  document.getElementById('point-memo').value = p ? p.memo || '' : '';
  document.getElementById('btn-delete-point').hidden = !p;
  ['point-name', 'point-amount', 'point-notify'].forEach(id => setFieldError(id, ''));
}

/** 全角数字を半角にして前後の空白を除く */
function normalizeNumber(s) {
  return s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[,，\s]/g, '');
}

/** 保存（入力チェックつき） */
function savePoint(e) {
  e.preventDefault();
  const name = document.getElementById('point-name').value.trim();
  const amountText = normalizeNumber(document.getElementById('point-amount').value);
  const expiry = document.getElementById('point-expiry').value;
  const notifyText = normalizeNumber(document.getElementById('point-notify').value);
  const memo = document.getElementById('point-memo').value.trim();

  let ok = true;
  if (!name) { setFieldError('point-name', 'ポイント名を入力してください。'); ok = false; }
  else setFieldError('point-name', '');

  if (!/^\d+$/.test(amountText)) {
    setFieldError('point-amount', '保有ポイント数は0以上の整数で入力してください。');
    ok = false;
  } else setFieldError('point-amount', '');

  let notifyDays = null;
  if (notifyText !== '') {
    const n = /^\d+$/.test(notifyText) ? Number(notifyText) : NaN;
    if (!(n >= 1 && n <= 90)) {
      setFieldError('point-notify', 'お知らせ日数は1〜90の整数で入力してください。');
      ok = false;
    } else {
      notifyDays = n;
      setFieldError('point-notify', '');
    }
  } else setFieldError('point-notify', '');

  if (!ok) return;

  const item = { id: editingPointId || newId(), name, amount: Number(amountText), expiry: expiry || '', notifyDays, memo };
  const points = load(KEYS.POINTS);
  const idx = points.findIndex(p => p.id === item.id);
  if (idx >= 0) points[idx] = item; else points.push(item);
  if (save(KEYS.POINTS, points)) {
    showMessage(idx >= 0 ? '保存しました' : 'ポイントを追加しました');
    showScreen('points');
  }
}

async function removePoint() {
  const p = load(KEYS.POINTS).find(x => x.id === editingPointId);
  if (!p) return;
  const yes = await confirmDialog(`「${p.name}」を削除しますか？`, { okLabel: '削除する', danger: true });
  if (!yes) return;
  save(KEYS.POINTS, load(KEYS.POINTS).filter(x => x.id !== p.id));
  showMessage('削除しました');
  showScreen('points');
}
