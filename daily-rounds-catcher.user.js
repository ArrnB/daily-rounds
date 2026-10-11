// ==UserScript==
// @name         Daily Rounds share catcher
// @namespace    daily-rounds
// @version      1.0.0
// @description  When you tap Share in a daily game, the result is sent to your Daily Rounds page. No pasting.
// @match        https://*.nytimes.com/games/*
// @match        https://*.geoguessr.com/*
// @match        https://*.globle-game.com/*
// @match        https://*.maptap.gg/*
// @match        https://games.oec.world/*
// @match        https://*.timeguessr.com/*
// @match        https://*.fermi.gg/*
// @match        https://*.angle.wtf/*
// @match        https://*.chainle.io/*
// @match        https://*.redactle.net/*
// @match        https://*.krillion.io/*
// @match        https://*.googlefeud.com/*
// @match        https://*.metazooa.com/*
// @match        https://*.pokedoku.com/*
// @match        https://*.gamedle.wtf/*
// @match        https://*.guessthe.game/*
// @match        https://*.netlify.app/*
// @match        https://*.github.io/*
// @match        https://*.pages.dev/*
// @match        http://localhost/*
// @noframes
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.deleteValue
// @grant        GM.listValues
// @grant        unsafeWindow
// ==/UserScript==

/*
  How it works
  - On a game site: it listens for the game's own Share / Copy action and keeps a copy of the text.
  - On your Daily Rounds page: it hands over everything it kept, and the page files it.
  Nothing is sent anywhere else. The results wait in this script's own storage until the page takes them.

  The github.io, netlify.app and pages.dev lines exist so the script can find your Daily Rounds page
  wherever you host it. On those sites it does nothing unless the page is Daily Rounds. To tighten it,
  replace those lines with your exact address, for example:  // @match https://yourname.github.io/daily-rounds/*

  To catch results from a game you added yourself, add a @match line for that game's site.
*/

