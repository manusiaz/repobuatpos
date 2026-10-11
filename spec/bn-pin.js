(function () {
  if (window.BN_PIN) return;
  var src = (document.currentScript && document.currentScript.src) || '';
  var role = (src.match(/role=([a-z]+)/) || [])[1] || 'owner';
  var WHO = { owner: 'Budi · Owner', manager: 'Andi · Manager', pic: 'Maya · PIC', admin: 'BorNiz admin' }[role] || 'Approver';
  var DEMO = '246810', RX = /^(approve|reject|confirm with pin|sign\b|sign off|verify)/i;
  var tries = 0, lockedUntil = 0, pass = null, box, dots, err, sub, pin = '', pending = null;
  function el(t, c, h) { var e = document.createElement(t); if (c) e.style.cssText = c; if (h != null) e.innerHTML = h; return e; }
  function draw() { dots.innerHTML = ''; for (var i = 0; i < 6; i++) dots.appendChild(el('span', 'width:16px;height:16px;border-radius:999px;border:2px solid #141210;background:' + (i < pin.length ? '#141210' : 'transparent'))); }
  function close() { box.style.display = 'none'; pin = ''; pending = null; }
  function key(k) {
    if (Date.now() < lockedUntil) return;
    if (k === 'del') { pin = pin.slice(0, -1); err.textContent = ''; draw(); return; }
    if (pin.length >= 6) return; pin += k; draw();
    if (pin.length === 6) setTimeout(function () {
      if (pin === DEMO) { var b = pending; tries = 0; close(); if (b) { pass = b; b.click(); } }
      else { tries++; pin = ''; draw(); if (tries >= 5) { lockedUntil = Date.now() + 15 * 60000; err.textContent = 'Locked for 15 minutes after 5 wrong tries. Your manager and owner were alerted.'; } else err.textContent = 'Wrong PIN · ' + (5 - tries) + ' tries left'; }
    }, 150);
  }
  function build() {
    box = el('div', 'display:none;position:fixed;inset:0;z-index:95;background:rgba(20,18,16,.55);align-items:center;justify-content:center;padding:16px;font-family:Instrument Sans,system-ui,sans-serif;color:#141210');
    var card = el('div', 'width:min(380px,100%);padding:22px;border-radius:28px;background:#fff;box-shadow:0 24px 60px -12px rgba(20,18,16,.45);display:flex;flex-direction:column;gap:14px');
    card.appendChild(el('div', 'display:flex;flex-direction:column;gap:4px', '<b style="font:700 22px/1.15 Space Grotesk,sans-serif">Enter your approval PIN</b><span style="font-size:12px;color:#625C55">' + WHO + ' · 6 digits · not your login password</span>'));
    sub = el('div', 'padding:10px 12px;border-radius:12px;background:#FAF8F5;font-size:13px;line-height:1.4;color:#45403A'); card.appendChild(sub);
    dots = el('div', 'display:flex;gap:10px;justify-content:center'); card.appendChild(dots);
    err = el('div', 'min-height:16px;text-align:center;font-size:12px;font-weight:600;color:#B3261E'); card.appendChild(err);
    var pad = el('div', 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px');
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].forEach(function (k) { var b = el('button', 'height:56px;border:0;border-radius:16px;background:' + (k ? '#F2EFEA' : 'transparent') + ';font:600 22px/1 Space Grotesk,sans-serif;cursor:' + (k ? 'pointer' : 'default'), k); if (k) b.onclick = function () { key(k === '⌫' ? 'del' : k); }; pad.appendChild(b); });
    card.appendChild(pad);
    var row = el('div', 'display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:#625C55');
    row.appendChild(el('span', '', 'Forgot it? Owner resets it · demo PIN <b style="font-family:JetBrains Mono,monospace">246810</b>'));
    var c = el('button', 'height:36px;padding:0 14px;border:1px solid #E6E2DC;border-radius:10px;background:#fff;font-size:12px;font-weight:700;cursor:pointer', 'Cancel'); c.onclick = close; row.appendChild(c);
    card.appendChild(row); box.appendChild(card); document.body.appendChild(box);
    document.addEventListener('keydown', function (e) { if (box.style.display === 'none') return; if (/^\d$/.test(e.key)) key(e.key); if (e.key === 'Backspace') key('del'); if (e.key === 'Escape') close(); });
  }
  function ask(b) {
    if (!box) build(); pending = b; pin = ''; draw();
    var card = b.closest('div[style*="border"]') || b.parentElement; var ctx = ((card && card.innerText) || '').replace(/\s+/g, ' ').replace(/(Approve|Reject)/g, '').trim().slice(0, 110);
    sub.innerHTML = '<b>' + b.textContent.trim() + '</b>' + (ctx ? ' · ' + ctx.replace(/</g, '&lt;') : '') + '<br><span style="font-size:11px;color:#857E76">You can’t decide your own request. Your name goes on the receipt and audit log.</span>';
    err.textContent = Date.now() < lockedUntil ? 'Locked. Ask your owner to reset your approval PIN.' : '';
    box.style.display = 'flex';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button,[role=button],a');
    if (!b || (box && box.contains(b))) return;
    if (pass === b) { pass = null; return; }
    var t = (b.textContent || '').trim();
    if (!RX.test(t) && !b.hasAttribute('data-bn-approve')) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); ask(b);
  }, true);
  window.BN_PIN = { ask: ask, role: role };
})();
