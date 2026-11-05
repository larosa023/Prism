// Sets the saved theme before the page paints (passed in by the main process).
(function () {
  const t = new URLSearchParams(location.search).get('theme');
  if (t) document.documentElement.dataset.theme = t;
})();
