// INDX Watch Docs — shared script.
// Claude の Artifact ビューアは <pre class="mermaid"> をネイティブ描画する。
// ローカルでファイルを直接開いた場合だけ、未描画の図を mermaid (CDN) で描画する。
(function () {
  function pending() {
    return Array.prototype.filter.call(document.querySelectorAll("pre.mermaid"), function (el) {
      return !el.querySelector("svg") && !el.getAttribute("data-processed");
    });
  }
  window.addEventListener("load", function () {
    setTimeout(function () {
      if (!pending().length) return;
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js";
      s.onload = function () {
        try {
          var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
          window.mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "neutral", securityLevel: "strict" });
          window.mermaid.run({ nodes: pending() });
        } catch (e) { /* 図はソースのまま表示 */ }
      };
      document.head.appendChild(s);
    }, 1200);
  });
})();
