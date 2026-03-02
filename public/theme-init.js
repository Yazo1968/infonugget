(function () {
  try {
    var stored = localStorage.getItem('infonugget-dark-mode');
    var dark = stored !== null
      ? stored === 'true'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
