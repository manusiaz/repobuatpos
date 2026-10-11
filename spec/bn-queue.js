(function () {
  if (window.BN_Q) return;
  var K = 'bn-owner-queue';
  function all() { try { return JSON.parse(localStorage.getItem(K) || '[]'); } catch (e) { return []; } }
  function save(a) { try { localStorage.setItem(K, JSON.stringify(a)); } catch (e) {} }
  var cur = []; try { cur = JSON.parse(localStorage.getItem(K) || '[]'); } catch (e) {} if (cur.some(function (x) { return x.id === 'pay-oct'; })) save(cur.filter(function (x) { return x.id !== 'pay-oct'; }).concat([{ id: 'buy-tables', type: 'Purchase', what: 'Buy 6 new tables + 24 chairs for Senayan terrace · IDR 18,6 jt', who: 'Andi (Manager) · 3 supplier quotes attached', at: '11:05', st: 'waiting' }, { id: 'reno-kemang', type: 'Renovation', what: 'Kemang bar counter repair & new lighting · IDR 9,4 jt', who: 'Andi (Manager) · photos attached', at: '09:40', st: 'waiting' }]));
  if (!localStorage.getItem(K)) save([{ id: 'rf-1288', type: 'Refund > 500k', what: 'Kemang #1288 · group order cold · IDR 640,000', who: 'Andi (Manager) for PIC Wulan', at: '13:40', st: 'waiting' }, { id: 'buy-tables', type: 'Purchase', what: 'Buy 6 new tables + 24 chairs for Senayan terrace · IDR 18,6 jt', who: 'Andi (Manager) · 3 supplier quotes attached', at: '11:05', st: 'waiting' }, { id: 'reno-kemang', type: 'Renovation', what: 'Kemang bar counter repair & new lighting · IDR 9,4 jt', who: 'Andi (Manager) · photos attached', at: '09:40', st: 'waiting' }]);
  window.BN_Q = {
    all: all,
    waiting: function () { return all().filter(function (x) { return x.st === 'waiting'; }); },
    add: function (item) { var a = all().filter(function (x) { return x.id !== item.id; }); a.unshift(Object.assign({ st: 'waiting', at: new Date().toTimeString().slice(0, 5) }, item)); save(a.slice(0, 30)); },
    set: function (id, st) { var a = all(); a.forEach(function (x) { if (x.id === id) { x.st = st; x.by = 'Owner'; x.doneAt = new Date().toTimeString().slice(0, 5); } }); save(a); },
    get: function (id) { return all().filter(function (x) { return x.id === id; })[0] || null; }
  };
  var MK = 'bn-mgr-queue';
  function mall() { try { return JSON.parse(localStorage.getItem(MK) || '[]'); } catch (e) { return []; } }
  function msave(a) { try { localStorage.setItem(MK, JSON.stringify(a)); } catch (e) {} }
  window.BN_MQ = {
    all: mall, waiting: function () { return mall().filter(function (x) { return x.st === 'waiting'; }); },
    add: function (item) { var a = mall(); if (a.some(function (x) { return x.id === item.id; })) return; a.unshift(Object.assign({ st: 'waiting', at: new Date().toTimeString().slice(0, 5) }, item)); msave(a.slice(0, 30)); },
    set: function (id, st) { var a = mall(); a.forEach(function (x) { if (x.id === id) x.st = st; }); msave(a); }
  };
})();
