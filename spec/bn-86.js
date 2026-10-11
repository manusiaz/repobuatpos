(function () {
  if (window.BN86) return;
  var K = 'bn-86-v1';
  function all() { try { return JSON.parse(localStorage.getItem(K) || 'null') || { sen: ['Pain au Chocolat'], kem: [], bsd: [] }; } catch (e) { return { sen: ['Pain au Chocolat'], kem: [], bsd: [] }; } }
  function save(a) { try { localStorage.setItem(K, JSON.stringify(a)); } catch (e) {} }
  window.BN86 = {
    list: function (o) { return all()[o || 'sen'] || []; },
    has: function (n, o) { return (all()[o || 'sen'] || []).indexOf(n) >= 0; },
    toggle: function (n, o) { var a = all(), k = o || 'sen', l = a[k] || []; a[k] = l.indexOf(n) >= 0 ? l.filter(function (x) { return x !== n; }) : l.concat([n]); save(a); return a[k].indexOf(n) >= 0; }
  };
})();