(function () {
  'use strict';

  var VERSION = '1.0.0';
  var STATIC_HOSTS = ['github.io', 'netlify.app', 'pages.dev', 'localhost'];
  var GAME_HOSTS = ['nytimes.com', 'geoguessr.com', 'globle-game.com', 'maptap.gg', 'games.oec.world', 'timeguessr.com',
    'anno-game.netlify.app', 'fermi.gg', 'angle.wtf', 'chainle.io', 'redactle.net', 'krillion.io', 'googlefeud.com',
    'metazooa.com', 'pokedoku.com', 'gamedle.wtf', 'guessthe.game'];

  var host = location.hostname.replace(/^www\./, '');
  function under(h, list) { return list.some(function (d) { return h === d || h.endsWith('.' + d); }); }

  /* Storage that works in Violentmonkey and Tampermonkey (GM_*) and Greasemonkey (GM.*). */
  var store = {
    set: async function (k, v) { return typeof GM_setValue === 'function' ? GM_setValue(k, v) : GM.setValue(k, v); },
    get: async function (k) { return typeof GM_getValue === 'function' ? GM_getValue(k) : GM.getValue(k); },
    del: async function (k) { return typeof GM_deleteValue === 'function' ? GM_deleteValue(k) : GM.deleteValue(k); },
    list: async function () { return typeof GM_listValues === 'function' ? GM_listValues() : GM.listValues(); }
  };

  /* ------------------------------------------------------------------ */
  /* Game sites: catch the Share text                                    */
  /* ------------------------------------------------------------------ */

  /* Wraps the page's copy and share functions. Takes everything it needs as arguments. */
  function installHooks(w, give, own, emit) {
    function attempt(fn) { try { fn(); } catch (e) { /* never break the game's own Share button */ } }

    attempt(function () {
      var proto = own(w.Clipboard && w.Clipboard.prototype);
      if (!proto || typeof proto.writeText !== 'function') return;
      var orig = proto.writeText;
      proto.writeText = give(function (text) {
        try { emit(String(text)); } catch (e) {}
        return orig.apply(this, arguments);
      });
    });

    attempt(function () {
      var proto = own(w.Clipboard && w.Clipboard.prototype);
      if (!proto || typeof proto.write !== 'function') return;
      var orig = proto.write;
      proto.write = give(function (items) {
        try {
          var list = own(items);
          for (var i = 0; list && i < list.length; i++) {
            var it = own(list[i]);
            if (it && it.types && Array.prototype.indexOf.call(it.types, 'text/plain') >= 0) {
              it.getType('text/plain')
                .then(give(function (blob) { return blob.text(); }))
                .then(give(function (text) { try { emit(String(text)); } catch (e) {} }))
                .catch(give(function () {}));
            }
          }
        } catch (e) {}
        return orig.apply(this, arguments);
      });
    });

    attempt(function () {
      var proto = own(w.Navigator && w.Navigator.prototype);
      if (!proto || typeof proto.share !== 'function') return;
      var orig = proto.share;
      proto.share = give(function (data) {
        try {
          var d = own(data) || {};
          var text = typeof d.text === 'string' && d.text ? d.text : (typeof d.title === 'string' ? d.title : '');
          if (text) emit(String(text));
        } catch (e) {}
        return orig.apply(this, arguments);
      });
    });
  }

  function runGame() {
    var lastText = '', lastAt = 0;

    function note(message) {
      try {
        var el = document.createElement('div');
        el.textContent = message;
        el.setAttribute('style', 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;' +
          'background:#16211c;color:#f1f4f0;font:500 14px/1.3 system-ui,sans-serif;padding:9px 14px;border-radius:9px;' +
          'box-shadow:0 4px 18px rgba(0,0,0,.3);pointer-events:none;max-width:90vw;text-align:center');
        (document.body || document.documentElement).appendChild(el);
        setTimeout(function () { el.remove(); }, 2600);
      } catch (e) {}
    }

    function capture(raw) {
      var text = String(raw || '').trim();
      if (text.length < 4 || text.length > 4000) return;
      /* a result has a number or coloured squares in it; skip anything else that gets copied */
      if (!/\d|[\u{1F7E5}-\u{1F7EB}⬛⬜]/u.test(text)) return;
      var now = Date.now();
      if (text === lastText && now - lastAt < 4000) return;
      lastText = text; lastAt = now;
      var id = 'r:' + now.toString(36) + ':' + Math.random().toString(36).slice(2, 6);
      var item = { id: id, host: location.hostname, path: location.pathname, text: text.slice(0, 1500), t: now };
      store.set(id, JSON.stringify(item))
        .then(function () { return store.set('bump', now); })
        .then(function () { note('Result caught for Daily Rounds'); },
              function () { note('Daily Rounds could not keep this result. Paste it in by hand.'); });
    }

    /* Games that copy the older way (select a hidden text box, then copy) fire a normal copy event. */
    document.addEventListener('copy', function () {
      try {
        var text = '';
        var a = document.activeElement;
        if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && typeof a.selectionStart === 'number') {
          text = a.value.slice(a.selectionStart, a.selectionEnd);
        }
        if (!text) { var sel = document.getSelection(); text = sel ? sel.toString() : ''; }
        if (text) capture(text);
      } catch (e) {}
    }, true);

    var pageWin = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
    if (typeof exportFunction === 'function' && pageWin !== window) {
      /* Firefox, script running beside the page: functions must be exported into the page to be callable there. */
      installHooks(pageWin,
        function (fn) { return exportFunction(fn, pageWin); },
        function (o) { return (o && o.wrappedJSObject) || o; },
        capture);
    } else {
      installHooks(pageWin, function (fn) { return fn; }, function (o) { return o; }, capture);
    }

    /* drop anything that has waited more than two weeks for a Daily Rounds page that never came */
    store.list().then(function (keys) {
      (keys || []).forEach(function (k) {
        if (typeof k !== 'string' || k.indexOf('r:') !== 0) return;
        var at = parseInt(k.split(':')[1], 36);
        if (at && Date.now() - at > 14 * 86400000) store.del(k);
      });
    }).catch(function () {});
  }

  /* ------------------------------------------------------------------ */
  /* Daily Rounds page: hand the results over                            */
  /* ------------------------------------------------------------------ */

  function runDashboard() {
    var target = location.origin && location.origin !== 'null' ? location.origin : '*';
    document.documentElement.setAttribute('data-daily-rounds-catcher', VERSION);

    async function send() {
      var items = [];
      try {
        var keys = (await store.list()) || [];
        for (var i = 0; i < keys.length; i++) {
          if (typeof keys[i] !== 'string' || keys[i].indexOf('r:') !== 0) continue;
          var raw = await store.get(keys[i]);
          try { var item = JSON.parse(raw); if (item && typeof item.text === 'string') items.push(item); } catch (e) {}
        }
      } catch (e) {}
      window.postMessage({ src: 'daily-rounds-catcher', type: 'results', version: VERSION, items: items }, target);
    }

    window.addEventListener('message', function (e) {
      if (e.source != window || !e.data || e.data.src !== 'daily-rounds-page') return;
      if (e.data.type === 'pull') send();
      if (e.data.type === 'ack' && e.data.ids) {
        for (var i = 0; i < e.data.ids.length; i++) {
          var id = e.data.ids[i];
          if (typeof id === 'string' && id.indexOf('r:') === 0) store.del(id);
        }
      }
    });

    /* if the page is open in another tab while you play, deliver straight away */
    if (typeof GM_addValueChangeListener === 'function') {
      try { GM_addValueChangeListener('bump', function () { send(); }); } catch (e) {}
    }
    send();
  }

  /* ------------------------------------------------------------------ */

  if (under(host, STATIC_HOSTS) && !under(host, GAME_HOSTS)) {
    var check = function () { if (document.querySelector('meta[name="daily-rounds"]')) runDashboard(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check); else check();
  } else {
    runGame();
  }
})();
