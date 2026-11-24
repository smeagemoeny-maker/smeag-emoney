/* SMEAG OFFICE — UI language layer (EN / KO / ZH / TW / JA / VI / RU / AR / MN).
   The tab scripts keep writing English; this file translates what reaches the screen:
   text nodes, placeholder/title attributes and <option> labels, through a MutationObserver.
   - Exact match: the whole (trimmed) text is a key of the dictionary (i18n-dict.js).
   - Templates: keys with {n} (number) / {s} (text) placeholders, matched inside longer text.
   - Phrases: multi-word or "Label:" keys replaced inside longer text (dialog messages, "Name: Kim").
   Data is protected: table body cells only get whole-sentence messages, inputs/textarea values are
   never touched, and an <option> keeps its English value (value attribute) so select.value is unchanged.
   The original English is remembered per node, so switching language (or back to English) is lossless.
   List content (DB values such as menu categories/items) is translated only inside [data-i18n="data"],
   using i18n-data.js (whole-value match, case-insensitive, plus '~' word rules). */
(function () {
  'use strict';

  var LANGS = [
    ['en', 'English'], ['ko', '한국어'], ['zh', '中文(简体)'], ['tw', '中文(繁體)'], ['ja', '日本語'],
    ['vi', 'Tiếng Việt'], ['ru', 'Русский'], ['ar', 'العربية'], ['mn', 'Монгол']
  ];
  var COLS = ['ko', 'zh', 'tw', 'ja', 'vi', 'ru', 'ar', 'mn'];   // column order inside i18n-dict.js
  var HTML_LANG = { en: 'en', ko: 'ko', zh: 'zh-CN', tw: 'zh-TW', ja: 'ja', vi: 'vi', ru: 'ru', ar: 'ar', mn: 'mn' };
  var STORE_KEY = 'officeLang';

  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  var lang = lsGet(STORE_KEY);
  if (!LANGS.some(function (l) { return l[0] === lang; })) lang = 'en';
  var col = -1;

  /* ---------- dictionary ---------- */
  var exact = {};      // English -> [8 translations]
  var templates = [];  // { re, out[] }
  var phrases = [];    // { en, out[] } longest first
  function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function load(raw) {
    Object.keys(raw).forEach(function (en) {
      var out = String(raw[en]).split('|');
      if (/\{[ns]\}/.test(en)) {
        var src = reEsc(en).replace(/\\\{n\\\}/g, '([-+]?[\\d,.]+)').replace(/\\\{s\\\}/g, '([^\\n]*?)');
        templates.push({ re: new RegExp(src, 'g'), out: out, len: en.length, kinds: en.match(/\{[ns]\}/g) });
        return;
      }
      exact[en] = out;
      // Phrase keys: more than one word, or a "Label:" — single words only translate as a whole text.
      if (en.length >= 4 && (/\s/.test(en) || /:$/.test(en))) phrases.push({ en: en, out: out });
    });
    phrases.sort(function (a, b) { return b.en.length - a.en.length; });
    templates.sort(function (a, b) { return b.len - a.len; });
  }
  load(window.OFFICE_I18N_DICT || {});

  /* ---------- data dictionary (i18n-data.js): list content inside [data-i18n="data"] ---------- */
  var dExact = {};     // normalised English value -> [8 translations]
  var dRules = [];     // { re, out[], len } word/phrase rules, longest first
  function norm(s) { return String(s).replace(/\s+/g, ' ').trim().toLowerCase(); }
  (function loadData(raw) {
    Object.keys(raw).forEach(function (en) {
      var out = String(raw[en]).split('|');
      if (en.charAt(0) !== '~') { dExact[norm(en)] = out; return; }
      var key = en.slice(1);
      var src = reEsc(key).replace(/\\\{n\\\}/g, '(\\d[\\d,.]*)');
      // A rule must not start/end inside a word ("Car" in "Carrot").
      var pre = /^[A-Za-z0-9{]/.test(key) ? '(^|[^A-Za-z0-9])' : '()';
      var post = /[A-Za-z]$/.test(key) ? '(?![A-Za-z])' : '';
      dRules.push({ re: new RegExp(pre + src + post, 'gi'), out: out, len: key.length });
    });
    dRules.sort(function (a, b) { return b.len - a.len; });
  })(window.OFFICE_I18N_DATA || {});

  function translateData(text) {
    if (col < 0 || !text || !/[A-Za-z]/.test(text)) return text;
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
    var hit = dExact[norm(m[2])];
    if (hit) { var t = pick(hit); return t == null ? text : m[1] + t + m[3]; }
    // Rules: replace with placeholders first so one rule never re-matches another rule's output.
    var s = m[2], parts = [], changed = false;
    dRules.forEach(function (r) {
      var tr = pick(r.out); if (tr == null) return;
      s = s.replace(r.re, function (all, before, num) {
        changed = true;
        parts.push(tr.replace('{n}', num || ''));
        return before + '\u0001' + (parts.length - 1) + '\u0002';
      });
    });
    if (!changed) return text;
    s = s.replace(/\u0001(\d+)\u0002/g, function (a, i) { return parts[+i]; });
    return m[1] + s + m[3];
  }
  function inData(elm) { return !!elm.closest('[data-i18n="data"]'); }

  function pick(out) { var t = out[col]; return t == null || t === '' ? null : t; }
  function isLetter(ch) { return !!ch && /[A-Za-z0-9]/.test(ch); }

  // sentenceOnly: table cells — only a whole-text match of a message (has a space and ends with . ! ?)
  function translate(text, sentenceOnly) {
    if (col < 0 || !text || !/[A-Za-z]{2}/.test(text)) return text;
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
    var core = m[2];
    var hit = exact[core];
    if (hit) {
      if (sentenceOnly && !(/\s/.test(core) && /[.!?)]$/.test(core))) return text;
      var t = pick(hit);
      return t == null ? text : m[1] + t + m[3];
    }
    if (sentenceOnly) return text;
    var s = core, changed = false;
    templates.forEach(function (tp) {
      var tr = pick(tp.out); if (tr == null) return;
      s = s.replace(tp.re, function () {
        // {n} and {s} values are filled by kind, each in source order, so a translation may reorder them.
        var args = Array.prototype.slice.call(arguments, 1, -2), byKind = { '{n}': [], '{s}': [] };
        tp.kinds.forEach(function (k, i) { byKind[k].push(args[i] || ''); });
        changed = true;
        return tr.replace(/\{[ns]\}/g, function (k) { return byKind[k].shift() || ''; });
      });
    });
    phrases.forEach(function (p) {
      var idx = s.indexOf(p.en); if (idx < 0) return;
      var tr = pick(p.out); if (tr == null) return;
      var outS = '', from = 0;
      while (idx >= 0) {
        var before = s.charAt(idx - 1), after = s.charAt(idx + p.en.length);
        var okL = !isLetter(p.en.charAt(0)) || !isLetter(before);
        var okR = !isLetter(p.en.charAt(p.en.length - 1)) || !isLetter(after);
        if (okL && okR) { outS += s.slice(from, idx) + tr; from = idx + p.en.length; changed = true; }
        idx = s.indexOf(p.en, okL && okR ? from : idx + 1);
      }
      s = outS + s.slice(from);
    });
    return changed ? m[1] + s + m[3] : text;
  }

  /* ---------- DOM ---------- */
  var nodeSrc = new WeakMap();   // text node -> { src, out }
  var attrSrc = new WeakMap();   // element   -> { attr: { src, out } }
  var ATTRS = ['placeholder', 'title', 'aria-label'];
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CODE: 1, PRE: 0 };
  var SKIP_SEL = '[data-noi18n], [contenteditable=""], [contenteditable="true"], svg, .tb-title, .card, .ub-who';

  function skipped(elm) { return !elm || SKIP_TAGS[elm.tagName] === 1 || !!elm.closest(SKIP_SEL); }
  function inBodyCell(elm) { return !!elm.closest('tbody td, tbody th'); }

  function doText(node) {
    var p = node.parentElement;
    if (!p || skipped(p)) return;
    var rec = nodeSrc.get(node);
    var cur = node.nodeValue;
    if (!rec || cur !== rec.out) rec = { src: cur, out: cur };   // new text written by the page
    if (p.tagName === 'OPTION' && !p.hasAttribute('value')) p.setAttribute('value', rec.src);
    var t = inData(p) ? translateData(rec.src) : translate(rec.src, inBodyCell(p));
    rec.out = t;
    nodeSrc.set(node, rec);
    if (t !== cur) node.nodeValue = t;
    if (p.classList.contains('tab-text')) squeezeTabs();
  }
  function doAttrs(elm) {
    if (skipped(elm)) return;
    var map = attrSrc.get(elm);
    ATTRS.forEach(function (a) {
      if (!elm.hasAttribute(a)) return;
      var cur = elm.getAttribute(a);
      var rec = map && map[a];
      if (!rec || cur !== rec.out) rec = { src: cur, out: cur };
      var t = translate(rec.src, false);
      rec.out = t;
      if (!map) { map = {}; attrSrc.set(elm, map); }
      map[a] = rec;
      if (t !== cur) elm.setAttribute(a, t);
    });
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (skipped(root)) return; doAttrs(root); }
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeType === 1) return SKIP_TAGS[n.tagName] === 1 || n.matches(SKIP_SEL) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = tw.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }

  // Tabs are fixed-width: shrink a translated label that would overflow (same rule as office.js buildTabs).
  var squeezeQueued = false;
  function squeezeTabs() {
    if (squeezeQueued) return;
    squeezeQueued = true;
    requestAnimationFrame(function () {
      squeezeQueued = false;
      if (document.body.classList.contains('m')) return;
      document.querySelectorAll('#tabstrip .tab-text').forEach(function (s) {
        s.style.transform = '';
        var w = s.offsetWidth, tw = (s.parentElement ? s.parentElement.clientWidth : 125) - 8;
        if (w > tw && tw > 0) s.style.transform = 'scaleX(' + (tw / w).toFixed(3) + ')';
      });
    });
  }

  var observer = new MutationObserver(function (list) {
    list.forEach(function (m) {
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doAttrs(m.target);
      else m.addedNodes.forEach(walk);
    });
  });

  function applyLang(code) {
    lang = code;
    col = COLS.indexOf(code);
    lsSet(STORE_KEY, code);
    document.documentElement.lang = HTML_LANG[code] || 'en';
    document.body.setAttribute('data-lang', code);
    var sel = document.getElementById('langSel');
    if (sel && sel.value !== code) sel.value = code;
    walk(document.body);
    squeezeTabs();
  }

  function buildSelector() {
    var sel = document.getElementById('langSel');
    if (!sel) return;
    sel.innerHTML = LANGS.map(function (l) { return '<option value="' + l[0] + '">' + l[1] + '</option>'; }).join('');
    sel.value = lang;
    sel.addEventListener('change', function () { applyLang(sel.value); });
  }

  function start() {
    buildSelector();
    applyLang(lang);
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS
    });
  }

  window.OfficeI18n = {
    t: function (s) { return translate(s, false); },
    data: function (s) { return translateData(s); },
    lang: function () { return lang; },
    setLang: applyLang,
    languages: LANGS.slice()
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
