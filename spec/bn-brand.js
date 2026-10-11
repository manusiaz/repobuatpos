(function () {
  var KEY = 'bn-brand-v1';
  var DEF = { name: 'Kopi Biru', p: '#1F4FD8', acc: '#F2B544', ink: '#14213D', paper: '#F7F4EE', font: 'space', banner: 'g1', img: '' };
  var THEMES = {
    'Kopi Biru': { p: '#1F4FD8', acc: '#F2B544', ink: '#14213D', paper: '#F7F4EE', font: 'space', banner: 'g1' },
    'Warung Hijau': { p: '#2F7A4F', acc: '#E8C14A', ink: '#1E2E24', paper: '#F3F1E8', font: 'serif', banner: 'g2' },
    'Sakura Bakery': { p: '#C2416B', acc: '#F6C6D4', ink: '#3A1F2A', paper: '#FBF4F2', font: 'serif', banner: 'g3' },
    'Bara Grill': { p: '#C2410C', acc: '#FACC15', ink: '#1C1917', paper: '#F5F1EB', font: 'system', banner: 'g4' }
  };
  var FONTS = { space: "'Space Grotesk',system-ui,sans-serif", bricolage: "Space Grotesk,system-ui,sans-serif", serif: "Georgia,'Times New Roman',serif", system: "Instrument Sans,system-ui,sans-serif" };
  var BANNERS = { g1: 'linear-gradient(135deg,#2B4C7E,#14213D)', g2: 'linear-gradient(135deg,#3E8E5E,#1E2E24)', g3: 'linear-gradient(135deg,#E07A9B,#7A2945)', g4: 'linear-gradient(135deg,#EA580C,#1C1917)' };
  function load() { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return Object.assign({}, DEF); } }
  function save(b) { try { localStorage.setItem(KEY, JSON.stringify(b)); } catch (e) { b.img = ''; try { localStorage.setItem(KEY, JSON.stringify(b)); } catch (e2) {} } }
  function apply(b) {
    var r = document.documentElement.style;
    r.setProperty('--bn-p', b.p); r.setProperty('--bn-acc', b.acc); r.setProperty('--bn-ink', b.ink); r.setProperty('--bn-paper', b.paper);
    r.setProperty('--bn-font', FONTS[b.font] || FONTS.space);
    r.setProperty('--bn-banner', b.img ? 'url(' + b.img + ') center/cover no-repeat' : (BANNERS[b.banner] || BANNERS.g1));
    document.querySelectorAll('[data-bn-name]').forEach(function (el) { if (el.firstChild && el.firstChild.nodeType === 3) el.firstChild.nodeValue = b.name; });
  }
  var b = load(); apply(b);
  window.addEventListener('storage', function (e) { if (e.key === KEY) { b = load(); apply(b); sync(); } });
  setInterval(function () { document.querySelectorAll('[data-bn-name]').forEach(function (el) { if (el.firstChild && el.firstChild.nodeType === 3 && el.firstChild.nodeValue !== b.name) el.firstChild.nodeValue = b.name; }); }, 400);

  var panel, inputs = {};
  function set(k, v) { b[k] = v; if (k === 'banner') b.img = ''; save(b); apply(b); sync(); }
  function sync() { if (!panel) return; ['p', 'acc', 'ink', 'paper'].forEach(function (k) { inputs[k].value = b[k]; }); inputs.name.value = b.name; inputs.font.value = b.font;
    panel.querySelectorAll('[data-ban]').forEach(function (el) { el.style.boxShadow = (!b.img && el.dataset.ban === b.banner) ? '0 0 0 3px #F26B1D' : '0 0 0 1px #E6E2DC'; });
    inputs.imgNote.textContent = b.img ? 'Custom banner uploaded' : 'JPG or PNG, wide 3:1 works best'; }
  function el(tag, css, html) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }
  function build() {
    var wrap = el('div', 'position:fixed;bottom:54px;right:12px;z-index:70;display:flex;flex-direction:column-reverse;align-items:flex-end;font-family:Instrument Sans,system-ui,sans-serif;color:#141210');
    var btn = el('button', 'height:38px;padding:0 14px;border:0;border-radius:999px;background:#141210;color:#fff;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 10px 24px -8px rgba(0,0,0,.45)', '✎ Customize brand');
    panel = el('div', 'display:none;margin-bottom:8px;width:300px;max-height:70vh;overflow:auto;padding:14px;border-radius:18px;background:#fff;box-shadow:0 0 0 1px #E6E2DC,0 24px 50px -14px rgba(0,0,0,.4);font-size:12px');
    btn.onclick = function () { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; };
    var h = function (t) { panel.appendChild(el('div', 'margin:12px 0 6px;font-size:10px;font-weight:700;letter-spacing:.06em;color:#857E76', t)); };
    panel.appendChild(el('div', 'font-size:14px;font-weight:700', 'Client branding'));
    panel.appendChild(el('div', 'color:#625C55;line-height:1.4;margin-top:4px', 'Changes apply to self-order, loyalty, customer display and every customer page. Saved in this browser for the demo.'));
    h('QUICK THEMES'); var tw = el('div', 'display:grid;grid-template-columns:1fr 1fr;gap:6px');
    Object.keys(THEMES).forEach(function (n) { var t = THEMES[n]; var c = el('button', 'height:40px;border:0;border-radius:10px;background:' + t.p + ';color:#fff;font-size:11px;font-weight:700;cursor:pointer', n); c.onclick = function () { Object.assign(b, t, { name: n, img: '' }); save(b); apply(b); sync(); }; tw.appendChild(c); });
    panel.appendChild(tw);
    h('STORE NAME'); inputs.name = el('input', 'width:100%;height:36px;padding:0 10px;border:1.5px solid #E6E2DC;border-radius:10px;font-size:14px'); inputs.name.oninput = function () { set('name', inputs.name.value || 'Store'); }; panel.appendChild(inputs.name);
    h('COLORS'); var cg = el('div', 'display:grid;grid-template-columns:1fr 1fr;gap:6px');
    [['p', 'Primary'], ['acc', 'Accent'], ['ink', 'Ink / header'], ['paper', 'Background']].forEach(function (x) { var row = el('label', 'display:flex;align-items:center;gap:8px;padding:6px;border-radius:10px;border:1px solid #E6E2DC'); var i = el('input', 'width:28px;height:28px;border:0;padding:0;background:none;cursor:pointer'); i.type = 'color'; i.oninput = function () { set(x[0], i.value); }; inputs[x[0]] = i; row.appendChild(i); row.appendChild(el('span', 'font-weight:600', x[1])); cg.appendChild(row); });
    panel.appendChild(cg);
    h('HEADING FONT'); inputs.font = el('select', 'width:100%;height:36px;border:1.5px solid #E6E2DC;border-radius:10px;font-size:13px;padding:0 8px');
    [['space', 'Space Grotesk (BorNiz default)'], ['bricolage', 'Bricolage Grotesque'], ['serif', 'Serif (Georgia)'], ['system', 'System UI']].forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; inputs.font.appendChild(op); });
    inputs.font.onchange = function () { set('font', inputs.font.value); }; panel.appendChild(inputs.font);
    h('BANNER / COVER'); var bg = el('div', 'display:grid;grid-template-columns:repeat(4,1fr);gap:6px');
    Object.keys(BANNERS).forEach(function (k) { var s = el('button', 'height:40px;border:0;border-radius:10px;cursor:pointer;background:' + BANNERS[k]); s.dataset.ban = k; s.onclick = function () { set('banner', k); }; bg.appendChild(s); });
    panel.appendChild(bg);
    var up = el('label', 'margin-top:8px;height:40px;border:1.5px dashed #CFCAC3;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:700;cursor:pointer', 'Upload banner image'); var fi = el('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.style.display = 'none';
    fi.onchange = function () { var f = fi.files[0]; if (!f) return; var rd = new FileReader(); rd.onload = function () { var img = new Image(); img.onload = function () { var c = document.createElement('canvas'), w = Math.min(1200, img.width); c.width = w; c.height = Math.round(img.height * w / img.width); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); b.img = c.toDataURL('image/jpeg', .78); save(b); apply(b); sync(); }; img.src = rd.result; }; rd.readAsDataURL(f); };
    up.appendChild(fi); panel.appendChild(up); inputs.imgNote = el('div', 'margin-top:4px;color:#857E76'); panel.appendChild(inputs.imgNote);
    var rs = el('button', 'margin-top:12px;width:100%;height:36px;border:1px solid #E6E2DC;border-radius:10px;background:#fff;font-size:12px;font-weight:600;cursor:pointer', 'Reset to Kopi Biru'); rs.onclick = function () { b = Object.assign({}, DEF); save(b); apply(b); sync(); }; panel.appendChild(rs);
    wrap.appendChild(btn); wrap.appendChild(panel); document.body.appendChild(wrap); sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
