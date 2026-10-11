(function () {
  if (window.BN_PROMOS) return;
  var KEY = 'bn-pages-v1';
  var PB_PRODS = ['Es Kopi Susu Aren', 'Croissant Almond', 'Matcha Latte', 'Banana Bread', 'Americano', 'Cheesecake', 'Teh Tarik', 'Pain au Chocolat'];
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function secs() { var p = read(), out = []; if (!p) return out; Object.keys(p).forEach(function (k) { (p[k].sections || []).forEach(function (s) { if (!s.hidden) out.push(s); }); }); return out; }
  function flash() {
    var f = secs().filter(function (s) { return s.type === 'flash'; })[0]; if (!f) return null;
    var q = f.props || {}, st = +localStorage.getItem('bn-flash-start') || 0;
    if (!st) { st = Date.now(); try { localStorage.setItem('bn-flash-start', String(st)); } catch (e) {} }
    var end = st + (q.endsIn || 120) * 60000; if (Date.now() > end) return null;
    return { disc: q.disc || 30, names: PB_PRODS.slice(0, q.count || 4), endsAt: end, title: q.title || 'Flash sale' };
  }
  function price(name, base) { var f = flash(); if (!f || f.names.indexOf(name) < 0) return base; return Math.round(base * (1 - f.disc / 100) / 100) * 100; }
  function cards() {
    var out = [];
    secs().forEach(function (s) { var q = s.props || {};
      if (s.type === 'banner') out.push({ t: q.title, s: q.sub, img: q.img, tag: q.badge || 'Promo' });
      if (s.type === 'carousel') (q.slides || []).forEach(function (x) { out.push({ t: x.title, s: x.sub, img: x.img, tag: x.badge }); });
      if (s.type === 'bundle') out.push({ t: q.title, s: 'IDR ' + (+q.price || 0).toLocaleString('en-US'), img: q.img, tag: 'Combo' });
    });
    var f = flash(); if (f) { var r = Math.max(0, f.endsAt - Date.now()), h = Math.floor(r / 3600000), m = Math.floor(r / 60000) % 60; out.unshift({ t: f.title + ' · up to ' + f.disc + '% off', s: 'Ends in ' + h + 'h ' + m + 'm', img: '', tag: 'FLASH SALE', flash: 1 }); }
    return out.slice(0, 8);
  }
  function esc(t) { return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function render(el) {
    var list = cards(), big = el.getAttribute('data-bn-promos') === 'big';
    if (!list.length) { el.style.display = 'none'; return; } el.style.display = 'flex';
    var html = list.map(function (c) {
      var bg = c.img ? 'url(' + c.img + ') center/cover no-repeat' : c.flash ? 'linear-gradient(135deg,#E5383B,#F26B1D)' : 'linear-gradient(135deg,var(--bn-p,#1F4FD8),var(--bn-ink,#14213D))';
      return '<div style="flex:none;width:' + (big ? '46%' : '78%') + ';aspect-ratio:16/9;border-radius:18px;position:relative;overflow:hidden;background:' + bg + '"><span style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 35%,rgba(0,0,0,.6))"></span>' + (c.tag ? '<span style="position:absolute;top:10px;left:10px;height:22px;padding:0 8px;border-radius:999px;background:' + (c.flash ? '#FFFFFF' : 'var(--bn-acc,#F2B544)') + ';color:' + (c.flash ? '#E5383B' : '#14213D') + ';font:800 10px/22px Space Grotesk,sans-serif">' + esc(c.tag) + '</span>' : '') + '<span style="position:absolute;left:12px;right:12px;bottom:10px;color:#fff;display:flex;flex-direction:column;gap:2px"><b style="font:800 ' + (big ? 22 : 16) + 'px/1.1 var(--bn-font,Space Grotesk,sans-serif)">' + esc(c.t) + '</b><span style="font-size:' + (big ? 13 : 11) + 'px;opacity:.9">' + esc(c.s) + '</span></span></div>';
    }).join('');
    if (el.__h !== html) { el.innerHTML = html; el.__h = html; }
  }
  function tick() { [].slice.call(document.querySelectorAll('[data-bn-promos]')).forEach(render); }
  window.BN_PROMOS = { cards: cards, flash: flash, price: price };
  setInterval(tick, 1500); if (document.readyState !== 'loading') setTimeout(tick, 200); else document.addEventListener('DOMContentLoaded', tick);
})();
