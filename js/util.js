// util.js 共通処理（詳細設計書 7.2）
'use strict';

/** 重複しないIDを作る（日時＋乱数） */
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 日付を YYYY-MM-DD にする（端末の時刻で計算） */
function formatDate(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 今日の日付を YYYY-MM-DD で返す */
function today() {
  return formatDate(new Date());
}

/** 今日から指定日（YYYY-MM-DD）までの残り日数。当日は0、過ぎたら負の数 */
function daysUntil(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

/** YYYY-MM-DD を 2026/11/05 の形にする */
function displayDate(dateStr) {
  return dateStr.replace(/-/g, '/');
}

/** HTMLに入れる文字を無害化する */
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 端末の種類：'ios' / 'android' / 'other' */
function detectPlatform() {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'ios'; // iPadOS
  return 'other';
}

let toastTimer = null;
/**
 * 画面下部に数秒間メッセージを表示する
 * action：{ label, onClick } を渡すとボタン付きになる（表示時間も長くなる）
 */
function showMessage(text, action) {
  const actions = !action ? [] : Array.isArray(action) ? action : [action];
  const el = document.getElementById('toast');
  el.textContent = '';
  const p = document.createElement('span');
  p.textContent = text;
  el.appendChild(p);
  if (actions.length) {
    const row = document.createElement('div');
    row.className = 'toast-actions';
    actions.forEach((a, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action' + (i > 0 ? ' sub' : '');
      btn.textContent = a.label;
      btn.addEventListener('click', () => {
        el.hidden = true;
        clearTimeout(toastTimer);
        a.onClick();
      });
      row.appendChild(btn);
    });
    el.appendChild(row);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, actions.length ? 12000 : 3200);
}

/**
 * 確認ダイアログを出し、OKならtrueを返す（Promise）
 * options.okLabel：OKボタンの文字 / options.danger：削除用の赤ボタン / options.alertOnly：OKだけ表示
 */
function confirmDialog(text, options = {}) {
  const backdrop = document.getElementById('dialog');
  const ok = document.getElementById('dialog-ok');
  const cancel = document.getElementById('dialog-cancel');
  document.getElementById('dialog-text').textContent = text;
  ok.textContent = options.okLabel || 'OK';
  ok.className = 'btn ' + (options.danger ? 'btn-danger' : 'btn-primary');
  cancel.hidden = !!options.alertOnly;
  const input = document.getElementById('dialog-input');
  const suggest = document.getElementById('dialog-suggest');
  if (input) input.hidden = !options.input;
  if (suggest) suggest.hidden = true;
  backdrop.hidden = false;
  ok.focus();

  return new Promise(resolve => {
    const close = result => {
      backdrop.hidden = true;
      ok.onclick = cancel.onclick = backdrop.onclick = null;
      resolve(result);
    };
    ok.onclick = () => close(true);
    cancel.onclick = () => close(false);
    backdrop.onclick = e => { if (e.target === backdrop && !options.alertOnly) close(false); };
  });
}

/**
 * 文字を入力してもらうダイアログ。OKなら入力値、キャンセルならnullを返す（Promise）
 * options.value：初期値 / options.placeholder / options.suggestions：タップで入る候補 / options.okLabel
 */
async function promptDialog(text, options = {}) {
  const input = document.getElementById('dialog-input');
  const suggest = document.getElementById('dialog-suggest');
  input.value = options.value || '';
  input.placeholder = options.placeholder || '';
  const pending = confirmDialog(text, { okLabel: options.okLabel || '保存', input: true });
  const list = options.suggestions || [];
  suggest.innerHTML = list.map(v => `<button type="button" class="chip" data-v="${esc(v)}">${esc(v)}</button>`).join('');
  suggest.hidden = list.length === 0;
  suggest.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => { input.value = b.dataset.v; input.focus(); }));
  input.focus();
  const yes = await pending;
  return yes ? input.value.trim() : null;
}

/** 名前から決まるアイコンの背景色（同じ名前は毎回同じ色） */
function iconColor(name) {
  const colors = ['#d0342c', '#0f7d6c', '#2f62c9', '#b8460f', '#7b3fb8', '#007a99', '#a1306b', '#4f7a1f'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return colors[h % colors.length];
}

/** 利用者が設定したアイコン画像（data URL）か。同期・読み込みで届いたデータも安全に使えるよう形を確かめる */
function safeIconImage(s) {
  return typeof s === 'string' && s.length < 200000 && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : '';
}

/** アプリのアイコン（画像を設定していれば画像、なければ色付きの文字） */
function appIconHtml(app, sm) {
  const cls = 'app-icon' + (sm ? ' sm' : '');
  const img = safeIconImage(app.iconImage);
  if (img) return `<span class="${cls} has-img" aria-hidden="true"><img src="${img}" alt=""></span>`;
  return `<span class="${cls}" style="background:${iconColor(app.name)}" aria-hidden="true">${esc(app.icon || app.name.slice(0, 1))}</span>`;
}

/** 入力欄のエラー表示（空文字で消す） */
function setFieldError(inputId, message) {
  const input = document.getElementById(inputId);
  const err = document.getElementById(inputId + '-error');
  if (err) {
    err.textContent = message;
    err.hidden = !message;
  }
  if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
}
