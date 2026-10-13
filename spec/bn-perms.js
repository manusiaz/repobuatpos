(function () {
  if (window.BN_PERMS) return;
  var src = (document.currentScript && document.currentScript.src) || '';
  var role = (src.match(/role=([a-z]+)/) || [])[1] || 'cashier';
  var outlet = (src.match(/outlet=([a-z]+)/) || [])[1] || 'sen';
  var COL = { owner: 0, manager: 1, pic: 2, cashier: 3, kitchen: 4, waiter: 5, admin: 6 }[role];
  var DEF = {
    'Take orders & charge': 'yyyyoyn', 'Apply discount': 'yyoannn', 'Void item': 'yyoannn', 'Refund': 'yooannn', 'Open drawer without sale': 'yyyannn', 'Connect devices & printers': 'yyynnnn',
    'See & bump tickets': 'yyynyyn', 'Mark item sold out': 'yyyayyn',
    'Accept online order': 'yyyynnn', 'Reject online order (reason)': 'yyyannn', 'Busy mode / pause channel': 'yyyannn', 'Fire scheduled order early': 'yyoannn', 'Hand bag over without pickup code': 'yyyannn',
    'Count stock (opname)': 'yyynnnn', 'Approve opname variance': 'yaonnnn', 'Close cash for the day': 'yyoonnn'
  };
  var MAP = [
    [/^discount/i, 'Apply discount'], [/^refund/i, 'Refund'], [/^void/i, 'Void item'], [/open drawer/i, 'Open drawer without sale'],
    [/^accept$/i, 'Accept online order'], [/^reject order|^decline/i, 'Reject online order (reason)'], [/busy mode|^pause/i, 'Busy mode / pause channel'], [/fire early/i, 'Fire scheduled order early'], [/hand over without|enter pic pin/i, 'Hand bag over without pickup code'],
    [/mark sold out|^86 |sold out \(86\)|^mark 86/i, 'Mark item sold out'], [/^bump/i, 'See & bump tickets'],
    [/start count|^count stock/i, 'Count stock (opname)'], [/close shift|close the day|close cash/i, 'Close cash for the day']
  ];
  function eff() { try { var e = JSON.parse(localStorage.getItem('bn-perms-eff') || 'null'); return e && e.eff ? (e.eff[outlet] || e.eff.all) : null; } catch (x) { return null; } }
  function get(action) { var e = eff(), code = (e && e[action]) || DEF[action]; return code ? code.charAt(COL) : 'y'; }
  function badge() {
    var b = document.querySelector('[data-bn-permbadge]'), e = eff(), custom = 0;
    if (e) Object.keys(DEF).forEach(function (k) { if (e[k] && e[k].charAt(COL) !== DEF[k].charAt(COL)) custom++; });
    if (!custom) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('a'); b.setAttribute('data-bn-permbadge', '1'); b.href = 'BorNiz Roles.dc.html'; b.style.cssText = 'position:fixed;left:12px;top:12px;z-index:70;height:28px;padding:0 10px;border-radius:999px;background:#FFE2CF;color:#84340A;font:800 11px/28px Instrument Sans,system-ui,sans-serif;text-decoration:none;box-shadow:0 6px 16px -6px rgba(20,18,16,.3)'; document.body.appendChild(b); }
    b.textContent = 'Custom permissions · ' + custom + ' changed for ' + role;
  }
  function apply() {
    [].slice.call(document.querySelectorAll('button,[role=button]')).forEach(function (el) {
      if (el.closest('[data-bn-links],[data-bn-spec],[data-bn-launch]')) return;
      var t = (el.textContent || '').trim(), hit = null;
      for (var i = 0; i < MAP.length; i++) if (MAP[i][0].test(t)) { hit = MAP[i][1]; break; }
      if (!hit && el.dataset.bnPerm) hit = el.dataset.bnPerm;
      if (!hit) return;
      var v = get(hit);
      if (v === 'n') { if (el.style.display !== 'none') { el.dataset.bnPermHidden = el.style.display || 'x'; el.style.display = 'none'; } return; }
      if (el.dataset.bnPermHidden) { el.style.display = el.dataset.bnPermHidden === 'x' ? '' : el.dataset.bnPermHidden; delete el.dataset.bnPermHidden; }
      if (v === 'a') { el.title = hit + ': needs approval (PIC → manager)'; el.style.boxShadow = 'inset 0 0 0 2px #E5A000'; el.dataset.bnPermA = '1'; }
      else if (el.dataset.bnPermA) { el.style.boxShadow = ''; el.title = ''; delete el.dataset.bnPermA; }
    });
    badge();
  }
  window.BN_PERMS = { get: get, role: role, outlet: outlet };
  window.addEventListener('storage', function (e) { if (e.key === 'bn-perms-eff') apply(); });
  window.addEventListener('bn-perms', apply);
  setInterval(apply, 1200);
  if (document.readyState !== 'loading') setTimeout(apply, 300); else document.addEventListener('DOMContentLoaded', apply);
})();
