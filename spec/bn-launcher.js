(function () {
  if (window.__bnLauncher) return; window.__bnLauncher = 1;
  if (/[?&]in=menustudio/.test(location.search)) return;
  var src = (document.currentScript && document.currentScript.src) || '';
  var role = (src.match(/role=([a-z]+)/) || [])[1] || 'owner';
  var IC = function (n) { return 'url(https://unpkg.com/lucide-static@0.452.0/icons/' + n + '.svg) center/contain no-repeat'; };
  var APPS = [
    ['sell', 'POS Register', 'Take orders and payments', 'shopping-bag', '#F26B1D', 'BorNiz POS Register.dc.html', 'tablet', 'owner manager pic cashier'],
    ['sell', 'Shift lead (PIC)', 'Approvals, cash, handover', 'user-check', '#5B8CFF', 'BorNiz PIC.dc.html', 'tablet', 'owner manager pic'],
    ['sell', 'Online orders', 'GoFood, GrabFood, ShopeeFood, web: inbox, lanes, shelf', 'bike', '#0E8A7E', 'BorNiz Online Orders.dc.html', 'tablet', 'owner manager pic cashier kitchen'],
    ['sell', 'Waiter app', 'Tables, ready dishes, calls', 'hand-platter', '#0E8A7E', 'BorNiz Waiter.dc.html', 'phone', 'owner manager pic waiter'],
    ['floor', 'Kitchen display', 'Tickets by station', 'chef-hat', '#1F9D55', 'BorNiz Kitchen Display.dc.html', 'tablet', 'owner manager pic kitchen'],
    ['floor', 'Customer display', 'Second screen at the counter', 'monitor', '#1F4FD8', 'BorNiz Customer Display.dc.html', 'screen', 'owner manager pic cashier'],
    ['floor', 'Kiosk', 'Self-order kiosk', 'tablet', '#1F4FD8', 'BorNiz Kiosk.dc.html', 'screen', 'owner manager'],
    ['guest', 'QR menu & self-order', 'What guests see on their phone', 'qr-code', '#1F4FD8', 'BorNiz Self Order.dc.html', 'phone', 'owner manager'],
    ['guest', 'Loyalty', 'Members, points, rewards', 'award', '#E0A93B', 'BorNiz Loyalty.dc.html', '', 'owner manager'],
    ['manage', 'Owner dashboard', 'All outlets, live', 'activity', '#F26B1D', 'BorNiz Owner Dashboard.dc.html', '', 'owner manager'],
    ['manage', 'Owner & manager on phone', 'Decisions on the go', 'smartphone', '#F26B1D', 'BorNiz Owner Mobile.dc.html', 'phone', 'owner manager'],
    ['manage', 'Alerts', 'Every warning and who gets it', 'bell', '#E5A000', 'BorNiz Alerts.dc.html', '', 'owner manager pic'],
    ['manage', 'Manager dashboard', 'Business today + approvals', 'store', '#2F6FEB', 'BorNiz Manager Dashboard.dc.html', '', 'owner manager pic'],
    ['manage', 'Shifts & roster', 'Who works when', 'calendar-clock', '#2F6FEB', 'BorNiz Shifts.dc.html', '', 'owner manager pic cashier kitchen waiter'],
    ['custom', 'Customize brand', 'Studios for every customer page', 'palette', '#7C3AED', 'BorNiz Studios.dc.html', '', 'owner manager'],
    ['custom', 'Menu studio', 'Brand, menu, pages & promos, receipts, QR stands', 'utensils', '#7C3AED', 'BorNiz Menu Studio.dc.html', '', 'owner manager'],
    ['custom', 'Brand studio', 'Staff tools look & feel', 'swatch-book', '#7C3AED', 'BorNiz Brand Studio.dc.html', '', 'owner manager'],
    ['manage', 'Operations guide', 'Roles, rules and how to run BorNiz', 'book-open', '#141210', 'BorNiz Operations Guide.dc.html', '', 'owner manager pic'],
    ['manage', 'Who controls what', 'Automatic vs manual, approvals, escalation', 'shield-check', '#141210', 'BorNiz Authority.dc.html', '', 'owner manager pic'],
    ['admin', 'BorNiz admin', 'Platform console', 'shield', '#7C3AED', 'BorNiz Super Admin.dc.html', '', 'admin']
  ];
  var GROUPS = { sell: 'Sell', floor: 'Kitchen & counter', guest: 'What guests see', manage: 'Manage', custom: 'Customize', admin: 'Platform' };
  var mine = APPS.filter(function (a) { return a[7].split(' ').indexOf(role) >= 0; });
  var here = decodeURIComponent((location.pathname.split('/').pop() || ''));
  function el(t, css, html) { var e = document.createElement(t); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }
  var root, panel, list, q, pair;
  function render(filter) {
    list.innerHTML = ''; var f = (filter || '').toLowerCase();
    Object.keys(GROUPS).forEach(function (g) {
      var items = mine.filter(function (a) { return a[0] === g && (!f || (a[1] + ' ' + a[2]).toLowerCase().indexOf(f) >= 0); });
      if (!items.length) return;
      list.appendChild(el('div', 'grid-column:1/-1;font:700 10px/1 JetBrains Mono,ui-monospace,monospace;letter-spacing:.06em;color:#857E76;padding:10px 2px 2px', GROUPS[g].toUpperCase()));
      items.forEach(function (a) {
        var cur = a[5] === here;
        var card = el('div', 'display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:14px;background:' + (cur ? '#FFF3EB' : '#FFFFFF') + ';box-shadow:0 0 0 ' + (cur ? '2px #F26B1D' : '1px #E6E2DC'));
        card.appendChild(el('div', 'display:flex;gap:10px;align-items:center', '<span style="width:36px;height:36px;flex:none;border-radius:11px;background:' + a[4] + ';display:grid;place-items:center"><span style="width:18px;height:18px;background:#fff;-webkit-mask:' + IC(a[3]) + ';mask:' + IC(a[3]) + '"></span></span><span style="display:flex;flex-direction:column;gap:2px;min-width:0"><b style="font-size:13px">' + a[1] + (cur ? ' · here' : '') + '</b><span style="font-size:11px;color:#625C55;line-height:1.3">' + a[2] + '</span></span>'));
        var row = el('div', 'display:flex;gap:6px');
        var open = el('a', 'flex:1;height:34px;border-radius:10px;background:#141210;color:#fff;font-size:12px;font-weight:700;display:grid;place-items:center;text-decoration:none', 'Open'); open.href = a[5];
        row.appendChild(open);
        if (a[6]) { var dev = el('button', 'flex:1;height:34px;border:1px solid #E6E2DC;border-radius:10px;background:#fff;font-size:12px;font-weight:700;cursor:pointer', 'On a ' + a[6]); dev.onclick = function () { showPair(a); }; row.appendChild(dev); }
        card.appendChild(row); list.appendChild(card);
      });
    });
    if (!list.children.length) list.appendChild(el('div', 'grid-column:1/-1;padding:24px;text-align:center;color:#857E76;font-size:13px', 'No app matches “' + filter + '”.'));
  }
  function showPair(a) {
    var code = String(100000 + Math.floor(Math.random() * 899999));
    pair.innerHTML = '';
    pair.appendChild(el('div', 'display:flex;justify-content:space-between;align-items:center', '<b style="font-size:15px">Set up ' + a[1] + ' on a ' + a[6] + '</b>'));
    var x = el('button', 'position:absolute;top:12px;right:12px;width:32px;height:32px;border:0;border-radius:9px;background:#F2EFEA;cursor:pointer', '×'); x.onclick = function () { pair.style.display = 'none'; }; pair.appendChild(x);
    pair.appendChild(el('div', 'display:grid;grid-template-columns:140px minmax(0,1fr);gap:16px;align-items:center',
      '<span style="width:140px;height:140px;border-radius:14px;background:#fff;box-shadow:0 0 0 1px #E6E2DC;padding:12px"><span style="display:block;width:100%;height:100%;background:repeating-linear-gradient(45deg,#141210 0 5px,#fff 5px 10px)"></span></span>' +
      '<span style="display:flex;flex-direction:column;gap:8px;font-size:13px;line-height:1.45"><span><b>1.</b> On the ' + a[6] + ', open <b>go.bornis.id</b> or scan this QR</span><span><b>2.</b> Enter the code</span><b style="font:800 26px/1 JetBrains Mono,ui-monospace,monospace;letter-spacing:.12em">' + code.slice(0, 3) + ' ' + code.slice(3) + '</b><span style="color:#625C55;font-size:12px">The device stays signed in to Kopi Biru Senayan. Staff then use their PIN. Code expires in 10 min.</span></span>'));
    var acts = el('div', 'display:flex;gap:6px');
    ['Send link to WhatsApp', 'Copy link'].forEach(function (t, i) { var b = el('button', 'flex:1;height:38px;border:' + (i ? '1px solid #E6E2DC' : '0') + ';border-radius:10px;background:' + (i ? '#fff' : '#25D366') + ';color:' + (i ? '#141210' : '#fff') + ';font-size:12px;font-weight:700;cursor:pointer', t); b.onclick = function () { b.textContent = i ? 'Copied ✓' : 'Sent ✓'; }; acts.appendChild(b); });
    pair.appendChild(acts); pair.style.display = 'flex';
  }

  var TASKS = [
    ['price', 'Change a menu price', 'Ganti harga menu', [['Open Menu Studio', 'Buka Menu Studio', 'BorNiz Menu Studio.dc.html', 'Menu'], ['Tap the product you want to change', 'Ketuk produk yang mau diganti', 'BorNiz Menu Studio.dc.html', 'Es Kopi'], ['Type the new price, then tap Publish', 'Ketik harga baru, lalu ketuk Publish', 'BorNiz Menu Studio.dc.html', 'Publish']]],
    ['brand', 'Change logo, colors or banner', 'Ganti logo, warna, atau banner', [['Open Menu Studio', 'Buka Menu Studio', 'BorNiz Menu Studio.dc.html', 'Brand'], ['Upload your logo and pick your colors', 'Upload logo dan pilih warnamu', 'BorNiz Menu Studio.dc.html', 'Logo'], ['Check the phone preview, then tap Publish', 'Cek tampilan di HP, lalu ketuk Publish', 'BorNiz Menu Studio.dc.html', 'Publish']]],
    ['pos', 'Set up the cashier tablet', 'Pasang tablet kasir', [['Tap Apps, then “On a tablet” next to POS Register', 'Ketuk Apps, lalu “On a tablet” di POS Register', 'BorNiz Owner Dashboard.dc.html', 'Apps'], ['On the tablet open go.bornis.id and type the code', 'Di tablet buka go.bornis.id dan ketik kodenya', 'BorNiz Owner Dashboard.dc.html', 'Apps'], ['Done. Cashiers log in with their PIN', 'Selesai. Kasir masuk pakai PIN', 'BorNiz POS Register.dc.html', '']]],
    ['sales', 'See today’s sales per hour', 'Lihat penjualan hari ini per jam', [['Open Live monitor', 'Buka Live monitor', 'BorNiz Owner Dashboard.dc.html', 'Live monitor'], ['Tap “Per hour” above the chart', 'Ketuk “Per hour” di atas grafik', 'BorNiz Owner Dashboard.dc.html', 'Per hour'], ['Tap “Per minute · live” to watch it move', 'Ketuk “Per minute · live” untuk lihat yang live', 'BorNiz Owner Dashboard.dc.html', 'Per minute']]],
    ['approve', 'Approve a refund', 'Setujui refund', [['Open Approvals', 'Buka Approvals', 'BorNiz Owner Mobile.dc.html', 'Approvals'], ['Read the reason, then tap Approve or Reject', 'Baca alasannya, lalu ketuk Approve atau Reject', 'BorNiz Owner Mobile.dc.html', 'Approve']]],
    ['qr', 'Print QR codes for tables', 'Cetak QR untuk meja', [['Open Menu Studio', 'Buka Menu Studio', 'BorNiz Menu Studio.dc.html', 'QR'], ['Pick the stand style and tables', 'Pilih model stand dan nomor meja', 'BorNiz Menu Studio.dc.html', 'QR'], ['Tap Download PDF and print', 'Ketuk Download PDF lalu cetak', 'BorNiz Menu Studio.dc.html', 'Download']]],
    ['shift', 'Plan who works this week', 'Atur jadwal kerja minggu ini', [['Open Shifts', 'Buka Shifts', 'BorNiz Shifts.dc.html', 'Build the week'], ['Tap a box to switch Morning / Afternoon / Off', 'Ketuk kotak untuk ganti Pagi / Siang / Libur', 'BorNiz Shifts.dc.html', 'Morning'], ['Red text means a role is missing. Fix it, then publish', 'Tulisan merah artinya ada posisi kosong. Isi, lalu publish', 'BorNiz Shifts.dc.html', 'Publish roster']]],
    ['promo', 'Make a promo or voucher', 'Bikin promo atau voucher', [['Open Customize', 'Buka Customize', 'BorNiz Studios.dc.html', 'Voucher'], ['Set the discount, code and end date', 'Isi diskon, kode, dan tanggal selesai', 'BorNiz Studios.dc.html', 'Voucher'], ['Show it to guests: Menu Studio → Pages → Add → Voucher strip', 'Tampilkan ke tamu: Menu Studio → Pages → Add → Voucher strip', 'BorNiz Menu Studio.dc.html', 'Pages']]],
    ['flash', 'Run a flash sale', 'Bikin flash sale', [['Open Menu Studio, then the Pages tab', 'Buka Menu Studio, lalu tab Pages', 'BorNiz Menu Studio.dc.html', 'Pages'], ['Tap Add, then Flash sale', 'Ketuk Add, lalu Flash sale', 'BorNiz Menu Studio.dc.html', 'Pages'], ['Set the discount and how long it runs', 'Atur diskon dan berapa lama', 'BorNiz Menu Studio.dc.html', 'Pages'], ['Tap Publish. Sale prices show at the POS, QR menu and kiosk', 'Ketuk Publish. Harga sale muncul di kasir, QR menu, dan kiosk', 'BorNiz Menu Studio.dc.html', 'Publish']]],
    ['banner', 'Add a promo banner with a photo', 'Pasang banner promo pakai foto', [['Open Menu Studio, then the Pages tab', 'Buka Menu Studio, lalu tab Pages', 'BorNiz Menu Studio.dc.html', 'Pages'], ['Tap Add, then Promo banner (or Promo carousel)', 'Ketuk Add, lalu Promo banner (atau Promo carousel)', 'BorNiz Menu Studio.dc.html', 'Pages'], ['Tap the banner, then Upload image on the right', 'Ketuk bannernya, lalu Upload image di kanan', 'BorNiz Menu Studio.dc.html', 'Pages'], ['Write the title and tap Publish', 'Tulis judul lalu ketuk Publish', 'BorNiz Menu Studio.dc.html', 'Publish']]],
    ['opname', 'Do a stock count (opname)', 'Hitung stok (opname)', [['Open the PIC app, then Stock count', 'Buka aplikasi PIC, lalu Stock count', 'BorNiz PIC.dc.html', 'Stock count'], ['Pick the area and type what you count. System numbers stay hidden', 'Pilih area dan isi hasil hitung. Angka sistem disembunyikan', 'BorNiz PIC.dc.html', 'Bar'], ['Tap Submit & lock, then add a photo for every difference', 'Ketuk Submit & lock, lalu foto tiap barang yang selisih', 'BorNiz PIC.dc.html', 'Submit'], ['Tap Send for approval. Stock changes after it is approved', 'Ketuk Send for approval. Stok berubah setelah disetujui', 'BorNiz PIC.dc.html', 'Send']]],
    ['sold86', 'Mark an item sold out', 'Tandai menu habis', [['On the PIC tablet, open Sold out', 'Di tablet PIC, buka Sold out', 'BorNiz PIC.dc.html', 'Sold out'], ['Tap the item. It disappears from the POS, QR menu, kiosk and waiter app at this outlet only', 'Ketuk itemnya. Langsung hilang dari kasir, QR menu, kiosk, dan aplikasi waiter di outlet ini saja', 'BorNiz PIC.dc.html', 'Sold out'], ['Tap again when it is back', 'Ketuk lagi kalau sudah ada', 'BorNiz PIC.dc.html', 'Sold out']]],
    ['thanks', 'Send a thank-you WhatsApp after a visit', 'Kirim WhatsApp terima kasih setelah makan', [['Open Customize → Automations', 'Buka Customize → Automations', 'BorNiz Studios.dc.html', 'Automation'], ['Write the message and choose when to send', 'Tulis pesan dan pilih kapan dikirim', 'BorNiz Studios.dc.html', 'Automation']]]
  ];
  var SETUP = [['Add your menu', 'Masukkan menu', 'price'], ['Make it your brand', 'Pakai brand-mu', 'brand'], ['Set up the cashier tablet', 'Pasang tablet kasir', 'pos'], ['Print table QR codes', 'Cetak QR meja', 'qr'], ['Plan the first week of shifts', 'Atur jadwal minggu pertama', 'shift']];
  var lang = localStorage.getItem('bn-help-lang') || 'id', done = JSON.parse(localStorage.getItem('bn-setup') || '[]');
  var hp, coach;
  function L(en, id) { return lang === 'id' ? id : en; }
  function startTour(id) { localStorage.setItem('bn-tour', JSON.stringify({ id: id, s: 0 })); go(); }
  function go() { var t = JSON.parse(localStorage.getItem('bn-tour') || 'null'); if (!t) return; var task = TASKS.filter(function (x) { return x[0] === t.id; })[0]; if (!task) return; var st = task[3][t.s]; if (st[2] !== here) { location.href = st[2]; return; } showCoach(task, t.s); }
  function mark(elm) { if (!elm) return; elm.style.outline = '3px solid #F26B1D'; elm.style.outlineOffset = '3px'; elm.style.borderRadius = elm.style.borderRadius || '10px'; elm.scrollIntoView ? window.scrollTo({ top: Math.max(0, elm.getBoundingClientRect().top + window.scrollY - 160), behavior: 'smooth' }) : 0; }
  function find(txt) { if (!txt) return null; var c = [].slice.call(document.querySelectorAll('button,a,label,b,span')).filter(function (e) { return e.offsetParent && (e.textContent || '').trim().toLowerCase().indexOf(txt.toLowerCase()) === 0 && !root.contains(e) && !(coach && coach.contains(e)); }); return c[0] || null; }
  function showCoach(task, s) {
    if (coach) coach.remove(); [].slice.call(document.querySelectorAll('[data-bn-mark]')).forEach(function (e) { e.style.outline = ''; e.removeAttribute('data-bn-mark'); });
    var st = task[3][s], n = task[3].length;
    coach = el('div', 'position:fixed;right:16px;bottom:64px;z-index:85;width:min(340px,calc(100vw - 32px));padding:16px;border-radius:18px;background:#141210;color:#fff;font-family:Instrument Sans,system-ui,sans-serif;box-shadow:0 24px 50px -12px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:10px');
    coach.innerHTML = '<span style="font:700 11px/1 JetBrains Mono,ui-monospace,monospace;color:#FF9F63;letter-spacing:.06em">' + L('STEP', 'LANGKAH') + ' ' + (s + 1) + ' / ' + n + ' · ' + L(task[1], task[2]).toUpperCase() + '</span><b style="font-size:17px;line-height:1.3">' + L(st[0], st[1]) + '</b><span style="display:flex;gap:4px">' + task[3].map(function (_, i) { return '<span style="flex:1;height:5px;border-radius:9px;background:' + (i <= s ? '#F26B1D' : '#45403A') + '"></span>'; }).join('') + '</span>';
    var row = el('div', 'display:flex;gap:6px');
    var stop = el('button', 'height:40px;padding:0 14px;border:1px solid #45403A;border-radius:12px;background:transparent;color:#CFCAC3;font-size:13px;font-weight:700;cursor:pointer', L('Stop', 'Berhenti')); stop.onclick = function () { localStorage.removeItem('bn-tour'); coach.remove(); };
    var nx = el('button', 'flex:1;height:40px;border:0;border-radius:12px;background:#F26B1D;color:#fff;font-size:13px;font-weight:800;cursor:pointer', s < n - 1 ? L('Next →', 'Lanjut →') : L('Done ✓', 'Selesai ✓'));
    nx.onclick = function () { if (s < n - 1) { localStorage.setItem('bn-tour', JSON.stringify({ id: task[0], s: s + 1 })); go(); } else { localStorage.removeItem('bn-tour'); if (done.indexOf(task[0]) < 0) { done.push(task[0]); localStorage.setItem('bn-setup', JSON.stringify(done)); } coach.remove(); } };
    row.appendChild(stop); row.appendChild(nx); coach.appendChild(row); document.body.appendChild(coach);
    setTimeout(function () { var m = find(st[3]); if (m) { m.setAttribute('data-bn-mark', '1'); mark(m); } }, 500);
  }
  function renderHelp(f) {
    hp.innerHTML = ''; f = (f || '').toLowerCase();
    var top = el('div', 'display:flex;justify-content:space-between;align-items:center;gap:8px', '<b style="font-size:16px">' + L('How do I…?', 'Mau ngapain?') + '</b>');
    var lg = el('button', 'height:30px;padding:0 10px;border:1px solid #E6E2DC;border-radius:9px;background:#fff;font-size:11px;font-weight:700;cursor:pointer', lang === 'id' ? 'EN' : 'ID'); lg.onclick = function () { lang = lang === 'id' ? 'en' : 'id'; localStorage.setItem('bn-help-lang', lang); renderHelp(f); }; top.appendChild(lg); hp.appendChild(top);
    var qi = el('input', 'height:42px;padding:0 14px;border:1.5px solid #E6E2DC;border-radius:12px;font-size:15px;outline:none'); qi.placeholder = L('Type what you want to do… e.g. price, logo, refund', 'Ketik yang mau dilakukan… mis. harga, logo, refund'); qi.value = f; qi.oninput = function () { renderHelp(qi.value); setTimeout(function () { var x = hp.querySelector('input'); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }, 0); }; hp.appendChild(qi);
    if (role === 'owner' && !f) {
      var c = el('div', 'padding:12px;border-radius:14px;background:#FFF3EB;display:flex;flex-direction:column;gap:6px'); c.innerHTML = '<b style="font-size:13px;color:#84340A">' + L('Get started', 'Mulai dari sini') + ' · ' + done.filter(function (d) { return SETUP.some(function (s) { return s[2] === d; }); }).length + ' / ' + SETUP.length + '</b>';
      SETUP.forEach(function (s, i) { var ok = done.indexOf(s[2]) >= 0; var b = el('button', 'display:flex;align-items:center;gap:10px;height:38px;padding:0 10px;border:0;border-radius:10px;background:#fff;font-size:13px;font-weight:600;cursor:pointer;text-align:left;color:' + (ok ? '#857E76' : '#141210'), '<span style="width:20px;height:20px;border-radius:999px;flex:none;display:grid;place-items:center;font-size:11px;font-weight:800;background:' + (ok ? '#1F9D55' : '#F2EFEA') + ';color:' + (ok ? '#fff' : '#625C55') + '">' + (ok ? '✓' : i + 1) + '</span><span style="flex:1;text-decoration:' + (ok ? 'line-through' : 'none') + '">' + L(s[0], s[1]) + '</span><span style="color:#D9560B;font-weight:800">→</span>'); b.onclick = function () { startTour(s[2]); }; c.appendChild(b); });
      hp.appendChild(c);
    }
    var lst = el('div', 'display:flex;flex-direction:column;gap:6px;overflow:auto');
    TASKS.filter(function (t) { return !f || (t[1] + ' ' + t[2]).toLowerCase().indexOf(f) >= 0; }).forEach(function (t) {
      var card = el('div', 'padding:12px;border-radius:14px;background:#fff;box-shadow:0 0 0 1px #E6E2DC;display:flex;flex-direction:column;gap:6px');
      card.innerHTML = '<b style="font-size:14px">' + L(t[1], t[2]) + '</b>' + t[3].map(function (s, i) { return '<span style="font-size:12px;color:#45403A;line-height:1.4"><b style="color:#D9560B">' + (i + 1) + '.</b> ' + L(s[0], s[1]) + '</span>'; }).join('');
      var b = el('button', 'margin-top:4px;height:36px;border:0;border-radius:10px;background:#141210;color:#fff;font-size:12px;font-weight:800;cursor:pointer', L('Show me, step by step', 'Tunjukin langkah-langkahnya')); b.onclick = function () { startTour(t[0]); }; card.appendChild(b); lst.appendChild(card);
    });
    hp.appendChild(lst);
  }
  function toggle(v) { var on = v === undefined ? panel.style.display === 'none' : v; panel.style.display = on ? 'flex' : 'none'; pair.style.display = 'none'; if (on) { q.value = ''; render(''); setTimeout(function () { q.focus(); }, 30); } }
  function build() {
    root = el('div', 'position:fixed;bottom:10px;right:12px;z-index:80;display:flex;flex-direction:column-reverse;align-items:flex-end;font-family:Instrument Sans,system-ui,sans-serif;color:#141210');
    var btn = el('button', 'height:36px;padding:0 12px;border:0;border-radius:12px;background:#141210;color:#fff;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:8px;box-shadow:0 10px 24px -8px rgba(0,0,0,.45)', '<span style="width:16px;height:16px;background:#fff;-webkit-mask:' + IC('layout-grid') + ';mask:' + IC('layout-grid') + '"></span>Apps<span style="padding:2px 6px;border-radius:6px;background:#2E2A26;color:#A9A39B;font:500 10px/1.2 JetBrains Mono,ui-monospace,monospace">⌘K</span>');
    btn.onclick = function () { toggle(); };
    panel = el('div', 'display:none;flex-direction:column;gap:10px;margin-bottom:8px;width:min(560px,calc(100vw - 24px));max-height:72vh;padding:14px;border-radius:20px;background:#FAF8F5;box-shadow:0 0 0 1px #E6E2DC,0 30px 60px -16px rgba(0,0,0,.45);position:relative');
    panel.appendChild(el('div', 'display:flex;justify-content:space-between;align-items:baseline;gap:10px', '<b style="font-size:16px">Open an app</b><span style="font-size:11px;color:#625C55">Signed in as ' + ({ owner: 'Owner · Budi', manager: 'Manager · Andi', pic: 'PIC · Maya (Afternoon)', cashier: 'Cashier · Rina', kitchen: 'Kitchen · Sari', waiter: 'Waiter · Tono', admin: 'BorNiz staff' }[role]) + ' · ' + mine.length + ' apps</span>'));
    q = el('input', 'height:42px;padding:0 14px;border:1.5px solid #E6E2DC;border-radius:12px;font-size:15px;outline:none;background:#fff'); q.placeholder = 'Search apps… (e.g. kitchen, kiosk, menu)'; q.oninput = function () { render(q.value); };
    panel.appendChild(q);
    list = el('div', 'display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px;overflow:auto;padding:2px'); panel.appendChild(list);
    panel.appendChild(el('div', 'font-size:11px;color:#857E76;line-height:1.4', 'One login for everything. Apps you don’t have access to are hidden. Shared devices (POS, KDS, displays, kiosk) are paired once and stay on.'));
    pair = el('div', 'display:none;position:absolute;inset:0;z-index:2;flex-direction:column;gap:14px;padding:18px;border-radius:20px;background:#fff'); panel.appendChild(pair);
    var bar = el('div', 'display:flex;gap:6px;justify-content:flex-end');
    var hb = el('button', 'height:36px;padding:0 12px;border:0;border-radius:12px;background:#F26B1D;color:#fff;font-size:12px;font-weight:800;cursor:pointer;box-shadow:0 10px 24px -8px rgba(242,107,29,.6)', '? ' + L('Help', 'Bantuan'));
    hp = el('div', 'display:none;flex-direction:column;gap:10px;margin-bottom:8px;width:min(420px,calc(100vw - 24px));max-height:72vh;padding:14px;border-radius:20px;background:#FAF8F5;box-shadow:0 0 0 1px #E6E2DC,0 30px 60px -16px rgba(0,0,0,.45);margin-left:auto');
    hb.onclick = function () { var on = hp.style.display === 'none'; hp.style.display = on ? 'flex' : 'none'; panel.style.display = 'none'; if (on) renderHelp(''); };
    btn.addEventListener('click', function () { hp.style.display = 'none'; });

    var bp = el('div', 'display:none;flex-direction:column;gap:8px;margin-bottom:8px;width:min(400px,calc(100vw - 24px));max-height:72vh;padding:14px;border-radius:20px;background:#FAF8F5;box-shadow:0 0 0 1px #E6E2DC,0 30px 60px -16px rgba(0,0,0,.45);margin-left:auto');
    var bellBtn = el('button', 'position:relative;height:36px;width:40px;border:0;border-radius:12px;background:#141210;color:#fff;cursor:pointer;display:grid;place-items:center;box-shadow:0 10px 24px -8px rgba(0,0,0,.45)', '<span style="width:18px;height:18px;background:#fff;-webkit-mask:' + IC('bell') + ';mask:' + IC('bell') + '"></span><span data-bnbell-n style="position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#E5383B;color:#fff;font:800 10px/18px Space Grotesk,sans-serif;display:none"></span>');
    bellBtn.title = 'Alerts';
    var bnBell = { done: {} };
    function bellItems() {
      var A = window.BN_ALERTS || [], out = [], rank = { high: 0, warn: 1, info: 2 }, col = { high: '#E5383B', warn: '#E5A000', info: '#2F6FEB' };
      A.forEach(function (g) { g[2].forEach(function (x) { if (x[2][role] === 1 || (role === 'owner' && x[2].owner)) out.push({ t: x[0], d: x[1], a: x[5], u: x[4], c: col[x[4]] || '#857E76', g: g[0], ch: x[3], esc: x[2][role] === 2 }); }); });
      out.sort(function (p, q) { return (rank[p.u] - rank[q.u]) || p.t.localeCompare(q.t); });
      var times = ['now', '2 min', '6 min', '14 min', '31 min', '1 h', '2 h', '3 h', 'yesterday', 'yesterday', '2 days', '3 days'];
      var base = out.slice(0, 12).map(function (x, i) { x.time = times[i]; x.id = x.t; return x; });
      var live = [], C = window.BN_LIVE ? window.BN_LIVE.cat() : {};
      (window.BN_LIVE ? window.BN_LIVE.list() : []).forEach(function (l) { var c = C[l.n]; if (!c) return; var R = c.x[2]; if (!(R[role] === 1 || (role === 'owner' && R.owner))) return; var s = Math.max(1, Math.round((Date.now() - l.at) / 1000)); live.push({ t: l.n, d: l.d, a: c.x[5], u: c.x[4], c: col[c.x[4]] || '#857E76', g: 'LIVE', id: l.id, time: 'LIVE · ' + (l.from ? l.from + ' · ' : '') + (s < 60 ? s + 's' : Math.round(s / 60) + 'm') + ' ago' }); });
      return live.concat(base);
    }
    function renderBell() {
      var items = bellItems().filter(function (x) { return !bnBell.done[x.id]; });
      var n = items.filter(function (x) { return x.u !== 'info'; }).length, badge = bellBtn.querySelector('[data-bnbell-n]');
      badge.textContent = n; badge.style.display = n ? 'block' : 'none';
      if (bp.style.display === 'none') return;
      bp.innerHTML = '';
      bp.appendChild(el('div', 'display:flex;justify-content:space-between;align-items:baseline;gap:8px', '<b style="font-size:16px">' + L('Alerts', 'Peringatan') + '</b><span style="font-size:11px;color:#625C55">' + ({ owner: 'Owner', manager: 'Manager', pic: 'PIC', cashier: 'Cashier', kitchen: 'Kitchen', waiter: 'Waiter', admin: 'BorNiz admin' }[role] || role) + ' · ' + items.length + '</span>'));
      var lst = el('div', 'display:flex;flex-direction:column;gap:6px;overflow:auto');
      if (!items.length) lst.appendChild(el('div', 'padding:24px;text-align:center;color:#857E76;font-size:13px', L('All clear. Nothing needs you.', 'Aman. Tidak ada yang perlu kamu tangani.')));
      items.forEach(function (x) {
        var card = el('div', 'padding:10px 12px;border-radius:14px;background:#fff;box-shadow:0 0 0 1px ' + (x.u === 'high' ? '#F2B8B8' : '#E6E2DC') + ';display:grid;grid-template-columns:10px minmax(0,1fr);gap:4px 10px');
        card.innerHTML = '<span style="width:10px;height:10px;margin-top:4px;border-radius:999px;background:' + x.c + '"></span><span style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:13px;line-height:1.3">' + x.t + '</b><span style="font-size:11px;color:#857E76;white-space:nowrap">' + x.time + '</span></span><span></span><span style="font-size:12px;color:#625C55;line-height:1.35">' + x.d + '</span>';
        var row = el('div', 'grid-column:2;display:flex;gap:6px;margin-top:4px');
        var go = el('button', 'height:30px;padding:0 10px;border:0;border-radius:9px;background:#141210;color:#fff;font-size:11px;font-weight:700;cursor:pointer', x.a && x.a !== '—' ? x.a.split(' / ')[0] : L('Open', 'Buka'));
        var dn = el('button', 'height:30px;padding:0 10px;border:1px solid #E6E2DC;border-radius:9px;background:#fff;font-size:11px;font-weight:700;cursor:pointer', L('Done', 'Selesai'));
        var sn = el('button', 'height:30px;padding:0 10px;border:0;border-radius:9px;background:transparent;color:#625C55;font-size:11px;font-weight:700;cursor:pointer', x.u === 'high' ? '' : L('Snooze 1 h', 'Tunda 1 jam'));
        go.onclick = dn.onclick = function () { bnBell.done[x.id] = 1; renderBell(); };
        sn.onclick = function () { bnBell.done[x.id] = 1; renderBell(); };
        row.appendChild(go); row.appendChild(dn); if (x.u !== 'high') row.appendChild(sn);
        card.appendChild(row); lst.appendChild(card);
      });
      bp.appendChild(lst);
      var ft = el('a', 'height:36px;border-radius:10px;background:#FFF3EB;color:#B04408;display:grid;place-items:center;font-size:12px;font-weight:700;text-decoration:none', L('All alerts, where they go & settings →', 'Semua peringatan, tujuan & pengaturan →')); ft.href = 'BorNiz Alerts.dc.html';
      bp.appendChild(ft);
    }
    bellBtn.onclick = function () { var on = bp.style.display === 'none'; bp.style.display = on ? 'flex' : 'none'; panel.style.display = 'none'; hp.style.display = 'none'; renderBell(); };
    btn.addEventListener('click', function () { bp.style.display = 'none'; });
    hb.addEventListener('click', function () { bp.style.display = 'none'; });
    var seenLive = {};
    function liveToast(l) { var c = window.BN_LIVE.cat()[l.n]; if (!c) return; var R = c.x[2]; if (!(R[role] === 1 || (role === 'owner' && R.owner))) return; var colr = { high: '#E5383B', warn: '#E5A000', info: '#2F6FEB' }[c.x[4]] || '#857E76'; var tt = el('div', 'position:fixed;top:14px;right:14px;z-index:95;width:min(340px,calc(100vw - 28px));padding:12px 14px;border-radius:16px;background:#141210;color:#fff;font-family:Instrument Sans,system-ui,sans-serif;box-shadow:0 18px 40px -10px rgba(0,0,0,.5);display:flex;gap:10px;align-items:flex-start;cursor:pointer;transform:translateY(-8px);opacity:0;transition:transform 220ms cubic-bezier(.2,.8,.2,1),opacity 220ms', '<span style="width:10px;height:10px;margin-top:5px;flex:none;border-radius:9px;background:' + colr + '"></span><span style="display:flex;flex-direction:column;gap:3px;min-width:0"><b style="font:700 14px/1.25 Space Grotesk,sans-serif">' + l.n + '</b><span style="font-size:12px;color:#CFCAC3;line-height:1.35">' + l.d + '</span><span style="font:600 10px/1 JetBrains Mono,monospace;color:#FF9F63;letter-spacing:.05em">LIVE' + (l.from ? ' · FROM ' + l.from.toUpperCase() : '') + '</span></span>'); tt.onclick = function () { tt.remove(); bp.style.display = 'flex'; renderBell(); }; document.body.appendChild(tt); requestAnimationFrame(function () { tt.style.transform = 'none'; tt.style.opacity = '1'; }); setTimeout(function () { tt.style.opacity = '0'; setTimeout(function () { tt.remove(); }, 250); }, 5000); }
    function onLive() { if (!window.BN_LIVE) return; window.BN_LIVE.list().forEach(function (l) { if (seenLive[l.id]) return; seenLive[l.id] = 1; if (Date.now() - l.at < 20000) liveToast(l); }); renderBell(); }
    function bootLive() { if (window.BN_LIVE) window.BN_LIVE.list().forEach(function (l) { seenLive[l.id] = 1; }); renderBell(); }
    window.addEventListener('storage', function (e) { if (e.key === 'bn-live-alerts') onLive(); });
    window.addEventListener('bn-live', onLive);
    setInterval(function () { if (bp.style.display !== 'none') renderBell(); }, 15000);
    if (!window.BN_ALERTS) { var sc = document.createElement('script'); sc.src = './bn-alerts.js'; sc.onload = bootLive; document.head.appendChild(sc); } else setTimeout(bootLive, 50);
    bar.appendChild(bellBtn); bar.appendChild(hb); bar.appendChild(btn); root.appendChild(bar); root.appendChild(panel); root.appendChild(hp); root.appendChild(bp); document.body.appendChild(root);
    setTimeout(go, 700);
    document.addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); toggle(); } if (e.key === 'Escape') toggle(false); });
    document.addEventListener('mousedown', function (e) { if (!root.contains(e.target)) { if (panel.style.display !== 'none') toggle(false); if (hp && hp.style.display !== 'none') hp.style.display = 'none'; var _bp = root.querySelector && root.lastChild; if (_bp && _bp !== hp && _bp.style && _bp.style.display !== 'none' && _bp.textContent.indexOf('→') > -1 && _bp !== panel) _bp.style.display = 'none'; } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
