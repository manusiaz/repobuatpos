(function () {
  if (window.BN_SHIFT) return;
  var K = 'bn-pic-v1', TODAY = 4;
  var SH = { pagi: ['Morning', '06:00–14:00', 6, 14], siang: ['Afternoon', '14:00–22:00', 14, 22], malam: ['Close', '18:00–23:00', 18, 23] };
  function def() { var d = []; for (var i = 0; i < 7; i++) d.push({ pagi: 'Sari', siang: 'Maya', malam: 'Lia' }); return { week: d, pass: {}, sel: null }; }
  function all() { try { return JSON.parse(localStorage.getItem(K) || 'null') || def(); } catch (e) { return def(); } }
  function save(a) { try { localStorage.setItem(K, JSON.stringify(a)); } catch (e) {} }
  function curKey() { var a = all(); if (a.sel) return a.sel; var h = new Date().getHours() + new Date().getMinutes() / 60; return h < 14 ? 'pagi' : h < 18 ? 'siang' : 'malam'; }
  window.BN_SHIFT = {
    SH: SH, TODAY: TODAY,
    week: function () { return all().week; },
    setPic: function (d, k, name) { var a = all(); a.week[d][k] = name; if (d === TODAY) delete a.pass[k]; save(a); },
    pass: function (name) { var a = all(), k = curKey(); a.pass[k] = name; save(a); },
    choose: function (k) { var a = all(); a.sel = k; save(a); },
    now: function () { var a = all(), k = curKey(), s = SH[k], pic = a.pass[k] || a.week[TODAY][k]; return { k: k, label: s[0], time: s[1], pic: pic, passed: !!a.pass[k], rostered: a.week[TODAY][k] }; },
    picOf: function (k) { var a = all(); return a.pass[k] || a.week[TODAY][k]; }
  };
})();
