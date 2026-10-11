(function () {
  if (window.self === window.top) return;
  var css = document.createElement('style');
  var nested = /[?&]in=menustudio/.test(location.search);
  css.textContent = '[data-bn-links]{display:none!important}' + (nested ? '[data-bn-spec],[data-bn-mgr],[data-bn-launch]{display:none!important}' : '');
  document.head.appendChild(css);
  function hide() {
    [].slice.call(document.querySelectorAll('div,nav,header')).forEach(function (el) {
      if (el.__bnChecked) return; el.__bnChecked = 1;
      var st = el.getAttribute('style') || '';
      var isTop = /position:\s*sticky/.test(st) && /top:\s*0/.test(st);
      var isSide = el.tagName === 'NAV' && /position:\s*sticky/.test(st) && el.querySelector('a[href*="BorNiz Sitemap"],a[href*="BorNiz Design Notes"]');
      if ((isTop && el.querySelector('a[href*="BorNiz Design System"]')) || isSide) el.style.display = 'none';
    });
  }
  var n = 0, t = setInterval(function () { hide(); if (++n > 20) clearInterval(t); }, 250);
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="BorNiz "]');
    if (a) { e.preventDefault(); window.parent.postMessage({ bnGo: decodeURIComponent(a.getAttribute('href')) }, '*'); }
  }, true);
})();
