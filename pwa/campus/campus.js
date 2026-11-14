/* SMEAG Campus student app (plain script, no build step).
   API: /api/campus/* (api/src/campus.mjs). Request forms are drawn from GET /api/campus/config,
   so a new request type on the server shows up here without changing this file. */
(function () {
  'use strict';

  var IS_LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || location.protocol === 'file:';
  var API = (function () {
    try { var o = localStorage.getItem('campusApiOrigin'); if (o) return o; } catch (e) { /* ignore */ }
    return IS_LOCAL ? 'http://localhost:8787' : location.origin;
  })();
  var TOKEN_KEY = 'smeagCampusToken';
  var LANG_KEY = 'smeagCampusLang';
  var app = document.getElementById('app');

  // ---------- storage ----------
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  // ---------- state ----------
  var S = {
    token: lsGet(TOKEN_KEY),
    lang: lsGet(LANG_KEY) || ((navigator.language || '').toLowerCase().indexOf('ko') === 0 ? 'ko' : 'en'),
    config: null, me: null, notices: null, requests: null, scores: null, catalog: {},
    wallet: { kind: 'all', rows: [], next: null, summary: null, loaded: false },
    chat: [], chatBusy: false, signinMode: 'login', reqGroup: 'life'
  };

  // ---------- text ----------
  var T = {
    en: {
      appName: 'SMEAG Campus', signIn: 'Sign in', firstTime: 'First time here', studentId: 'Student ID', pin: 'PIN',
      pinHint: '4 to 6 digits', newPin: 'New PIN', confirmPin: 'Type the PIN again', signInBtn: 'Sign in', setPinBtn: 'Set my PIN',
      proveIt: 'Prove it is you', tapCard: 'Tap your student card on the back of this phone', tapStart: 'Start card reading',
      tapReading: 'Hold your card on the back of the phone…', tapDone: 'Card read', noNfc: 'This phone cannot read cards from the web (iPhone). Use the code from the office.',
      officeCode: 'Code from the office', officeCodeHint: 'Ask the SMEAG office for a 6-digit code if you cannot tap your card.',
      useCard: 'Use my card', useCode: 'Use an office code', pinMismatch: 'The two PINs are different.',
      home: 'Home', wallet: 'Wallet', requests: 'Requests', scores: 'Scores', bot: 'SMEAG Bot', botShort: 'Bot', notices: 'Notices', settings: 'Settings',
      hello: 'Hi', balance: 'E-money balance', available: 'Available', held: 'Held for requests', cardActive: 'Card active', cardFrozenMsg: 'Your card is frozen. It cannot pay at stores.',
      daysLeft: function (n) { return n >= 0 ? n + ' days left' : 'Course ended'; }, courseEnds: 'Course ends',
      quick: 'Quick requests', latestNotices: 'Notices', seeAll: 'See all', myOpen: 'Waiting for the office', none: 'Nothing here yet.',
      last30: 'Last 30 days', topUps: 'Top-ups', spent: 'Spent', all: 'All', in: 'Top-ups', out: 'Spending', loadMore: 'Load more',
      freeze: 'Freeze card', unfreeze: 'Unfreeze card', freezeAsk: 'Freeze your card? Nobody can pay with it until you unfreeze it.', freezeYes: 'Yes, freeze it',
      cancel: 'Cancel', frozenToast: 'Card frozen', unfrozenToast: 'Card unfrozen', topUpWhere: 'Top up with cash at the SMEAG office.',
      newRequest: 'New request', myRequests: 'My requests', send: 'Send request', sending: 'Sending…', sent: 'Request sent',
      fee: 'Fee', free: 'Free', total: 'Charged on approval', notEnough: 'Not enough e-money for this request.',
      chooseOption: 'Choose one', option: 'Option', noOptions: 'No options are open right now. Ask the office.', cancelReq: 'Cancel request', cancelled: 'Request cancelled',
      needsFirst: 'Needs an approved', staffSays: 'Office note', paidTag: 'Paid', chargedNote: 'Charged from e-money',
      noScores: 'No mock test scores yet. They appear here after the academic office uploads them.', overall: 'Overall',
      listening: 'Listening', reading: 'Reading', writing: 'Writing', speaking: 'Speaking',
      botHello: 'Hi! I am SMEAG Bot. Ask me about e-money, requests, pickups, scores or school rules.',
      botPlaceholder: 'Ask a question…', botSend: 'Send', botFaq: 'From the SMEAG FAQ', botAi: 'Answered by SMEAG Bot (AI). Check important details with the office.',
      suggestions: ['How do I top up?', 'I lost my card', 'When is my request charged?', 'How do I book a pickup?'],
      language: 'Language', changePin: 'Change PIN', oldPin: 'Current PIN', save: 'Save', saved: 'Saved', signOut: 'Sign out',
      offline: 'Cannot reach the server. Check your internet connection.', retry: 'Try again', perDay: '/ day', perWeek: '/ week',
      starts: 'Starts', capacity: 'Seats', groups: { life: 'Campus life', departure: 'Departure', academic: 'Academics' },
      departureHint: 'Do these in order: graduation check, checkout time, pickup, then balance refund.'
    },
    ko: {
      appName: 'SMEAG 캠퍼스', signIn: '로그인', firstTime: '처음 사용', studentId: '학번', pin: 'PIN',
      pinHint: '숫자 4~6자리', newPin: '새 PIN', confirmPin: 'PIN 다시 입력', signInBtn: '로그인', setPinBtn: 'PIN 설정',
      proveIt: '본인 확인', tapCard: '학생카드를 휴대폰 뒷면에 대주세요', tapStart: '카드 읽기 시작',
      tapReading: '카드를 휴대폰 뒷면에 대고 있어주세요…', tapDone: '카드 확인됨', noNfc: '이 휴대폰(아이폰)은 웹에서 카드를 읽을 수 없어요. 오피스 코드를 사용하세요.',
      officeCode: '오피스 코드', officeCodeHint: '카드를 찍을 수 없으면 SMEAG 오피스에서 6자리 코드를 받으세요.',
      useCard: '카드로 확인', useCode: '오피스 코드로 확인', pinMismatch: '두 PIN이 다릅니다.',
      home: '홈', wallet: '지갑', requests: '신청', scores: '점수', bot: 'SMEAG 봇', botShort: '봇', notices: '공지사항', settings: '설정',
      hello: '안녕하세요', balance: '이머니 잔액', available: '사용 가능', held: '신청 대기 금액', cardActive: '카드 사용중', cardFrozenMsg: '카드가 정지되어 매장에서 결제할 수 없습니다.',
      daysLeft: function (n) { return n >= 0 ? n + '일 남음' : '과정 종료'; }, courseEnds: '과정 종료일',
      quick: '바로 신청', latestNotices: '공지사항', seeAll: '전체 보기', myOpen: '오피스 처리 대기', none: '아직 없습니다.',
      last30: '최근 30일', topUps: '충전', spent: '사용', all: '전체', in: '충전', out: '사용', loadMore: '더 보기',
      freeze: '카드 정지', unfreeze: '정지 해제', freezeAsk: '카드를 정지할까요? 해제할 때까지 누구도 결제할 수 없습니다.', freezeYes: '네, 정지합니다',
      cancel: '취소', frozenToast: '카드를 정지했습니다', unfrozenToast: '정지를 해제했습니다', topUpWhere: '충전은 SMEAG 오피스에서 현금으로 합니다.',
      newRequest: '새 신청', myRequests: '내 신청 내역', send: '신청하기', sending: '보내는 중…', sent: '신청했습니다',
      fee: '금액', free: '무료', total: '승인 시 차감', notEnough: '이머니 잔액이 부족합니다.',
      chooseOption: '선택하세요', option: '선택 항목', noOptions: '지금 신청할 수 있는 항목이 없습니다. 오피스에 문의하세요.', cancelReq: '신청 취소', cancelled: '신청을 취소했습니다',
      needsFirst: '먼저 승인 필요:', staffSays: '오피스 메모', paidTag: '결제됨', chargedNote: '이머니에서 차감됨',
      noScores: '아직 모의고사 점수가 없습니다. 학업 오피스가 올리면 여기에 표시됩니다.', overall: '종합',
      listening: '리스닝', reading: '리딩', writing: '라이팅', speaking: '스피킹',
      botHello: '안녕하세요! SMEAG 봇입니다. 이머니, 신청, 픽업, 점수, 학교 규정에 대해 물어보세요.',
      botPlaceholder: '질문을 입력하세요…', botSend: '보내기', botFaq: 'SMEAG FAQ 답변', botAi: 'SMEAG 봇(AI)의 답변입니다. 중요한 내용은 오피스에 확인하세요.',
      suggestions: ['이머니 충전은 어떻게 해요?', '카드를 잃어버렸어요', '신청 금액은 언제 빠져요?', '픽업 예약 방법'],
      language: '언어', changePin: 'PIN 변경', oldPin: '현재 PIN', save: '저장', saved: '저장했습니다', signOut: '로그아웃',
      offline: '서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.', retry: '다시 시도', perDay: '/ 일', perWeek: '/ 주',
      starts: '일시', capacity: '정원', groups: { life: '생활', departure: '퇴실', academic: '학업' },
      departureHint: '순서대로 진행하세요: 졸업 확인 → 퇴실 시간 → 픽업 → 잔액 환불.'
    }
  };
  function t(k) { var v = T[S.lang][k]; return v === undefined ? T.en[k] : v; }
  function L(obj, base) { // pick en/ko text from {en,ko} or {title_en,title_ko}
    if (!obj) return '';
    if (base) return (S.lang === 'ko' && obj[base + '_ko']) || obj[base + '_en'] || '';
    return (S.lang === 'ko' && obj.ko) || obj.en || '';
  }

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function peso(n) { return '₱' + money(n); }
  function newKey() { var a = new Uint8Array(12); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; }); return 'k' + Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function todayPH() { return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); }
  function typeDef(key) { return S.config && S.config.types.filter(function (x) { return x.key === key; })[0]; }
  function statusLabel(s) { return S.config ? L(S.config.statuses[s]) : s; }
  var toastTimer;
  function toast(msg) {
    var el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  function api(method, path, body) {
    var headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (S.token) headers.Authorization = 'Bearer ' + S.token;
    return fetch(API + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (d) {
          if (res.status === 401 && path !== '/api/campus/login' && path !== '/api/campus/activate') { signOut(true); }
          if (!res.ok) { var e = new Error(d.error || ('Error ' + res.status)); e.status = res.status; throw e; }
          return d;
        });
      }, function () { throw new Error(t('offline')); });
  }

  // ---------- icons ----------
  var IC = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14h2"/>',
    requests: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    scores: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    bot: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6"/>',
    bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    cleaning: '<path d="M14 3l-4 9M7 12h10l2 9H5z"/>', pickup: '<path d="M3 13l2-6h14l2 6v5h-3v-2H6v2H3z"/><circle cx="7" cy="14" r="1"/><circle cx="17" cy="14" r="1"/>',
    clinic: '<path d="M4 19V6a2 2 0 0 1 2-2h12v15H6a2 2 0 0 0-2 2z"/><path d="M12 8v6M9 11h6"/>', overnight: '<path d="M20 15A8 8 0 1 1 9 4a6 6 0 0 0 11 11z"/>',
    activity: '<path d="M3 20l6-12 4 7 3-4 5 9z"/>', room: '<path d="M4 21V4h16v17M4 21h16M14 12h.01"/>'
  };
  function icon(name) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[name] || '') + '</svg>'; }

  // ---------- routing ----------
  var VIEWS = ['home', 'wallet', 'requests', 'scores', 'bot', 'notices', 'settings'];
  function view() { var h = location.hash.replace('#', ''); return VIEWS.indexOf(h) >= 0 ? h : 'home'; }
  window.addEventListener('hashchange', function () { if (S.token) render(); });

  // ---------- sign in ----------
  var nfcReader = null, nfcUid = '';
  function renderSignin(errMsg) {
    var m = S.signinMode;
    var nfcOk = 'NDEFReader' in window && window.isSecureContext;
    app.innerHTML =
      '<div class="signin">' +
        '<div class="row" style="justify-content:flex-end;margin-bottom:8px">' + langToggle() + '</div>' +
        '<div class="brand"><div class="logo">S</div><div><b>' + esc(t('appName')) + '</b><span class="muted small">E-money · Requests · Scores · SMEAG Bot</span></div></div>' +
        '<div class="tabs2" role="group"><button type="button" data-mode="login" aria-pressed="' + (m === 'login') + '">' + esc(t('signIn')) + '</button>' +
        '<button type="button" data-mode="activate" aria-pressed="' + (m !== 'login') + '">' + esc(t('firstTime')) + '</button></div>' +
        '<form id="signinForm" class="stack" autocomplete="on" novalidate>' +
          field('sid', t('studentId'), '<input class="input" id="sid" name="username" autocomplete="username" autocapitalize="characters" spellcheck="false" required value="' + esc(lsGet('smeagCampusSid') || '') + '">') +
          (m === 'login'
            ? field('pin', t('pin'), '<input class="input code" id="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="current-password" required>')
            : '<div class="field"><label>' + esc(t('proveIt')) + '</label>' +
                (m === 'activate'
                  ? '<div class="tapzone' + (nfcUid ? ' done' : '') + '" id="tapzone">' +
                      (nfcOk
                        ? '<span>' + esc(nfcUid ? t('tapDone') + ' ✓' : t('tapCard')) + '</span>' + (nfcUid ? '' : '<button type="button" class="btn small" id="tapStart">' + esc(t('tapStart')) + '</button>')
                        : '<span class="small muted">' + esc(t('noNfc')) + '</span>') +
                    '</div><button type="button" class="linkbtn" data-mode="code">' + esc(t('useCode')) + '</button>'
                  : '<input class="input code" id="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="000000">' +
                    '<span class="hint">' + esc(t('officeCodeHint')) + '</span>' +
                    (nfcOk ? '<button type="button" class="linkbtn" data-mode="activate" style="justify-self:start">' + esc(t('useCard')) + '</button>' : '')) +
              '</div>' +
              field('pin', t('newPin'), '<input class="input code" id="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="new-password" required>', t('pinHint')) +
              field('pin2', t('confirmPin'), '<input class="input code" id="pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="new-password" required>')) +
          '<div class="err" id="err" role="alert">' + esc(errMsg || '') + '</div>' +
          '<button class="btn block" type="submit" id="signinBtn">' + esc(m === 'login' ? t('signInBtn') : t('setPinBtn')) + '</button>' +
        '</form>' +
      '</div>';
    if (m === 'activate' && !nfcOk) { S.signinMode = 'code'; return renderSignin(errMsg); }
  }
  function field(id, label, control, hint) {
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' + control + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div>';
  }
  function startNfc() {
    var zone = document.getElementById('tapzone');
    try {
      nfcReader = new window.NDEFReader();
      zone.className = 'tapzone live';
      zone.innerHTML = '<span>' + esc(t('tapReading')) + '</span>';
      nfcReader.scan().then(function () {
        nfcReader.onreading = function (ev) {
          nfcUid = String(ev.serialNumber || '').replace(/[:\s-]/g, '').toLowerCase();
          if (!nfcUid) return;
          var z = document.getElementById('tapzone');
          if (z) { z.className = 'tapzone done'; z.innerHTML = '<span>' + esc(t('tapDone')) + ' ✓</span>'; }
          if (navigator.vibrate) navigator.vibrate(60);
        };
      }).catch(function (e) { setErr(e.message); zone.className = 'tapzone'; });
    } catch (e) { setErr(e.message); }
  }
  function setErr(msg) { var el = document.getElementById('err'); if (el) el.textContent = msg || ''; }

  function submitSignin() {
    var sid = (document.getElementById('sid').value || '').trim();
    var pin = document.getElementById('pin').value;
    if (!sid) return setErr(t('studentId') + '?');
    var btn = document.getElementById('signinBtn');
    var req;
    if (S.signinMode === 'login') {
      req = api('POST', '/api/campus/login', { studentId: sid, pin: pin });
    } else {
      if (pin !== document.getElementById('pin2').value) return setErr(t('pinMismatch'));
      var body = { studentId: sid, pin: pin };
      if (S.signinMode === 'code') body.code = (document.getElementById('code').value || '').trim();
      else body.uid = nfcUid;
      req = api('POST', '/api/campus/activate', body);
    }
    btn.disabled = true; setErr('');
    req.then(function (d) {
      lsSet('smeagCampusSid', sid);
      S.token = d.token; lsSet(TOKEN_KEY, d.token);
      if (d.lang) { S.lang = d.lang; lsSet(LANG_KEY, d.lang); }
      if (nfcReader) nfcReader.onreading = null;
      nfcUid = '';
      location.hash = '#home';
      boot();
    }).catch(function (e) { btn.disabled = false; setErr(e.message); });
  }

  function signOut(expired) {
    S.token = null; lsSet(TOKEN_KEY, null);
    S.me = S.notices = S.requests = S.scores = null; S.catalog = {}; S.chat = [];
    S.wallet = { kind: 'all', rows: [], next: null, summary: null, loaded: false };
    S.signinMode = 'login';
    renderSignin(expired === true ? (S.lang === 'ko' ? '다시 로그인해 주세요.' : 'Please sign in again.') : '');
  }

  // ---------- chrome ----------
  function langToggle() {
    return '<div class="lang" role="group" aria-label="Language"><button type="button" data-lang="en" aria-pressed="' + (S.lang === 'en') + '">EN</button><button type="button" data-lang="ko" aria-pressed="' + (S.lang === 'ko') + '">한</button></div>';
  }
  function nav(v) {
    var open = (S.requests || []).filter(function (r) { return r.status === 'submitted' || r.status === 'reviewing'; }).length;
    var items = [['home', 'home', t('home')], ['wallet', 'wallet', t('wallet')], ['requests', 'requests', t('requests')], ['scores', 'scores', t('scores')], ['bot', 'bot', t('botShort')]];
    return '<nav class="nav" aria-label="Main"><div class="in">' + items.map(function (it) {
      var cur = v === it[0] || (it[0] === 'home' && (v === 'notices' || v === 'settings'));
      return '<a href="#' + it[0] + '"' + (cur ? ' aria-current="page"' : '') + '><span class="dot">' + icon(it[1]) + (it[0] === 'requests' && open ? '<b>' + open + '</b>' : '') + '</span>' + esc(it[2]) + '</a>';
    }).join('') + '</div></nav>';
  }
  function frame(v, title, body, opts) {
    opts = opts || {};
    app.innerHTML =
      '<div class="shell"><header class="top">' +
        (opts.back ? '<a class="iconbtn" href="#home" aria-label="Back">' + icon('back') + '</a>' : '') +
        '<h1>' + esc(title) + '</h1>' + langToggle() +
        (v === 'home' ? '<a class="iconbtn" href="#settings" aria-label="' + esc(t('settings')) + '">' + icon('gear') + '</a>' : '') +
      '</header><main id="main" class="stack">' + body + '</main></div>' + nav(v) + (opts.after || '');
  }

  // ---------- views ----------
  function render() {
    if (!S.token) return renderSignin();
    if (!S.me || !S.config) return;
    var v = view();
    ({ home: viewHome, wallet: viewWallet, requests: viewRequests, scores: viewScores, bot: viewBot, notices: viewNotices, settings: viewSettings })[v]();
    if (v !== 'bot') window.scrollTo(0, 0);
  }

  function balanceCard() {
    var w = S.me.wallet, p = S.me.person;
    return '<section class="card balance"><div class="lbl">' + esc(t('balance')) + '</div>' +
      '<div class="amt">' + esc(peso(w.balance)) + '</div>' +
      '<div class="sub"><span>' + esc(t('available')) + ' <b class="num">' + esc(peso(w.available)) + '</b></span>' +
      (w.held > 0 ? '<span>' + esc(t('held')) + ' <b class="num">' + esc(peso(w.held)) + '</b></span>' : '') +
      (w.cardFrozen ? '' : '<span class="cardstate"><i></i>' + esc(t('cardActive')) + '</span>') + '</div>' +
      (w.cardFrozen ? '<div class="frozen">' + esc(t('cardFrozenMsg')) + '</div>' : '') +
      '<div class="sub"><span>' + esc(t('courseEnds')) + ' ' + esc(p.endDate || '-') + (p.daysLeft != null ? ' · ' + esc(t('daysLeft')(p.daysLeft)) : '') + '</span></div>' +
    '</section>';
  }

  function viewHome() {
    var p = S.me.person;
    var quickTypes = [['cleaning', 'cleaning'], ['pickup', 'pickup'], ['clinic', 'clinic'], ['overnight', 'overnight']];
    var open = (S.requests || []).filter(function (r) { return ['submitted', 'reviewing'].indexOf(r.status) >= 0; }).slice(0, 3);
    var ns = (S.notices || []).slice(0, 3);
    frame('home', t('hello') + ', ' + (p.name || '').split(' ')[0],
      balanceCard() +
      '<section><div class="sectionlabel">' + esc(t('quick')) + '</div><div class="quick" style="margin-top:8px">' +
        quickTypes.map(function (q) { var d = typeDef(q[0]); return d ? '<button type="button" data-new="' + q[0] + '">' + icon(q[1]) + esc(L(d)) + '</button>' : ''; }).join('') +
      '</div></section>' +
      (open.length ? '<section class="card"><h2>' + esc(t('myOpen')) + '<a href="#requests">' + esc(t('seeAll')) + '</a></h2><div class="list">' + open.map(reqLine).join('') + '</div></section>' : '') +
      '<section class="card"><h2>' + esc(t('latestNotices')) + '<a href="#notices">' + esc(t('seeAll')) + '</a></h2>' +
        (ns.length ? '<div class="list">' + ns.map(noticeLine).join('') + '</div>' : '<div class="empty">' + esc(t('none')) + '</div>') + '</section>' +
      '<a class="card row botlink" href="#bot">' + icon('bot') + '<div class="grow"><b>' + esc(t('bot')) + '</b><div class="small muted">' + esc(t('botHello')) + '</div></div></a>');
  }

  function reqLine(r) {
    var d = typeDef(r.type);
    return '<div class="li"><span class="t">' + esc(L(d) || r.type) + (r.payload && r.payload.item ? ' · ' + esc(L(r.payload.item, 'title')) : '') + '</span>' +
      '<span class="v"><span class="pill ' + esc(r.status) + '">' + esc(statusLabel(r.status)) + '</span></span>' +
      '<span class="s">' + esc(r.created) + (r.fee ? ' · ' + esc(peso(r.fee)) : '') + '</span></div>';
  }
  function noticeLine(n) {
    return '<div class="li" style="grid-template-columns:1fr"><span class="t">' + (n.pinned ? '📌 ' : '') + esc(L(n, 'title')) + '</span><span class="s">' + esc(n.published) + '</span></div>';
  }

  // ----- wallet -----
  function viewWallet() {
    var w = S.wallet, me = S.me.wallet;
    var sum = w.summary;
    frame('wallet', t('wallet'),
      balanceCard() +
      (sum ? '<div class="stats"><div class="stat"><span>' + esc(t('last30')) + ' · ' + esc(t('topUps')) + '</span><b class="pos">+' + esc(peso(sum.topUps)) + '</b></div>' +
        '<div class="stat"><span>' + esc(t('last30')) + ' · ' + esc(t('spent')) + '</span><b>−' + esc(peso(sum.spent)) + '</b></div></div>' : '') +
      '<div class="chips" id="kinds">' + ['all', 'in', 'out'].map(function (k) { return '<button type="button" class="chip" data-kind="' + k + '" aria-pressed="' + (w.kind === k) + '">' + esc(t(k)) + '</button>'; }).join('') + '</div>' +
      '<section class="card"><div class="list" id="txlist">' + (w.loaded ? txRows(w.rows) : '<div class="empty">…</div>') + '</div>' +
        (w.next ? '<div class="row" style="justify-content:center;margin-top:8px"><button type="button" class="btn ghost small" id="more">' + esc(t('loadMore')) + '</button></div>' : '') + '</section>' +
      '<p class="small muted" style="margin:0 2px">' + esc(t('topUpWhere')) + '</p>' +
      '<section class="card" id="freezeBox">' + freezeBox(me.cardFrozen, false) + '</section>');
    if (!w.loaded) loadWallet(false);
  }
  function txRows(rows) {
    if (!rows.length) return '<div class="empty">' + esc(t('none')) + '</div>';
    return rows.map(function (r) {
      return '<div class="li"><span class="t">' + esc(r.title) + '</span><span class="v ' + (r.amount > 0 ? 'pos' : 'neg') + '">' + (r.amount > 0 ? '+' : '−') + esc(peso(Math.abs(r.amount))) +
        (r.balanceAfter != null ? '<small>' + esc(peso(r.balanceAfter)) + '</small>' : '') + '</span><span class="s">' + esc([r.date, r.place].filter(Boolean).join(' · ')) + '</span></div>';
    }).join('');
  }
  function freezeBox(frozen, asking) {
    if (asking) return '<div class="confirm"><b>' + esc(t('freezeAsk')) + '</b><div class="row"><button type="button" class="btn danger small" id="freezeYes">' + esc(t('freezeYes')) + '</button><button type="button" class="btn ghost small" id="freezeNo">' + esc(t('cancel')) + '</button></div></div>';
    return '<div class="row"><div class="grow"><b>' + esc(frozen ? t('unfreeze') : t('freeze')) + '</b><div class="small muted">' + esc(frozen ? t('cardFrozenMsg') : (S.lang === 'ko' ? '카드를 잃어버렸다면 바로 정지하세요.' : 'Lost your card? Freeze it right away.')) + '</div></div>' +
      '<button type="button" class="btn ' + (frozen ? '' : 'danger ') + 'small" id="' + (frozen ? 'unfreezeBtn' : 'freezeBtn') + '">' + esc(frozen ? t('unfreeze') : t('freeze')) + '</button></div>';
  }
  function loadWallet(more) {
    var w = S.wallet;
    var q = '?kind=' + w.kind + (more && w.next ? '&before=' + w.next : '');
    api('GET', '/api/campus/wallet' + q).then(function (d) {
      w.rows = more ? w.rows.concat(d.rows) : d.rows;
      w.next = d.next; if (d.summary) w.summary = d.summary; w.loaded = true;
      if (view() === 'wallet') viewWallet();
    }).catch(function (e) { toast(e.message); });
  }
  function setFrozen(v) {
    api('POST', '/api/campus/card', { frozen: v }).then(function (d) {
      S.me.wallet.cardFrozen = d.cardFrozen; toast(v ? t('frozenToast') : t('unfrozenToast')); viewWallet();
    }).catch(function (e) { toast(e.message); });
  }

  // ----- requests -----
  function viewRequests() {
    var groups = S.config.groups;
    var g = S.reqGroup;
    var types = S.config.types.filter(function (x) { return x.group === g; });
    var mine = S.requests || [];
    frame('requests', t('requests'),
      '<div class="chips" id="groups">' + groups.map(function (x) { return '<button type="button" class="chip" data-group="' + x.key + '" aria-pressed="' + (x.key === g) + '">' + esc(L(x)) + '</button>'; }).join('') + '</div>' +
      (g === 'departure' ? '<p class="small muted" style="margin:0 2px">' + esc(t('departureHint')) + '</p>' : '') +
      '<div class="tiles">' + types.map(function (d) {
        var locked = d.needs && !mine.some(function (r) { return r.type === d.needs && (r.status === 'approved' || r.status === 'done'); });
        var hasOnce = d.once && mine.some(function (r) { return r.type === d.key && ['submitted', 'reviewing', 'approved', 'done'].indexOf(r.status) >= 0; });
        var sub = locked ? t('needsFirst') + ' ' + L(typeDef(d.needs)) : hasOnce ? statusLabel(mine.filter(function (r) { return r.type === d.key; })[0].status) : (d.catalog ? '₱' : t('free'));
        return '<button type="button" class="tile' + (locked ? ' locked' : '') + '" data-new="' + d.key + '"><b>' + esc(L(d)) + '</b><small>' + esc(sub) + '</small></button>';
      }).join('') + '</div>' +
      '<div class="sectionlabel">' + esc(t('myRequests')) + '</div>' +
      (mine.length ? mine.map(reqCard).join('') : '<div class="card empty">' + esc(t('none')) + '</div>'));
  }

  function fieldLabel(d, name) {
    var f = (d.fields || []).filter(function (x) { return x.name === name; })[0];
    return f ? L(f) : name;
  }
  function fieldValue(d, name, v) {
    var f = (d.fields || []).filter(function (x) { return x.name === name; })[0];
    if (f && f.options) { var o = f.options.filter(function (x) { return x.value === v; })[0]; if (o) return L(o); }
    return v;
  }
  function reqCard(r) {
    var d = typeDef(r.type) || { en: r.type, fields: [] };
    var p = r.payload || {};
    // Show answers in the form's own order (the database does not keep key order).
    var order = (d.fields || []).map(function (f) { return f.name; });
    var keys = Object.keys(p).filter(function (k) { return k !== 'item'; }).sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    var rows = keys.map(function (k) { return '<dt>' + esc(fieldLabel(d, k)) + '</dt><dd>' + esc(fieldValue(d, k, p[k])) + '</dd>'; });
    if (p.item) rows.unshift('<dt>' + esc(t('option')) + '</dt><dd>' + esc(L(p.item, 'title')) + '</dd>');
    var canCancel = r.status === 'submitted' || r.status === 'reviewing';
    return '<article class="card reqcard"><div class="head"><b>' + esc(L(d)) + '</b><span class="pill ' + esc(r.status) + '">' + esc(statusLabel(r.status)) + '</span></div>' +
      '<div class="small muted">#' + r.id + ' · ' + esc(r.created) + (r.fee ? ' · <span class="fee">' + esc(peso(r.fee)) + '</span>' + (r.charged ? ' ' + esc(t('paidTag')) : '') : '') + '</div>' +
      '<dl>' + rows.join('') + '</dl>' +
      (r.staffNote ? '<div class="note ' + (r.status === 'rejected' ? 'bad' : 'ok') + '"><b>' + esc(t('staffSays')) + ':</b> ' + esc(r.staffNote) + '</div>' : '') +
      (canCancel ? '<div class="row" style="justify-content:flex-end;margin-top:10px"><button type="button" class="btn ghost small" data-cancel="' + r.id + '">' + esc(t('cancelReq')) + '</button></div>' : '') +
    '</article>';
  }

  // form sheet
  var sheet = null; // {type, key, item}
  function openForm(typeKey) {
    var d = typeDef(typeKey);
    if (!d) return;
    sheet = { type: typeKey, key: newKey(), itemId: null };
    if (d.catalog && !S.catalog[d.catalog]) {
      api('GET', '/api/campus/catalog?kind=' + d.catalog).then(function (res) { S.catalog[d.catalog] = res.items; drawSheet(); }).catch(function (e) { toast(e.message); });
    }
    drawSheet();
  }
  function closeForm() { sheet = null; var w = document.querySelector('.sheetwrap'); if (w) w.remove(); document.body.style.overflow = ''; }
  function itemFee(item, values) {
    if (!item) return 0;
    var fee = Number(item.fee || 0);
    if (item.feeUnit === 'day' && values.startDate && values.endDate) {
      var days = Math.round((Date.parse(values.endDate) - Date.parse(values.startDate)) / 864e5) + 1;
      return days > 0 ? fee * days : fee;
    }
    if (item.feeUnit === 'week') return fee * (Number(values.weeks) || 1);
    return fee;
  }
  function currentValues() {
    var out = {};
    document.querySelectorAll('#reqForm [data-f]').forEach(function (el) { out[el.getAttribute('data-f')] = el.value; });
    return out;
  }
  function drawSheet(errMsg) {
    var d = typeDef(sheet.type);
    var old = document.querySelector('.sheetwrap');
    var keep = old ? currentValues() : null;
    var items = d.catalog ? S.catalog[d.catalog] : null;
    var item = items && items.filter(function (x) { return x.id === sheet.itemId; })[0];
    var p = S.me.person;
    var html = '<div class="sheetwrap" id="sheetwrap"><form class="sheet" id="reqForm" novalidate role="dialog" aria-modal="true" aria-label="' + esc(L(d)) + '">' +
      '<div class="bar"><h3>' + esc(L(d)) + '</h3><button type="button" class="iconbtn" id="closeSheet" aria-label="' + esc(t('cancel')) + '">✕</button></div>';
    if (d.catalog) {
      html += '<div class="field"><label>' + esc(t('chooseOption')) + '</label>' +
        (!items ? '<div class="muted small">…</div>' : !items.length ? '<div class="note">' + esc(t('noOptions')) + '</div>' :
          '<div class="opts">' + items.map(function (it) {
            var unit = it.feeUnit === 'day' ? ' ' + t('perDay') : it.feeUnit === 'week' ? ' ' + t('perWeek') : '';
            var det = [L(it, 'detail'), it.startsAt ? t('starts') + ' ' + it.startsAt : '', it.capacity ? t('capacity') + ' ' + it.capacity : ''].filter(Boolean).join(' · ');
            return '<label class="opt' + (it.id === sheet.itemId ? ' on' : '') + '"><input type="radio" name="item" value="' + it.id + '"' + (it.id === sheet.itemId ? ' checked' : '') + '>' +
              '<b>' + esc(L(it, 'title')) + '</b><span class="fee">' + (it.fee ? esc(peso(it.fee)) + esc(unit) : esc(t('free'))) + '</span>' + (det ? '<span class="d">' + esc(det) + '</span>' : '') + '</label>';
          }).join('') + '</div>') + '</div>';
    }
    (d.fields || []).forEach(function (f) {
      if (f.onlyWhenUnit && (!item || item.feeUnit !== f.onlyWhenUnit)) return;
      var id = 'f_' + f.name;
      var val = keep && keep[f.name] != null ? keep[f.name] : f.prefill === 'endDate' ? (p.endDate && p.endDate >= todayPH() ? p.endDate : '') : f.prefillValue != null ? String(f.prefillValue) : '';
      var req = f.required ? ' required' : '';
      var lbl = L(f) + (f.required ? '' : (S.lang === 'ko' ? ' (선택)' : ' (optional)'));
      var ctl;
      if (f.kind === 'select') {
        ctl = '<select class="input" id="' + id + '" data-f="' + f.name + '"' + req + '><option value="">' + esc(t('chooseOption')) + '</option>' +
          f.options.map(function (o) { return '<option value="' + esc(o.value) + '"' + (o.value === val ? ' selected' : '') + '>' + esc(L(o)) + '</option>'; }).join('') + '</select>';
      } else if (f.kind === 'textarea') {
        ctl = '<textarea class="input" id="' + id + '" data-f="' + f.name + '" maxlength="' + (f.max || 1000) + '"' + req + '>' + esc(val) + '</textarea>';
      } else {
        var type = f.kind === 'tel' ? 'tel' : f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : f.kind === 'time' ? 'time' : 'text';
        var extra = f.kind === 'date' && f.min === 'today' ? ' min="' + todayPH() + '"' : f.kind === 'number' ? ' min="' + (f.min || 0) + '" max="' + (f.max || 1000) + '" inputmode="numeric"' : f.max ? ' maxlength="' + f.max + '"' : '';
        ctl = '<input class="input" type="' + type + '" id="' + id + '" data-f="' + f.name + '" value="' + esc(val) + '"' + extra + req + '>';
      }
      html += field(id, lbl, ctl);
    });
    var fee = itemFee(item, keep || {});
    var avail = S.me.wallet.available;
    html += '<div class="summary"><div><div class="small muted">' + esc(fee ? t('total') : t('fee')) + '</div><b id="feeTotal">' + esc(fee ? peso(fee) : t('free')) + '</b></div>' +
      '<div class="small muted" style="text-align:right">' + esc(t('available')) + '<br><b class="num">' + esc(peso(avail)) + '</b></div></div>' +
      '<div class="err" id="formErr" role="alert">' + esc(errMsg || (fee > avail ? t('notEnough') : '')) + '</div>' +
      '<button class="btn block" type="submit" id="sendBtn">' + esc(t('send')) + '</button></form></div>';
    if (old) old.outerHTML = html; else document.body.insertAdjacentHTML('beforeend', html);
    document.body.style.overflow = 'hidden';
  }
  function refreshFee() {
    var d = sheet && typeDef(sheet.type); if (!d) return;
    var items = d.catalog ? S.catalog[d.catalog] : null;
    var item = items && items.filter(function (x) { return x.id === sheet.itemId; })[0];
    var fee = itemFee(item, currentValues());
    var el = document.getElementById('feeTotal'); if (el) el.textContent = fee ? peso(fee) : t('free');
    var err = document.getElementById('formErr'); if (err) err.textContent = fee > S.me.wallet.available ? t('notEnough') : '';
  }
  function sendForm() {
    var d = typeDef(sheet.type);
    var values = currentValues();
    if (d.catalog && !sheet.itemId) { document.getElementById('formErr').textContent = t('chooseOption'); return; }
    var btn = document.getElementById('sendBtn'); btn.disabled = true; btn.textContent = t('sending');
    api('POST', '/api/campus/requests', { type: sheet.type, catalogId: sheet.itemId, payload: values, clientKey: sheet.key }).then(function () {
      closeForm(); toast(t('sent'));
      return Promise.all([loadRequests(), loadMe()]);
    }).then(function () { S.reqGroup = d.group; if (view() !== 'requests') location.hash = '#requests'; else render(); })
      .catch(function (e) { btn.disabled = false; btn.textContent = t('send'); var el = document.getElementById('formErr'); if (el) el.textContent = e.message; });
  }

  // ----- scores -----
  function viewScores() {
    if (!S.scores) { api('GET', '/api/campus/scores').then(function (d) { S.scores = d.scores; if (view() === 'scores') viewScores(); }).catch(function (e) { toast(e.message); }); }
    var list = S.scores || [];
    frame('scores', t('scores'), !S.scores ? '<div class="card empty">…</div>' : !list.length ? '<div class="card empty">' + esc(t('noScores')) + '</div>' :
      list.map(function (s) {
        var max = s.test === 'IELTS' ? 9 : 30;
        var parts = ['listening', 'reading', 'writing', 'speaking'].filter(function (k) { return s[k] != null; });
        return '<article class="card score"><div class="row"><div class="grow"><b>' + esc(s.test) + '</b><div class="small muted">' + esc(s.test_date) + '</div></div>' +
          '<div style="text-align:right"><div class="tiny muted">' + esc(t('overall')) + '</div><div class="big">' + esc(s.overall != null ? s.overall : '-') + '</div></div></div>' +
          (parts.length ? '<div class="bars">' + parts.map(function (k) {
            return '<div class="b"><span>' + esc(t(k)) + '</span><span class="track"><i style="width:' + Math.max(3, Math.min(100, s[k] / max * 100)) + '%"></i></span><span>' + esc(s[k]) + '</span></div>';
          }).join('') + '</div>' : '') +
          (s.comment ? '<div class="note">' + esc(s.comment) + '</div>' : '') + '</article>';
      }).join(''));
  }

  // ----- notices -----
  function viewNotices() {
    var ns = S.notices || [];
    frame('notices', t('notices'), ns.length ? ns.map(function (n) {
      return '<article class="card"><h2 style="margin-bottom:4px">' + (n.pinned ? '📌 ' : '') + esc(L(n, 'title')) + '</h2><div class="tiny muted">' + esc(n.published) + '</div>' +
        '<p style="white-space:pre-wrap;margin:10px 0 0">' + esc(L(n, 'body')) + '</p></article>';
    }).join('') : '<div class="card empty">' + esc(t('none')) + '</div>', { back: true });
  }

  // ----- bot -----
  function viewBot() {
    if (!S.chat.length) S.chat.push({ role: 'assistant', text: t('botHello'), source: 'hello' });
    frame('bot', t('bot'),
      '<div class="chat" id="chat">' + S.chat.map(msgHtml).join('') + (S.chatBusy ? '<div class="msg bot typing">…</div>' : '') + '</div>' +
      (S.chat.length <= 1 ? '<div class="suggest">' + t('suggestions').map(function (s) { return '<button type="button" class="chip" data-ask="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') + '</div>' : '') +
      '<div class="chatpad"></div>',
      { after: '<div class="composer"><form id="botForm"><input class="input" id="botInput" maxlength="800" autocomplete="off" placeholder="' + esc(t('botPlaceholder')) + '" aria-label="' + esc(t('botPlaceholder')) + '"><button class="btn" type="submit"' + (S.chatBusy ? ' disabled' : '') + '>' + esc(t('botSend')) + '</button></form></div>' });
    window.scrollTo(0, document.body.scrollHeight);
  }
  function msgHtml(m) {
    if (m.role === 'user') return '<div class="msg user">' + esc(m.text) + '</div>';
    var note = m.source === 'claude' ? t('botAi') : m.source === 'faq' ? t('botFaq') : '';
    return '<div class="msg bot">' + esc(m.text) + (note ? '<small>' + esc(note) + '</small>' : '') + '</div>';
  }
  function ask(text) {
    text = String(text || '').trim();
    if (!text || S.chatBusy) return;
    var history = S.chat.filter(function (m) { return m.source !== 'hello' && m.source !== 'error'; }).map(function (m) { return { role: m.role, text: m.text }; });
    S.chat.push({ role: 'user', text: text }); S.chatBusy = true; viewBot();
    api('POST', '/api/campus/bot', { message: text, history: history }).then(function (d) {
      S.chat.push({ role: 'assistant', text: d.answer, source: d.source });
    }).catch(function (e) {
      S.chat.push({ role: 'assistant', text: e.message, source: 'error' });
    }).then(function () { S.chatBusy = false; if (view() === 'bot') { viewBot(); var i = document.getElementById('botInput'); if (i) i.focus(); } });
  }

  // ----- settings -----
  function viewSettings() {
    var p = S.me.person;
    frame('settings', t('settings'),
      '<section class="card"><h2>' + esc(p.name) + '</h2><div class="small muted">' + esc([p.studentId, p.campus, p.startDate + ' – ' + p.endDate].join(' · ')) + '</div></section>' +
      '<section class="card"><h2>' + esc(t('language')) + '</h2>' + langToggle() + '</section>' +
      '<section class="card"><h2>' + esc(t('changePin')) + '</h2><form id="pinForm" class="stack" novalidate>' +
        field('oldPin', t('oldPin'), '<input class="input code" id="oldPin" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password">') +
        field('newPin1', t('newPin'), '<input class="input code" id="newPin1" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password">', t('pinHint')) +
        field('newPin2', t('confirmPin'), '<input class="input code" id="newPin2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password">') +
        '<div class="err" id="pinErr" role="alert"></div><button class="btn" type="submit">' + esc(t('save')) + '</button></form></section>' +
      '<button type="button" class="btn ghost block" id="signOutBtn">' + esc(t('signOut')) + '</button>', { back: true });
  }

  // ---------- data loading ----------
  function loadMe() { return api('GET', '/api/campus/me').then(function (d) { S.me = d; }); }
  function loadRequests() { return api('GET', '/api/campus/requests').then(function (d) { S.requests = d.requests; }); }
  function loadNotices() { return api('GET', '/api/campus/notices').then(function (d) { S.notices = d.notices; }); }

  function boot() {
    if (!S.token) return renderSignin();
    app.innerHTML = '<div class="boot">' + esc(t('appName')) + '…</div>';
    var cfg = S.config ? Promise.resolve() : api('GET', '/api/campus/config').then(function (c) { S.config = c; });
    Promise.all([cfg, loadMe(), loadRequests(), loadNotices()]).then(function () {
      if (S.me.lang && !lsGet(LANG_KEY)) { S.lang = S.me.lang; }
      render();
    }).catch(function (e) {
      if (!S.token) return;
      app.innerHTML = '<div class="signin"><div class="card stack"><b>' + esc(e.message) + '</b><button class="btn" id="retry">' + esc(t('retry')) + '</button></div></div>';
    });
  }

  // ---------- events (delegated) ----------
  document.addEventListener('click', function (e) {
    var el = e.target.closest('button, [data-lang], label.opt');
    if (!el) return;
    if (el.id === 'retry') return boot();
    if (el.hasAttribute('data-lang')) {
      S.lang = el.getAttribute('data-lang'); lsSet(LANG_KEY, S.lang); document.documentElement.lang = S.lang;
      if (S.token) { api('POST', '/api/campus/lang', { lang: S.lang }).catch(function () { /* ignore */ }); if (sheet) drawSheet(); render(); }
      else renderSignin();
      return;
    }
    if (el.hasAttribute('data-mode')) { S.signinMode = el.getAttribute('data-mode'); return renderSignin(); }
    if (el.id === 'tapStart') return startNfc();
    if (el.hasAttribute('data-new')) {
      var d = typeDef(el.getAttribute('data-new'));
      if (d && d.needs && !(S.requests || []).some(function (r) { return r.type === d.needs && (r.status === 'approved' || r.status === 'done'); })) {
        return toast(t('needsFirst') + ' ' + L(typeDef(d.needs)));
      }
      return openForm(el.getAttribute('data-new'));
    }
    if (el.id === 'closeSheet') return closeForm();
    if (el.matches('label.opt')) {
      var input = el.querySelector('input'); if (!input) return;
      sheet.itemId = Number(input.value); drawSheet(); return;
    }
    if (el.hasAttribute('data-group')) { S.reqGroup = el.getAttribute('data-group'); return viewRequests(); }
    if (el.hasAttribute('data-cancel')) {
      el.disabled = true;
      api('POST', '/api/campus/requests/' + el.getAttribute('data-cancel') + '/cancel', {}).then(function () {
        toast(t('cancelled')); return Promise.all([loadRequests(), loadMe()]);
      }).then(render).catch(function (err) { el.disabled = false; toast(err.message); });
      return;
    }
    if (el.hasAttribute('data-kind')) { S.wallet.kind = el.getAttribute('data-kind'); S.wallet.loaded = false; S.wallet.rows = []; S.wallet.next = null; return viewWallet(); }
    if (el.id === 'more') { el.disabled = true; return loadWallet(true); }
    if (el.id === 'freezeBtn') { document.getElementById('freezeBox').innerHTML = freezeBox(false, true); return; }
    if (el.id === 'freezeNo') { document.getElementById('freezeBox').innerHTML = freezeBox(false, false); return; }
    if (el.id === 'freezeYes') return setFrozen(true);
    if (el.id === 'unfreezeBtn') return setFrozen(false);
    if (el.hasAttribute('data-ask')) return ask(el.getAttribute('data-ask'));
    if (el.id === 'signOutBtn') return signOut();
  });
  document.addEventListener('click', function (e) { if (e.target.id === 'sheetwrap') closeForm(); });
  document.addEventListener('input', function (e) { if (sheet && e.target.closest('#reqForm')) refreshFee(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sheet) closeForm(); });
  document.addEventListener('submit', function (e) {
    e.preventDefault();
    var id = e.target.id;
    if (id === 'signinForm') return submitSignin();
    if (id === 'reqForm') return sendForm();
    if (id === 'botForm') { var i = document.getElementById('botInput'); var v = i.value; i.value = ''; return ask(v); }
    if (id === 'pinForm') {
      var n1 = document.getElementById('newPin1').value, n2 = document.getElementById('newPin2').value, err = document.getElementById('pinErr');
      if (n1 !== n2) { err.textContent = t('pinMismatch'); return; }
      api('POST', '/api/campus/pin', { oldPin: document.getElementById('oldPin').value, newPin: n1 }).then(function (d) {
        S.token = d.token; lsSet(TOKEN_KEY, d.token); toast(t('saved')); viewSettings();
      }).catch(function (x) { err.textContent = x.message; });
    }
  });

  // Refresh balance and requests when the student comes back to the app.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && S.token && S.me && !sheet) {
      Promise.all([loadMe(), loadRequests()]).then(function () { if (view() !== 'bot') render(); }).catch(function () { /* ignore */ });
    }
  });

  if ('serviceWorker' in navigator && !IS_LOCAL) navigator.serviceWorker.register('../sw.js').catch(function () { /* ignore */ });
  document.documentElement.lang = S.lang;
  boot();
})();
