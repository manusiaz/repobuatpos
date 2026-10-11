(function () {
  if (window.BN_DATA) return;
  var K = 'bn-bo-data-v1', LOG = 'bn-bo-log-v1';
  function all() { try { return JSON.parse(localStorage.getItem(K) || '{}'); } catch (e) { return {}; } }
  function save(a) { try { localStorage.setItem(K, JSON.stringify(a)); } catch (e) {} }
  function num(s) { var m = String(s || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); if (!m) return 0; var n = parseFloat(m[0]); if (/jt/i.test(s)) n *= 1e6; else if (/rb/i.test(s)) n *= 1e3; return n; }
  var FIN = { expense: /expense|biaya|operational cost/i, payroll: /payroll|commission|salary|gaji/i, asset: /asset|equipment|peralatan/i, payable: /payable|hutang/i, budget: /budget|forecast/i };
  var BASE = { revenue: 286e6, cogs: 104e6, expense: 18e6, payroll: 72e6, asset: 0, fees: 6e6 };
  function sumKey(re) { var a = all(), t = 0, hit = false; Object.keys(a).forEach(function (k) { if (re.test(k)) { hit = true; (a[k] || []).forEach(function (r) { t += num(r.e); }); } }); return hit ? t : null; }
  window.BN_DATA = {
    get: function (k) { return all()[k] || null; },
    set: function (k, rows, by) { var a = all(); a[k] = rows; save(a); try { var l = JSON.parse(localStorage.getItem(LOG) || '[]'); l.unshift({ k: k, by: by || 'Owner', at: new Date().toTimeString().slice(0, 5) }); localStorage.setItem(LOG, JSON.stringify(l.slice(0, 40))); } catch (e) {} },
    log: function () { try { return JSON.parse(localStorage.getItem(LOG) || '[]'); } catch (e) { return []; } },
    num: num
  };
  window.BN_FIN = function () {
    var ex = sumKey(FIN.expense), pr = sumKey(FIN.payroll), as = sumKey(FIN.asset);
    var f = { revenue: BASE.revenue, cogs: BASE.cogs, expense: ex === null ? BASE.expense : ex, payroll: pr === null ? BASE.payroll : pr, asset: as === null ? 0 : as, fees: BASE.fees };
    f.net = f.revenue - f.cogs - f.expense - f.payroll - f.fees; f.margin = Math.round(f.net / f.revenue * 100); f.cashOut = f.cogs + f.expense + f.payroll + f.fees + f.asset; f.cash = f.revenue - f.cashOut;
    return f;
  };
  window.BN_PRICE = function (name, base) {
    var a = all(), hit = null;
    Object.keys(a).forEach(function (k) { if (!/(product|menu|catalog|price list)/i.test(k)) return; (a[k] || []).forEach(function (r) { if (r && r.a === name && /IDR/i.test(r.e || '') && (!r.b || /All outlets|Senayan/i.test(r.b))) hit = num(r.e); }); });
    return hit || base;
  };
  window.BN_JT = function (n) { return 'IDR ' + (n / 1e6).toFixed(1).replace('.', ',') + ' jt'; };
})();
