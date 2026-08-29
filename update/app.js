window.__BOOT_app_start = true;
(function() {
  try {
    var log = [];
    window.__errLog = log;
    var cap = function(msg) {
      try { log.push('[' + new Date().toLocaleTimeString() + '] ' + msg); } catch (e) {}
      if (log.length > 40) log.shift();
    };
    window.addEventListener('error', function(e) {
      try {
        var f = e && e.filename ? String(e.filename).split('/').pop().split('\\').pop() : '';
        cap('ERR: ' + (e.message || 'unknown') + ' @' + f + ':' + (e.lineno || ''));
      } catch (e2) {}
    });
    window.addEventListener('unhandledrejection', function(e) {
      try {
        var r = e && e.reason;
        cap('PROMISE: ' + (r && r.message ? r.message : (typeof r === 'string' ? r : String(r))));
      } catch (e2) {}
    });
  } catch (e) {}
})();
const DAILY_UNIT_ID = 880001;
const DAILY_BATCH = 5;
const MEMORY_INTERVALS = [1, 2, 4, 7, 15, 30];

const App = {
  currentView: 'login',  currentGradeId: null,
  currentModuleId: null,
  currentUnitId: null,
  hearts: 5,
  progress: null,
  navStack: [],
  activeSessionId: null,
  currentStudent: null,
  isAdminMode: false,
  adminViewingStudent: null,
  currentSubject: 'english',
  _wordBank: null,
  _hwEditor: null,

  _h(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  },

  _gradeAllowed(g) {
    const grades = Storage.getAdminGrades();
    if (!grades.length) return true;
    return grades.indexOf(String(g)) !== -1;
  },

  _objVals(o) {
    const out = [];
    for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) out.push(o[k]); }
    return out;
  },

  getCourseData() {
    return COURSE_DATA;
  },

  init() {
    try {
      this._buildIndex();
    } catch (e) {
      console.warn('_buildIndex failed:', e);
    }
    var self = this;
    var restoreTries = 0;
    var iv = setInterval(() => {
      restoreTries++;
      var done = this._tryRestoreBackup();
      if (done || (restoreTries >= 120 && this.currentView !== 'unlock')) clearInterval(iv);
    }, 1000);
    window.addEventListener('pagehide', function() {
      try { self._ttsCancel(); } catch(e) {}
      try { Storage.flushBackup(); } catch(e) {}
    });
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') {
        try { self._ttsCancel(); } catch(e) {}
        try { Storage.flushBackup(); } catch(e) {}
      } else {
        try { self._tryRestoreBackup(); } catch(e) {}
      }
    });
    var authorized = false;
    try { authorized = !!Storage.isAuthorized(); } catch(e) { console.warn('isAuthorized failed:', e); }
    if (!authorized) {
      this.currentView = 'unlock';
      try { this.renderUnlock(); } catch(e) {
        document.getElementById('main-content').innerHTML = '<div style="padding:40px;text-align:center;color:#C62828">初始化异常：' + (e.message || e) + '</div>';
      }
      return;
    }
    this._tryRestoreBackup();
    try {
      this.setupNavListeners();
      this._syncStudentsFromCloud(); // 启动时同步学员名单
      this._autoRestorePublicWrongs(); // 公共错题库为空时自动从电脑拉回
      this.renderLogin();
    } catch(e) {
      var el = document.getElementById('main-content');
      if (el) el.innerHTML = '<div style="padding:40px;text-align:center;color:red"><h2>初始化失败</h2><p>' + e.message + '</p></div>';
    }
    setTimeout(() => { try { this._checkJsUpdate(); } catch(e) {} }, 6000);
    setTimeout(() => { try { this._updQuiet = true; this._checkJsUpdate(1); } catch(e) {} }, 30000);
    setTimeout(() => { try { this._prewarmNetwork(); } catch(e) {} }, 1500);
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.play-recording-btn');
      if (btn) {
        try { App.playRecording(); } catch(e0) {
          try { App._recPlayError('录音播放失败：' + (e0 && e0.message || e0)); } catch(e3) {}
        }
        return;
      }
    });
    try {
      var kick = null;
      var hostEvt = function(e) {
        var el = e.target;
        if (!el || !el.tagName || el.tagName.toLowerCase() !== 'input' || !el.id || el.id.indexOf('host') === -1) return;
        kick = el;
        try { App._saveHost(el.value); } catch (e2) {}
      };
      document.addEventListener('input', hostEvt);
      document.addEventListener('change', hostEvt);
      document.addEventListener('blur', hostEvt);
      window.addEventListener('pagehide', function() {
        if (kick && kick.value) { try { App._saveHost(kick.value); } catch (e) {} }
      });
    } catch (e) {}
    try {
      if (window.AudioContext || window.webkitAudioContext) {
        var ac = new (window.AudioContext || window.webkitAudioContext)();
        if (ac && ac.resume) { try { ac.resume(); } catch(e) {} }
        var silent = null;
        try { silent = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQBwAAEAfAAABAAgAZGF0YQAAAAA='); silent.volume = 0; } catch(e) {}
        var unlockAudio = function() {
          if (ac && ac.resume) { try { ac.resume(); } catch(e) {} }
          if (self._playCtx && self._playCtx.state === 'suspended' && self._playCtx.resume) { try { self._playCtx.resume(); } catch(e) {} }
          if (silent) { var p = silent.play(); if (p && p.catch) p.catch(function(){}); }
        };
        document.addEventListener('touchend', unlockAudio);
        document.addEventListener('click', unlockAudio, true);
      }
    } catch(e) {}
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SpeechSynthesis) {
        this._tts = window.Capacitor.Plugins.SpeechSynthesis;
        setTimeout(function() { try { self._tts.initialize(); } catch(e) {} }, 2000);
      }
    } catch(e) { this._tts = null; }
    try {
      if (window.AndroidBackup && typeof window.AndroidBackup.warmTts === 'function') {
        setTimeout(function() { try { window.AndroidBackup.warmTts(); } catch(e) {} }, 1500);
      }
    } catch(e) {}
    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.addEventListener('voiceschanged', () => {
          this._enVoiceCache = null;
          this._zhVoices = null;
        });
        window.speechSynthesis.getVoices();
      }
    } catch(e) {}
  },

  _pickEnVoice() {
    if (this._enVoiceCache !== null) return this._enVoiceCache;
    const synth = window.speechSynthesis;
    if (!synth) return null;
    let voices = [];
    try { voices = synth.getVoices(); } catch(e) {}
    const en = voices.filter(v => /^en/i.test(v.lang));
    if (en.length === 0) return null;
    const byName = (names) => en.find(v => names.some(n => v.name.toLowerCase().indexOf(n) !== -1));
    this._enVoiceCache = byName(['google us english', 'samantha', 'karen', 'google uk english female', 'en-us english', 'natural', 'female']) || en[0] || null;
    return this._enVoiceCache;
  },

  renderUnlock() {
    var main = document.getElementById('main-content');
    if (!main) return;
    var savedHost = this._getSavedHost();
    var deviceId = Storage.getDeviceId() || '(获取失败)';
    var html = '<div class="login-container" style="max-width:420px;margin:40px auto">';
    html += '<div class="login-header">';
    html += '<div class="login-logo"><span class="logo-pj">PJ</span><span class="logo-sub">培基家园</span></div>';
    html += '</div>';
html += '<h1 class="login-title" id="unlock-title-tts"><span>培</span><span>基</span><span>智</span><span>多</span><span>星</span></h1>';
    html += '<div style="margin:14px 16px 8px;padding:12px 14px;background:#FFF3E0;border:1px solid #FFCC80;border-radius:10px;font-size:13px;color:#5D4037">';
    html += '<div style="margin-bottom:8px;font-weight:bold">🔒 本设备未授权</div>';
    html += '<div style="margin-bottom:6px;word-break:break-all">设备号：<span style="font-family:monospace">' + this._h(deviceId) + '</span></div>';
    html += '<div style="font-size:12px;color:#8D6E63" id="unlock-hint">若本平板已激活过（重装后），请先开启"所有文件访问"权限，将自动恢复授权；新平板请联系机构管理员获取装机码</div>';
    html += '</div>';
    html += '<div class="login-divider"><span>系统更新</span></div>';
    html += '<div class="login-form">';
    html += '<input type="text" class="login-input" id="unlock-upd-host" placeholder="电脑 IP，如 192.168.1.100" value="' + this._h(savedHost) + '" autocomplete="off">';
    html += '<button class="admin-btn" id="unlock-upd-btn">🔄 检查更新</button>';
    html += '<button class="login-btn" id="unlock-apk-btn" style="display:none;background:#1565C0">📦 下载并安装新版 App</button>';
    html += '<div id="unlock-upd-log" style="font-size:11px;color:#8D6E63;margin-top:6px;line-height:1.5;word-break:break-all"></div>';
    html += '</div>';
    html += '<div style="padding:0 16px">';
    html += '<button class="admin-btn" id="unlock-allfiles" style="width:100%;margin-bottom:8px;background:#E65100;color:#fff" onclick="App._unlockOpenAllFiles()">🔓 开启文件访问权限（重装恢复）</button>';
    html += '<div class="login-divider"><span>其他恢复方式</span></div>';
    html += '<button class="admin-btn" id="unlock-pcbtn" style="width:100%;margin-bottom:8px;background:#1565C0;color:#fff">🖥 从电脑恢复授权</button>';
    html += '<input type="text" class="login-input" id="unlock-host" placeholder="电脑 IP，如 192.168.1.100（电脑端需运行接收器）" value="' + this._h(savedHost) + '" autocomplete="off" style="margin-bottom:8px">';
    html += '<button class="admin-btn" id="unlock-pick" style="width:100%;background:#6D4C41;color:#fff">📂 从备份文件手动恢复</button>';
    html += '<div id="unlock-more" style="display:none;margin-top:10px">';
    html += '<input type="text" class="login-input" id="unlock-code" placeholder="装机码（新平板）" maxlength="32" autocomplete="off">';
    html += '<button class="login-btn" id="unlock-btn" onclick="App._activate()">激活设备</button>';
    html += '</div>';
    html += '<div style="text-align:center;margin-top:10px"><a href="javascript:void(0)" id="unlock-toggle" style="font-size:12px;color:#8D6E63;text-decoration:underline">新平板激活？点击输入装机码</a></div>';
    html += '<div class="login-error" id="unlock-error"></div>';
html += '<div id="unlock-status" style="font-size:12px;color:#8D6E63;line-height:1.5"></div>';
    html += '</div>';
    html += '</div>';
    main.innerHTML = html;
    this._bindTtsDiag(document.getElementById('unlock-title-tts'));

    var toggle = document.getElementById('unlock-toggle');
    if (toggle) toggle.addEventListener('click', function() {
      var more = document.getElementById('unlock-more');
      if (more) more.style.display = more.style.display === 'none' ? 'block' : 'none';
    });
    var self = this;
    var hostInput = document.getElementById('unlock-host');
    if (hostInput) {
      hostInput.addEventListener('input', function() { self._saveHost(hostInput.value); });
      hostInput.addEventListener('change', function() { self._saveHost(hostInput.value); });
    }
    var pcBtn = document.getElementById('unlock-pcbtn');
    if (pcBtn) pcBtn.addEventListener('click', function() {
      var st = document.getElementById('unlock-status');
      if (st) st.textContent = '正在向电脑查询本机授权记录...';
      self._autoRestoreAuth(true);
    });
    var pickBtn = document.getElementById('unlock-pick');
    if (pickBtn) pickBtn.addEventListener('click', function() {
      var st = document.getElementById('unlock-status');
      if (st) st.textContent = '请在文件选择器中找到备份文件：下载/PJEnglish/PJEnglish_data.json';
      try { window.AndroidBackup.pickBackupFile(); } catch(e) {
        if (st) st.textContent = '当前环境不支持选择文件，请使用上方两种方式';
      }
    });
    var updHost = document.getElementById('unlock-upd-host');
    if (updHost) {
      updHost.addEventListener('input', function() { self._saveHost(updHost.value); });
      updHost.addEventListener('change', function() { self._saveHost(updHost.value); });
    }
    var updBtn = document.getElementById('unlock-upd-btn');
    if (updBtn) updBtn.addEventListener('click', function() {
      var h = document.getElementById('unlock-upd-host');
      if (h && h.value.trim()) { try { App._saveHost(h.value.trim()); } catch(e) {} }
      var log = document.getElementById('unlock-upd-log');
      if (log) log.innerHTML = '';
      App._checkJsUpdate(0);
    });
    var apkBtn = document.getElementById('unlock-apk-btn');
    if (apkBtn) apkBtn.addEventListener('click', function() { App._downloadApk(); });
    setTimeout(function () { self._autoRestoreAuth(); }, 300);
    setTimeout(function () { self._autoRestoreAuth(); }, 5000);
    setTimeout(function () { self._autoRestoreAuth(); }, 20000);
  },

  _unlockOpenAllFiles() {
    var st = document.getElementById('unlock-status');
    if (st) st.textContent = '请在设置页打开"允许访问所有文件"开关，然后返回本应用，将自动恢复';
    try { window.AndroidBackup.openAllFilesSettings(); } catch(e) {}
  },

  _activate() {
    try {
      var code = document.getElementById('unlock-code').value.trim();
      if (!code) { document.getElementById('unlock-error').textContent = '请输入装机码'; return; }
      var self = this;
      var setMsg = function(msg, color) {
        var el = document.getElementById('unlock-error');
        if (el) { el.textContent = msg; if (color) el.style.color = color; }
      };
      if (Storage.authorizeDevice(code)) {
        setMsg('✅ 激活成功，正在进入...', '#2E7D32');
        setTimeout(function () { location.reload(); }, 600);
        return;
      }
      setMsg('正在联网校验装机码...', '#8D6E63');
      this._cloudActivate(code).then(function (res) {
        if (res && res.ok) {
          setMsg('✅ 激活成功，正在进入...', '#2E7D32');
          setTimeout(function () { location.reload(); }, 600);
        } else {
          setMsg(res && res.msg ? res.msg : '激活失败，请检查网络后重试', '#C62828');
        }
      }).catch(function () {
        setMsg('网络异常，无法联网校验，请稍后重试', '#C62828');
      });
    } catch(e) {
      document.getElementById('unlock-error').textContent = '错误: ' + (e.message || e);
    }
  },

  _cloudActivate(code) {
    var self = this;
    var deviceId = Storage.getDeviceId() || '';
    if (!deviceId) return Promise.resolve({ ok: false, msg: '无法获取设备号' });
    var cTopic = Storage.getCodesTopic();
    var clTopic = Storage.getClaimsTopic();
    return self._pullFetchAll(cTopic).then(function (codeMsgs) {
      var found = false;
      codeMsgs.forEach(function (m) { if (m && String(m.code) === code) found = true; });
      if (!found) return { ok: false, msg: '装机码无效或已过期（装机码12小时内有效，请联系管理员重新生成装机码）' };
      return self._pullFetchAll(clTopic).then(function (claimMsgs) {
        var claimedByOther = false;
        claimMsgs.forEach(function (m) { if (m && String(m.code) === code && m.d !== deviceId) claimedByOther = true; });
        if (claimedByOther) return { ok: false, msg: '该装机码已被其他设备使用，请联系管理员获取新装机码' };
        return fetch(clTopic, {
          method: 'PUT',
          body: JSON.stringify({ code: code, d: deviceId, at: new Date().toISOString() })
        }).then(function (r) { return r.ok ? { needClaim: true } : { ok: false, msg: '网络异常，设备注册失败，请重试' }; })
          .catch(function () { return { ok: false, msg: '网络异常，请重试' }; });
      });
    }).then(function (res) {
      if (!res || !res.needClaim) return res;
      return new Promise(function (resolve) {
        setTimeout(function () {
          self._pullFetchAll(clTopic).then(function (ms) {
            var competing = 0;
            ms.forEach(function (m) { if (m && String(m.code) === code && m.d !== deviceId) competing++; });
            if (competing > 0) resolve({ ok: false, msg: '该装机码已被其他设备抢先激活，请获取新装机码' });
            else if (Storage.recordAuthorization(code)) resolve({ ok: true });
            else resolve({ ok: false, msg: '激活保存失败' });
          }).catch(function () { resolve({ ok: false, msg: '网络异常，请重试' }); });
        }, 2500);
      });
    });
  },

  _pullFetchAll(topic) {
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (txt) { if (!done) { done = true; resolve(txt || ''); } };
      var t = setTimeout(function () { finish(''); }, 10000);
      fetch(topic + '/json?poll=1&since=all', { cache: 'no-store' })
        .then(function (r) { return r.text(); })
        .then(function (txt) { clearTimeout(t); finish(txt); })
        .catch(function () { clearTimeout(t); finish(''); });
    }).then(function (txt) {
      var out = [];
      if (!txt) return out;
      String(txt).split('\n').forEach(function (line) {
        line = line.trim();
        if (!line) return;
        try {
          var d = JSON.parse(line);
          var items = Array.isArray(d) ? d : [d];
          items.forEach(function (m) {
            if (!m || typeof m.message !== 'string') return;
            try { out.push(JSON.parse(m.message)); } catch (e) {}
          });
        } catch (e) {}
      });
      return out;
    }).catch(function () { return []; });
  },

  _autoRestoreAuth(forcePc) {
    var self = this;
    if (self._autoRestoring && !forcePc) return;
    if (Storage.isAuthorized()) return;
    var deviceId = Storage.getDeviceId() || '';
    if (!deviceId) return;
    self._autoRestoring = true;
    var done = false;
    self._pullFetchAll(Storage.getClaimsTopic()).then(function (msgs) {
      var hit = null;
      msgs.forEach(function (m) {
        if (m && m.d === deviceId && !hit) hit = m;
      });
      if (hit && Storage.recordAuthorization(hit.code || '')) done = true;
      return self._tryPcRestore(deviceId, forcePc);
    }).catch(function () {
      return self._tryPcRestore(deviceId, forcePc);
    }).then(function () {
      if (done || Storage.isAuthorized()) {
        var el = document.getElementById('unlock-status');
        if (el) el.textContent = '✅ 检测到本机曾授权，正在自动恢复...';
        setTimeout(function () { location.reload(); }, 800);
      }
      self._autoRestoring = false;
    });
  },

  _tryPcRestore(deviceId, forcePc) {
    var self = this;
    if (Storage.isAuthorized()) return Promise.resolve();
    var host = this._getSavedHost();
    if (!host && forcePc) {
      var hv = document.getElementById('unlock-host');
      if (hv && hv.value.trim()) host = this._cleanHost(hv.value.trim());
    }
    if (!host) return Promise.resolve();
    return this._lanGet('http://' + host + ':8899/deviceauth?d=' + encodeURIComponent(deviceId)).then(function (res) {
      if (Storage.isAuthorized()) return;
      if (!res || !res.ok) return;
      try {
        var j = JSON.parse(res.body || '{}');
        if (j && j.ok && j.found) {
          Storage.recordAuthorization('pc-restore');
          var el = document.getElementById('unlock-status');
          if (el) el.textContent = '✅ 电脑端确认本机曾授权，正在自动恢复...';
          setTimeout(function () { location.reload(); }, 800);
        } else {
          var el = document.getElementById('unlock-status');
          if (el) el.textContent = '电脑端未找到本机授权记录，若确认已激活过，请检查电脑端"设备授权"文件是否包含本机设备号';
        }
      } catch (e) {}
    }).catch(function () {
      var el = document.getElementById('unlock-status');
      if (el && forcePc) el.textContent = '无法连接电脑（' + host + '），请确认电脑端接收器已启动且 IP 正确';
    });
  },

  _autoRestorePicked() {
    try {
      if (!window.AndroidBackup || !window.AndroidBackup.getPickedBackup) return;
      var raw = window.AndroidBackup.getPickedBackup();
      if (!raw) return;
      var ok = Storage.restoreBackup(raw);
      var el = document.getElementById('unlock-status');
      if (el) el.textContent = ok ? '✅ 已从备份文件恢复，正在进入...' : '⚠️ 该文件未包含可恢复数据，请确认选择的是 PJEnglish_data.json';
      if (ok) setTimeout(function () { location.reload(); }, 800);
    } catch (e) {
      var el = document.getElementById('unlock-status');
      if (el) el.textContent = '恢复失败：' + (e.message || e);
    }
  },

  _tryRestoreBackup() {
    try {
      var ok = !!Storage.restoreBackup();
      if (ok) {
        if (this.currentView === 'login' && Storage.getRestoredStudentCount() > 0) {
          try { this.renderLogin(); } catch(e) {}
        } else if (this.currentView === 'unlock') {
          try { this.renderLogin(); } catch(e) {}
        }
      }
      return ok;
    } catch(e) { return false; }
  },

  loginStudent(id) {
    const students = Storage.getStudents();
    const student = students.find(s => s.id === id);
    if (student) {
      Storage.loginStudent(id);
      this.currentStudent = student;
      this.progress = Storage.getProgress();
      this.hearts = this.progress.hearts;
      this.currentSubject = 'english';
      this._prewarmAudio();
      this.renderSubjectSelector();
      if (this._taskPollTimer) { clearInterval(this._taskPollTimer); this._taskPollTimer = null; }
      const poll = () => { try { this._pullRemoteHomework(); } catch (e) {} };
      setTimeout(poll, 1200);
      this._taskPollTimer = setInterval(poll, 20000);
      if (!this._visHandler) {
        this._visHandler = () => {
          if (document.visibilityState === 'visible' && this.currentStudent) {
            try { this._pullRemoteHomework(); } catch (e) {}
          }
        };
        document.addEventListener('visibilitychange', this._visHandler);
      }
      try { this._updateTaskBadge(); } catch (e) {}
    }
  },

  renderSubjectSelector() {
    if (!this.currentStudent) { this.renderLogin(); return; }
    this.currentView = 'subject';
    document.querySelector('.top-bar').style.display = 'flex';
    document.querySelector('.bottom-nav').style.display = 'none';
    const main = document.getElementById('main-content');
    const grade = Storage.getCurrentGrade(this.currentStudent);

    let html = '<div class="subject-container">';
    html += '<div style="text-align:center;padding:40px 0 20px">';
    html += '<div class="login-logo"><span class="logo-pj">PJ</span><span class="logo-sub">培基家园</span></div>';
    html += '<p style="margin:12px 0;font-size:18px;font-weight:700">' + this.currentStudent.name + ' · ' + grade + '年级</p>';
    html += '</div>';
    html += '<h3 style="text-align:center;margin-bottom:16px;color:var(--text-light)">选择板块</h3>';
    const now = new Date();
    const calMonths = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const calMon = calMonths[now.getMonth()];
    const calDay = now.getDate();
    const weekdayStr = '星期' + weekdays[now.getDay()];
    html += '<div class="subject-cards subject-cards-main">';
    html += '<div class="subject-card" data-subj="chinese">';
    html += '<div class="sc-icon">📖</div><div class="sc-name">语文课程</div><div class="sc-desc">' + (this._zhDataTitle() || '部编版同步') + '</div></div>';
    html += '<div class="subject-card" data-subj="math">';
    html += '<div class="sc-icon">🔢</div><div class="sc-name">数学课程</div><div class="sc-desc">人教版数学</div></div>';
    html += '<div class="subject-card" data-subj="english">';
    html += '<div class="sc-icon">📚</div><div class="sc-name">英语课程</div><div class="sc-desc">广州教科版</div></div>';
    html += '</div>';
    html += '<div class="subject-cards subject-cards-sub">';
    html += '<div class="subject-card sc-calendar" data-subj="daily">';
    html += '<div class="sc-cal-box" id="sc-cal-box"><span class="sc-cal-month">' + calMon + '</span><span class="sc-cal-slash">/</span><span class="sc-cal-day">' + calDay + '</span></div>';
    html += '<div class="sc-name">每天必练</div><div class="sc-desc" id="sc-cal-desc">' + weekdayStr + '</div></div>';
    html += '<div class="subject-card" data-subj="garden">';
    html += '<div class="sc-icon">🌳</div><div class="sc-name">记忆花园</div><div class="sc-desc">艾宾浩斯复习</div></div>';
    html += '</div>';
    html += '<div style="text-align:center;margin-top:16px"><button class="quit-btn" onclick="App.logoutToLogin()">↩ 退出登录</button></div>';
    html += '</div>';
    main.innerHTML = html;

    if (this._subjectDateTimer) { clearInterval(this._subjectDateTimer); this._subjectDateTimer = null; }
    const self = this;
    this._subjectDateTimer = setInterval(function() {
      const box = document.getElementById('sc-cal-box');
      if (!box) { clearInterval(self._subjectDateTimer); self._subjectDateTimer = null; return; }
      const n = new Date();
      const m = calMonths[n.getMonth()];
      const d = n.getDate();
      const ws = '星期' + weekdays[n.getDay()];
      const mEl = box.querySelector('.sc-cal-month');
      const dEl = box.querySelector('.sc-cal-day');
      if (mEl && mEl.textContent !== m) mEl.textContent = m;
      if (dEl && String(dEl.textContent) !== String(d)) dEl.textContent = d;
      const desc = document.getElementById('sc-cal-desc');
      if (desc) desc.textContent = ws;
    }, 60000);

    main.querySelectorAll('.subject-card').forEach(card => {
      card.addEventListener('click', () => {
        const subj = card.dataset.subj;
        if (subj === 'daily') { this.enterDailyPractice(); return; }
        if (subj === 'garden') { this.enterMemoryGarden(); return; }
        if (subj === 'chinese') { this.enterLearning('chinese'); return; }
        if (subj === 'math') { this.enterLearning('math'); return; }
        this.enterLearning();
      });
    });

    document.getElementById('student-name').style.display = '';
    document.getElementById('student-name').textContent = this.currentStudent.name + ' · ' + grade + '年级';
    document.getElementById('score-display').textContent = '';
    document.getElementById('streak-count').textContent = '';
    document.getElementById('heart-count').textContent = '';
    document.getElementById('level-badge').textContent = '';
  },

  _zhDataTitle() {
    try { if (typeof CHINESE_DATA !== 'undefined' && CHINESE_DATA && CHINESE_DATA.title) return CHINESE_DATA.title; } catch (e) {}
    return '';
  },

  enterLearning(subject) {
    App.currentSubject = subject || 'english';
    App.currentView = 'grade';
    App.progress = Storage.getProgress();
    App.hearts = App.progress.hearts;
    App.renderGrades();
    App.updateTopBar();
    document.querySelector('.bottom-nav').style.display = 'flex';
  },

  _subjectName() {
    if (this.currentSubject === 'chinese') return '语文';
    if (this.currentSubject === 'math') return '数学';
    return '英语';
  },

  _getSubjectData(subject) {
    subject = subject || 'english';
    if (subject === 'chinese') {
      try { if (typeof CHINESE_DATA !== 'undefined') return CHINESE_DATA; } catch (e) {}
      return null;
    }
    if (subject === 'math') {
      try { if (typeof MATH_DATA !== 'undefined') return MATH_DATA; } catch (e) {}
      return null;
    }
    return this.getCourseData();
  },

  _findSubjectUnit(subject, uid) {
    const data = this._getSubjectData(subject);
    if (!data || !data.grades) return null;
    for (let i = 0; i < data.grades.length; i++) {
      const g = data.grades[i];
      for (let j = 0; j < g.modules.length; j++) {
        const m = g.modules[j];
        for (let k = 0; k < m.units.length; k++) {
          if (m.units[k].id === uid) return m.units[k];
        }
      }
    }
    return null;
  },

  getHomeworkWords(hw, subject) {
    subject = subject || 'english';
    if (!hw) return [];
    const seen = {};
    const out = [];
    const kw = (w) => {
      if (subject === 'chinese') return String(w && w.zi || '').trim();
      return String((w && (w.en || w.zi)) || '').toLowerCase().trim();
    };
    const push = (w) => {
      const key = kw(w);
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(w);
    };
    (hw.units || []).forEach(uid => {
      const info = this._findSubjectUnit(subject, uid);
      if (info && info.words) info.words.forEach(push);
    });
    (hw.wordKeys || []).forEach(key => {
      let s = subject;
      let k2 = key;
      if (key.indexOf('c:') === 0) { s = 'chinese'; k2 = key.slice(2); }
      else if (key.indexOf('m:') === 0) { s = 'math'; k2 = key.slice(2); }
      if (s !== subject) return;
      const sep = k2.indexOf(':');
      if (sep <= 0) return;
      const uid = parseInt(k2.slice(0, sep));
      const word = k2.slice(sep + 1);
      const info = this._findSubjectUnit(s, uid);
      if (info && info.words) {
        const w = info.words.find(x => kw(x) === word);
        if (w) push(w);
      }
    });
    (hw.manual || []).forEach(word => {
      let s = subject;
      let w2 = String(word);
      if (w2.indexOf('c:') === 0) { s = 'chinese'; w2 = w2.slice(2); }
      else if (w2.indexOf('m:') === 0) { s = 'math'; w2 = w2.slice(2); }
      if (s !== subject) return;
      if (subject === 'chinese') push({ zi: w2.trim(), pinyin: '', yi: '' });
      else if (subject === 'math') push({ en: w2.trim(), cn: '' });
      else {
        const hit = this._enLookup(w2);
        if (hit) push(hit); else push({ en: w2.trim(), cn: '' });
      }
    });
    return out;
  },

  _enLookupCache: null,
  _enLookup(word) {
    const k = String(word || '').toLowerCase().trim();
    if (!k) return null;
    if (!this._enLookupCache) {
      const m = {};
      try {
        this.getCourseData().grades.forEach(g => g.modules.forEach(mod => mod.units.forEach(u => (u.words || []).forEach(x => {
          const kk = String(x.en || '').toLowerCase().trim();
          if (kk && !m[kk]) m[kk] = x;
        }))));
      } catch (e) {}
      this._enLookupCache = m;
    }
    return this._enLookupCache[k] || null;
  },

  enterDailyPractice() {
    this.currentView = 'daily';
    document.querySelector('.bottom-nav').style.display = 'flex';
    this.renderDailyHome();
  },

  enterMemoryGarden() {
    this.currentView = 'garden';
    document.querySelector('.bottom-nav').style.display = 'flex';
    this.renderMemoryGarden();
  },

  _gardenDateStr(offsetDays) {
    const d = new Date(Date.now() + (offsetDays || 0) * 86400000);
    const m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  },

  _gardenLoad() {
    const dp = Storage.getDailyProgress(this.currentStudent.id) || { date: '', cursor: 0 };
    if (!dp.due) dp.due = {};
    if (!dp.lv) dp.lv = {};
    if (!dp.log) dp.log = {};
    if (!dp.monster) dp.monster = {};
    if (!dp.trophies) dp.trophies = {};
    return dp;
  },

  _gardenSave(dp) {
    Storage.saveDailyProgress(this.currentStudent.id, dp);
  },

  _gardenWordIds(batch) {
    return (batch || []).map(w => String(w.en || w.zi));
  },

  _gardenFindWords(ids) {
    const words = this.getHomeworkWords(Storage.getHomework(this.currentStudent.id));
    const out = [];
    (ids || []).forEach(id => {
      const w = words.find(x => String(x.en || x.zi) === id);
      if (w && !out.some(o => String(o.en || o.zi) === id)) out.push(w);
    });
    return out;
  },

  _gardenBuildPool(batch) {
    const words = this.getHomeworkWords(Storage.getHomework(this.currentStudent.id));
    const ids = this._gardenWordIds(batch);
    const pool = batch.slice();
    const extras = words.filter(w => ids.indexOf(String(w.en || w.zi)) < 0);
    let i = 0;
    while (pool.length < 8 && extras.length && i < extras.length * 3) {
      const r = extras[Math.floor(Math.random() * extras.length)];
      const t = String(r.en || r.zi);
      if (!this._gardenWordIds(pool).some(id => id === t)) pool.push(r);
      i++;
    }
    return pool;
  },

  _gardenMarkLearned(batch) {
    if (!batch || !batch.length) return;
    const dp = this._gardenLoad();
    const today = this._gardenDateStr(0);
    const ids = this._gardenWordIds(batch);
    if (!dp.log[today]) dp.log[today] = [];
    ids.forEach(id => {
      if (dp.log[today].indexOf(id) < 0) dp.log[today].push(id);
      dp.lv[id] = 0;
      dp.due[id] = this._gardenDateStr(MEMORY_INTERVALS[0]);
    });
    this._gardenSave(dp);
  },

  _gardenAdvance(ids) {
    if (!ids || !ids.length) return;
    const dp = this._gardenLoad();
    const today = this._gardenDateStr(0);
    ids.forEach(id => {
      const lv = (dp.lv[id] || 0) + 1;
      dp.lv[id] = lv;
      if (lv >= MEMORY_INTERVALS.length) delete dp.due[id];
      else dp.due[id] = this._gardenDateStr(MEMORY_INTERVALS[lv]);
    });
    this._gardenSave(dp);
  },

  _gardenSetDue(ids, offsetDays) {
    if (!ids || !ids.length) return;
    const dp = this._gardenLoad();
    ids.forEach(id => { dp.due[id] = this._gardenDateStr(offsetDays); });
    this._gardenSave(dp);
  },

  _gardenDueWords() {
    const dp = this._gardenLoad();
    const today = this._gardenDateStr(0);
    const ids = Object.keys(dp.due || {}).filter(id => dp.due[id] <= today);
    return this._gardenFindWords(ids);
  },

  _gardenFruits() {
    const dp = this._gardenLoad();
    const words = this.getHomeworkWords(Storage.getHomework(this.currentStudent.id));
    let n = 0;
    words.forEach(w => {
      if (dp.lv && dp.lv[String(w.en || w.zi)] >= MEMORY_INTERVALS.length) n++;
    });
    return n;
  },

  renderMemoryGarden() {
    const main = document.getElementById('main-content');
    const hw = Storage.getHomework(this.currentStudent.id);
    const words = this.getHomeworkWords(hw);
    if (words.length === 0) {
      let e = '<div class="subject-container">';
      e += '<button class="back-btn" onclick="App.renderSubjectSelector()">← 返回上一级</button>';
      e += '<h2 class="course-title">🌳 记忆花园</h2>';
      e += '<div class="empty-state" style="padding:30px"><p>老师还未布置英语作业，等布置后再来种树吧</p></div>';
      e += '</div>';
      main.innerHTML = e;
      this.updateTopBar();
      return;
    }

    const dp = this._gardenLoad();
    const today = this._gardenDateStr(0);
    const doneToday = dp.date === today && dp.cursor > 0;
    const dueWords = this._gardenDueWords();
    const morningWords = this._gardenFindWords((dp.log && dp.log[this._gardenDateStr(-1)]) || []);
    const nightWords = this._gardenFindWords((dp.log && dp.log[today]) || []);
    const fruits = this._gardenFruits();
    let streakDays = 0;
    try {
      const prog = Storage.getProgress();
      streakDays = (prog && prog.streak) || 0;
    } catch (e) {}
    const start = doneToday ? Math.min(dp.cursor, words.length) : dp.cursor;
    const batchEnd = dp.cursor >= words.length ? words.length : Math.min(start + DAILY_BATCH, words.length);
    const todayWords = words.slice(start, batchEnd);
    const newReady = !doneToday && todayWords.length > 0;
    const weekWords = this._gardenWeekWords();
    const monsters = this._gardenMonsters();
    const planted = [];
    Object.keys(dp.lv || {}).forEach(id => {
      const w = words.find(x => String(x.en || x.zi) === id);
      if (w) planted.push({ id: id, w: w, lv: dp.lv[id] });
    });
    planted.sort((a, b) => a.lv - b.lv);

    let html = '<div class="subject-container">';
    html += '<button class="back-btn" onclick="App.renderSubjectSelector()">← 返回上一级</button>';
    html += '<h2 class="course-title">🌳 记忆花园</h2>';
    html += '<div style="padding:0 16px">';

    const streak = this._gardenStreak();
    const title = this._gardenTitle(streak);
    html += '<div style="background:linear-gradient(135deg,#E8F5E9,#C8E6C9);border:1px solid #A5D6A7;border-radius:12px;padding:12px 14px;margin-bottom:12px">';
    html += '<div style="display:flex;align-items:center;gap:10px">';
    html += '<div style="font-size:34px;line-height:1">' + (title.name === '💡 学习新手' ? '💡' : title.name.split(' ')[0]) + '</div>';
    html += '<div style="flex:1">';
    html += '<div style="font-weight:700;color:#2E7D32;font-size:15px">' + title.name + ' · 连续 ' + streak + ' 天</div>';
    if (title.next) {
      const pct = Math.min(100, Math.round((streak / title.toNext) * 100)) || 0;
      html += '<div style="height:7px;background:#DFEBDD;border-radius:4px;margin-top:6px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:#66BB6A;border-radius:4px"></div></div>';
      html += '<div style="font-size:11px;color:#558B2F;margin-top:3px">距离「' + title.next + '」还差 ' + title.toNext + ' 天</div>';
    } else {
      html += '<div style="font-size:11px;color:#558B2F;margin-top:3px">太棒了，最高称号达成！坚持每天学习 🔥</div>';
    }
    html += '</div></div></div>';
    html += '<div style="display:flex;gap:8px;margin-bottom:14px">';
    html += '<div style="flex:1;background:' + (dueWords.length ? '#FBE9E7' : '#F5F7FA') + ';border:1px solid ' + (dueWords.length ? '#FFAB91' : '#E0E0E0') + ';border-radius:10px;padding:10px;text-align:center;font-size:12px;color:' + (dueWords.length ? '#BF360C' : 'var(--text-light)') + '"><div style="font-size:20px;font-weight:700">' + dueWords.length + '</div>今日待复习</div>';
    html += '<div style="flex:1;background:#E8F5E9;border:1px solid #A5D6A7;border-radius:10px;padding:10px;text-align:center;font-size:12px;color:#2E7D32"><div style="font-size:20px;font-weight:700">' + fruits + '🍎</div>花园果实</div>';
    html += '<div style="flex:1;background:' + (streakDays > 0 ? '#FFE0B2' : '#F5F7FA') + ';border:1px solid ' + (streakDays > 0 ? '#FFB74D' : '#E0E0E0') + ';border-radius:10px;padding:10px;text-align:center;font-size:12px;color:' + (streakDays > 0 ? '#E65100' : 'var(--text-light)') + '"><div style="font-size:20px;font-weight:700">' + streakDays + '🔥</div>连续学习</div>';
    html += '</div>';

    html += '<div style="font-size:14px;font-weight:700;margin-bottom:8px">📋 今日任务</div>';
    if (morningWords.length) {
      html += '<button class="daily-mode-btn" data-garden="morning" style="width:100%;margin-bottom:8px">🌅 晨间快测 · 昨日 ' + morningWords.length + ' 词</button>';
    } else {
      html += '<div style="background:#F5F7FA;border:1px solid #EEE;border-radius:10px;padding:10px 14px;margin-bottom:8px;font-size:12px;color:var(--text-light)">🌅 晨间快测：昨天没学新词，跳过</div>';
    }
    if (newReady) {
      html += '<button class="login-btn" data-garden="new" style="width:100%;margin-bottom:8px">🌱 今日新词（' + todayWords.length + ' 词）闯关学习</button>';
    } else {
      html += '<div style="background:#E8F5E9;border:1px solid #A5D6A7;border-radius:10px;padding:10px 14px;margin-bottom:8px;font-size:12px;color:#2E7D32">🌱 今日新词' + (doneToday ? '已完成 ✅' : '（作业已全部学完 ✅）') + '</div>';
    }
    if (dueWords.length) {
      html += '<button class="login-btn" data-garden="due" style="width:100%;margin-bottom:8px;background:#BF360C;border-color:#BF360C">⏰ 到期复习 · ' + dueWords.length + ' 词待巩固</button>';
    } else {
      html += '<div style="background:#F5F7FA;border:1px solid #EEE;border-radius:10px;padding:10px 14px;margin-bottom:8px;font-size:12px;color:var(--text-light)">⏰ 到期复习：今日无到期词</div>';
    }
    const wk = this._gardenWeekKey();
    const trophy = (dp.trophies || {})[wk];
    if (trophy) {
      html += '<div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:10px;padding:10px 14px;margin-bottom:8px;font-size:12px;color:#8D6E63">🏆 本周周考 · 已获得 ' + (trophy.s >= 3 ? '🥇 金奖杯' : trophy.s >= 2 ? '🥈 银奖杯' : '🥉 铜奖杯') + '（' + (trophy.n || 0) + ' 词）</div>';
    } else if (weekWords.length >= 5) {
      html += '<button class="login-btn" data-garden="week" style="width:100%;margin-bottom:8px;background:#6D4C41;border-color:#6D4C41">🏆 本周周考 · ' + weekWords.length + ' 词 · 赢取奖杯</button>';
    } else {
      html += '<div style="background:#F5F7FA;border:1px solid #EEE;border-radius:10px;padding:10px 14px;margin-bottom:8px;font-size:12px;color:var(--text-light)">🏆 本周周考：本周学满 5 个词后解锁</div>';
    }
    if (nightWords.length) {
      html += '<button class="daily-mode-btn" data-garden="night" style="width:100%;margin-bottom:8px">🌙 睡前闪电问答 · 今日 ' + nightWords.length + ' 词</button>';
    } else {
      html += '<div style="background:#F5F7FA;border:1px solid #EEE;border-radius:10px;padding:10px 14px;margin-bottom:8px;font-size:12px;color:var(--text-light)">🌙 睡前闪电问答：学完今日新词后出现</div>';
    }
    if (monsters.length) {
      html += '<button class="daily-mode-btn" data-garden="cage" style="width:100%;margin-bottom:8px;background:#FFEBEE;border-color:#EF9A9A;color:#B71C1C">🦁 怪兽笼 · ' + monsters.length + ' 只在押，点击驯服</button>';
    } else {
      html += '<div style="background:#F5F7FA;border:1px solid #EEE;border-radius:10px;padding:10px 14px;margin-bottom:8px;font-size:12px;color:var(--text-light)">🦁 怪兽笼：没有怪兽，全部驯服 🎉</div>';
    }

    html += '<div style="background:#F1F8E9;border:1px solid #C5E1A5;border-radius:10px;padding:12px;margin-top:10px">';
    html += '<div style="font-size:14px;font-weight:700;color:#33691E">🌿 我的花园 <small style="font-weight:400;color:#689F38">已种 ' + planted.length + ' 棵 · 点击听发音</small></div>';
    if (!planted.length) {
      html += '<div style="font-size:12px;color:#689F38;padding:8px 0">还没有小树苗，学完今日新词就会发芽 🌱</div>';
    } else {
      html += '<div style="display:flex;flex-wrap:wrap;margin-top:8px">';
      planted.forEach((p, i) => {
        const ripe = p.lv >= MEMORY_INTERVALS.length;
        html += '<div class="pj-plant ' + (ripe ? 'pj-fruit' : '') + '" data-plant="' + this._h(p.id).replace(/"/g, '&quot;') + '" style="flex:0 0 25%;text-align:center;padding:8px 0;cursor:pointer">';
        html += '<span class="pj-e" style="font-size:30px;animation-delay:' + (i * 40) + 'ms">' + this._gardenPlantEmoji(p.lv) + '</span>';
        html += '<div style="font-size:10px;color:#558B2F;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + this._h(String(p.w.en || p.w.zi)) + '</div>';
        html += '<div style="font-size:9px;color:' + (ripe ? '#F57F17' : '#8BC34A') + '">' + (ripe ? '🍎 已毕业' : '复习 ' + p.lv + '/6') + '</div>';
        html += '</div>';
      });
      html += '</div>';
      html += '<div id="garden-plant-detail" style="margin-top:8px;font-size:12px;color:#33691E;background:#E8F5E9;border-radius:8px;padding:8px 10px;display:none"></div>';
    }
    html += '</div>';

    html += '<div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:10px;padding:10px 14px;margin-top:6px;font-size:12px;color:#5D4037">🧠 记忆法：新词第 1、2、4、7、15、30 天各复习一次，坚持下来词就长成大树、结出果实 🍎</div>';
    html += '</div></div>';
    main.innerHTML = html;

    main.querySelectorAll('[data-garden]').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = btn.dataset.garden;
        if (g === 'new') {
          this._accFlow = true;
          this._accFlowFromGarden = true;
          this._accTotalAll = words.length;
          this._accStart(todayWords.slice(), true, null);
        } else if (g === 'morning') {
          const pool = this._gardenBuildPool(morningWords);
          this._accQuiz(morningWords.slice(), pool, 'morning');
        } else if (g === 'due') {
          this._gardenDueIds = this._gardenWordIds(dueWords);
          const pool = this._gardenBuildPool(dueWords);
          this._accQuiz(dueWords.slice(), pool, 'due');
        } else if (g === 'night') {
          const pool = this._gardenBuildPool(nightWords);
          this._accQuiz(nightWords.slice(), pool, 'night');
        } else if (g === 'week') {
          const pool = this._gardenBuildPool(weekWords);
          this._accQuiz(weekWords.slice(), pool, 'week');
        } else if (g === 'cage') {
          this.renderGardenMonsterCage();
        }
      });
    });
    main.querySelectorAll('[data-plant]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.plant;
        const p = planted.find(x => x.id === id);
        if (!p) return;
        this.speakWord(String(p.w.en || p.w.zi));
        const det = document.getElementById('garden-plant-detail');
        det.style.display = 'block';
        det.innerHTML = '🌱 <strong>' + this._h(String(p.w.en || p.w.zi)) + '</strong> ' + this._h(p.w.cn || '') + ' · 已复习 ' + p.lv + '/6 次' + (p.lv >= 6 ? '，长成大树结出果实啦 🍎' : '，距毕业还差 ' + (6 - p.lv) + ' 次');
      });
    });
    this.updateTopBar();
  },

  _gardenDueDone() {
    const ids = this._gardenDueIds || [];
    const wrongIds = this._gardenWordIds(this._quizWrong || []);
    const pass = ids.filter(id => wrongIds.indexOf(id) < 0);
    const fail = ids.filter(id => wrongIds.indexOf(id) >= 0);
    this._gardenAdvance(pass);
    if (fail.length) {
      this._gardenSetDue(fail, 1);
      this._gardenLockMonsters(fail, this._gardenDateStr(0));
    }
    this._gardenDueIds = null;
    this.renderMemoryGarden();
  },

  _gardenDatesOf(baseDate) {
    const y = baseDate.getFullYear();
    const m = baseDate.getMonth() + 1;
    const d = baseDate.getDate();
    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);
  },

  _gardenWeekMondayDate(offsetDays) {
    const d = new Date();
    const dow = (d.getDay() + 6) % 7;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow + (offsetDays || 0));
  },

  _gardenWeekKey() {
    const m = this._gardenWeekMondayDate();
    const jan1 = new Date(m.getFullYear(), 0, 1);
    const week = Math.ceil(((m - jan1) / 86400000 + jan1.getDay() + 1) / 7);
    return m.getFullYear() + '-W' + week;
  },

  _gardenStreak() {
    try {
      const prog = Storage.getProgress();
      return (prog && prog.streak) || 0;
    } catch (e) { return 0; }
  },

  _gardenTitle(streak) {
    const tiers = [
      { min: 49, name: '🌳 森林守护者' },
      { min: 21, name: '🌿 细心园丁' },
      { min: 7, name: '🌱 萌芽新芽' }
    ];
    for (let i = 0; i < tiers.length; i++) {
      if (streak >= tiers[i].min) return { name: tiers[i].name, next: '', toNext: 0 };
    }
    const cur = tiers[tiers.length - 1];
    return { name: '💡 学习新手', next: cur.name, toNext: cur.min - streak };
  },

  _gardenMonsters() {
    const dp = this._gardenLoad();
    const words = this.getHomeworkWords(Storage.getHomework(this.currentStudent.id));
    const out = [];
    Object.keys(dp.monster || {}).forEach(id => {
      const w = words.find(x => String(x.en || x.zi) === id);
      if (w) out.push({ w: w, date: dp.monster[id] });
    });
    return out;
  },

  _gardenLockMonsters(ids, dateStr) {
    if (!ids || !ids.length) return;
    const dp = this._gardenLoad();
    if (!dp.monster) dp.monster = {};
    ids.forEach(id => { dp.monster[id] = dateStr; });
    this._gardenSave(dp);
  },

  _gardenUnlockMonsters(ids) {
    if (!ids || !ids.length) return;
    const dp = this._gardenLoad();
    const m = dp.monster || {};
    ids.forEach(id => { delete m[id]; });
    dp.monster = m;
    this._gardenSave(dp);
  },

  _gardenWeekWords() {
    const dp = this._gardenLoad();
    const monday = this._gardenDatesOf(this._gardenWeekMondayDate());
    const sunday = this._gardenDatesOf(this._gardenWeekMondayDate(6));
    const seen = {};
    Object.keys(dp.log || {}).forEach(d => {
      if (d >= monday && d <= sunday) (dp.log[d] || []).forEach(id => { seen[id] = 1; });
    });
    Object.keys(dp.due || {}).forEach(id => {
      if (dp.due[id] >= monday && dp.due[id] <= sunday) seen[id] = 1;
    });
    const words = this.getHomeworkWords(Storage.getHomework(this.currentStudent.id));
    const out = words.filter(w => seen[String(w.en || w.zi)]);
    while (out.length > 20) out.splice(Math.floor(Math.random() * out.length), 1);
    return out;
  },

  _gardenWeekDone() {
    const wrong = this._quizWrong || [];
    const stars = wrong.length === 0 ? 3 : wrong.length <= 2 ? 2 : 1;
    const wk = this._gardenWeekKey();
    const dp = this._gardenLoad();
    if (!dp.trophies) dp.trophies = {};
    dp.trophies[wk] = { s: stars, n: this._quizWords ? this._quizWords.length : 0 };
    this._gardenSave(dp);
    this._quizMode = null;
    this.renderMemoryGarden();
  },

  _gardenTameDone() {
    const ids = this._gardenTameIds || [];
    const wrongIds = this._gardenWordIds(this._quizWrong || []);
    const pass = ids.filter(id => wrongIds.indexOf(id) < 0);
    const fail = ids.filter(id => wrongIds.indexOf(id) >= 0);
    this._gardenUnlockMonsters(pass);
    this._gardenAdvance(pass);
    this._gardenTameIds = null;
    this._quizMode = null;
    if (fail.length) this.renderGardenMonsterCage();
    else this.renderMemoryGarden();
  },

  _gardenPlantEmoji(lv) {
    if (lv >= 6) return '🍎';
    if (lv >= 3) return '🌳';
    if (lv >= 2) return '🌿';
    if (lv >= 1) return '🌱';
    return '🌰';
  },

  _gardenEnsureStyles() {
    if (document.getElementById('pj-garden-style')) return;
    const st = document.createElement('style');
    st.id = 'pj-garden-style';
    st.textContent = '@keyframes pj-grow{from{opacity:0;transform:scale(.5) translateY(12px)}to{opacity:1;transform:scale(1) translateY(0)}}@keyframes pj-swing{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(8deg)}}.pj-plant{animation:pj-grow .5s ease both}.pj-fruit .pj-e{display:inline-block;animation:pj-swing 2.2s ease-in-out infinite;transform-origin:50% 100%}';
    document.head.appendChild(st);
  },

  renderGardenMonsterCage() {
    this._gardenEnsureStyles();
    const main = document.getElementById('main-content');
    const monsters = this._gardenMonsters();
    let html = '<div class="subject-container">';
    html += '<button class="back-btn" onclick="App.renderMemoryGarden()">← 返回记忆花园</button>';
    html += '<h2 class="course-title">🦁 怪兽笼</h2>';
    html += '<div style="padding:0 16px">';
    html += '<div style="background:#FFEBEE;border:1px solid #EF9A9A;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#B71C1C">🦁 这里关押着复习时总是认错的"怪兽词"。驯服它们：听音选词，答对就放出来，变成花园里的朋友！</div>';
    if (!monsters.length) {
      html += '<div class="empty-state" style="padding:30px"><p>笼子是空的，所有的怪兽都被驯服啦 🎉</p></div>';
      html += '</div></div>';
      main.innerHTML = html;
      this.updateTopBar();
      return;
    }
    html += '<div style="border:1px solid #EEE;border-radius:10px;padding:8px 12px;margin-bottom:14px">';
    const wids = [];
    monsters.forEach(m => {
      wids.push(String(m.w.en || m.w.zi));
      html += '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px">';
      html += '<a href="javascript:void(0)" class="acc-unknown-speak" data-w="' + this._h(String(m.w.en || m.w.zi)).replace(/"/g, '&quot;') + '" style="color:var(--primary)">🔊</a>';
      html += '<strong>' + this._h(m.w.en || m.w.zi) + '</strong>';
      html += '<small style="color:var(--text-light)">' + this._h(m.w.cn || '') + '</small>';
      html += '<small style="margin-left:auto;color:#E57373">' + (m.date || '') + ' 关押</small>';
      html += '</div>';
    });
    html += '</div>';
    html += '<button class="login-btn" id="garden-tame" style="width:100%">🦸 开始驯服 · ' + monsters.length + ' 只（听音选词）</button>';
    html += '</div></div>';
    main.innerHTML = html;

    const self = this;
    document.querySelectorAll('.acc-unknown-speak').forEach(a => {
      a.addEventListener('click', () => self.speakWord(a.dataset.w));
    });
    document.getElementById('garden-tame').addEventListener('click', () => {
      const words = monsters.map(m => m.w);
      this._gardenTameIds = wids;
      const pool = this._gardenBuildPool(words);
      this._accQuiz(words.slice(), pool, 'tame');
    });
    this.updateTopBar();
  },

  renderDailyHome() {
    const main = document.getElementById('main-content');
    const sid = this.currentStudent.id;
    const cols = [
      { icon: '📗', subj: 'english', label: '英语', hw: Storage.getHomework(sid) },
      { icon: '📘', subj: 'chinese', label: '语文', hw: Storage.getHomeworkZh(sid) },
      { icon: '📙', subj: 'math', label: '数学', hw: Storage.getHomeworkMath(sid) }
    ];
    const anyHw = cols.some(c => c.hw && this.getHomeworkWords(c.hw, c.subj).length > 0);
    let html = '<div class="subject-container">';
    html += '<button class="back-btn" onclick="App.renderSubjectSelector()">← 返回上一级</button>';
    html += '<h2 class="course-title">📅 每天必练</h2>';
    if (!anyHw) {
      html += '<div class="empty-state" style="padding:30px"><p>老师还未布置作业，先去完成课程学习吧</p></div>';
      html += '</div>';
      main.innerHTML = html;
      this.updateTopBar();
      return;
    }
    html += '<div style="padding:0 16px">';
    cols.forEach(c => {
      const words = c.hw ? this.getHomeworkWords(c.hw, c.subj) : [];
      const unitTxt = c.subj === 'chinese' ? '字' : c.subj === 'math' ? '题' : '词';
      html += '<div class="daily-subj-card" data-subj="' + c.subj + '" style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:' + (words.length ? '#FFF' : '#FFF8F0') + ';border:1px solid ' + (words.length ? '#E0E0E0' : '#FFCC80') + ';border-radius:12px;margin-bottom:10px;cursor:pointer">';
      html += '<div style="font-size:26px">' + c.icon + '</div>';
      html += '<div style="flex:1">';
      html += '<div style="font-size:15px;font-weight:700">' + c.label + '作业</div>';
      html += '<div style="font-size:12px;color:' + (words.length ? 'var(--text-light)' : '#E65100') + '">' + (words.length ? '已布置 ' + words.length + ' ' + unitTxt : '未布置 · 点进入查看') + (c.hw && c.hw.assignedAt ? '（' + new Date(c.hw.assignedAt).toLocaleDateString('zh-CN') + '）' : '') + '</div>';
      html += '</div>';
      html += '<span style="color:var(--primary);font-size:13px">开始 ▶</span>';
      html += '</div>';
    });
    html += '</div>';
    html += '</div>';
    main.innerHTML = html;
    main.querySelectorAll('.daily-subj-card').forEach(card => {
      card.addEventListener('click', () => {
        const subj = card.dataset.subj;
        if (subj === 'english') this.renderDailyPractice();
        else if (subj === 'chinese') this.renderZhDailyModes();
        else this.renderMathDailyModes();
      });
    });
    this.updateTopBar();
  },

  renderSubjectCards(subject) {
    const main = document.getElementById('main-content');
    const sid = this.currentStudent.id;
    const hw = subject === 'chinese' ? Storage.getHomeworkZh(sid) : Storage.getHomeworkMath(sid);
    const words = this.getHomeworkWords(hw, subject);
    if (!words.length) { this.renderDailyHome(); return; }
    const meta = subject === 'chinese' ? { icon: '📘', label: '语文' } : { icon: '📙', label: '数学' };
    const st = this._subjCards && this._subjCards.subject === subject ? this._subjCards : { subject: subject, index: 0, flipped: false };
    if (st.index >= words.length) st.index = 0;
    this._subjCards = st;
    const w = words[st.index];
    const front = subject === 'chinese'
      ? '<div style="font-size:64px;font-weight:700;letter-spacing:8px">' + this._h(w.zi) + '</div><div style="margin-top:8px;font-size:18px;color:var(--text-light)">' + this._h(w.pinyin) + '</div>'
      : '<div style="font-size:30px;font-weight:700;padding:0 10px">' + this._h(this._mathDisp(w.en)) + '</div>';
    const back = subject === 'chinese'
      ? '<div style="font-size:40px;font-weight:700;letter-spacing:4px;color:#4E342E">' + this._h(w.zi) + '</div><div style="font-size:18px;color:#E65100;margin-top:6px">' + this._h(w.pinyin) + '</div>'
        + '<div style="font-size:20px;color:#5D4037;margin-top:12px;line-height:1.8">' + this._h(w.yi) + '</div>'
        + '<button class="reading-ctrl-btn" id="subj-speak" style="margin-top:14px">🔊 朗读</button>'
      : '<div style="font-size:18px">' + this._h(w.cn) + '</div>';
    let html = '<div class="subject-container">';
    html += '<button class="back-btn" onclick="App._subjCardsBack()">← 返回上一级</button>';
    html += '<h2 class="course-title">' + meta.icon + ' ' + meta.label + '作业 · ' + this._h(this.currentStudent.name) + '</h2>';
    html += '<div style="padding:0 16px;text-align:center">';
    html += '<div style="margin:10px 0;font-size:13px;color:var(--text-light)">第 ' + (st.index + 1) + ' / ' + words.length + ' 项 · 点卡片看' + (subject === 'chinese' ? '意思' : '口诀') + '</div>';
    html += '<div id="subj-card" style="min-height:220px;display:flex;align-items:center;justify-content:center;background:#FFF;border:1px solid #E0E0E0;border-radius:14px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.06);cursor:pointer;user-select:none">' + (st.flipped ? back : front) + '</div>';
    html += '<div style="display:flex;gap:10px;margin-top:16px">';
    html += '<button class="admin-gen-btn" id="subj-prev" style="flex:1">◀ 上一项</button>';
    html += '<button class="login-btn" id="subj-flip" style="flex:1">🔄 翻转</button>';
    html += '<button class="admin-gen-btn" id="subj-next" style="flex:1">下一项 ▶</button>';
    html += '</div>';
    html += '<div style="margin-top:14px"><button class="quit-btn" onclick="App._subjCardsBack()">↩ 完成/退出</button></div>';
    html += '</div>';
    html += '</div>';
    main.innerHTML = html;
    document.getElementById('subj-card').addEventListener('click', () => { st.flipped = !st.flipped; this.renderSubjectCards(subject); });
    document.getElementById('subj-flip').addEventListener('click', () => { st.flipped = !st.flipped; this.renderSubjectCards(subject); });
    document.getElementById('subj-prev').addEventListener('click', () => { st.index = (st.index - 1 + words.length) % words.length; st.flipped = false; this.renderSubjectCards(subject); });
    document.getElementById('subj-next').addEventListener('click', () => { st.index = (st.index + 1) % words.length; st.flipped = false; this.renderSubjectCards(subject); });
    const spk = document.getElementById('subj-speak');
    if (spk) spk.addEventListener('click', (e) => {
      e.stopPropagation();
      this._zhSpeakSeq(String(w.zi || '').trim(), String(w.pinyin || '').trim(), null, { skipUrl: true });
    });
    this.updateTopBar();
  },

  _subjCardsBack() {
    this.renderDailyHome();
  },

  // ===== 语文作业 · 每日多种趣味形式 =====
  zhDailyWords: [],
  zhDailyMode: '',

  getZhDailyWords() {
    const hw = Storage.getHomeworkZh(this.currentStudent.id);
    return this.getHomeworkWords(hw, 'chinese');
  },

  renderZhDailyModes() {
    const main = document.getElementById('main-content');
    const words = this.getZhDailyWords();
    this.stopSpeaking();
    this.zhDailyWords = words;
    let html = '<div class="subject-container">';
    html += '<button class="back-btn" onclick="App.renderDailyHome()">← 返回每天必练</button>';
    html += '<h2 class="course-title">📘 语文作业·趣味练</h2>';
    if (!words.length) {
      html += '<div style="padding:0 16px"><div class="empty-state" style="padding:30px"><p>老师还未布置语文作业，先去完成课程学习吧</p></div></div>';
      html += '</div>';
      main.innerHTML = html;
      this.updateTopBar();
      return;
    }
    html += '<div style="padding:0 16px">';
    html += '<div style="background:#FFF3E0;border:1px solid #FFCC80;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#E65100">共 <strong>' + words.length + '</strong> 个字词，挑一个玩法开始吧！</div>';
    html += '<div class="daily-modes">';
    const modes = [
      { k: 'fc', icon: '🃏', t: '认读翻卡', d: '看字拼音想意思' },
      { k: 'listen', icon: '🎧', t: '听音选字', d: '听声音找对字' },
      { k: 'pinyin', icon: '✍️', t: '拼音训练营', d: '看字选对拼音' },
      { k: 'match', icon: '🧩', t: '识字配对', d: '字和意思连连看' },
      { k: 'say', icon: '🎲', t: '组词造句秀', d: '动脑开口讲一讲' },
      { k: 'fly', icon: '🪰', t: '拍苍蝇', d: '听声音拍对字' }
    ];
    modes.forEach(m => {
      html += '<button class="dm-btn zhdm-btn" data-k="' + m.k + '" style="background:' + this._zhdColor(m.k) + '"><span class="dm-icon">' + m.icon + '</span><span class="dm-txt"><strong>' + m.t + '</strong><small>' + m.d + '</small></span></button>';
    });
    html += '</div>';
    html += '</div>';
    html += '</div>';
    main.innerHTML = html;
    document.querySelectorAll('.zhdm-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.k;
        this.zhDailyMode = k;
        if (k === 'fc') this.startZhFcGame();
        else if (k === 'listen') this.startZhDailyListen();
        else if (k === 'pinyin') this.startZhPyQuiz();
        else if (k === 'match') this.startMatchGame(null, words);
        else if (k === 'say') this.startZhSay();
        else if (k === 'fly') this.startZhFly();
      });
    });
    this.updateTopBar();
  },

  _zhdColor(k) {
    const map = { fc: '#FFF3E0', listen: '#E3F2FD', pinyin: '#E8F5E9', match: '#F3E5F5', say: '#FFEBEE', fly: '#FFFDE7' };
    return map[k] || '#FFF';
  },

  // ===== 数学每天必练 =====
  renderMathDailyModes() {
    const main = document.getElementById('main-content');
    const words = this._getMathDailyWords();
    this.mathDailyWords = words;
    let html = '<div class="subject-container">';
    html += '<button class="back-btn" onclick="App.renderDailyHome()">← 返回每天必练</button>';
    html += '<h2 class="course-title">📐 数学作业.趣味练</h2>';
    if (!words.length) {
      html += '<div style="padding:0 16px"><div class="empty-state" style="padding:30px"><p>老师还未布置数学作业，先去完成课程学习吧</p></div></div>';
      html += '</div>';
      main.innerHTML = html;
      this.updateTopBar();
      return;
    }
    // 计算各模式进度
    const prog = this._getMathModeProgress();
    html += '<div style="padding:0 16px">';
    html += '<div style="background:#E3F2FD;border:1px solid #90CAF9;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#1565C0">共 <strong>' + words.length + '</strong> 个知识点，选一个玩法开始吧！</div>';
    html += '<div class="daily-modes math-mode-grid">';
    const modes = [
      { k: 'oral', icon: '🧮', t: '口算速练', d: '随机口算自动判分', color: '#1E88E5' },
      { k: 'paper', icon: '📝', t: '口算作业', d: '整卷作答自动判分', color: '#5C6BC0' },
      { k: 'wrong', icon: '❌', t: '错题重练', d: '攻克薄弱点', color: '#E57373' },
      { k: 'challenge', icon: '🎯', t: '闯关挑战', d: '限时冲高分', color: '#FF9800' },
      { k: 'pattern', icon: '🔢', t: '数字规律', d: '找规律填数', color: '#00BFA5' },
      { k: 'compare', icon: '🧩', t: '对比辨析', d: '区分易混概念', color: '#4CAF50' }
    ];
    modes.forEach(m => {
      const p = prog[m.k] || { done: 0, total: 0, stars: 0 };
      const starStr = '⭐'.repeat(p.stars) + '☆'.repeat(3 - p.stars);
      html += '<button class="dm-btn math-dm-btn" data-k="' + m.k + '" style="border-left:4px solid ' + m.color + '">';
      html += '<span class="dm-icon" style="font-size:28px">' + m.icon + '</span>';
      html += '<span class="dm-txt"><strong style="color:' + m.color + '">' + m.t + '</strong><small>' + m.d + '</small>';
      if (p.total) html += '<div style="margin-top:4px;font-size:11px;color:#666">进度 ' + p.done + '/' + p.total + ' ' + starStr + '</div>';
      html += '</span></button>';
    });
    html += '</div></div></div>';
    main.innerHTML = html;
    document.querySelectorAll('.math-dm-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.k;
        if (k === 'oral') this.startMathOral();
        else if (k === 'paper') this.startMathPaper();
        else if (k === 'wrong') this.startMathWrongReview();
        else if (k === 'challenge') this.startMathChallenge();
        else if (k === 'pattern') this.startMathPattern();
        else if (k === 'compare') this.startMathCompare();
      });
    });
    this.updateTopBar();
  },

  _getMathModeProgress() {
    // 从本地存储读取各模式完成情况
    try {
      const sid = this.currentStudent ? this.currentStudent.id : 'default';
      const key = 'mathDailyProgress_' + sid;
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  },

  _saveMathModeProgress(modeKey, stars) {
    try {
      const sid = this.currentStudent ? this.currentStudent.id : 'default';
      const key = 'mathDailyProgress_' + sid;
      const prog = this._getMathModeProgress();
      if (!prog[modeKey]) prog[modeKey] = { done: 0, total: 0, stars: 0 };
      prog[modeKey].done++;
      prog[modeKey].total = prog[modeKey].total || 1;
      prog[modeKey].stars = Math.max(prog[modeKey].stars || 0, stars);
      localStorage.setItem('mathDailyProgress_' + (this.currentStudent ? this.currentStudent.id : 'default'), JSON.stringify(prog));
    } catch (e) {}
  },

  _getMathDailyWords() {
    const sid = this.currentStudent ? this.currentStudent.id : null;
    const hw = sid ? Storage.getHomeworkMath(sid) : null;
    let words = hw ? this.getHomeworkWords(hw, 'math') : [];
    if (!words.length) words = this.mathDailyWords || [];
    return words;
  },

  // 📋 口诀背诵 → 口诀竞答（可作答：看算式选口诀 / 口算填结果）
  startMathMemorize() {
    const words = (this._getMathDailyWords() || []).filter(w => this._mathParseEn(w.en) != null || /[\u4e00-\u9fff]/.test(String(w.cn || '')));
    if (!words.length) { this.renderMathDailyModes(); return; }
    this.activeSessionId = Storage.startSession('mathMemorize', 0, '每天必练·数学·口诀竞答', '', { subject: 'math', totalItems: words.length });
    this._mathMem = { words: words, idx: 0, score: 0, answered: false };
    this._renderMathMem();
  },
  _mathMemKoujueOpts(st, idx) {
    const cur = st.words[idx];
    const ans = String(cur.cn || '').trim();
    const opts = [ans];
    const seen = {};
    seen[ans] = 1;
    for (let i = 0; i < st.words.length && opts.length < 4; i++) {
      if (i === idx) continue;
      const o = String(st.words[i].cn || '').trim();
      if (o && o !== ans && !seen[o]) { seen[o] = 1; opts.push(o); }
    }
    const fb = ['一一得一', '二二得四', '三三得九', '一二得二', '一五得五', '三七二十一'];
    for (let i = 0; i < fb.length && opts.length < 4; i++) {
      if (!seen[fb[i]]) { seen[fb[i]] = 1; opts.push(fb[i]); }
    }
    return this._shuffleArr(opts);
  },
  _renderMathMem() {
    const st = this._mathMem;
    const w = st.words[st.idx];
    const total = st.words.length;
    const eq = this._mathParseEn(w.en);
    const isKoujue = eq != null && /[\u4e00-\u9fff]/.test(String(w.cn || '')) && String(w.cn).indexOf('=') < 0;
    // 口诀竞答读题都读算式题目（如"一乘一等于多少"），不读口诀/答案（避免泄题）
    const speakTxt = eq ? this._mathExprZhQ(eq) : String(w.cn || w.en || '');
    let html = '<div class="math-container">';
    html += '<button class="back-btn" onclick="App._mathMemCleanup();App.renderMathDailyModes()">← 返回数学作业</button>';
    html += '<h2 class="course-title">📋 口诀竞答</h2>';
    html += '<div style="text-align:center;margin:8px 0;font-size:13px;color:var(--text-light)">' + (st.idx + 1) + ' / ' + total + ' 题 · 答对 ' + st.score + '</div>';
    html += '<button class="login-btn" id="math-mem-speak" style="display:block;margin:0 auto 14px">🔊 朗读</button>';
    html += '<div class="math-card" style="padding:24px;text-align:center">';
    if (isKoujue) {
      html += '<div style="font-size:15px;color:#666;margin-bottom:8px">看算式，选出正确的口诀</div>';
      html += '<div style="font-size:40px;font-weight:700;color:#0D47A1;letter-spacing:3px">' + this._h(eq.a) + ' ' + this._mathOpSym(eq.op) + ' ' + this._h(eq.b) + ' = ' + this._h(eq.result) + '</div>';
      const opts = this._mathMemKoujueOpts(st, st.idx);
      html += '<div style="display:flex;flex-direction:column;gap:10px;margin-top:16px">' + opts.map((o, i) => '<button class="math-opt-btn math-mem-kj" data-oi="' + i + '"' + (st.answered ? ' disabled' : '') + '>' + this._h(o) + '</button>').join('') + '</div>';
      html += '<div id="math-mem-fb" style="margin-top:14px;min-height:24px"></div>';
    } else {
      html += '<div style="font-size:15px;color:#666;margin-bottom:8px">计算并填写答案</div>';
      html += '<div style="font-size:40px;font-weight:700;color:#0D47A1;letter-spacing:3px">' + this._h(eq ? eq.a : this._mathDisp(w.en)) + (eq ? ' ' + this._mathOpSym(eq.op) + ' ' + this._h(eq.b) : '') + ' ' + (eq ? '= ?' : String(w.cn || '')) + '</div>';
      html += '<input type="number" id="math-mem-input" class="fill-input" style="font-size:28px;text-align:center;width:150px;margin-top:12px" placeholder="?" ' + (st.answered ? 'disabled' : '') + '>';
      html += '<div style="margin-top:10px"><button class="submit-btn" id="math-mem-submit" ' + (st.answered ? 'disabled' : '') + '>确认</button></div>';
      html += '<div id="math-mem-fb" style="margin-top:14px;min-height:24px"></div>';
    }
    html += '</div>';
    html += '<button class="admin-gen-btn" id="math-mem-next" style="width:100%;margin-top:16px"' + (st.answered ? '' : ' disabled') + '>' + (st.idx < total - 1 ? '下一题 ▶' : '完成 ✓') + '</button>';
    html += '</div>';
    document.getElementById('main-content').innerHTML = html;

    document.getElementById('math-mem-speak').addEventListener('click', () => this.speakChinese(speakTxt));

    if (isKoujue) {
      const opts = this._mathMemKoujueOpts(st, st.idx);
      const ans = String(w.cn || '').trim();
      const correctIdx = opts.indexOf(ans);
      document.querySelectorAll('.math-mem-kj').forEach(btn => {
        btn.addEventListener('click', () => {
          if (st.answered) return;
          st.answered = true;
          const oi = parseInt(btn.dataset.oi);
          const ok = oi === correctIdx;
          if (ok) st.score++;
          btn.classList.add(ok ? 'math-opt-correct' : 'math-opt-wrong');
          if (!ok) document.querySelectorAll('.math-mem-kj')[correctIdx].classList.add('math-opt-correct');
          const fb = document.getElementById('math-mem-fb');
          if (fb) fb.innerHTML = '<div style="font-size:17px;color:' + (ok ? '#2E7D32' : '#C62828') + '">' + (ok ? '✅ 正确！' : '❌ 口诀是 ' + this._h(ans)) + '</div>';
          document.getElementById('math-mem-next').disabled = false;
        });
      });
    } else {
      const judge = () => {
        if (st.answered) return;
        const input = document.getElementById('math-mem-input');
        const val = parseFloat(input.value);
        if (isNaN(val)) { const fb = document.getElementById('math-mem-fb'); if (fb) fb.innerHTML = '<div style="color:#C62828">请输入数字</div>'; return; }
        st.answered = true;
        const ok = eq != null && Math.abs(val - eq.result) < 0.001;
        if (ok) st.score++;
        input.disabled = true;
        const sbtn = document.getElementById('math-mem-submit'); if (sbtn) sbtn.disabled = true;
        const fb = document.getElementById('math-mem-fb');
        if (fb) fb.innerHTML = '<div style="font-size:17px;color:' + (ok ? '#2E7D32' : '#C62828') + '">' + (ok ? '✅ 正确！' : '❌ 正确答案是 ' + (eq ? this._h(eq.result) : this._h(w.cn))) + '</div>';
        this.speakChinese(ok ? '正确' : (eq ? this._mathExprZh(eq) : this._h(w.cn)));
        document.getElementById('math-mem-next').disabled = false;
      };
      document.getElementById('math-mem-submit').addEventListener('click', judge);
      const input = document.getElementById('math-mem-input');
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') judge(); });
      this._exT(() => this.speakChinese(speakTxt), 400);
    }
    const self = this;
    document.getElementById('math-mem-next').addEventListener('click', () => {
      if (!st.answered) return;
      st.answered = false;
      if (st.idx < total - 1) { st.idx++; self._renderMathMem(); }
      else { self._mathMemFinish(); }
    });
  },
  _mathMemFinish() {
    const st = this._mathMem;
    const total = st.words.length;
    const score = st ? st.score : 0;
    const pct = total ? Math.round(score / total * 100) : 0;
    const stars = pct >= 90 ? 3 : pct >= 60 ? 2 : 1;
    if (this.activeSessionId) {
      Storage.endSession(this.activeSessionId, { correctCount: score, wrongCount: total - score, totalItems: total, accuracy: pct, stars: stars, xp: score * 5 });
      this.activeSessionId = null;
      this._autoPushReport();
    }
    this._saveMathModeProgress('memorize', stars);
    this._mathMemCleanup();
    let html = '<div class="math-container"><div class="quiz-summary">';
    html += '<div style="font-size:40px;margin-bottom:10px">' + '⭐'.repeat(stars) + '☆'.repeat(3 - stars) + '</div>';
    html += '<div style="font-size:22px;font-weight:700;color:#1565C0">答对 ' + score + ' / ' + total + ' (' + pct + '%)</div>';
    html += '<div style="font-size:16px;color:#888;margin-top:6px">' + (pct >= 90 ? '太棒了，口诀掌握牢固！' : pct >= 60 ? '不错，继续加油！' : '再练几遍就牢固了') + '</div>';
    html += '<button class="continue-btn" style="margin-top:20px" onclick="App.renderMathDailyModes()">返回菜单</button>';
    html += '</div></div>';
    document.getElementById('main-content').innerHTML = html;
  },
  _mathMemCleanup() {
    if (this._mathMem) { try { clearInterval(this._mathMem.timer); } catch (e) {} }
    this._mathMem = null;
  },

  // ❌ 错题重练
  startMathWrongReview() {
    const words = this._getMathDailyWords();
    if (!words.length) { this.renderMathDailyModes(); return; }
    const wrongEn = (Storage.getWrongWords(this.currentStudent ? this.currentStudent.id : '') || []).map(x => String(x.wordEn || '').trim());
    const wrongWords = words.filter(w => wrongEn.indexOf(String(w.en || '').trim()) >= 0);
    if (!wrongWords.length) { alert('没有数学错题，去闯关挑战吧！'); this.renderMathDailyModes(); return; }
    // 记录错因分析入口
    this._mathWrongReview = { words: wrongWords, idx: 0, score: 0, reviewed: {} };
    this._renderMathWrongReview();
  },
  _renderMathWrongReview() {
    const st = this._mathWrongReview;
    const w = st.words[st.idx];
    const total = st.words.length;
    let html = '<div class="math-container">';
    html += '<button class="back-btn" onclick="App.renderMathDailyModes()">← 返回数学作业</button>';
    html += '<h2 class="course-title">❌ 错题重练</h2>';
    html += '<div style="text-align:center;margin:6px 0;font-size:13px;color:var(--text-light)">第 ' + (st.idx + 1) + ' / ' + total + ' 题 · 已纠正 ' + Object.keys(st.reviewed).filter(k => st.reviewed[k]).length + ' 道</div>';
    html += '<div class="math-card" style="text-align:center;padding:24px">';
    html += '<div style="font-size:22px;font-weight:700;color:#E57373;margin-bottom:12px">' + this._h(this._mathDisp(w.en)) + '</div>';
    html += '<div style="font-size:18px;color:#333;margin-bottom:16px">' + this._h(w.cn) + '</div>';
    html += '<div style="background:#FFF3E0;padding:12px;border-radius:8px;margin-bottom:16px;font-size:14px;color:#E65100">💡 <strong>易错点：</strong>' + (w.example || '易混淆运算顺序/单位换算/进位退位') + '</div>';
    html += '<div style="display:flex;flex-direction:column;gap:10px">';
    const opts = this._mathGenOptions(w, this._mathWrongReview.words);
    opts.forEach(function(o, i) {
      html += '<button class="math-opt-btn" data-idx="' + i + '">' + o.label + '</button>';
    });
    html += '</div>';
    html += '<div id="math-q-fb" style="margin-top:14px;min-height:30px"></div>';
    html += '</div></div>';
    document.getElementById('main-content').innerHTML = html;
    var self = this;
    document.querySelectorAll('.math-opt-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (st.reviewed[st.idx]) return;
        st.reviewed[st.idx] = true;
        var idx = parseInt(btn.dataset.idx);
        var correct = opts[idx].isCorrect;
        if (correct) st.score++;
        btn.classList.add(correct ? 'math-opt-correct' : 'math-opt-wrong');
        if (!correct) {
          opts.forEach(function(o, oi) { if (o.isCorrect) document.querySelectorAll('.math-opt-btn')[oi].classList.add('math-opt-correct'); });
        }
        var fb = document.getElementById('math-q-fb');
        if (fb) fb.innerHTML = '<div style="font-size:16px;color:' + (correct ? '#2E7D32' : '#C62828') + '">' + (correct ? '✅ 掌握了！' : '❌ 复习：' + w.cn + ' —— ' + (w.example || '注意运算顺序/单位')) + '</div>';
        setTimeout(function() {
          if (st.idx < st.words.length - 1) { st.idx++; self._renderMathWrongReview(); }
          else { self._mathWrongFinish(); }
        }, 1500);
      });
    });
  },
  _mathWrongFinish() {
    const st = this._mathWrongReview;
    const correctCount = Object.keys(st.reviewed).filter(k => st.reviewed[k]).length;
    const total = st.words.length;
    const pct = total ? Math.round(st.score / total * 100) : 0;
    const stars = pct >= 90 ? 3 : pct >= 60 ? 2 : 1;
    this._saveMathModeProgress('wrong', stars);
    this._mathWrongReview = null;
    let html = '<div class="math-container"><div class="quiz-summary">';
    html += '<div style="font-size:40px;margin-bottom:10px">' + '⭐'.repeat(stars) + '☆'.repeat(3 - stars) + '</div>';
    html += '<div style="font-size:22px;font-weight:700;color:#E57373">纠正 ' + st.score + ' / ' + total + ' (' + pct + '%)</div>';
    html += '<div style="font-size:16px;color:#888;margin-top:6px">' + (pct >= 90 ? '错题全搞定！' : pct >= 60 ? '大部分搞懂了，剩下再巩固' : '建议再练一遍') + '</div>';
    html += '<button class="continue-btn" style="margin-top:20px" onclick="App.renderMathDailyModes()">返回菜单</button>';
    html += '</div></div>';
    document.getElementById('main-content').innerHTML = html;
  },

  // 🎯 闯关挑战
  startMathChallenge() {
    const words = this._getMathDailyWords();
    if (!words.length) { this.renderMathDailyModes(); return; }
    // 闯关配置：题量、时间限制、连胜奖励
    const config = { total: Math.min(words.length, 15), timePerQ: 15, streakBonus: 2 };
    const shuffled = words.slice().sort(() => Math.random() - 0.5).slice(0, config.total);
    this.activeSessionId = Storage.startSession('mathChallenge', 0, '每天必练·数学·闯关挑战', '', { subject: 'math', totalItems: shuffled.length });
    this._mathChallenge = {
      config: config,
      words: shuffled,
      idx: 0,
      score: 0,
      streak: 0,
      maxStreak: 0,
      timeLeft: config.timePerQ,
      timer: null,
      answered: false
    };
    this._renderMathChallenge();
  },
  _renderMathChallenge() {
    const ch = this._mathChallenge;
    const w = ch.words[ch.idx];
    const item = this._mathChallengeItem(w, ch.words);
    ch.curItem = item;
    const total = ch.words.length;
    let html = '<div class="math-container">';
    html += '<button class="back-btn" onclick="App._mathChallengeCleanup();App.renderMathDailyModes()">← 返回数学作业</button>';
    html += '<h2 class="course-title">🎯 闯关挑战</h2>';
    html += '<div style="display:flex;justify-content:space-between;margin:8px 0;font-size:13px;color:var(--text-light)">';
    html += '<span>第 ' + (ch.idx + 1) + ' / ' + total + ' 题</span>';
    html += '<span style="color:#FF9800">⏱ <span id="math-ch-time">' + ch.timeLeft + '</span>s</span>';
    html += '<span style="color:#E57373">🔥 连胜 <span id="math-ch-streak">' + ch.streak + '</span></span>';
    html += '</div>';
    html += '<div class="math-progress-bar" style="margin:4px 0;height:5px;background:#FFF3E0;border-radius:3px;overflow:hidden"><div id="math-ch-progress" style="width:' + Math.round((ch.idx)/total*100) + '%;height:100%;background:#FF9800;transition:width .3s"></div></div>';
    const opts = item.opts;
    html += '<div class="math-card" style="text-align:center;padding:20px">';
    html += '<div style="font-size:24px;font-weight:700;color:#0D47A1;margin-bottom:16px">' + item.q + '</div>';
    html += '<div style="display:flex;flex-direction:column;gap:10px">';
    opts.forEach((o, i) => { html += '<button class="math-opt-btn" data-idx="' + i + '">' + o.label + '</button>'; });
    html += '</div>';
    html += '<div id="math-q-fb" style="margin-top:14px;min-height:30px"></div>';
    html += '</div></div>';
    document.getElementById('main-content').innerHTML = html;
    this._mathChallengeStartTimer();
    var self = this;
    document.querySelectorAll('.math-opt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (ch.answered) return;
        ch.answered = true;
        clearInterval(ch.timer);
        const idx = parseInt(btn.dataset.idx);
        const correct = opts[idx].isCorrect;
        if (correct) {
          ch.score += 1 + ch.streak * ch.config.streakBonus;
          ch.streak++; ch.maxStreak = Math.max(ch.maxStreak, ch.streak);
        } else { ch.streak = 0; }
        btn.classList.add(correct ? 'math-opt-correct' : 'math-opt-wrong');
        if (!correct) opts.forEach((o, oi) => { if (o.isCorrect) document.querySelectorAll('.math-opt-btn')[oi].classList.add('math-opt-correct'); });
        const fb = document.getElementById('math-q-fb');
        if (fb) fb.innerHTML = '<div style="font-size:16px;color:' + (correct ? '#2E7D32' : '#C62828') + '">' + (correct ? '✅ +' + (1 + (ch.streak-1)*ch.config.streakBonus) + '分  连胜 ' + ch.streak : '❌ 正确答案：' + this._h(item.ans) + '  连胜归零') + '</div>';
        setTimeout(() => {
          ch.answered = false;
          if (ch.idx < total - 1) { ch.idx++; self._renderMathChallenge(); }
          else { self._mathChallengeFinish(); }
        }, 1200);
      });
    });
  },
  _mathChallengeStartTimer() {
    const ch = this._mathChallenge;
    ch.timeLeft = ch.config.timePerQ;
    const timeEl = document.getElementById('math-ch-time');
    ch.timer = setInterval(() => {
      ch.timeLeft--;
      if (timeEl) timeEl.textContent = ch.timeLeft;
      const prog = document.getElementById('math-ch-progress');
      if (prog) prog.style.width = Math.round((ch.idx + (1 - ch.timeLeft/ch.config.timePerQ)) / ch.words.length * 100) + '%';
      if (ch.timeLeft <= 0) {
        clearInterval(ch.timer);
        if (!ch.answered) {
          ch.answered = true; ch.streak = 0;
          const fb = document.getElementById('math-q-fb');
          if (fb) fb.innerHTML = '<div style="font-size:16px;color:#C62828">⏰ 时间到！正确答案：' + this._h((ch.curItem && ch.curItem.ans) || ch.words[ch.idx].cn) + '</div>';
          setTimeout(() => { ch.answered = false; if (ch.idx < ch.words.length - 1) { ch.idx++; this._renderMathChallenge(); } else { this._mathChallengeFinish(); } }, 1500);
        }
      }
    }, 1000);
  },
  _mathChallengeFinish() {
    const ch = this._mathChallenge;
    const pct = ch.words.length ? Math.round(ch.score / (ch.words.length * 3) * 100) : 0;
    const stars = pct >= 90 ? 3 : pct >= 60 ? 2 : 1;
    if (this.activeSessionId) {
      Storage.endSession(this.activeSessionId, { correctCount: ch.score, wrongCount: Math.max(0, ch.words.length * 3 - ch.score), totalItems: ch.words.length * 3, accuracy: pct, stars: stars, xp: ch.score });
      this.activeSessionId = null;
      this._autoPushReport();
    }
    this._saveMathModeProgress('challenge', stars);
    this._mathChallengeCleanup();
    let html = '<div class="math-container"><div class="quiz-summary">';
    html += '<div style="font-size:40px;margin-bottom:10px">' + '⭐'.repeat(stars) + '☆'.repeat(3 - stars) + '</div>';
    html += '<div style="font-size:22px;font-weight:700;color:#FF9800">总分 ' + ch.score + '  · 最高连胜 ' + ch.maxStreak + '</div>';
    html += '<div style="font-size:16px;color:#888;margin-top:6px">' + (stars===3?'闯关大师！':stars===2?'表现不错！':'再接再厉！') + '</div>';
    html += '<button class="continue-btn" style="margin-top:20px" onclick="App.renderMathDailyModes()">再战一轮</button>';
    html += '</div></div>';
    document.getElementById('main-content').innerHTML = html;
  },
  _mathChallengeCleanup() {
    if (this._mathChallenge && this._mathChallenge.timer) { clearInterval(this._mathChallenge.timer); this._mathChallenge.timer = null; }
    this._mathChallenge = null;
  },

  _mathCompareFinish() {
    const st = this._mathCmp;
    const total = st.pairs.length;
    const pct = total ? Math.round(st.score / total * 100) : 0;
    const stars = pct >= 90 ? 3 : pct >= 60 ? 2 : 1;
    if (this.activeSessionId) {
      Storage.endSession(this.activeSessionId, { correctCount: st.score, wrongCount: total - st.score, totalItems: total, accuracy: pct, stars: stars, xp: st.score * 5 });
      this.activeSessionId = null;
      this._autoPushReport();
    }
    this._saveMathModeProgress('compare', stars);
    this._mathCmp = null;
    let html = '<div class="math-container"><div class="quiz-summary">';
    html += '<div style="font-size:40px;margin-bottom:10px">' + '⭐'.repeat(stars) + '☆'.repeat(3 - stars) + '</div>';
    html += '<div style="font-size:22px;font-weight:700;color:#4CAF50">正确 ' + st.score + ' / ' + total + ' (' + Math.round(st.score/total*100) + '%)</div>';
    html += '<div style="font-size:16px;color:#888;margin-top:6px">' + (stars===3?'对比高手！':stars===2?'眼力不错！':'再练练分类') + '</div>';
    html += '<button class="continue-btn" style="margin-top:20px" onclick="App.renderMathDailyModes()">再来一组</button>';
    html += '</div></div>';
    document.getElementById('main-content').innerHTML = html;
  },

  _startMathQuiz(title) {
    const words = this._mathQuizWords || this._getMathDailyWords();
    if (!words.length) { this.renderMathDailyModes(); return; }
    const total = Math.min(words.length, 10);
    const shuffled = words.slice().sort(function() { return Math.random() - 0.5; }).slice(0, total);
    this.activeSessionId = Storage.startSession('mathQuiz', 0, '每天必练·数学·' + title, '', { subject: 'math', totalItems: total });
    this._mathQuiz = { title: title, words: shuffled, idx: 0, score: 0, answered: false };
    this._renderMathQuiz();
  },

  _renderMathQuiz() {
    const q = this._mathQuiz;
    const w = q.words[q.idx];
    const item = this._mathChallengeItem(w, q.words);
    q.curItem = item;
    const total = q.words.length;
    const opts = item.opts;
    let html = '<div class="math-container">';
    html += '<button class="back-btn" onclick="App.renderMathDailyModes()">← 返回数学作业</button>';
    html += '<h2 class="course-title">' + q.title + '</h2>';
    html += '<div style="text-align:center;margin:6px 0;font-size:13px;color:var(--text-light)">第 ' + (q.idx + 1) + ' / ' + total + ' 题 · 得分 ' + q.score + '</div>';
    html += '<div class="math-card" style="text-align:center;padding:24px">';
    html += '<div style="font-size:22px;font-weight:700;color:#0D47A1;margin-bottom:16px">' + item.q + '</div>';
    html += '<div style="display:flex;flex-direction:column;gap:10px">';
    opts.forEach(function(o, i) {
      html += '<button class="math-opt-btn" data-idx="' + i + '">' + o.label + '</button>';
    });
    html += '</div>';
    html += '<div id="math-q-fb" style="margin-top:14px;min-height:30px"></div>';
    html += '</div>';
    html += '</div>';
    document.getElementById('main-content').innerHTML = html;
    var self = this;
    document.querySelectorAll('.math-opt-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (q.answered) return;
        q.answered = true;
        var idx = parseInt(btn.dataset.idx);
        var correct = opts[idx].isCorrect;
        if (correct) q.score++;
        btn.classList.add(correct ? 'math-opt-correct' : 'math-opt-wrong');
        if (!correct) {
          opts.forEach(function(o, oi) { if (o.isCorrect) document.querySelectorAll('.math-opt-btn')[oi].classList.add('math-opt-correct'); });
        }
        var fb = document.getElementById('math-q-fb');
        if (fb) fb.innerHTML = '<div style="font-size:16px;color:' + (correct ? '#2E7D32' : '#C62828') + '">' + (correct ? '✅ 正确！' : '❌ 正确答案：' + this._h(item.ans)) + '</div>';
        setTimeout(function() {
          q.answered = false;
          if (q.idx < total - 1) { q.idx++; self._renderMathQuiz(); }
          else { self._renderMathQuizResult(); }
        }, 1200);
      });
    });
  },

  // 按题型生成与题目匹配的候选答案（正确项=ans，干扰项与答案同为一种类型，杜绝"题目与候选答案不匹配"）
  _mathWordKind(w) {
    if (this._mathParseEn(w && w.en)) return /[\u4e00-\u9fff]/.test(String(w && w.cn || '')) ? 'koujue' : 'eqnum';
    return 'concept';
  },
  _mathBuildOpts(ans, allWords, cur) {
    const kind = this._mathWordKind(cur);
    const opts = [{ label: ans, isCorrect: true }];
    const seen = {}; seen[ans] = 1;
    const pool = [];
    allWords.forEach(w => {
      if (w === cur) return;
      if (this._mathWordKind(w) !== kind) return; // 只从同题型词里取干扰项
      let o = null;
      if (kind === 'eqnum') { const e = this._mathParseEn(w.en); o = String(e.result); }
      else if (kind === 'koujue') { o = String(w.cn).trim(); }
      else { o = String(w.cn || '').trim() || String(w.en || '').trim(); }
      if (o && o !== ans && !seen[o]) { seen[o] = 1; pool.push(o); }
    });
    pool.sort(() => Math.random() - 0.5);
    while (opts.length < 4 && pool.length) opts.push({ label: pool.pop(), isCorrect: false });
    const fb = kind === 'eqnum' ? ['1','2','3','4','5','6','7','8','9','10','12','18','24','36','100']
      : kind === 'koujue' ? ['一一得一','二二得四','三三得九','一二得二','一五得五','三七二十一','四四十六','五五二十五']
      : ['长方形','正方形','三角形','圆','1米=100厘米','对边相等四个直角','三个角三条边','1元=10角'];
    for (let i = 0; i < fb.length && opts.length < 4; i++) {
      if (!seen[fb[i]]) { seen[fb[i]] = 1; opts.push({ label: fb[i], isCorrect: false }); }
    }
    return this._shuffleArr(opts);
  },
  // 判定题型并生成匹配的题目/答案/候选项：算式词(含口诀)与概念词分开处理
  _mathChallengeItem(w, allWords) {
    const eq = this._mathParseEn(w.en);
    if (eq) {
      const isKoujue = /[\u4e00-\u9fff]/.test(String(w.cn || ''));
      const q = this._h(eq.a) + ' ' + this._mathOpSym(eq.op) + ' ' + this._h(eq.b) + ' = ?';
      const ans = isKoujue ? String(w.cn || '').trim() : String(eq.result);
      return { q: q, ans: ans, kind: isKoujue ? 'koujue' : 'eqnum', opts: this._mathBuildOpts(ans, allWords, w) };
    }
    const q = this._h(String(w.en || '').trim());
    const ans = String(w.cn || '').trim() || String(w.en || '').trim();
    return { q: q, ans: ans, kind: 'concept', opts: this._mathBuildOpts(ans, allWords, w) };
  },

  _renderMathQuizResult(data) {
    var q = data || this._mathQuiz;
    var pct = Math.round(q.score / q.words.length * 100);
    var stars = pct >= 90 ? 3 : pct >= 60 ? 2 : 1;
    if (this.activeSessionId) {
      Storage.endSession(this.activeSessionId, { correctCount: q.score, wrongCount: q.words.length - q.score, totalItems: q.words.length, accuracy: pct, stars: stars, xp: q.score * 5 });
      this.activeSessionId = null;
      this._autoPushReport();
    }
    var starStr = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
    var html = '<div class="math-container">';
    html += '<button class="back-btn" onclick="App.renderMathDailyModes()">← 返回数学作业</button>';
    html += '<div class="quiz-summary">';
    html += '<div style="font-size:40px;margin-bottom:10px">' + starStr + '</div>';
    html += '<div style="font-size:22px;font-weight:700;color:#1565C0">' + q.score + ' / ' + q.words.length + ' 题正确</div>';
    html += '<div style="font-size:16px;color:#888;margin-top:6px">正确率 ' + pct + '%</div>';
    html += '<button class="continue-btn" style="margin-top:20px" onclick="App.renderMathDailyModes()">再来一轮</button>';
    html += '</div></div>';
    document.getElementById('main-content').innerHTML = html;
  },

  // 🔢 数字规律
  startMathPattern() {
    var words = this._getMathDailyWords();
    if (!words.length) { this.renderMathDailyModes(); return; }
    var patterns = [];
    for (var i = 0; i < words.length && patterns.length < 10; i++) {
      var p = this._genMathPattern(words[i]);
      if (p) patterns.push(p);
    }
    if (!patterns.length) { alert('暂无法生成数字规律题'); this.renderMathDailyModes(); return; }
    this.activeSessionId = Storage.startSession('mathPattern', 0, '每天必练·数学·数字规律', '', { subject: 'math', totalItems: patterns.length });
    this._mathPattern = { patterns: patterns, idx: 0, score: 0, answered: false };
    this._renderMathPattern();
  },
  _genMathPattern(w) {
    var en = String(w.en || '');
    var nums = en.match(/\d+/g);
    if (!nums || nums.length < 2) return null;
    var n = nums.map(Number);
    var type = Math.random();
    var label = n.join(', ');
    if (type < 0.35) { // 等差数列
      var diff = n[1] - n[0];
      var valid = n.every((v, i) => i===0 || v - n[i-1] === diff);
      if (!valid) return null;
      var answer = n[n.length-1] + n[1] - n[0];
      return { type: 'arithmetic', label: n.join(', '), answer: answer, hint: '等差数列，公差 ' + (n[1]-n[0]), cn: w.cn };
    } else if (type < 0.55) { // 等比数列
      if (n[0] === 0) return null;
      var ratio = n[1] / n[0];
      var valid = n.every((v, i) => i===0 || Math.abs(v - n[i-1]*ratio) < 0.01);
      if (!valid || ratio === 1) return null;
      var answer = Math.round(n[n.length-1] * ratio);
      return { type: 'geometric', label: n.join(', '), answer: answer, hint: '等比数列，公比 ' + ratio, cn: w.cn };
    } else if (type < 0.7) { // 二阶等差/平方数
      if (n.length < 3) return null;
      var d1 = n[1]-n[0], d2 = n[2]-n[1];
      if (d2-d1 !== d2-d1) return null;
      var diff2 = d2 - d1;
      var answer = n[n.length-1] + (n[n.length-1]-n[n.length-2]) + diff2;
      return { type: 'quadratic', label: n.join(', '), answer: answer, hint: '二阶等差/平方规律', cn: w.cn };
    } else { // 交替/混合
      if (n.length < 4) return null;
      var odd = n.filter((v,i)=>i%2===0), even = n.filter((v,i)=>i%2===1);
      var diffOdd = odd.length>1?odd[1]-odd[0]:0, diffEven = even.length>1?even[1]-even[0]:0;
      var next = n.length%2===0 ? n[n.length-1]+diffOdd : n[n.length-1]+diffEven;
      return { type: 'alternating', label: n.join(', '), answer: next, hint: '奇偶位分别递增', cn: w.cn };
    }
  },

  _renderMathPattern() {
    var st = this._mathPattern;
    var p = st.patterns[st.idx];
    var total = st.patterns.length;
    var wrongAnswers = [p.answer + 1, p.answer - 2, p.answer + 3];
    var opts = [{ v: p.answer, ok: true }];
    wrongAnswers.forEach(function(v) { opts.push({ v: v, ok: false }); });
    opts.sort(function() { return Math.random() - 0.5; });
    var html = '<div class="math-container">';
    html += '<button class="back-btn" onclick="App.renderMathDailyModes()">← 返回数学作业</button>';
    html += '<h2 class="course-title">🔢 数字规律</h2>';
    html += '<div style="text-align:center;margin:6px 0;font-size:13px;color:var(--text-light)">第 ' + (st.idx + 1) + ' / ' + total + ' 题 · 得分 ' + st.score + '</div>';
    html += '<div class="math-card" style="text-align:center;padding:24px">';
    html += '<div style="font-size:20px;color:#555;margin-bottom:6px">找规律，下一个数是？</div>';
    html += '<div style="font-size:28px;font-weight:700;color:#0D47A1;margin-bottom:16px;letter-spacing:4px">' + p.label + ', <span style="color:#E65100">?</span></div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center">';
    opts.forEach(function(o, i) {
      html += '<button class="math-opt-btn math-opt-sm" data-idx="' + i + '">' + o.v + '</button>';
    });
    html += '</div>';
    html += '<div id="math-q-fb" style="margin-top:14px;min-height:30px"></div>';
    html += '</div></div>';
    document.getElementById('main-content').innerHTML = html;
    var self = this;
    document.querySelectorAll('.math-opt-sm').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (st.answered) return;
        st.answered = true;
        var idx = parseInt(btn.dataset.idx);
        var ok = opts[idx].ok;
        if (ok) st.score++;
        btn.classList.add(ok ? 'math-opt-correct' : 'math-opt-wrong');
        if (!ok) {
          opts.forEach(function(o, oi) { if (o.ok) document.querySelectorAll('.math-opt-sm')[oi].classList.add('math-opt-correct'); });
        }
        var fb = document.getElementById('math-q-fb');
        if (fb) fb.innerHTML = '<div style="font-size:16px;color:' + (ok ? '#2E7D32' : '#C62828') + '">' + (ok ? '✅ 正确！' : '❌ 答案：' + p.answer) + '</div>';
        setTimeout(function() {
          st.answered = false;
          if (st.idx < total - 1) { st.idx++; self._renderMathPattern(); }
          else { self._renderMathQuizResult.call(self, { score: st.score, words: st.patterns }); }
        }, 1200);
      });
    });
  },

  // 🧩 对比辨析
  startMathCompare() {
    var words = this._getMathDailyWords();
    if (words.length < 2) { alert('至少需要2个知识点才能对比'); this.renderMathDailyModes(); return; }
    var self = this;
    var pairs = [];
    // 只对比算式词：乘除vs加减 →"哪个是乘除法"；得数不同 →"哪个得数更大"。二者都满足时优先乘除判定。
    // 不引入概念词对比（无一致判据），从根源上保证"题目与候选答案匹配"。
    for (var i = 0; i < words.length - 1 && pairs.length < 10; i++) {
      for (var j = i + 1; j < words.length && pairs.length < 10; j++) {
        var a = words[i], b = words[j];
        var ea = self._mathParseEn(a.en), eb = self._mathParseEn(b.en);
        if (!ea || !eb) continue;
        var aMul = ea.op === '×' || ea.op === '÷';
        var bMul = eb.op === '×' || eb.op === '÷';
        if (aMul !== bMul) {
          pairs.push({ q: '下面哪个算式是<strong>乘除法</strong>？', a: a, b: b, correct: aMul ? 0 : 1, labelA: self._h(self._mathDisp(a.en)), labelB: self._h(self._mathDisp(b.en)) });
        } else if (ea.result !== eb.result) {
          pairs.push({ q: '下面哪个算式的<strong>得数更大</strong>？', a: a, b: b, correct: ea.result > eb.result ? 0 : 1, labelA: self._h(self._mathDisp(a.en)), labelB: self._h(self._mathDisp(b.en)) });
        }
      }
    }
    if (!pairs.length) { alert('本次暂无可对比的口算题，换个作业再试试'); this.renderMathDailyModes(); return; }
    pairs = pairs.sort(function() { return Math.random() - 0.5; }).slice(0, 10);
    this.activeSessionId = Storage.startSession('mathCompare', 0, '每天必练·数学·对比辨析', '', { subject: 'math', totalItems: pairs.length });
    this._mathCmp = { pairs: pairs, idx: 0, score: 0, answered: false };
    this._renderMathCompare();
  },
  _renderMathCompare() {
    var st = this._mathCmp;
    var pair = st.pairs[st.idx];
    var question = pair.q, correctIdx = pair.correct;
    var optA = pair.labelA, optB = pair.labelB;
    var total = st.pairs.length;
    var html = '<div class="math-container">';
    html += '<button class="back-btn" onclick="App.renderMathDailyModes()">← 返回数学作业</button>';
    html += '<h2 class="course-title">🧩 对比辨析</h2>';
    html += '<div style="text-align:center;margin:6px 0;font-size:13px;color:var(--text-light)">第 ' + (st.idx + 1) + ' / ' + total + ' 题 · 得分 ' + st.score + '</div>';
    html += '<div class="math-card" style="text-align:center;padding:24px">';
    html += '<div style="font-size:18px;color:#4CAF50;margin-bottom:14px">' + question + '</div>';
    html += '<div style="display:flex;flex-direction:column;gap:10px">';
    html += '<button class="math-opt-btn" data-ci="0">' + optA + '</button>';
    html += '<button class="math-opt-btn" data-ci="1">' + optB + '</button>';
    html += '</div>';
    html += '<div id="math-q-fb" style="margin-top:14px;min-height:30px"></div>';
    html += '</div></div>';
    document.getElementById('main-content').innerHTML = html;
    var self = this;
    document.querySelectorAll('.math-opt-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (st.answered) return;
        st.answered = true;
        var ci = parseInt(btn.dataset.ci);
        var ok = ci === correctIdx;
        if (ok) st.score++;
        btn.classList.add(ok ? 'math-opt-correct' : 'math-opt-wrong');
        if (!ok) document.querySelectorAll('.math-opt-btn')[correctIdx].classList.add('math-opt-correct');
        var fb = document.getElementById('math-q-fb');
        if (fb) fb.innerHTML = '<div style="font-size:16px;color:' + (ok ? '#2E7D32' : '#C62828') + '">' + (ok ? '✅ 正确！' : '❌ 选错啦，注意区分') + '</div>';
        setTimeout(function() {
          st.answered = false;
          if (st.idx < st.pairs.length - 1) { st.idx++; self._renderMathCompare(); }
          else { self._mathCompareFinish(); }
        }, 1200);
      });
    });
  },

  // ===== 数学引擎（20260828 全新：课程练习可作答 / 每天必练口算速练 / 口诀可作答）=====
  // 数学表达式/口诀本地音频索引（key=中文读法或口诀，值N → sounds/sentences/N.ogg，生成脚本填充）
  _zhMathIdx: {
    '正确':4001,
    '错误':4002,
    '一一得一':4003,
    '一七得七':4004,
    '一三得三':4005,
    '一九得九':4006,
    '一二得二':4007,
    '一五得五':4008,
    '一八得八':4009,
    '一六得六':4010,
    '一四得四':4011,
    '三三得九':4012,
    '三五十五':4013,
    '三六十八':4014,
    '三四十二':4015,
    '二七十四':4016,
    '二三得六':4017,
    '二九十八':4018,
    '二二得四':4019,
    '二五一十':4020,
    '二八十六':4021,
    '二六十二':4022,
    '二四得八':4023,
    '五八四十':4024,
    '五六三十':4025,
    '商3余1':4026,
    '四五二十':4027,
    '四四十六':4028,
    '七七四十九':4029,
    '七九六十三':4030,
    '七八五十六':4031,
    '三七二十一':4032,
    '三九二十七':4033,
    '三八二十四':4034,
    '不进位加法':4035,
    '不退位减法':4036,
    '九九八十一':4037,
    '五七三十五':4038,
    '五九四十五':4039,
    '五五二十五':4040,
    '八九七十二':4041,
    '八八六十四':4042,
    '六七四十二':4043,
    '六九五十四':4044,
    '六八四十八':4045,
    '六六三十六':4046,
    '四七二十八':4047,
    '四九三十六':4048,
    '四八三十二':4049,
    '四六二十四':4050,
    '小数减小数':4051,
    '小数加小数':4052,
    '整十数相加':4053,
    '一乘一等于一':4054,
    '一乘七等于七':4055,
    '一乘三等于三':4056,
    '一乘九等于九':4057,
    '一乘二等于二':4058,
    '一乘五等于五':4059,
    '一乘八等于八':4060,
    '一乘六等于六':4061,
    '一乘四等于四':4062,
    '一加一等于二':4063,
    '一加七等于八':4064,
    '一加三等于四':4065,
    '一加九等于十':4066,
    '一加二等于三':4067,
    '一加五等于六':4068,
    '一加八等于九':4069,
    '一加六等于七':4070,
    '一加四等于五':4071,
    '七减二等于五':4072,
    '三乘三等于九':4073,
    '三减一等于二':4074,
    '三减二等于一':4075,
    '三加一等于四':4076,
    '三加三等于六':4077,
    '三加二等于五':4078,
    '三加五等于八':4079,
    '九减三等于六':4080,
    '二乘三等于六':4081,
    '二乘二等于四':4082,
    '二乘五等于十':4083,
    '二乘四等于八':4084,
    '二减一等于一':4085,
    '二加一等于三':4086,
    '二加三等于五':4087,
    '二加二等于四':4088,
    '二加八等于十':4089,
    '二加四等于六':4090,
    '五减一等于四':4091,
    '五减三等于二':4092,
    '五减二等于三':4093,
    '八减四等于四':4094,
    '十减一等于九':4095,
    '十减二等于八':4096,
    '四减一等于三':4097,
    '四减二等于二':4098,
    '四加一等于五':4099,
    '常用凑整组合':4100,
    '三乘五等于十五':4101,
    '三乘六等于十八':4102,
    '三乘四等于十二':4103,
    '三十乘五等于六':4104,
    '两位数乘整十数':4105,
    '二乘七等于十四':4106,
    '二乘九等于十八':4107,
    '二乘八等于十六':4108,
    '二乘六等于十二':4109,
    '五乘八等于四十':4110,
    '五乘六等于三十':4111,
    '五加六等于十一':4112,
    '六乘五等于三十':4113,
    '十一减七等于四':4114,
    '十一减九等于二':4115,
    '十一减五等于六':4116,
    '十一减六等于五':4117,
    '十一减四等于七':4118,
    '十三乘四等于三':4119,
    '十三减三等于十':4120,
    '十三减九等于四':4121,
    '十三减六等于七':4122,
    '十二乘三等于四':4123,
    '十二减七等于五':4124,
    '十二减九等于三':4125,
    '十二减二等于十':4126,
    '十二减八等于四':4127,
    '十五乘五等于三':4128,
    '十五减九等于六':4129,
    '十八乘二等于九':4130,
    '十八减九等于九':4131,
    '十六减九等于七':4132,
    '十四减九等于五':4133,
    '十四减八等于六':4134,
    '四乘五等于二十':4135,
    '四乘四等于十六':4136,
    '四加八等于十二':4137,
    '整十数乘整十数':4138,
    '七乘七等于四十九':4139,
    '七乘九等于六十三':4140,
    '七乘八等于五十六':4141,
    '三乘七等于二十一':4142,
    '三乘九等于二十七':4143,
    '三乘八等于二十四':4144,
    '三五十五所以商3':4145,
    '三四十二所以商4':4146,
    '个位相减十位不变':4147,
    '个位相加十位不变':4148,
    '九乘九等于八十一':4149,
    '二九十八所以商9':4150,
    '二十八乘四等于七':4151,
    '二十四乘六等于四':4152,
    '五乘七等于三十五':4153,
    '五乘九等于四十五':4154,
    '五乘五等于二十五':4155,
    '五六三十所以商6':4156,
    '八乘九等于七十二':4157,
    '八乘八等于六十四':4158,
    '八十乘四等于二十':4159,
    '六乘七等于四十二':4160,
    '六乘九等于五十四':4161,
    '六乘八等于四十八':4162,
    '六乘六等于三十六':4163,
    '六十乘三等于二十':4164,
    '六百乘三等于二百':4165,
    '十八减七等于十一':4166,
    '四乘七等于二十八':4167,
    '四乘九等于三十六':4168,
    '四乘八等于三十二':4169,
    '四乘六等于二十四':4170,
    '整十数除以一位数':4171,
    '整百数除以一位数':4172,
    '三十加二十等于五十':4173,
    '个位满十向十位进一':4174,
    '二十乘三十等于六百':4175,
    '二十五乘四等于一百':4176,
    '五十减三十等于二十':4177,
    '十加十二等于二十二':4178,
    '四七二十八所以商7':4179,
    '四六二十四所以商4':4180,
    '四十加三十等于七十':4181,
    '三十五加三等于三十八':4182,
    '三十五加八等于四十三':4183,
    '三十六减三等于三十三':4184,
    '三十六减八等于二十八':4185,
    '个位不够减从十位借一':4186,
    '五十七减四等于五十三':4187,
    '十二乘十等于一百二十':4188,
    '四十二加六等于四十八':4189,
    '一百二十五乘八等于一千':4190,
    '3.2加1.5等于4.7':4191,
    '3个十加2个十等于5个十':4192,
    '5.6减2.3等于3.3':4193,
    '5个十减3个十等于2个十':4194,
    '十四乘十二等于一百六十八':4195,
  },
  // 解析 en 为纯算式：'数字 op 数字 = 数字' → {a,op,b,result}；否则 null（概念/公式词）
  _mathParseEn(en) {
    const s = String(en || '').replace(/…….*$/, '').replace(/\s+/g, '');
    const m = /^(-?\d+(?:\.\d+)?)([+\-×÷÷xX*])(-?\d+(?:\.\d+)?)=(-?\d+(?:\.\d+)?)$/.exec(s);
    if (!m) return null;
    let op = m[2];
    if (op === '÷' || op === 'x' || op === 'X' || op === '*') op = '×';
    return { a: parseFloat(m[1]), op: op, b: parseFloat(m[3]), result: parseFloat(m[4]) };
  },
  // 宽松解析口算题：'数字 op 数字'、'数字 op 数字='、'数字 op 数字=数字/？' 均接受（口算作业整卷 + 批阅补全算式用）
  _mathOpenEq(en, answer) {
    const s = String(en || '').replace(/…….*$/, '').replace(/\s+/g, '');
    const m = /^(-?\d+(?:\.\d+)?)([+\-×÷xX*])(-?\d+(?:\.\d+)?)(?:=(.*))?$/.exec(s);
    if (!m) return null;
    let op = m[2];
    if (op === '÷' || op === 'x' || op === 'X' || op === '*') op = '×';
    const a = parseFloat(m[1]);
    const b = parseFloat(m[3]);
    let result = NaN;
    if (m[4] !== undefined && String(m[4]).trim() !== '') {
      const r = String(m[4]).trim().replace(/[?？]+$/, '');
      if (/^-?\d+(?:\.\d+)?$/.test(r)) result = parseFloat(r);
    }
    if (isNaN(result) && answer != null && String(answer).trim() !== '') {
      const ra = String(answer).trim().replace(/[?？]+$/, '');
      if (/^-?\d+(?:\.\d+)?$/.test(ra)) result = parseFloat(ra);
    }
    if (isNaN(result)) {
      result = this._mathCalc(a, op, b);
      if (isFinite(result)) result = Math.round(result * 1000) / 1000;
    }
    if (isNaN(result)) return null;
    return { a: a, op: op, b: b, result: result };
  },
  // 是否可当口算/填空的算式词（en 解析成功）
  _mathIsEquation(w) { return this._mathParseEn(w && w.en) != null; },
  // 是否口诀词（en 是算式，cn 是中文口诀）
  _mathIsKoujue(w) {
    const eq = this._mathParseEn(w && w.en);
    const cn = String(w && w.cn || '');
    return eq != null && /[\u4e00-\u9fff]/.test(cn);
  },
  // 把运算符号转中文（用于朗读与提示）
  _mathOpZh(op) {
    if (op === '+') return '加';
    if (op === '-') return '减';
    if (op === '×') return '乘';
    if (op === '÷') return '除以';
    return op;
  },
  _mathOpSym(op) {
    if (op === 'x' || op === 'X' || op === '*') return '×';
    if (op === '+' || op === '-' || op === '×' || op === '÷') return String(op);
    return String(op || '');
  },
  _mathDisp(s) {
    return String(s || '').replace(/[xX*]/g, '×');
  },
  // 数字转中文读音（用于朗读结果/算式，如 5→五、12→十二、100→一百）
  _mathNumCn(n) {
    const s = String(n);
    if (/\./.test(s)) return s; // 小数直接读数字
    const neg = n < 0;
    const v = Math.abs(n);
    const d0 = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const r1 = ['', '十', '百', '千'];
    let out = '';
    if (v === 0) out = '零';
    else {
      const digs = String(v).split('').map(d => parseInt(d, 10));
      const len = digs.length;
      let zero = false;
      for (let i = 0; i < len; i++) {
        const d = digs[i];
        const place = len - i - 1;
        if (d === 0) { zero = true; continue; }
        if (zero && out) { out += '零'; }
        zero = false;
        if (place === 1 && d === 1 && !out) out = '十'; // 十几、10-19
        else out += d0[d] + r1[place];
      }
    }
    return (neg ? '负' : '') + out;
  },
  // 算式中文读法：如 3+5=8 → "三加五等于八"；1×5=5 → "一乘五等于五"
  _mathExprZh(eq) {
    return this._mathNumCn(eq.a) + this._mathOpZh(eq.op) + this._mathNumCn(eq.b) + '等于' + this._mathNumCn(eq.result);
  },
  // 读题用（不念答案）：如 1×7=? → "一乘七等于多少"（填空/口算读题，避免泄题）
  _mathExprZhQ(eq) {
    return this._mathNumCn(eq.a) + this._mathOpZh(eq.op) + this._mathNumCn(eq.b) + '等于多少';
  },
  // 从数学词/兜底集生成口算题（返回 {a,op,b,result,阶})
  _mathGenArith(pool, limit) {
    const out = [];
    const seen = {};
    const push = (eq) => {
      const key = eq.a + eq.op + eq.b + '=' + eq.result;
      if (seen[key]) return;
      seen[key] = 1;
      out.push(eq);
    };
    (pool || []).forEach(w => {
      const eq = this._mathParseEn(w.en);
      if (eq) push(eq);
    });
    // 未达数量用基础四则模板补齐（覆盖口算速练无算式词的情形）
    const fallback = [
      { a: 3, op: '+', b: 5 }, { a: 7, op: '-', b: 2 }, { a: 4, op: '+', b: 8 },
      { a: 2, op: '×', b: 4 }, { a: 9, op: '-', b: 3 }, { a: 6, op: '×', b: 5 },
      { a: 10, op: '+', b: 12 }, { a: 18, op: '-', b: 7 }, { a: 3, op: '×', b: 7 },
      { a: 5, op: '+', b: 6 }, { a: 8, op: '-', b: 4 }, { a: 4, op: '×', b: 6 }
    ];
    for (let i = 0; i < fallback.length && out.length < (limit || 8); i++) {
      const f = fallback[i];
      const r = this._mathCalc(f.a, f.op, f.b);
      push({ a: f.a, op: f.op, b: f.b, result: r });
    }
    return out.slice(0, limit || 8);
  },
  _mathCalc(a, op, b) {
    if (op === '+') return a + b;
    if (op === '-') return a - b;
    if (op === '×') return a * b;
    if (op === '÷') return b === 0 ? NaN : a / b;
    return NaN;
  },

  // ---- 问题4：课程练习（数学单元 ✏️ 练习 → 填空输入答案）----
  startMathLesson(unitId) {
    let words = this.getUnitWords(unitId);
    if (!words.length) { this.renderGrades(); return; }
    this.currentView = 'math-course-lesson';
    this.currentUnitId = unitId;
    const ui = this.getUnitInfo(unitId);
    this.activeSessionId = Storage.startSession('mathKnowledge', unitId, ui.unitTitle, ui.gradeTitle, { subject: 'math', totalItems: words.length });
    this._mathLesson = { words: words, idx: 0, score: 0, total: words.length, answered: false };
    this._renderMathLesson();
    this.updateTopBar();
  },
  _buildMathLessonEx(w) {
    // 纯算式词 → 填空题（a op b = ___ 输入结果）
    const eq = this._mathParseEn(w.en);
    if (eq) {
      return { type: 'fill', eq: eq, word: w, equation: String(w.en), lang: 'eq' };
    }
    // 概念词 → 四选一：给出定义(cn)选正确概念(en)
    const cn = String(w.cn || '').trim();
    const en = String(w.en || '').trim();
    return { type: 'concept', word: w, label: cn || en, answer: en || cn };
  },
  _renderMathLesson() {
    const st = this._mathLesson;
    const w = st.words[st.idx];
    const ex = this._buildMathLessonEx(w);
    const eq = ex.eq;
    // 填空题读题不念答案（如 1×7=? 读"一乘七等于多少"，避免泄题）；概念读法照旧
    const sounds = eq ? (ex.type === 'fill' ? this._mathExprZhQ(eq) : this._mathExprZh(eq)) : String(w.cn || w.en || '');
    const main = document.getElementById('main-content');
    let html = '<div class="math-container">';
    html += '<button class="back-btn" onclick="App.exitToUnit()">← 返回上一级</button>';
    html += '<h2 class="course-title">✏️ 数学练习</h2>';
    html += '<div style="text-align:center;margin:8px 0;font-size:13px;color:var(--text-light)">第 ' + (st.idx + 1) + ' / ' + st.total + ' 题 · 答对 ' + st.score + '</div>';
    html += '<button class="login-btn" id="math-lesson-speak" style="display:block;margin:0 auto 14px">🔊 读题</button>';
    if (ex.type === 'fill') {
      const opsym = this._mathOpSym(eq.op);
      html += '<div class="math-card" style="padding:30px;text-align:center">';
      html += '<div style="font-size:44px;font-weight:700;color:#0D47A1;letter-spacing:4px">' + this._h(eq.a) + ' ' + opsym + ' ' + this._h(eq.b) + ' = <span id="ml-ans">?</span></div>';
      html += '<div style="margin-top:16px;font-size:14px;color:#666">请填写答案</div>';
      html += '<input type="number" id="math-fill-input" class="fill-input" style="font-size:28px;text-align:center;width:140px" placeholder="?" ' + (st.answered ? 'disabled' : '') + '>';
      html += '</div>';
      html += '<button class="submit-btn" id="math-fill-submit" ' + (st.answered ? 'disabled' : '') + '>确认</button>';
      html += '<div id="math-lesson-fb" style="margin-top:14px;min-height:24px"></div>';
    } else {
      // 概念词：四选一
      const opts = this._mathConceptOptions(st.words, st.idx);
      html += '<div class="question-text" style="text-align:center;font-size:26px;font-weight:700;color:#1565C0;margin:20px 0">' + this._h(ex.label) + '</div>';
      html += '<div style="font-size:14px;color:#666;text-align:center;margin-bottom:16px">' + (ex.answer === ex.label ? '选出对应的概念：' : '选出对应的含义：') + '</div>';
      html += '<div class="options-grid">' + opts.map((o, i) => '<button class="option-btn" data-oi="' + i + '"' + (st.answered ? ' disabled' : '') + '>' + this._h(o) + '</button>').join('') + '</div>';
      html += '<div id="math-lesson-fb" style="margin-top:14px;min-height:24px"></div>';
    }
    html += '<div style="display:flex;gap:10px;margin-top:20px">';
    html += '<button class="admin-gen-btn" id="math-lesson-prev" style="flex:1"' + (st.idx === 0 ? ' disabled' : '') + '>◀ 上一题</button>';
    html += '<button class="admin-gen-btn" id="math-lesson-next" style="flex:1"' + (st.answered ? '' : ' disabled') + '>下一题 ▶</button>';
    html += '</div></div>';
    main.innerHTML = html;

    const spk = document.getElementById('math-lesson-speak');
    if (spk) spk.addEventListener('click', () => { this.speakChinese(sounds); });

    if (ex.type === 'fill') {
      const input = document.getElementById('math-fill-input');
      const submit = document.getElementById('math-fill-submit');
      const judge = () => {
        if (st.answered) return;
        const val = parseFloat(input.value);
        if (isNaN(val)) { const fb = document.getElementById('math-lesson-fb'); if (fb) fb.innerHTML = '<div style="color:#C62828;text-align:center">请输入数字</div>'; return; }
        st.answered = true;
        const ok = Math.abs(val - eq.result) < 0.001;
        if (ok) st.score++;
        input.disabled = true; submit.disabled = true;
        const fb = document.getElementById('math-lesson-fb');
        if (fb) fb.innerHTML = '<div style="font-size:17px;text-align:center;color:' + (ok ? '#2E7D32' : '#C62828') + '">' + (ok ? '✅ 正确！' : '❌ 正确答案是 ' + this._h(eq.result)) + '</div>';
        this._mathLessonJudgeResult(ex, w, ok);
        document.getElementById('math-lesson-next').disabled = false;
        this.speakChinese(ok ? '正确' : this._mathExprZh(eq));
      };
      submit.addEventListener('click', judge);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') judge(); });
      this._exT(() => this.speakChinese(sounds), 400);
    } else {
      let correctIdx = -1;
      const opts = this._mathConceptOptions(st.words, st.idx);
      const ans = ex.answer;
      correctIdx = opts.indexOf(ans);
      document.querySelectorAll('.option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (st.answered) return;
          st.answered = true;
          const oi = parseInt(btn.dataset.oi);
          const ok = oi === correctIdx;
          if (ok) st.score++;
          btn.classList.add(ok ? 'math-opt-correct' : 'math-opt-wrong');
          if (!ok) document.querySelectorAll('.option-btn')[correctIdx].classList.add('math-opt-correct');
          this._mathLessonJudgeResult(ex, w, ok);
          document.getElementById('math-lesson-next').disabled = false;
        });
      });
    }
    const prevBtn = document.getElementById('math-lesson-prev');
    if (prevBtn) prevBtn.addEventListener('click', () => {
      if (st.idx > 0) { st.idx--; st.answered = false; this._renderMathLesson(); }
    });
    const nextBtn = document.getElementById('math-lesson-next');
    if (nextBtn) nextBtn.addEventListener('click', () => { this._mathLessonNext(); });
    this.updateTopBar();
  },
  _mathConceptOptions(words, idx) {
    const cur = words[idx];
    const ans = String(cur.en || '').trim() || String(cur.cn || '').trim();
    const opts = [ans];
    const seen = {};
    seen[ans] = 1;
    for (let i = 0; i < words.length && opts.length < 4; i++) {
      if (i === idx) continue;
      const o = String(words[i].en || '').trim() || String(words[i].cn || '').trim();
      if (o && o !== ans && !seen[o]) { seen[o] = 1; opts.push(o); }
    }
    const fb = ['长方形', '正方形', '三角形', '圆', '1米=100厘米', '1元=10角', '50', '100', '24'];
    for (let i = 0; i < fb.length && opts.length < 4; i++) {
      if (!seen[fb[i]]) { seen[fb[i]] = 1; opts.push(fb[i]); }
    }
    return this._shuffleArr(opts);
  },
  _shuffleArr(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
  _mathLessonJudgeResult(ex, w, ok) {
    if (ok) return;
    try {
      Storage.addWrongWord(String(w.en || ''), String(w.cn || ''), this.currentUnitId || 0, '数学练习', 'math');
    } catch (e) {}
  },
  _mathLessonNext() {
    const st = this._mathLesson;
    if (!st) return;
    st.answered = false;
    if (st.idx < st.total - 1) { st.idx++; this._renderMathLesson(); return; }
    // 完成 → 出结算
    const total = st.total;
    const score = st.score;
    const pct = total ? Math.round(score / total * 100) : 0;
    const stars = pct >= 90 ? 3 : pct >= 60 ? 2 : 1;
    if (this.activeSessionId) {
      Storage.endSession(this.activeSessionId, { correctCount: score, wrongCount: total - score, totalItems: total, accuracy: pct, stars: stars, xp: score * 5 });
      this.activeSessionId = null;
      this._autoPushReport();
    }
    const unit = this.getUnitInfo(this.currentUnitId);
    if (unit && unit.unitId) {
      try { Storage.markLessonComplete(this.currentUnitId, stars); } catch (e) {}
    }
    let html = '<div class="math-container" style="text-align:center;padding:40px 20px">';
    html += '<button class="back-btn" onclick="App.exitToUnit()">← 返回上一级</button>';
    html += '<div style="font-size:52px">' + (pct >= 90 ? '🏆' : (pct >= 60 ? '👍' : '💪')) + '</div>';
    html += '<h2 style="color:#0D47A1">数学练习完成！</h2>';
    html += '<div style="font-size:20px;margin:16px 0">答对 ' + score + ' / ' + total + ' 题 · ' + pct + '%</div>';
    html += '<div style="font-size:24px;letter-spacing:4px">' + '⭐'.repeat(stars) + '☆'.repeat(3 - stars) + '</div>';
    html += '<button class="continue-btn" style="margin-top:20px" onclick="App.exitToUnit()">继续学习</button>';
    html += '</div>';
    document.getElementById('main-content').innerHTML = html;
    this._mathLesson = null;
  },

  // ---- 问题5：每天必练 口算速练（可作答）----
  startMathOral() {
    const words = this._getMathDailyWords();
    const pool = this._mathGenArith(words, 10);
    this.activeSessionId = Storage.startSession('mathOral', 0, '每天必练·数学·口算速练', '', { subject: 'math', totalItems: pool.length });
    this._mathOral = { qs: pool.slice(0, 10), idx: 0, score: 0, answered: false };
    this._renderMathOral();
  },
  _renderMathOral() {
    const st = this._mathOral;
    const q = st.qs[st.idx];
    const opsym = this._mathOpSym(q.op);
    const main = document.getElementById('main-content');
    let html = '<div class="math-container">';
    html += '<button class="back-btn" onclick="App._mathOralCleanup();App.renderMathDailyModes()">← 返回数学作业</button>';
    html += '<h2 class="course-title">🧮 口算速练</h2>';
    html += '<div style="text-align:center;margin:8px 0;font-size:13px;color:var(--text-light)">' + (st.idx + 1) + ' / ' + st.qs.length + ' 题 · 答对 ' + st.score + '</div>';
    html += '<button class="login-btn" id="math-oral-speak" style="display:block;margin:0 auto 14px">🔊 读题</button>';
    html += '<div class="math-card" style="padding:30px;text-align:center">';
    html += '<div style="font-size:46px;font-weight:700;color:#0D47A1;letter-spacing:4px">' + this._h(q.a) + ' ' + opsym + ' ' + this._h(q.b) + ' = ?</div>';
    html += '<input type="number" id="math-oral-input" class="fill-input" style="font-size:30px;text-align:center;width:150px;margin-top:12px" placeholder="?" ' + (st.answered ? 'disabled' : '') + '>';
    html += '</div>';
    html += '<button class="submit-btn" id="math-oral-submit" ' + (st.answered ? 'disabled' : '') + '>确认</button>';
    html += '<div id="math-oral-fb" style="margin-top:14px;min-height:24px"></div>';
    html += '<div style="display:flex;gap:10px;margin-top:20px">';
    html += '<button class="admin-gen-btn" id="math-oral-next" style="flex:1"' + (st.answered ? '' : ' disabled') + '>' + (st.idx < st.qs.length - 1 ? '下一题 ▶' : '完成 ✓') + '</button>';
    html += '</div></div>';
    main.innerHTML = html;

    const speakTxt = this._mathExprZhQ(q);
    document.getElementById('math-oral-speak').addEventListener('click', () => this.speakChinese(speakTxt));
    const input = document.getElementById('math-oral-input');
    const submit = document.getElementById('math-oral-submit');
    const judge = () => {
      if (st.answered) return;
      const val = parseFloat(input.value);
      if (isNaN(val)) { const fb = document.getElementById('math-oral-fb'); if (fb) fb.innerHTML = '<div style="color:#C62828;text-align:center">请输入数字</div>'; return; }
      st.answered = true;
      const ok = Math.abs(val - q.result) < 0.001;
      if (ok) st.score++;
      input.disabled = true; submit.disabled = true;
      const fb = document.getElementById('math-oral-fb');
      if (fb) fb.innerHTML = '<div style="font-size:17px;text-align:center;color:' + (ok ? '#2E7D32' : '#C62828') + '">' + (ok ? '✅ 正确！' : '❌ 正确答案是 ' + this._h(q.result)) + '</div>';
      this.speakChinese(ok ? '正确' : this._mathExprZh(q));
      document.getElementById('math-oral-next').disabled = false;
    };
    submit.addEventListener('click', judge);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') judge(); });
    this._exT(() => this.speakChinese(speakTxt), 400);
    document.getElementById('math-oral-next').addEventListener('click', () => {
      if (!st.answered) return;
      st.answered = false;
      if (st.idx < st.qs.length - 1) { st.idx++; this._renderMathOral(); }
      else { this._mathOralCleanup(); this._mathOralFinish(); }
    });
  },
  _mathOralCleanup() { this._mathOral = null; },
  _mathOralFinish() {
    const st = this._mathOral;
    const ok = st ? st.score : 0;
    const total = st ? st.qs.length : 1;
    const pct = total ? Math.round(ok / total * 100) : 0;
    const stars = pct >= 90 ? 3 : (pct >= 60 ? 2 : 1);
    if (this.activeSessionId) {
      try {
        Storage.endSession(this.activeSessionId, { correctCount: ok, wrongCount: total - ok, totalItems: total, accuracy: pct, stars: stars, xp: ok * 5 });
        this.activeSessionId = null;
        this._autoPushReport();
      } catch (e) {}
    }
    this._saveMathModeProgress('oral', stars);
    let html = '<div class="math-container" style="text-align:center;padding:40px 20px">';
    html += '<button class="back-btn" onclick="App.renderMathDailyModes()">← 返回数学作业</button>';
    html += '<div style="font-size:52px">' + (pct >= 90 ? '🏆' : (pct >= 60 ? '👍' : '💪')) + '</div>';
    html += '<h2 style="color:#0D47A1">口算速练完成！</h2>';
    html += '<div style="font-size:20px;margin:16px 0">答对 ' + ok + ' / ' + total + ' 题 · ' + pct + '%</div>';
    html += '<div style="font-size:24px;letter-spacing:4px">' + '⭐'.repeat(stars) + '☆'.repeat(3 - stars) + '</div>';
    html += '</div>';
    document.getElementById('main-content').innerHTML = html;
  },

  // 📝 口算作业：老师手动布置的口算题整卷作答，本地交卷自动判分
  startMathPaper() {
    const words = this._getMathDailyWords();
    const items = [];
    const seen = {};
    (words || []).forEach(w => {
      const eq = this._mathOpenEq(w && w.en);
      if (!eq) return;
      const key = eq.a + '|' + eq.op + '|' + eq.b;
      if (seen[key]) return;
      seen[key] = 1;
      items.push({ en: String(w && w.en || '').trim(), eq: eq, cn: String(w && w.cn || '').trim() });
    });
    if (!items.length) { alert('本次数学作业中没有可计算的口算题，请老师布置算式'); this.renderMathDailyModes(); return; }
    this._mathPaper = { items: items, answers: {}, judged: false, score: 0 };
    this.activeSessionId = Storage.startSession('mathPaper', 0, '每天必练·数学·口算作业', '', { subject: 'math', totalItems: items.length });
    this._renderMathPaper();
  },
  _renderMathPaper() {
    const p = this._mathPaper;
    const main = document.getElementById('main-content');
    let html = '<div class="math-container">';
    html += '<button class="back-btn" onclick="App._mathPaperCleanup();App.renderMathDailyModes()">← 返回数学作业</button>';
    html += '<h2 class="course-title">📝 口算作业</h2>';
    html += '<div style="text-align:center;margin:6px 0;font-size:13px;color:var(--text-light)">共 ' + p.items.length + ' 题 · 直接在下方作答，交卷后自动判分</div>';
    html += '<div style="padding:0 4px">';
    p.items.forEach((it, i) => {
      const eq = it.eq;
      const disp = this._h(eq.a) + ' ' + this._h(this._mathOpSym(eq.op)) + ' ' + this._h(eq.b) + ' = ?';
      const fbR = (p.judged && p.answers[i]) ? '<div style="font-size:15px;color:' + (p.answers[i].correct ? '#2E7D32' : '#C62828') + '">' + (p.answers[i].correct ? '✅ 正确' : '❌ 正确答案 ' + this._h(eq.result)) + '</div>' : '';
      const kept = (p.judged && p.answers[i]) ? this._h(String(p.answers[i].val || '')) : '';
      html += '<div class="math-card" style="padding:14px 16px;margin-bottom:10px">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between">';
      html += '<div style="flex:1;font-size:20px;font-weight:700;color:#0D47A1;letter-spacing:2px">' + (i + 1) + '. ' + disp + '</div>';
      html += '<input type="number" id="mp-in-' + i + '" class="fill-input" style="width:110px;font-size:22px;text-align:center" inputmode="decimal" placeholder="答案" value="' + kept + '"' + (p.judged ? ' disabled' : '') + '>';
      html += '</div>';
      html += '<div id="mp-fb-' + i + '" style="min-height:22px;font-size:14px;margin-top:6px">' + fbR + '</div>';
      html += '</div>';
    });
    html += '</div>';
    html += '<div style="text-align:center;margin-top:10px">';
    if (!p.judged) html += '<button class="submit-btn" id="math-paper-submit" style="width:100%">✔️ 交卷判分</button>';
    else {
      html += '<div style="font-size:20px;color:#0D47A1;margin:8px 0">答对 ' + p.score + ' / ' + p.items.length + ' 题</div>';
      html += '<button class="continue-btn" id="math-paper-done" style="width:100%">完成 · 结算成绩 ✓</button>';
    }
    html += '</div>';
    html += '</div>';
    main.innerHTML = html;

    if (!p.judged) {
      document.getElementById('math-paper-submit').addEventListener('click', () => this._mathPaperJudge());
    } else {
      document.getElementById('math-paper-done').addEventListener('click', () => { this._mathPaperCleanup(); this._mathPaperFinish(); });
    }
    this.updateTopBar();
  },
  _mathPaperJudge() {
    const p = this._mathPaper;
    if (!p || p.judged) return;
    let filled = 0;
    p.items.forEach((it, i) => {
      const inp = document.getElementById('mp-in-' + i);
      if (inp && String(inp.value || '').trim() !== '') filled++;
    });
    let ok = 0;
    p.items.forEach((it, i) => {
      const inp = document.getElementById('mp-in-' + i);
      const val = parseFloat(inp ? inp.value : '');
      const correct = filled > 0 && !isNaN(val) && Math.abs(val - it.eq.result) < 0.001;
      if (correct) ok++;
      p.answers[i] = { val: inp ? inp.value : '', correct: correct };
      if (!correct) {
        this.stopSpeaking();
        Storage.addWrongWord(it.en, it.cn, 0, '每天必练·数学·口算作业', 'math');
      }
    });
    p.judged = true;
    p.score = ok;
    this._renderMathPaper();
  },
  _mathPaperCleanup() { this._mathPaper = null; this.stopSpeaking(); },
  _mathPaperFinish() {
    const p = this._mathPaper;
    const total = p ? p.items.length : 1;
    const ok = p ? p.score : 0;
    const pct = total ? Math.round(ok / total * 100) : 0;
    const stars = pct >= 90 ? 3 : (pct >= 60 ? 2 : 1);
    if (this.activeSessionId) {
      try {
        Storage.endSession(this.activeSessionId, { correctCount: ok, wrongCount: total - ok, totalItems: total, accuracy: pct, stars: stars, xp: ok * 5 });
        this.activeSessionId = null;
        this._autoPushReport();
      } catch (e) {}
    }
    this._saveMathModeProgress('paper', stars);
    let html = '<div class="math-container" style="text-align:center;padding:40px 20px">';
    html += '<button class="back-btn" onclick="App.renderMathDailyModes()">← 返回数学作业</button>';
    html += '<div style="font-size:52px">' + (pct >= 90 ? '🏆' : (pct >= 60 ? '👍' : '💪')) + '</div>';
    html += '<h2 style="color:#0D47A1">口算作业完成！</h2>';
    html += '<div style="font-size:20px;margin:16px 0">答对 ' + ok + ' / ' + total + ' 题 · ' + pct + '%</div>';
    html += '<div style="font-size:24px;letter-spacing:4px">' + '⭐'.repeat(stars) + '☆'.repeat(3 - stars) + '</div>';
    html += '<div style="font-size:13px;color:#666;margin-top:10px">错题已自动加入「错题重练」</div>';
    html += '</div>';
    document.getElementById('main-content').innerHTML = html;
  },

  // ---- 问题5：把口诀背诵改为可作答（看算式选正确口诀）----
  _mathMemCurrentCouplet(i) {
    if (!this._mathMem || !this._mathMem.words) return null;
    const w = this._mathMem.words[i];
    if (!w) return null;
    const eq = this._mathParseEn(w.en);
    return { w: w, eq: eq };
  },
  _mathMemSpeak(i, onEnd) {
    const m = this._mathMemCurrentCouplet(i);
    if (!m) return;
    if (m.eq) this.speakChinese(this._mathExprZhQ(m.eq), onEnd);
    else this.speakChinese(String(m.w.cn || m.w.en || ''), onEnd);
  },

  // ---- 数学每天必练老玩法入口改判（dummy 占位，供渲染用）----

  // 🃏 认读翻卡（A+E：自评闯关 + 单字笔顺演示）
  startZhFcGame() {
    let words = (this.zhDailyWords || []).filter(w => String(w.zi || '').trim());
    if (!words.length && this.currentStudent) {
      try { words = this.getHomeworkWords(Storage.getHomeworkZh(this.currentStudent.id), 'chinese').filter(w => String(w.zi || '').trim()); } catch (e) {}
    }
    if (!words.length) { this.renderZhDailyModes(); return; }
    this._zhFcCleanup();
    this._zhFc = {
      words: words,
      deck: words.map((w, i) => i),
      pos: 0,
      flipped: false,
      seenOnce: {},
      cleared: {},
      firstOk: 0,
      relearn: {},
      seqDone: false
    };
    this.activeSessionId = Storage.startSession('zhFlashcard', 0, '每天必练·语文·翻卡', '', { subject: 'chinese', totalItems: words.length });
    this.currentView = 'zhFc';
    this._zhFcRender();
    this.updateTopBar();
  },

  _zhFcCleanup() {
    this._zhStrokeReset();
    this.stopSpeaking();
  },

  _zhFcLeave() {
    this._zhFcCleanup();
    this.renderZhDailyModes();
  },

  _zhFcRender() {
    const f = this._zhFc;
    if (!f || f.pos >= f.deck.length) { this._zhFcDone(); return; }
    const w = f.words[f.deck[f.pos]];
    const main = document.getElementById('main-content');
    const total = f.words.length;
    const cleared = Object.keys(f.cleared).length;
    let html = '<div class="reading-container">';
    html += '<button class="back-btn" onclick="App._zhFcLeave()">← 返回语文作业</button>';
    html += '<h2 class="course-title">🃏 认读翻卡</h2>';
    html += '<div style="padding:0 16px">';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:13px;color:var(--text-light)">'
      + '<div style="flex:1;height:8px;background:#ECEFF1;border-radius:4px;overflow:hidden"><div style="width:' + Math.round(cleared / total * 100) + '%;height:100%;background:#66BB6A;transition:width .3s"></div></div>'
      + '<span style="white-space:nowrap">' + cleared + ' / ' + total + ' 词</span></div>';
    const isSingle = String(w.zi || '').trim().length === 1;
    if (!f.flipped) {
      const ziLen = String(w.zi || '').length;
      html += '<div id="zh-fc-card" style="min-height:260px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#FFF;border:2px solid #FFCC80;border-radius:16px;box-shadow:0 4px 14px rgba(0,0,0,.06);cursor:pointer">'
        + '<div style="font-size:' + (ziLen > 1 ? '46px' : '72px') + ';font-weight:700;letter-spacing:' + (ziLen > 1 ? '6px' : '0') + ';color:#37474F">' + this._h(w.zi) + '</div>'
        + '<div style="margin-top:16px;font-size:14px;color:#90A4AE">想一想：它怎么读？点卡片看答案</div>'
        + '</div>';
    } else {
      html += '<div style="background:#FFF;border:2px solid #A5D6A7;border-radius:16px;padding:16px;box-shadow:0 4px 14px rgba(0,0,0,.06)">'
        + '<div style="text-align:center"><span style="font-size:44px;font-weight:700;color:#2E7D32">' + this._h(w.zi) + '</span>'
        + (w.pinyin ? '<span style="font-size:22px;color:#E65100;margin-left:12px">' + this._h(String(w.pinyin)) + '</span>' : '')
        + '</div>'
        + (w.yi ? '<div style="text-align:center;margin-top:6px;font-size:16px;color:#5D4037">' + this._h(w.yi) + '</div>' : '')
        + (isSingle ? '<div class="zh-demo-wrap" id="zh-fc-demo" style="margin-top:10px"></div>' : '')
        + '</div>';
      html += '<div style="display:flex;gap:12px;margin-top:16px">'
        + '<button class="login-btn" id="zh-fc-ok" style="flex:1;background:#43A047">😊 会读啦</button>'
        + '<button class="login-btn" id="zh-fc-again" style="flex:1;background:#EF5350">😮 再学一遍</button>'
        + '</div>';
    }
    html += '</div></div>';
    main.innerHTML = html;

    const self = this;
    if (!f.flipped) {
      document.getElementById('zh-fc-card').addEventListener('click', () => {
        f.flipped = true;
        f.seqDone = false;
        this._zhFcRender();
      });
      return;
    }

    const zi = String(w.zi || '').trim();
    const py = String(w.pinyin || '').trim();
    const tryAutoStroke = function() {
      if (!self._zhFc || !self._zhFc.seqDone || !self._zhFc.flipped) return;
      const pb = document.getElementById('zh-play-btn');
      if (pb) { try { pb.click(); } catch (e) {} }
    };
    this._zhSpeakSeq(zi, py, function() {
      if (!self._zhFc || !self._zhFc.flipped) return;
      self._zhFc.seqDone = true;
      tryAutoStroke();
    }, { skipUrl: true });
    if (isSingle) {
      this._ensureZhStrokes(function() {
        if (!self._zhFc || !self._zhFc.flipped) return;
        self._zhDemoRender(document.getElementById('zh-fc-demo'), zi);
        tryAutoStroke();
      });
    }
    document.getElementById('zh-fc-ok').addEventListener('click', () => this._zhFcJudge(true));
    document.getElementById('zh-fc-again').addEventListener('click', () => this._zhFcJudge(false));
  },

  _zhFcJudge(ok) {
    const f = this._zhFc;
    if (!f || f.pos >= f.deck.length) return;
    const idx = f.deck[f.pos];
    const w = f.words[idx];
    this._zhFcCleanup();
    if (!f.seenOnce[idx]) {
      f.seenOnce[idx] = true;
      if (ok) f.firstOk++;
    }
    if (ok) {
      f.cleared[idx] = true;
    } else {
      f.relearn[idx] = true;
      try { Storage.addWrongWord(String(w.zi || ''), String(w.yi || w.pinyin || ''), 0, '每天必练·语文', 'chinese'); } catch (e) {}
      f.deck.push(idx);
    }
    f.pos++;
    f.flipped = false;
    this._zhFcRender();
  },

  _zhFcDone() {
    const f = this._zhFc;
    this._zhFcCleanup();
    if (!f) { this.renderZhDailyModes(); return; }
    const total = f.words.length;
    const ratio = total ? f.firstOk / total : 0;
    const stars = ratio >= 0.9 ? 3 : ratio >= 0.6 ? 2 : 1;
    if (this.activeSessionId) {
      Storage.endSession(this.activeSessionId, { correctCount: f.firstOk, wrongCount: total - f.firstOk, totalItems: total, accuracy: Math.round(ratio * 100), stars: stars, xp: f.firstOk * 5 });
      this.activeSessionId = null;
      this._autoPushReport();
    }
    const relearnZis = Object.keys(f.relearn).map(i => String(f.words[i].zi || '')).filter(z => z);
    let html = '<div class="reading-container">';
    html += '<button class="back-btn" onclick="App._zhFcLeave()">← 返回语文作业</button>';
    html += '<h2 class="course-title">🎯 翻卡完成</h2>';
    html += '<div style="padding:0 16px;text-align:center">';
    html += '<div style="font-size:44px;margin:10px 0">' + '⭐'.repeat(stars) + '<span style="opacity:.25">' + '⭐'.repeat(3 - stars) + '</span></div>';
    html += '<div style="font-size:16px;color:#37474F">一共 <strong>' + total + '</strong> 个词，一遍就读会的有 <strong style="color:#2E7D32">' + f.firstOk + '</strong> 个</div>';
    if (relearnZis.length) {
      html += '<div style="margin:14px auto;padding:10px 14px;background:#FFF3E0;border:1px solid #FFCC80;border-radius:10px;font-size:14px;color:#E65100;max-width:420px">'
        + '🔁 这些词再学了一遍：<br><strong style="font-size:18px;letter-spacing:4px">' + this._h(relearnZis.join('、')) + '</strong></div>';
    } else {
      html += '<div style="margin:14px auto;font-size:15px;color:#2E7D32">全部一遍就过，太棒了！🎉</div>';
    }
    html += '<div style="display:flex;gap:12px;margin-top:18px">'
      + '<button class="login-btn" id="zh-fc-retry" style="flex:1">🔁 再练一遍</button>'
      + '<button class="admin-gen-btn" id="zh-fc-back" style="flex:1">📚 返回语文作业</button>'
      + '</div>';
    html += '</div></div>';
    document.getElementById('main-content').innerHTML = html;
    document.getElementById('zh-fc-retry').addEventListener('click', () => this.startZhFcGame());
    document.getElementById('zh-fc-back').addEventListener('click', () => this._zhFcLeave());
  },

  // 🎧 听音选字（语文作业版）
  startZhDailyListen() {
    const words = this.zhDailyWords.filter(w => String(w.zi || '').trim());
    if (words.length < 2) { this.renderZhDailyModes(); return; }
    this.stopSpeaking();
    this.zhQuizMode = 'dailyListen';
    this.zhQuizInfo = { unitId: 0, unitTitle: '每天必练·语文·听音选字', gradeTitle: '', words: words };
    this.zhQuizWords = words.slice();
    this.zhQuizIdx = 0;
    this.zhQuizCorrect = 0;
    this.activeSessionId = Storage.startSession('zhListenChoose', 0, '每天必练·语文·听音选字', '', { subject: 'chinese', totalItems: words.length });
    this.currentView = 'zhQuiz';
    this._zhDailyListenRender();
  },

  _zhDailyListenNext() {
    this._zhDailyListenRender();
  },

  _zhDailyListenRender() {
    const main = document.getElementById('main-content');
    const words = this.zhQuizWords;
    const idx = this.zhQuizIdx;
    if (idx >= words.length) { this._zhDailyListenDone(); return; }
    const q = words[idx];
    const opts = this._zhPickOptions(words, idx, 4);
    let html = '<div class="reading-container">';
    html += '<button class="back-btn" onclick="App.renderZhDailyModes()">← 返回语文作业</button>';
    html += '<h2 class="reading-title">🎧 听音选字</h2>';
    html += '<div class="quiz-area">';
    html += '<div class="zh-daily-tip">🔊 听读音，选出正确的字/词</div>';
    html += '<div class="zh-q-options">';
    opts.forEach((w, i) => {
      html += '<button class="zh-q-opt" data-oi="' + i + '">' + w.zi + '</button>';
    });
    html += '</div>';
    html += '<div class="zh-q-fb" id="zh-q-fb">点击▶播放读音</div>';
    html += '<div class="zh-q-score" id="zh-q-score">' + this.zhQuizCorrect + ' / ' + this.zhQuizIdx + '</div>';
    html += '<button class="reading-ctrl-btn" id="zh-replay" style="margin-top:10px">▶ 再听一遍</button>';
    html += '</div></div>';
    main.innerHTML = html;
    const self = this;
    this._zhSpeakSeq(q.zi, q.pinyin, null, { skipUrl: true, playTimes: 3 });
    document.getElementById('zh-replay').addEventListener('click', () => { self._zhSpeakSeq(q.zi, q.pinyin, null, { skipUrl: true, playTimes: 3 }); });
    document.querySelectorAll('.zh-q-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        const oi = parseInt(btn.dataset.oi);
        self._zhQuizAnswer(oi, opts[oi], q);
      });
    });
  },

  _zhdZiText(w) {
    return String(w.zi || '').trim() || String(w.pinyin || '').trim();
  },

  _zhDailyListenDone() {
    this.stopSpeaking();
    const main = document.getElementById('main-content');
    const total = this.zhQuizWords.length;
    const correct = this.zhQuizCorrect;
    const pct = total ? Math.round((correct / total) * 100) : 0;
    const stars = pct >= 90 ? 3 : pct >= 60 ? 2 : 1;
    if (this.activeSessionId) {
      Storage.endSession(this.activeSessionId, { correctCount: correct, wrongCount: total - correct, totalItems: total, accuracy: pct, stars: stars, xp: correct * 5 });
      this.activeSessionId = null;
      this._autoPushReport();
    }
    let html = '<div class="reading-container">';
    html += '<button class="back-btn" onclick="App.renderZhDailyModes()">← 返回语文作业</button>';
    html += '<h2 class="reading-title">🎯 挑战完成</h2>';
    html += '<div class="quiz-summary">答对 <strong>' + this.zhQuizCorrect + '</strong> / ' + total + '（' + pct + '%）'
      + (pct >= 80 ? ' 🎉 耳朵真灵！' : pct >= 50 ? ' 👍 不错哦！' : ' 💪 多听几遍就会啦！') + '</div>';
    html += '<button class="continue-btn" style="margin-top:16px" onclick="App.renderZhDailyModes()">再来一关</button>';
    html += '</div>';
    main.innerHTML = html;
  },

  // ✍️ 拼音训练营
  zhPyIdx: 0,
  zhPyCorrect: 0,
  zhPyTotal: 0,

  startZhPyQuiz() {
    const words = this.zhDailyWords.filter(w => String(w.pinyin || '').trim());
    if (words.length < 2) { this.renderZhDailyModes(); return; }
    const seen = {};
    const uniq = words.filter(w => { const k = String(w.pinyin).trim(); if (seen[k]) return false; seen[k] = true; return true; });
    this.stopSpeaking();
    this.zhPyWords = uniq;
    this.zhPyIdx = 0;
    this.zhPyCorrect = 0;
    this.zhPyTotal = uniq.length;
    this.zhPyLocked = false;
    this.zhPyAnswered = {};
    if (this._zhPyTimer) { clearTimeout(this._zhPyTimer); this._zhPyTimer = null; }
    this.activeSessionId = Storage.startSession('zhPinyin', 0, '每天必练·语文·拼音训练营', '', { subject: 'chinese', totalItems: uniq.length });
    this.currentView = 'zhPy';
    this._zhPyRender();
  },

  _zhPickPinyins(words, correctIdx, n) {
    const correct = String(words[correctIdx].pinyin).trim();
    const opts = [correct];
    const seen = {};
    seen[correct] = true;
    const pool = [];
    words.forEach((w, i) => {
      if (i === correctIdx) return;
      const p = String(w.pinyin).trim();
      if (p && !seen[p]) { seen[p] = true; pool.push(p); }
    });
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    for (let i = 0; i < pool.length && opts.length < n; i++) opts.push(pool[i]);
    if (opts.length < n) {
      const fallback = ['bā','mā','dà','xiǎo','shàng','xià','rén','kǒu','mù','shuǐ','huǒ','shān','shí','tiān','dì','yuè','rì','niǎo','yú','chē','mǎ','yī','èr','sān'];
      for (let i = fallback.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = fallback[i]; fallback[i] = fallback[j]; fallback[j] = t;
      }
      for (let i = 0; i < fallback.length && opts.length < n; i++) {
        const p = fallback[i];
        if (!seen[p]) { seen[p] = true; opts.push(p); }
      }
    }
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = opts[i]; opts[i] = opts[j]; opts[j] = t;
    }
    return opts;
  },

  _zhPyRender() {
    this.stopSpeaking();
    const main = document.getElementById('main-content');
    const self = this;
    const idx = this.zhPyIdx;
    const words = this.zhPyWords;
    if (idx >= words.length) { this._zhPyDone(); return; }
    const q = words[idx];
    const opts = this._zhPickPinyins(words, idx, 4);
    const correct = String(q.pinyin).trim();
    const ans = this.zhPyAnswered[idx];
    let html = '<div class="reading-container">';
    html += '<button class="back-btn" onclick="App.renderZhDailyModes()">← 返回语文作业</button>';
    html += '<h2 class="reading-title">✍️ 拼音训练营</h2>';
    html += '<div class="quiz-area">';
    html += '<div class="zh-q-char">' + q.zi + '</div>';
    html += '<div class="zh-q-options">';
    opts.forEach((p, i) => {
      html += '<button class="zh-q-opt" data-oi="' + i + '" data-py="' + p + '">' + p + '</button>';
    });
    html += '</div>';
    let fbText = '选一选，这个字读什么？';
    if (ans) fbText = ans.ok ? '✅ 太棒了！' : ('❌ 读作「' + correct + '」');
    html += '<div class="zh-q-fb" id="zh-q-fb">' + fbText + '</div>';
    html += '<div class="zh-q-score" id="zh-q-score">' + this.zhPyCorrect + ' / ' + Object.keys(this.zhPyAnswered).length + '</div>';
    html += '<button class="reading-ctrl-btn" id="zh-py-replay" style="margin-top:10px">🔊 提示读音</button>';
    html += '<div style="display:flex;gap:10px;justify-content:center;margin-top:12px">';
    html += '<button class="reading-ctrl-btn" id="zh-py-prev"' + (idx <= 0 ? ' disabled' : '') + '>⬅ 上一个</button>';
    html += '<button class="reading-ctrl-btn" id="zh-py-next">' + (idx >= words.length - 1 ? '完成 ✓' : '下一个 ➡') + '</button>';
    html += '</div>';
    html += '</div></div>';
    main.innerHTML = html;

    if (ans) {
      document.querySelectorAll('.zh-q-opt').forEach(b => {
        b.disabled = true;
        if (b.dataset.py === correct) b.classList.add('correct');
        else if (!ans.ok && b.dataset.py === ans.picked) b.classList.add('wrong');
      });
    }
    document.getElementById('zh-py-replay').addEventListener('click', () => { self._zhSpeakSeq(q.zi, q.pinyin, null, { skipUrl: true }); });
    document.querySelectorAll('.zh-q-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        if (self.zhPyLocked || self.zhPyAnswered[idx]) return;
        self.zhPyLocked = true;
        const fb = document.getElementById('zh-q-fb');
        const picked = btn.dataset.py;
        document.querySelectorAll('.zh-q-opt').forEach(b => b.disabled = true);
        const ok = picked === correct;
        self.zhPyAnswered[idx] = { ok: ok, picked: picked };
        if (ok) {
          self.zhPyCorrect++;
          btn.classList.add('correct');
          if (fb) fb.textContent = '✅ 太棒了！';
        } else {
          btn.classList.add('wrong');
          document.querySelectorAll('.zh-q-opt').forEach(b => {
            if (b.dataset.py === correct) b.classList.add('correct');
          });
          if (fb) fb.textContent = '❌ 读作「' + correct + '」';
        }
        self._zhSpeakSeq(q.zi, q.pinyin, null, { skipUrl: true });
        const scoreEl = document.getElementById('zh-q-score');
        if (scoreEl) scoreEl.textContent = self.zhPyCorrect + ' / ' + Object.keys(self.zhPyAnswered).length;
        self._zhPyTimer = setTimeout(function() { self._zhPyTimer = null; self.stopSpeaking(); self.zhPyIdx++; self.zhPyLocked = false; self._zhPyRender(); }, 1300);
      });
    });
    const prevBtn = document.getElementById('zh-py-prev');
    if (prevBtn) prevBtn.addEventListener('click', function() {
      if (idx <= 0) return;
      if (self._zhPyTimer) { clearTimeout(self._zhPyTimer); self._zhPyTimer = null; }
      self.stopSpeaking();
      self.zhPyLocked = false;
      self.zhPyIdx = idx - 1;
      self._zhPyRender();
    });
    document.getElementById('zh-py-next').addEventListener('click', function() {
      if (self._zhPyTimer) { clearTimeout(self._zhPyTimer); self._zhPyTimer = null; }
      self.stopSpeaking();
      self.zhPyLocked = false;
      self.zhPyIdx = idx + 1;
      self._zhPyRender();
    });
  },

  _zhPyDone() {
    const main = document.getElementById('main-content');
    const t = this.zhPyTotal;
    const correct = this.zhPyCorrect;
    const pct = t ? Math.round((correct / t) * 100) : 0;
    const stars = pct >= 90 ? 3 : pct >= 60 ? 2 : 1;
    if (this.activeSessionId) {
      Storage.endSession(this.activeSessionId, { correctCount: correct, wrongCount: t - correct, totalItems: t, accuracy: pct, stars: stars, xp: correct * 5 });
      this.activeSessionId = null;
      this._autoPushReport();
    }
    let html = '<div class="reading-container">';
    html += '<button class="back-btn" onclick="App.renderZhDailyModes()">← 返回语文作业</button>';
    html += '<h2 class="reading-title">🏅 拼音小达人</h2>';
    html += '<div class="quiz-summary">答对 <strong>' + this.zhPyCorrect + '</strong> / ' + t + '（' + pct + '%）'
      + (pct >= 90 ? ' 🎉 拼音大师！' : pct >= 60 ? ' 👍 很棒！' : ' 🌱 再练练更棒！') + '</div>';
    html += '<button class="continue-btn" style="margin-top:16px" onclick="App.renderZhDailyModes()">返回语文作业</button>';
    html += '</div>';
    main.innerHTML = html;
  },

  // 🎈 跳跳找字
  zhBubbleIdx: 0,
  zhBubbleScore: 0,
  zhBubbleTimer: null,

  startZhBubble() {
    const words = this.zhDailyWords.filter(w => String(w.zi || '').trim());
    if (words.length < 2) { this.renderZhDailyModes(); return; }
    this.stopSpeaking();
    this.activeSessionId = Storage.startSession('zhBubble', 0, '每天必练·语文·口诀背诵', '', { subject: 'chinese', totalItems: words.length });
    this.zhBubbleWords = words;
    this.zhBubbleIdx = 0;
    this.zhBubbleScore = 0;
    this.zhBubbleDone = false;
    this.currentView = 'zhBubble';
    this._zhBubbleRender();
  },

  _zhFillPool(words, n) {
    const out = [];
    const seen = {};
    words.forEach(w => { const k = String(w.zi).trim(); if (!seen[k]) { seen[k] = true; out.push({ zi: k, pinyin: w.pinyin, yi: w.yi }); } });
    if (out.length < n) {
      const extra = ['天', '地', '人', '大', '小', '山', '水', '火', '木', '土', '花', '鸟', '鱼', '来', '去', '走', '好', '多', '少', '看', '听', '说'];
      for (let i = 0; i < extra.length && out.length < n; i++) {
        const k = extra[i];
        if (!seen[k]) { seen[k] = true; out.push({ zi: k, pinyin: '', yi: '' }); }
      }
    }
    return out;
  },

  _zhBubbleRender() {
    const main = document.getElementById('main-content');
    const idx = this.zhBubbleIdx;
    const words = this.zhBubbleWords;
    if (idx >= words.length) { this._zhBubbleDone(); return; }
    const q = words[idx];
    const pool = this._zhFillPool(words, 8);
    const spots = [];
    let correctPos = 0;
    for (let i = 0; i < pool.length; i++) { if (String(pool[i].zi).trim() === String(q.zi).trim()) { correctPos = i; break; } }
    pool.forEach((w, i) => {
      spots.push({ w: w, correct: i === correctPos, left: 3 + Math.random() * 70, top: 4 + Math.random() * 60, dur: 3 + Math.random() * 3, delay: -1 * Math.random() * 3 });
    });
    let html = '<div class="reading-container">';
    html += '<button class="back-btn" onclick="App.renderZhDailyModes()">← 返回语文作业</button>';
    html += '<h2 class="reading-title">🎈 跳跳找字</h2>';
    html += '<div class="quiz-area">';
    html += '<div class="zh-daily-target">找到这个字/词 → <span class="zh-daily-target-char">' + q.zi + '</span>'
      + (q.pinyin ? ' <span class="zh-daily-target-py">' + q.pinyin + '</span>' : '') + '</div>';
    html += '<div class="zh-bubble-arena" id="zh-bubble-arena" style="height:56vh">';
    spots.forEach((s, i) => {
      html += '<div class="zh-bubble' + (s.correct ? ' zh-bubble-hit' : '') + '" data-pos="' + i + '" style="left:' + s.left + '%;top:' + s.top + '%;animation-duration:' + s.dur + 's;animation-delay:' + s.delay + 's">' + s.w.zi + '</div>';
    });
    html += '</div>';
    html += '<div class="zh-q-fb" id="zh-bubble-fb">点一点，把目标字抓住！</div>';
    html += '<div class="zh-q-score" id="zh-bubble-score">抓到 ' + this.zhBubbleScore + ' 个</div>';
    html += '</div></div>';
    main.innerHTML = html;
    const self = this;
    this._zhSpeakSeq(q.zi, q.pinyin);
    document.querySelectorAll('.zh-bubble').forEach(el => {
      el.addEventListener('click', () => {
        if (self.zhBubbleDone) return;
        const pos = parseInt(el.dataset.pos);
        const spot = spots[pos];
        const fb = document.getElementById('zh-bubble-fb');
        if (spot.correct) {
          el.classList.add('zh-bubble-caught');
          self.zhBubbleScore++;
          if (fb) fb.textContent = '✅ 抓住啦！' + q.zi + '（' + q.pinyin + '）';
          const scoreEl = document.getElementById('zh-bubble-score');
          if (scoreEl) scoreEl.textContent = '抓到 ' + self.zhBubbleScore + ' 个';
          self.zhBubbleDone = true;
          setTimeout(function() { self.zhBubbleIdx++; self.zhBubbleDone = false; self._zhBubbleRender(); }, 1000);
        } else {
          el.classList.add('zh-bubble-miss');
          if (fb) fb.textContent = '❌ 不对哦，再找找「' + q.zi + '」';
          setTimeout(function() { el.classList.remove('zh-bubble-miss'); }, 350);
        }
      });
    });
  },

  _zhBubbleDone() {
    const main = document.getElementById('main-content');
    const t = this.zhBubbleWords.length;
    const score = this.zhBubbleScore;
    const pct = t ? Math.round(score / t * 100) : 0;
    const stars = pct >= 90 ? 3 : pct >= 60 ? 2 : 1;
    if (this.activeSessionId) {
      Storage.endSession(this.activeSessionId, { correctCount: score, wrongCount: t - score, totalItems: t, accuracy: pct, stars: stars, xp: score * 5 });
      this.activeSessionId = null;
      this._autoPushReport();
    }
    let html = '<div class="reading-container">';
    html += '<button class="back-btn" onclick="App.renderZhDailyModes()">← 返回语文作业</button>';
    html += '<h2 class="reading-title">🎈 寻宝完成</h2>';
    html += '<div class="quiz-summary">抓到 <strong>' + score + '</strong> / ' + t + ' 个'
      + (this.zhBubbleScore === t ? ' 🎉 火眼金睛！' : this.zhBubbleScore >= t * 0.6 ? ' 👍 好眼力！' : ' 💪 再玩一轮！') + '</div>';
    html += '<button class="continue-btn" style="margin-top:16px" onclick="App.renderZhDailyModes()">再来一关</button>';
    html += '</div>';
    main.innerHTML = html;
  },

  // 🎲 组词造句秀
  zhSayIdx: 0,
  zhSayStars: 0,

  startZhSay() {
    const words = this.zhDailyWords.filter(w => String(w.zi || '').trim());
    if (!words.length) { this.renderZhDailyModes(); return; }
    this.stopSpeaking();
    this.activeSessionId = Storage.startSession('zhSay', 0, '每天必练·语文·组词造句', '', { subject: 'chinese', totalItems: words.length });
    this.zhSayWords = words;
    this.zhSayIdx = 0;
    this.zhSayStars = 0;
    this.currentView = 'zhSay';
    this._zhSayRender();
  },

  _zhSayRender() {
    const main = document.getElementById('main-content');
    const idx = this.zhSayIdx;
    const words = this.zhSayWords;
    if (idx >= words.length) { this._zhSayDone(); return; }
    const w = words[idx];
    const isZi = String(w.zi).length === 1;
    let html = '<div class="reading-container">';
    html += '<button class="back-btn" onclick="App.renderZhDailyModes()">← 返回语文作业</button>';
    html += '<h2 class="reading-title">🎲 组词造句秀</h2>';
    html += '<div class="quiz-area">';
    html += '<div class="zh-say-card">';
    html += '<div class="zh-study-char">' + w.zi + '</div>';
    html += '<div class="zh-study-pinyin">' + (w.pinyin || '') + '</div>';
    html += '<div class="zh-study-meaning" style="font-size:20px">' + (w.yi || '') + '</div>';
    html += '</div>';
    html += '<div class="zh-q-fb" style="min-height:28px">' + (isZi ? '用「' + w.zi + '」组一个词吧！' : '用「' + w.zi + '」说一句话吧！') + '</div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:8px">';
    html += '<button class="reading-ctrl-btn" id="zh-say-star" style="background:#FFF9C4;border-color:#FBC02D;color:#F57F17">🌟 ' + (isZi ? '我会组词' : '我会造句') + '</button>';
    html += '<button class="reading-ctrl-btn" id="zh-say-listen">🔊 再听一遍</button>';
    html += '<button class="reading-ctrl-btn" id="zh-say-next">⏭ 下一个</button>';
    html += '</div>';
    html += '<div class="zh-q-score" style="margin-top:12px">⭐ 已得 ' + this.zhSayStars + ' 颗星 · 第 ' + (idx + 1) + ' / ' + words.length + ' 个</div>';
    html += '</div></div>';
    main.innerHTML = html;
    const self = this;
    this._zhSaySpeak(w);
    document.getElementById('zh-say-listen').addEventListener('click', () => { self._zhSaySpeak(w); });
    document.getElementById('zh-say-star').addEventListener('click', () => {
      self.zhSayStars++;
      const fb = document.querySelector('.zh-q-fb');
      if (fb) fb.textContent = '🌟 真棒！' + (isZi ? '恭喜完成组词' : '说得真好') + '，继续加油！';
      document.getElementById('zh-say-star').style.background = '#C8E6C9';
      document.getElementById('zh-say-star').style.borderColor = '#4CAF50';
      document.getElementById('zh-say-star').disabled = true;
    });
    document.getElementById('zh-say-next').addEventListener('click', () => {
      self.zhSayIdx++;
      self._zhSayRender();
    });
  },

  _zhSaySpeak(w) {
    this._zhSpeakSeq(w.zi, w.pinyin, null, { skipUrl: true });
  },

  _zhSayDone() {
    const main = document.getElementById('main-content');
    const t = this.zhSayWords.length;
    const starsCount = this.zhSayStars;
    const pct = t ? Math.round(starsCount / t * 100) : 0;
    const stars = pct >= 90 ? 3 : pct >= 60 ? 2 : 1;
    if (this.activeSessionId) {
      Storage.endSession(this.activeSessionId, { correctCount: starsCount, wrongCount: t - starsCount, totalItems: t, accuracy: pct, stars: stars, xp: starsCount * 5 });
      this.activeSessionId = null;
      this._autoPushReport();
    }
    let html = '<div class="reading-container">';
    html += '<button class="back-btn" onclick="App.renderZhDailyModes()">← 返回语文作业</button>';
    html += '<h2 class="reading-title">🎤 语言小明星</h2>';
    html += '<div class="quiz-summary">完成 ' + t + ' 个 · 收获 <strong>' + starsCount + '</strong> 颗星'
      + (this.zhSayStars >= t ? ' 🌟 口才了得！' : this.zhSayStars >= Math.ceil(t / 2) ? ' 👍 大胆开口真棒！' : ' 😊 下次多开口更棒！') + '</div>';
    html += '<button class="continue-btn" style="margin-top:16px" onclick="App.renderZhDailyModes()">返回语文作业</button>';
    html += '</div>';
    main.innerHTML = html;
  },

  startZhFly() {
    const words = this.zhDailyWords.filter(w => String(w.zi || '').trim());
    if (!words.length) { this.renderZhDailyModes(); return; }
    this.stopSpeaking();
    if (this.zhFlyTimer) { clearInterval(this.zhFlyTimer); this.zhFlyTimer = null; }
    this.activeSessionId = Storage.startSession('zhFly', 0, '每天必练·语文·拍苍蝇', '', { subject: 'chinese', totalItems: words.length });
    this.zhFlyWords = words;
    this.zhFlyIdx = 0;
    this.zhFlyScore = 0;
    this.zhFlyWrong = 0;
    this.zhFlyLocked = false;
    this.zhFlyTarget = null;
    this.currentView = 'zhFly';
    this._zhFlyRender();
  },

  _zhFlyRender() {
    const self = this;
    const main = document.getElementById('main-content');
    const idx = this.zhFlyIdx;
    const words = this.zhFlyWords;
    if (idx >= words.length) { this._zhFlyDone(); return; }
    const target = words[idx];
    this.zhFlyTarget = target;
    this.zhFlyLocked = false;
    let html = '<div class="reading-container">';
    html += '<button class="back-btn" onclick="App._zhFlyExit()">← 返回语文作业</button>';
    html += '<h2 class="reading-title">🪰 拍苍蝇</h2>';
    html += '<div class="zh-q-fb" style="min-height:28px">' + (idx + 1) + ' / ' + words.length + ' · 听读音，拍中藏字的苍蝇！</div>';
    // 动画场地：苍蝇带着汉字四处飞，拍中目标字的那只
    const pool = words.slice();
    pool.sort(function() { return Math.random() - 0.5; });
    const picks = [];
    const seen = {};
    if (target.zi) { picks.push(target); seen[target.zi] = true; }
    pool.forEach(function(w) { if (picks.length >= 5) return; if (w.zi && !seen[w.zi]) { picks.push(w); seen[w.zi] = true; } });
    if (picks.length < 2 && words.length > 1) {
      pool.forEach(function(w) { if (picks.length >= 5) return; if (w.zi) { picks.push(w); seen[w.zi] = true; } });
    }
    html += '<div class="zh-fly-arena" style="position:relative;overflow:hidden;width:100%;height:420px;margin:12px auto">';
    picks.forEach(function(w, i) {
      let left = 12 + Math.random() * 60;
      let top = 8 + i * 16 + Math.random() * 20;
      if (top > 80) top = 80 - Math.random() * 10;
      html += '<div class="zh-fly" data-zi="' + w.zi + '" style="left:' + left.toFixed(1) + '%;top:' + top.toFixed(1) + '%;animation-delay:' + (Math.random() * 0.8).toFixed(2) + 's">';
      html += '<span class="zh-fly-icon">🪰</span><span>' + w.zi + '</span>';
      html += '</div>';
    });
    html += '</div>';
    html += '<div class="zh-q-score" style="margin-top:12px">✅ ' + this.zhFlyScore + ' · ❌ ' + this.zhFlyWrong + '</div>';
    html += '</div>';
    main.innerHTML = html;
    document.querySelectorAll('.zh-fly').forEach(function(el) {
      el.addEventListener('click', function() {
        if (self.zhFlyLocked) return;
        const zi = el.dataset.zi;
        if (zi === target.zi) {
          self.zhFlyLocked = true;
          self.zhFlyScore++;
          el.classList.add('zh-fly-hit');
          const fb = document.querySelector('.zh-q-fb');
          if (fb) fb.textContent = '✅ 拍中啦！';
          document.querySelectorAll('.zh-fly').forEach(function(o) { if (o !== el) o.style.animationPlayState = 'paused'; });
          self.zhFlyIdx++;
          if (self.zhFlyTimer) { clearInterval(self.zhFlyTimer); self.zhFlyTimer = null; }
          setTimeout(function() { self._zhFlyRender(); }, 850);
        } else {
          self.zhFlyWrong++;
          el.classList.add('zh-fly-miss');
          self.zhFlyLocked = true;
          setTimeout(function() {
            el.classList.remove('zh-fly-miss');
            self.zhFlyLocked = false;
          }, 500);
        }
      });
    });
    this._zhFlySpeak(target);
  },

  _zhFlySpeak(w) {
    const self = this;
    this._zhSpeakSeq(w.zi, w.pinyin, null, { skipUrl: true });
    if (this.zhFlyTimer) { clearInterval(this.zhFlyTimer); this.zhFlyTimer = null; }
    this.zhFlyTimer = setInterval(function() {
      if (self.currentView !== 'zhFly') { clearInterval(self.zhFlyTimer); self.zhFlyTimer = null; return; }
      self._zhSpeakSeq(self.zhFlyTarget.zi, self.zhFlyTarget.pinyin, null, { skipUrl: true });
    }, 5000);
  },

  _zhFlyExit() {
    if (this.zhFlyTimer) { clearInterval(this.zhFlyTimer); this.zhFlyTimer = null; }
    this.renderZhDailyModes();
  },

  _zhFlyDone() {
    if (this.zhFlyTimer) { clearInterval(this.zhFlyTimer); this.zhFlyTimer = null; }
    const main = document.getElementById('main-content');
    const t = this.zhFlyWords.length;
    const score = this.zhFlyScore;
    const pct = t ? Math.round(score / t * 100) : 0;
    const stars = pct >= 90 ? 3 : pct >= 60 ? 2 : 1;
    if (this.activeSessionId) {
      Storage.endSession(this.activeSessionId, { correctCount: score, wrongCount: this.zhFlyWrong, totalItems: t, accuracy: pct, stars: stars, xp: score * 5 });
      this.activeSessionId = null;
      this._autoPushReport();
    }
    let html = '<div class="reading-container">';
    html += '<button class="back-btn" onclick="App.renderZhDailyModes()">← 返回语文作业</button>';
    html += '<h2 class="reading-title">🪰 拍苍蝇·结算</h2>';
    html += '<div class="quiz-summary">拍中 ' + score + ' / ' + t + ' 个 · 正确率 ' + pct + '%'
      + (pct >= 90 ? ' 🌟 手速真快！' : pct >= 60 ? ' 👍 继续加油！' : ' 😊 多练几次更棒！') + '</div>';
    html += '<button class="continue-btn" style="margin-top:16px" onclick="App.renderZhDailyModes()">返回语文作业</button>';
    html += '</div>';
    main.innerHTML = html;
  },

  zhDailyBack() {
    this.renderZhDailyModes();
  },

  renderDailyPractice() {
    const main = document.getElementById('main-content');
    const hw = Storage.getHomework(this.currentStudent.id);
    const words = this.getHomeworkWords(hw);

    let html = '<div class="subject-container">';
html += '<button class="back-btn" onclick="App.renderSubjectSelector()">← 返回上一级</button>';
    html += '<h2 class="course-title">📗 英语作业.趣味练</h2>';
    if (words.length === 0) {
      html += '<div class="empty-state" style="padding:30px"><p>老师还未布置作业，先去完成课程学习吧</p></div>';
      html += '</div>';
      main.innerHTML = html;
      this.updateTopBar();
      return;
    }

    this._unitIndex[DAILY_UNIT_ID] = {
      words: words,
      unitTitle: '每天必练',
      gradeTitle: '每日作业',
      totalWords: words.length
    };

    html += '<div style="padding:0 16px">';
    html += '<div style="background:#E8F5E9;border:1px solid #A5D6A7;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#2E7D32">';
    html += '作业共 <strong>' + words.length + '</strong> 个单词，选择以下方式练习</div>';
html += '<div class="daily-modes">';
    html += '<button class="dm-btn dm-fc" data-mode="fc"><span class="dm-icon">🃏</span><span class="dm-txt"><strong>翻卡</strong><small>看词想义</small></span></button>';
    html += '<button class="dm-btn dm-hc" data-mode="hc"><span class="dm-icon">🎧</span><span class="dm-txt"><strong>听选</strong><small>听音选词</small></span></button>';
    html += '<button class="dm-btn dm-hs" data-mode="hs"><span class="dm-icon">🎤</span><span class="dm-txt"><strong>听拼</strong><small>听音拼写</small></span></button>';
    html += '<button class="dm-btn dm-game" data-mode="game"><span class="dm-icon">🎮</span><span class="dm-txt"><strong>消消乐</strong><small>配对消除</small></span></button>';
    html += '<button class="dm-btn dm-acc" data-mode="acc"><span class="dm-icon">📅</span><span class="dm-txt"><strong>日积月累</strong><small>每天进步</small></span></button>';
    html += '<button class="dm-btn dm-write" data-mode="write"><span class="dm-icon">✍️</span><span class="dm-txt"><strong>书写解答</strong><small>手写判分</small></span></button>';
    html += '</div>';
    html += '</div>';
    html += '</div>';
main.innerHTML = html;

    document.querySelectorAll('.dm-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        this.currentUnitId = DAILY_UNIT_ID;
        if (mode === 'fc') this.renderFlashcards(DAILY_UNIT_ID);
        else if (mode === 'hc') this.startSingleType(DAILY_UNIT_ID, 'hearChoose', '听选');
        else if (mode === 'hs') this.startSingleType(DAILY_UNIT_ID, 'hearSpell', '听拼');
        else if (mode === 'game') this.startMatchGame(DAILY_UNIT_ID);
        else if (mode === 'acc') this.renderDailyAccumulate();
        else if (mode === 'write') this.startWritePractice(DAILY_UNIT_ID);
      });
    });
    this.updateTopBar();
  },

  renderDailyAccumulate() {
    const main = document.getElementById('main-content');
    const hw = Storage.getHomework(this.currentStudent.id);
    const words = this.getHomeworkWords(hw);
    if (words.length === 0) { this.renderDailyPractice(); return; }

    const today = new Date().toDateString();
    const dp = Storage.getDailyProgress(this.currentStudent.id) || { date: '', cursor: 0 };
    const finished = dp.cursor >= words.length;
    const doneToday = dp.date === today && dp.cursor > 0;
    const start = dp.cursor > 0 ? Math.min(dp.cursor, words.length) : 0;
    const batchEnd = finished ? words.length : Math.min(start + DAILY_BATCH, words.length);
    const freeBatch = dp.cursor > 0 ? words.slice(Math.max(0, dp.cursor - DAILY_BATCH), dp.cursor) : [];
    const todayWords = words.slice(start, batchEnd);
    const stars = doneToday ? Math.max(1, Math.min(3, dp.stars || 1)) : 0;

    let streakDays = 0;
    try {
      const prog = Storage.getProgress();
      streakDays = (prog && prog.streak) || 0;
    } catch (e) {}

    const accCount = this._accAccCount();
    const accDays = this._accAccDayCount();
    const accAll = this._accAccAllWords();
    const accDue = this._accAccDueWords();
    const accLv = this._accAccMeta().accum.lv;

    let freeHtml = '';
    if (freeBatch.length) {
      freeHtml += '<div style="font-size:14px;font-weight:700;margin-bottom:8px">🎈 自由练习 · 巩固这 ' + freeBatch.length + ' 词</div>';
      freeHtml += '<div style="margin-bottom:6px">';
      freeHtml += '<button class="daily-mode-btn" data-free="hs" style="width:100%;margin-bottom:8px">🎤 听音拼写</button>';
      freeHtml += '<button class="daily-mode-btn" data-free="game" style="width:100%;margin-bottom:8px">🎮 消消乐配对</button>';
      freeHtml += '<button class="daily-mode-btn" data-free="write" style="width:100%;margin-bottom:8px">✍️ 书写巩固</button>';
      freeHtml += '<button class="daily-mode-btn" data-free="fc" style="width:100%;margin-bottom:8px">🃏 翻卡复习</button>';
      freeHtml += '</div>';
    }

    let html = '<div class="subject-container">';
    html += '<button class="back-btn" onclick="App.renderDailyPractice()">← 返回上一级</button>';
    html += '<h2 class="course-title">📅 日积月累</h2>';
    html += '<div style="padding:0 16px">';
    html += '<div style="display:flex;gap:8px;margin-bottom:14px">';
    html += '<div style="flex:1;background:#E3F2FD;border:1px solid #90CAF9;border-radius:10px;padding:10px;text-align:center;font-size:12px;color:#0D47A1"><div style="font-size:20px;font-weight:700">' + Math.min(dp.cursor, words.length) + '/' + words.length + '</div>今日进度</div>';
    html += '<div style="flex:1;background:#FFF8E1;border:1px solid #FFE082;border-radius:10px;padding:10px;text-align:center;font-size:12px;color:#5D4037"><div style="font-size:20px;font-weight:700">' + accCount + '</div>已积累<br>共 ' + accDays + ' 天</div>';
    html += '<div style="flex:1;background:' + (streakDays > 0 ? '#FFE0B2' : '#F5F7FA') + ';border:1px solid ' + (streakDays > 0 ? '#FFB74D' : '#E0E0E0') + ';border-radius:10px;padding:10px;text-align:center;font-size:12px;color:' + (streakDays > 0 ? '#E65100' : 'var(--text-light)') + '"><div style="font-size:20px;font-weight:700">' + streakDays + '🔥</div>连续学习</div>';
    html += '</div>';

    if (accCount > 0) {
      html += '<div style="background:#F1F8E9;border:1px solid #C5E1A5;border-radius:12px;padding:12px;margin-bottom:14px">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
      html += '<div style="font-size:14px;font-weight:700;color:#33691E">📚 我的积累墙 <small style="font-weight:400;color:#689F38">已累积 ' + accCount + ' 词 · ' + accDays + ' 天</small></div>';
      if (accDue.length) html += '<button class="daily-mode-btn" data-accdue="1" style="font-size:12px;padding:5px 10px">⏰ 到期复习 ' + accDue.length + '</button>';
      html += '</div>';
      html += '<div style="display:flex;flex-wrap:wrap">';
      (accAll.slice(0, 30)).forEach(w => {
        const id = String(w.en || w.zi).toLowerCase().trim();
        const ripe = (accLv[id] || 0) >= MEMORY_INTERVALS.length;
        html += '<div class="acc-wall-word" data-spk="' + this._h(String(w.en || w.zi)).replace(/"/g, '&quot;') + '" style="flex:0 0 33.33%;padding:5px 4px;text-align:center;cursor:pointer">';
        html += '<div style="font-size:16px;font-weight:700;color:' + (ripe ? '#F57F17' : '#33691E') + '">' + this._h(w.en || w.zi) + '</div>';
        html += '<div style="font-size:10px;color:#8BC34A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (ripe ? '🍎 已毕业' : '复习 ' + (accLv[id] || 0) + '/' + MEMORY_INTERVALS.length) + '</div>';
        html += '</div>';
      });
      html += '</div>';
      html += '<button class="daily-mode-btn" data-accall="1" style="width:100%;margin-top:8px">🔄 复习全部积累 ' + accCount + ' 词</button>';
      html += '</div>';
    } else {
      html += '<div style="background:#F1F8E9;border:1px solid #C5E1A5;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#689F38">🧱 还没有积累的单词，学完今日新词就会开始日积月累，越积越多！</div>';
    }

    if (doneToday) {
      html += '<div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:12px;padding:14px;margin-bottom:14px;text-align:center">';
      html += '<div style="font-size:28px">🏅</div>';
      html += '<div style="font-size:16px;font-weight:700;color:#E65100;margin-top:4px">今日闯关完成' + (finished ? ' · 作业全部学完 🎉' : '') + '</div>';
      html += '<div style="font-size:24px;letter-spacing:6px;color:#FFB300;margin-top:6px">' + '★'.repeat(stars) + '☆'.repeat(3 - stars) + '</div>';
      html += '<div style="font-size:12px;color:#795548;margin-top:4px">' + (finished ? '明天自动开启新词，坚持就是胜利！' : '明天继续新词，坚持就是胜利！') + '</div>';
      html += '</div>';
      html += freeHtml;
      html += '<button class="daily-mode-btn" data-mode="review" style="width:100%;margin-bottom:10px">🔄 复习全部 ' + words.length + ' 词</button>';
      html += '<button class="login-btn" id="acc-back-practice" style="width:100%">✅ 返回每天必练</button>';
    } else if (finished) {
      html += '<div style="background:#E8F5E9;border:1px solid #A5D6A7;border-radius:12px;padding:14px;margin-bottom:14px;text-align:center">';
      html += '<div style="font-size:28px">🎉</div>';
      html += '<div style="font-size:16px;font-weight:700;color:#2E7D32;margin-top:4px">所有作业单词已学完！</div>';
      html += '<div style="font-size:12px;color:#558B2F;margin-top:4px">随时可以复习巩固，保持手感</div>';
      html += '</div>';
      html += freeHtml;
      html += '<button class="daily-mode-btn" data-mode="review" style="width:100%">🔄 复习全部 ' + words.length + ' 词</button>';
    } else {
      html += '<div style="margin-bottom:14px;font-size:13px;color:var(--text-light)">今日新词（' + todayWords.length + ' 个）：';
      html += '<div style="margin-top:6px">';
      todayWords.forEach(w => {
        html += '<span style="display:inline-block;background:#E3F2FD;border-radius:6px;padding:4px 10px;margin:3px;font-size:13px"><strong>' + this._h(w.en || w.zi) + '</strong> <small style="color:var(--text-light)">' + this._h(w.cn || '') + '</small></span>';
      });
      html += '</div></div>';
      html += '<div style="background:#FFF3E0;border:1px solid #FFE0B2;border-radius:10px;padding:8px 14px;margin-bottom:14px;font-size:12px;color:#E65100">🏆 闯关制：第 1 关翻卡学一学 → 第 2 关听音频选词测验，全对得 3 星</div>';
      html += '<button class="login-btn" data-mode="start" style="width:100%">🚀 开始今日闯关（' + todayWords.length + ' 词）</button>';
    }
    html += '</div></div>';
    main.innerHTML = html;

    document.querySelectorAll('.daily-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode === 'review') { this._accFlow = false; this._accStart(words.slice(), false, null); }
      });
    });
    document.querySelectorAll('[data-free]').forEach(btn => {
      btn.addEventListener('click', () => this._accFreeRun(btn.dataset.free));
    });
    const startBtn = main.querySelector('[data-mode="start"]');
    if (startBtn) startBtn.addEventListener('click', () => {
      this._accFlow = true;
      this._accFlowFromGarden = false;
      this._accTotalAll = words.length;
      this._accStart(todayWords.slice(), true, null);
    });
    const backBtn = document.getElementById('acc-back-practice');
    if (backBtn) backBtn.addEventListener('click', () => this.renderDailyPractice());

    main.querySelectorAll('.acc-wall-word').forEach(el => {
      el.addEventListener('click', () => this.speakWord(el.dataset.spk));
    });
    const accAllBtn = main.querySelector('[data-accall]');
    if (accAllBtn) accAllBtn.addEventListener('click', () => {
      const list = this._accAccAllWords().filter(w => String(w.en || w.zi).trim());
      if (!list.length) return;
      const ids = list.map(w => String(w.en || w.zi).toLowerCase().trim()).filter(Boolean);
      this._accFlow = false;
      this._accStart(list, false, () => { this._accAccAdvance(ids); this.renderDailyAccumulate(); });
    });
    const accDueBtn = main.querySelector('[data-accdue]');
    if (accDueBtn) accDueBtn.addEventListener('click', () => {
      const list = this._accAccDueWords().filter(w => String(w.en || w.zi).trim());
      if (!list.length) return;
      const ids = list.map(w => String(w.en || w.zi).toLowerCase().trim()).filter(Boolean);
      this._accFlow = false;
      this._accStart(list, false, () => { this._accAccAdvance(ids); this.renderDailyAccumulate(); });
    });

    this.updateTopBar();
  },

  _accFinishDaily(totalWords, stars) {
    const today = new Date().toDateString();
    let dp = Storage.getDailyProgress(this.currentStudent.id) || { date: '', cursor: 0 };
    dp.date = today;
    if (dp.cursor + DAILY_BATCH > totalWords) dp.cursor = totalWords;
    else dp.cursor += DAILY_BATCH;
    if (stars) dp.stars = stars;
    Storage.saveDailyProgress(this.currentStudent.id, dp);
    this.renderDailyAccumulate();
  },

  // ---- 日积月累：逐日积累数据模型（独立于记忆花园的 dp.lv/dp.due，避免冲突）----
  _accAccMeta() {
    const dp = Storage.getDailyProgress(this.currentStudent.id) || { date: '', cursor: 0 };
    if (!dp.accum) dp.accum = { days: {}, list: [], lv: {}, due: {}, last: '' };
    return dp;
  },
  _accAccSave(dp) {
    Storage.saveDailyProgress(this.currentStudent.id, dp);
  },
  _accAccumulate(batch) {
    // 学完当日新词后，把单词逐日累积进历史（日积月累的核心）
    if (!batch || !batch.length) return;
    const dp = this._accAccMeta();
    const today = this._gardenDateStr(0);
    if (!dp.accum.days[today]) dp.accum.days[today] = [];
    const ids = batch.map(w => String(w.en || w.zi).toLowerCase().trim()).filter(Boolean);
    ids.forEach(id => {
      if (dp.accum.days[today].indexOf(id) < 0) dp.accum.days[today].push(id);
      if (dp.accum.list.indexOf(id) < 0) dp.accum.list.push(id);
      if (dp.accum.lv[id] === undefined) dp.accum.lv[id] = 0;
      if (!dp.accum.due[id] || dp.accum.due[id] < today) dp.accum.due[id] = this._gardenDateStr(MEMORY_INTERVALS[0]);
    });
    dp.accum.last = today;
    this._accAccSave(dp);
  },
  _accAccCount() {
    const dp = this._accAccMeta();
    return (dp.accum.list || []).length;
  },
  _accAccDayCount() {
    const dp = this._accAccMeta();
    return Object.keys(dp.accum.days || {}).length;
  },
  _accAccAllWords() {
    const dp = this._accAccMeta();
    const ids = dp.accum.list || [];
    const all = this.getHomeworkWords(Storage.getHomework(this.currentStudent.id));
    const out = [];
    ids.forEach(id => {
      const w = all.find(x => String(x.en || x.zi).toLowerCase().trim() === id);
      out.push(w || { en: id, cn: '' });
    });
    return out;
  },
  _accAccDueWords() {
    const dp = this._accAccMeta();
    const today = this._gardenDateStr(0);
    const dueIds = Object.keys(dp.accum.due || {}).filter(id => dp.accum.due[id] <= today);
    const all = this.getHomeworkWords(Storage.getHomework(this.currentStudent.id));
    const out = [];
    dueIds.forEach(id => {
      const w = all.find(x => String(x.en || x.zi).toLowerCase().trim() === id);
      if (w) out.push(w);
    });
    return out;
  },
  _accAccAdvance(ids) {
    if (!ids || !ids.length) return;
    const dp = this._accAccMeta();
    const today = this._gardenDateStr(0);
    ids.forEach(id => {
      const lv = (dp.accum.lv[id] || 0) + 1;
      dp.accum.lv[id] = lv;
      if (lv >= MEMORY_INTERVALS.length) delete dp.accum.due[id];
      else dp.accum.due[id] = this._gardenDateStr(MEMORY_INTERVALS[lv]);
    });
    this._accAccSave(dp);
  },

  _accStart(words, isBatch, onDone) {
    const arr = words.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    this._accWords = arr;
    this._accIndex = 0;
    this._accFlipped = false;
    this._accKnown = new Array(arr.length).fill(null);
    this._accOnDone = onDone;
    this._accIsBatch = !!isBatch;
    this._renderAccCard();
  },

  _renderAccCard() {
    const main = document.getElementById('main-content');
    const word = this._accWords[this._accIndex];
    const total = this._accWords.length;
    if (!word) { this._accExit(); return; }
    const cn = word.cn || word.pinyin || '';
    const example = (word.example && String(word.example).trim() && String(word.example).trim() !== String(word.en || word.zi).trim()) ? word.example : '';
    let html = '<div class="fc-container">';
    html += '<button class="back-btn" onclick="App._accExit()">← 返回上一级</button>';
    html += '<div class="fc-counter">' + (this._accIndex + 1) + ' / ' + total + '</div>';
    html += '<div class="fc-progress" style="max-width:340px;height:6px;background:#E0E0E0;border-radius:3px;margin:-6px auto 12px;overflow:hidden">';
    html += '<div style="height:100%;width:' + Math.round(((this._accIndex + 1) / total) * 100) + '%;background:var(--primary)"></div></div>';
    html += '<div class="fc-card' + (this._accFlipped ? ' flipped' : '') + '" onclick="App._accFlip()">';
    if (this._accFlipped) {
      html += '<div class="fc-face fc-back"><span>' + this._h(cn) + '</span><small style="display:block;margin-top:8px;font-size:14px;opacity:.7">' + this._h(word.en || word.zi) + '</small></div>';
    } else {
      html += '<div class="fc-face fc-front"><span>' + this._h(word.en || word.zi) + '</span></div>';
    }
    html += '</div>';
    html += '<div style="text-align:center;margin-top:10px">';
    html += '<button class="speaker-btn" id="acc-speak" style="font-size:16px;padding:6px 16px;border-radius:8px">🔊 ' + (word.en || word.zi) + '</button>';
    html += '</div>';
    if (this._accFlipped && (example || cn)) {
      html += '<div style="max-width:340px;margin:10px auto 0;background:#FFF8E1;border:1px solid #FFE082;border-radius:10px;padding:10px 12px;font-size:13px;color:#5D4037;text-align:center">';
      html += example ? this._h(example) : '';
      html += '</div>';
    }
    html += '<div style="text-align:center;margin-top:16px">';
    if (this._accFlipped) {
      html += '<div style="display:flex;gap:10px;justify-content:center;margin-bottom:10px">';
      html += '<button class="daily-mode-btn" data-acc="know" style="flex:1;width:auto;min-width:120px">😀 认识</button>';
      html += '<button class="daily-mode-btn" data-acc="dont" style="flex:1;width:auto;min-width:120px;background:#FBE9E7;color:#BF360C">🤔 不认识</button>';
      html += '</div>';
    }
    html += '<div style="display:flex;gap:10px;justify-content:center">';
    html += '<button class="admin-btn" onclick="App._accPrev()">◀ 上一个</button>';
    html += '<button class="admin-btn" id="acc-next" onclick="App._accNext()">' + (this._accIndex >= total - 1 ? '✅ 学完了' : '下一个 ▶') + '</button>';
    html += '</div></div>';
    html += '</div>';
    main.innerHTML = html;

    document.getElementById('acc-speak').addEventListener('click', () => this.speakWord(String(word.en || word.zi)));
    const self = this;
    document.querySelectorAll('[data-acc]').forEach(btn => {
      btn.addEventListener('click', () => self._accAnswer(btn.dataset.acc === 'know'));
    });
    document.getElementById('acc-next').addEventListener('click', () => this._accNext());
  },

  _accAnswer(known) {
    this._accKnown[this._accIndex] = known;
    if (this._accIndex >= this._accWords.length - 1) {
      this._accFinish();
    } else {
      this._accIndex++;
      this._accFlipped = false;
      this._renderAccCard();
    }
  },

  _accFinish() {
    const words = this._accWords;
    const known = words.map((w, i) => this._accKnown[i] === true);
    const knownCount = known.filter(Boolean).length;
    const rate = words.length > 0 ? Math.round((knownCount / words.length) * 100) : 0;
    const unknown = words.filter((w, i) => !known[i]);

    let grade = '';
    if (rate === 100) grade = '🏆 全部掌握，太棒了！';
    else if (rate >= 80) grade = '🌟 掌握得很好，继续加油！';
    else if (rate >= 60) grade = '👍 不错，再巩固一下不认识的';
    else grade = '💪 别灰心，再学一遍不认识的词';

    const main = document.getElementById('main-content');
    let html = '<div class="subject-container">';
    html += '<button class="back-btn" onclick="App._accExit()">← 返回上一级</button>';
    html += '<h2 class="course-title">' + (this._accFlow ? '📖 第 1 关 · 学一学' : '📊 本次学习结果') + '</h2>';
    html += '<div style="padding:0 16px">';
    html += '<div style="background:#E8F5E9;border:1px solid #A5D6A7;border-radius:10px;padding:14px;margin-bottom:14px;text-align:center">';
    html += '<div style="font-size:36px;font-weight:700;color:var(--primary)">' + rate + '%</div>';
    html += '<div style="font-size:13px;color:#2E7D32;margin-top:4px">认识 <strong>' + knownCount + '</strong> / ' + words.length + ' 个 · ' + grade + '</div>';
    html += '</div>';

    if (unknown.length > 0) {
      html += '<div style="margin-bottom:10px;font-size:13px;color:var(--text-light)">还不认识的 ' + unknown.length + ' 个词：</div>';
      html += '<div style="border:1px solid #EEE;border-radius:10px;padding:8px 12px;margin-bottom:14px">';
      unknown.forEach(w => {
        html += '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px">';
        html += '<a href="javascript:void(0)" class="acc-unknown-speak" data-w="' + this._h(String(w.en || w.zi)).replace(/"/g, '&quot;') + '" style="color:var(--primary)">🔊</a>';
        html += '<strong>' + this._h(w.en || w.zi) + '</strong>';
        html += '<small style="color:var(--text-light)">' + this._h(w.cn || '') + '</small>';
        html += '</div>';
      });
      html += '</div>';
      html += '<button class="daily-mode-btn" id="acc-retry" style="width:100%">🔁 再学一遍不认识的 ' + unknown.length + ' 词</button>';
    } else {
      html += '<div style="background:#E8F5E9;border:1px solid #A5D6A7;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#2E7D32">🎉 全部认识，真棒！</div>';
    }
    if (this._accFlow) {
      html += '<button class="login-btn" id="acc-quiz" style="width:100%;margin-top:10px">🎯 第 2 关：听音测验</button>';
      html += '<div style="margin-top:8px;font-size:12px;color:var(--text-light);text-align:center">听单词发音，选出正确单词，全对得 3 星</div>';
    } else {
      html += '<button class="login-btn" id="acc-done" style="width:100%;margin-top:10px">✅ 完成</button>';
    }
    html += '</div></div>';
    main.innerHTML = html;

    const self = this;
    document.querySelectorAll('.acc-unknown-speak').forEach(a => {
      a.addEventListener('click', () => self.speakWord(a.dataset.w));
    });
    const retry = document.getElementById('acc-retry');
    if (retry) retry.addEventListener('click', () => this._accStart(unknown.slice(), this._accIsBatch, this._accOnDone));
    const quizBtn = document.getElementById('acc-quiz');
    if (quizBtn) quizBtn.addEventListener('click', () => this._accStartQuiz());
    const doneBtn = document.getElementById('acc-done');
    if (doneBtn) doneBtn.addEventListener('click', () => {
      const done = this._accOnDone;
      this._accOnDone = null;
      if (done) done();
      else this.renderDailyAccumulate();
    });
  },

  _accFlip() {
    if (this._accFlipped) return;
    this._accFlipped = true;
    if (this._accWords && this._accWords[this._accIndex]) {
      const w = this._accWords[this._accIndex];
      this.speakWord(String(w.en || w.zi));
    }
    this._renderAccCard();
  },

  _accPrev() {
    if (this._accIndex > 0) { this._accIndex--; this._accFlipped = false; this._renderAccCard(); }
  },

  _accNext() {
    if (this._accIndex >= this._accWords.length - 1) {
      this._accFinish();
    } else {
      this._accIndex++;
      this._accFlipped = false;
      this._renderAccCard();
    }
  },

  _accExit() {
    this._cleanupView();
    if (this._quizMode === 'tame') {
      this._quizMode = null;
      this.renderGardenMonsterCage();
      return;
    }
    if (this._accFlowFromGarden || (this._quizMode && this._quizMode !== 'acc')) {
      this._accFlowFromGarden = false;
      this._quizMode = null;
      this.renderMemoryGarden();
      return;
    }
    this.renderDailyPractice();
  },

  _accStartQuiz() {
    this._accStars = 0;
    this._accQuiz(this._accWords.slice());
  },

  _accQuiz(words, pool, mode) {
    const arr = words.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    if (arr.length < 2 && arr.length > 0) arr.push(arr[0]);
    const qMode = mode || 'acc';
    // 日积月累第 2 关：多题型混合（听音选词 / 看义选词 / 听音拼写随机轮换），打破单调；其余玩法保持听音选词
    this._quizSub = arr.map((w, idx) => {
      if (qMode !== 'acc') return 'hearChoose';
      const hasCn = !!(w.cn && String(w.cn).trim());
      const r = Math.random();
      if (hasCn && r < 0.5) return 'chooseEN';
      if (idx % 2 === 1 && r < 0.62) return 'hearSpell';
      return 'hearChoose';
    });
    this._quizWords = arr;
    this._quizIndex = 0;
    this._quizWrong = [];
    this._quizPool = pool || null;
    this._quizMode = qMode;
    this._renderAccQuiz();
  },

  _quizSubLabel(so) {
    return so === 'chooseEN' ? '看词义选英文' : so === 'hearSpell' ? '听音拼写' : '听音选词';
  },

  _renderAccQuiz() {
    const main = document.getElementById('main-content');
    const w = this._quizWords[this._quizIndex];
    if (!w) { this._accQuizOver(); return; }
    const total = this._quizWords.length;
    const correct = String(w.en || w.zi);
    const pool = this._quizPool ? this._quizPool.filter(x => String(x.en || x.zi) !== correct) : (this._accWords || []).filter(x => String(x.en || x.zi) !== correct);
    const opts = [w];
    while (opts.length < 4 && pool.length) {
      const i2 = Math.floor(Math.random() * pool.length);
      const o = pool.splice(i2, 1)[0];
      const t = String(o.en || o.zi);
      if (!opts.some(x => String(x.en || x.zi) === t)) opts.push(o);
    }
    opts.sort(function() { return Math.random() - 0.5; });

    const sub = this._quizSub && this._quizSub[this._quizIndex] || 'hearChoose';
    const isOption = sub !== 'hearSpell';
    const cnText = (w.cn && String(w.cn).trim()) ? String(w.cn) : (String(w.zi || '').trim() || correct);

    let html = '<div class="fc-container">';
    html += '<button class="back-btn" onclick="App._accExit()">← 返回上一级</button>';
    html += '<div class="fc-counter">第 2 关 · ' + this._quizSubLabel(sub) + ' ' + (this._quizIndex + 1) + ' / ' + total + '</div>';
    html += '<div class="fc-progress" style="max-width:340px;height:6px;background:#E0E0E0;border-radius:3px;margin:-6px auto 12px;overflow:hidden">';
    html += '<div style="height:100%;width:' + Math.round(((this._quizIndex + 1) / total) * 100) + '%;background:#FF9800"></div></div>';
    html += '<div class="fc-card" style="cursor:default;pointer-events:none">';
    if (sub === 'chooseEN') {
      html += '<div class="fc-face" style="background:linear-gradient(135deg,#E8F5E9,#C8E6C9)"><span style="font-size:22px">' + this._h(cnText) + '</span><small style="display:block;margin-top:10px;font-size:13px;opacity:.75">看词义，选出对应的英文单词</small></div>';
    } else {
      html += '<div class="fc-face" style="background:linear-gradient(135deg,#FFF3E0,#FFE0B2)"><span style="font-size:26px">🔊</span><small style="display:block;margin-top:10px;font-size:13px;opacity:.75">' + (sub === 'hearSpell' ? '听发音，拼出这个单词' : '听发音，选出听到的单词') + '</small></div>';
    }
    html += '</div>';
    html += '<div style="text-align:center;margin-top:10px">';
    html += '<button class="speaker-btn" id="quiz-play" style="font-size:16px;padding:6px 16px;border-radius:8px">🔊 再听一遍</button>';
    html += '</div>';
    if (isOption) {
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px">';
      for (let i = 0; i < opts.length; i++) {
        const o = opts[i];
        const t = String(o.en || o.zi);
        html += '<button class="quiz-opt" data-opt="' + this._h(t).replace(/"/g, '&quot;') + '" data-t="' + i + '" style="padding:16px 8px;font-size:17px;font-weight:600;border:1.5px solid #E0E0E0;border-radius:12px;background:#fff;color:var(--text)">' + this._h(t) + '</button>';
      }
      html += '</div>';
    } else {
      html += '<div style="text-align:center;margin-top:14px">';
      html += '<input type="text" id="quiz-spell-input" placeholder="在这里拼写..." style="width:calc(100% - 96px);max-width:260px;padding:12px 14px;font-size:18px;text-align:center;border:1.5px solid #90CAF9;border-radius:10px;outline:none" autocomplete="off" autocapitalize="off" spellcheck="false">';
      html += '<button class="login-btn" id="quiz-spell-submit" style="width:80px;padding:12px 0;margin-left:8px">提交</button>';
      html += '</div>';
    }
    html += '<div id="quiz-fb" style="text-align:center;margin-top:12px;min-height:24px;font-size:15px;font-weight:700"></div>';
    html += '</div>';
    main.innerHTML = html;

    this.speakWord(correct);
    document.getElementById('quiz-play').addEventListener('click', () => this.speakWord(correct));
    const self = this;
    if (isOption) {
      document.querySelectorAll('.quiz-opt').forEach(b => {
        b.addEventListener('click', () => self._quizAnswer(b));
      });
    } else {
      const submit = document.getElementById('quiz-spell-submit');
      if (submit) submit.addEventListener('click', () => self._quizSpellSubmit());
      const inp = document.getElementById('quiz-spell-input');
      if (inp) {
        inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') self._quizSpellSubmit(); });
        setTimeout(function() { inp.focus(); }, 200);
      }
    }
  },

  _quizAnswer(btn) {
    if (btn.dataset.done) return;
    btn.dataset.done = '1';
    const w = this._quizWords[this._quizIndex];
    const correct = String(w.en || w.zi);
    const pick = btn.dataset.opt;
    const fb = document.getElementById('quiz-fb');
    if (pick === correct) {
      btn.style.background = '#C8E6C9'; btn.style.borderColor = '#66BB6A'; btn.style.color = '#1B5E20';
      fb.innerHTML = '✅ 答对了！'; fb.style.color = '#2E7D32';
      setTimeout(() => this._quizNext(), 600);
    } else {
      btn.style.background = '#FFCDD2'; btn.style.borderColor = '#E57373'; btn.style.color = '#B71C1C';
      if (!this._quizWrong.some(x => String(x.en || x.zi) === correct)) this._quizWrong.push(w);
      document.querySelectorAll('.quiz-opt').forEach(o => {
        if (o.dataset.opt === correct) { o.style.background = '#C8E6C9'; o.style.borderColor = '#66BB6A'; o.style.color = '#1B5E20'; }
      });
      fb.innerHTML = '❌ 正确是：' + this._h(correct); fb.style.color = '#C62828';
      setTimeout(() => this._quizNext(), 1000);
    }
  },

  _quizSpellSubmit() {
    const inp = document.getElementById('quiz-spell-input');
    if (!inp) return;
    const val = String(inp.value || '').trim().toLowerCase();
    if (!val) return;
    inp.disabled = true;
    const w = this._quizWords[this._quizIndex];
    const correct = String(w.en || w.zi);
    const fb = document.getElementById('quiz-fb');
    if (val === correct.toLowerCase()) {
      inp.style.borderColor = '#66BB6A'; inp.style.color = '#1B5E20';
      fb.innerHTML = '✅ 拼写正确！'; fb.style.color = '#2E7D32';
      setTimeout(() => this._quizNext(), 600);
    } else {
      inp.style.borderColor = '#E57373'; inp.style.color = '#B71C1C';
      if (!this._quizWrong.some(x => String(x.en || x.zi) === correct)) this._quizWrong.push(w);
      fb.innerHTML = '❌ 正确是：' + this._h(correct); fb.style.color = '#C62828';
      this.speakWord(correct);
      setTimeout(() => this._quizNext(), 1200);
    }
  },

  _quizNext() {
    this._quizIndex++;
    this._renderAccQuiz();
  },

  _accQuizOver() {
    const wrong = this._quizWrong;
    const total = this._quizWords.length;
    const stars = wrong.length === 0 ? 3 : wrong.length <= 2 ? 2 : 1;
    this._accStars = Math.max(this._accStars || 0, stars);

    const isAcc = this._quizMode === 'acc';
    const main = document.getElementById('main-content');
    let html = '<div class="subject-container">';
    html += '<button class="back-btn" onclick="App._accExit()">← 返回上一级</button>';
    html += '<h2 class="course-title">' + (isAcc ? (wrong.length === 0 ? '🎯 第 2 关 · 全对！' : '🎯 第 2 关完成') : (wrong.length === 0 ? '🎯 全对！' : '🎯 完成')) + '</h2>';
    html += '<div style="padding:0 16px">';
    html += '<div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:12px;padding:16px;margin-bottom:14px;text-align:center">';
    html += '<div style="font-size:34px">' + (stars >= 3 ? '🏆' : stars >= 2 ? '🌟' : '💪') + '</div>';
    html += '<div style="font-size:26px;letter-spacing:6px;color:#FFB300;margin-top:4px">' + '★'.repeat(stars) + '☆'.repeat(3 - stars) + '</div>';
    html += '<div style="font-size:13px;color:#795548;margin-top:4px">' + (stars >= 3 ? '全部答对，太棒了！' : stars >= 2 ? '很棒！再巩固一下错词吧' : '继续加油，多听几遍一定行！') + '</div>';
    html += '</div>';

    if (wrong.length > 0) {
      html += '<div style="margin-bottom:10px;font-size:13px;color:var(--text-light)">听错的 ' + wrong.length + ' 个词：</div>';
      html += '<div style="border:1px solid #EEE;border-radius:10px;padding:8px 12px;margin-bottom:14px">';
      wrong.forEach(w => {
        html += '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px">';
        html += '<a href="javascript:void(0)" class="acc-unknown-speak" data-w="' + this._h(String(w.en || w.zi)).replace(/"/g, '&quot;') + '" style="color:var(--primary)">🔊</a>';
        html += '<strong>' + this._h(w.en || w.zi) + '</strong>';
        html += '<small style="color:var(--text-light)">' + this._h(w.cn || '') + '</small>';
        html += '</div>';
      });
      html += '</div>';
      html += '<button class="daily-mode-btn" id="quiz-retry" style="width:100%;margin-bottom:10px">🔁 重测 ' + wrong.length + ' 个错词</button>';
    }
    html += '<button class="login-btn" id="quiz-done" style="width:100%">' + (this._quizMode === 'due' ? '✅ 完成今日复习' : this._quizMode === 'morning' ? '✅ 完成晨间快测' : this._quizMode === 'night' ? '✅ 完成闪电问答' : this._quizMode === 'week' ? '🏆 领取周考奖杯' : this._quizMode === 'tame' ? '🎉 驯服完毕' : '🏁 完成今日闯关') + '</button>';
    html += '</div></div>';
    main.innerHTML = html;

    const self = this;
    document.querySelectorAll('.acc-unknown-speak').forEach(a => {
      a.addEventListener('click', () => self.speakWord(a.dataset.w));
    });
    const retry = document.getElementById('quiz-retry');
    if (retry) retry.addEventListener('click', () => this._accQuiz(wrong.slice(), this._quizPool || null, this._quizMode));
    document.getElementById('quiz-done').addEventListener('click', () => {
      if (this._quizMode === 'due') this._gardenDueDone();
      else if (this._quizMode === 'week') this._gardenWeekDone();
      else if (this._quizMode === 'tame') this._gardenTameDone();
      else if (this._quizMode === 'acc') this._accCouFinish();
      else this.renderMemoryGarden();
    });
  },

  _accCouFinish() {
    this._accFlow = false;
    const totalAll = this._accTotalAll || (this._accWords ? this._accWords.length : 0);
    this._accAccumulate(this._accWords);
    this._accFinishDaily(totalAll, this._accStars || 1);
  },

  _accFreeRun(mode) {
    const today = new Date().toDateString();
    const dp = Storage.getDailyProgress(this.currentStudent.id) || { date: '', cursor: 0 };
    const words = this.getHomeworkWords(Storage.getHomework(this.currentStudent.id));
    let batch;
    if (dp.cursor > 0) {
      if (dp.date === today) batch = words.slice(Math.max(0, dp.cursor - DAILY_BATCH), dp.cursor);
      else batch = words.slice(Math.max(0, dp.cursor - DAILY_BATCH), Math.max(dp.cursor, DAILY_BATCH));
    } else {
      batch = words.slice(0, Math.min(DAILY_BATCH, words.length));
    }
    if (!batch.length) { this.renderDailyAccumulate(); return; }
    this._unitIndex[DAILY_UNIT_ID] = { words: batch, unitTitle: '今日积累', gradeTitle: '日积月累', totalWords: batch.length };
    this.currentUnitId = DAILY_UNIT_ID;
    this._accFreePractice = true;
    if (mode === 'hs') this.startSingleType(DAILY_UNIT_ID, 'hearSpell', '🎤 听拼巩固');
    else if (mode === 'game') this.startMatchGame(DAILY_UNIT_ID);
    else if (mode === 'write') this.startWritePractice(DAILY_UNIT_ID);
    else this.renderFlashcards(DAILY_UNIT_ID);
  },

  logoutToLogin() {
    if (this._taskPollTimer) { clearInterval(this._taskPollTimer); this._taskPollTimer = null; }
    this._cleanupView();
    Storage.logout();
    this.currentStudent = null;
    this.isAdminMode = false;
    this.adminViewingStudent = null;
    this._adminTier = undefined;
    this.currentView = 'login';
    this.renderLogin();
  },

  renderAdminDashboard() {
    if (this._adminTier !== 'super') this._adminTier = 'normal';
    this.isAdminMode = true;
    this.currentView = 'admin';
    document.querySelector('.top-bar').style.display = 'flex';
    document.querySelector('.bottom-nav').style.display = 'none';

    const main = document.getElementById('main-content');
    let html = '<div class="admin-container">';
    html += '<button class="back-btn" onclick="App.logoutToLogin()">← 返回登录页面</button>';
    html += '<h2 class="admin-title">🔧 管理后台</h2>';

    html += '<div class="admin-tabs">';
    html += '<button class="admin-tab active" id="atab-codes">🎓 学员注册</button>';
    html += '<button class="admin-tab" id="atab-students">👥 学员汇总</button>';
    html += '<button class="admin-tab" id="atab-inactive">⚠️ 未练习</button>';
    html += '<button class="admin-tab" id="atab-homework">📝 布置作业</button>';
    html += '<button class="admin-tab" id="atab-scan">📷 扫描入库</button>';
    html += '<button class="admin-tab" id="atab-reports">👀 学习情况</button>';
    html += '</div>';
    html += '<div id="admin-tab-content"></div>';

    const adminGrades = Storage.getAdminGrades();
    const gradeLabel = adminGrades.length ? adminGrades.map(x => x + '年级').join('、') : '全部年级';
    html += '<div style="margin:12px 0;padding:10px 14px;background:#FFF8E1;border:1px solid #FFE082;border-radius:10px;font-size:13px;color:#5D4037">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">';
    html += '<span>👨‍🏫 本机负责年级：<strong id="admin-grade-label">' + gradeLabel + '</strong></span>';
    html += '<button class="login-btn" id="btn-admin-pick-grade" style="padding:6px 14px;font-size:13px;width:auto;flex-shrink:0">选择年级</button>';
    html += '</div>';
    html += '<div style="margin-top:8px">';
    html += '<input type="text" class="login-input" id="login-upd-host" placeholder="电脑 IP，如 192.168.1.100" value="' + this._h(this._getSavedHost()) + '" autocomplete="off">';
    html += '</div>';
    main.innerHTML = html;

    document.getElementById('atab-codes').addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
      document.getElementById('atab-codes').classList.add('active');
      this._renderAdminCodes();
    });
    document.getElementById('atab-students').addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
      document.getElementById('atab-students').classList.add('active');
      this._renderAdminStudents();
    });
    document.getElementById('atab-inactive').addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
      document.getElementById('atab-inactive').classList.add('active');
      this._renderInactiveStudents();
    });
    document.getElementById('atab-homework').addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
      document.getElementById('atab-homework').classList.add('active');
      this._renderAdminHomework();
    });
    document.getElementById('atab-scan').addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
      document.getElementById('atab-scan').classList.add('active');
      this._renderAdminScan();
    });
    document.getElementById('atab-reports').addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
      document.getElementById('atab-reports').classList.add('active');
      this._renderAdminReports();
    });

    const pickBtn = document.getElementById('btn-admin-pick-grade');
    if (pickBtn) pickBtn.addEventListener('click', () => this._openGradePicker());

    this._bindHostInput('login-upd-host');

    this._renderAdminCodes();
    this._updateAdminTopBar();
  },

  _openGradePicker() {
    const self = this;
    const cur = Storage.getAdminGrades().slice();
    const set = {};
    cur.forEach(g => { set[g] = true; });
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center';
    const multi = this._adminTier !== 'normal';
    let listHtml = '<div style="margin-bottom:6px;font-size:12px;color:#8D6E63">' + (multi ? '点击年级可多选；"全部年级"=清除选择' : '仅可选一个年级，点击即选中') + '</div>';
    for (let g = 1; g <= 6; g++) {
      listHtml += '<div data-g="' + g + '" style="padding:12px 16px;border-bottom:1px solid #F0F0F0;font-size:16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center">' + g + '年级<span style="' + (set[g] ? 'color:#2E7D32' : 'color:#BDBDBD') + '">' + (set[g] ? '✓ 已选' : '○') + '</span></div>';
    }
    overlay.innerHTML = '<div style="width:min(320px,90vw);background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.25)">'
      + '<div style="padding:14px 16px;background:#2E7D32;color:#fff;font-weight:700;font-size:15px">选择本机负责年级</div>'
      + '<div style="max-height:340px;overflow-y:auto">' + listHtml + '</div>'
      + '<div style="display:flex;border-top:1px solid #F0F0F0">'
      + (multi ? '<button id="gp-all" style="flex:1;padding:14px;border:none;background:#F5F7FA;font-size:14px;cursor:pointer">全部年级</button>' : '')
      + '<button id="gp-ok" style="flex:1;padding:14px;border:none;background:#2E7D32;color:#fff;font-size:15px;font-weight:700;cursor:pointer">确定</button>'
      + '<button id="gp-cancel" style="flex:1;padding:14px;border:none;background:#F5F7FA;font-size:14px;cursor:pointer">取消</button>'
      + '</div></div>';
    document.body.appendChild(overlay);
    const labelEl = document.getElementById('admin-grade-label');
    const updateLabel = () => {
      const list = Storage.getAdminGrades();
      if (labelEl) labelEl.textContent = list.length ? list.map(x => x + '年级').join('、') : '全部年级';
    };
    overlay.querySelectorAll('[data-g]').forEach(row => {
      row.addEventListener('click', () => {
        const g = row.dataset.g;
        let list = multi ? Storage.getAdminGrades().slice() : [];
        if (list.indexOf(g) === -1) list.push(g);
        else if (multi) list = list.filter(x => x !== g);
        Storage.setAdminGrades(list);
        overlay.querySelectorAll('[data-g] span').forEach(s => {
          s.style.color = '#BDBDBD';
          s.textContent = '○';
        });
        const mark = row.querySelector('span');
        if (mark) {
          const on = list.indexOf(g) !== -1;
          mark.style.color = on ? '#2E7D32' : '#BDBDBD';
          mark.textContent = on ? '✓ 已选' : '○';
        }
        updateLabel();
      });
    });
    const gpAll = document.getElementById('gp-all');
    if (gpAll) gpAll.addEventListener('click', () => {
      Storage.setAdminGrades([]);
      updateLabel();
      overlay.querySelectorAll('[data-g] span').forEach(s => { s.style.color = '#BDBDBD'; s.textContent = '○'; });
    });
    document.getElementById('gp-ok').addEventListener('click', () => {
      const active = document.querySelector('.admin-tab.active');
      if (active && active.id === 'atab-codes') self._renderAdminCodes();
      if (active && active.id === 'atab-students') self._renderAdminStudents();
      if (active && active.id === 'atab-inactive') self._renderInactiveStudents();
      if (active && active.id === 'atab-homework') self._renderAdminHomework();
      if (active && active.id === 'atab-scan') self._renderAdminScan();
      if (active && active.id === 'atab-reports') self._renderAdminReports();
      overlay.remove();
    });
    document.getElementById('gp-cancel').addEventListener('click', () => overlay.remove());
  },

  _updateAdminTopBar() {
    document.getElementById('student-name').style.display = '';
    document.getElementById('student-name').textContent = '管理后台';
    document.getElementById('score-display').textContent = '';
    document.getElementById('streak-count').textContent = '';
    document.getElementById('heart-count').textContent = '';
    document.getElementById('level-badge').textContent = '';
  },

  _renderAdminCodes() {
    const container = document.getElementById('admin-tab-content');

    let html = '<div class="admin-section">';
    html += '<h3 style="margin:0 0 12px;color:var(--primary)">学员注册</h3>';
    html += '<p style="margin:0 0 12px;font-size:13px;color:var(--text-light)">在此为新学员注册账号，注册后学员即可在登录页输入姓名登录。</p>';
    html += '<div class="register-form-v">';
    html += '<input type="text" class="login-input" id="reg-name" placeholder="学员姓名" maxlength="12" autocomplete="off">';
    html += '<select class="login-input" id="reg-grade" style="appearance:auto;-webkit-appearance:auto">';
    for (var g = 1; g <= 6; g++) html += '<option value="' + g + '">' + g + ' 年级</option>';
    html += '</select>';
    html += '<button class="reg-btn" id="reg-btn">注 册</button>';
    html += '<div class="login-error" id="reg-error"></div>';
    html += '<div class="login-error" id="reg-ok" style="color:#2E7D32"></div>';
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;

    document.getElementById('reg-btn').addEventListener('click', () => this._regBtn());
    document.getElementById('reg-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') this._regBtn(); });
  },

  _renderAdminStudents(filterPeriod) {
    this._adminFilter = filterPeriod || this._adminFilter || 'all';
    this._adminGrade = null;
    const container = document.getElementById('admin-tab-content');
    const allData = Storage.getAllStudentsData();
    this._loadRemoteStudents().then(remote => {
      this._renderAdminGradeFolders(container, allData, remote || []);
    });
  },

  _renderAdminGradeFolders(container, allData, remote) {
    const groups = {};
    const tierFilter = this._adminTier === 'normal';
    for (let g = 1; g <= 6; g++) groups[g] = { local: [], remote: [] };
    allData.forEach(d => {
      const g = Storage.getCurrentGrade(d.student);
      if (tierFilter && !this._gradeAllowed(g)) return;
      if (!groups[g]) groups[g] = { local: [], remote: [] };
      groups[g].local.push(d);
    });
    (remote || []).forEach(s => {
      const g = parseInt(s.grade, 10) || 1;
      if (tierFilter && !this._gradeAllowed(g)) return;
      if (!groups[g]) groups[g] = { local: [], remote: [] };
      groups[g].remote.push(s);
    });
    let html = '<div class="admin-filter-bar">';
    html += '<span style="font-size:13px;color:var(--text-light);margin-right:8px">时段：</span>';
    ['all', 'today', 'week', 'month'].forEach(p => {
      html += '<button class="admin-filter-btn' + (this._adminFilter === p ? ' active' : '') + '" data-period="' + p + '">' + ({ all: '全部', today: '今日', week: '本周', month: '本月' }[p]) + '</button>';
    });
    html += '</div>';
    html += '<div style="font-size:12px;color:var(--text-light);margin:10px 0 8px">📂 学员按年级归档，点击年级文件夹查看该年级学员（含电脑端学员库）</div>';
    let any = false;
    for (let g = 1; g <= 6; g++) {
      const lc = groups[g].local.length;
      const rc = groups[g].remote.length;
      if (!lc && !rc) continue;
      any = true;
      html += '<div class="grade-folder" data-grade="' + g + '">';
      html += '<span style="font-size:22px">📁</span>';
      html += '<div style="flex:1"><div style="font-weight:700">' + g + ' 年级</div><div style="font-size:11px;color:var(--text-light)">本机 ' + lc + ' 人 · 电脑端 ' + rc + ' 人</div></div>';
      html += '<span style="color:var(--primary);font-size:13px">进入 →</span>';
      html += '</div>';
    }
    if (!any) {
      html += '<div class="empty-state" style="padding:20px"><p>还没有学员，先在登录页注册学员</p></div>';
    }
    container.innerHTML = html;
    container.querySelectorAll('.admin-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => this._renderAdminStudents(btn.dataset.period));
    });
    container.querySelectorAll('.grade-folder').forEach(el => {
      el.addEventListener('click', () => {
        const g = parseInt(el.dataset.grade, 10);
        this._adminGrade = g;
        this._renderAdminGradeDetail(container, g, groups[g].local, groups[g].remote);
      });
    });
  },

  _renderAdminGradeDetail(container, grade, local, remote) {
    const period = this._adminFilter;
    const periodStart = {
      today: new Date().setHours(0, 0, 0, 0),
      week: Date.now() - 7 * 86400000,
      month: Date.now() - 30 * 86400000,
      all: 0
    };
    let html = '<div class="grade-back" style="cursor:pointer;font-size:13px;color:var(--primary);margin:4px 0 10px">← 返回年级列表</div>';
    html += '<h3 style="margin:0 0 10px">📁 ' + grade + ' 年级</h3>';
    html += '<div class="admin-filter-bar">';
    html += '<span style="font-size:13px;color:var(--text-light);margin-right:8px">时段：</span>';
    ['all', 'today', 'week', 'month'].forEach(p => {
      html += '<button class="admin-filter-btn' + (period === p ? ' active' : '') + '" data-period="' + p + '">' + ({ all: '全部', today: '今日', week: '本周', month: '本月' }[p]) + '</button>';
    });
    html += '</div>';
    if (local.length) {
      local.forEach(d => { html += this._adminStudentCardHtml(d, period, periodStart); });
    }
    if (remote.length) {
      html += '<div class="admin-section" style="margin-top:14px">';
      html += '<h3 style="margin:6px 0">🌐 电脑端学员库（' + grade + '年级）</h3>';
      remote.forEach(s => {
        html += '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--card);border-radius:8px;padding:8px 12px;margin:4px 0">';
        html += '<span style="font-weight:700">' + this._h(s.name) + '</span>';
        html += '<span style="font-size:11px;color:var(--text-light)">' + (s.createdAt ? '注册 ' + new Date(s.createdAt).toLocaleDateString('zh-CN') : '') + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }
    if (!local.length && !remote.length) {
      html += '<div class="empty-state" style="padding:20px"><p>该年级暂无学员</p></div>';
    }
    container.innerHTML = html;
    container.querySelectorAll('.grade-back').forEach(el => el.addEventListener('click', () => this._renderAdminStudents(period)));
    container.querySelectorAll('.admin-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => this._renderAdminStudents(btn.dataset.period));
    });
    document.querySelectorAll('.asc-del-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sid = parseInt(btn.dataset.sid);
        const name = btn.dataset.name;
        const grade = btn.dataset.grade || Storage.getCurrentGrade({ id: sid }) || '';
        if (confirm('确定要删除学员"' + name + '"及其所有学习数据吗？此操作不可恢复。')) {
          Storage.deleteStudent(sid);
          Storage.addPendingStudentRemoval(name, grade);
          this._pushStudentsToHost([{ name: name, grade: grade }]);
          this._renderAdminStudents();
        }
      });
    });
    document.querySelectorAll('.share-img-card-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sid = parseInt(btn.dataset.sid);
        const name = btn.dataset.name;
        const data = Storage.getStudentData(sid);
        let sessions = data.sessions.filter(s => s.completed && s.type !== 'zhFly');
        let totalMin = 0; sessions.forEach(s => { totalMin += Math.max(1, Math.round((s.duration || 0) / 60)); });
        const previewDiv = document.getElementById('preview-' + sid);
        let wwc = 0; try { const p = Storage.getStudent(); Storage.loginStudent(sid); wwc = Storage.getWrongWords().length; if (p) Storage.loginStudent(p); else Storage.logout(); } catch (e) {}
        const archived = this._getArchivedReportForStudent(sid);
        if (archived && archived.stats) {
          const rep = archived.stats;
          if (totalMin === 0 && rep.minutes > 0) totalMin = rep.minutes;
          if (sessions.length === 0 && rep.history > 0) {
            sessions = [{ completed: true, type: 'report-merged', correctCount: rep.wrongs != null ? Math.round((rep.history * 80) / 100) : 0, wrongCount: rep.wrongs || 0, totalItems: rep.wrongs != null ? Math.round((rep.history * 80) / 100) + rep.wrongs : 0, duration: (rep.minutes || 0) * 60, startTime: rep.lastPractice || new Date().toISOString(), subject: 'english' }];
            data.progress = data.progress || {};
            data.progress.totalXP = rep.xp || data.progress.totalXP || 0;
            data.progress.level = rep.level || data.progress.level || 1;
            data.progress.streak = rep.streak || data.progress.streak || 0;
            data.progress.completedLessons = data.progress.completedLessons || {};
            if (rep.lessons) for (let _i = 0; _i < rep.lessons; _i++) data.progress.completedLessons['rpt_' + _i] = true;
          }
          if (rep.subjects) {
            const subKeys = Object.keys(rep.subjects);
            subKeys.forEach(sk => { const ss = rep.subjects[sk]; if (ss && ss.sessions > 0 && !sessions.some(s => s.subject === sk)) { for (let _si = 0; _si < ss.sessions; _si++) { sessions.push({ completed: true, type: 'report-merged', subject: sk, correctCount: Math.round(ss.total * (ss.accuracy || 80) / 100 / Math.max(1, ss.sessions)), wrongCount: Math.round(ss.total * (100 - (ss.accuracy || 80)) / 100 / Math.max(1, ss.sessions)), totalItems: Math.round(ss.total / Math.max(1, ss.sessions)), duration: Math.round(ss.minutes * 60 / Math.max(1, ss.sessions)), startTime: rep.lastPractice || new Date().toISOString() }); } } });
          }
        }
        this._generateShareImage(data, sessions, totalMin, name, previewDiv, wwc);
      });
    });
  },

  _adminStudentCardHtml(d, period, periodStart) {
    const allSessions = d.sessions.filter(s => s.completed);
    const start = (periodStart && periodStart[period]) || 0;
    const sessions = start ? allSessions.filter(s => new Date(s.startTime).getTime() >= start) : allSessions;
    const completed = Object.keys(d.progress.completedLessons).length;
    const wrongCount = sessions.reduce((sum, s) => sum + (s.wrongCount != null ? s.wrongCount : (s.totalItems - s.correctCount)), 0);
    const correctCount = sessions.reduce((sum, s) => sum + (s.correctCount || 0), 0);
    const totalItems = sessions.reduce((sum, s) => sum + (s.totalItems || 0), 0);
    const accuracy = totalItems > 0 ? Math.round((correctCount / totalItems) * 100) : 0;
    let totalMin = 0; sessions.forEach(s => { totalMin += Math.round((s.duration || 0) / 60); });
    const lastDate = d.progress.lastPracticeDate || '—';
    let wrongWordCount = 0;
    try {
      const prevId = Storage.getStudent();
      Storage.loginStudent(d.student.id);
      wrongWordCount = Storage.getWrongWords().length;
      if (prevId) Storage.loginStudent(prevId); else Storage.logout();
    } catch (e) { wrongWordCount = 0; }

    const typeCount = {};
    sessions.forEach(s => { const t = s.type || 'exercise'; typeCount[t] = (typeCount[t] || 0) + 1; });

    let html = '<div class="admin-student-card">';
    html += '<div class="asc-header"><strong class="asc-name">' + this._h(d.student.name) + '</strong><span class="asc-date">' + Storage.getCurrentGrade(d.student) + '年级 · 注册：' + new Date(d.student.createdAt).toLocaleDateString('zh-CN') + '</span><button class="asc-del-btn" data-sid="' + d.student.id + '" data-name="' + this._h(d.student.name) + '" data-grade="' + Storage.getCurrentGrade(d.student) + '">✕</button></div>';
    html += '<div class="asc-grid">';
    html += '<div class="asc-item"><span class="asc-val">' + (d.progress.totalXP || 0) + '</span><span class="asc-lbl">得分</span></div>';
    html += '<div class="asc-item"><span class="asc-val">Lv.' + (d.progress.level || 1) + '</span><span class="asc-lbl">等级</span></div>';
    html += '<div class="asc-item"><span class="asc-val">' + completed + '课</span><span class="asc-lbl">完成课程</span></div>';
    html += '<div class="asc-item"><span class="asc-val">' + totalMin + '分</span><span class="asc-lbl">学习时长</span></div>';
    html += '<div class="asc-item"><span class="asc-val">' + sessions.length + '次</span><span class="asc-lbl">练习次数</span></div>';
    html += '<div class="asc-item"><span class="asc-val" style="color:var(--primary)">' + accuracy + '%</span><span class="asc-lbl">正确率</span></div>';
    html += '<div class="asc-item"><span class="asc-val">' + correctCount + '</span><span class="asc-lbl">正确题数</span></div>';
    html += '<div class="asc-item"><span class="asc-val" style="color:var(--red)">' + wrongCount + '</span><span class="asc-lbl">错题数</span></div>';
    html += '<div class="asc-item"><span class="asc-val" style="color:var(--red)">' + wrongWordCount + '</span><span class="asc-lbl">待复习错题</span></div>';
    html += '<div class="asc-item"><span class="asc-val">' + (d.progress.streak || 0) + '天</span><span class="asc-lbl">连续天数</span></div>';
    html += '<div class="asc-item"><span class="asc-val">' + lastDate + '</span><span class="asc-lbl">最近练习</span></div>';
    html += '<div class="asc-item"><span class="asc-val">' + (typeCount.exercise || 0) + '/' + (typeCount.flashcard || 0) + '/' + (typeCount.reading || 0) + '</span><span class="asc-lbl">练习/闪卡/课文</span></div>';
    html += '</div>';
    const subStats = { english: {correct:0,wrong:0,min:0,cnt:0}, chinese: {correct:0,wrong:0,min:0,cnt:0}, math: {correct:0,wrong:0,min:0,cnt:0} };
    allSessions.forEach(s => { const sub = s.subject || 'english'; if (subStats[sub]) { subStats[sub].correct += s.correctCount || 0; subStats[sub].wrong += s.wrongCount || 0; subStats[sub].min += Math.round((s.duration||0)/60); subStats[sub].cnt++; } });
    const subLabels = {english:'英语',chinese:'语文',math:'数学'};
    const subColors = {english:'#1565C0',chinese:'#C62828',math:'#2E7D32'};
    let hasSubData = false;
    ['english','chinese','math'].forEach(sk => { if (subStats[sk].cnt > 0) hasSubData = true; });
    if (hasSubData) {
      html += '<div style="margin:8px 0;padding:8px;background:rgba(0,0,0,0.03);border-radius:8px">';
      html += '<div style="font-size:11px;color:var(--text-light);margin-bottom:6px">📚 分科目学习</div>';
      ['english','chinese','math'].forEach(sk => { const st = subStats[sk]; if (st.cnt === 0) return; const acc = (st.correct+st.wrong) > 0 ? Math.round(st.correct/(st.correct+st.wrong)*100) : 0; html += '<div style="display:flex;align-items:center;gap:6px;margin:3px 0;font-size:12px"><span style="color:'+subColors[sk]+';font-weight:700;width:28px">'+subLabels[sk]+'</span><div style="flex:1;height:6px;background:#e0e0e0;border-radius:3px;overflow:hidden"><div style="height:100%;width:'+acc+'%;background:'+subColors[sk]+';border-radius:3px"></div></div><span style="font-size:11px;color:var(--text-light);width:60px;text-align:right">'+st.cnt+'次·'+acc+'%</span></div>'; });
      html += '</div>';
    }
    html += '<button class="share-img-card-btn" style="font-size:12px;padding:6px 14px;margin-top:6px" data-sid="' + d.student.id + '" data-name="' + this._h(d.student.name) + '">📸 生成分享图</button>';
    html += '<div class="share-card-preview" id="preview-' + d.student.id + '"></div>';
    html += '</div>';
    return html;
  },

  _renderInactiveStudents(filterPeriod) {
    this._adminFilter = filterPeriod || this._adminFilter || 'today';
    const container = document.getElementById('admin-tab-content');
    const local = Storage.getAllStudentsData();
    const self = this;
    this._loadRemoteStudents().then(remote => {
      self._loadRemoteReports().then(reports => {
        self._renderInactiveMerged(container, local, remote || [], reports || []);
      });
    }).catch(() => {
      self._renderInactiveMerged(container, local, [], []);
    });
  },

  _loadRemoteReports() {
    return new Promise((resolve) => {
      try {
        const host = this._getSavedHost();
        if (!host) { resolve([]); return; }
        this._lanGet('http://' + host + ':8899/reports').then(res => {
          try {
            const j = JSON.parse(res.body || '{}');
            resolve((j.reports || []).slice());
          } catch (e) { resolve([]); }
        }).catch(() => resolve([]));
      } catch (e) { resolve([]); }
    });
  },

  _reportDate(r) {
    try {
      if (r && r.stats && r.stats.lastPractice) return String(r.stats.lastPractice);
      if (r && r.updatedAt) return String(r.updatedAt).slice(0, 10);
    } catch (e) {}
    return '';
  },

  _repLastTime(r) {
    try {
      const t = new Date(this._reportDate(r) + 'T00:00:00').getTime();
      if (isFinite(t)) return t;
    } catch (e) {}
    return 0;
  },

  _renderInactiveMerged(container, local, remote, reports) {
    const period = this._adminFilter;
    const now = Date.now();
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const periodStart = { today: todayStart, week: now - 7 * 86400000, month: now - 30 * 86400000, all: 0 };
    const labels = { today: '今天', week: '近7天', month: '近30天', all: '从未练习' };

    const byName = {};
    local.forEach(d => {
      const g = Storage.getCurrentGrade(d.student);
      if (!this._gradeAllowed(g)) return;
      const key = String(d.student.name || '').trim() + '|' + g;
      byName[key] = { d: d, grade: g, lastTime: this._lastSessionTime(d.sessions) };
    });

    const repByName = {};
    (reports || []).forEach(r => {
      const g = parseInt(r.grade, 10) || 1;
      if (!this._gradeAllowed(g)) return;
      const key = String(r.name || '').trim() + '|' + g;
      const cur = repByName[key];
      if (!cur || String(r.updatedAt || '') > String(cur.updatedAt || '')) repByName[key] = r;
    });

    const merged = {};
    Object.keys(byName).forEach(k => {
      const item = byName[k];
      const rep = repByName[k];
      const repT = this._repLastTime(rep);
      const repStats = (rep && rep.stats) || {};
      merged[k] = {
        name: item.d.student.name,
        grade: item.grade,
        createdAt: item.d.student.createdAt || '',
        sessions: item.d.sessions,
        lastTime: Math.max(item.lastTime || 0, repT),
        totalXP: repStats.xp != null ? repStats.xp : (item.d.progress.totalXP || 0),
        lessons: repStats.lessons != null ? repStats.lessons : Object.keys(item.d.progress.completedLessons || {}).length,
        hist: repStats.history != null ? repStats.history : (item.d.sessions || []).length,
        streak: repStats.streak != null ? repStats.streak : (item.d.progress.streak || 0),
        source: rep ? 'remote' : 'local'
      };
    });
    (remote || []).forEach(s => {
      const g = parseInt(s.grade, 10) || 1;
      if (!this._gradeAllowed(g)) return;
      const nm = String(s.name || '').trim();
      if (!nm) return;
      const key = nm + '|' + g;
      if (merged[key]) { if (!merged[key].lastTime) merged[key].lastTime = this._repLastTime(repByName[key]); return; }
      const rep = repByName[key];
      const repT = this._repLastTime(rep);
      const repStats = (rep && rep.stats) || {};
      merged[key] = {
        name: s.name,
        grade: g,
        createdAt: s.createdAt || '',
        sessions: [],
        lastTime: repT,
        totalXP: repStats.xp != null ? repStats.xp : 0,
        lessons: repStats.lessons != null ? repStats.lessons : 0,
        hist: repStats.history != null ? repStats.history : 0,
        streak: repStats.streak != null ? repStats.streak : 0,
        source: rep ? 'remote' : 'remote'
      };
    });

    const list = Object.keys(merged).map(k => merged[k]).sort((a, b) => {
      if (a.grade !== b.grade) return a.grade - b.grade;
      return String(a.name).localeCompare(String(b.name), 'zh');
    });

    let html = '<div class="admin-filter-bar">';
    html += '<span style="font-size:13px;color:var(--text-light);margin-right:8px">未练习时段：</span>';
    ['today', 'week', 'month', 'all'].forEach(p => {
      html += '<button class="admin-filter-btn' + (period === p ? ' active' : '') + '" data-period="' + p + '">' + labels[p] + '</button>';
    });
    html += '</div>';
    html += '<div style="font-size:12px;color:var(--text-light);margin:10px 0 8px">📋 已合并各平板上报数据，多台平板显示一致；仅展示本机负责年级</div>';

    let count = 0;
    list.forEach(x => {
      const start = periodStart[period] || 0;
      const hasPractice = start ? (x.lastTime > 0 && x.lastTime >= start) : x.lastTime > 0;
      if (hasPractice) return;
      count++;
      html += '<div class="admin-student-card">';
      html += '<div class="asc-header"><strong class="asc-name">' + this._h(x.name) + '</strong>';
      html += '<span class="asc-date">' + x.grade + '年级' + (x.source === 'remote' ? ' · 他机学员' : '') + ' · 注册：' + (x.createdAt ? new Date(x.createdAt).toLocaleDateString('zh-CN') : '—') + '</span>';
      if (x.lastTime > 0) {
        html += '<span style="font-size:10px;color:var(--red)"> 最后练习：' + new Date(x.lastTime).toLocaleDateString('zh-CN') + '</span>';
      } else {
        html += '<span style="font-size:10px;color:var(--red)"> 从未练习</span>';
      }
      html += '</div>';
      html += '<div class="asc-grid">';
      html += '<div class="asc-item"><span class="asc-val">' + x.totalXP + '</span><span class="asc-lbl">总得分</span></div>';
      html += '<div class="asc-item"><span class="asc-val">' + x.lessons + '课</span><span class="asc-lbl">已完成</span></div>';
      html += '<div class="asc-item"><span class="asc-val">' + x.hist + '次</span><span class="asc-lbl">历史练习</span></div>';
      html += '<div class="asc-item"><span class="asc-val">' + x.streak + '天</span><span class="asc-lbl">连续天数</span></div>';
      html += '</div></div>';
    });

    if (count === 0) {
      html += '<div class="empty-state" style="padding:20px"><p>🎉 ' + labels[period] + '所有学员都有练习记录</p></div>';
    }

    container.innerHTML = html;

    document.querySelectorAll('.admin-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._renderInactiveStudents(btn.dataset.period);
      });
    });
  },

  _lastSessionTime(sessions) {
    try {
      let t = 0;
      (sessions || []).forEach(s => {
        if (s && s.completed) {
          const st = new Date(s.startTime).getTime();
          if (isFinite(st) && st > t) t = st;
        }
      });
      return t;
    } catch (e) { return 0; }
  },

  _getWordBank() {
    if (this._wordBank) return this._wordBank;
    this._wordBank = {};
    const addWords = (list) => {
      (list || []).forEach(w => {
        const en = w && (w.en || w.zi);
        if (en) this._wordBank[String(en).toLowerCase().trim()] = true;
      });
    };
    const addDataSet = (d) => {
      if (!d) return;
      (d.grades || []).forEach(g => (g.modules || []).forEach(m => (m.units || []).forEach(u => addWords(u.words))));
    };
    addDataSet(this.getCourseData());
    try { if (typeof PHONICS_DATA !== 'undefined') addDataSet(PHONICS_DATA); } catch (e) {}
    try { if (typeof MATH_DATA !== 'undefined') addDataSet(MATH_DATA); } catch (e) {}
    try { if (typeof CHINESE_DATA !== 'undefined') addDataSet(CHINESE_DATA); } catch (e) {}
    return this._wordBank;
  },

  _renderAdminHomework() {
    const container = document.getElementById('admin-tab-content');
    const adminGrades = Storage.getAdminGrades();
    const gradeFilter = (g) => {
      if (!adminGrades.length) return true;
      return adminGrades.indexOf(String(g).replace('年级', '')) !== -1;
    };
    let html = '<div class="admin-section">';
    html += '<p style="margin:0 0 10px;font-size:13px;color:var(--text-light)">点击学员可为其单独布置；也可勾选多位学员，一次给选中学员布置同一份作业（保存后自动发送，学员在"每天必练"中接收完成；编辑器内可切换英语/语文/数学）</p>';
    html += '<div id="hw-all-list"></div>';
    html += '<div style="margin-top:10px"><button class="login-btn" id="hw-multi-btn" style="width:100%">✏️ 为 0 位选中学员布置作业</button></div>';
    html += '</div>';
    container.innerHTML = html;

    const list = [];
    const cols = [
      { icon: '📗', subj: 'english', label: '英语' },
      { icon: '📘', subj: 'chinese', label: '语文' },
      { icon: '📙', subj: 'math', label: '数学' }
    ];
    (Storage.getStudents() || []).forEach(s => {
      const g = Storage.getCurrentGrade(s);
      if (!gradeFilter(g)) return;
      list.push({
        name: s.name,
        grade: g,
        localId: s.id,
        hw: {
          english: Storage.getHomework(s.id),
          chinese: Storage.getHomeworkZh(s.id),
          math: Storage.getHomeworkMath(s.id)
        }
      });
    });

    const listEl = document.getElementById('hw-all-list');
    const checkedIdx = {};
    const render = () => {
      let h = '';
      list.forEach((item, idx) => {
        h += '<div class="asc-item" style="cursor:pointer" data-idx="' + idx + '">';
        h += '<input type="checkbox" class="hw-check" data-idx="' + idx + '"' + (checkedIdx[idx] ? ' checked' : '') + ' style="margin-top:8px;width:18px;height:18px;flex-shrink:0">';
        h += '<div style="flex:1">';
        h += '<div class="asc-val">' + this._h(item.name) + ' · ' + this._h(item.grade) + '年级</div>';
        if (item.hw) {
          cols.forEach(c => {
            const hw = item.hw[c.subj];
            if (!hw) return;
            const words = this.getHomeworkWords(hw, c.subj).length;
            if (words === 0) return;
            const unitTxt = c.subj === 'chinese' ? '字' : c.subj === 'math' ? '题' : '词';
            h += '<div class="asc-lbl">' + c.label + ' ' + c.icon + ' ' + words + ' ' + unitTxt
              + (hw.assignedAt ? '（' + new Date(hw.assignedAt).toLocaleDateString('zh-CN') + '）' : '') + '</div>';
          });
        }
        h += '</div>';
        h += '<span style="color:var(--primary);font-size:13px">✏️ 布置</span>';
        h += '</div>';
      });
      if (!list.length) {
        h += '<div class="empty-state" style="padding:16px">' + (adminGrades.length ? '本机负责年级暂无学员' : '暂无学员') + '</div>';
      }
      listEl.innerHTML = h;
      listEl.querySelectorAll('.asc-item').forEach(el => {
        el.addEventListener('click', () => {
          const item = list[parseInt(el.dataset.idx)];
          if (!item) return;
          this._renderHomeworkEditor({ name: item.name, grade: item.grade, localId: item.localId }, true);
        });
      });
      const updateMultiBtn = () => {
        const n = document.querySelectorAll('#hw-all-list .hw-check:checked').length;
        const b = document.getElementById('hw-multi-btn');
        if (b) b.textContent = '✏️ 为 ' + n + ' 位选中学员布置作业';
      };
      listEl.querySelectorAll('.hw-check').forEach(cb => {
        cb.addEventListener('click', (e) => e.stopPropagation());
        cb.addEventListener('change', () => {
          checkedIdx[cb.dataset.idx] = cb.checked;
          updateMultiBtn();
        });
      });
      document.getElementById('hw-multi-btn').addEventListener('click', () => {
        const sel = [];
        document.querySelectorAll('#hw-all-list .hw-check:checked').forEach(cb => {
          const item = list[parseInt(cb.dataset.idx)];
          if (item) sel.push(item);
        });
        if (!sel.length) { return; }
        this._renderHomeworkEditorMany(sel);
      });
    };
    render();

    try {
      const host = this._getSavedHost();
      if (host) {
        this._lanGet('http://' + host + ':8899/students').then(res => {
          try {
            const j = JSON.parse(res.body || '{}');
            const arr = (j.students || []).slice();
            if (!arr.length) return;
            arr.forEach(s => {
              const grade = String(s.grade || '').replace('年级', '');
              if (!gradeFilter(grade)) return;
              if (list.some(x => x.name === s.name && String(x.grade) === grade)) return;
              list.push({ name: s.name, grade: grade, localId: null, hw: null });
            });
            render();
          } catch (e) {}
        });
      }
    } catch (e) {}
  },

  _renderHomeworkEditorMany(students) {
    const container = document.getElementById('admin-tab-content');
    if (!students || !students.length) { this._renderAdminHomework(); return; }
    this._hwEditorStudent = null;
    const first = students[0];
    const prev = this._hwEditor || {
      subject: 'english', gradeId: null, picked: {}, expandedUnit: null, manual: [], manualNotInBank: {}
    };
    const subject = prev.subject || 'english';
    const fakeStudent = { name: first.name, grade: first.grade != null ? first.grade : '', id: first.localId };
    let gradeId = prev.gradeId && prev.gradeKey === subject ? prev.gradeId : this._pickSubjectGrade(subject, fakeStudent);
    this._hwEditor = {
      students: students.map(s => ({ name: s.name, grade: s.grade, localId: s.localId != null ? s.localId : null })),
      studentId: null,
      studentName: null,
      studentGrade: null,
      remote: false,
      subject: subject,
      gradeKey: subject,
      gradeId: gradeId,
      picked: prev.picked || {},
      expandedUnit: prev.expandedUnit || null,
      manual: prev.manual || [],
      manualNotInBank: prev.manualNotInBank || {}
    };
    this._renderHomeworkEditorUI();
  },

  _renderHomeworkEditor(student, remoteLabel, subject) {
    const container = document.getElementById('admin-tab-content');
    if (!student) { this._renderAdminHomework(); return; }
    const local = !remoteLabel;
    if (local && !Storage.getStudents().some(s => s.id === student.id)) { this._renderAdminHomework(); return; }
    this._hwEditorStudent = { student: student, remote: !!remoteLabel };
    const localId = local ? student.id : (student.localId != null ? student.localId : null);

    const prev = this._hwEditor || {
      subject: 'english', gradeId: null, picked: {}, expandedUnit: null, manual: [], manualNotInBank: {}
    };
    if (!subject) subject = prev.subject || 'english';
    let gradeId = prev.gradeId && prev.gradeKey === subject ? prev.gradeId : null;
    if (!gradeId) {
      gradeId = this._pickSubjectGrade(subject, student);
    }
    this._hwEditor = {
      studentId: localId,
      studentName: student.name,
      studentGrade: student.grade || Storage.getCurrentGrade(student),
      remote: !!remoteLabel,
      subject: subject,
      gradeKey: subject,
      gradeId: gradeId,
      picked: prev.picked || {},
      expandedUnit: prev.expandedUnit || null,
      manual: prev.manual || [],
      manualNotInBank: prev.manualNotInBank || {}
    };

    this._renderHomeworkEditorUI();
  },

  _pickSubjectGrade(subject, student) {
    const data = this._getSubjectData(subject);
    const grades = data && data.grades ? data.grades : [];
    if (grades.length === 0) return null;
    const cur = Storage.getCurrentGrade(student);
    const now = new Date().getMonth() + 1;
    const wantSem = (now >= 9 || now <= 2) ? '1' : '2';
    const semNorm = (s) => s === '上' || s === '上册' ? '1' : s === '下' || s === '下册' ? '2' : String(s);
    const g = grades.find(x => String(x.grade) === String(cur) && semNorm(x.semester) === wantSem)
      || grades.find(x => String(x.grade) === String(cur))
      || grades[0];
    return g ? g.id : grades[0].id;
  },

  _getStudentSemesters(student) {
    const grades = this.getCourseData().grades;
    const cur = Storage.getCurrentGrade(student);
    const now = new Date().getMonth() + 1;
    const wantSem = (now >= 9 || now <= 2) ? 1 : 2;
    const curG = grades.find(x => x.grade === cur && x.semester === wantSem) || grades.find(x => x.grade === cur);
    let nextG = null;
    if (curG) {
      nextG = curG.semester === 1
        ? (grades.find(x => x.grade === curG.grade && x.semester === 2) || null)
        : (grades.find(x => x.grade === curG.grade + 1 && x.semester === 1) || null);
    }
    return { curId: curG ? curG.id : 0, nextId: nextG ? nextG.id : 0 };
  },

  _renderHomeworkEditorUI() {
    const container = document.getElementById('admin-tab-content');
    const st = this._hwEditor;
    let student = null;
    if (st.students && st.students.length) {
      student = { name: st.students[0].name, grade: st.students[0].grade != null ? st.students[0].grade : '' };
    } else if (st.remote) {
      student = { name: st.studentName, grade: st.studentGrade };
    } else {
      student = Storage.getStudents().find(s => s.id === st.studentId);
    }
    if (!student) { this._renderAdminHomework(); return; }
    const bank = this._getWordBank();
    const data = this._getSubjectData(st.subject);
    const allGrades = data && data.grades ? data.grades : [];

    let html = '<div class="admin-section">';
    html += '<button class="back-btn" onclick="App._hwBack()">← 返回上一级</button>';
    if (st.students && st.students.length > 1) {
      html += '<h3 style="margin:10px 0">✏️ 为 ' + st.students.length + ' 位学员布置作业</h3>';
      html += '<div style="font-size:12px;color:var(--text-light);margin-bottom:6px">' + st.students.map(s => this._h(s.name) + (s.grade != null ? '（' + this._h(s.grade) + '年级）' : '')).join('、') + '</div>';
    } else {
      html += '<h3 style="margin:10px 0">✏️ 为 ' + this._h(student.name) + ' 布置作业</h3>';
    }

    const subjMeta = {
      english: { icon: '📗', label: '英语' },
      chinese: { icon: '📘', label: '语文' },
      math: { icon: '📙', label: '数学' }
    };
    html += '<div style="display:flex;gap:8px;margin:10px 0">';
    ['english', 'chinese', 'math'].forEach(s => {
      html += '<button class="hw-subj-tab admin-gen-btn" data-subj="' + s + '" style="flex:1;' + (st.subject === s ? 'background:var(--primary);color:#fff;border-color:var(--primary)' : '') + '">' + subjMeta[s].icon + ' ' + subjMeta[s].label + '</button>';
    });
    html += '</div>';

    html += '<div style="margin:10px 0">';
    html += '<label style="font-size:13px;color:var(--text-light)">选择年级/学期（可预习下学期，也可复习任意学期）：</label>';
    html += '<select id="hw-grade" class="login-input" style="margin-top:4px;appearance:auto;-webkit-appearance:auto">';
    allGrades.forEach(g => {
      let semTxt = g.semester;
      if (String(semTxt) === '1') semTxt = '上册';
      else if (String(semTxt) === '2') semTxt = '下册';
      html += '<option value="' + g.id + '"' + (g.id === st.gradeId ? ' selected' : '') + '>' + this._h(g.title) + (String(semTxt) === g.title ? '' : '（' + semTxt + '）') + '</option>';
    });
    html += '</select>';
    html += '</div>';

    const grade = allGrades.find(x => x.id === st.gradeId);
    if (grade) {
      const pickLabel = st.subject === 'chinese' ? '点点选汉字（可多选，展开逐字勾选）' : st.subject === 'math' ? '点单元选算式/口诀（可多选，可展开逐项勾选）' : '点单元选单词/短语（可多选，可展开逐词勾选）';
      html += '<h4 style="margin:12px 0 6px;color:var(--primary)">' + pickLabel + '</h4>';
      html += '<div style="max-height:340px;overflow-y:auto;border:1px solid #EEE;border-radius:8px;padding:8px 10px">';
      grade.modules.forEach(m => {
        m.units.forEach(u => {
          const uk = (w) => {
            if (st.subject === 'chinese') return 'c:' + u.id + ':' + String(w.zi).trim();
            if (st.subject === 'math') return 'm:' + u.id + ':' + String(w.en).toLowerCase().trim();
            return u.id + ':' + String(w.en).toLowerCase().trim();
          };
          let unitPicked = 0;
          u.words.forEach(w => { if (st.picked[uk(w)]) unitPicked++; });
          const open = st.expandedUnit === u.id;
          html += '<div style="margin-bottom:6px">';
          html += '<button class="hw-unit-row" data-uid="' + u.id + '" style="width:100%;display:flex;align-items:center;gap:6px;padding:9px 10px;background:' + (open ? 'var(--primary)' : '#F5F7FA') + ';color:' + (open ? '#fff' : 'var(--text)') + ';border:1px solid ' + (open ? 'var(--primary)' : '#E0E0E0') + ';border-radius:8px;font-size:14px;text-align:left">';
          html += '<span style="flex:1">' + this._h(u.title) + '</span>';
          html += '<span style="font-size:12px;opacity:.8">' + unitPicked + '/' + u.words.length + ' 已选</span>';
          html += '<span style="font-size:11px">' + (open ? '▲' : '▼') + '</span>';
          html += '</button>';
          if (open) {
            html += '<div class="hw-unit-words" style="border:1px solid #EEE;border-top:none;border-radius:0 0 8px 8px;padding:4px 10px 8px">';
            html += '<div style="display:flex;gap:8px;justify-content:flex-end;padding:4px 0">';
            html += '<a href="javascript:void(0)" class="hw-pick-all" data-uid="' + u.id + '" style="font-size:12px;color:var(--primary)">全选</a>';
            html += '<a href="javascript:void(0)" class="hw-pick-none" data-uid="' + u.id + '" style="font-size:12px;color:#C62828">清空本单元</a>';
            html += '</div>';
            u.words.forEach(w => {
              const key = uk(w);
              const checked = st.picked[key] ? ' checked' : '';
              html += '<label style="display:flex;align-items:flex-start;gap:6px;padding:4px 0;font-size:13px">';
              html += '<input type="checkbox" class="hw-word" data-key="' + key + '"' + checked + ' style="margin-top:2px">';
              if (st.subject === 'chinese') {
                html += '<span style="flex:1;word-break:break-all"><strong style="font-size:17px">' + this._h(w.zi) + '</strong> <small style="color:var(--text-light)">' + this._h(w.pinyin) + '</small> <small style="color:var(--text-light)">' + this._h(w.yi) + '</small></span>';
              } else if (st.subject === 'math') {
                html += '<span style="flex:1;word-break:break-all"><strong>' + this._h(w.en) + '</strong> <small style="color:var(--text-light)">' + this._h(w.cn) + '</small></span>';
              } else {
                html += '<span style="flex:1;word-break:break-all"><strong>' + this._h(w.en) + '</strong> <small style="color:var(--text-light)">' + this._h(w.cn) + '</small></span>';
              }
              html += '</label>';
            });
            html += '</div>';
          }
          html += '</div>';
        });
      });
      html += '</div>';
    } else {
      html += '<p style="color:#C62828;font-size:13px">未找到该年级课程数据</p>';
    }

    const pickItems = [];
    Storage.getWeekWrongs().forEach(w => {
      const t = String(w.text || '').trim();
      if (t && String(w.subject) === st.subject) pickItems.push({ src: 'week', text: t, name: w.studentName || '学员' });
    });
    Storage.getStudents().forEach(s => {
      if (!this._gradeAllowed(Storage.getCurrentGrade(s))) return;
      Storage.getWrongQuestions(s.id).forEach(q => {
        const t = String(q.text || '').trim();
        if (t && String(q.subject) === st.subject) pickItems.push({ src: 'wrong', text: t, name: s.name });
      });
    });
    html += '<h4 style="margin:14px 0 6px;color:var(--primary)">📥 从错题库选题（点击即加入作业，不校验词库）</h4>';
    html += '<div style="border:1px solid #FFE082;background:#FFF8E1;border-radius:8px;padding:8px 10px;max-height:240px;overflow-y:auto">';
    if (pickItems.length === 0) {
      html += '<div style="font-size:12px;color:var(--text-light)">错题库暂无 ' + this._subjName(st.subject) + ' 题目（可在"扫描入库"中勾选错题生成）</div>';
    } else {
      pickItems.forEach((it, idx) => {
        const done = st.manual.indexOf(it.text) !== -1;
        html += '<label style="display:flex;align-items:flex-start;gap:6px;padding:3px 0;font-size:13px">';
        html += '<input type="checkbox" class="hw-wrong-pick" data-idx="' + idx + '"' + (done ? ' checked' : '') + ' style="margin-top:2px">';
        html += '<span style="flex:1;word-break:break-all">' + this._h(it.text) + '</span>';
        html += '<small style="color:' + (it.src === 'week' ? '#B8860B' : '#8D6E63') + ';flex-shrink:0">' + (it.src === 'week' ? '📥' : '📂') + this._h(it.name) + '</small>';
        html += '</label>';
      });
    }
    html += '</div>';

    const manuLabel = st.subject === 'chinese' ? '手动补充汉字' : st.subject === 'math' ? '手动补充算式/口诀' : '手动补充单词';
    const manuPh = st.subject === 'chinese' ? '输入汉字，多个用逗号分隔' : st.subject === 'math' ? '输入算式或口诀，多个用逗号分隔' : '输入单词，多个用逗号分隔';
    html += '<h4 style="margin:14px 0 6px;color:var(--primary)">' + manuLabel + '</h4>';
    html += '<div style="display:flex;gap:6px">';
    html += '<input type="text" class="login-input" id="hw-manual-input" placeholder="' + manuPh + '" style="flex:1" autocomplete="off">';
    html += '<button class="admin-gen-btn" id="hw-manual-add">添加</button>';
    html += '</div>';
    html += '<div id="hw-manual-msg" style="font-size:12px;min-height:18px;margin:4px 0"></div>';

    if (st.manual.length > 0) {
      html += '<div style="margin:6px 0">';
      st.manual.forEach(w => {
        const bad = st.manualNotInBank[w];
        html += '<span style="display:inline-block;background:' + (bad ? '#FFEBEE' : '#E8F5E9') + ';border:1px solid ' + (bad ? '#EF9A9A' : '#A5D6A7') + ';border-radius:12px;padding:3px 10px;margin:3px;font-size:13px">';
        html += this._h(w) + (bad ? ' ⚠️' : '') + ' <a href="javascript:void(0)" data-del="' + this._h(w) + '" style="color:#C62828;font-weight:bold">✕</a>';
        html += '</span>';
      });
      html += '</div>';
    }

    const unitWordTxt = st.subject === 'chinese' ? '字' : st.subject === 'math' ? '题' : '词';
    const pickedCount = Object.keys(st.picked).length;
    const totalWords = pickedCount + st.manual.length;
    html += '<div style="margin:12px 0;padding:10px 14px;background:#F5F7FA;border-radius:10px;font-size:13px;color:var(--text-light)">';
    html += '已选 <strong>' + pickedCount + '</strong> 项 · 手动 <strong>' + st.manual.length + '</strong> 项 · 作业共 <strong>' + totalWords + '</strong> ' + unitWordTxt + '</div>';

    html += '<div style="display:flex;gap:10px;margin-top:8px">';
    html += '<button class="login-btn" id="hw-save" style="flex:1">💾 保存并发送</button>';
    html += '<button class="admin-gen-btn" id="hw-clear" style="flex:1">清空重选</button>';
    html += '</div>';
    html += '</div>';
    container.innerHTML = html;

    document.getElementById('hw-grade').addEventListener('change', (e) => {
      st.gradeId = parseInt(e.target.value);
      st.picked = {};
      st.expandedUnit = null;
      this._renderHomeworkEditorUI();
    });

    document.querySelectorAll('.hw-subj-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const ns = btn.dataset.subj;
        if (ns === st.subject) return;
        st.subject = ns;
        st.gradeId = this._pickSubjectGrade(ns, student);
        st.picked = {};
        st.expandedUnit = null;
        st.manual = [];
        st.manualNotInBank = {};
        st.lastMsg = '';
        this._renderHomeworkEditorUI();
      });
    });

    const keyOf = (w, uid) => {
      if (st.subject === 'chinese') return 'c:' + uid + ':' + String(w.zi).trim();
      if (st.subject === 'math') return 'm:' + uid + ':' + String(w.en).toLowerCase().trim();
      return uid + ':' + String(w.en).toLowerCase().trim();
    };

    document.querySelectorAll('.hw-unit-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = parseInt(btn.dataset.uid);
        st.expandedUnit = st.expandedUnit === uid ? null : uid;
        this._renderHomeworkEditorUI();
      });
    });

    document.querySelectorAll('.hw-word').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) st.picked[cb.dataset.key] = true;
        else delete st.picked[cb.dataset.key];
      });
    });

    document.querySelectorAll('.hw-pick-all').forEach(a => {
      a.addEventListener('click', () => {
        const uid = parseInt(a.dataset.uid);
        const info = this._findSubjectUnit(st.subject, uid);
        if (info && info.words) info.words.forEach(w => { st.picked[keyOf(w, uid)] = true; });
        this._renderHomeworkEditorUI();
      });
    });

    document.querySelectorAll('.hw-pick-none').forEach(a => {
      a.addEventListener('click', () => {
        const uid = parseInt(a.dataset.uid);
        const info = this._findSubjectUnit(st.subject, uid);
        if (info && info.words) info.words.forEach(w => { delete st.picked[keyOf(w, uid)]; });
        this._renderHomeworkEditorUI();
      });
    });

    document.getElementById('hw-manual-add').addEventListener('click', () => this._hwAddManual());
    document.getElementById('hw-manual-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._hwAddManual();
    });

    document.querySelectorAll('.hw-wrong-pick').forEach(cb => {
      cb.addEventListener('change', () => {
        const it = pickItems[parseInt(cb.dataset.idx)];
        if (!it) return;
        if (cb.checked) {
          if (st.manual.indexOf(it.text) === -1) {
            st.manual.push(it.text);
            st.lastMsg = '<span style="color:#2E7D32">✅ 已加入：' + this._h(it.text) + '</span>';
          }
        } else {
          st.manual = st.manual.filter(x => x !== it.text);
        }
        this._renderHomeworkEditorUI();
      });
    });

    document.querySelectorAll('[data-del]').forEach(a => {
      a.addEventListener('click', () => {
        const w = a.dataset.del;
        st.manual = st.manual.filter(x => x !== w);
        delete st.manualNotInBank[w];
        this._renderHomeworkEditorUI();
      });
    });

    document.getElementById('hw-clear').addEventListener('click', () => {
      st.picked = {};
      st.manual = [];
      st.manualNotInBank = {};
      st.lastMsg = '';
      this._renderHomeworkEditorUI();
    });

    document.getElementById('hw-save').addEventListener('click', () => this._hwSave());

    var msgEl = document.getElementById('hw-manual-msg');
    if (msgEl && st.lastMsg) msgEl.innerHTML = st.lastMsg;
  },

  _hwAddManual() {
    const st = this._hwEditor;
    const input = document.getElementById('hw-manual-input');
    const itemName = st.subject === 'chinese' ? '汉字' : st.subject === 'math' ? '算式/口诀' : '单词';
    const raw = (input.value || '').split(/[,，;；\s]+/).map(s => s.trim()).filter(s => s.length > 0);
    if (raw.length === 0) { st.lastMsg = '<span style="color:#C62828">请输入' + itemName + '</span>'; this._renderHomeworkEditorUI(); return; }
    let added = 0;
    raw.forEach(w => {
      if (st.manual.indexOf(w) !== -1) return;
      st.manual.push(w);
      added++;
    });
    if (added === 0) {
      st.lastMsg = '<span style="color:#C62828">这些内容已在列表中</span>';
      this._renderHomeworkEditorUI();
      return;
    }
    st.lastMsg = '<span style="color:#2E7D32">✅ 已添加 ' + added + ' 项（手动内容不限教材词库）</span>';
    input.value = '';
    this._renderHomeworkEditorUI();
  },

  _hwSave() {
    const st = this._hwEditor;
    const hw = {
      units: [],
      wordKeys: Object.keys(st.picked),
      manual: st.manual.map(w => st.subject === 'chinese' ? 'c:' + w : st.subject === 'math' ? 'm:' + w : w),
      assignedAt: new Date().toISOString()
    };
    const targets = (st.students && st.students.length)
      ? st.students.map(s => ({ name: s.name, grade: s.grade, localId: s.localId }))
      : [{ name: st.studentName, grade: st.studentGrade, localId: st.studentId }];
    let anyLocal = false;
    targets.forEach(t => {
      const localStudent = t.localId != null && (Storage.getStudents() || []).some(s => String(s.id) === String(t.localId));
      if (localStudent) {
        anyLocal = true;
        if (st.subject === 'chinese') Storage.saveHomeworkZh(t.localId, hw);
        else if (st.subject === 'math') Storage.saveHomeworkMath(t.localId, hw);
        else Storage.saveHomework(t.localId, hw);
      }
    });
    const host = this._getSavedHost();
    const doCloud = () => {
      if (!host) {
        if (!anyLocal) alert('未填写电脑 IP，作业无法发送到学员平板');
        return;
      }
      targets.forEach(t => {
        const msg = {
          type: 'homework',
          toName: t.name,
          toGrade: String(t.grade != null ? t.grade : ''),
          subject: st.subject,
          hw: hw,
          from: '老师',
          sentAt: new Date().toISOString()
        };
        fetch(Storage.getTaskTopic(), { method: 'PUT', body: JSON.stringify(msg) }).catch(() => {});
        try { this._lanTaskPush(msg); } catch (e) {}
      });
    };
    try { doCloud(); } catch (e) {}
    this._hwEditor = null;
    this._hwEditorStudent = null;
    this._renderAdminHomework();
  },

  _hwBack() {
    this._hwEditor = null;
    this._renderAdminHomework();
  },

  _sameApk(cur, v) {
    try {
      if (!cur) return false;
      const ha = String(cur.hash || '').toLowerCase();
      const hb = String(v.hash || '').toLowerCase();
      if (ha && hb) {
        return ha === hb || ha.indexOf(hb) === 0 || hb.indexOf(ha) === 0;
      }
      const va = String(cur.version || '').trim();
      const vb = String(v.version || '').trim();
      return !!(va && vb && va === vb);
    } catch (e) { return false; }
  },

  _isNewerApk(v, cur) {
    try {
      const bv = String(window.__BUILTIN_VER || window.__SERVER_VER || '').trim();
      const va = String((v && v.version) || '').trim();
      const vb = String((cur && cur.version) || '').trim();
      const ha = String((v && v.hash) || '').toLowerCase();
      const hb = String((cur && cur.hash) || '').toLowerCase();
      if (ha && hb && ha === hb) return false;
      if (!va) return false;
      if (/^\d{8}-\d{4}$/.test(va)) {
        if (/^\d{8}-\d{4}$/.test(bv)) return va > bv;
        if (/^\d{8}-\d{4}$/.test(vb)) return va > vb;
      }
      if (vb && /^\d{8}-\d{4}$/.test(vb)) return true;
      if (!vb) return true;
      return true;
    } catch (e) { return true; }
  },

  _newerThanBuiltin(v) {
    try {
      const bv = String(window.__BUILTIN_VER || window.__SERVER_VER || '').trim();
      const va = String((v && v.version) || '').trim();
      if (!va || !bv) return false;
      if (/^\d{8}-\d{4}$/.test(va) && /^\d{8}-\d{4}$/.test(bv)) return va > bv;
      return false;
    } catch (e) { return false; }
  },

  _wantApk(v, cur) {
    // 判断 v 标明的 APK 是否值得下载：必须比已装(本地记录)与内置版本都更新，严格防降级。
    // 关键场景：平板走云端装了新版、公司电脑更新目录还是旧版时，LAN /check 返回旧版不得被当作"新版"再拉下去。
    try {
      if (!v || !v.hash) return false;
      if (this._sameApk(cur, v)) return false;
      const bv = String(window.__BUILTIN_VER || window.__SERVER_VER || '').trim();
      const va = String(v.version || '').trim();
      const vb = String((cur && cur.version) || '').trim();
      const ch = String((cur && cur.hash) || '').toLowerCase();
      const isDate = (s) => /^\d{8}-\d{4}$/.test(s);
      if (isDate(va)) {
        if (ch && isDate(vb)) return va > vb;
        if (ch && !vb) return true;
        if (isDate(bv)) return va > bv;
        return true;
      }
      return this._newerThanBuiltin(v);
    } catch (e) { return false; }
  },

  _checkJsUpdate(attempt) {
    attempt = attempt || 0;
    let host = this._getSavedHost();
    if (!host && !window.AndroidBackup) host = '127.0.0.1';
    if (!host) {
      if (window.AndroidBackup) {
        this._updLog('未保存电脑 IP，直接使用云端更新通道...');
        this._checkCloudUpdate(0);
        return;
      }
      this._updLog('未保存电脑 IP：请在"电脑 IP"输入框填写后，再点击"检查更新"');
      return;
    }
    const base = 'http://' + host + ':8899';
    this._updLog('检查更新 ' + base);
    this._fetchJsonTimeout(base + '/check', 8000)
      .then(txt => JSON.parse(txt))
      .then(v => {
        const self = this;
        if (!v || !v.apk) {
          this._updLog('⚙ 接收器未返回 APK 信息，改为尝试云端更新...');
          setTimeout(() => { try { this._checkCloudUpdate(0); } catch (e) {} }, 500);
          return;
        }
        const cur = Storage.getApkInfo();
        const need = this._wantApk(v.apk, cur);
        if (need) {
          if (!this._apkNoticeShown) {
            this._apkNoticeShown = true;
            this._lastApkInfo = v.apk;
            this._apkVersion = (String(v.apk.version || '').trim() || v.apk.updated) + ' ' + Math.round((v.apk.size || 0) / 1024) + 'KB';
            this._apkHost = host;
            this._showApkBtn();
            this._updLog('检测到新版 App（' + this._apkVersion + '），自动下载并安装中...');
            setTimeout(() => { try { this._downloadApk(); } catch (e) {} }, 300);
            return;
          }
        }
if (this._apkNoticeShown) return;
        this._updLog('✅ 已是最新版本');
        this._checkCloudAfterLan(v.apk);
      })
      .catch(e => {
        this._updLog('❌ 局域网更新不可用：' + (e && e.message ? e.message : e));
        if (attempt === 0) {
          this._updLog('  请确认：① 手机/平板与电脑连接同一 WiFi　② 电脑端"错题接收发送器"已启动　③ 电脑防火墙放行端口 8899');
        }
        this._updLog('⏹ 立即改为尝试云端更新...');
        setTimeout(() => { try { this._checkCloudUpdate(0); } catch (e2) {} }, 300);
      });
    },

  _checkCloudAfterLan(lanApk) {
    // LAN 端已是新版时，仍核对一次云端：防止公司电脑"更新目录"未同步到云端新版，
    // 平板比对 LAN 一直相等而永远停在旧版（与 LAN 优先、云端兜底 的次序不冲突）。
    try {
      this._updLog('局域网已是最新，再核对云端版本...');
      setTimeout(() => { try { this._checkCloudUpdate(0); } catch (e) {} }, 800);
    } catch (e) {}
  },

  // 从云端/局域网同步学员名单到本地
  _syncStudentsFromCloud() {
    const self = this;
    const tryLan = () => {
      const host = this._getSavedHost();
      if (!host) return Promise.resolve(false);
      return this._fetchJsonTimeout('http://' + host + ':8899/students.json', 5000)
        .then(txt => {
          try {
            const list = JSON.parse(txt);
            if (Array.isArray(list) && list.length) {
              Storage.mergeStudents(list);
              console.log('局域网同步学员:', list.length, '人');
              return true;
            }
          } catch (e) {}
          return false;
        })
        .catch(() => false);
    };
    const tryCloud = () => {
      return this._fetchJsonTimeout('https://cdn.jsdelivr.net/gh/PJJY0412/pj-update@master/update/students.json', 8000)
        .then(txt => {
          try {
            const list = JSON.parse(txt);
            if (Array.isArray(list) && list.length) {
              Storage.mergeStudents(list);
              console.log('云端同步学员:', list.length, '人');
              return true;
            }
          } catch (e) {}
          return false;
        })
        .catch(() => false);
    };
    const refreshIfNeeded = () => {
      try {
        if (self.currentView === 'login') self.renderLogin();
      } catch (e) {}
    };
    tryLan().then(ok => {
      if (ok) {
        try { self._flushPendingStudentRemovals(); } catch (e) {}
      } else {
        return tryCloud();
      }
    }).then(refreshIfNeeded, refreshIfNeeded);
  },

  _cloudMetaUrl() {
    return [
      'https://raw.githubusercontent.com/PJJY0412/pj-update/master/update/version.json',
      'https://cdn.jsdelivr.net/gh/PJJY0412/pj-update@master/update/version.json'
    ];
  },

  _checkCloudUpdate(attempt) {
    attempt = attempt || 0;
    const urls = this._cloudMetaUrl();
    const u = urls[Math.min(attempt, urls.length - 1)];
    this._updLog('检查云端更新 ' + u + '（' + (attempt + 1) + '/' + urls.length + '）');
    this._fetchJsonTimeout(u, 12000)
      .then(txt => {
        let v = null;
        try { v = JSON.parse(txt); } catch (e) {}
        if (!v || !v.apk) throw new Error('云端版本信息无效');
        const cur = Storage.getApkInfo();
        const need = this._wantApk(v.apk, cur);
        if (need) {
          if (!this._apkNoticeShown) {
            this._apkNoticeShown = true;
            this._lastApkInfo = v.apk;
            this._apkVersion = (String(v.apk.version || '').trim() || v.apk.updated) + ' ' + Math.round((v.apk.size || 0) / 1024) + 'KB';
            this._apkCloudUrl = v.apk.url || '';
            this._apkUrlList = this._buildApkUrlList(v.apk);
            this._apkUrlIdx = 0;
            this._showApkBtn();
            this._updLog('云端检测到新版 App（' + this._apkVersion + '），自动下载并安装中...');
            setTimeout(() => { try { this._downloadApk(); } catch (e) {} }, 300);
          }
        } else {
          this._updLog('✅ 云端已是最新版本');
        }
      })
      .catch(e => {
        this._updLog('❌ 云端更新检查失败：' + (e && e.message ? e.message : e));
        if (attempt < urls.length - 1) {
          this._updLog('15 秒后尝试下一个云端地址...');
          setTimeout(() => { try { this._checkCloudUpdate(attempt + 1); } catch (e2) {} }, 15000);
        } else {
          this._updLog('⏹ 云端与局域网更新均不可用，请检查网络后点击"检查更新"');
        }
      });
  },

_updLog(msg) {
    try {
      if (this._updQuiet) return;
      let el = document.getElementById('upd-log');
      if (!el) el = document.getElementById('unlock-upd-log');
      if (!el) return;
      const now = new Date();
      const line = document.createElement('div');
      line.textContent = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0') + ' ' + msg;
      el.appendChild(line);
      while (el.children.length > 8) el.removeChild(el.firstChild);
    } catch (e) {}
  },

  _showApkBtn() {
    try {
      var b1 = document.getElementById('login-apk-btn');
      if (b1) b1.style.display = '';
      var b2 = document.getElementById('unlock-apk-btn');
      if (b2) b2.style.display = '';
    } catch (e) {}
  },

  _buildApkUrlList(apk) {
    const list = [];
    const push = (u) => { u = String(u || '').trim(); if (u && list.indexOf(u) < 0) list.push(u); };
    push(apk && apk.url);
    if (apk && Array.isArray(apk.mirrors)) apk.mirrors.forEach(push);
    const first = list[0] || '';
    const ghPath = first.replace(/^https:\/\/[^/]+\/(https:\/\/github\.com\/)/, '$1');
    if (/^https:\/\/github\.com\/.+\/releases\/download\//.test(ghPath)) {
      push('https://gh-proxy.com/' + ghPath);
      push('https://ghfast.top/' + ghPath);
      push(ghPath);
    }
    return list;
  },

  _apkFail(reason) {
    try {
      if (this._apkWatchTimer) { clearTimeout(this._apkWatchTimer); this._apkWatchTimer = null; }
      if (!this._apkUrlList || !this._apkUrlList.length || !this._apkCloudUrl) return;
      this._updLog('⚠️ 下载失败（' + reason + '），切换备用源...');
      this._apkUrlIdx = (this._apkUrlIdx || 0) + 1;
      if (this._apkUrlIdx < this._apkUrlList.length) {
        setTimeout(() => { try { this._downloadApk(); } catch (e) {} }, 2000);
      } else {
        this._apkUrlIdx = 0;
        this._updLog('❌ 所有下载源均失败，请检查网络后点击"检查更新"重试');
      }
    } catch (e) {}
  },

  _downloadApk() {
    const self = this;
    const log = document.getElementById('upd-log') || document.getElementById('unlock-upd-log');
    const put = (m) => {
      if (!log) return;
      const now = new Date();
      const line = document.createElement('div');
      line.textContent = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0') + ' ' + m;
      log.appendChild(line);
    };
    let url = '';
    let saveName = 'pj-english-update.apk';
    let srcTotal = 1;
    if (this._apkCloudUrl) {
      const list = (Array.isArray(this._apkUrlList) && this._apkUrlList.length) ? this._apkUrlList : [this._apkCloudUrl];
      srcTotal = list.length;
      if (typeof this._apkUrlIdx !== 'number' || this._apkUrlIdx < 0 || this._apkUrlIdx >= list.length) this._apkUrlIdx = 0;
      url = list[this._apkUrlIdx];
      const verPart = String((this._lastApkInfo && this._lastApkInfo.version) || '').replace(/[^\w.-]/g, '');
      if (verPart) saveName = 'pj-english-' + verPart + '.apk';
    } else {
      let host = this._getSavedHost();
      if (!host && !window.AndroidBackup) host = '127.0.0.1';
      if (!host) {
        put('未保存电脑 IP：请在管理后台"本机负责年级"下方填写电脑 IP 后再试');
        return;
      }
      url = 'http://' + host + ':8899/apk?v=' + Date.now();
      saveName = '培基智多星学习系统.apk';
    }
    if (window.AndroidBackup && window.AndroidBackup.downloadAndInstallApk) {
      put('开始下载（源 ' + (this._apkUrlIdx + 1) + '/' + srcTotal + '）：' + url);
      const expHash = (this._apkCloudUrl && this._lastApkInfo && this._lastApkInfo.hash) ? String(this._lastApkInfo.hash) : '';
      if (this._apkWatchTimer) clearTimeout(this._apkWatchTimer);
      const sz = (this._lastApkInfo && this._lastApkInfo.size) || 55000000;
      const secs = Math.max(90, Math.ceil(sz / 150000));
      this._apkWatchTimer = setTimeout(() => { try { self._apkFail('timeout'); } catch (e) {} }, secs * 1000);
      try {
        window.AndroidBackup.downloadAndInstallApk(url, saveName, expHash);
      } catch (e) {
        try { window.AndroidBackup.downloadAndInstallApk(url, saveName); } catch (e2) {
          put('下载启动失败：' + (e && e.message || e));
          try { this._apkFail('start'); } catch (e3) {}
        }
      }
    } else {
      put('当前环境不支持应用内安装，请在平板浏览器打开：' + url);
    }
  },

  _apkDownloaded(path) {
    try {
      if (this._apkWatchTimer) { clearTimeout(this._apkWatchTimer); this._apkWatchTimer = null; }
      if (this._lastApkInfo) {
        try { Storage.setApkInfo(this._lastApkInfo); } catch (e) {}
      }
      const log = document.getElementById('upd-log') || document.getElementById('unlock-upd-log');
      if (window.AndroidBackup && window.AndroidBackup.installApk) {
        window.AndroidBackup.installApk(path);
      } else if (log) {
        log.innerHTML += '<div>安装包已下载：' + (path || '') + '，请在文件管理器中打开安装</div>';
      }
    } catch (e) {}
  },

_renderAdminScan() {
    const container = document.getElementById('admin-tab-content');
    const students = Storage.getStudents().filter(s => this._gradeAllowed(Storage.getCurrentGrade(s)));
    let html = '<div class="admin-section">';

    html += '<p style="margin:0 0 10px;font-size:13px;color:var(--text-light)">点击学员，扫描其纸质作业并整理错题</p>';
    html += '<div style="display:flex;gap:8px;margin-bottom:12px">';
    const weekCount = Storage.getWeekWrongs().length;
    html += '<button class="login-btn" id="open-week" style="flex:1.2">📥 本周错题' + (weekCount ? '（' + weekCount + ' 条）' : '') + '</button>';
    html += '<button class="admin-gen-btn" id="open-archive" style="flex:1">📂 个人错题库</button>';
    html += '</div>';
    html += '<button class="login-btn" id="open-public" style="width:100%;margin-bottom:12px">🌐 公共错题库（接收/导入）</button>';
    html += '<button class="admin-gen-btn" id="recv-wrong" style="width:100%;margin-bottom:12px">📥 从电脑接收错题</button>';
    html += '<button class="admin-gen-btn" id="open-task" style="width:100%;margin-bottom:12px">📤 下发练习（到学员平板）</button>';
    html += '<div id="recv-panel"></div>';
if (students.length === 0) {
      const adminGrades = Storage.getAdminGrades();
      html += '<div class="empty-state" style="padding:20px"><p>' + (adminGrades.length ? '本机负责年级暂无学员' : '还没有注册学员') + '</p></div>';
      html += '</div>';
      container.innerHTML = html;
      return;
    }
    students.forEach(s => {
      const grade = Storage.getCurrentGrade(s);
      const works = Storage.getScanWorks(s.id);
      const wrongs = Storage.getWrongQuestions(s.id);
      html += '<div class="asc-item" style="cursor:pointer" data-sid="' + s.id + '">';
      html += '<div style="flex:1">';
      html += '<div class="asc-val">' + this._h(s.name) + '</div>';
      html += '<div class="asc-lbl">' + grade + '年级 · 扫描 ' + works.length + ' 份 · 错题 ' + wrongs.length + ' 题</div>';
      html += '</div>';
      html += '<span style="color:var(--primary);font-size:13px">📷 扫描/错题</span>';
      html += '</div>';
    });
    html += '</div>';
    container.innerHTML = html;

    const recvBtn = document.getElementById('recv-wrong');
    if (recvBtn) recvBtn.addEventListener('click', () => this._renderReceivePanel());

    const taskBtn = document.getElementById('open-task');
    if (taskBtn) taskBtn.addEventListener('click', () => this._renderTaskPage());

    const weekBtn = document.getElementById('open-week');
    if (weekBtn) weekBtn.addEventListener('click', () => this._renderWeekWrongs());
    const archBtn = document.getElementById('open-archive');
    if (archBtn) archBtn.addEventListener('click', () => this._renderWrongArchive());
    const pubBtn = document.getElementById('open-public');
    if (pubBtn) pubBtn.addEventListener('click', () => this._renderPublicWrongBank());

    container.querySelectorAll('.asc-item').forEach(item => {
      item.addEventListener('click', () => {
        this._renderScanPage(parseInt(item.dataset.sid));
      });
    });
  },

  _renderTaskPage() {
    const container = document.getElementById('admin-tab-content');
    container.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-light)">加载学员中...</div>';
    this._fetchAllStudents().then(students => {
      this._renderTaskPageBody(container, students);
    });
  },

  _renderTaskPageBody(container, students) {
    this._taskSelWrong = this._taskSelWrong || {};
    this._taskWrongMap = {};
    let html = '<div class="admin-section">';
    html += '<button class="back-btn" onclick="App._renderAdminScan()">← 返回上一级</button>';
    html += '<h3 style="margin:10px 0">📤 下发练习（到学员平板）</h3>';
    html += '<p style="margin:0 0 10px;font-size:12px;color:var(--text-light)">勾选学员，再从错题/加练题库选择题目，发送后学员在学习统计页点"📥 老师练习"即可收到（走云端，需联网，约保留 1 天）。</p>';

    html += '<div style="border:1px solid #E0E0E0;border-radius:10px;margin-bottom:10px;overflow:hidden">';
    html += '<div style="padding:10px 12px;background:#F5F7FA;font-size:13px;font-weight:700">👦 选择学员</div>';
    students.forEach(s => {
      const g = s.grade || Storage.getCurrentGrade(s) || 1;
      if (!this._gradeAllowed(g)) return;
      const sidKey = s.remote ? 'r' + s.name : String(s.id);
      const wrongs = s.remote ? 0 : Storage.getWrongQuestions(s.id).length;
      const pracs = s.remote ? 0 : Storage.getPracticeExtra().filter(p => String(p.studentId) === String(s.id)).length + Storage.getPracticeArchive().filter(p => String(p.studentId) === String(s.id)).length;
      html += '<div class="asc-item">';
      html += '<input type="checkbox" class="task-stu" data-sid="' + sidKey + '" style="margin-right:8px">';
      html += '<div style="flex:1">';
      html += '<div class="asc-val">' + this._h(s.name) + (s.remote ? ' <span style="font-size:11px;color:#8D6E63">🌐电脑端</span>' : '') + '</div>';
      html += '<div class="asc-lbl">' + g + '年级 · 错题 ' + wrongs + ' 题 · 加练 ' + pracs + ' 题</div>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';

    const nWrong = Object.keys(this._taskSelWrong).length;
    html += '<div style="display:flex;gap:8px;margin-bottom:8px">';
    html += '<button class="login-btn" id="task-pick-wrongs" style="flex:1">📂 选错题' + (nWrong ? '（' + nWrong + '）' : '') + '</button>';
    html += '</div>';
    html += '<div id="task-wrong-picker"></div>';

    html += '<div style="border:1px solid #E0E0E0;border-radius:10px;margin:10px 0;padding:10px 12px">';
    html += '<div style="font-size:13px;font-weight:700;margin-bottom:6px">📋 已选题目（' + nWrong + '）</div>';
    html += '<div id="task-sel-list">';
    const allSel = this._objVals(this._taskSelWrong);
    if (allSel.length === 0) {
      html += '<div style="font-size:12px;color:var(--text-light)">尚未选择题目</div>';
    } else {
      allSel.forEach(it => {
        html += '<div style="font-size:12px;padding:3px 0;color:#555">· [' + this._subjName(it.subject) + '] ' + this._h(it.text) + '</div>';
      });
    }
    html += '</div></div>';

    html += '<button class="login-btn" id="task-send" style="width:100%">📤 发送所选练习</button>';
    html += '<div id="task-status" style="font-size:12px;color:var(--text-light);margin-top:6px;min-height:16px"></div>';
    html += '</div>';
    container.innerHTML = html;

    document.getElementById('task-pick-wrongs').addEventListener('click', () => this._renderTaskWrongPicker());

    document.getElementById('task-send').addEventListener('click', () => {
      const selKeys = [];
      container.querySelectorAll('.task-stu:checked').forEach(cb => selKeys.push(cb.dataset.sid));
      const items = this._objVals(this._taskSelWrong);
      const status = document.getElementById('task-status');
      if (selKeys.length === 0) { status.textContent = '请先勾选学员'; return; }
      if (items.length === 0) { status.textContent = '请先选择题目'; return; }
      if (!confirm('向 ' + selKeys.length + ' 名学员发送 ' + items.length + ' 题练习？')) return;
      const topic = Storage.getTaskTopic();
      status.textContent = '正在发送...';
      const seq = selKeys.map(key => {
        const s2 = students.find(x => (x.remote ? 'r' + x.name === key : String(x.id) === key));
const name = s2 ? s2.name : '';
        const toId = s2 && !s2.remote ? s2.id : null;
        const msg2 = { toId: toId, toName: name, items: items, from: '老师', sentAt: new Date().toISOString() };
        try { this._lanTaskPush(msg2); } catch (e) {}
        return fetch(topic, { method: 'PUT', body: JSON.stringify(msg2) }).then(r => r.ok);
      });
      Promise.all(seq).then(rs => {
        if (rs.every(Boolean)) {
          status.textContent = '✅ 已向 ' + selKeys.length + ' 名学员发送 ' + items.length + ' 题练习，学员平板点"📥 老师练习"即可收到';
          this._taskSelWrong = {};
          setTimeout(() => { this._renderTaskPage(); }, 3000);
        } else {
          status.textContent = '❌ 部分发送失败，请重试';
        }
      });
    });
  },

  _renderTaskWrongPicker() {
    const panel = document.getElementById('task-wrong-picker');
    if (!panel) return;
    if (panel.dataset.open) { panel.innerHTML = ''; panel.dataset.open = ''; this._refreshTaskSel(); return; }
    panel.dataset.open = '1';
    const students = Storage.getStudents();
    let html = '<div style="border:1px solid #BBDEFB;background:#E3F2FD;border-radius:10px;padding:10px 12px;margin-bottom:8px">';
    html += '<div style="font-size:12px;font-weight:700;margin-bottom:6px">☑ 勾选错题（本机负责年级）</div>';
    let any = false;
    students.forEach(s => {
      const g = Storage.getCurrentGrade(s);
      if (!this._gradeAllowed(g)) return;
      const wrongs = Storage.getWrongQuestions(s.id);
      if (!wrongs.length) return;
      any = true;
      html += '<div style="font-size:12px;color:#1565C0;font-weight:700;margin:6px 0 2px">' + this._h(s.name) + '（' + g + '年级）</div>';
      wrongs.forEach(w => {
        this._taskWrongMap[w.id] = { subject: w.subject, text: w.text };
        const checked = this._taskSelWrong[w.id] ? ' checked' : '';
        html += '<div class="asc-item" style="padding:3px 0">';
        html += '<input type="checkbox" class="task-w-sel" data-wid="' + w.id + '"' + checked + '>';
        html += '<div style="flex:1;margin-left:6px;font-size:12px">' + this._h(w.text) + '</div>';
        html += '</div>';
      });
    });
    if (!any) html += '<div style="font-size:12px;color:var(--text-light)">暂无错题</div>';
    html += '</div>';
    panel.innerHTML = html;

    panel.querySelectorAll('.task-w-sel').forEach(cb => {
      cb.addEventListener('change', () => {
        const wid = parseInt(cb.dataset.wid);
        if (cb.checked) this._taskSelWrong[wid] = this._taskWrongMap[wid] || { subject: '', text: '' };
        else delete this._taskSelWrong[wid];
        this._refreshTaskSel();
      });
    });
  },

  _refreshTaskSel() {
    const nWrong = Object.keys(this._taskSelWrong || {}).length;
    const b1 = document.getElementById('task-pick-wrongs');
    if (b1) b1.textContent = '📂 选错题' + (nWrong ? '（' + nWrong + '）' : '');
    const box = document.getElementById('task-sel-list');
    if (!box) return;
    const allSel = this._objVals(this._taskSelWrong);
    let html = '';
    if (allSel.length === 0) {
      html = '<div style="font-size:12px;color:var(--text-light)">尚未选择题目</div>';
    } else {
      allSel.forEach(it => {
        html += '<div style="font-size:12px;padding:3px 0;color:#555">· [' + this._subjName(it.subject) + '] ' + this._h(it.text) + '</div>';
      });
    }
    box.innerHTML = html;
    const hdr = box.parentElement;
    const h0 = hdr.querySelector('div');
    if (h0) h0.textContent = '📋 已选题目（' + nWrong + '）';
  },

  _renderReceivePanel() {
    const panel = document.getElementById('recv-panel');
    if (!panel) return;
    const savedHost = this._getSavedHost();
    const students = Storage.getStudents();
    const mode = Storage.getTransportMode();
    let html = '<div style="background:#F5F7FA;border:1px solid #E0E0E0;border-radius:10px;padding:12px 14px;margin-bottom:12px">';
    html += '<div style="font-size:13px;font-weight:700;margin-bottom:8px">📥 接收错题（来自老师电脑）</div>';
    html += '<div style="display:flex;gap:8px;margin-bottom:8px">';
    html += '<button class="admin-gen-btn" data-rmode="lan" style="flex:1;background:' + (mode === 'lan' ? 'var(--primary);color:#fff' : '#fff') + '">🏠 同一网络</button>';
    html += '<button class="admin-gen-btn" data-rmode="cloud" style="flex:1;background:' + (mode === 'cloud' ? 'var(--primary);color:#fff' : '#fff') + '">☁️ 跨网络</button>';
    html += '</div>';
    html += '<div id="recv-lan-block"' + (mode === 'cloud' ? ' style="display:none"' : '') + '>';
    html += '<input type="text" class="login-input" id="recv-host" placeholder="电脑 IP，如 192.168.1.100" value="' + this._h(savedHost) + '" style="margin-bottom:6px" autocomplete="off">';
    html += '<div style="font-size:11px;color:var(--text-light);margin-bottom:6px">需与电脑在同一 WiFi</div>';
    html += '</div>';
    html += '<div id="recv-cloud-block"' + (mode === 'lan' ? ' style="display:none"' : '') + '>';
    html += '<div style="font-size:11px;color:var(--text-light);margin-bottom:6px">接收电脑或平板上传的云端错题（需联网，云端保留约 1 天）</div>';
    html += '</div>';
    html += '<select class="login-input" id="recv-student" style="margin-bottom:6px;appearance:auto;-webkit-appearance:auto">';
    html += '<option value="">选择接收的学员</option>';
    students.forEach(s => {
      if (!this._gradeAllowed(Storage.getCurrentGrade(s))) return;
      html += '<option value="' + s.id + '">' + this._h(s.name) + '（' + Storage.getCurrentGrade(s) + '年级）</option>';
    });
    html += '</select>';
    html += '<div style="display:flex;gap:8px">';
    html += '<button class="login-btn" id="recv-do" style="flex:1">⬇ 接收</button>';
    html += '<button class="admin-gen-btn" id="recv-close" style="flex:1">收起</button>';
    html += '</div>';
    html += '<div id="recv-status" style="font-size:12px;color:var(--text-light);margin-top:6px;min-height:16px"></div>';
    html += '<div id="upd-log" style="font-size:11px;color:var(--text-light);margin-top:6px;line-height:1.5;word-break:break-all"></div>';
    html += '</div>';
    panel.innerHTML = html;
    this._bindHostInput('recv-host');

    panel.querySelectorAll('[data-rmode]').forEach(btn => {
      btn.addEventListener('click', () => {
        Storage.setTransportMode(btn.dataset.rmode);
        this._renderReceivePanel();
      });
    });

    document.getElementById('recv-close').addEventListener('click', () => { panel.innerHTML = ''; });
    document.getElementById('recv-do').addEventListener('click', () => {
      const isCloud = Storage.getTransportMode() === 'cloud';
      const sid = document.getElementById('recv-student').value;
      const status = document.getElementById('recv-status');
      if (!sid) { status.textContent = '请选择接收的学员'; return; }
      const student = students.find(s => s.id === parseInt(sid));
      if (!student) { status.textContent = '学员不存在'; return; }
      const merge = (items) => {
        const wrongs = Storage.getWrongQuestions(student.id);
        const existing = {};
        wrongs.forEach(w => { existing[w.text] = true; });
        let added = 0;
        items.forEach((it, idx) => {
          const text = String(it.text || '').trim();
          if (!text || existing[text]) return;
          existing[text] = true;
          wrongs.push({
            id: Date.now() + idx,
            subject: it.subject || 'english',
            text: text,
            createdAt: it.createdAt || new Date().toISOString(),
            receivedFrom: isCloud ? 'cloud' : 'lan'
          });
          added++;
        });
        Storage.saveWrongQuestions(student.id, wrongs);
        status.textContent = '✅ 接收成功：新增 ' + added + ' 题（重复 ' + (items.length - added) + ' 题已跳过）';
      };
      if (isCloud) {
        status.textContent = '正在连接云端...';
        this._cloudPull().then(groups => {
          const items = (groups[student.name] || [])
            .filter(it => String(it.text || '').trim())
            .filter(it => this._gradeAllowed(it.grade || Storage.getCurrentGrade(student)));
          if (items.length === 0) { status.textContent = 'ℹ️ 云端暂无该学员的错题（或非本机负责年级，或已被接收过）'; return; }
          merge(items);
        }).catch(e => {
          status.textContent = '❌ 云端连接失败：' + (e.message || e) + '，请检查平板网络';
        });
        return;
      }
      const host = document.getElementById('recv-host').value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (!host) { status.textContent = '请填写电脑 IP'; return; }
      this._saveHost(host);
      status.textContent = '正在连接电脑...';
      this._lanGet('http://' + host + ':8899/pull?student=' + encodeURIComponent(student.name)).then(res => {
        if (!res.ok) { status.textContent = '❌ 连接失败：' + (res.err || '无法连接电脑，请确认接收器已启动且平板与电脑在同一网络'); return; }
        let items = [];
        try { const j = JSON.parse(res.body || '{}'); items = j.items || []; } catch (e) {}
        items = items.filter(it => this._gradeAllowed(it.grade || Storage.getCurrentGrade(student)));
        if (items.length === 0) {
          status.textContent = 'ℹ️ 电脑上该学员暂无错题（或非本机负责年级）';
          return;
        }
        merge(items);
      });
    });
  },

  _renderScanPage(studentId) {
    const container = document.getElementById('admin-tab-content');
    const student = Storage.getStudents().find(s => s.id === studentId);
    if (!student) { this._renderAdminScan(); return; }
    this._scanStudentId = studentId;

    const works = Storage.getScanWorks(studentId);
    const wrongs = Storage.getWrongQuestions(studentId);

    let html = '<div class="admin-section">';
    html += '<button class="back-btn" onclick="App._renderAdminScan()">← 返回上一级</button>';
    html += '<h3 style="margin:10px 0">📷 ' + this._h(student.name) + ' · 扫描入库</h3>';

    html += '<div style="display:flex;flex-direction:column;gap:10px;margin:10px 0">';
    html += '<button class="daily-mode-btn" data-subj="english" style="background:#2E7D32">📗 英语作业扫描</button>';
    html += '<button class="daily-mode-btn" data-subj="chinese" style="background:#C62828">📘 语文作业扫描</button>';
    html += '<button class="daily-mode-btn" data-subj="math" style="background:#E65100">📙 数学作业扫描</button>';
    html += '</div>';

    html += '<div style="margin:14px 0;padding:12px 14px;background:#F5F7FA;border-radius:10px;font-size:12px;color:var(--text-light)">';
    html += 'ℹ️ 识别需平板联网，识别结果请老师校对后保存入库';
    html += '</div>';

    html += '<h4 style="margin:12px 0 6px;color:var(--primary)">已扫描作业</h4>';
    if (works.length === 0) {
      html += '<div style="padding:12px;font-size:13px;color:var(--text-muted)">暂无扫描记录</div>';
    } else {
      works.slice().reverse().forEach(w => {
        html += '<div class="asc-item" data-wid="' + w.id + '">';
        html += '<div style="flex:1">';
        html += '<div class="asc-val">' + this._subjName(w.subject) + ' · ' + new Date(w.createdAt).toLocaleString('zh-CN') + '</div>';
        html += '<div class="asc-lbl" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80vw">' + this._h((w.text || '').slice(0, 60)) + '</div>';
        html += '</div>';
        html += '<span style="color:#C62828;font-size:14px;cursor:pointer" data-delwork="' + w.id + '">🗑</span>';
        html += '</div>';
      });
    }

    html += '<h4 style="margin:14px 0 6px;color:var(--primary)">错题库</h4>';

    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('[data-subj]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._renderScanCapture(studentId, btn.dataset.subj);
      });
    });

    container.querySelectorAll('[data-delwork]').forEach(el => {
      el.addEventListener('click', () => {
        const wid = parseInt(el.dataset.delwork);
        Storage.saveScanWorks(studentId, works.filter(w => w.id !== wid));
        this._renderScanPage(studentId);
      });
    });

  },

  _subjName(subject) {
    return subject === 'english' ? '英语' : subject === 'chinese' ? '语文' : subject === 'math' ? '数学' : subject;
  },

  // 数学口算题显示完整算式：题面 "7+5=" / "7+5" / 已答 → "7+5=12"（标准答案优先，其次我的答案）
  _mathTaskFullEq(t) {
    const s = String(t ? t.text : '').trim();
    if (!s) return '';
    if (this._mathParseEn(s)) return s; // 题面已是完整算式（含结果）
    const ma = String(t ? t.answer || t.myAnswer : '').trim();
    const eq = this._mathOpenEq(s, ma ? ma : undefined);
    if (eq) return String(eq.a) + eq.op + String(eq.b) + '=' + String(eq.result);
    if (!/[0-9]/.test(ma)) return s; // 学员未填数字答案，保持原题面
    const base = s.replace(/=\s*\?*\s*$/, '').replace(/\s+$/, '');
    if (base === s || base.length === 0) {
      // 题面不含等号：直接补 "=答案"（仅当含四则运算符时）
      return /[+\-×÷xX*]/.test(s) ? s + '=' + ma : s;
    }
    return base + '=' + ma;
  },

  _generatePracticeItems(subject, text, grade) {
    if (subject === 'math') return this._genMathPractice(text);
    if (subject === 'chinese') return this._genWordPractice('chinese', text, grade);
    return this._genWordPractice('english', text, grade);
  },

  _genMathPractice(text) {
    const t = String(text || '');
    const has = (re) => re.test(t);
    const nums = (t.match(/\d+/g) || []).map(Number).filter(n => n > 0);
    let type = null;
    if (has(/拼成|拼在一|拼起来|对折/)) return this._genFoldPractice();
    if (has(/说真话|假话|谁最(高|大|重|快)|推理|只有.{0,3}说/)) return this._genLogicPractice();
    if (has(/烧水|沏茶|同时进行|最短(需要|要)?(多少|几)分钟|合理安排/)) return this._genArrangePractice();
    if (has(/抽屉|抢椅子|至少有一个|一定会有/)) return this._genPigeonPractice();
    if (has(/解方程|未知数|求\s*x|x\s*[+\-×*÷=]/)) return this._genEquationPractice();
    if (has(/相当于|换(成|几个|\d+个)|等于(几个|\d+个)|个橘子|个草莓/)) return this._genSubstitutePractice();
    if (has(/夹角|时针和分针/)) return this._genClockAnglePractice();
    if (has(/哪种(买法|方案|更)|更(便宜|划算|合算|省)|买法更/)) return this._genComparePractice();
    if (has(/找规律|规律填|填一填|后面(应|该)?填|下一个(数|数字)/)) return this._genPatternPractice();
    if (has(/长方体|正方体|体积|表面积|棱长|圆柱|底面积|立方厘米/)) return this._genSolidPractice();
    if (has(/单位换算|换算成|等于多少/)) return this._genUnitPractice();
    if (has(/付了|付给|应找回|找回|买.{0,6}(元|角).{0,4}(付|找)|元.{0,4}角/)) return this._genMoneyPractice();
    if (has(/买.{0,3}送|满.{0,4}减|促销|优惠|买赠/)) return this._genPromoPractice();
    if (has(/增产|减产|提价|降价|百分之|涨了|降了/)) return this._genPercentPractice();
    if (has(/按.{0,4}[:：]|按比|按.{0,3}分配|分配.{0,3}比/)) return this._genRatioPractice();
    if (has(/摸到|摸出|可能性|抽到|转盘|掷一次/)) return this._genProbabilityPractice();
    if (has(/零下|零上|温差|气温|摄氏|温度计/)) return this._genTemperaturePractice();
    if (has(/看错|看成|抄错|写错|错写|算错/)) return this._genMistakePractice();
    if (has(/原来(有|有.*个)|送给|倒推|逆推|给了.*张|又买来/)) return this._genReversePractice();
    if (has(/都(喜欢|参加|及格|会)|既.{0,4}又|至少(会|参加|喜欢|做对|及格|会一种)/)) return this._genOverlapPractice();
    if (has(/比例尺|图上距离|实际距离|地图上|图上量/)) return this._genScalePractice();
    if (has(/一样多|同样多|移多补少|给.*几个就/)) return this._genBalancePractice();
    if (has(/方阵|最外层|每边.{0,3}(人|盆|棵)|外圈|站成(正)?方形/)) return this._genMatrixPractice();
    if (has(/钢管|堆成|最上层|最下层|连续(自然|奇|偶)数|\+|等差数列/)) return this._genSumPractice();
    if (has(/三角形|内角|角.{0,4}(度|°)|三角板|等腰/)) return this._genAnglePractice();
    if (has(/顺水|逆水|水流|静水|船速|水速/)) return this._genRiverPractice();
    if (has(/次品|天平|略轻|略重|较轻|较(重|轻)/)) return this._genCounterfeitPractice();
    if (has(/不同的两位|数字卡片|赛一|比赛|穿法|上衣|裤子|多少种|搭配|单循环/)) return this._genListPractice();
    if (has(/牧草|草场|草地|牛吃草|抽水机|泉水|涌出/)) return this._genCattlePractice();
    if (has(/每人分|分给.{0,4}小朋友|还差|还多|多.{0,3}个.{0,4}少.{0,3}个/)) return this._genSurplusPractice();
    if (has(/追上|追及|晚出发|早出发|同向而行/)) return this._genChasePractice();
    if (has(/锯|切成|剪成|上到|到{0,2}楼|敲{0,3}下|每隔/)) return this._genIntervalPractice();
    if (has(/鸡兔|兔|笼子里|数.*脚|只脚|只腿/)) return this._genChickenRabbitPractice();
    if (has(/浓度|盐水|糖水|含盐|含糖|加水|蒸发掉/)) return this._genConcentrationPractice();
    if (has(/利润|进价|售价|原价|打折|成本|赚了|亏了/)) return this._genProfitPractice();
    if (has(/年龄|几岁|岁数|爸爸.{0,3}岁|妈妈.{0,3}岁/)) return this._genAgePractice();
    if (has(/两(个|数|筐|班|车).*(和|差)|和是|差是|甲.{0,3}乙.{0,3}(和|共)/)) return this._genSumDiffPractice();
    if (has(/是.{0,4}的\d+倍|的\d+倍.{0,4}(共|和)|倍多|倍少/)) return this._genTimesPractice();
    if (has(/平均(每人|每次|每天|每个|每本|每队|成绩)|均分/)) return this._genAveragePractice();
    if (has(/买\d+个|个.{0,4}共.{0,3}元|花了?\d+元|用了?\d+元|同样的/)) return this._genUnitPricePractice();
    if (has(/相向|相遇|同时.{0,4}出发|背向而行/)) return this._genMeetPractice();
    if (has(/单独做|单独修|合修|合做|合作|修一条|完成这项|打一份文件/)) return this._genWorkPractice();
    if (has(/周长|面积|长\s*\d+.*宽|边长|围成|长方形|正方形|操场/)) return this._genGeometryPractice();
    if (has(/分之|几分之几|一半|1\/\d/)) return this._genFractionPractice();
    if (has(/星期[一二三四五六日天]|循环|按.{0,5}(顺序|规律)|第\d+面|彩旗/)) return this._genCyclePractice();
    if (has(/排队|队伍|站成一排|前面有|后面有|从前面数|从后面数|报数|第.{0,3}个/)) return this._genQueuePractice();
    if (has(/植树|种树|栽树|种了|棵树|间隔|路边|小路|花坛|池塘一圈|四周/)) return this._genTreePractice();
    if (has(/点钟|几点|时针|分针|钟表|钟面|点半|整点|从\d+点.*到\d+点/)) return this._genClockPractice();
    if (has(/速度|千米|公里|每小时|每分钟|路程|相距|两地|行驶|行了/)) return this._genSpeedPractice();
    if (has(/平均|分成|每组|每份|每盒|每盘/)) type = 'div';
    else if (has(/倍|每.{0,4}元|每.{0,4}个|单价/)) type = 'mul';
    else if (has(/一共|总共|共有|合起来|合在一起|又(买|来|捡|拿|放)|增加/)) type = 'add';
    else if (has(/还剩|剩下|还多|余|借走|吃了|用了|走了|送给|卖掉|拿走|飞走|去掉/)) type = 'sub';
    if (!type && has(/[+＋]/)) type = 'add';
    if (!type && has(/[-－]/)) type = 'sub';
    if (!type && has(/[×xX*]/)) type = 'mul';
    if (!type && has(/[÷/]/)) type = 'div';

    const maxNum = nums.length ? Math.max.apply(null, nums) : 0;
    const hi = maxNum >= 100 ? 1000 : maxNum >= 10 ? 100 : 20;
    const lo = Math.max(1, Math.floor(hi * 0.1));
    const randN = () => lo + Math.floor(Math.random() * (hi - lo));
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const P1 = () => pick(['小明', '小红', '小华', '小丽', '小东', '小芳', '小林', '小刚', '弟弟', '妹妹']);
    const P2 = () => pick(['爸爸', '妈妈', '同学', '老师', '朋友', '哥哥', '姐姐']);
    const I = () => pick(['苹果', '铅笔', '糖果', '练习本', '积木', '橡皮', '气球', '星星', '小旗', '饼干', '弹珠', '纽扣', '树叶', '贝壳', '乒乓球']);

    const NOTES = {
      add: '加法·求总数：把两部分合在一起，求"一共/总共"用加法',
      sub: '减法·求剩余：从总数里去掉用掉的，求"还剩/剩下"用减法',
      mul: '乘法·求总数：几个相同的数合起来，求"几个几/每份几个"用乘法',
      div: '除法·平均分：总数÷份数=每份数，求"平均分/每组几个"用除法'
    };

    const TPL = {
      add: [
        '{p}有 {a} 个 {i}，又买来 {b} 个 {i}，一共有多少个 {i}？',
        '{p}做了 {a} 朵花，{p2}又做了 {b} 朵花，两人一共做了多少朵花？',
        '停车场原来有 {a} 辆车，又开来了 {b} 辆，现在一共有多少辆车？'
      ],
      sub: [
        '{p}有 {a} 个 {i}，吃掉 {b} 个 {i}，还剩多少个 {i}？',
        '书架上有 {a} 本书，借走 {b} 本，还剩多少本？',
        '篮子里有 {a} 个鸡蛋，拿走 {b} 个，篮子里还有多少个鸡蛋？'
      ],
      mul: [
        '每组有 {a} 个小朋友，有 {b} 组，一共有多少个小朋友？',
        '每盒装 {a} 支铅笔，{b} 盒一共装多少支铅笔？',
        '{i}每个 {a} 元，买 {b} 个一共要多少元？'
      ],
      div: [
        '把 {a} 个 {i} 平均分给 {b} 个小朋友，每人分到几个？',
        '把 {a} 本书平均放在 {b} 个书架上，每个书架放几本？',
        '{a} 个气球每 {b} 个扎一束，能扎几束？'
      ]
    };

    const fill = (tpl) => {
      let a = randN(), b = randN();
      if (a < b) { const t3 = a; a = b; b = t3; }
      return tpl
        .replace(/\{p\}/g, P1()).replace(/\{p2\}/g, P2())
        .replace(/\{i\}/g, I())
        .replace(/\{a\}/g, a).replace(/\{b\}/g, b);
    };

    if (type && TPL[type]) {
      const tpls = TPL[type].slice();
      for (let i = tpls.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t2 = tpls[i]; tpls[i] = tpls[j]; tpls[j] = t2;
      }
      const note = NOTES[type];
      return [
        { text: fill(tpls[0]), kind: '相似题', note: note },
        { text: fill(tpls[1]), kind: '举一反三', note: note },
        { text: fill(tpls[2]), kind: '举一反三', note: note }
      ];
    }

    const m = t.match(/(\d+)\s*([+\-×xX*÷/])\s*(\d+)/);
    const baseOp = m ? m[2] : '';
    const makeOne = () => {
      const op = baseOp || ['+', '-', '×', '÷'][Math.floor(Math.random() * 4)];
      const a = randN(), b = randN();
      if (op === '-') return Math.max(a, b) + ' - ' + Math.min(a, b) + ' = ?';
      if (op === '÷' || op === '/') { const x = 1 + Math.floor(Math.random() * 9); return (x * (1 + Math.floor(Math.random() * 9))) + ' ÷ ' + x + ' = ?'; }
      if (op === '×' || op === 'x' || op === 'X' || op === '*') return a + ' × ' + b + ' = ?';
      return a + ' + ' + b + ' = ?';
    };
    const opNote = baseOp === '-' ? NOTES.sub : baseOp === '×' || baseOp === 'x' || baseOp === 'X' || baseOp === '*' ? NOTES.mul : baseOp === '÷' || baseOp === '/' ? NOTES.div : NOTES.add;
    const out = [];
    const seen = {};
    const add = (kind) => {
      let s = makeOne();
      let guard = 0;
      while (seen[s] && guard < 30) { s = makeOne(); guard++; }
      seen[s] = true;
      out.push({ text: s, kind: kind, note: opNote });
    };
    add('相似题');
    add('举一反三');
    add('举一反三');
    return out;
  },

  _genQueuePractice() {
    const P = () => ['小明', '小红', '小华', '小丽', '小东', '小芳', '小林'][Math.floor(Math.random() * 7)];
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '排队问题：总数=前面人数+后面人数+自己；从两头数同一个人时相加要减 1';
    const ans = [a+b-1, a+b+1, a-b];
    const tpls = [
      '{p}排队，从前面数排第 {a} 个，从后面数排第 {b} 个，这队一共有多少个小朋友？',
      '{p}排队做操，前面有 {a} 人，后面有 {b} 人，这一队一共有多少人？',
      '队伍里一共有 {a} 个小朋友，{p}排在第 {b} 个，他后面还有几个小朋友？'
    ];
    return tpls.map((tpl, idx) => {
      let a = rnd(2, 15), b = rnd(2, 15);
      if (a < b) { const t2 = a; a = b; b = t2; }
      return {
        text: tpl.replace(/\{p\}/g, P()).replace(/\{a\}/g, a).replace(/\{b\}/g, b),
        kind: idx === 0 ? '相似题' : '举一反三',
        note: note, answer: String(ans[idx])
      };
    });
  },

  _genTreePractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '植树问题：两端都种棵树=间隔数+1，封闭一圈棵树=间隔数（关键：先算有几段间隔）';
    const ans = [a/b+1, (a-1)*b, a/b];
    const tpls = [
      '小路一边每隔 {b} 米种一棵树，全长 {a} 米，两端都种，一共种多少棵树？',
      '在路边种 {a} 棵树，相邻两棵间隔 {b} 米，从第 1 棵到最后一棵有多长？',
      '花坛四周每隔 {b} 米放一盆花，花坛一圈长 {a} 米，一共放多少盆花？'
    ];
    return tpls.map((tpl, idx) => {
      let a, b;
      if (idx === 0) { b = rnd(2, 10); a = b * rnd(2, 15); }
      else if (idx === 1) { a = rnd(3, 15); b = rnd(2, 10); }
      else { b = rnd(2, 10); a = b * rnd(4, 15); }
      return { text: tpl.replace(/\{a\}/g, a).replace(/\{b\}/g, b), kind: idx === 0 ? '相似题' : '举一反三', note: note, answer: String(ans[idx]) };
    });
  },

  _genClockPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const step5 = () => rnd(0, 11) * 5;
    const note = '时钟问题：1 时 = 60 分，经过时间 = 结束时刻 - 开始时刻（先化成同一单位再算）';
    const P = () => ['小明', '小红', '小华', '小丽'][Math.floor(Math.random() * 4)];
    const ans = ['', (h2-h1)*60, ''];
    const tpls = [
      '现在是 {h} 点 {m} 分，再过 {x} 分钟是几点几分？',
      '从 {h1} 点整到 {h2} 点整，经过了多少分钟？',
      '{p} {h} 点 {m} 分出发，{x} 分钟后到达，到达时是几点几分？'
    ];
    return tpls.map((tpl, idx) => {
      if (idx === 0) {
        const m = rnd(0, 9) * 5, x = rnd(1, 9) * 5, h = rnd(1, 11);
        return { text: tpl.replace('{h}', h).replace('{m}', m).replace('{x}', x), kind: '相似题', note: note, answer: String(ans[idx]) };
      }
      if (idx === 1) {
        const h1 = rnd(1, 9), h2 = h1 + rnd(1, 3);
        return { text: tpl.replace('{h1}', h1).replace('{h2}', h2), kind: '举一反三', note: note };
      }
      const h = rnd(1, 10), m = step5(), x = rnd(1, 10) * 5;
      const total = m + x;
      const h2 = h + (total >= 60 ? 1 : 0);
      const m2 = total % 60;
      return { text: tpl.replace('{p}', P()).replace('{h}', h).replace('{m}', m).replace('{x}', x).replace('{h2}', h2).replace('{m2}', m2), kind: '举一反三', note: note };
    });
  },

  _genSpeedPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '行程问题：路程 = 速度 × 时间；求时间 = 路程 ÷ 速度（三个量知二求一）';
    const P = () => ['小明', '小红', '小华', '小丽'][Math.floor(Math.random() * 4)];
    const ans = [v*t, d/v, v*t];
    const tpls = [
      '汽车每小时行 {v} 千米，行了 {t} 小时，一共行了多少千米？',
      '两地相距 {d} 千米，汽车每小时行 {v} 千米，需要几小时到达？',
      '{p}每分钟走 {v} 米，走了 {t} 分钟，一共走了多少米？'
    ];
    const v = rnd(3, 9) * 10, t = rnd(1, 6);
    const d = v * t;
    return tpls.map((tpl, idx) => {
      return {
        text: tpl.replace(/\{p\}/g, P()).replace(/\{v\}/g, v).replace(/\{t\}/g, t).replace('{d}', d),
        kind: idx === 0 ? '相似题' : '举一反三',
        note: note, answer: String(ans[idx])
      };
    });
  },

  _genChickenRabbitPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '鸡兔同笼：假设全是鸡，多出的脚数÷2=兔数（差量法）';
    const h = rnd(8, 25);
    const r = rnd(2, h - 2);
    const f = 2 * (h - r) + 4 * r;
    const P = () => ['停车场', '车棚里'][Math.floor(Math.random() * 2)];
    const ans = [r, h-r, r];
    const tpls = [
      '笼子里有鸡和兔共 {h} 只，数脚共有 {f} 只，兔有多少只？',
      '鸡兔同笼，头共 {h} 个，脚共 {f} 只，鸡有多少只？',
      P() + '停了 {h} 辆车，两轮车和四轮车共有 {f} 个轮子，四轮车有多少辆？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{h}', h).replace('{f}', f),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genConcentrationPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '浓度问题：浓度 = 溶质 ÷ 溶液 ×100%（盐水 = 盐 + 水）';
    const k = rnd(2, 8);
    const s = rnd(1, 4) * k, w = rnd(5, 15) * k;
    const p = Math.round(s * 100 / (s + w));
    const w2 = rnd(5, 12) * k;
    const p2 = Math.round(s * 100 / (s + w + w2));
    const ans = [p, s+w, ''];
    const tpls = [
      '{s} 克盐溶在 {w} 克水中，盐水浓度是多少？',
      '盐水浓度是 {p}%，其中 {s} 克是盐，盐水一共多少克？',
      '{s} 克糖溶在 {w} 克水中，糖水浓度是多少？如果再加入 {w2} 克水，浓度变成多少？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{s}', s).replace('{w}', w).replace('{p}', p).replace('{w2}', w2).replace('{p2}', p2),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genProfitPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '利润问题：利润 = 售价 - 进价；折扣 = 现价 ÷ 原价（打几折就是原价的十分之几）';
    const p = rnd(10, 50) * 10;
    const x = rnd(5, 20) * 10;
    const o = rnd(1, 9) * 100, d = rnd(7, 9);
    const ans = [x, p+x, o*d/10];
    const tpls = [
      '一件商品进价 {p} 元，售价 {q} 元，赚了多少元？',
      '一件商品进价 {p} 元，卖出后赚了 {x} 元，售价是多少元？',
      '一件商品原价 {o} 元，打 {d} 折出售，现价是多少元？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{p}', p).replace('{q}', p + x).replace('{x}', x).replace('{o}', o).replace('{d}', d),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genAgePractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '年龄问题：年龄差永远不变，只会随着年份一起增加';
    const s = rnd(7, 12);
    const diff = rnd(25, 35);
    const f = s + diff;
    const n = rnd(3, 10);
    const ans = [diff, f, diff];
    const tpls = [
      '爸爸今年 {f} 岁，小明今年 {s} 岁，爸爸比小明大多少岁？',
      '小明今年 {s} 岁，爸爸比他大 {diff} 岁，爸爸今年多少岁？',
      '爸爸今年 {f} 岁，小明今年 {s} 岁，再过 {n} 年，爸爸比小明大多少岁？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{f}', f).replace('{s}', s).replace('{diff}', diff).replace('{n}', n),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genSumDiffPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '和差问题：大数 = (和 + 差) ÷ 2，小数 = (和 - 差) ÷ 2';
    const b = rnd(10, 30);
    let a = b + rnd(5, 20);
    if ((a + b) % 2 !== 0) a += 1;
    const P = () => ['甲、乙两数', '两筐水果'][Math.floor(Math.random() * 2)];
    const ans = [a, a, a];
    const tpls = [
      '甲、乙两数的和是 {sum}，差是 {diff}，甲、乙各是多少？',
      '两筐水果共 {sum} 千克，第一筐比第二筐多 {diff} 千克，两筐各有多少千克？',
      '哥哥和弟弟一共有 {sum} 元，哥哥比弟弟多 {diff} 元，两人各有多少元？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{sum}', a + b).replace('{diff}', a - b),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genTimesPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '和倍/差倍问题：一倍量 = 和 ÷ (倍数+1) 或 差 ÷ (倍数-1)';
    const k = rnd(2, 4);
    const b = rnd(8, 25);
    const a = k * b;
    const useDiff = Math.random() < 0.5;
    const ans = [a, a, a];
    const tpls = [
      '甲、乙两数的和是 {sum}，甲是乙的 {k} 倍，甲、乙各是多少？',
      '图书角有 {sum} 本书，故事书的本数是科技书的 {k} 倍，两种书各有多少本？',
      useDiff
        ? '苹果比梨多 {diff} 个，苹果个数是梨的 {k} 倍，苹果和梨各有多少个？'
        : '爷爷和孙子的年龄和是 {sum} 岁，爷爷年龄是孙子的 {k} 倍，两人各多少岁？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{sum}', a + b).replace('{diff}', a - b).replace('{k}', k),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genAveragePractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '平均数问题：总数 ÷ 份数 = 平均数';
    const avg = rnd(80, 96);
    const x1 = avg + rnd(-8, 8), x2 = avg + rnd(-8, 8);
    const x3 = 3 * avg - x1 - x2;
    const n = rnd(4, 8);
    const total = n * rnd(3, 8);
    const d = rnd(2, 6);
    const a = d * rnd(15, 40);
    const P = () => ['小明', '小红', '小华'][Math.floor(Math.random() * 3)];
    const ans = [avg, total/n, a/d];
    const tpls = [
      '小明三次数学测试的成绩分别是 {x1}、{x2}、{x3} 分，平均分是多少？',
      '某小组 {n} 名同学一共做了 {total} 道口算题，平均每人做了几道？',
      '一本书有 {a} 页，' + P() + '用了 {d} 天看完，平均每天看多少页？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{x1}', x1).replace('{x2}', x2).replace('{x3}', x3).replace('{n}', n).replace('{total}', total).replace('{a}', a).replace('{d}', d),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genUnitPricePractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '归一问题：先求"一份是多少"（单价、每小时量），再求总量';
    const u = rnd(3, 12);
    const n1 = rnd(2, 5), n2 = rnd(6, 12);
    const t1 = rnd(2, 4), t2 = rnd(5, 8);
    const v = rnd(40, 80);
    const g = 4, gp = rnd(2, 5);
    const ans = [u*n2, gp, v*t2];
    const tpls = [
      '买 {n1} 个笔记本花了 {m} 元，买 {n2} 个同样的笔记本需要多少元？',
      '{n} 名同学 {t} 天植树 {total} 棵，平均每人每天植树多少棵？',
      '一辆汽车 {t1} 小时行了 {d} 千米，照这样的速度，{t2} 小时可以行多少千米？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{n1}', n1).replace('{n2}', n2).replace('{m}', u * n1).replace('{n}', g).replace('{t}', t1).replace('{total}', g * t1 * gp).replace('{t1}', t1).replace('{t2}', t2).replace('{d}', v * t1),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genMeetPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '相遇问题：总路程 = 速度和 × 相遇时间，相遇时间 = 总路程 ÷ 速度和';
    const v1 = rnd(3, 6) * 10, v2 = rnd(4, 7) * 10, t = rnd(1, 4);
    const d = (v1 + v2) * t;
    const s = v1 + v2;
    const ans = [t, t, d];
    const tpls = [
      '甲、乙两地相距 {d} 千米，两车同时从两地相向而行，甲车每小时行 {v1} 千米，乙车每小时行 {v2} 千米，几小时相遇？',
      '两人同时从相距 {d} 米的两地相向而行，他们的速度和是每分钟 {s} 米，几分钟后相遇？',
      '甲、乙两人相向而行，{t} 小时后相遇，甲每小时走 {v1} 千米，乙每小时走 {v2} 千米，两地相距多少千米？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{d}', d).replace('{v1}', v1).replace('{v2}', v2).replace('{t}', t).replace('{s}', s),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genWorkPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '工程问题：合作效率 = 各自效率之和，总量 ÷ 效率和 = 合作时间';
    const a = rnd(20, 50), b = rnd(30, 60), t = rnd(3, 8);
    const L = (a + b) * t;
    const da = rnd(6, 12), db = rnd(8, 15);
    const ans = [t, '', (a+b)*t];
    const tpls = [
      '修一条 {L} 米的路，甲队每天修 {a} 米，乙队每天修 {b} 米，两队合修需要几天完成？',
      '一项工程，甲队单独做需要 {da} 天完成，乙队单独做需要 {db} 天完成，两队合作每天完成全部工程的几分之几？',
      '打一份文件，甲每分钟打 {a} 个字，乙每分钟打 {b} 个字，两人合打 {t} 分钟一共打了多少个字？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{L}', L).replace('{a}', a).replace('{b}', b).replace('{t}', t).replace('{da}', da).replace('{db}', db),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genGeometryPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '几何问题：长方形周长=(长+宽)×2，面积=长×宽；正方形周长=边长×4，面积=边长×边长';
    const L = rnd(8, 20);
    const W = rnd(4, L - 1);
    const a = rnd(5, 12);
    const ans = [2*(L+W), L*W, ''];
    const tpls = [
      '一个长方形操场，长 {L} 米，宽 {W} 米，绕操场跑一圈是多少米？',
      '一个长方形菜地，长 {L} 米，宽 {W} 米，这块菜地的面积是多少平方米？',
      '一个正方形花坛，边长 {a} 米，它的周长和面积各是多少？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{L}', L).replace('{W}', W).replace('{a}', a),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genFractionPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '分数问题：求一个数的几分之几用乘法，先按分母"分份"再取分子份';
    const den = rnd(3, 6), k = rnd(4, 20);
    const num = rnd(1, den - 1);
    const T = den * k, L = den * rnd(2, 8);
    const ans = [T*num/den, L*num/den, T*(den-num)/den];
    const tpls = [
      '学校买来 {T} 本图书，其中 {num}/{den} 是故事书，故事书有多少本？',
      '一根绳子长 {L} 米，用去了它的 {num}/{den}，用去了多少米？',
      '全班有 {T} 人，其中 {num}/{den} 是女生，男生有多少人？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{T}', T).replace('{L}', L).replace('{num}', num).replace('{den}', den),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genCyclePractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '周期问题：总数 ÷ 周期长度 = 组数……余数，看余数确定第几个';
    const len = rnd(3, 5);
    const colors = ['红', '黄', '蓝', '绿', '紫'];
    const set = colors.slice(0, len).join('、');
    const n = rnd(len + 3, len * 8);
    const dow = ['一', '二', '三', '四', '五', '六', '日'];
    const w = rnd(0, 6);
    const d = rnd(7, 30);
    const tpls = [
      '彩旗按{set}的顺序排列，第 {n} 面彩旗是什么颜色？',
      '按{set}的顺序依次排列，第 {n} 个是什么颜色？',
      '今天是星期{w1}，再过 {d} 天是星期几？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{n}', n).replace('{w1}', dow[w]).replace('{d}', d),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note
    }));
  },

  _genFoldPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '拼剪图形：拼接后减少公共边（拼一次少 2 条边），先想清楚拼完后的长和宽';
    const a = rnd(3, 10);
    const n = rnd(3, 8);
    const w = rnd(3, 10), l = 2 * w;
    const ans = [6*a, 2*a*(n+1), 4*w];
    const tpls = [
      '用两个边长 {a} 厘米的正方形拼成一个长方形，这个长方形的周长是多少厘米？',
      '用 {n} 个边长 {a} 厘米的小正方形排成一排，拼成一个长方形，这个长方形的周长是多少厘米？',
      '把一张长 {l} 厘米、宽 {w} 厘米的长方形纸，剪成两个完全一样的正方形，每个正方形的周长是多少厘米？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{a}', a).replace('{n}', n).replace('{l}', l).replace('{w}', w),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genLogicPractice() {
    const note = '逻辑推理：先假设一种情况成立，推出矛盾就排除，剩下唯一成立的答案';
    const tpls = [
      '甲、乙、丙三人中，只有一个人说真话。甲说：是乙做的。乙说：不是我做的。丙说：不是我做的。这件事是谁做的？',
      '甲比乙高，丙比乙矮。三个人中谁最高？',
      '小狗、小猫、小兔三个动物比赛跳远，小狗说：我不是最后一名。小猫说：我是第一名（小猫说的是真话）。谁得了最后一名？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl,
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note
    }));
  },

  _genArrangePractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '统筹问题：找出可以同时进行的事情，总时间 = 顺序任务之和 + 并行任务中最长的那个';
    const t1 = rnd(6, 10), t2 = rnd(2, 4);
    let t3 = rnd(2, t1 - t2 - 1);
    if (t3 < 2) t3 = 2;
    const a = rnd(2, 5), b = rnd(15, 25), c = rnd(5, 12);
    const ans = [t1, a+b, t1];
    const tpls = [
      '小明要沏茶招待客人：烧水需要 {t1} 分钟，洗茶壶需要 {t2} 分钟，洗茶杯需要 {t3} 分钟。烧水的同时可以洗茶壶和洗茶杯，做完这些事情至少需要多少分钟？',
      '妈妈做饭：洗米需要 {a} 分钟，煮饭需要 {b} 分钟，炒菜需要 {c} 分钟。煮饭的同时可以炒菜，最少需要多少分钟才能开饭？',
      '小红要喝牛奶：热牛奶需要 {t1} 分钟，热牛奶的同时可以整理书包 {t2} 分钟、穿外套 {t3} 分钟，最少需要多少分钟？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{t1}', t1).replace('{t2}', t2).replace('{t3}', t3).replace('{a}', a).replace('{b}', b).replace('{c}', c),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genPigeonPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '抽屉原理：物品数 ÷ 抽屉数 = 商……余数，至少有"商 + 1"个（有余数时）';
    const a = rnd(5, 20), b = rnd(2, 4);
    const n = rnd(13, 36);
    const a2 = rnd(6, 15), b2 = rnd(2, Math.min(5, a2 - 1));
    const ans = [Math.ceil(a/b), Math.ceil(n/12), a2-b2];
    const tpls = [
      '把 {a} 个苹果放进 {b} 个抽屉里，无论怎样放，总有一个抽屉里至少有几个苹果？',
      '一年有 12 个月，{n} 个同学中至少有几个同学的生日在同一个月？',
      '{a2} 个小朋友玩抢椅子游戏，只有 {b2} 把椅子，至少有几个小朋友要站着？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{a}', a).replace('{b}', b).replace('{n}', n).replace('{a2}', a2).replace('{b2}', b2),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genEquationPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '解方程：等式两边同时加、减、乘、除以同一个数，等式仍然成立';
    const a = rnd(5, 30), b = a + rnd(10, 60);
    const c = rnd(10, 50), d = rnd(5, 30);
    const k = rnd(2, 9), v = k * rnd(4, 15);
    const ans = [b-a, c+d, v/k];
    const tpls = [
      '解方程：x + {a} = {b}，求 x 是多少？',
      '解方程：x - {c} = {d}，求 x 是多少？',
      '解方程：{k}x = {v}，求 x 是多少？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{a}', a).replace('{b}', b).replace('{c}', c).replace('{d}', d).replace('{k}', k).replace('{v}', v),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genSubstitutePractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '等量代换：把未知量一步步换成已知量，像链条一样传递';
    const a = rnd(2, 4), b = rnd(2, 4);
    const a2 = rnd(2, 4), b2 = rnd(2, 4), c2 = rnd(2, 4);
    const ans = [a*b, a2*b2*c2, a*b*3];
    const tpls = [
      '1 个苹果 = {a} 个橘子，1 个橘子 = {b} 个草莓。1 个苹果 = 多少个草莓？',
      '1 只鹅 = {a2} 只鸡，1 只鸡 = {b2} 只鸭。{c2} 只鹅 = 多少只鸭？',
      '1 支钢笔 = {a} 支铅笔，1 支铅笔 = {b} 块橡皮。3 支钢笔 = 多少块橡皮？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{a}', a).replace('{b}', b).replace('{a2}', a2).replace('{b2}', b2).replace('{c2}', c2),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genClockAnglePractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '钟表角度：分针每分钟走 6°，时针每小时走 30°；整点时夹角 = 点数×30°（超过 180° 取另一边的角）';
    const h = rnd(1, 11);
    const ans = [Math.min(h*30,360-h*30), Math.min(h*30,360-h*30), Math.min(h*30,360-h*30)];
    const tpls = [
      '{h} 点整时，钟面上时针和分针的夹角是多少度？',
      '{h} 点整时，时针和分针组成的最小角是多少度？',
      '钟面上 {h} 点整，时针和分针之间的夹角是多少度？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{h}', h),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genComparePractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '方案比较：先算出"每份的价格"（单价）再比较，或算出总价再比较';
    const p = rnd(3, 8), p2 = p + rnd(1, 3), n = rnd(3, 10);
    const s = rnd(5, 15), k = rnd(1, 3);
    const t = (s - k) * 10;
    const m = rnd(3, 10);
    const a3 = rnd(2, 5) * m, b3 = rnd(2, 5) * m;
    const ans = [n*(p2-p), 10*s-t, ''];
    const tpls = [
      'A 店每个笔记本 {p} 元，B 店每个笔记本 {p2} 元。买 {n} 个，去哪家店买更便宜？便宜多少元？',
      '牛奶单买每盒 {s} 元，整箱购买每箱 {t} 元（10 盒）。要买 10 盒，哪种买法更划算？能省多少元？',
      'A 品牌牛奶 {a3} 元 3 盒，B 品牌牛奶 {b3} 元 5 盒。买同样多的牛奶，哪个品牌更便宜？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{p}', p).replace('{p2}', p2).replace('{n}', n).replace('{s}', s).replace('{t}', t).replace('{a3}', a3).replace('{b3}', b3),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genPatternPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '找规律：先看相邻两数的差或倍数关系，再按规律推算下一项';
    const a1 = rnd(1, 5), d = rnd(2, 6);
    const a2 = rnd(2, 4);
    const kinds = ['square', 'fib'];
    const k2 = kinds[Math.floor(Math.random() * 2)];
    const ans = [a1+4*d, a2*16, k2==='square'?36:13];
    const tpls = [
      a1 + '、' + (a1 + d) + '、' + (a1 + 2 * d) + '、' + (a1 + 3 * d) + '、（  ）。按规律填数，括号里应填多少？',
      a2 + '、' + a2 * 2 + '、' + a2 * 4 + '、' + a2 * 8 + '、（  ）。按规律填数，括号里应填多少？',
      k2 === 'square'
        ? '1、4、9、16、25、（  ）。按规律填数，括号里应填多少？'
        : '1、1、2、3、5、8、（  ）。按规律填数，括号里应填多少？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl,
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genSolidPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '立体图形：长方体体积=长×宽×高；正方体表面积=棱长×棱长×6；圆柱体积=底面积×高';
    const l = rnd(3, 12), w = rnd(2, 10), h = rnd(2, 10);
    const a = rnd(2, 8);
    const s = rnd(10, 30), h2 = rnd(3, 10);
    const ans = [l*w*h, 6*a*a, s*h2];
    const tpls = [
      '一个长方体，长 {l} 厘米、宽 {w} 厘米、高 {h} 厘米，它的体积是多少立方厘米？',
      '一个正方体的棱长是 {a} 厘米，它的表面积是多少平方厘米？',
      '一个圆柱的底面积是 {s} 平方厘米，高 {h2} 厘米，它的体积是多少立方厘米？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{l}', l).replace('{w}', w).replace('{h}', h).replace('{a}', a).replace('{s}', s).replace('{h2}', h2),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genUnitPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '单位换算：千米→米×1000，时→分×60，千克→克×1000（大单位换小单位乘进率）';
    const km = rnd(1, 9), m = rnd(100, 900);
    const h = rnd(1, 5), m2 = rnd(10, 59);
    const kg = rnd(1, 5), g = rnd(100, 900);
    const ans = [km*1000+m, h*60+m2, kg*1000+g];
    const tpls = [
      '单位换算：{km} 千米 {m} 米 = （    ）米',
      '单位换算：{h} 小时 {m2} 分 = （    ）分',
      '单位换算：{kg} 千克 {g} 克 = （    ）克'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{km}', km).replace('{m}', m).replace('{h}', h).replace('{m2}', m2).replace('{kg}', kg).replace('{g}', g),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genMoneyPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '人民币：1 元 = 10 角；找零用"付的钱 - 应付的钱"，角不够减时向元借 1';
    const y = rnd(1, 9), j = rnd(1, 9), f = y + rnd(1, 3);
    const y2 = rnd(1, 9), y3 = rnd(1, 9);
    const bigs = [10, 20, 50];
    const big = bigs[rnd(0, 2)];
    let small;
    do { small = [1, 2, 5, 10][rnd(0, 3)]; } while (big % small !== 0);
    const ans = ['', y2+y3, big/small];
    const tpls = [
      '一支钢笔 {y} 元 {j} 角，小华付了 {f} 元，应找回多少钱？',
      '买一个 {y2} 元的文具盒和一支 {y3} 元的铅笔，一共需要多少元？',
      '1 张 {big} 元的人民币可以换成多少张 {small} 元的人民币？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{y}', y).replace('{j}', j).replace('{f}', f).replace('{y2}', y2).replace('{y3}', y3).replace('{big}', big).replace('{small}', small),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genPromoPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '买赠问题：先算"实际需要付款的数量"，赠送的数量不用付钱';
    const k = rnd(2, 5), g = rnd(2, 4), p = rnd(2, 6);
    const need = (k + 1) * g;
    const k2 = rnd(2, 5), s = rnd(1, 3), p2 = rnd(2, 6);
    const n2 = (k2 + s) * g;
    const ans = [k*g*p, k*g*p, k2*g*p2];
    const tpls = [
      '牛奶每瓶 {p} 元，超市搞促销"买 {k} 瓶送 1 瓶"。要买 {need} 瓶，最少要付多少钱？',
      '牛奶每瓶 {p} 元，现在"买 {k} 瓶送 1 瓶"。买 {need} 瓶实际要付多少钱？',
      '酸奶每袋 {p2} 元，现在"买 {k2} 袋送 {s} 袋"。要买 {n2} 袋，实际要付多少钱？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{p}', p).replace('{k}', k).replace('{need}', need).replace('{k2}', k2).replace('{s}', s).replace('{p2}', p2).replace('{n2}', n2),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genPercentPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '百分数：变化量 = 原量 × 百分率；现量 = 原量 ± 变化量';
    const p = rnd(1, 5) * 10;
    const b = rnd(20, 80) * 10;
    const o = rnd(10, 50) * 10;
    const n = rnd(10, 50) * 10;
    const ans = [b*(100+p)/100, o*(100-p)/100, n*(100-p)/100];
    const tpls = [
      '去年产量是 {b} 千克，今年比去年增产 {p}%，今年产量是多少千克？',
      '一件商品原价 {o} 元，降价 {p}% 出售，现价是多少元？',
      '一本书共 {n} 页，已经读了 {p}%，还剩多少页没读？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{b}', b).replace('{p}', p).replace('{o}', o).replace('{n}', n),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genRatioPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '按比分配：先算总份数，每份 = 总数 ÷ 总份数，再乘各自的份数';
    const a = rnd(2, 4), b = rnd(3, 5), k = rnd(2, 6);
    const n = (a + b) * k;
    const c = rnd(3, 5);
    const n2 = (a + b + c) * k;
    const ans = [a*k, a*k, b*k];
    const tpls = [
      '把 {n} 个苹果按 {a}:{b} 分给甲、乙两人，甲分到多少个？',
      '混凝土按水泥、砂、石子的比是 {a}:{b}:{c} 来配制，要配制 {n2} 千克混凝土，需要水泥多少千克？',
      '甲、乙两数的比是 {a}:{b}，两数的和是 {n}，乙数是多少？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{a}', a).replace('{b}', b).replace('{c}', c).replace('{n}', n).replace('{n2}', n2),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genProbabilityPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '可能性：可能性 = 目标情况数 ÷ 总情况数（用分数表示）';
    const gcd = (x, y) => { while (y) { const t = x % y; x = y; y = t; } return x; };
    const r = rnd(2, 8);
    let b;
    do { b = rnd(2, 9); } while (gcd(r, r + b) !== 1);
    const n = rnd(4, 10), r2 = rnd(1, n - 1);
    const tpls = [
      '袋子里有 {r} 个红球和 {b} 个蓝球，任意摸一个，摸到红球的可能性是几分之几？',
      '一个骰子掷一次，掷出偶数的可能性是几分之几？',
      '一个转盘平均分成 {n} 份，其中 {r2} 份涂了红色。转动转盘，指针停在红色区域的可能性是几分之几？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{r}', r).replace('{b}', b).replace('{n}', n).replace('{r2}', r2),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note
    }));
  },

  _genTemperaturePractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '温度问题：零下 a℃ 到零上 b℃ 的温差 = a + b；零下到零下用较大的数减较小的数';
    const a = rnd(1, 15), b = rnd(1, 15);
    const c = rnd(2, 8);
    const a2 = rnd(5, 18);
    const a3 = rnd(3, 15), b3 = rnd(1, a3 - 1);
    const ans = [a+b, a2+c, a3-b3];
    const tpls = [
      '某天早晨气温是零下 {a}℃，中午升到零上 {b}℃。这一天的温差是多少℃？',
      '冰箱冷冻室温度是零下 {a2}℃，冷藏室温度是 {c}℃。冷藏室比冷冻室高多少度？',
      '从零下 {a3}℃ 升到零下 {b3}℃，气温升高了多少度？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{a}', a).replace('{b}', b).replace('{c}', c).replace('{a2}', a2).replace('{a3}', a3).replace('{b3}', b3),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genMistakePractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '错中求解：先算出"看错带来的差"，再按多算/少算改正回去';
    const P = () => ['小明', '小红', '小华', '小丽'][Math.floor(Math.random() * 4)];
    const a = rnd(20, 90), b = rnd(20, 90), x = rnd(1, 8), y = x + rnd(1, 9 - x);
    const r = a + b + (y - x);
    const fa = rnd(10, 40), d = rnd(1, 5), m = rnd(2, 9);
    const add = m * d;
    const b3 = rnd(30, 99), x2 = rnd(1, 3), y2 = x2 + rnd(1, 9 - x2);
    const delta = (y2 - x2) * 10;
    const d0 = rnd(10, 60);
    const r3 = d0 + delta;
    const ans = [a+b, m, d0];
    const tpls = [
      P() + '计算 {a}+{b} 时，把 {b} 个位上的 {x} 看成了 {y}，得到的和是 {r}。正确得数是多少？',
      P() + '在算乘法时，把因数 {fa} 看成了 {fb}，算出的积多了 {add}。另一个因数是多少？',
      P() + '计算减法时，把减数 {b3} 十位上的 {x2} 看成了 {y2}，得到的差是 {r3}。正确的差是多少？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{a}', a).replace('{b}', b).replace('{x}', x).replace('{y}', y).replace('{r}', r).replace('{fa}', fa).replace('{fb}', fa + d).replace('{add}', add).replace('{b3}', b3).replace('{x2}', x2).replace('{y2}', y2).replace('{r3}', r3),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genReversePractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '还原问题：从最后结果往前倒推，加变减、减变加（逆运算）';
    const P = () => ['小明', '小红', '小华', '小丽'][Math.floor(Math.random() * 4)];
    const orig = rnd(20, 60), a = rnd(3, 10), b = rnd(3, 10);
    const c = orig - a + b;
    const a2 = rnd(3, 10), b2 = rnd(5, 20);
    const ans = [orig, 2*(a+b), 2*(a2+b2)];
    const tpls = [
      P() + '有一些邮票，送给小华 {a} 张，又买来 {b} 张，现在有 {c} 张。原来有多少张？',
      '一筐苹果，卖掉一半后又卖掉 {a} 个，还剩 {b} 个。这筐苹果原来有多少个？',
      P() + '把零花钱的一半存起来，又用掉 {a2} 元，还剩 {b2} 元。原来有多少元？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{a}', a).replace('{b}', b).replace('{c}', c).replace('{a2}', a2).replace('{b2}', b2),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genOverlapPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '容斥原理：至少一项 = A + B - 两项都参加（重叠部分只算一次）';
    const a = rnd(20, 35), b = rnd(20, 35);
    const c = rnd(8, Math.min(a, b));
    const n = rnd(a + b - c, 70);
    const ans = [a+b-c, a+b-c, a+b-c];
    const tpls = [
      '全班有 {n} 人，喜欢语文的有 {a} 人，喜欢数学的有 {b} 人，两科都喜欢的有 {c} 人。至少喜欢一科的有多少人？',
      '班里会游泳的有 {a} 人，会滑冰的有 {b} 人，两项都会的有 {c} 人。至少会一项的有多少人？',
      '参加美术兴趣小组的有 {a} 人，参加音乐兴趣小组的有 {b} 人，两组都参加的有 {c} 人。参加兴趣小组的共有多少人？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{n}', n).replace('{a}', a).replace('{b}', b).replace('{c}', c),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genScalePractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '比例尺问题：图上距离 ÷ 比例尺 = 实际距离（比例尺 = 图上 : 实际，先统一单位）';
    const k = rnd(1, 9);
    const scale = 100000 * k;
    const cm = rnd(2, 9);
    const km = k * rnd(2, 9);
    const ans = [cm*k, km/k, km/k];
    const tpls = [
      '一幅地图的比例尺是 1:{scale}，图上量得两地相距 {cm} 厘米，实际距离是多少千米？',
      '在比例尺 1:{scale} 的地图上，两地实际相距 {km} 千米，图上距离是多少厘米？',
      '学校到少年宫的实际距离是 {km} 千米，画在比例尺 1:{scale} 的地图上，图上距离是多少厘米？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{scale}', scale).replace('{cm}', cm).replace('{km}', km),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genBalancePractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '移多补少：多出的部分 ÷ 2 就是要"补"给对方的数量';
    let a = rnd(20, 50), b = rnd(4, a - 4);
    if ((a - b) % 2 !== 0) b += 1;
    const sum = 2 * rnd(15, 30), d = 2 * rnd(1, 15);
    const ans = [(a-b)/2, (a-b)/2, d/2];
    const tpls = [
      '甲有 {a} 个苹果，乙有 {b} 个苹果，甲给乙几个后两人的苹果就一样多？',
      '第一排有 {a} 人，第二排有 {b} 人，从第一排调几人到第二排，两排人数就相等？',
      '两队共有 {sum} 人，第一队比第二队多 {d} 人，第一队调几人给第二队后两队人数相等？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{a}', a).replace('{b}', b).replace('{sum}', sum).replace('{d}', d),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genMatrixPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '方阵问题：最外层人数 = 每边人数 × 4 - 4（角上的人被算了两次）；总人数 = 每边人数 × 每边人数';
    const n = rnd(5, 12);
    const ans = [4*n-4, 4*n-4, n*n];
    const tpls = [
      '同学们排成正方形方阵做操，每边站 {n} 人。最外层一共有多少人？',
      '正方形花坛四周摆花，每边摆 {n} 盆（四个角都要摆），最外层一共摆多少盆？',
      '同学们排成每边 {n} 人的正方形方阵，一共有多少人？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{n}', n),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genSumPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '等差数列求和：和 =（首项 + 末项）× 项数 ÷ 2';
    const a = rnd(1, 5), n = rnd(4, 10), b = a + n - 1;
    const m = rnd(20, 100);
    const ans = [(a+b)*n/2, m*(m+1)/2, (a+b)*n/2];
    const tpls = [
      '一堆钢管堆成梯形，最上层 {a} 根，最下层 {b} 根，每层比上一层多 1 根。这堆钢管一共有多少根？',
      '计算 1+2+3+…+{m} 的和是多少？',
      '从 {a} 开始，连续 {n} 个自然数的和是多少？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{a}', a).replace('{b}', b).replace('{n}', n).replace('{m}', m),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genAnglePractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '三角形内角和 = 180°；直角三角形两个锐角和 = 90°；等腰三角形两个底角相等';
    const x = rnd(30, 80), y = rnd(30, 150 - x);
    const r = rnd(20, 70);
    const z = 2 * rnd(10, 50);
    const ans = [180-x-y, 90-r, (180-z)/2];
    const tpls = [
      '三角形中，一个角是 {x}°，另一个角是 {y}°，第三个角是多少度？',
      '直角三角形中，一个锐角是 {r}°，另一个锐角是多少度？',
      '等腰三角形的顶角是 {z}°，一个底角是多少度？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{x}', x).replace('{y}', y).replace('{r}', r).replace('{z}', z),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genRiverPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '流水行船：顺水速度 = 船速 + 水速；逆水速度 = 船速 - 水速';
    const s = rnd(20, 35), c = rnd(2, 8);
    const t = rnd(1, 4);
    const up = s + c, down = s - c;
    const ans = [up*t, down*t, (up+down)/2];
    const tpls = [
      '船在静水中的速度是每小时 {s} 千米，水流速度是每小时 {c} 千米。顺水行 {d1} 千米需要几小时？',
      '船在静水中的速度是每小时 {s} 千米，水流速度是每小时 {c} 千米。逆水行 {d2} 千米需要几小时？',
      '一艘船顺水每小时行 {up} 千米，逆水每小时行 {down} 千米。船在静水中每小时行多少千米？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{s}', s).replace('{c}', c).replace('{d1}', up * t).replace('{d2}', down * t).replace('{up}', up).replace('{down}', down),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genCounterfeitPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '找次品：尽量平均分成 3 份，每称一次排除 2/3；称 k 次最多能区分 3 的 k 次方个';
    const k = rnd(2, 3);
    const n = Math.pow(3, k);
    const m = rnd(4, 9);
    const ans = [k, 2, k];
    const tpls = [
      '有 {n} 个外观一样的零件，其中 1 个轻一些。用没有砝码的天平至少称几次，一定能找出这个次品？',
      '有 {m} 个乒乓球，其中 1 个略轻。用天平至少称几次能保证找出这个乒乓球？',
      '在 {n} 个金币中有 1 个假币略重，用天平最少称几次能找出假币？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{n}', n).replace('{m}', m),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genListPractice() {    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '列举问题：分步用乘法原理；单循环比赛场数 = 人数×(人数-1)÷2（每场被算两次要除以 2）';
    const n1 = rnd(1, 4), n2 = n1 + rnd(1, 3), n3 = n2 + rnd(1, 4);
    const m = rnd(4, 8);
    const x = rnd(2, 4), y = rnd(2, 4);
    const ans = [6, m*(m-1)/2, x*y];
    const tpls = [
      '用 {a}、{b}、{c} 三张数字卡片，每次取两张组成两位数（每个数字只能用一次），一共能组成多少个不同的两位数？',
      '有 {m} 名同学进行乒乓球比赛，每两人之间都要赛一场，一共要赛多少场？',
      '小明有 {x} 件上衣和 {y} 条裤子，一件上衣配一条裤子，一共有多少种不同的穿法？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{a}', n1).replace('{b}', n2).replace('{c}', n3).replace('{m}', m).replace('{x}', x).replace('{y}', y),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genCattlePractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '牛吃草问题：每天净消耗 = 牛数 - 每天生长量，天数 = 原有草量 ÷ 每天净消耗';
    const t1 = rnd(2, 4);
    const t2 = 2 * t1;
    const v = rnd(2, 5);
    const k = t1 * rnd(1, 2);
    const a = v * t2 * k;
    const n1 = a / t1 + v, n2 = a / t2 + v;
    const t3 = t1 * t2;
    const n3 = a / t3 + v;
    const np = v + rnd(2, 6);
    const tp = rnd(2, 8);
    const ap = (np - v) * tp;
    const ans = [t3, t3, tp];
    const tpls = [
      '一片牧草每天匀速生长，可供 {n1} 头牛吃 {t1} 天，或供 {n2} 头牛吃 {t2} 天。照这样计算，可供 {n3} 头牛吃多少天？',
      '草场上的草每天匀速生长，可供 {n1} 头牛吃 {t1} 天，或供 {n2} 头牛吃 {t2} 天。可供 {n3} 头牛吃几天？',
      '一口井里原有 {ap} 升水，泉水每分钟涌出 {v} 升。用抽水机每分钟抽 {np} 升，多少分钟能把井水抽干？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{n1}', n1).replace('{n2}', n2).replace('{n3}', n3).replace('{t1}', t1).replace('{t2}', t2).replace('{ap}', ap).replace('{np}', np).replace('{v}', v),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genSurplusPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '盈亏问题：人数 =（盈 + 亏）÷（两次每人分配之差）；两盈时用（大盈 - 小盈）÷ 差';
    const n = rnd(4, 12);
    const a = rnd(2, 5), b = a + rnd(1, 4);
    let y = rnd(1, 10), x = n * (b - a) - y;
    if (x <= 0) { x = rnd(1, 10); y = n * (b - a) - x; }
    if (y <= 0) { y = 1; x = n * (b - a) - 1; }
    const n3 = rnd(4, 12), a3 = rnd(2, 4), b3 = a3 + rnd(1, 4);
    const y2 = rnd(1, 15);
    const x3 = y2 + (b3 - a3) * n3;
    const ans = [n, n, n3];
    const tpls = [
      '把一些苹果分给小朋友，每人分 {a} 个，还多 {x} 个；如果每人分 {b} 个，就少 {y} 个。一共有多少个小朋友？',
      '老师给同学们发练习本，每人发 {a} 本，还剩 {x} 本；如果每人发 {b} 本，还差 {y} 本。班上有多少个同学？',
      '把一些糖果分给小朋友，每人分 {a3} 颗，还多 {x3} 颗；如果每人分 {b3} 颗，还多 {y2} 颗。有多少个小朋友？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{a}', a).replace('{b}', b).replace('{x}', x).replace('{y}', y).replace('{a3}', a3).replace('{b3}', b3).replace('{x3}', x3).replace('{y2}', y2),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genChasePractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '追及问题：追及时间 = 路程差 ÷ 速度差（追赶者的速度必须大于被追者）';
    const v1 = rnd(30, 50);
    const v2 = v1 + rnd(1, 5) * 10;
    const t = rnd(1, 4);
    const d = (v2 - v1) * t;
    const ans = [t, t, t];
    const tpls = [
      '小红每分钟走 {v2} 米，小明每分钟走 {v1} 米。小明在小红前面 {d} 米处同向而行，小红多少分钟能追上小明？',
      '甲车每小时行 {v1} 千米，乙车每小时行 {v2} 千米，乙车落后甲车 {d} 千米，几小时后乙车能追上甲车？',
      '甲、乙两人同向而行，甲在前每小时走 {v1} 千米，乙在后每小时走 {v2} 千米，两人相距 {d} 千米，乙几小时追上甲？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{v1}', v1).replace('{v2}', v2).replace('{d}', d).replace('{t}', t),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genIntervalPractice() {
    const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const note = '间隔问题：锯成 n 段要锯 n-1 次；上到 n 楼经过 n-1 层；敲 n 下有 n-1 个间隔';
    const n = rnd(4, 8), m = rnd(2, 5);
    const f = rnd(3, 8), s = rnd(10, 20);
    const k = rnd(4, 10), i = rnd(2, 5);
    const ans = [(n-1)*m, (f-1)*s, (k-1)*i];
    const tpls = [
      '把一根木头锯成 {n} 段，每锯一次需要 {m} 分钟，一共需要多少分钟？',
      '小明从 1 楼上到 {f} 楼，每层楼梯有 {s} 级台阶，一共要走多少级台阶？',
      '时钟每隔 {i} 秒敲一下，从第 1 下敲到第 {k} 下，一共需要多少秒？'
    ];
    return tpls.map((tpl, idx) => ({
      text: tpl.replace('{n}', n).replace('{m}', m).replace('{f}', f).replace('{s}', s).replace('{k}', k).replace('{i}', i),
      kind: idx === 0 ? '相似题' : '举一反三',
      note: note, answer: String(ans[idx])
    }));
  },

  _genWordPractice(subject, text, grade) {
    const data = subject === 'chinese' ? (typeof CHINESE_DATA !== 'undefined' ? CHINESE_DATA : null) : this.getCourseData();
    const g = Number(grade) || 1;
    const pool = [];
    ((data && data.grades) || []).forEach(c => {
      if (Number(c.grade) !== g) return;
      (c.modules || []).forEach(m => (m.units || []).forEach(u => (u.words || []).forEach(w => {
        const key = w.en || w.zi || '';
        if (!key) return;
        if (subject === 'chinese') pool.push({ key: String(key), note: (w.pinyin || '') + (w.yi ? ' ' + w.yi : '') });
        else pool.push({ key: String(key), note: w.cn || '' });
      })));
    });
    const lowerOrig = String(text || '').toLowerCase().trim();
    const usable = pool.filter(x => x.key.toLowerCase() !== lowerOrig);
    const src = usable.length ? usable.slice() : pool.slice();
    if (!src.length) {
      const t = String(text || '') || '（' + this._subjName(subject) + '练习）';
      return [{ text: t, kind: '相似题' }, { text: t, kind: '举一反三' }, { text: t, kind: '举一反三' }];
    }
    for (let i = src.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = src[i]; src[i] = src[j]; src[j] = t;
    }
    const origFirst = String(text || '').trim().charAt(0).toLowerCase();
    let similar = null;
    for (let i = 0; i < src.length; i++) {
      if (src[i].key.charAt(0).toLowerCase() === origFirst) { similar = src.splice(i, 1)[0]; break; }
    }
    if (!similar) similar = src.shift();
    const fmt = (x) => x.key + (x.note ? '（' + x.note + '）' : '');
    const out = [{ text: fmt(similar), kind: '相似题' }];
    let take = 0;
    while (out.length < 3 && take < src.length) { out.push({ text: fmt(src[take]), kind: '举一反三' }); take++; }
    while (out.length < 3) { out.push({ text: fmt(similar), kind: '举一反三' }); }
    return out;
  },

  _renderWeekWrongs() {
    const container = document.getElementById('admin-tab-content');
    const list = Storage.getWeekWrongs();
    const students = Storage.getStudents();
    let html = '<div class="admin-section">';
    html += '<button class="back-btn" onclick="App._renderAdminScan()">← 返回上一级</button>';
    html += '<h3 style="margin:10px 0">📥 本周错题</h3>';
    html += '<p style="margin:0 0 10px;font-size:12px;color:var(--text-light)">扫描时勾选的错题自动收在这里（按 学员→科目 分组）。发送到电脑后，已发送的错题自动归档进"个人错题库"并从此移除；也可勾选后发给指定学员（不删除）。</p>';
    if (list.length === 0) {
      html += '<div class="empty-state" style="padding:20px"><p>本周错题为空，去扫描勾选错题吧</p></div>';
      html += '</div>';
      container.innerHTML = html;
      return;
    }
    const byStudent = {};
    list.forEach(w => { (byStudent[w.studentId] = byStudent[w.studentId] || []).push(w); });
    const SUBJ_ORDER = { english: 1, chinese: 2, math: 3 };
Object.keys(byStudent).forEach(sid => {
      const s = students.find(x => String(x.id) === String(sid));
      const name = s ? s.name : '学员#' + sid;
      const grade = s ? Storage.getCurrentGrade(s) : '';
      if (!s || !this._gradeAllowed(grade)) return;
      const items = byStudent[sid];
      html += '<div style="border:1px solid #E0E0E0;border-radius:10px;margin-bottom:10px;overflow:hidden">';
      html += '<div style="padding:10px 12px;background:#F5F7FA;font-size:13px;font-weight:700">📁 ' + this._h(name) + (grade ? '（' + grade + '年级）' : '') + ' · ' + items.length + ' 题</div>';
      const bySubj = {};
      items.forEach(w => { (bySubj[w.subject] = bySubj[w.subject] || []).push(w); });
      Object.keys(bySubj).sort((a, b) => (SUBJ_ORDER[a] || 9) - (SUBJ_ORDER[b] || 9)).forEach(sub => {
        const sitems = bySubj[sub];
        const roots = sitems.filter(w => !w.srcId);
        const genMap = {};
        sitems.filter(w => w.srcId).forEach(w => { (genMap[w.srcId] = genMap[w.srcId] || []).push(w); });
        html += '<div style="padding:8px 12px 4px;font-size:12px;color:#8D6E63">📂 ' + this._subjName(sub) + '（' + sitems.length + ' 题）</div>';
        roots.forEach(w => {
          const gens = genMap[w.id] || [];
          html += '<div class="asc-item" style="align-items:flex-start">';
          html += '<input type="checkbox" class="week-sel" data-wid="' + w.id + '" style="margin-top:3px">';
          html += '<div style="flex:1">';
          html += '<div style="font-size:13px;white-space:pre-wrap">' + this._h(w.text) + '</div>';
          html += '<div class="asc-lbl" style="color:#8D6E63">' + new Date(w.createdAt).toLocaleString('zh-CN');
          if (w.pracGen) {
            html += ' · <span style="color:#2E7D32">✅ 已生成加练</span>';
          } else {
            html += ' · <span class="link-btn" style="color:#8E24AA;cursor:pointer;font-size:13px" data-weekgen="' + w.id + '">✨ 生成加练</span> / <span class="link-btn" style="color:#00838F;cursor:pointer;font-size:13px" data-weekai="' + w.id + '">🤖 AI 生成</span>';
          }
          html += '</div>';
          html += '</div>';
          html += '<span style="color:#C62828;font-size:14px;cursor:pointer" data-delweek="' + w.id + '">🗑</span>';
          html += '</div>';
          (gens || []).forEach(g => {
            html += '<div class="asc-item" style="align-items:flex-start;padding:6px 12px 6px 30px;background:#FAFAF7">';
            html += '<input type="checkbox" class="week-sel" data-wid="' + g.id + '" style="margin-top:3px">';
            html += '<div style="flex:1">';
            html += '<div style="font-size:12px;white-space:pre-wrap"><span style="color:#8D6E63">[' + this._h(g.kind || '加练') + ']</span> ' + this._h(g.text) + '</div>';
            html += '<div class="asc-lbl" style="color:#BCAAA4">' + new Date(g.createdAt).toLocaleString('zh-CN') + '</div>';
            html += '</div>';
            html += '<span style="color:#C62828;font-size:14px;cursor:pointer" data-delweek="' + g.id + '">🗑</span>';
            html += '</div>';
          });
        });
      });
      html += '</div>';
    });
    html += '<div style="display:flex;gap:10px;margin-top:12px">';
    html += '<button class="login-btn" id="send-week" style="flex:1">📤 发送所选到电脑</button>';
    html += '<button class="login-btn" id="send-week-stu" style="flex:1">👦 发给学员</button>';
    html += '<button class="admin-gen-btn" id="sel-week-all" style="flex:1">全选</button>';
    html += '</div>';
    html += '<div id="send-week-panel"></div>';
    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('[data-delweek]').forEach(el => {
      el.addEventListener('click', () => {
        const w = list.find(x => x.id === parseInt(el.dataset.delweek));
        if (!w) return;
        const delIds = [w.id];
        if (w.srcId) {
          Storage.clearWeekWrongPracticed(w.srcId);
        } else {
          list.filter(x => x.srcId === w.id).forEach(x => delIds.push(x.id));
        }
        Storage.removeWeekWrongs(delIds);
        this._renderWeekWrongs();
      });
    });

    container.querySelectorAll('[data-weekgen]').forEach(el => {
      el.addEventListener('click', () => {
        const w = list.find(x => x.id === parseInt(el.dataset.weekgen));
        if (!w) return;
        const s = students.find(x => String(x.id) === String(w.studentId));
        const grade = s ? Storage.getCurrentGrade(s) : '';
        const items = this._generatePracticeItems(w.subject, w.text, grade);
        if (!items || items.length === 0) { alert('未能生成加练题'); return; }
        const n = Storage.addWeekWrongsFromGen(w.id, w.studentId, w.subject, items);
        Storage.markWeekWrongPracticed(w.id);
        alert('✅ 已生成 ' + n + ' 道加练题，并归档进本周错题库');
        this._renderWeekWrongs();
      });
    });

    container.querySelectorAll('[data-weekai]').forEach(el => {
      el.addEventListener('click', () => {
        const w = list.find(x => x.id === parseInt(el.dataset.weekai));
        if (!w) return;
        const s = students.find(x => String(x.id) === String(w.studentId));
        const grade = s ? Storage.getCurrentGrade(s) : '';
        this._aiGeneratePractice(w.studentId, w.subject, grade, w.text, w.id, () => {
          Storage.markWeekWrongPracticed(w.id);
          this._renderWeekWrongs();
        });
      });
    });

    document.getElementById('sel-week-all').addEventListener('click', () => {
      const checked = container.querySelectorAll('.week-sel:checked').length;
      const all = container.querySelectorAll('.week-sel').length;
      const selectAll = checked < all;
      container.querySelectorAll('.week-sel').forEach(cb => { cb.checked = selectAll; });
    });

    document.getElementById('send-week').addEventListener('click', () => {
      const sel = [];
      container.querySelectorAll('.week-sel:checked').forEach(cb => {
        const w = list.find(x => x.id === parseInt(cb.dataset.wid));
        if (w) sel.push(w);
      });
      if (sel.length === 0) { alert('请先勾选要发送的错题'); return; }
      this._renderSendWeekPanel(sel);
    });

    document.getElementById('send-week-stu').addEventListener('click', () => {
      const sel = [];
      container.querySelectorAll('.week-sel:checked').forEach(cb => {
        const w = list.find(x => x.id === parseInt(cb.dataset.wid));
        if (w) sel.push(w);
      });
      if (sel.length === 0) { alert('请先勾选要发送的错题'); return; }
      this._renderSendWeekToStudentPanel(sel);
    });
  },

  _renderSendWeekPanel(sel) {
    this._renderSendPanel('send-week-panel', sel, () => {
      const n = Storage.archiveWeekWrongsByIds(sel.map(w => w.id));
      return '✅ 全部发送成功！' + n + ' 条已归档进"个人错题库"，已发送的错题已从本周错题移除';
    }, () => this._renderWeekWrongs());
  },

  _renderSendWeekToStudentPanel(sel) {
    const panel = document.getElementById('send-week-panel');
    if (!panel) return;
    panel.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-light)">加载学员中...</div>';
    this._fetchAllStudents().then(students => {
      this._renderSendWeekToStudentPanelBody(panel, sel, students);
    });
  },

  _renderSendWeekToStudentPanelBody(panel, sel, students) {
    const self = this;
    const selStudentIds = [];
    sel.forEach(w => { if (selStudentIds.indexOf(String(w.studentId)) === -1) selStudentIds.push(String(w.studentId)); });
    let html = '<div style="background:#E3F2FD;border:1px solid #90CAF9;border-radius:10px;padding:12px 14px;margin-top:10px">';
    html += '<div style="font-size:13px;font-weight:700;margin-bottom:8px">👦 发送所选 ' + sel.length + ' 题给学员（不删除本周错题）</div>';
    html += '<div style="display:flex;gap:8px;margin-bottom:8px">';
    html += '<button class="admin-gen-btn" data-wsmode="picker" style="flex:1;background:var(--primary);color:#fff">🎯 选择学员</button>';
    html += '<button class="admin-gen-btn" data-wsmode="self" style="flex:1">↩️ 发回原学员</button>';
    html += '</div>';
    html += '<div id="week-stu-body"></div>';
    html += '<div style="display:flex;gap:8px;margin-top:8px">';
    html += '<button class="login-btn" id="week-stu-send" style="flex:1">📤 发送</button>';
    html += '<button class="admin-gen-btn" id="week-stu-cancel" style="flex:1">取消</button>';
    html += '</div>';
    html += '<div id="week-stu-status" style="font-size:12px;color:var(--text-light);margin-top:6px;min-height:16px"></div>';
    html += '</div>';
    panel.innerHTML = html;

    let targetIds = selStudentIds.slice();
    let curMode = 'picker';
    const renderBody = (mode) => {
      const body = document.getElementById('week-stu-body');
      if (!body) return;
      if (mode === 'self') {
        const names = selStudentIds.map(sid => {
          const s = students.find(x => String(x.id) === String(sid));
          return this._h(s ? s.name : '学员#' + sid);
        });
        body.innerHTML = '<div style="font-size:12px;color:var(--text-light);margin-bottom:6px">发送给原学员：' + names.join('、') + '（' + sel.length + ' 题）</div>';
        return;
      }
let b = '<div style="font-size:12px;color:var(--text-light);margin-bottom:6px">勾选要发送的学员（含电脑端学员库跨平板学员）：</div>';
      students.forEach(s => {
        const g = s.remote ? s.grade : Storage.getCurrentGrade(s);
        if (!this._gradeAllowed(g)) return;
        const key = s.remote ? 'r' + s.name : String(s.id);
        const checked = targetIds.indexOf(key) !== -1 ? ' checked' : '';
        b += '<label style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px"><input type="checkbox" class="week-stu-cb" data-sid="' + key + '"' + checked + '> ' + this._h(s.name) + (s.remote ? ' 🌐' : '') + '（' + g + '年级）</label>';
      });
      body.innerHTML = b;
      body.querySelectorAll('.week-stu-cb').forEach(cb => {
        cb.addEventListener('change', () => {
          const sid = String(cb.dataset.sid);
          if (cb.checked) { if (targetIds.indexOf(sid) === -1) targetIds.push(sid); }
          else targetIds = targetIds.filter(x => x !== sid);
        });
      });
    };
    renderBody('picker');

    panel.querySelectorAll('[data-wsmode]').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('[data-wsmode]').forEach(x => { x.style.background = '#fff'; x.style.color = 'var(--text)'; });
        btn.style.background = 'var(--primary)';
        btn.style.color = '#fff';
        curMode = btn.dataset.wsmode;
        if (curMode === 'self') targetIds = selStudentIds.slice();
        renderBody(curMode);
      });
    });

    document.getElementById('week-stu-cancel').addEventListener('click', () => { panel.innerHTML = ''; });
    document.getElementById('week-stu-send').addEventListener('click', () => {
      if (targetIds.length === 0) { document.getElementById('week-stu-status').textContent = '请先选择要发送的学员'; return; }
      const status = document.getElementById('week-stu-status');
      status.textContent = '正在发送...';
      const names = targetIds.map(key => {
        const s = students.find(x => (x.remote ? 'r' + x.name === key : String(x.id) === key));
        return s ? s.name : '学员#' + key;
      });
      const tasks = targetIds.map(key => {
        const s = students.find(x => (x.remote ? 'r' + x.name === key : String(x.id) === key));
const toId = s && !s.remote ? parseInt(s.id) : null;
        const msg3 = { toId: toId, toName: s ? s.name : '', items: sel.map(w => ({ subject: w.subject, text: w.text, note: '', answer: '' })), from: '本周错题', sentAt: new Date().toISOString() };
        try { this._lanTaskPush(msg3); } catch (e) {}
        return fetch(Storage.getTaskTopic(), { method: 'PUT', body: JSON.stringify(msg3) }).then(r => r.ok);
      });
      Promise.all(tasks).then(results => {
        const okN = results.filter(Boolean).length;
        status.textContent = okN === targetIds.length ? '✅ 已发送 ' + sel.length + ' 题给 ' + names.join('、') + '，学员平板"📥 老师练习"可收到' : '❌ 部分发送失败（' + okN + '/' + targetIds.length + '），请检查网络后重试';
        if (okN === targetIds.length) setTimeout(() => { panel.innerHTML = ''; }, 3500);
      }).catch(e => {
        status.textContent = '❌ 发送失败：' + self._h(String(e.message || e));
      });
    });
  },

  _renderSendPracticePanel(sel) {
    this._renderWrongArchive();
  },

  _renderSendPanel(panelId, sel, successTextFn, afterFn) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const students = Storage.getStudents();
    const groups = {};
    sel.forEach(w => { (groups[w.studentId] = groups[w.studentId] || []).push(w); });
    const sids = Object.keys(groups);
    const savedHost = this._getSavedHost();
    const mode = Storage.getTransportMode();
    let html = '<div style="background:#E3F2FD;border:1px solid #90CAF9;border-radius:10px;padding:12px 14px;margin-top:10px">';
    html += '<div style="font-size:13px;font-weight:700;margin-bottom:8px">📤 发送到老师电脑 · ' + sel.length + ' 题（' + sids.length + ' 位学员，按学员年级自动分类）</div>';
    html += '<div style="display:flex;gap:8px;margin-bottom:8px">';
    html += '<button class="admin-gen-btn" data-tmode="lan" style="flex:1;background:' + (mode === 'lan' ? 'var(--primary);color:#fff' : '#fff') + '">🏠 同一网络</button>';
    html += '<button class="admin-gen-btn" data-tmode="cloud" style="flex:1;background:' + (mode === 'cloud' ? 'var(--primary);color:#fff' : '#fff') + '">☁️ 跨网络</button>';
    html += '</div>';
    html += '<div id="send-lan-block"' + (mode === 'cloud' ? ' style="display:none"' : '') + '>';
    html += '<input type="text" class="login-input" id="send-host" placeholder="电脑 IP，如 192.168.1.100" value="' + this._h(savedHost) + '" style="margin-bottom:6px" autocomplete="off">';
    html += '<div style="font-size:11px;color:var(--text-light);margin-bottom:6px">电脑需先启动"错题接收器"，且与平板在同一 WiFi</div>';
    html += '</div>';
    html += '<div id="send-cloud-block"' + (mode === 'lan' ? ' style="display:none"' : '') + '>';
    html += '<div style="font-size:11px;color:var(--text-light);margin-bottom:6px">平板可联网即可，电脑自动云端接收（云端保留约 1 天）</div>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px">';
    html += '<button class="login-btn" id="send-do" style="flex:1">📤 发送</button>';
    html += '<button class="admin-gen-btn" id="send-cancel" style="flex:1">取消</button>';
    html += '</div>';
    html += '<div id="send-status" style="font-size:12px;color:var(--text-light);margin-top:6px;min-height:16px"></div>';
    html += '</div>';
    panel.innerHTML = html;
    this._bindHostInput('send-host');

    panel.querySelectorAll('[data-tmode]').forEach(btn => {
      btn.addEventListener('click', () => {
        Storage.setTransportMode(btn.dataset.tmode);
        this._renderSendPanel(panelId, sel, successTextFn, afterFn);
      });
    });

    document.getElementById('send-cancel').addEventListener('click', () => { panel.innerHTML = ''; });

    document.getElementById('send-do').addEventListener('click', () => {
      const isCloud = Storage.getTransportMode() === 'cloud';
      const status = document.getElementById('send-status');
      let host = '';
      if (!isCloud) {
        host = this._cleanHost(document.getElementById('send-host').value);
        if (!host) { status.textContent = '请填写电脑 IP'; return; }
        this._saveHost(host);
      }
      const sendOne = (sid) => {
        const s = students.find(x => String(x.id) === String(sid));
        const name = s ? s.name : '学员#' + sid;
        const grade = s ? Storage.getCurrentGrade(s) : '';
        const items = groups[sid].map(w => ({ subject: w.subject, text: w.text, createdAt: w.createdAt }));
        if (isCloud) return this._cloudSend(name, items, grade);
        return this._lanPost('http://' + host + ':8899/upload', JSON.stringify({ student: name, grade: grade, items: items, sentAt: new Date().toISOString() })).then(r => r.ok);
      };
      status.textContent = '正在发送...';
      sids.reduce((p, sid, idx) => {
        return p.then(() => {
          const s = students.find(x => String(x.id) === String(sid));
          status.textContent = '正在发送 ' + (idx + 1) + '/' + sids.length + '：' + (s ? s.name : sid) + '（' + groups[sid].length + ' 题）';
          return sendOne(sid).then(ok => { if (!ok) throw new Error('发送失败'); });
        });
      }, Promise.resolve()).then(() => {
        status.textContent = successTextFn ? successTextFn() : '✅ 全部发送成功！';
        if (afterFn) setTimeout(afterFn, 3000);
      }).catch(e => {
        status.textContent = '❌ 发送失败：' + (e.message || e) + '（未归档，可重试）';
      });
    });
  },

  _renderWrongArchive() {
    const container = document.getElementById('admin-tab-content');
    const students = Storage.getStudents();
    let html = '<div class="admin-section">';
    html += '<button class="back-btn" onclick="App._renderAdminScan()">← 返回上一级</button>';
    html += '<h3 style="margin:10px 0">📂 个人错题库（年级 / 学员 / 科目）</h3>';
    html += '<p style="margin:0 0 10px;font-size:12px;color:var(--text-light)">拍照/扫描导入归档的错题存放在这里（按 年级 → 学员 → 科目）。勾选错题后可发送给指定学员。</p>';
    html += '<div style="border:1px solid #C8E6C9;background:#E8F5E9;border-radius:10px;padding:10px 12px;margin-bottom:12px">';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="admin-gen-btn" id="arch-sel-all" style="flex:1;min-width:90px">☑ 全选</button>';
    html += '<button class="admin-gen-btn" id="arch-sel-clear" style="flex:1;min-width:90px">清空选择</button>';
    html += '<button class="login-btn" id="arch-send-sel" style="flex:2;min-width:140px">📤 发送所选到学员或电脑文件夹</button>';
    html += '</div>';
    html += '<div style="font-size:11px;color:var(--text-muted);margin-top:4px">发送后学员平板在"📊 学习统计 → 📥 老师练习"即可收到</div>';
    html += '<div id="pub-send-target-panel"></div>';
    html += '</div>';
    const grades = {};
    students.forEach(s => {
      const g = Storage.getCurrentGrade(s);
      if (!this._gradeAllowed(g)) return;
      const wrongs = Storage.getWrongQuestions(s.id);
      (grades[g] = grades[g] || []).push({ s: s, wrongs: wrongs });
    });
    const gradeKeys = Object.keys(grades).sort((a, b) => a - b);
    if (gradeKeys.length === 0) {
      html += '<div class="empty-state" style="padding:20px"><p>还没有学员，去"学员汇总"添加学员后，本周错题发送到电脑后会自动归档进来</p></div>';
      html += '</div>';
      container.innerHTML = html;
      return;
    }
    const SUBJ_ORDER = { english: 1, chinese: 2, math: 3 };
    const SUBJS = ['english', 'chinese', 'math'];
    gradeKeys.forEach(g => {
      const gTotal = grades[g].reduce((n, x) => n + x.wrongs.length, 0);
      html += '<details style="margin-bottom:8px"' + (gradeKeys.length === 1 ? ' open' : '') + '>';
      html += '<summary style="padding:10px 12px;background:#F5F7FA;border:1px solid #E0E0E0;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer">📁 ' + g + '年级（' + gTotal + ' 题）</summary>';
      html += '<div style="padding:6px 0 8px 14px">';
      grades[g].forEach(x => {
        const wrongs = x.wrongs;
        html += '<details style="margin-top:6px">';
        html += '<summary style="padding:8px 10px;background:#FFFDE7;border:1px solid #FFF176;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">📁 ' + this._h(x.s.name) + '（' + wrongs.length + ' 题）</summary>';
        html += '<div style="padding:4px 0 6px 14px">';
        const bySubj = {};
        wrongs.forEach(w => { (bySubj[w.subject] = bySubj[w.subject] || []).push(w); });
        SUBJS.forEach(sub => {
          const sitems = bySubj[sub] || [];
          html += '<details style="margin-top:6px">';
          html += '<summary style="padding:6px 10px;background:#F1F8E9;border:1px solid #C5E1A5;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">📂 ' + this._subjName(sub) + (sitems.length ? '（' + sitems.length + ' 题）' : '（空）') + '</summary>';
          html += '<div style="padding:4px 0 6px 14px">';
          if (sitems.length === 0) {
            html += '<div style="padding:6px 0;font-size:12px;color:#9E9E9E">暂无错题</div>';
          }
          sitems.forEach(w => {
            html += '<input type="checkbox" class="arch-sel" data-awid="' + w.id + '" data-agrade="' + g + '" data-asubj="' + sub + '" data-atext="' + encodeURIComponent(w.text || '') + '" style="margin-top:4px">';
            html += '<div class="asc-item" style="align-items:flex-start;padding:4px 0">';
            html += '<div style="flex:1">';
            html += '<div style="font-size:13px;white-space:pre-wrap">' + this._h(w.text) + '</div>';
            html += '<div class="asc-lbl" style="color:#8D6E63">' + new Date(w.createdAt).toLocaleString('zh-CN') + '</div>';
            html += '</div>';
            html += '<span style="color:#C62828;font-size:14px;cursor:pointer" data-delarch="' + x.s.id + '" data-wid="' + w.id + '">🗑</span>';
            html += '</div>';
          });
          html += '</div></details>';
        });
        html += '</div></details>';
      });
      html += '</div></details>';
    });
    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('[data-delarch]').forEach(el => {
      el.addEventListener('click', () => {
        const sid = parseInt(el.dataset.delarch);
        const wid = parseInt(el.dataset.wid);
        Storage.saveWrongQuestions(sid, Storage.getWrongQuestions(sid).filter(w => w.id !== wid));
        this._renderWrongArchive();
      });
    });

    const allBtn = document.getElementById('arch-sel-all');
    if (allBtn) allBtn.addEventListener('click', () => {
      this._pubSel = this._pubSel || {};
      container.querySelectorAll('.arch-sel').forEach(el => {
        el.checked = true;
        let txt = '';
        try { txt = decodeURIComponent(el.dataset.atext); } catch (e) { txt = el.dataset.atext; }
        this._pubSel[el.dataset.awid] = { subject: el.dataset.asubj, text: txt, grade: el.dataset.agrade };
      });
      const sb = document.getElementById('arch-send-sel');
      if (sb) sb.textContent = '📤 发送所选（' + Object.keys(this._pubSel).length + ' 题）到学员或电脑';
    });
    const clearBtn = document.getElementById('arch-sel-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      container.querySelectorAll('.arch-sel').forEach(el => { el.checked = false; });
      this._pubSel = {};
      const sb = document.getElementById('arch-send-sel');
      if (sb) sb.textContent = '📤 发送所选到学员或电脑文件夹';
    });
    container.querySelectorAll('.arch-sel').forEach(el => {
      el.addEventListener('change', () => {
        this._pubSel = this._pubSel || {};
        const wid = el.dataset.awid;
        if (el.checked) {
          let txt = '';
          try { txt = decodeURIComponent(el.dataset.atext); } catch (e) { txt = el.dataset.atext; }
          this._pubSel[wid] = { subject: el.dataset.asubj, text: txt, grade: el.dataset.agrade };
        } else {
          delete this._pubSel[wid];
        }
        const sb = document.getElementById('arch-send-sel');
        if (sb) sb.textContent = '📤 发送所选' + (Object.keys(this._pubSel).length ? '（' + Object.keys(this._pubSel).length + ' 题）' : '') + '到学员或电脑';
      });
    });
    const sendSel = document.getElementById('arch-send-sel');
    if (sendSel) sendSel.addEventListener('click', () => {
      this._pubSel = this._pubSel || {};
      const sel = Object.keys(this._pubSel).map(k => this._pubSel[k]);
      if (!sel.length) { alert('请先勾选要发送的错题'); return; }
      this._pubSendSource = 'archive';
      this._renderPubSendTargetPanel();
    });
  },

  _aiFallback(sid, subj, grade, text, msg, srcId, onDone) {
    let n = 0;
    try {
      const items = this._generatePracticeItems(subj, text, grade);
      if (srcId) {
        n = Storage.addWeekWrongsFromGen(srcId, sid, subj, items.map(i => ({ text: i.text, kind: i.kind, note: i.note || '', answer: i.answer || '', source: text })));
        if (n) Storage.markWeekWrongPracticed(srcId);
      }
    } catch (e) {}
    alert((msg ? msg + '，' : '🤖 AI 出题失败，') + (n ? '已用本地模板生成 ' + n + ' 道并归档进本周错题库' : '未生成题目'));
    if (onDone) onDone(); else this._renderWrongArchive();
  },

  _aiGeneratePractice(sid, subj, grade, text, srcId, onDone) {
    const host = this._getSavedHost();
    if (!host) {
      this._aiFallback(sid, subj, grade, text, '未填写电脑 IP，无法连接 AI 出题服务', srcId, onDone);
      return;
    }
    const base = 'http://' + host + ':8899';
    const taskId = 'ai' + Date.now() + Math.random().toString(36).slice(2, 8);
    fetch(base + '/ai-gen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: subj, text: text, grade: grade, taskId: taskId }),
      cache: 'no-store'
    })
    .then(r => r.json())
    .then(v => {
      if (!v.ok) {
        if (v.err === 'no_key') throw new Error('no_key');
        throw new Error(v.err || 'ai_err');
      }
      setTimeout(() => { try { this._aiPoll(base, taskId, sid, subj, grade, text, 0, srcId, onDone); } catch (e) {} }, 1200);
    })
    .catch(e => {
      if (e && e.message === 'no_key') {
        this._aiFallback(sid, subj, grade, text, '电脑端未配置 AI Key（工具\\ai-key.txt）', srcId, onDone);
      } else {
        this._aiFallback(sid, subj, grade, text, 'AI 出题服务连接失败', srcId, onDone);
      }
    });
  },

  _aiPoll(base, taskId, sid, subj, grade, text, attempt, srcId, onDone) {
    fetch(base + '/ai-gen?taskId=' + taskId, { cache: 'no-store' })
    .then(r => r.json())
    .then(v => {
      if (v.ok && v.items && v.items.length) {
        const items = v.items.map((it, idx) => ({
          text: it.text,
          kind: idx === 0 ? '相似题' : '举一反三',
          note: it.note || '',
          answer: it.answer || '',
          source: text
        }));
        const n = Storage.addWeekWrongsFromGen(srcId, sid, subj, items);
        if (n) Storage.markWeekWrongPracticed(srcId);
        alert('🤖 AI 已生成 ' + n + ' 道加练题（1 相似 + 2 举一反三），已归档进本周错题库');
        if (onDone) onDone(); else this._renderWrongArchive();
      } else if (v.pending && attempt < 25) {
        setTimeout(() => { try { this._aiPoll(base, taskId, sid, subj, grade, text, attempt + 1, srcId, onDone); } catch (e) {} }, 1500);
      } else {
        this._aiFallback(sid, subj, grade, text, 'AI 出题超时', srcId, onDone);
      }
    })
    .catch(() => { this._aiFallback(sid, subj, grade, text, 'AI 出题服务连接失败', srcId, onDone); });
  },

  _renderPublicWrongBank() {
    const container = document.getElementById('admin-tab-content');
    const self = this;
    const SUBJ_ORDER = { english: 1, chinese: 2, math: 3 };
    const SUBJS = ['english', 'chinese', 'math'];
    const list = Storage.getPublicWrongs();

    let html = '<div class="admin-section">';
    html += '<button class="back-btn" onclick="App._renderAdminScan()">← 返回上一级</button>';
    html += '<h3 style="margin:10px 0">🌐 公共错题库</h3>';
    html += '<p style="margin:0 0 10px;font-size:12px;color:var(--text-light)">从电脑/平板接收的错题和手动批量导入的错题，按 年级 → 科目 存放在这里，可供全机构共用。</p>';

    html += '<div style="border:1px solid #BBDEFB;background:#E3F2FD;border-radius:10px;padding:12px 14px;margin-bottom:12px">';
    html += '<div style="font-size:13px;font-weight:700;margin-bottom:8px">📥 手动批量导入</div>';
    html += '<div style="display:flex;gap:8px;margin-bottom:8px">';
    html += '<select class="login-input" id="pub-import-grade" style="appearance:auto;-webkit-appearance:auto">';
    for (let g = 1; g <= 6; g++) {
      html += '<option value="' + g + '"' + (g === this._pubDefaultGrade() ? ' selected' : '') + '>' + g + '年级</option>';
    }
    html += '</select>';
    html += '<select class="login-input" id="pub-import-subj" style="appearance:auto;-webkit-appearance:auto">';
    html += '<option value="english">英语</option><option value="chinese">语文</option><option value="math">数学</option>';
    html += '</select>';
    html += '</div>';
    html += '<textarea class="login-input" id="pub-import-text" rows="5" placeholder="每行一道题，可整段粘贴批量导入&#10;例如：&#10;apple 苹果&#10;teacher 老师" style="width:100%;box-sizing:border-box;margin-bottom:8px"></textarea>';
    html += '<button class="login-btn" id="pub-import-do" style="width:100%">➕ 导入到公共错题库（所选年级/科目）</button>';
    html += '<div id="pub-import-status" style="font-size:12px;color:var(--text-light);margin-top:6px;min-height:16px"></div>';
    html += '</div>';

    html += '<div style="border:1px solid #C8E6C9;background:#E8F5E9;border-radius:10px;padding:12px 14px;margin-bottom:12px">';
    html += '<div style="font-size:13px;font-weight:700;margin-bottom:8px">📥 从电脑 / 平板接收错题</div>';
    html += '<div style="display:flex;gap:8px">';
    html += '<button class="login-btn" id="pub-recv-cloud" style="flex:1">☁️ 云端接收</button>';
    html += '<button class="admin-gen-btn" id="pub-recv-lan" style="flex:1">🏠 局域网接收</button>';
    html += '</div>';
    html += '<div style="font-size:11px;color:var(--text-light);margin-top:6px">云端：接收所有平板发送到云端的错题（按学员年级归档）；局域网：输入电脑 IP 后批量接收电脑上的错题（需先启动电脑端"错题接收器"）。</div>';
    html += '<input type="text" class="login-input" id="pub-recv-host" placeholder="电脑 IP，如 192.168.1.100（局域网接收时填写）" value="' + this._h(this._getSavedHost()) + '" style="margin-top:8px;display:none" autocomplete="off">';
html += '<div id="pub-recv-status" style="font-size:12px;color:var(--text-light);margin-top:6px;min-height:16px"></div>';
    html += '</div>';

    html += '<div style="border:1px solid #E0E0E0;border-radius:10px;padding:12px 14px">';
    html += '<div style="font-size:13px;font-weight:700;margin-bottom:8px">📂 公共错题库内容（' + list.length + ' 题）</div>';
    html += '<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">';
    html += '<button class="admin-gen-btn" id="pub-sel-all" style="flex:1;min-width:100px">☑ 全选</button>';
    html += '<button class="admin-gen-btn" id="pub-sel-clear" style="flex:1;min-width:100px">清空选择</button>';
    const selCount = this._objVals(this._pubSel || {}).length;
    html += '<button class="login-btn" id="pub-send-sel" style="flex:2;min-width:140px">📤 发送所选' + (selCount ? '（' + selCount + ' 题）' : '') + '</button>';
    html += '</div>';
    html += '<div id="pub-send-target-panel"></div>';
    const byGrade = {};
    list.forEach(w => { (byGrade[w.grade] = byGrade[w.grade] || []).push(w); });
    let anyGrade = false;
    for (let g = 1; g <= 6; g++) {
      const items = byGrade[g] || [];
      if (items.length) anyGrade = true;
    }
    if (list.length === 0) {
      html += '<div class="empty-state" style="padding:14px"><p>公共错题库为空，请用上方"批量导入"或"接收错题"添加</p></div>';
    } else {
      for (let g = 1; g <= 6; g++) {
        const items = byGrade[g] || [];
        html += '<details style="margin-bottom:8px"' + (g === this._pubDefaultGrade() ? ' open' : '') + '>';
        html += '<summary style="padding:10px 12px;background:#F5F7FA;border:1px solid #E0E0E0;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer">📁 ' + g + '年级' + (items.length ? '（' + items.length + ' 题）' : '（空）') + '</summary>';
        html += '<div style="padding:6px 0 8px 14px">';
        SUBJS.forEach(sub => {
          const sitems = items.filter(w => w.subject === sub);
          html += '<details style="margin-top:6px">';
          html += '<summary style="padding:6px 10px;background:#F1F8E9;border:1px solid #C5E1A5;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">📂 ' + this._subjName(sub) + (sitems.length ? '（' + sitems.length + ' 题）' : '（空）') + '</summary>';
          html += '<div style="padding:4px 0 6px 14px">';
          if (sitems.length === 0) {
            html += '<div style="padding:6px 0;font-size:12px;color:#9E9E9E">暂无题目</div>';
          }
          sitems.forEach(w => {
            html += '<div class="asc-item" style="align-items:flex-start;padding:4px 0">';
            html += '<input type="checkbox" class="pub-sel" data-id="' + w.id + '"' + (this._pubSel && this._pubSel[w.id] ? ' checked' : '') + ' style="margin-top:3px">';
            html += '<div style="flex:1;margin-left:6px">';
            html += '<div style="font-size:13px;white-space:pre-wrap">' + this._h(w.text) + '</div>';
            html += '<div class="asc-lbl" style="color:#8D6E63">' + (w.source ? this._h(w.source) + ' · ' : '') + new Date(w.createdAt).toLocaleString('zh-CN') + '</div>';
            html += '</div>';
            html += '<span style="color:#C62828;font-size:14px;cursor:pointer" data-delpub="' + w.id + '">🗑</span>';
            html += '</div>';
          });
          html += '</div></details>';
        });
        html += '</div></details>';
      }
    }
    html += '</div>';
    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('[data-delpub]').forEach(el => {
      el.addEventListener('click', () => {
        const wid = parseInt(el.dataset.delpub);
        if (this._pubSel) delete this._pubSel[wid];
        Storage.savePublicWrongs(Storage.getPublicWrongs().filter(w => w.id !== wid));
        this._renderPublicWrongBank();
      });
    });

    this._pubSel = this._pubSel || {};
    container.querySelectorAll('.pub-sel').forEach(cb => {
      cb.addEventListener('change', () => {
        const wid = parseInt(cb.dataset.id);
        const w = Storage.getPublicWrongs().find(x => x.id === wid);
        if (cb.checked && w) this._pubSel[wid] = w;
        else delete this._pubSel[wid];
        const btn = document.getElementById('pub-send-sel');
        if (btn) btn.textContent = '📤 发送所选（' + this._objVals(this._pubSel).length + ' 题）';
      });
    });

    const selAllBtn = document.getElementById('pub-sel-all');
    if (selAllBtn) selAllBtn.addEventListener('click', () => {
      Storage.getPublicWrongs().forEach(w => { this._pubSel[w.id] = w; });
      this._renderPublicWrongBank();
    });
    const selClearBtn = document.getElementById('pub-sel-clear');
    if (selClearBtn) selClearBtn.addEventListener('click', () => {
      this._pubSel = {};
      this._renderPublicWrongBank();
    });
    const sendSelBtn = document.getElementById('pub-send-sel');
    if (sendSelBtn) sendSelBtn.addEventListener('click', () => this._renderPubSendTargetPanel());
    this._bindHostInput('pub-recv-host');
    if (list.length === 0) {
      this._autoRestorePublicWrongs().then(n => {
        if (n > 0) this._renderPublicWrongBank();
      });
    }

    const importDo = document.getElementById('pub-import-do');
    if (importDo) importDo.addEventListener('click', () => {
      const grade = parseInt(document.getElementById('pub-import-grade').value) || 1;
      const subject = document.getElementById('pub-import-subj').value;
      const raw = document.getElementById('pub-import-text').value;
      const status = document.getElementById('pub-import-status');
      const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
      if (lines.length === 0) { status.innerHTML = '<span style="color:#C62828">请输入题目内容</span>'; return; }
      const cur = Storage.getPublicWrongs();
      const seen = {};
      cur.forEach(w => { seen[w.grade + '|' + w.subject + '|' + w.text] = true; });
      let added = 0;
      lines.forEach((line, idx) => {
        const key = grade + '|' + subject + '|' + line;
        if (seen[key]) return;
        seen[key] = true;
        cur.push({ id: Date.now() + idx, grade: grade, subject: subject, text: line, source: '手动导入', createdAt: new Date().toISOString() });
        added++;
      });
      Storage.savePublicWrongs(cur);
      status.innerHTML = '<span style="color:#2E7D32">✅ 已导入 ' + added + ' 题（' + grade + '年级 · ' + this._subjName(subject) + '）' + (lines.length - added ? '，重复 ' + (lines.length - added) + ' 题已跳过' : '') + '</span>';
      document.getElementById('pub-import-text').value = '';
      this._renderPublicWrongBank();
    });

    const recvCloud = document.getElementById('pub-recv-cloud');
    if (recvCloud) recvCloud.addEventListener('click', () => {
      const status = document.getElementById('pub-recv-status');
      status.innerHTML = '<span style="color:#1565C0">正在连接云端接收...</span>';
      this._cloudPull().then(groups => {
        const students = Storage.getStudents();
        const items = [];
        Object.keys(groups).forEach(name => {
          const s = students.find(x => x.name === name);
          const grade = s ? Storage.getCurrentGrade(s) : '';
          groups[name].forEach(it => {
            const g2 = it.grade || grade;
            if (!this._gradeAllowed(g2)) return;
            items.push({ grade: g2, subject: it.subject || 'english', text: String(it.text || '').trim(), createdAt: it.createdAt });
          });
        });
        if (items.length === 0) { status.innerHTML = '<span style="color:#8D6E63">ℹ️ 云端暂无错题（或均已接收/非本机负责年级）</span>'; return; }
        const n = this._pubMerge(items);
        status.innerHTML = '<span style="color:#2E7D32">✅ 云端接收完成：新增 ' + n + ' 题（' + items.length + ' 题中重复已跳过）</span>';
        this._renderPublicWrongBank();
      }).catch(e => {
        status.innerHTML = '<span style="color:#C62828">❌ 云端连接失败：' + this._h(e.message || e) + '</span>';
      });
    });

    const recvLan = document.getElementById('pub-recv-lan');
    if (recvLan) recvLan.addEventListener('click', () => {
      const hostInput = document.getElementById('pub-recv-host');
      hostInput.style.display = hostInput.style.display === 'none' ? 'block' : 'none';
      const status = document.getElementById('pub-recv-status');
      if (hostInput.style.display !== 'none') { status.innerHTML = '<span style="color:#8D6E63">请填写电脑 IP 后再次点击"🏠 局域网接收"</span>'; return; }
      const host = hostInput.value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (!host) { status.innerHTML = '<span style="color:#C62828">请填写电脑 IP</span>'; return; }
      this._saveHost(host);
      status.innerHTML = '<span style="color:#1565C0">正在连接电脑接收...</span>';
      const students = Storage.getStudents().filter(s => this._gradeAllowed(Storage.getCurrentGrade(s)));
      const seq = [this._lanGet('http://' + host + ':8899/pull?student=' + encodeURIComponent('公共错题库')).then(res => {
        if (!res.ok) return [];
        let items = [];
        try { const j = JSON.parse(res.body || '{}'); items = j.items || []; } catch (e) {}
        return items.map(it => ({ grade: it.grade || 1, subject: it.subject || 'english', text: String(it.text || '').trim(), createdAt: it.createdAt }));
      }).catch(() => [])];
      seq.push.apply(seq, students.map(s => {
        const grade = Storage.getCurrentGrade(s);
        return this._lanGet('http://' + host + ':8899/pull?student=' + encodeURIComponent(s.name)).then(res => {
          if (!res.ok) return [];
          let items = [];
          try { const j = JSON.parse(res.body || '{}'); items = j.items || []; } catch (e) {}
          return items.map(it => ({ grade: it.grade || grade, subject: it.subject || 'english', text: String(it.text || '').trim(), createdAt: it.createdAt }));
        }).catch(() => []);
      }));
      Promise.all(seq).then(results => {
        const items = [].concat.apply([], results).filter(it => it.text);
        if (items.length === 0) { status.innerHTML = '<span style="color:#8D6E63">ℹ️ 电脑上没有该学员的错题（或连接失败，请确认电脑已启动接收器）</span>'; return; }
        const n = this._pubMerge(items);
        status.innerHTML = '<span style="color:#2E7D32">✅ 局域网接收完成：新增 ' + n + ' 题</span>';
        this._renderPublicWrongBank();
      });
});
  },

  // 保险机制：公共错题库为空且局域网可达时，自动从电脑"公共错题库"拉取合并恢复
  // （防止平板本地存储被清后公共错题库一直空置；仅合并去重建，不清不覆盖，2 分钟节流）
  _autoRestorePublicWrongs() {
    if (this._pubAutoDoing) return this._pubAutoDoing;
    try {
      if (Storage.getPublicWrongs().length > 0) return Promise.resolve(0);
      const host = this._getSavedHost();
      if (!host) return Promise.resolve(0);
      let last = 0;
      try { last = parseInt(localStorage.getItem('pjyx_pub_restore_at') || '0', 10) || 0; } catch (e) {}
      if (Date.now() - last < 120000) return Promise.resolve(0);
      try { localStorage.setItem('pjyx_pub_restore_at', String(Date.now())); } catch (e) {}
      let url;
      try { url = 'http://' + host + ':8899/pull?student=' + encodeURIComponent('公共错题库'); } catch (e) { return Promise.resolve(0); }
      const p = this._lanGet(url).then(res => {
        if (!res.ok) return 0;
        let items = [];
        try { items = (JSON.parse(res.body || '{}').items || []); } catch (e) {}
        const mapped = (items || []).map(it => ({
          grade: it.grade || 1,
          subject: it.subject || 'english',
          text: String(it.text || '').trim(),
          createdAt: it.createdAt
        })).filter(it => it.text);
        if (!mapped.length) return 0;
        return this._pubMerge(mapped);
      }).catch(() => 0).then(n => { this._pubAutoDoing = null; return n; });
      this._pubAutoDoing = p;
      return p;
    } catch (e) { return Promise.resolve(0); }
  },

  _pubDefaultGrade() {
    const grades = Storage.getAdminGrades();
    return grades.length ? parseInt(grades[0]) || 1 : 1;
  },

  _pubMerge(items) {
    const cur = Storage.getPublicWrongs();
    const seen = {};
    cur.forEach(w => { seen[w.grade + '|' + w.subject + '|' + w.text] = true; });
    let added = 0;
    items.forEach((it, idx) => {
      const text = String(it.text || '').trim();
      if (!text) return;
      const key = (it.grade || 1) + '|' + (it.subject || 'english') + '|' + text;
      if (seen[key]) return;
      seen[key] = true;
      cur.push({ id: Date.now() + idx, grade: it.grade || 1, subject: it.subject || 'english', text: text, source: '接收', createdAt: it.createdAt || new Date().toISOString() });
      added++;
    });
    Storage.savePublicWrongs(cur);
    return added;
  },

  _pubExportText() {
    const list = Storage.getPublicWrongs();
    if (list.length === 0) return '';
    const SUBJ_ORDER = { english: 1, chinese: 2, math: 3 };
    const byGrade = {};
    list.forEach(w => { (byGrade[w.grade] = byGrade[w.grade] || []).push(w); });
    let out = '公共错题库导出（共 ' + list.length + ' 题）\n';
    out += '导出时间：' + new Date().toLocaleString('zh-CN') + '\n' + '='.repeat(40) + '\n';
    Object.keys(byGrade).sort((a, b) => a - b).forEach(g => {
      out += '\n【' + g + '年级】\n';
      const bySubj = {};
      byGrade[g].forEach(w => { (bySubj[w.subject] = bySubj[w.subject] || []).push(w); });
      Object.keys(bySubj).sort((a, b) => (SUBJ_ORDER[a] || 9) - (SUBJ_ORDER[b] || 9)).forEach(sub => {
        out += '  [' + this._subjName(sub) + ']\n';
        bySubj[sub].forEach(w => { out += '    ' + w.text + '\n'; });
      });
    });
    return out;
  },

  _pubFallbackCopy(text, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (done) done();
    } catch (e) {
      alert('复制失败，请使用"导出文本文件"');
    }
  },

  _renderPubSendPanel() {
    const panel = document.getElementById('pub-send-panel');
    if (!panel) return;
    const self = this;
    const list = Storage.getPublicWrongs();
    if (list.length === 0) { alert('公共错题库为空'); return; }
    const savedHost = this._getSavedHost();
    const mode = Storage.getTransportMode();
    let html = '<div style="background:#E3F2FD;border:1px solid #90CAF9;border-radius:10px;padding:12px 14px;margin-top:10px">';
    html += '<div style="font-size:13px;font-weight:700;margin-bottom:8px">📤 发送公共错题库到电脑（' + list.length + ' 题，按年级分组存入电脑"公共错题库"文件夹）</div>';
    html += '<div style="display:flex;gap:8px;margin-bottom:8px">';
    html += '<button class="admin-gen-btn" data-pmode="lan" style="flex:1;background:' + (mode === 'lan' ? 'var(--primary);color:#fff' : '#fff') + '">🏠 同一网络</button>';
    html += '<button class="admin-gen-btn" data-pmode="cloud" style="flex:1;background:' + (mode === 'cloud' ? 'var(--primary);color:#fff' : '#fff') + '">☁️ 跨网络</button>';
    html += '</div>';
    html += '<div id="pub-send-lan-block"' + (mode === 'cloud' ? ' style="display:none"' : '') + '>';
    html += '<input type="text" class="login-input" id="pub-send-host" placeholder="电脑 IP，如 192.168.1.100" value="' + this._h(savedHost) + '" style="margin-bottom:6px" autocomplete="off">';
    html += '<div style="font-size:11px;color:var(--text-light);margin-bottom:6px">电脑需先启动"错题接收器"，且与平板在同一 WiFi</div>';
    html += '</div>';
    html += '<div id="pub-send-cloud-block"' + (mode === 'lan' ? ' style="display:none"' : '') + '>';
    html += '<div style="font-size:11px;color:var(--text-light);margin-bottom:6px">平板可联网即可，电脑自动云端接收（云端保留约 1 天）</div>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px">';
    html += '<button class="login-btn" id="pub-send-do" style="flex:1">📤 发送</button>';
    html += '<button class="admin-gen-btn" id="pub-send-cancel" style="flex:1">取消</button>';
    html += '</div>';
    html += '<div id="pub-send-status" style="font-size:12px;color:var(--text-light);margin-top:6px;min-height:16px"></div>';
    html += '</div>';
    panel.innerHTML = html;
    this._bindHostInput('pub-send-host');

    panel.querySelectorAll('[data-pmode]').forEach(btn => {
      btn.addEventListener('click', () => {
        Storage.setTransportMode(btn.dataset.pmode);
        this._renderPubSendPanel();
      });
    });

    document.getElementById('pub-send-cancel').addEventListener('click', () => { panel.innerHTML = ''; });

    document.getElementById('pub-send-do').addEventListener('click', () => {
      const isCloud = Storage.getTransportMode() === 'cloud';
      const status = document.getElementById('pub-send-status');
      if (!isCloud) {
        const host = document.getElementById('pub-send-host').value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
        if (!host) { status.textContent = '请填写电脑 IP'; return; }
        this._saveHost(host);
      }
      const byGrade = {};
      list.forEach(w => { (byGrade[w.grade] = byGrade[w.grade] || []).push(w); });
      const grades = Object.keys(byGrade).sort((a, b) => a - b);
      status.textContent = '正在发送...';
      const sendOne = (grade) => {
        const items = byGrade[grade].map(w => ({ subject: w.subject, text: w.text, createdAt: w.createdAt }));
        if (isCloud) return self._cloudSend('公共错题库', items, grade);
        const host = this._getSavedHost();
        return self._lanPost('http://' + host + ':8899/upload', JSON.stringify({ student: '公共错题库', grade: grade, items: items, sentAt: new Date().toISOString() })).then(r => r.ok);
      };
      grades.reduce((p, grade, idx) => {
        return p.then(() => {
          status.textContent = '正在发送 ' + (idx + 1) + '/' + grades.length + '：' + grade + '年级';
          return sendOne(grade).then(ok => { if (!ok) throw new Error('发送失败'); });
        });
      }, Promise.resolve()).then(() => {
        status.innerHTML = '<span style="color:#2E7D32">✅ 全部发送成功！' + list.length + ' 题已存入电脑"公共错题库"文件夹</span>';
      }).catch(e => {
        status.innerHTML = '<span style="color:#C62828">❌ 发送失败：' + self._h(e.message || e) + '（可重试）</span>';
      });
    });
  },

  _renderPubSendTargetPanel() {
    const panel = document.getElementById('pub-send-target-panel');
    if (!panel) return;
    const sel = this._objVals(this._pubSel || {});
    if (sel.length === 0) { alert('请先勾选要发送的错题'); return; }
    panel.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-light)">加载学员中...</div>';
    this._fetchAllStudents().then(students => {
      this._renderPubSendTargetPanelBody(panel, sel, students);
    });
  },

  _renderPubSendTargetPanelBody(panel, sel, students) {
    const self = this;
    let html = '<div style="border:1px solid #90CAF9;background:#E3F2FD;border-radius:10px;padding:12px 14px;margin-bottom:10px">';
    html += '<div style="font-size:13px;font-weight:700;margin-bottom:6px">📤 发送所选 ' + sel.length + ' 题 → 指定目标</div>';
    sel.forEach(w => {
      html += '<div style="font-size:12px;padding:2px 0;color:#555">· [' + this._subjName(w.subject) + '] ' + this._h(w.text) + '</div>';
    });
    html += '<div style="display:flex;gap:8px;margin:8px 0">';
    html += '<button class="login-btn" id="pub-target-stu" style="flex:1">👦 发给学员</button>';
    html += '<button class="admin-gen-btn" id="pub-target-folder" style="flex:1">📁 发到电脑文件夹</button>';
    html += '</div>';
    html += '<div id="pub-target-body"></div>';
    html += '</div>';
    panel.innerHTML = html;

    const renderBody = (mode) => {
      const body = document.getElementById('pub-target-body');
      if (!body) return;
      let b = '';
      if (mode === 'student') {
        b += '<select class="login-input" id="pub-target-student" style="appearance:auto;-webkit-appearance:auto;margin-bottom:8px">';
        b += '<option value="">选择要发送的学员</option>';
students.forEach(s => {
          const g = s.remote ? s.grade : Storage.getCurrentGrade(s);
          if (!this._gradeAllowed(g)) return;
          const key = s.remote ? 'r' + s.name : String(s.id);
          b += '<option value="' + key + '">' + this._h(s.name) + (s.remote ? ' 🌐' : '') + '（' + g + '年级）</option>';
        });
        b += '</select>';
        b += '<div style="font-size:11px;color:var(--text-light);margin-bottom:8px">发送后学员平板在"📊 学习统计 → 📥 老师练习"即可收到（走云端）</div>';
        b += '<button class="login-btn" id="pub-target-send" style="width:100%">📤 发送到学员</button>';
      } else {
        b += '<input type="text" class="login-input" id="pub-target-folder-name" placeholder="文件夹名称，如：期中复习 / 三年级专项" style="margin-bottom:6px" autocomplete="off">';
        b += '<input type="text" class="login-input" id="pub-target-folder-host" placeholder="电脑 IP，如 192.168.1.100" value="' + this._h(this._getSavedHost()) + '" style="margin-bottom:6px" autocomplete="off">';
        b += '<div style="font-size:11px;color:var(--text-light);margin-bottom:6px">电脑需先启动"错题接收器"，错题将存入电脑"文件夹名/年级"目录</div>';
        b += '<button class="login-btn" id="pub-target-send" style="width:100%">📤 发到电脑文件夹</button>';
      }
      body.innerHTML = b;
      this._bindHostInput('pub-target-folder-host');
      const sendBtn = document.getElementById('pub-target-send');
      if (sendBtn) sendBtn.addEventListener('click', () => {
        if (mode === 'student') {
          const key = document.getElementById('pub-target-student').value;
          if (!key) { alert('请选择学员'); return; }
          const s = students.find(x => (x.remote ? 'r' + x.name === key : String(x.id) === key));
          const topic = Storage.getTaskTopic();
          const toId = s && !s.remote ? parseInt(s.id) : null;
          sendBtn.textContent = '正在发送...';
          const msg4 = { toId: toId, toName: s ? s.name : '', items: sel.map(w => ({ subject: w.subject, text: w.text, note: '', answer: '' })), from: '公共错题库', sentAt: new Date().toISOString() };
          try { this._lanTaskPush(msg4); } catch (e) {}
          fetch(topic, { method: 'PUT', body: JSON.stringify(msg4) })
            .then(r => {
              if (r.ok) {
                alert('✅ 已发送 ' + sel.length + ' 题给 ' + (s ? s.name : sid) + '，学员平板点"📥 老师练习"即可收到');
                self._pubSel = {};
                if (self._pubSendSource === 'archive') { self._pubSendSource = null; self._renderWrongArchive(); }
                else self._renderPublicWrongBank();
              } else {
                alert('❌ 发送失败（' + r.status + '），请检查网络后重试');
              }
            })
            .catch(e => alert('❌ 发送失败：' + (e.message || e)));
          return;
        }
        const folderName = document.getElementById('pub-target-folder-name').value.trim();
        if (!folderName) { alert('请输入文件夹名称'); return; }
        const hostInput = document.getElementById('pub-target-folder-host');
        const host = hostInput ? hostInput.value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
        if (!host) { alert('请填写电脑 IP'); return; }
        this._saveHost(host);
        const status = sendBtn;
        status.textContent = '正在发送...';
        const byGrade = {};
        sel.forEach(w => { (byGrade[w.grade] = byGrade[w.grade] || []).push(w); });
        const grades = Object.keys(byGrade).sort((a, b) => a - b);
        const sendOne = (grade) => {
          const g = parseInt(grade, 10) || grade;
          const items = byGrade[grade].map(w => ({ subject: w.subject, text: w.text, createdAt: w.createdAt }));
          return self._lanPost('http://' + host + ':8899/upload', JSON.stringify({ student: folderName, grade: g, items: items, sentAt: new Date().toISOString() })).then(r => r.ok);
        };
        grades.reduce((p, grade, idx) => {
          return p.then(() => {
            status.textContent = '正在发送 ' + (idx + 1) + '/' + grades.length + '：' + grade + '年级';
            return sendOne(grade).then(ok => { if (!ok) throw new Error('发送失败'); });
          });
        }, Promise.resolve()).then(() => {
          alert('✅ 已发送 ' + sel.length + ' 题到电脑"' + folderName + '"文件夹');
          self._pubSel = {};
          if (self._pubSendSource === 'archive') { self._pubSendSource = null; self._renderWrongArchive(); }
          else self._renderPublicWrongBank();
        }).catch(e => {
          status.textContent = '❌ 发送失败：' + self._h(e.message || e) + '（可重试）';
        });
      });
    };
    renderBody('student');

    const stuBtn = document.getElementById('pub-target-stu');
    if (stuBtn) stuBtn.addEventListener('click', () => {
      stuBtn.classList.add('active');
      stuBtn.style.background = 'var(--primary)';
      stuBtn.style.color = '#fff';
      const fBtn = document.getElementById('pub-target-folder');
      if (fBtn) { fBtn.style.background = ''; fBtn.style.color = ''; }
      renderBody('student');
    });
    const folderBtn = document.getElementById('pub-target-folder');
    if (folderBtn) folderBtn.addEventListener('click', () => {
      folderBtn.style.background = 'var(--primary)';
      folderBtn.style.color = '#fff';
      stuBtn.style.background = '';
      stuBtn.style.color = '';
      renderBody('folder');
    });
  },

  _renderPracticePage() {
    this._renderWrongArchive();
  },

  _renderPracticeArchive() {
    this._renderWrongArchive();
  },

  _cloudSend(student, items, grade) {
    const topic = Storage.getCloudTopic();
    const batchId = Date.now();
    const chunks = [];
    let cur = [];
    const pushChunk = () => {
      if (cur.length === 0) return;
      chunks.push({ b: batchId, i: chunks.length, s: student, g: grade || '', items: cur.slice() });
      cur = [];
    };
    items.forEach(it => {
      cur.push(it);
      if (JSON.stringify(cur).length > 2400) { cur.pop(); pushChunk(); cur.push(it); }
    });
    pushChunk();
    const n = chunks.length;
    const seq = [];
    chunks.forEach((ch, idx) => {
      const msg = { b: batchId, i: idx, n: n, s: student, g: ch.g, items: ch.items };
      seq.push(fetch(topic, { method: 'PUT', body: JSON.stringify(msg) }).then(r => r.ok));
    });
    return Promise.all(seq).then(results => results.every(Boolean));
  },

  _cloudPull() {
    const topic = Storage.getCloudTopic();
    return fetch(topic + '/json?poll=1&since=all')
      .then(r => r.text())
      .then(txt => {
        let list = [];
        String(txt || '').split(/\r?\n/).forEach(ln => {
          ln = ln.trim();
          if (!ln) return;
          try { const m = JSON.parse(ln); if (m) list.push(m); } catch (e) {}
        });
        if (!Array.isArray(list)) list = [list];
        const byBatch = {};
        list.forEach(m => {
          if (!m || typeof m.message !== 'string') return;
          try {
            const d = JSON.parse(m.message);
            if (!d || typeof d.b !== 'number' || !d.s) return;
            byBatch[d.b] = byBatch[d.b] || {};
            byBatch[d.b][d.i] = { s: d.s, g: d.g || '', items: d.items || [] };
          } catch (e) {}
        });
        const out = {};
        Object.keys(byBatch).forEach(b => {
          const parts = byBatch[b];
          const idxs = Object.keys(parts).map(Number);
          if (idxs.length === 0) return;
          const expected = parts[idxs[0]].n;
          if (idxs.length < expected) return;
          let student = '';
          const grade = parts[idxs[0]].g || '';
          const items = [];
          for (let i = 0; i < expected; i++) {
            if (!parts[i]) return;
            student = parts[i].s;
            parts[i].items.forEach(it => { items.push({ subject: it.subject, text: it.text, createdAt: it.createdAt, grade: grade }); });
          }
          if (student) (out[student] = out[student] || []).push.apply(out[student], items);
        });
        return out;
      });
  },

  _lanPost(url, jsonBody) {
    return new Promise((resolve) => {
      const cb = 'lan' + (Date.now()) + Math.floor(Math.random() * 1000);
      this._lanCallbacks = this._lanCallbacks || {};
      this._lanCallbacks[cb] = resolve;
      let settled = false;
      const finish = (r) => { if (!settled) { settled = true; resolve(r); } };
      setTimeout(() => finish({ ok: false, err: 'timeout' }), 3000);
      if (window.AndroidLan) {
        try { window.AndroidLan.post(url, jsonBody, cb); return; } catch (e) {}
      }
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: jsonBody })
        .then(r => r.text().then(t => finish({ ok: r.ok, status: r.status, body: t })))
        .catch(e => finish({ ok: false, err: String(e) }));
    });
  },

  _lanGet(url) {
    return new Promise((resolve) => {
      const cb = 'lan' + (Date.now()) + Math.floor(Math.random() * 1000);
      this._lanCallbacks = this._lanCallbacks || {};
      this._lanCallbacks[cb] = resolve;
      let settled = false;
      const finish = (r) => { if (!settled) { settled = true; resolve(r); } };
      setTimeout(() => finish({ ok: false, err: 'timeout' }), 3000);
      if (window.AndroidLan) {
        try { window.AndroidLan.get(url, cb); return; } catch (e) {}
      }
      fetch(url)
        .then(r => r.text().then(t => finish({ ok: r.ok, status: r.status, body: t })))
        .catch(e => finish({ ok: false, err: String(e) }));
    });
  },

  _fetchJsonTimeout(url, ms) {
    let ctrl = null;
    try { ctrl = new AbortController(); } catch (e) {}
    const timer = setTimeout(() => { try { ctrl && ctrl.abort(); } catch (e) {} }, ms || 10000);
    return fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(r => r.text())
      .then(txt => { clearTimeout(timer); return txt; })
      .catch(e => { clearTimeout(timer); throw e; });
  },

  _lanTaskPush(msg) {
    try {
      const host = this._getSavedHost();
      if (!host) return;
      this._lanPost('http://' + host + ':8899/task-push', JSON.stringify(msg)).catch(() => {});
    } catch (e) {}
  },

  _lanTaskPull(name) {
    return new Promise((resolve) => {
      const host = this._getSavedHost();
      if (!host) { resolve(null); return; }
      let lastFail = 0;
      try { lastFail = parseInt(localStorage.getItem('pjyx_lan_fail') || '0', 10) || 0; } catch (e) {}
      if (Date.now() - lastFail < 120000) { resolve(null); return; }
      this._lanGet('http://' + host + ':8899/tasks?name=' + encodeURIComponent(name || '')).then(res => {
        try {
          if (!res.ok) {
            try { localStorage.setItem('pjyx_lan_fail', String(Date.now())); } catch (e) {}
            resolve(null);
            return;
          }
          try { localStorage.removeItem('pjyx_lan_fail'); } catch (e) {}
          const j = JSON.parse(res.body || '{}');
          const tasks = (j.tasks || []).slice();
          tasks.forEach(t => { t.__lan = true; });
          resolve(tasks);
        } catch (e) { resolve(null); }
      });
    });
  },

  // 同步学员到电脑/云端；removedList 为本次(在线)删除，另合并持久化队列的离线删除，成功后清空已同步队列
  _pushStudentsToHost(removedList) {
    try {
      const host = this._getSavedHost();
      let removed = Array.isArray(removedList) ? removedList.slice() : [];
      const pending = Storage.getPendingStudentRemovals();
      pending.forEach(r => {
        if (r && !removed.some(x => x && String(x.name) === String(r.name) && String(x.grade) === String(r.grade))) {
          removed.push({ name: r.name, grade: r.grade });
        }
      });
      const students = Storage.getStudents().map(s => ({
        name: s.name,
        grade: Storage.getCurrentGrade(s),
        createdAt: s.createdAt || ''
      }));
      if (!students.length && !removed.length) return Promise.resolve();
      const payloadObj = { students: students };
      if (removed.length) payloadObj.removed = removed;
      const payload = JSON.stringify(payloadObj);
      const onOk = () => { try { Storage.clearPendingStudentRemovals(removed); } catch (e) {} };
      // 先尝试局域网
      if (host) {
        return this._lanPost('http://' + host + ':8899/students', payload).then(res => {
          onOk();
          return res;
        }).catch(() => this._pushStudentsToCloud(payload, onOk));
      }
      // 无局域网主机，直接走云端
      return this._pushStudentsToCloud(payload, onOk);
    } catch (e) { return Promise.resolve(); }
  },

  // 连线时补发未同步的离线删除（启动/登录/学员汇总等场景调用）
  _flushPendingStudentRemovals() {
    try {
      const pending = Storage.getPendingStudentRemovals();
      if (!pending.length) return Promise.resolve();
      return this._pushStudentsToHost();
    } catch (e) { return Promise.resolve(); }
  },

  _pushStudentsToCloud(payload, onOk) {
    // 直接 POST 到 receiver 的 cloud 同步接口（需 receiver 在线）或未来扩展 GitHub API
    // 这里仅尝试局域网回退；真正的云端写入需 receiver 在线接收后同步到 GitHub
    return Promise.resolve();
  },

  _loadRemoteStudents() {
    return new Promise((resolve) => {
      try {
        const host = this._getSavedHost();
        if (!host) { resolve([]); return; }
        this._pushStudentsToHost().then(() => {
          this._lanGet('http://' + host + ':8899/students').then(res => {
            try {
              const j = JSON.parse(res.body || '{}');
              resolve((j.students || []).slice());
            } catch (e) { resolve([]); }
          }).catch(() => resolve([]));
        }).catch(() => resolve([]));
      } catch (e) { resolve([]); }
    });
  },

  _fetchAllStudents() {
    return new Promise((resolve) => {
      try {
        const local = Storage.getStudents().map(s => ({
          id: s.id,
          name: s.name,
          grade: Storage.getCurrentGrade(s),
          createdAt: s.createdAt || '',
          remote: false
        }));
        this._loadRemoteStudents().then(remote => {
          const seen = {};
          local.forEach(s => { seen[s.name] = true; });
          const merged = local.slice();
          (remote || []).forEach(s => {
            const nm = String(s.name || '').trim();
            if (!nm || seen[nm]) return;
            seen[nm] = true;
            merged.push({ id: null, name: nm, grade: parseInt(s.grade, 10) || 1, createdAt: s.createdAt || '', remote: true });
          });
          resolve(merged);
        }).catch(() => resolve(local));
      } catch (e) { resolve(Storage.getStudents()); }
    });
  },

  _lanDone(callbackId, result) {
    const cb = this._lanCallbacks && this._lanCallbacks[callbackId];
    if (cb) {
      delete this._lanCallbacks[callbackId];
      try { cb(typeof result === 'string' ? JSON.parse(result) : result); } catch (e) { cb({ ok: false, err: 'bad-result' }); }
    }
  },

  _renderAdminReports() {
    const container = document.getElementById('admin-tab-content');
    const grades = Storage.getAdminGrades();
    const gradeName = grades.length ? grades.map(x => x + '年级').join('、') : '全部年级';
    let html = '<div class="admin-section">';
    html += '<h3 style="margin:0 0 8px">👀 学生学习情况</h3>';
    html += '<div style="background:#E3F2FD;border:1px solid #90CAF9;border-radius:10px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#1565C0">当前负责：<strong>' + gradeName + '</strong></div>';
    html += '<p style="margin:0 0 10px;font-size:12px;color:var(--text-light)">学生平板在"学习统计"页点"📤 上报学习情况"后，这里即可查看。云端保留约 1 天，建议每天查看。</p>';
    html += '<button class="login-btn" id="rep-refresh" style="width:100%">🔄 拉取最新学习情况</button>';
    html += '<div id="rep-list" style="margin-top:10px"></div>';
    html += '<button class="login-btn" id="ans-refresh" style="width:100%;margin-top:8px;background:#6D4C41;border-color:#6D4C41">📥 查看学员答题结果</button>';
    html += '<div id="ans-list" style="margin-top:10px"></div>';
    html += '</div>';
    container.innerHTML = html;

    document.getElementById('rep-refresh').addEventListener('click', () => this._loadReports());
    document.getElementById('ans-refresh').addEventListener('click', () => this._loadAnswers());
    this._loadReports();
    this._loadAnswers();
  },

  _loadReports() {
    const list = document.getElementById('rep-list');
    if (!list) return;
    list.innerHTML = '<div style="padding:20px;text-align:center;font-size:13px;color:var(--text-light)">正在拉取数据...</div>';
    const parseCloud = (txt) => {
      const items = [];
      txt.split(/\r?\n/).forEach(line => {
        line = line.trim();
        if (!line) return;
        let block = null;
        try { block = JSON.parse(line); } catch (e) { return; }
        if (!Array.isArray(block)) block = [block];
        block.forEach(m => {
          if (!m || typeof m.message !== 'string') return;
          try { items.push(JSON.parse(m.message)); } catch (e) {}
        });
      });
      return items;
    };
    const dedupByDevice = (arr) => {
      const latest = {};
      (arr || []).forEach(r => {
        if (!r || !r.deviceId) return;
        const prev = latest[r.deviceId];
        if (!prev || String(r.updatedAt || '') > String(prev.updatedAt || '')) latest[r.deviceId] = r;
      });
      return Object.keys(latest).map(k => latest[k]);
    };
    this._lanReportPull().then(lan => {
      fetch(Storage.getReportTopic() + '/json?poll=1&since=all')
        .then(r => r.text())
        .then(txt => {
          this._renderReports(dedupByDevice((lan || []).concat(parseCloud(txt))));
        })
        .catch(e => {
          if (lan && lan.length) {
            this._renderReports(dedupByDevice(lan));
          } else {
            list.innerHTML = '<div style="padding:20px;text-align:center;font-size:13px;color:#C62828">❌ 拉取失败：' + this._h(e.message || e) + '，请检查网络后重试</div>';
          }
        });
    });
  },

  _lanReportPull() {
    return new Promise((resolve) => {
      const host = this._getSavedHost();
      if (!host) { resolve(null); return; }
      let lastFail = 0;
      try { lastFail = parseInt(localStorage.getItem('pjyx_lan_fail') || '0', 10) || 0; } catch (e) {}
      if (Date.now() - lastFail < 120000) { resolve(null); return; }
      this._lanGet('http://' + host + ':8899/reports').then(res => {
        try {
          if (!res.ok) {
            try { localStorage.setItem('pjyx_lan_fail', String(Date.now())); } catch (e) {}
            resolve(null);
            return;
          }
          try { localStorage.removeItem('pjyx_lan_fail'); } catch (e) {}
          const j = JSON.parse(res.body || '{}');
          resolve((j.reports || []).slice());
        } catch (e) { resolve(null); }
      });
    });
  },

  _renderReports(items) {
    const list = document.getElementById('rep-list');
    if (!list) return;
    const valid = items.filter(r => r && r.deviceId && r.stats)
      .filter(r => this._gradeAllowed(r.grade));
    if (valid.length === 0) {
      list.innerHTML = '<div style="padding:20px;text-align:center;font-size:13px;color:var(--text-light)">还没有学生的上报数据<br>请各学生平板：点"📊 学习统计" → 点"📤 上报学习情况"</div>';
      return;
    }
    const latest = {};
    valid.forEach(r => {
      const prev = latest[r.deviceId];
      if (!prev || (r.updatedAt || '') > (prev.updatedAt || '')) latest[r.deviceId] = r;
    });
    const rows = Object.keys(latest).map(k => latest[k]).filter(r => !this._isArchivedReport(r));
    rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'));
    let html = '';
    rows.forEach(r => {
      const st = r.stats || {};
      const devShort = String(r.deviceId || '').slice(-4) || '????';
      const when = r.updatedAt ? new Date(r.updatedAt).toLocaleString('zh-CN') : '';
      const lastPractice = st.lastPractice ? ' · 最近练习 ' + st.lastPractice : '';
      html += '<div style="background:#F5F7FA;border:1px solid #E0E0E0;border-radius:10px;padding:12px 14px;margin-bottom:10px">';
      html += '<div style="display:flex;align-items:center;gap:6px">';
      html += '<strong style="font-size:15px">' + this._h(r.name) + '</strong>';
      html += '<span style="font-size:12px;color:var(--primary)">' + this._h(r.grade || '') + '年级</span>';
      html += '<span style="font-size:11px;color:var(--text-muted)">设备尾号 ' + devShort + '</span>';
      html += '</div>';
      html += '<div style="font-size:11px;color:var(--text-light);margin:4px 0 8px">上报 ' + when + lastPractice + '</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
      const chips = [
        ['⚡ 积分', st.xp], ['Lv.' + (st.level || 1), '等级'], ['⭐ 星星', st.stars],
        ['📖 已学 ' + (st.wordsLearned || 0), '词'], ['📚 ' + (st.lessons || 0), '课时'],
        ['🔥 ' + (st.streak || 0), '天连续'], ['⏱ ' + (st.minutes || 0) + '分', '时长'], ['❌ ' + (st.wrongs || 0), '错题']
      ];
      chips.forEach(c => {
        html += '<span style="background:#fff;border:1px solid #E0E0E0;border-radius:12px;padding:3px 10px;font-size:12px">' + c[0] + '</span>';
      });
      html += '</div>';
      const subNames2 = { english: '英语', chinese: '语文', math: '数学' };
      const subColors2 = { english: '#00BFA5', chinese: '#FF9800', math: '#2196F3' };
      const subjects = st.subjects || {};
      const subKeys = Object.keys(subNames2).filter(k => subjects[k] && subjects[k].sessions > 0);
      if (subKeys.length > 0) {
        html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">';
        subKeys.forEach(k => {
          const ss = subjects[k];
          html += '<span style="background:' + subColors2[k] + ';color:#fff;border-radius:10px;padding:2px 8px;font-size:11px">' + subNames2[k] + ' ' + ss.sessions + '次 · ' + ss.minutes + '分 · 正确率' + ss.accuracy + '%</span>';
        });
        html += '</div>';
      }
      html += '<div style="margin-top:8px"><button class="admin-gen-btn" style="width:100%" data-rep-arch="' + this._h(r.deviceId) + '">📥 评分归档（写入学情报告并清除本次上报）</button></div>';
      html += '</div>';
    });
    html += '<div style="padding:6px;text-align:center;font-size:11px;color:var(--text-muted)">共 ' + rows.length + ' 个学生平板上报</div>';
    list.innerHTML = html;
    list.querySelectorAll('[data-rep-arch]').forEach(el => {
      el.addEventListener('click', () => {
        const r = rows.find(x => String(x.deviceId) === String(el.dataset.repArch));
        if (!r) return;
        this._gradeReport(r);
      });
    });
  },

  _isArchivedReport(r) {
    if (!r || !r.deviceId) return false;
    try {
      const arr = JSON.parse(localStorage.getItem('vocab_archived_rep') || '[]');
      const k = String(r.deviceId) + '|' + String(r.updatedAt || '');
      return arr.indexOf(k) >= 0;
    } catch (e) { return false; }
  },

  _markArchivedReport(r) {
    try {
      const cur = JSON.parse(localStorage.getItem('vocab_archived_rep') || '[]');
      const k = String(r.deviceId) + '|' + String(r.updatedAt || '');
      if (cur.indexOf(k) < 0) cur.push(k);
      while (cur.length > 2000) cur.shift();
      localStorage.setItem('vocab_archived_rep', JSON.stringify(cur));
      if (r && r.stats) {
        const dataMap = JSON.parse(localStorage.getItem('vocab_archived_rep_data') || '{}');
        dataMap[k] = { name: r.name, grade: r.grade || '', stats: r.stats, updatedAt: r.updatedAt || '' };
        const keys = Object.keys(dataMap);
        if (keys.length > 2000) { const old = keys.slice(0, keys.length - 2000); old.forEach(ok => delete dataMap[ok]); }
        localStorage.setItem('vocab_archived_rep_data', JSON.stringify(dataMap));
      }
    } catch (e) {}
  },

  _getArchivedReportForStudent(studentId) {
    try {
      const students = Storage.getStudents();
      const student = students.find(s => s.id === studentId);
      if (!student) return null;
      const grade = Storage.getCurrentGrade(student);
      const name = student.name;
      const dataMap = JSON.parse(localStorage.getItem('vocab_archived_rep_data') || '{}');
      let best = null;
      Object.keys(dataMap).forEach(k => {
        const entry = dataMap[k];
        if (entry && entry.name === name && String(entry.grade) === String(grade)) {
          if (!best || String(entry.updatedAt || '') > String(best.updatedAt || '')) best = entry;
        }
      });
      return best;
    } catch (e) { return null; }
  },

  _gradeReport(r) {
    const host = this._getSavedHost();
    const self = this;
    try {
      fetch(Storage.getAnswerTopic(), { method: 'PUT', body: JSON.stringify({
        graded: true, kind: 'report', name: r.name, grade: r.grade || '',
        deviceId: r.deviceId, stats: r.stats || {}, gradedAt: new Date().toISOString()
      }) }).catch(() => {});
    } catch (e) {}
    if (!host) {
      self._markArchivedReport(r);
      alert('✅ 已评分归档到学情报告（未连接电脑，归档结果已同步云端，启动接收器后自动补齐学情报告）');
      self._loadReports();
      return;
    }
    this._lanPost('http://' + host + ':8899/grade-report', JSON.stringify({ student: r.name, grade: r.grade || '', deviceId: r.deviceId, stats: r.stats || {} }))
      .then(res => {
        if (res && res.ok) {
          self._markArchivedReport(r);
          alert('✅ 已评分归档到学情报告，本次上报已清除');
          self._loadReports();
        } else {
          self._markArchivedReport(r);
          alert('⚠️ 电脑接收器未运行，归档结果已通过云端发送；启动接收器后将自动补写学情报告');
          self._loadReports();
        }
      })
      .catch(e => {
        self._markArchivedReport(r);
        alert('⚠️ 电脑接收器未运行，归档结果已通过云端发送；启动接收器后将自动补写学情报告');
        self._loadReports();
      });
  },

_loadAnswers() {
    const list = document.getElementById('ans-list');
    if (!list) return;
    list.innerHTML = '<div style="padding:20px;text-align:center;font-size:13px;color:var(--text-light)">正在拉取答题结果...</div>';
    const parseCloud = (txt) => {
      const items = [];
      txt.split(/\r?\n/).forEach(line => {
        line = line.trim();
        if (!line) return;
        let block = null;
        try { block = JSON.parse(line); } catch (e) { return; }
        if (!Array.isArray(block)) block = [block];
        block.forEach(m => {
          if (!m || typeof m.message !== 'string') return;
          try { items.push(JSON.parse(m.message)); } catch (e) {}
        });
      });
      return items;
    };
    this._lanAnswerPull().then(lan => {
      fetch(Storage.getAnswerTopic() + '/json?poll=1&since=all')
        .then(r => r.text())
        .then(txt => {
          const all = (lan || []).concat(parseCloud(txt));
          this._renderAnswers(this._dedupAnswers(all));
        })
        .catch(e => {
          if (lan && lan.length) {
            this._renderAnswers(this._dedupAnswers(lan));
          } else {
            list.innerHTML = '<div style="padding:20px;text-align:center;font-size:13px;color:#C62828">❌ 拉取失败：' + this._h(e.message || e) + '，请检查网络后重试</div>';
          }
        });
    });
  },

  _dedupAnswers(items) {
    const seen = {};
    const out = [];
    items.forEach(a => {
      if (!a || !a.taskId) return;
      const k = String(a.taskId) + '|' + String(a.name || '') + '|' + String(a.submittedAt || '');
      if (seen[k]) return;
      seen[k] = true;
      out.push(a);
    });
    return out;
  },

  _renderAnswers(items) {
    const list = document.getElementById('ans-list');
    if (!list) return;
    items = items.filter(a => !this._isArchivedAnswer(a));
    const valid = items.filter(a => a && a.taskId)
      .filter(a => this._gradeAllowed(a.grade));
    if (valid.length === 0) {
      list.innerHTML = '<div style="padding:20px;text-align:center;font-size:13px;color:var(--text-light)">还没有学员提交答题结果</div>';
      return;
    }
    const byName = {};
    valid.forEach(a => {
      const k = a.name || '未知学员';
      (byName[k] = byName[k] || []).push(a);
    });
    const names = Object.keys(byName).sort((x, y) => String(x).localeCompare(String(y), 'zh-CN'));
    let html = '';
    names.forEach(n => {
      const arr = byName[n].slice().sort((x, y) => String(x.submittedAt).localeCompare(String(y.submittedAt)));
      let ok = 0, bad = 0, pending = 0;
      arr.forEach(a => {
        if (a.correct === true) ok++;
        else if (a.correct === false) bad++;
        else pending++;
      });
      html += '<div style="background:#F5F7FA;border:1px solid #E0E0E0;border-radius:10px;padding:10px 12px;margin-bottom:10px">';
      html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
      html += '<strong style="font-size:15px">' + this._h(n) + '</strong>';
      html += '<span style="font-size:12px;color:var(--primary)">' + this._h(arr[0].grade || '') + '年级</span>';
      html += '<span style="font-size:12px;color:var(--green)">✅ ' + ok + '</span>';
      html += '<span style="font-size:12px;color:var(--red)">❌ ' + bad + '</span>';
      html += (pending ? '<span style="font-size:12px;color:#8D6E63">⏳ ' + pending + ' 待老师批阅</span>' : '');
      html += '<span style="font-size:11px;color:var(--text-muted)">共 ' + arr.length + ' 题</span>';
      html += '</div>';
      html += '<div style="margin-top:6px;font-size:12px">';
      arr.forEach(a => {
        const flag = a.correct === true ? '<span style="color:var(--green)">✅</span>' : a.correct === false ? '<span style="color:var(--red)">❌</span>' : '<span style="color:#8D6E63">⏳</span>';
        const textShort = String(a.text || '').length > 30 ? String(a.text).slice(0, 30) + '…' : a.text;
        html += '<div style="padding:4px 0;border-bottom:1px dashed #E0E0E0">' + flag + ' ' + this._h(textShort) + '<br><span style="color:var(--text-muted)">　我的答案：' + this._h(String(a.myAnswer || '—')) + (a.correct === false && a.answer ? ' · 标准答案：' + this._h(String(a.answer)) : '') + ' · ' + new Date(a.submittedAt).toLocaleString('zh-CN') + '</span></div>';
      });
      html += '</div>';
      html += '<div style="margin-top:8px"><button class="admin-gen-btn" style="width:100%" data-arch="' + this._h(n) + '">📥 评分归档（写入学情报告并清除本次上报）</button></div>';
      html += '</div></div>';
    });
    list.innerHTML = html;
    list.querySelectorAll('[data-arch]').forEach(el => {
      el.addEventListener('click', () => {
        const nm = el.dataset.arch;
        const grade = (byName[nm][0] || {}).grade || '';
        this._gradeAnswers(nm, grade, byName[nm]);
      });
    });
  },

  _isArchivedAnswer(a) {
    if (!a || !a.taskId || !a.name) return false;
    try {
      const arr = JSON.parse(localStorage.getItem('vocab_archived_ans') || '[]');
      const k = String(a.name) + '|' + String(a.taskId) + '|' + String(a.submittedAt || '');
      return arr.indexOf(k) >= 0;
    } catch (e) { return false; }
  },

  _markArchivedAnswers(arr) {
    try {
      const cur = JSON.parse(localStorage.getItem('vocab_archived_ans') || '[]');
      arr.forEach(a => {
        if (!a || !a.taskId || !a.name) return;
        const k = String(a.name) + '|' + String(a.taskId) + '|' + String(a.submittedAt || '');
        if (cur.indexOf(k) < 0) cur.push(k);
      });
      while (cur.length > 5000) cur.shift();
      localStorage.setItem('vocab_archived_ans', JSON.stringify(cur));
    } catch (e) {}
  },

  _gradeAnswers(name, grade, arr) {
    const items = [];
    const need = [];
    arr.forEach(a => {
      if (a.correct === true || a.correct === false) {
        items.push({ taskId: a.taskId, text: a.text, myAnswer: a.myAnswer, answer: a.answer, correct: a.correct === true, subject: a.subject || '' });
      } else {
        need.push(a);
      }
    });
    const self = this;
    const ask = (i) => {
      if (i >= need.length) { this._doGradePost(name, grade, arr, items); return; }
      const a = need[i];
      this._gradeModal(
        '批阅第 ' + (i + 1) + ' / ' + need.length + ' 题',
        String(a.text || ''),
        String(a.myAnswer || '—'),
        a.answer ? String(a.answer) : '',
        (correct) => {
          items.push({ taskId: a.taskId, text: a.text, myAnswer: a.myAnswer, answer: a.answer, correct: correct, subject: a.subject || '' });
          ask(i + 1);
        }
      );
    };
    ask(0);
  },

  _gradeModal(title, text, my, ans, onDecide) {
    const old = document.getElementById('grade-modal-wrap');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    const wrap = document.createElement('div');
    wrap.id = 'grade-modal-wrap';
    wrap.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    wrap.innerHTML =
      '<div style="background:#fff;border-radius:14px;max-width:420px;width:100%;max-height:80vh;overflow:auto;padding:18px 16px;box-shadow:0 8px 30px rgba(0,0,0,.25)">' +
      '<div style="font-size:14px;font-weight:700;color:#1565C0;margin-bottom:10px">📝 ' + this._h(title) + '</div>' +
      '<div style="font-size:15px;line-height:1.6;white-space:pre-wrap;word-break:break-all">' + this._h(text) + '</div>' +
      '<div style="font-size:13px;color:#555;margin-top:8px;line-height:1.6;word-break:break-all">我的答案：<strong>' + this._h(my) + '</strong></div>' +
      (ans ? '<div style="font-size:13px;color:#8D6E63;margin-top:4px;line-height:1.6;word-break:break-all">标准答案：' + this._h(ans) + '</div>' : '') +
      '<div style="display:flex;gap:10px;margin-top:16px">' +
      '<button id="grade-btn-wrong" style="flex:1;background:#C62828;color:#fff;border:none;border-radius:10px;padding:12px 0;font-size:15px;font-weight:700">❌ 错误</button>' +
      '<button id="grade-btn-right" style="flex:1;background:#2E7D32;color:#fff;border:none;border-radius:10px;padding:12px 0;font-size:15px;font-weight:700">✅ 正确</button>' +
      '</div></div>';
    document.body.appendChild(wrap);
    wrap.querySelector('#grade-btn-wrong').addEventListener('click', () => { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); onDecide(false); });
    wrap.querySelector('#grade-btn-right').addEventListener('click', () => { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); onDecide(true); });
  },

  _doGradePost(name, grade, arr, items) {
    const self = this;
    items.forEach(it => {
      fetch(Storage.getAnswerTopic(), { method: 'PUT', body: JSON.stringify({
        graded: true, name: name, grade: grade, taskId: it.taskId, subject: it.subject || '',
        text: it.text || '', myAnswer: it.myAnswer || '', answer: it.answer || '',
        correct: it.correct === true, gradedAt: new Date().toISOString()
      }) }).catch(() => {});
    });
    const host = this._getSavedHost();
    if (!host) {
      this._markArchivedAnswers(arr);
      alert('✅ 已评分归档到学情报告（未连接电脑，评分结果已同步云端）');
      this._loadAnswers();
      return;
    }
    this._lanPost('http://' + host + ':8899/grade-answers', JSON.stringify({ student: name, grade: grade, items: items }))
      .then(res => {
        if (res && res.ok) {
          try {
            const j = JSON.parse(res.body || '{}');
            this._markArchivedAnswers(arr);
            alert('✅ 已评分归档 ' + (j.archived || items.length) + ' 题到学情报告，本次上报已清除');
          } catch (e) { this._markArchivedAnswers(arr); alert('✅ 已评分归档到学情报告'); }
          this._loadAnswers();
        } else {
          this._markArchivedAnswers(arr);
          alert('⚠️ 电脑接收器未运行，评分结果已通过云端发送到学员平板；启动接收器后将自动补归档到学情报告');
          this._loadAnswers();
        }
      })
      .catch(e => {
        this._markArchivedAnswers(arr);
        alert('⚠️ 电脑接收器未运行，评分结果已通过云端发送到学员平板；启动接收器后将自动补归档到学情报告');
        this._loadAnswers();
      });
  },

  _renderScanCapture(studentId, subject) {
    const container = document.getElementById('admin-tab-content');
    const student = Storage.getStudents().find(s => s.id === studentId);
    if (!student) { this._renderAdminScan(); return; }
    this._scanSubject = subject;

    let html = '<div class="admin-section">';
    html += '<button class="back-btn" onclick="App._renderScanPage(' + studentId + ')">← 返回上一级</button>';
    html += '<h3 style="margin:10px 0">📷 ' + this._subjName(subject) + '作业扫描 · ' + this._h(student.name) + '</h3>';

    html += '<button class="daily-mode-btn" id="scan-take" style="width:100%">📸 拍照扫描</button>';
    html += '<input type="file" id="scan-file-input" accept="image/*" capture="environment" style="display:none">';

    html += '<div id="scan-img-wrap" style="margin:12px 0;display:none"><img id="scan-img" style="width:100%;border-radius:10px;border:1px solid #EEE"></div>';

    html += '<button class="daily-mode-btn" id="scan-ocr" style="width:100%;background:#1565C0;display:none">🔍 开始识别</button>';
    html += '<div id="scan-status" style="font-size:12px;color:var(--text-light);margin:8px 0;min-height:18px"></div>';

    html += '<h4 style="margin:10px 0 6px;color:var(--primary)">识别结果（可编辑）</h4>';
    html += '<textarea id="scan-text" rows="10" style="width:100%;border:1px solid #DDD;border-radius:10px;padding:10px;font-size:14px;box-sizing:border-box" placeholder="拍照识别后，文字将显示在这里，可直接修改成正式文档"></textarea>';

    html += '<div style="display:flex;gap:10px;margin-top:10px">';
    html += '<button class="login-btn" id="scan-save" style="flex:1">💾 保存为作业文档</button>';
    html += '<button class="admin-gen-btn" id="scan-pick-wrong" style="flex:1">❌ 勾选错题</button>';
    html += '</div>';

    html += '<div id="scan-wrong-list" style="margin-top:12px"></div>';
    html += '<div id="scan-dialog-wrap" style="display:none"></div>';
    html += '</div>';
    container.innerHTML = html;

    const img = document.getElementById('scan-img');
    const imgWrap = document.getElementById('scan-img-wrap');
    const ocrBtn = document.getElementById('scan-ocr');
    const status = document.getElementById('scan-status');

    document.getElementById('scan-take').addEventListener('click', () => {
      document.getElementById('scan-file-input').click();
    });

    document.getElementById('scan-file-input').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      status.textContent = '正在压缩图片...';
      const reader = new FileReader();
      reader.onload = () => {
        const image = new Image();
        image.onload = () => {
          const maxW = 1280;
          const scale = Math.min(1, maxW / image.width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(image.width * scale);
          canvas.height = Math.round(image.height * scale);
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          this._scanBase64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
          img.src = canvas.toDataURL('image/jpeg', 0.85);
          imgWrap.style.display = 'block';
          ocrBtn.style.display = 'block';
          status.textContent = '图片已就绪，点击"开始识别"';
        };
        image.onerror = () => { status.textContent = '图片读取失败'; };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

    ocrBtn.addEventListener('click', () => this._runOcr(status));

    document.getElementById('scan-save').addEventListener('click', () => {
      const text = document.getElementById('scan-text').value.trim();
      if (!text) { status.textContent = '请先识别或填写内容'; return; }
      const works = Storage.getScanWorks(studentId);
      works.push({
        id: Date.now(),
        subject: subject,
        text: text,
        createdAt: new Date().toISOString()
      });
      Storage.saveScanWorks(studentId, works);
      status.textContent = '✅ 作业文档已保存入库';
    });

    document.getElementById('scan-pick-wrong').addEventListener('click', () => {
      const text = document.getElementById('scan-text').value.trim();
      if (!text) { status.textContent = '请先识别或填写内容'; return; }
      this._scanWrongText = text;
      this._renderWrongPicker(studentId, subject);
    });
  },

  _runOcr(status) {
    const self = this;
    const host = this._getSavedHost();
    const useLocal = function () { self._runOcrWith(Storage.getOcrConfig(), status); };
    if (!host || !self._scanBase64) { useLocal(); return; }
    status.textContent = '正在识别中（电脑端），请稍候...';
    fetch('http://' + host + ':8899/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: self._scanBase64 }),
      cache: 'no-store'
    })
    .then(r => r.json())
    .then(v => {
      if (v && v.ok && v.text) {
        self._ocrFellBack = false;
        document.getElementById('scan-text').value = v.text;
        status.textContent = '✅ 识别完成，请校对修改后保存';
      } else {
        useLocal();
      }
    })
    .catch(() => useLocal());
  },

  _runOcrWith(cfg, status) {
    if (!cfg.apiKey || !cfg.secretKey) {
      status.textContent = '⚠️ 当前没有可用的 API Key / Secret Key，请填写新的密钥';
      this._showOcrKeyDialog('当前没有可用的 API Key / Secret Key（内置密钥缺失或已被清除）', () => this._runOcr(status));
      return;
    }
    if (!this._scanBase64) { status.textContent = '请先拍照'; return; }
    status.textContent = '正在识别中，请稍候（需联网）...';
    var self = this;
    var tokenUrl = 'https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=' + encodeURIComponent(cfg.apiKey) + '&client_secret=' + encodeURIComponent(cfg.secretKey);
    var fallbackToBuiltin = function (reason) {
      if (Storage.getOcrOverride() && !self._ocrFellBack) {
        self._ocrFellBack = true;
        Storage.clearOcrOverride();
        status.textContent = '⚠️ 当前密钥已失效，已自动切换内置密钥重试...';
        self._runOcr(status);
        return true;
      }
      self._ocrFellBack = false;
      status.textContent = '❌ ' + reason;
      self._showOcrKeyDialog(reason, () => { self._ocrFellBack = false; self._runOcr(status); });
      return false;
    };
    self._lanGet(tokenUrl).then(function (res) {
      if (!res || !res.ok) {
        const reason = '获取访问令牌失败：' + (res && res.err ? res.err : '网络连接失败');
        return fallbackToBuiltin(reason) || null;
      }
      var tokenJson = null;
      try { tokenJson = JSON.parse(res.body); } catch (e) {}
      if (!tokenJson || !tokenJson.access_token) {
        const reason = '获取访问令牌失败：' + (tokenJson && (tokenJson.error_description || tokenJson.error) || '未知错误') + '（可能 Key 无效或账号异常）';
        return fallbackToBuiltin(reason) || null;
      }
      return fetch('https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=' + tokenJson.access_token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: 'image=' + encodeURIComponent(self._scanBase64)
      }).then(r => r.text().then(t => ({ ok: r.ok, status: r.status, body: t }))).catch(e => ({ ok: false, err: String(e) }));
    }).then(function (ocrRes) {
      if (!ocrRes) return;
      if (!ocrRes.ok) {
        const reason = '识别服务异常：' + (ocrRes.err || '网络连接失败');
        fallbackToBuiltin(reason);
        return;
      }
      var ocrJson = null;
      try { ocrJson = JSON.parse(ocrRes.body); } catch (e) {}
      if (!ocrJson) {
        const reason = '识别结果解析失败';
        fallbackToBuiltin(reason);
        return;
      }
      if (ocrJson.error_code) {
        const reason = '识别失败：' + ocrJson.error_msg + '（可能额度不足、服务未开通或政策变动）';
        fallbackToBuiltin(reason);
        return;
      }
      self._ocrFellBack = false;
      const text = (ocrJson.words_result || []).map(r => r.words).join('\n');
      document.getElementById('scan-text').value = text;
      status.textContent = '✅ 识别完成，请校对修改后保存';
    })
    .catch(function(e) {
      const reason = '网络或服务异常：' + (e.message || e);
      fallbackToBuiltin(reason);
    });
  },

  _showOcrKeyDialog(reason, onSave) {
    const wrap = document.getElementById('scan-dialog-wrap');
    if (!wrap) return;
    wrap.innerHTML = '<div style="margin-top:12px;padding:14px;background:#FFF3E0;border:2px solid #FFB74D;border-radius:12px">' +
      '<div style="font-size:13px;font-weight:700;color:#E65100;margin-bottom:6px">⚠️ OCR 识别不可用，请更新密钥</div>' +
      '<div style="font-size:12px;color:#5D4037;margin-bottom:8px;word-break:break-all">' + this._h(reason) + '</div>' +
      '<div style="font-size:11px;color:#8D6E63;margin-bottom:8px">推荐：在电脑端修改"工具\\ocr-key.txt"可切换平台（百度/腾讯云/讯飞）或更换密钥，所有平板自动生效；也可在此临时填写（仅本机生效）</div>' +
      '<input type="password" class="login-input" id="ocr-fix-key" placeholder="新 API Key" style="margin-bottom:6px" autocomplete="off">' +
      '<input type="password" class="login-input" id="ocr-fix-secret" placeholder="新 Secret Key" style="margin-bottom:6px" autocomplete="off">' +
      '<div style="display:flex;gap:8px">' +
      '<button class="login-btn" id="ocr-fix-save" style="flex:1">保存并重试</button>' +
      '<button class="admin-gen-btn" id="ocr-fix-reset" style="flex:1">恢复内置密钥</button>' +
      '<button class="admin-gen-btn" id="ocr-fix-cancel" style="flex:1">取消</button>' +
      '</div></div>';
    wrap.style.display = 'block';
    document.getElementById('ocr-fix-save').addEventListener('click', () => {
      const k = document.getElementById('ocr-fix-key').value.trim();
      const s = document.getElementById('ocr-fix-secret').value.trim();
      if (!k || !s) { alert('请填写完整的 API Key 和 Secret Key'); return; }
      Storage.saveOcrConfig({ apiKey: k, secretKey: s });
      wrap.style.display = 'none';
      if (onSave) onSave();
    });
    document.getElementById('ocr-fix-reset').addEventListener('click', () => {
      Storage.clearOcrOverride();
      wrap.style.display = 'none';
      if (onSave) onSave();
    });
    document.getElementById('ocr-fix-cancel').addEventListener('click', () => { wrap.style.display = 'none'; });
  },

  _renderWrongPicker(studentId, subject) {
    const wrap = document.getElementById('scan-wrong-list');
    if (!wrap) return;
    const lines = this._scanWrongText.split(/\n+/).map(s => s.trim()).filter(s => s.length > 0);
    let html = '<div style="padding:12px 14px;background:#FFEBEE;border:1px solid #EF9A9A;border-radius:10px">';
    html += '<div style="font-size:13px;font-weight:700;color:#B71C1C;margin-bottom:8px">勾选做错的题目（' + lines.length + ' 行）</div>';
    html += '<div style="max-height:300px;overflow-y:auto">';
    lines.forEach((line, i) => {
      html += '<label style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;font-size:13px;border-bottom:1px dashed #EEE">';
      html += '<input type="checkbox" class="wrong-check" data-i="' + i + '" style="margin-top:3px">';
      html += '<span style="flex:1;white-space:pre-wrap">' + (i + 1) + '. ' + this._h(line) + '</span>';
      html += '</label>';
    });
    html += '</div>';
    html += '<button class="login-btn" id="wrong-save" style="width:100%;margin-top:10px">📁 勾选的题目加入本周错题</button>';
    html += '</div>';
    wrap.innerHTML = html;

    document.getElementById('wrong-save').addEventListener('click', () => {
      const picked = [];
      wrap.querySelectorAll('.wrong-check').forEach(cb => {
        if (cb.checked) {
          const line = lines[parseInt(cb.dataset.i)];
          if (line) picked.push(line);
        }
      });
      if (picked.length === 0) { alert('请先勾选做错的题目'); return; }
      picked.forEach(line => Storage.addWeekWrong(studentId, subject, line));
      alert('✅ ' + picked.length + ' 道错题已加入"本周错题"（发给电脑后自动归档进错题库）');
    });
  },

  _renderAdminStudentReport(studentId) {
    if (!this.isAdminMode || !this.adminViewingStudent) return;
    const main = document.getElementById('main-content');
    const data = Storage.getStudentData(studentId);
    const sessions = data.sessions.filter(s => s.completed);
    let totalMin = 0; sessions.forEach(s => { totalMin += Math.max(1, Math.round((s.duration || 0) / 60)); });
    this._generateShareImage(data, sessions, totalMin);
  },

  _generateShareImage(data, sessions, totalMin, displayName, previewDiv, wrongWordCount, noWechatShare) {
    let name = displayName || (this.adminViewingStudent ? this.adminViewingStudent.name : '');
    if (!name) {
      try {
        const sid = Storage.getStudent();
        if (sid) {
          const st = Storage.getStudents().find(s => s.id === sid);
          if (st && st.name) name = st.name;
        }
      } catch (e) {}
    }
    if (!name) name = '学员';
    wrongWordCount = wrongWordCount || 0;
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 1180;
    const ctx = canvas.getContext('2d');

    let totalCorrect = 0, totalWrong = 0;
    const typeStats = {};
    const dailyMap = {};
    const subjectStats = { english: { count: 0, min: 0, correct: 0, wrong: 0 }, chinese: { count: 0, min: 0, correct: 0, wrong: 0 }, math: { count: 0, min: 0, correct: 0, wrong: 0 } };
    const exSessions = sessions.filter(function(s) { return s.type !== 'zhFly'; });
    exSessions.forEach(s => {
      totalCorrect += s.correctCount || 0;
      const wt = s.wrongCount != null ? s.wrongCount : ((s.totalItems || 0) - (s.correctCount || 0));
      totalWrong += wt;
      const t = s.type || 'exercise';
      if (!typeStats[t]) typeStats[t] = { count: 0, min: 0 };
      typeStats[t].count++; typeStats[t].min += Math.max(1, Math.round((s.duration || 0) / 60));
      const sub = s.subject || 'english';
      if (subjectStats[sub]) {
        subjectStats[sub].count++;
        subjectStats[sub].min += Math.max(1, Math.round((s.duration || 0) / 60));
        subjectStats[sub].correct += s.correctCount || 0;
        subjectStats[sub].wrong += wt;
      }
      const dk = new Date(s.startTime).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
      if (!dailyMap[dk]) dailyMap[dk] = 0;
      dailyMap[dk] += Math.max(1, Math.round((s.duration || 0) / 60));
    });
    const totalItems = totalCorrect + totalWrong;
    const accuracy = totalItems > 0 ? Math.round((totalCorrect / totalItems) * 100) : 0;
    const completedUnits = Object.keys(data.progress.completedLessons).length;
    const dailyKeys = Object.keys(dailyMap).sort().reverse().slice(0, 7);

    ctx.fillStyle = '#00BFA5';
    ctx.fillRect(0, 0, 600, 108);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 33px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('培基智多星学习系统 · 学情报告', 300, 69);

    ctx.fillStyle = '#263238';
    ctx.font = 'bold 27px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(name, 300, 150);

    const items = [
      { v: (data.progress.totalXP || 0) + '分', l: '总得分' },
      { v: 'Lv.' + (data.progress.level || 1), l: '等级' },
      { v: totalMin + '分钟', l: '学习时长' },
      { v: completedUnits + '课', l: '完成课程' },
      { v: exSessions.length + '次', l: '练习次数' },
      { v: (data.progress.streak || 0) + '天', l: '连续天数' },
      { v: accuracy + '%', l: '正确率' },
      { v: totalCorrect + '', l: '正确题数' },
      { v: totalWrong + '', l: '错题数', c: '#FF5252' },
      { v: wrongWordCount + '', l: '待复习错题', c: '#FF5252' },
      { v: (data.progress.lastPracticeDate || '—'), l: '最近练习' },
      { v: (typeStats.hearChoose ? typeStats.hearChoose.count : 0) + '/' + (typeStats.hearSpell ? typeStats.hearSpell.count : 0), l: '听选/听拼' },
    ];
    const cols = 3, cw = 172, ch = 81, sy = 180, gx = 22, gy = 15;
    const sx = (600 - (cols * cw + (cols - 1) * gx)) / 2;
    items.forEach((item, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = sx + col * (cw + gx), y = sy + row * (ch + gy);
      ctx.fillStyle = '#F5F7FA';
      roundRect(ctx, x, y, cw, ch, 12);
      ctx.fill();
      ctx.fillStyle = item.c || '#00BFA5';
      ctx.font = 'bold 24px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(item.v, x + cw / 2, y + 39);
      ctx.fillStyle = '#90A4AE';
      ctx.font = '15px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(item.l, x + cw / 2, y + 66);
    });

    let ty = sy + 4 * (ch + gy) + 20;

    const subNames = { english: '英语', chinese: '语文', math: '数学' };
    const subColors = { english: '#00BFA5', chinese: '#FF9800', math: '#2196F3' };
    const activeSubs = Object.keys(subjectStats).filter(k => subjectStats[k].count > 0);
    if (activeSubs.length > 0) {
      ctx.fillStyle = '#37474F';
      ctx.font = 'bold 19px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('学科学习', 24, ty);
      ty += 27;
      activeSubs.forEach(k => {
        const ss = subjectStats[k];
        const acc = (ss.correct + ss.wrong) > 0 ? Math.round(ss.correct / (ss.correct + ss.wrong) * 100) : 0;
        ctx.fillStyle = subColors[k] || '#00BFA5';
        roundRect(ctx, 24, ty - 13, 552, 28, 8);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(subNames[k] + '  ' + ss.count + '次 · ' + ss.min + '分钟 · 正确率' + acc + '%', 36, ty + 5);
        ty += 36;
      });
      ty += 8;
    }

    ctx.fillStyle = '#37474F';
    ctx.font = 'bold 19px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('练习分布', 24, ty);
    let tx = 24, tty = ty + 27;
    const typeMap = { exercise: '练习', flashcard: '闪卡', reading: '课文', review: '错题复习', hearChoose: '听选', hearSpell: '听拼', zhStudy: '认读/诵读', zhListenQuiz: '听音选字', zhMeaning: '释义理解', zhAuthor: '作者朝代', zhStroke: '笔画学习', zhFlashcard: '翻卡', zhListenChoose: '听音选字', zhPinyin: '拼音训练', zhBubble: '口诀背诵', zhSay: '组词造句', zhFly: '拍苍蝇', mathKnowledge: '知识点', mathExplain: '讲解', mathApply: '应用', mathMemorize: '口诀背诵', mathChallenge: '闯关挑战', mathQuiz: '练习', mathPattern: '数字规律', mathCompare: '对比辨析', mathWrongReview: '错题重练' };
    Object.keys(typeStats).forEach(t => {
      const ts = typeStats[t];
      ctx.fillStyle = '#546E7A';
      ctx.font = '16px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText((typeMap[t] || t) + '×' + ts.count + ' ' + ts.min + '分', tx, tty);
      tx += 195;
      if (tx > 450) { tx = 24; tty += 24; }
    });

    const dy = tty + 36;
    ctx.fillStyle = '#37474F';
    ctx.font = 'bold 19px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('每日学习（近7天）', 24, dy);
    let dty = dy + 24;
    dailyKeys.forEach(dk => {
      const mins = dailyMap[dk];
      const barW = Math.min(270, Math.max(15, mins * 6));
      ctx.fillStyle = '#ECEFF1';
      roundRect(ctx, 150, dty - 13, 285, 21, 10);
      ctx.fill();
      ctx.fillStyle = '#00BFA5';
      roundRect(ctx, 150, dty - 13, barW, 21, 10);
      ctx.fill();
      ctx.fillStyle = '#546E7A';
      ctx.font = '15px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(dk, 144, dty + 4);
      ctx.textAlign = 'left';
      ctx.fillText(mins + '分钟', 150 + barW + 6, dty + 4);
      dty += 27;
    });

    const by = canvas.height - 45;
    ctx.fillStyle = '#607D8B';
    ctx.font = '15px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('智能学习系统 · 小学阶段  |  PJ 培基家园', 300, by);

    const img = canvas.toDataURL('image/png');
    var shareBlob = (function(d) {
      var p = d.split(','), m = p[0].match(/:(.*?);/)[1], b = atob(p[1]), n = b.length, u = new Uint8Array(n);
      while (n--) u[n] = b.charCodeAt(n);
      return new Blob([u], { type: m });
    })(img);
    var fileName = name + '_学情报告.png';
    var preview = previewDiv || document.getElementById('share-img-preview');
    if (!preview) return;
    preview.innerHTML = '<a class="share-img-link" href="' + shareUrl + '" download="' + fileName + '" style="display:block;text-decoration:none"><img src="' + img + '" style="max-width:100%;border-radius:12px;box-shadow:var(--shadow);display:block"></a>' + (noWechatShare ? '' : '<div style="text-align:center;margin-top:8px"><button class="share-share-btn" style="padding:10px 24px;border:none;border-radius:10px;background:#07C160;color:#fff;font-size:15px;cursor:pointer">分享到微信</button></div>') + '<p id="share-status" style="margin:6px;font-size:12px;color:var(--text-light)"></p>';
    var statusEl = preview.querySelector('#share-status');
    var st = function(t) { if (statusEl) { try { statusEl.textContent = t; } catch(e) {} } };
    var shareUrl = URL.createObjectURL(shareBlob);

    function doShare() {
      if (window.AndroidShare && window.AndroidShare.saveAndShareImage) {
        try { window.AndroidShare.saveAndShareImage(img, fileName); } catch(e) {}
        return;
      }
      try {
        var f = new File([shareBlob], fileName, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [f] })) { st(''); navigator.share({ files: [f], title: fileName }).catch(function(){}); return; }
      } catch(e) {}
      try {
        if (navigator.share) { st(''); navigator.share({ title: fileName }).catch(function(){}); return; }
      } catch(e) {}
      try {
        var a = document.createElement('a'); a.href = shareUrl; a.download = fileName;
        document.body.appendChild(a); a.click();
        setTimeout(function() { try { document.body.removeChild(a); URL.revokeObjectURL(shareUrl); } catch(e) {} }, 300);
        st('已尝试下载，请到"下载"文件夹找到图片后分享到微信');
      } catch(e) {
        st('请点击上方图片下载，再分享到微信');
      }
    }

    if (!noWechatShare) {
      preview.addEventListener('click', function(e) {
        var t = e.target.closest('button');
        if (!t || !t.classList.contains('share-share-btn')) return;
        doShare();
      });

      setTimeout(function() { doShare(); }, 600);
    }

    function roundRect(c, x, y, w, h, r) {
      c.beginPath();
      c.moveTo(x + r, y);
      c.lineTo(x + w - r, y);
      c.arcTo(x + w, y, x + w, y + r, r);
      c.lineTo(x + w, y + h - r);
      c.arcTo(x + w, y + h, x + w - r, y + h, r);
      c.lineTo(x + r, y + h);
      c.arcTo(x, y + h, x, y + h - r, r);
      c.lineTo(x, y + r);
      c.arcTo(x, y, x + r, y, r);
      c.closePath();
    }
  },

  renderLogin() {
    this.currentView = 'login';
    var tb = document.querySelector('.top-bar');
    if (tb) tb.style.display = 'none';
    var bn = document.querySelector('.bottom-nav');
    if (bn) bn.style.display = 'none';
    var main = document.getElementById('main-content');
    var html = '';
    html += '<div class="login-watermark" id="login-watermark"></div>';
    setTimeout(function() {
      var wm = document.getElementById('login-watermark');
      if (!wm) return;
      var vw = window.innerWidth, vh = window.innerHeight;
      var fs = Math.max(14, Math.min(28, vw / 14));
      wm.style.fontSize = fs + 'px';
      var probe = document.createElement('span');
      probe.textContent = 'PJ培基家园';
      probe.style.cssText = 'position:fixed;visibility:hidden;white-space:nowrap;font-weight:900;font-size:' + fs + 'px;font-family:"FZHei-B01S","方正黑体","PingFang SC","Microsoft YaHei",sans-serif;';
      document.body.appendChild(probe);
      var spanW = probe.offsetWidth;
      document.body.removeChild(probe);
      var gap = Math.max(6, fs * 0.7);
      wm.style.gap = gap + 'px';
      var padX = vw / 50, padY = vh / 25;
      var cols = Math.max(1, Math.floor((vw - padX * 2 + gap) / (spanW + gap)));
      var rows = Math.ceil((vh - padY * 2) / (fs * 1.6 + gap)) + 1;
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var s = document.createElement('span');
          s.textContent = 'PJ培基家园';
          wm.appendChild(s);
        }
      }
    }, 0);
    html += '<div class="login-container">';
if (this._apkVersion) {
      html += '<div style="background:#FFF8E1;color:#8D6E63;border:1px solid #FFE082;border-radius:10px;padding:10px 14px;margin:8px 16px;font-size:13px;text-align:center">📦 检测到新版 App 安装包（' + this._h(this._apkVersion) + '）<br><span style="font-size:12px">点击下方"📦 下载并安装新版 App"按钮即可在线更新，无需浏览器下载</span></div>';
    }
    var restoredCount = Storage.getRestoredStudentCount();
    var restoredOk = false;
    try { restoredOk = localStorage.getItem('vocab_backup_restored_ok') === '1'; } catch(e) {}
    if (restoredCount > 0 && !restoredOk) {
      html += '<div class="login-restore-notice" style="background:#E8F5E9;color:#2E7D32;border:1px solid #A5D6A7;border-radius:10px;padding:10px 14px;margin:8px 16px;font-size:13px;text-align:center">✅ 已恢复 ' + restoredCount + ' 名学员的学习资料</div>';
    }
    if (Storage.getStudents().length === 0) {
    }
    html += '<div class="login-header">';
    html += '<div class="login-logo"><span class="logo-pj">PJ</span><span class="logo-sub">培基家园</span></div>';
    html += '</div>';
html += '<h1 class="login-title" id="login-title-tts"><span>培</span><span>基</span><span>智</span><span>多</span><span>星</span></h1>';
    html += '<p class="login-sub">智能学习系统 · 小学阶段</p>';
    html += '<h3 class="login-section-title">学员登录</h3>';
    html += '<div class="login-form">';
    html += '<input type="text" class="login-input" id="login-name" placeholder="请输入姓名" maxlength="12" autocomplete="off">';
    html += '<button class="login-btn" id="login-btn">登 录</button>';
    html += '<div class="login-error" id="login-error"></div>';
    html += '</div>';
    html += '<div class="login-divider"><span>后台管理</span></div>';
    html += '<div class="login-form">';
    html += '<input type="password" class="login-input" id="admin-password" placeholder="管理员密码" maxlength="20" enterkeyhint="go">';
    html += '<button class="admin-btn" id="admin-btn" style="background:#1565C0">🔧 管理后台</button>';
    html += '<div class="login-error" id="admin-error"></div>';
    html += '</div>';
    html += '<div class="login-divider"><span>系统更新</span></div>';
    html += '<div class="login-form">';
    html += '<button class="admin-btn" id="login-upd-btn" style="background:#B08968">🔄 检查更新</button>';
    html += '<button class="login-btn" id="login-apk-btn" style="display:none;background:#1565C0">📦 下载并安装新版 App</button>';
    html += '<div id="upd-log" style="font-size:11px;color:var(--text-light);margin-top:6px;line-height:1.5;word-break:break-all"></div>';
    html += '</div>';
    try { html += '<div style="text-align:center;font-size:11px;color:#B0BEC5;margin-bottom:6px">本机 ' + (window.__BUILTIN_VER || window.__SERVER_VER || '?') + ' ｜ 电脑 <span id="pc-ver-line">--</span></div>'; } catch (e) {}
    html += '<div style="text-align:center;margin:2px 0 14px"><button class="quit-btn" id="login-exit-btn" style="background:transparent;border-color:#BDBDBD;color:#444;max-width:160px">✕ 退出</button></div>';
    html += '</div>';
    main.innerHTML = html;
    this._bindTtsDiag(document.getElementById('login-title-tts'));
    this._loginBind();
    var updBtn = document.getElementById('login-upd-btn');
    if (updBtn) updBtn.addEventListener('click', function() {
      var log = document.getElementById('upd-log');
      if (log) log.innerHTML = '';
      App._checkJsUpdate(0);
    });
    var apkBtn = document.getElementById('login-apk-btn');
    if (apkBtn && this._apkVersion) apkBtn.style.display = '';
    if (apkBtn) apkBtn.addEventListener('click', function() { App._downloadApk(); });
    var bindBtn = function(id, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', function() { try { fn(); } catch(e) {} });
    };
    bindBtn('login-btn', function() { App._loginBtn(); });
    bindBtn('admin-btn', function() { App._adminBtn(); });
    bindBtn('unlock-btn', function() { App._activate(); });
    bindBtn('login-exit-btn', function() { App._exitApp(); });
    try {
      var pcHost = this._getSavedHost();
      if (pcHost) {
        fetch('http://' + pcHost + ':8899/check', { cache: 'no-store' })
          .then(function(r) { return r.json(); })
          .then(function(v) {
            var el = document.getElementById('pc-ver-line');
            if (el) {
              var pcVer = (v.appjs && v.appjs.version) || '?';
              el.textContent = pcVer;
              var localVer = window.__BUILTIN_VER || window.__SERVER_VER || '';
              el.style.color = (pcVer === localVer) ? '#2E7D32' : '#C62828';
            }
          })
          .catch(function() {
            var el = document.getElementById('pc-ver-line');
            if (el) el.textContent = '连不上';
          });
      }
    } catch (e) {}
  },

  _exitApp() {
    try { Storage.flushBackup(); } catch (e) {}
    try { window.AndroidBackup.exitApp(); } catch (e) {}
  },

  _openAllFiles() {
    var st = document.getElementById('restore-status');
    if (st) st.textContent = '请在设置页打开"允许访问所有文件"开关，然后返回本应用';
    try { window.AndroidBackup.openAllFilesSettings(); } catch(e) {}
  },

  _loginBind() {
    var main = document.getElementById('main-content');
    if (!main || main._loginHooked) return;
    main._loginHooked = true;
    main.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      var id = e.target.id;
      if (id === 'admin-password') { var b = document.getElementById('admin-btn'); if (b) b.click(); }
      else if (id === 'login-name') { var b = document.getElementById('login-btn'); if (b) b.click(); }
    });
  },

  _loginBtn() {
    try {
      var name = document.getElementById('login-name').value.trim();
      console.log('_loginBtn: name="' + name + '"');
      if (!name) { document.getElementById('login-error').textContent = '请输入姓名'; return; }
      var student = Storage.findStudent(name);
      console.log('_loginBtn: student=' + (student ? student.id + ' ' + student.name : 'null'));
      if (student) {
        this.loginStudent(student.id);
        return;
      }
      var errEl = document.getElementById('login-error');
      if (errEl) errEl.textContent = '本机未注册，正在查询其他平板已注册学员...';
      var self = this;
      this._fetchAllStudents().then(function (all) {
        var remote = (all || []).find(function (s) { return s.remote && s.name === name; });
        if (remote) {
          if (errEl) errEl.textContent = '已在其他平板注册（' + remote.grade + '年级），本机自动建档登录...';
          var created = Storage.addStudent(name, remote.grade);
          if (created) {
            self._pushStudentsToHost();
            self.loginStudent(created.id);
          } else {
            var again = Storage.findStudent(name);
            if (again) { self.loginStudent(again.id); return; }
            if (errEl) errEl.textContent = '本机建档失败，请重试';
          }
        } else {
          if (errEl) errEl.textContent = '未找到该学员：本机与其他平板均无此人，请先注册';
        }
      }).catch(function () {
        if (errEl) errEl.textContent = '查询其他平板失败：请确认电脑端"错题接收发送器"已启动、与本平板同一 WiFi，且管理后台"本机负责年级"下方已填写电脑 IP；或先在本机注册';
      });
    } catch(e) {
      console.error('_loginBtn error:', e);
      document.getElementById('login-error').textContent = '错误: ' + (e.message || e);
    }
  },

  _regBtn() {
    try {
      var name = document.getElementById('reg-name').value.trim();
      var grade = parseInt(document.getElementById('reg-grade').value) || 1;
      console.log('_regBtn: name="' + name + '" grade=' + grade);
      if (!name) { document.getElementById('reg-error').textContent = '请输入姓名'; return; }
      if (Storage.findStudent(name)) {
        document.getElementById('reg-error').textContent = '该姓名已注册';
        return;
      }
      var student = Storage.addStudent(name, grade);
      console.log('_regBtn: addStudent returned ' + (student ? student.id + ' ' + student.name : 'null'));
      if (student) {
        this._pushStudentsToHost();
        document.getElementById('reg-error').textContent = '';
        var ok = document.getElementById('reg-ok');
        if (ok) ok.textContent = '✓ 已注册：' + name + '（' + grade + '年级），请在登录页登录';
        document.getElementById('reg-name').value = '';
      } else {
        document.getElementById('reg-error').textContent = '注册失败，请重试';
      }
    } catch(e) {
      console.error('_regBtn error:', e);
      document.getElementById('reg-error').textContent = '错误: ' + (e.message || e);
    }
  },

  _adminBtn() {
    try {
      var pw = document.getElementById('admin-password');
      if (!pw) { document.getElementById('admin-error').textContent = '页面未加载完成'; return; }
      var val = pw.value.trim();
var SUPER_PW = 'pj889988';
      if (val === Storage.getAdminPassword() || val === SUPER_PW) {
        this._adminTier = (val === SUPER_PW) ? 'super' : 'normal';
        if (this._adminTier === 'normal') {
          try {
            var gs = Storage.getAdminGrades();
            if (gs.length !== 1) {
              Storage.setAdminGrades(gs.length ? [gs[0]] : ['1']);
            }
          } catch (e) {}
        }
        Storage.logout();
        this.currentStudent = null;
        this.isAdminMode = true;
        this.currentView = 'admin';
        this.renderAdminDashboard();
} else {
        var ae = document.getElementById('admin-error');
        if (ae) ae.textContent = '密码错误';
      }
    } catch(e) {
      var el = document.getElementById('admin-error');
      if (el) el.textContent = '错误: ' + (e.message || e);
    }
  },

  setView(view) {
    this.currentView = view;
    var map = { grade: 'nav-course', review: 'nav-review', report: 'nav-report', stats: 'nav-stats' };
    var navId = map[view] || 'nav-course';
    var btns = document.querySelectorAll('.nav-btn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
    var btn = document.getElementById(navId);
    if (btn) btn.classList.add('active');
  },

  _buildIndex() {
    this._unitIndex = {};
    const addDataSet = (data) => {
      if (!data || !data.grades) return;
      for (var gi = 0; gi < data.grades.length; gi++) {
        var g = data.grades[gi];
        for (var mi = 0; mi < g.modules.length; mi++) {
          var m = g.modules[mi];
          for (var ui = 0; ui < m.units.length; ui++) {
            var u = m.units[ui];
            this._unitIndex[u.id] = {
              words: u.words,
              unitTitle: u.title,
              gradeTitle: g.title,
              gradeIcon: g.icon,
              totalWords: (u.words || []).length
            };
          }
        }
      }
    };
    addDataSet(this.getCourseData());
    try { addDataSet(this._getSubjectData('chinese')); } catch (e) {}
    try { addDataSet(this._getSubjectData('math')); } catch (e) {}
  },

  getUnitInfo(unitId) {
    var info = this._unitIndex[unitId];
    return info || { gradeTitle: '', gradeIcon: '', unitTitle: '', totalWords: 0 };
  },

  _cleanupView() {
    this.stopSpeaking();
    this.stopRecognition();
    var self = this;
    var done = function() {
      self._audioSamples = [];
      self.readingPlaying = false;
      self.fcAutoPlaying = false;
      self._fcActive = false;
      if (self.activeSessionId) {
        const sessions = Storage.getSessions();
        const s = sessions.find(x => x.id === self.activeSessionId);
        if (s && !s.completed) {
          Storage.abortSession(self.activeSessionId);
        }
        self.activeSessionId = null;
      }
      if (self.fcAutoTimer) { clearTimeout(self.fcAutoTimer); self.fcAutoTimer = null; }
      if (self._fcRepTimer) { clearTimeout(self._fcRepTimer); self._fcRepTimer = null; }
      if (self._zhQuizTimer) { clearTimeout(self._zhQuizTimer); self._zhQuizTimer = null; }
      if (self._zhPyTimer) { clearTimeout(self._zhPyTimer); self._zhPyTimer = null; }
      if (self._zhListenAutoTimer) { clearTimeout(self._zhListenAutoTimer); self._zhListenAutoTimer = null; }
      if (self.zhFlyTimer) { clearInterval(self.zhFlyTimer); self.zhFlyTimer = null; }
      (self._exTimers || []).forEach(function(x){ try { clearTimeout(x); } catch(e) {} }); self._exTimers = [];
      if (self.readingTimer) { clearTimeout(self.readingTimer); self.readingTimer = null; }
      if (self.dcTimer) { clearTimeout(self.dcTimer); self.dcTimer = null; }
      if (self._dcFallback) { clearTimeout(self._dcFallback); self._dcFallback = null; }
      if (self._fcKeyHandler) { document.removeEventListener('keydown', self._fcKeyHandler); self._fcKeyHandler = null; }
    };
    try {
      var r = this.stopAudioRecording();
      if (r && typeof r.then === 'function') { r.then(done, done); } else { done(); }
    } catch (e) { done(); }
  },

  recognition: null,
  isRecognitionSupported: false,
  _recOnResult: null,
  _micStream: null,
  _audioCtx: null,
  _audioSource: null,
  _scriptNode: null,
  _audioSamples: [],
  _audioRecReady: null,

  checkRecognitionSupport() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.isRecognitionSupported = !!SR;
    return this.isRecognitionSupported;
  },

  _prewarmAudio() {
    try {
      if (this._audioPrewarmed) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
      this._audioPrewarmed = true;
      var self = this;
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(function(stream) {
          try { stream.getTracks().forEach(function(t) { t.stop(); }); } catch(e) {}
        })
        .catch(function() {});
      try {
        if (window.SpeechRecognition || window.webkitSpeechRecognition) this.isRecognitionSupported = true;
      } catch(e) {}
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC && !this._audioCtx && !this._playCtx) {
          try {
            this._playCtx = new AC();
            if (this._playCtx.state === 'suspended' && this._playCtx.resume) {
              var rp = this._playCtx.resume();
              if (rp && typeof rp.catch === 'function') rp.catch(function(){});
            }
          } catch(e) { this._playCtx = null; }
        }
      } catch(e) {}
    } catch(e) {}
  },

  startAudioRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this._recError = '浏览器不支持麦克风'; return false; }
    var self = this;
    var doStart = function() {
      self._audioSamples = [];
      self._recError = null;
      var promise = navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        self._recError = null;
        self._micStream = stream;
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        var readyCtx = (ctx.state === 'suspended' && ctx.resume) ? ctx.resume() : Promise.resolve();
        var readyP = Promise.resolve(readyCtx);
        var hangGuard = new Promise(function(res) { setTimeout(res, 1500); });
        self._audioCtx = ctx;
        return Promise.race([readyP, hangGuard]).then(function() {
          var source = ctx.createMediaStreamSource(stream);
          self._audioSource = source;
          var node = ctx.createScriptProcessor(4096, 1, 1);
          self._scriptNode = node;
          node.onaudioprocess = (e) => {
            if (self._audioSamples) self._audioSamples.push(new Float32Array(e.inputBuffer.getChannelData(0)));
          };
          source.connect(node);
          var mute = ctx.createGain();
          mute.gain.value = 0;
          node.connect(mute);
          mute.connect(ctx.destination);
        });
      }).catch(e => { self._recError = (e && e.message) || String(e); });
      self._audioRecReady = promise;
    };
    try {
      var r = this.stopAudioRecording();
      if (r && typeof r.then === 'function') { r.then(doStart, doStart); } else { doStart(); }
    } catch (e) { doStart(); }
    return true;
  },

  _beginFollowRecording(expectedText, onResult) {
    var self = this;
    try { this.startAudioRecording(); } catch(e) {}
    var fireRecognition = function() {
      try { self.startRecognition(expectedText, onResult); } catch(e) {
        if (onResult) onResult({ supported: true, error: '语音识别启动失败', interim: false });
      }
    };
    var ready = this._audioRecReady;
    var waited = 0;
    var waitMic = function() {
      if (self._micStream) { fireRecognition(); return; }
      waited++;
      if (waited > 30) { fireRecognition(); return; }
      setTimeout(waitMic, 100);
    };
    setTimeout(waitMic, 50);
  },

  stopAudioRecording() {
    var ready = this._audioRecReady || Promise.resolve();
    this._audioRecReady = null;
    var self = this;
    var wait = ready && typeof ready.then === 'function' ? ready : Promise.resolve();
    return wait.then(function() {
      var ctx = self._audioCtx, stream = self._micStream, samples = self._audioSamples || [];
      self._audioCtx = null; self._audioSource = null; self._scriptNode = null; self._audioSamples = [];
      if (stream) { try { stream.getTracks().forEach(function(t) { t.stop(); }); } catch(e) {} self._micStream = null; }
      if (!ctx || samples.length === 0) return null;
      var build = function() {
        var sr = ctx.sampleRate || 44100;
        var totalLen = 0, i;
        for (i = 0; i < samples.length; i++) totalLen += samples[i].length;
        var allSamples = new Float32Array(totalLen), offset = 0;
        for (i = 0; i < samples.length; i++) { allSamples.set(samples[i], offset); offset += samples[i].length; }
        self._lastRecAudio = { samples: allSamples, sampleRate: sr, url: null };
        var num = allSamples.length;
        var buf = new ArrayBuffer(44 + num * 2);
        var dv = new DataView(buf);
        function ws(o, s) { for (var j = 0; j < s.length; j++) dv.setUint8(o + j, s.charCodeAt(j)); }
        ws(0, 'RIFF'); dv.setUint32(4, 36 + num * 2, true); ws(8, 'WAVE');
        ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
        dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
        ws(36, 'data'); dv.setUint32(40, num * 2, true);
        for (i = 0; i < num; i++) { var s = Math.max(-1, Math.min(1, allSamples[i])); dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true); }
        var url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
        self._lastRecAudio.url = url;
        return url;
      };
      try {
        var closeP = ctx.close();
        if (closeP && typeof closeP.then === 'function') {
          var closeGuard = new Promise(function(res) { setTimeout(res, 1000); });
          return Promise.race([Promise.resolve(closeP), closeGuard]).then(build, build);
        }
        return build();
      } catch (e) { return build(); }
    }).catch(function() { return null; });
  },

  startRecognition(expectedText, onResult) {
    this.checkRecognitionSupport();
    if (!this.isRecognitionSupported) {
      if (onResult) onResult({ supported: false, error: '浏览器不支持语音识别' });
      return false;
    }
    this.stopSpeaking();
    this.stopRecognition();

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (onResult) onResult({ supported: false, error: '浏览器不支持语音识别' });
      return false;
    }
    try {
      this.recognition = new SpeechRecognition();
    } catch (e) {
      if (onResult) onResult({ supported: false, error: '语音识别初始化失败' });
      return false;
    }
    this.recognition.lang = 'en-US';
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 3;
    this._recOnResult = onResult;

    this.recognition.onresult = (event) => {
      const results = [];
      for (let i = 0; i < event.results.length; i++) {
        results.push({
          transcript: event.results[i][0].transcript.trim(),
          confidence: event.results[i][0].confidence,
          isFinal: event.results[i].isFinal
        });
      }
      const last = results[results.length - 1];
      if (last && last.isFinal) {
        const comparison = this.compareText(expectedText, last.transcript);
        if (onResult) {
        var r0 = { supported: true, result: last.transcript, interim: false };
        for (var _k in comparison) r0[_k] = comparison[_k];
        onResult(r0);
      }
        this.stopRecognition();
      } else if (last) {
        if (onResult) onResult({ supported: true, result: last.transcript, interim: true });
      }
    };

    this.recognition.onerror = (event) => {
      if (event.error === 'no-speech') return;
      if (onResult) onResult({ supported: true, error: event.error, interim: false });
      this.stopRecognition();
    };

    this.recognition.onend = () => { this.recognition = null; };

    try {
      this.recognition.start();
      return true;
    } catch (e) {
      if (onResult) onResult({ supported: true, error: e.message || '启动失败' });
      return false;
    }
  },

  stopRecognition() {
    if (this.recognition) {
      try { this.recognition.stop(); } catch (e) {}
      this.recognition = null;
    }
  },

  compareText(expected, actual) {
    const clean = (s) => s.toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ').trim();
    const expClean = clean(expected);
    const actClean = clean(actual);

    const expWords = expClean.split(' ');
    const actWords = actClean.split(' ');

    let matched = 0;
    const wordResults = expWords.map((ew, i) => {
      const aw = actWords[i] || '';
      const isMatch = ew === aw || (ew.length > 2 && aw.length > 2 && this.levenshteinRatio(ew, aw) > 0.7);
      if (isMatch) matched++;
      return { expected: ew, actual: aw, match: isMatch };
    });

    const accuracy = expWords.length > 0 ? Math.round((matched / expWords.length) * 100) : 0;
    const perfect = matched === expWords.length;

    return { accuracy, perfect, expClean, actClean, wordResults };
  },

  levenshteinRatio(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n === 0 ? 1 : 0;
    if (n === 0) return 0;
    const dp = [];
    for (let i = 0; i <= m; i++) { dp[i] = [i]; }
    for (let j = 0; j <= n; j++) { dp[0][j] = j; }
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    const maxLen = Math.max(m, n);
    return maxLen === 0 ? 1 : 1 - dp[m][n] / maxLen;
  },

  updateTopBar() {
    document.getElementById('score-display').textContent = '⚡ ' + (this.progress.totalXP || 0);
    document.getElementById('streak-count').textContent = this.progress.streak || 0;
    document.getElementById('heart-count').textContent = this.hearts;
    document.getElementById('level-badge').textContent = this.progress.level || 1;
    if (this.currentStudent) {
      const grade = Storage.getCurrentGrade(this.currentStudent);
      document.getElementById('student-name').textContent = this.currentStudent.name + ' · ' + grade + '年级';
      document.getElementById('student-name').style.display = '';
    }
  },

  renderGrades() {
    document.querySelector('.top-bar').style.display = 'flex';
    document.querySelector('.bottom-nav').style.display = 'flex';
    this._cleanupView();
    this.setView('grade');
    this.navStack = [];
    const main = document.getElementById('main-content');
    const progress = this.progress;
    const sd = this._getSubjectData(this.currentSubject);
    const data = sd || this.getCourseData();

    let html = '<div class="course-container">';
    html += '<button class="back-btn" onclick="App._cleanupView();App.renderSubjectSelector()">← 返回上一级</button>';
    html += '<h2 class="course-title">' + (data.title || this._subjectName() + '课程') + '</h2>';
    html += '<div class="grade-list">';

    data.grades.forEach(g => {
      let completedUnits = 0;
      let totalUnits = 0;
      g.modules.forEach(m => {
        m.units.forEach(u => {
          totalUnits++;
          if (progress.completedLessons[u.id]) completedUnits++;
        });
      });
      const pct = totalUnits > 0 ? Math.round((completedUnits / totalUnits) * 100) : 0;

      html += `
        <div class="grade-card" data-gid="${g.id}" style="border-left: 4px solid ${g.color}">
          <div class="grade-icon">${g.icon}</div>
          <div class="grade-info">
            <div class="grade-title">${g.title}</div>
            <div class="grade-subtitle">${g.subtitle || this._subjEdition(this.currentSubject)} · ${this._subjectName()}</div>
            <div class="grade-bar"><div class="grade-bar-fill" style="width:${pct}%;background:${g.color}"></div></div>
            <div class="grade-progress-text">${completedUnits}/${totalUnits} 课完成</div>
          </div>
          <div class="grade-arrow">▶</div>
        </div>`;
    });

    html += '</div></div>';
    main.innerHTML = html;

    document.querySelectorAll('.grade-card').forEach(card => {
      card.addEventListener('click', () => {
        const gid = card.dataset.gid;
        const grade = data.grades.find(g => String(g.id) === gid);
        if (grade) this.openGrade(grade);
      });
    });
  },

  _subjEdition(subject) {
    if (subject === 'chinese') return '部编版';
    if (subject === 'math') return '人教版';
    return '广州教科版';
  },

  openGrade(grade) {
    this.currentGradeId = grade.id;
    this.navStack = ['grade'];
    this.setView('grade');
    this.renderAllUnits(grade);
  },

  renderAllUnits(grade) {
    const main = document.getElementById('main-content');
    const progress = this.progress;

    let html = '<div class="unit-container">';
    html += '<button class="back-btn" onclick="App.goBack()">← 返回上一级</button>';
    html += '<h2 class="unit-header">' + grade.icon + ' ' + grade.title + '</h2>';
    html += '<div class="unit-list">';

    let unitIdx = 0;
    grade.modules.forEach(m => {
      m.units.forEach((unit, idx) => {
        unitIdx++;
        const stars = progress.lessonStars[unit.id] || 0;
        const completed = progress.completedLessons[unit.id];
        const starStr = completed ? '⭐'.repeat(stars) + '☆'.repeat(3 - stars) : '☆☆☆';
        const completedCls = completed ? ' completed' : '';
        const hasPassage = true;
        const zhKind = this._zhUnitKind(unit);
        const isZh = zhKind !== 'en';
        const wcLabel = isZh ? unit.words.length + ' 个学习内容' : unit.words.length + ' 个单词';
        let btns = '';
        if (zhKind === 'poem') {
          btns = `
              <button class="unit-flashcard-btn" data-uid="${unit.id}" data-zhact="study">📜 诵读</button>
              <button class="unit-passage-btn" data-uid="${unit.id}" data-zhact="fill">🧩 接句</button>
              <button class="unit-hear-choose-btn" data-uid="${unit.id}" data-zhact="author">🏛 作者</button>
              <button class="unit-start-btn" data-uid="${unit.id}">练习</button>`;
        } else if (zhKind === 'word') {
          btns = `
              <button class="unit-flashcard-btn" data-uid="${unit.id}" data-zhact="study">📖 认读</button>
              <button class="unit-passage-btn" data-uid="${unit.id}" data-zhact="meaning">🎯 释义理解</button>
              <button class="unit-start-btn" data-uid="${unit.id}">练习</button>`;
        } else if (zhKind === 'zi') {
          btns = `
              <button class="unit-flashcard-btn" data-uid="${unit.id}" data-zhact="study">📖 认读</button>
              <button class="unit-hear-choose-btn" data-uid="${unit.id}" data-zhact="listen">🎧 听音选字</button>
              <button class="unit-start-btn" data-uid="${unit.id}">练习</button>`;
        } else if (this.currentSubject === 'math') {
          btns = `
              <button class="unit-math-btn" data-uid="${unit.id}" data-mmode="knowledge">📝 知识点</button>
              <button class="unit-math-btn" data-uid="${unit.id}" data-mmode="explain">📖 讲解</button>
              <button class="unit-math-btn" data-uid="${unit.id}" data-mmode="apply">🏠 应用</button>
              <button class="unit-math-btn" data-uid="${unit.id}" data-mmode="practice">✏️ 练习</button>`;
        } else {
          btns = `
              <button class="unit-flashcard-btn" data-uid="${unit.id}">🃏 闪卡</button>
              <button class="unit-passage-btn" data-uid="${unit.id}">📖 课文</button>
              <button class="unit-hear-choose-btn" data-uid="${unit.id}">🎧 听选</button>
              <button class="unit-hear-spell-btn" data-uid="${unit.id}">🎤 听拼</button>
              <button class="unit-game-btn" data-uid="${unit.id}">🎮 消消乐</button>
              <button class="unit-start-btn" data-uid="${unit.id}">练习</button>`;
        }

        html += `
          <div class="unit-item${completedCls}">
            <div class="unit-num">${unitIdx}</div>
            <div class="unit-detail">
              <div class="unit-name">${unit.title}</div>
              <div class="unit-word-count">${wcLabel}</div>
              <div class="unit-stars-display">${starStr}</div>
            </div>
            <div class="unit-btns">
              ${btns}
            </div>
          </div>`;
      });
    });

    html += '</div></div>';
    main.innerHTML = html;

    document.querySelectorAll('.unit-start-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = parseInt(btn.dataset.uid);
        this.currentUnitId = uid;
        this.startLesson(uid);
      });
    });

    document.querySelectorAll('.unit-passage-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = parseInt(btn.dataset.uid);
        this.currentUnitId = uid;
        const act = btn.dataset.zhact;
        if (act === 'meaning') { this.renderZhMeaningPractice(uid); return; }
        if (act === 'fill') { this.startZhPoemFill(uid); return; }
        if (act === 'stroke') { this.renderZhStroke(uid); return; }
        this.renderReading(uid);
      });
    });

    document.querySelectorAll('.unit-flashcard-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = parseInt(btn.dataset.uid);
        this.currentUnitId = uid;
        const act = btn.dataset.zhact;
        if (act === 'study') { this.renderZhStudy(uid); return; }
        this.renderFlashcards(uid);
      });
    });

    document.querySelectorAll('.unit-hear-choose-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = parseInt(btn.dataset.uid);
        this.currentUnitId = uid;
        const act = btn.dataset.zhact;
        if (act === 'listen') { this.startZhListenQuiz(uid); return; }
        if (act === 'author') { this.startZhPoemAuthor(uid); return; }
        this.startSingleType(uid, 'hearChoose', '🎧 听读选词');
      });
    });

    document.querySelectorAll('.unit-hear-spell-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = parseInt(btn.dataset.uid);
        this.currentUnitId = uid;
        this.startSingleType(uid, 'hearSpell', '🎤 听读拼词');
      });
    });

    document.querySelectorAll('.unit-game-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = parseInt(btn.dataset.uid);
        this.currentUnitId = uid;
        this.startMatchGame(uid);
      });
    });

    document.querySelectorAll('.unit-math-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = parseInt(btn.dataset.uid);
        const mode = btn.dataset.mmode;
        this.currentUnitId = uid;
        if (mode === 'knowledge') { this.renderMathKnowledge(uid); }
        else if (mode === 'explain') { this.renderMathExplain(uid); }
        else if (mode === 'apply') { this.renderMathApply(uid); }
        else if (mode === 'practice') { this.startMathLesson(uid); }
      });
    });
  },

  _zhUnitKind(unit) {
    const words = (unit && unit.words) || [];
    const w0 = words[0];
    if (!w0 || w0.zi === undefined) return 'en';
    if (w0.pinyin && String(w0.pinyin).indexOf('·') >= 0 && String(w0.zi).length <= 8) return 'poem';
    if (String(w0.zi).length === 1) return 'zi';
    return 'word';
  },

  _zhInfo(uid) {
    const ui = this.getUnitInfo(uid);
    return {
      unitId: uid,
      unitTitle: ui.unitTitle || '',
      gradeTitle: ui.gradeTitle || '',
      words: this.getUnitWords(uid) || []
    };
  },

  _zhAddWrong(w, info) {
    try {
      Storage.addWrongWord(String(w.zi || ''), String(w.yi || w.pinyin || ''), info.unitId, info.unitTitle, 'chinese');
    } catch (e) {}
  },

  _zhSpeak(text, onEnd, opts) {
    this._ttsSpeak({ text: text, language: 'zh-CN', volume: 1, onEnd: onEnd, preventDedup: !!(opts && opts.preventDedup) });
  },

  // 教学发音：先读汉字 → 再读拼音 → 最后"汉字+拼音"整体（每段之间停顿 450ms）
  // 注（1655 定案）：拼音音节优先走本地带调声道（sounds/pinyin/N.ogg，Edge TTS 真人神经网络生成，
  //   带调 xǐ 正确；2366 定案曾走有道：带调 500/剥调 200 但丢声调），失败回退剥调有道真人音
  _zhStripTone(s) {
    return String(s || '').replace(/[āáǎà]/g, 'a').replace(/[ēéěè]/g, 'e').replace(/[īíǐì]/g, 'i')
      .replace(/[ōóǒò]/g, 'o').replace(/[ūúǔù]/g, 'u').replace(/[ǖǘǚǜ]/g, 'ü');
  },

  // 英语课文整句本地索引（954句，Edge TTS 生成，见 syntax_test/sentence_test.html）
  _enIdx: {"A bad day becomes good with a true friend.":1,"A big storm is coming. Stay at home.":2,"A bird can fly in the sky.":3,"A bird can fly. I cannot fly.":4,"A birthday cake for you!":5,"A birthday cake for you! Happy birthday!":6,"A blue whale lives in the sea.":7,"A cat has four legs.":8,"A clever boy helped the king.":9,"A clever fox can solve problems.":10,"A country life is a healthy life!":11,"A dog has four legs.":12,"A fish can swim. I can swim too.":13,"A foolish man lost everything.":14,"A good habit makes you healthy.":15,"A hare crashes into a tree and dies.":16,"A hen lays eggs on the farm.":17,"A little mouse helped the big lion.":18,"A phone call brings us closer.":19,"A policeman is brave. A fireman is brave too.":20,"A polite word makes everyone happy.":21,"A rainbow has many colours.":22,"A short rabbit has long ears.":23,"A small bird is singing in the tree.":24,"A tall giraffe can eat leaves.":25,"A white rabbit is so cute.":26,"A white sheep is on the grass.":27,"A yellow banana is sweet.":28,"After dinner, I do my homework and watch TV.":29,"After school, I play the piano.":30,"After the typhoon, we help clean up.":31,"Air pollution is bad for our health.":32,"An astronaut goes to space by rocket.":33,"An elephant has a very long nose.":34,"An elephant is very heavy.":35,"An orange a day keeps the doctor away.":36,"An orange orange is on the table.":37,"Apple juice, please. Thank you.":38,"Art is fun. I can draw pictures.":39,"Ask questions and try your best.":40,"At night, fireworks light up the sky.":41,"At nine ten, I do my homework.":42,"At seven forty, I have breakfast.":43,"Autumn is cool. Leaves fall down.":44,"Autumn is cool. The leaves are beautiful.":45,"Be careful and we stay safe.":46,"Be careful when you cross the road.":47,"Be confident! I wish you success!":48,"Be quiet in Chinese class.":49,"Bees are busy in the garden.":50,"Being a good listener is important.":51,"Being polite is a good habit.":52,"Ben is excited about his first trip to Beijing.":53,"Ben tries Beijing duck. It is delicious!":54,"Best wishes to you and your family!":55,"Birds can fly, but I cannot fly.":56,"Birds come to my feeder every morning!":57,"Blue shorts are good for summer.":58,"Bread and milk is a good breakfast.":59,"Brush your teeth every morning and night.":60,"But I am not afraid. I love the city life!":61,"But I was a little fat because I surfed the Internet too long.":62,"But the past is past. Today is a new day!":63,"By train, the trip is a real pleasure.":64,"Bye, Mr Chen. Have a nice day!":65,"Bye-bye, Amy!":66,"Camping is a great review of our year!":67,"Can I have a banana? Here you are.":68,"Can you ride a bike? Yes, I can.":69,"Children get lucky money. So lucky!":71,"China has many festivals besides the Spring Festival.":72,"China is a big country. I love my country.":73,"Chinese is interesting. I love reading.":74,"Chocolate is my favourite snack.":75,"Chunks make my English better.":76,"Clap your hands! One, two, three!":77,"Clean air and water are important.":78,"Clean your ears, please.":79,"Close the door, please. It is cold.":80,"Close the door. Open the window.":81,"Come and play with me!":82,"Come and play! Do you want to join us?":83,"Come here, please. Stand here.":84,"Correct your answers and improve.":85,"Could you pass me the soup, please?":86,"Count them all, please!":87,"Cross the bridge to the small island.":88,"Cross the road at the crossing.":89,"Dad tells jokes and we all laugh.":90,"Day after day, nothing comes. He wastes his time.":91,"Deng Jiaxian is a great scientist of our country.":92,"Different food is good for your body.":93,"Dinner is ready at six. I eat with my family.":94,"Dinner is ready. Help yourself!":96,"Do exercise every day to keep healthy.":97,"Do not be silly and careless like the hare.":98,"Do not buy things made from animals.":99,"Do not play on the road or the railway.":100,"Do not run on the wet floor. Oops!":101,"Do not wait for luck. Work hard for your field!":102,"Do you know how to stay safe?":103,"Do you know the secret to good health?":104,"Do you like meat? Yes, I like fish too.":105,"Do you like watermelon? Yes, I do.":106,"Do you want to try a penalty kick?":107,"Doing chores is my job too.":108,"Donald Duck waves to us. So funny!":110,"Dr Sun Yatsen is a famous person in Chinese history.":111,"Drink some water after you run.":112,"Drink water and do exercise every day.":113,"Eat a good breakfast. It is important.":114,"Eat healthy food every day.":115,"Eat more salad and drink some hot soup.":116,"Eat vegetables and fruit at least twice a day.":117,"Enjoy your holiday! Have a good time!":118,"Every child has a hobby. What is yours?":119,"Every country dreams of the stars.":120,"Everyone can be busy as a bee!":121,"Everyone has a good time in Hainan!":122,"Everyone has abilities. What can you do?":123,"Everyone says my cooking is great.":124,"Everything is fine in my home.":125,"Excuse me, can you tell me the way?":126,"Excuse me, where is the hospital?":127,"Exercise makes me strong and happy.":128,"First, I draw a plan on paper.":129,"Follow the rules and we all have fun.":130,"Follow the safety rules and you will be fine.":131,"Follow the school rules every day.":132,"Get up early and go to bed early.":133,"Go straight and turn left at the corner.":134,"Go straight and turn left. The library is there.":135,"Go straight and turn right at the corner.":136,"Good afternoon, teacher!":137,"Good evening, Dad!":138,"Good health is very important.":139,"Good manners make a better world.":140,"Good morning, Mum!":141,"Good night! See you in the morning.":142,"Good night, baby!":143,"Goodbye, Ms White. See you tomorrow.":144,"Goodbye, Tom!":145,"Goodbye, my dear classmates. Thank you.":146,"Goodbye, my dear school. I will miss you.":147,"Grandma calls me on Sunday.":148,"Grapes are small and sweet.":149,"Green leaves come out in spring.":151,"Green trees are everywhere in spring.":152,"Guangzhou is a big and modern city.":153,"Hang the stocking on the bed.":154,"Happy Spring Festival! We eat dumplings.":155,"He became a professor in a famous university.":156,"He brought a gift to his friend.":157,"He can jump far and high.":158,"He can jump high. He is good at sport.":159,"He can play the guitar. It sounds great!":160,"He carried a heavy bag up the hill.":161,"He does the high jump. She does the long jump.":162,"He fell down and hurt his leg.":163,"He has a toothache. He should see a doctor.":164,"He is an artist. He draws beautiful pictures.":165,"He is angry because he lost the game.":166,"He is drawing a picture. It is beautiful.":167,"He is my dad. She is my mum. This is me!":168,"He left his province to work on atomic science.":169,"He makes model planes during the holiday.":170,"He misses his hometown, so I play with his pet.":171,"He visits the Great Wall with his father.":172,"He waits for another hare to fall to the ground.":173,"He wanted to free the people from the old days.":174,"He was a great leader of the revolution.":175,"Health is the most important thing.":176,"Healthy food makes me tall and strong.":177,"Hello! I am Tom.":178,"Hello, Grandma! How are you?":179,"Hello, I am Ben. What is your name?":180,"Hello, Ms White!":181,"Help yourself to some fish too.":182,"Here is some rice and vegetables.":183,"Here you are. This is your book.":184,"Hi! I am Amy.":185,"Hi, I am Janet. Nice to meet you.":186,"Hide and seek! Where are you?":187,"His early years shaped his great future.":188,"His hobby is drawing. He draws very well.":189,"His story teaches us to be brave and kind.":190,"Hold the door for others. It is the polite thing to do.":191,"Hot soup and warm beds are the best.":192,"Hot soup is good in winter.":193,"How are you today? I am OK.":194,"How are you? I am fine, thank you.":195,"How do you feel? I feel happy!":196,"How is the weather today?":197,"How is the weather today? It is sunny.":198,"How many apples? One apple.":199,"How many cats are there? There are nine.":200,"How many chairs? Eight chairs.":201,"How many flowers? Nine flowers.":202,"How much is it? It is five yuan.":203,"I always get up early in the morning.":204,"I am a student there. I love my city.":205,"I am a student. I am happy.":206,"I am afraid of the big dog.":207,"I am at the farm. It is big.":208,"I am eleven years old.":209,"I am excited about the trip!":210,"I am good at English. I can speak well.":211,"I am happy at school. I can draw and read.":212,"I am hungry. I want to eat.":213,"I am in the running race. I think I can win!":214,"I am lost. Where is the hospital?":215,"I am proud of our class.":216,"I am running in the playground.":217,"I am thirsty. I want to drink water.":218,"I am wearing a red sweater today.":219,"I ask politely, \"May I use the blackboard?\"":220,"I ate noodles for lunch. They were yummy.":221,"I bought a gift for my mother.":222,"I bought some books in the morning.":223,"I bring a box of chocolates for her.":224,"I brush my teeth and wash my face.":225,"I can cook. I help my mum in the kitchen.":226,"I can count from one to ten.":227,"I can draw a big face.":228,"I can draw and sing. What can you do?":229,"I can find you! This is fun!":230,"I can fly a kite in the park.":231,"I can go shopping in the mall near my home.":232,"I can jump. Jump high!":233,"I can read English and write stories.":234,"I can run. I run fast!":235,"I can see five birds.":236,"I can see the blackboard clearly.":237,"I can sing and dance. It is fun!":238,"I can skate and ski. Winter is fun!":239,"I can swim. I swim every summer.":240,"I can wipe the windows.":241,"I choose Sydney because I want to see the opera house.":243,"I clean the blackboard in the morning.":244,"I cleaned my room and washed my clothes.":245,"I collect stamps. I have more than 50 stamps.":246,"I colour my keyboard and it looks great!":247,"I comb my hair and get dressed.":248,"I cut a plastic bottle along the line.":249,"I drank juice and had a good time.":250,"I draw two eyes and one nose.":251,"I drink coffee with my father.":252,"I drink milk and eat eggs every day.":253,"I drink milk every morning.":254,"I eat a hamburger. It is yummy!":255,"I eat an apple every day.":256,"I eat an egg and rice for breakfast.":257,"I eat bread and drink milk for breakfast.":258,"I eat breakfast at seven thirty.":259,"I eat enough fruit too.":260,"I eat fruit like apples and grapes.":261,"I eat mooncakes in autumn. They are sweet.":262,"I eat rice and noodles. They are good.":263,"I fold the trousers and put them away.":264,"I get up at half past six.":265,"I go home at half past four.":266,"I go to school at eight in the morning.":267,"I go to school with my bag.":268,"I go to sleep at nine at night.":269,"I go to sleep at nine. I am tired.":270,"I go to the swimming pool on Saturday.":271,"I had a bad experience and got angry once.":272,"I hang my shirts and jackets neatly.":273,"I have a bike. I ride it to school.":274,"I have a blue hat. It is beautiful.":275,"I have a book, a pen, and a pencil.":276,"I have a cold. I need some medicine.":277,"I have a doll. She is pretty.":278,"I have a dream about my school.":279,"I have a headache and a sore throat.":280,"I have a new friend. Her name is Amy.":281,"I have a new keyboard.":282,"I have a pencil and a rubber.":283,"I have a red balloon.":284,"I have a stomachache. I ate too much.":285,"I have a toy car. It is red.":286,"I have an apple. It is red and sweet.":287,"I have black hair on my head.":288,"I have breakfast at ten past seven.":289,"I have class at ten thirty. Oh no!":290,"I have five fingers on one hand.":291,"I have lunch at school at twelve.":293,"I have one nose and two eyes.":294,"I have so many good memories here.":295,"I have strong teeth because I brush them.":297,"I have ten fingers on my hands.":298,"I have ten fingers.":299,"I have two big eyes.":300,"I have two ears and one mouth.":301,"I have two eyes and one nose.":302,"I have two legs and ten toes.":303,"I help out in the kitchen every day.":304,"I help them with the farm work.":305,"I hope to see you again. Good luck!":306,"I join the music club at school.":307,"I jump up and down ten times.":308,"I keep a diary of my trip to Hong Kong.":309,"I learn English words in chunks.":310,"I learn a little Cantonese there.":311,"I like badminton. It is fun.":312,"I like bananas. They are yellow and sweet.":313,"I like blue. My bag is blue.":314,"I like chicken and fish. They are good.":315,"I like chicken. It is yummy.":316,"I like chocolate very much.":317,"I like chocolate, but not too much.":318,"I like noodles. They are yummy.":321,"I like orange juice. It is yummy!":322,"I like peaches. They are soft and sweet.":323,"I like pink flowers.":324,"I like potatoes. They are yummy and healthy.":325,"I like snow. Snow is white and beautiful.":326,"I like sports. Football is my favourite.":327,"I like spring because the flowers bloom.":328,"I like the Spring Festival best of all.":329,"I like the city very much because it is exciting.":330,"I like the ship. The sea is beautiful.":331,"I like this white shirt.":332,"I like to play chess with my father.":333,"I like to read in the library.":334,"I like vegetables. I eat them every day.":336,"I like vegetables. Tomatoes are my favourite.":337,"I like winter because I like snow.":338,"I live in the countryside. It is quiet and beautiful.":339,"I look at my old photos back then.":340,"I love camping. It is so much fun!":341,"I love ice cream! It is cold and sweet.":342,"I love music. I can sing and play piano.":343,"I love my family with all my heart.":344,"I love strawberries. They are sweet.":345,"I need to buy a ticket first.":346,"I nod my head to show I understand.":347,"I pack my space bag and fly away!":348,"I plan my day every morning.":349,"I put seeds inside the bottle.":350,"I put the books in order.":351,"I put the noodles into the pot.":352,"I put the rubbish in the bin.":353,"I read books at eight twenty.":354,"I read books every day. I am not tired.":355,"I read the sentence loudly first.":356,"I ride a bike and take walks in the fields.":357,"I ride my bike every day.":358,"I run around the classroom once.":359,"I saw a film. It was wonderful.":360,"I see a cat. It is yellow.":361,"I see a fish in the water.":362,"I see a lion. The lion is the king.":363,"I send a Christmas card to my friend.":364,"I send postcards of the city to my cousin.":365,"I set a password for my iPad.":366,"I stayed at home in the evening. It was a wonderful day!":367,"I sweep the floor after dinner.":368,"I tell her about my new film and book.":369,"I type the numbers and the iPad opens.":370,"I usually walk to school. Sometimes I ride a bike.":371,"I walk to school. It takes ten minutes.":372,"I want a pear. They are yummy.":373,"I want a pizza and a chicken sandwich.":374,"I want one kilo of potatoes and some tomatoes.":375,"I want some candy. It is sweet.":376,"I want some water. I am thirsty.":377,"I want to be a scientist. It is my dream.":378,"I want to be a teacher. I like to help children.":379,"I want to be strong and healthy.":380,"I want to go to the cinema.":381,"I want to grow taller this year.":382,"I want to improve my English.":383,"I want to make a bird feeder.":384,"I want to travel around the world one day.":385,"I want to visit Beijing. It is a famous city.":386,"I was busy yesterday. I had a test.":387,"I was polite to the old people.":388,"I wash the dishes and clear the table.":389,"I wash the tomatoes and cut them.":390,"I watched a film with my friends.":391,"I water the plants by the window.":392,"I wear a red T-shirt today.":393,"I wear a white shirt to school.":394,"I wear shorts in hot summer.":395,"I wear socks every day.":396,"I wear white socks and a blue hat.":397,"I went to the park with my family.":398,"I will go abroad to Sydney, Australia.":399,"I will go to middle school soon.":400,"I will go to the beach with my family.":401,"I will leave primary school. I will miss it.":402,"I will remember this day forever.":403,"I will send a postcard to my friend.":404,"I will try my best. I want to be first.":405,"Ice cream is delicious. I eat it in summer.":406,"In autumn, the leaves turn gold.":407,"In class, we listen to the teacher.":408,"In his early years, he studied physics at university.":409,"In spring, we plant trees and flowers.":410,"In summer, I go to camp and have a picnic.":411,"In the afternoon, I came back and read them.":412,"In the afternoon, I play with my friends.":413,"In the afternoon, the wind gets strong.":414,"In the dream, I go to school at half past ten.":415,"In the evening, I do my homework.":416,"In the evening, we have family time.":417,"In the future, we may travel to other planets.":418,"In the morning, I get up early.":419,"Is it a cat? Yes, it is.":420,"Is it a dog? No, it is a rabbit.":421,"Is that a bear? Yes, it is a brown bear.":422,"Is that a snake? Yes, but it is small.":423,"Is the orange sweet or sour? It is sweet.":424,"Is this your pen? Yes, it is.":425,"It can jump high. Is it a frog?":426,"It is a big city with tall buildings.":427,"It is a new start. Cherish every moment.":428,"It is cheap. I will take it.":430,"It is cloudy. Maybe it will rain.":431,"It is hot in summer and cold in winter.":433,"It is natural to feel excited about the meeting.":434,"It is not difficult. But the kangaroo was hard!":435,"It is raining. Put on your raincoat.":436,"It is rainy. I stay at home.":437,"It is rainy. Take your umbrella!":438,"It is simple: keep a good diet.":440,"It is sunny and warm in the morning.":441,"It is the middle of winter now.":443,"It is windy today. Wear your jacket.":445,"It lives in the ocean and looks like a star. A starfish!":446,"It takes one hour to get there by bus.":447,"It usually brings heavy rain.":448,"It will rain. Take an umbrella!":449,"It works as hard as a busy student.":450,"Keep quiet when others speak.":451,"Keep your password a secret.":452,"Keep your room tidy, not messy.":453,"Kick the ball to me!":454,"Kick the ball! Good!":455,"Kids, safety comes first!":456,"Later, I write in my diary: what a happy trip!":457,"Learning science is great fun for everyone.":458,"Let me tell you a story.":459,"Let me tell you a story. It is fun!":460,"Letters are everywhere in our life.":462,"Letters help us read and write.":463,"Lily has a birthday party this evening.":464,"Listen carefully in Science class.":465,"Listen to the weather report. It will shine tomorrow.":466,"Long ago, there were no magic words.":467,"Look at the baby. She is cute!":468,"Look at the board. Listen to the teacher.":469,"Look at the farmers in the field.":470,"Look at the lion! It is so big!":471,"Look at the map. Where are we now?":472,"Look at the photo. Who is this man?":473,"Look at the white cloud in the sky.":474,"Look at the yellow duck!":475,"Look at this ruler. It has letters on it.":476,"Look behind the door. The ball is there.":477,"Look! A brown dog!":478,"Look! A pink pig!":479,"Mango is my favourite fruit.":480,"Manners show your heart to everyone.":481,"Many English words come from our life.":482,"Many animals are in danger on the earth.":483,"Many people help us every day.":484,"Maths is my favourite subject.":485,"May I come in? Yes, please.":486,"Meat and chicken help me grow strong.":487,"Merry Christmas! Here is a present for you.":488,"Mountain climbing is hard but exciting.":489,"Mum goes to the shop to buy food.":490,"Mum is cooking dinner in the kitchen.":491,"Mum is in the kitchen. She is cooking.":492,"Mum makes a sweet cake for me.":493,"My aunt is a nurse. She helps sick people.":494,"My bag is near the door.":495,"My bag is on the floor, next to the bed.":496,"My bed is big. I sleep here.":497,"My class is clean. I am proud!":498,"My classmate is my good friend.":499,"My closet is full of clothes.":500,"My cousin is coming back from abroad.":501,"My dad is tall. I am short.":502,"My desk and chair are tidy.":503,"My drawing is ready. It is me!":504,"My ears are small.":505,"My father drinks coffee in the morning.":506,"My father drinks tea after dinner.":507,"My father drives to work every day.":508,"My father is a worker. He tells stories.":509,"My father is tall. He is a teacher.":510,"My father reads in the study.":511,"My father works in a modern office.":512,"My favourite day is Friday!":513,"My grandpa is a farmer. He loves the land.":514,"My grandparents live in the country.":515,"My hobby is reading. I read every day.":516,"My home is comfortable. I like it here.":517,"My mother helps me a lot.":518,"My mother is a nurse. She is gentle.":519,"My mother is beautiful. She is a doctor.":520,"My mum and dad are in the hall.":521,"My name is Tom. I am a boy.":522,"My name is on my bag. That is me.":523,"My password is two, three, four, five.":524,"My pet dog is very cute and clever.":525,"My room is clean. I like my home.":526,"My ruler is long. I like my schoolbag.":527,"My ruler is near the window.":528,"My school is two kilometres away.":529,"My suitcase is heavy. Can you help me?":530,"My sweaters and coats go on the top shelf.":531,"My uncle is a doctor. He is busy but kind.":532,"No, thanks. Football is just not my thing.":533,"None of the people forgot the magic words again.":534,"Now I am ready for school!":535,"Now I know who is who in the family.":536,"Now I know: be good today, not just back then.":537,"Now I touch my toes slowly.":538,"Now my closet is tidy and clean.":539,"Now there is a big store nearby.":540,"On Thursday morning, I have maths.":541,"On Tuesday, we have English class.":542,"On the weekend, I went to the park.":543,"Once upon a time, there was a wise king.":544,"Only we can stop the danger.":546,"Open your book and read.":547,"Open your book, please.":548,"Open your mouth, please.":549,"Our class has a big plan today.":550,"Our football team is very good. We can win!":551,"Our friendship will last forever.":552,"Our school garden has many flowers.":553,"Our school has a beautiful garden.":554,"Our school opens a new science lab.":555,"Our team puts up road signs.":556,"Painting is my hobby. I paint every weekend.":557,"Pandas are black and white. They are so cute!":558,"Pandas are cute. They eat bamboo.":559,"Pandas eat bamboo. They live in the forest.":560,"People remember the ancient poet Qu Yuan.":561,"People were upset because no one said \"thank you\".":562,"Please sit down and listen.":563,"Please sit down.":564,"Please take a seat. I am glad you are here.":565,"Put it there, not here.":566,"Put on your clothes. It is cold outside.":567,"Put on your clothes. It is cold.":568,"Put on your coat. It is windy outside.":569,"Put on your warm coat in winter.":572,"Put the pen in the box, please.":573,"Put your book on the desk.":574,"Rabbits eat carrots. I like carrots too.":575,"Raise your arm. Good job!":576,"Red lanterns are everywhere. So beautiful!":577,"Remember the old customs, and celebrate together.":578,"Remember the safety rules before you go.":579,"Rest well and drink more water, please.":580,"Run quickly! The wolf is coming!":581,"Run quickly, but walk slowly on the stairs.":582,"Santa Claus brings gifts to children.":583,"Saturday and Sunday are the weekend. No school!":584,"Save the animals, and save our earth.":585,"Say \"please\" and \"thank you\" often.":586,"Say nice words and give a helping hand.":587,"Science is for everybody, not just the clever.":588,"See you at the party tomorrow!":589,"See you tomorrow. Goodbye!":590,"See? The short cut saves us ten minutes.":591,"Seven days make a week.":592,"Shake your legs. One, two, three!":593,"She asks about my school and my friends.":594,"She can run very fast.":595,"She can speak English very well.":596,"She cheers me up before a test.":597,"She has a fever. She needs to rest.":598,"She has a pretty doll.":599,"She has long hair on her head.":600,"She is kind. I love her so much.":601,"She is writing a letter.":602,"She opens the door for me with warm eyes.":603,"She plays volleyball. She is a good player.":604,"She smiles at me when I am sad.":605,"She wants to be a doctor.":606,"She was surprised by the birthday party.":607,"She wears a pink dress. It is pretty.":608,"She wears a pink dress. She looks pretty.":609,"She wears a red sweater. How pretty!":610,"She will take a natural park tour with us.":611,"Show me your ruler, please.":612,"Show your passport, please.":613,"Sit at your desk, please.":614,"Sit on the chair, please.":615,"Six and seven are my lucky numbers too.":616,"Six pencils and seven rulers are in the box.":617,"Six, seven, eight, nine, ten!":618,"Sleep well, and health will be your friend.":619,"Slow and steady wins the race.":620,"Slow down, look around and stay safe.":621,"Snow is white and a cat is black.":622,"Snow is white. I like white.":623,"Some animals are in danger. We must help them.":624,"Some cows and sheep are eating grass.":625,"Some places are quiet and cheap to live in.":626,"Some streets are dirty, I am afraid.":627,"Someone may get hurt in a hurry.":628,"Spring is warm. Flowers come out.":629,"Spring is warm. Trees turn green.":630,"Stamp your foot! Stamp, stamp, stamp!":631,"Stand in line and wait for your turn.":632,"Stay away from the fire and the knives.":633,"Stop at the traffic light. It is red.":634,"Stop on red and go on green.":635,"Summer is hot, but I can swim.":636,"Summer is hot. I like to eat ice cream.":637,"Summer is hot. I like to swim.":638,"Sure! Can I join you?":639,"Table tennis is popular in China.":640,"Take a rest and drink more water.":641,"Take an umbrella when you go out!":642,"Take an umbrella. It will rain soon.":643,"Take the underground. It is quick and cheap.":644,"Take turns to speak in class.":645,"Tall buildings are everywhere in the city.":646,"Teamwork makes everything easy.":647,"Ten years ago, my village was small.":648,"Thank you for showing me the way!":649,"Thank you for your help.":650,"Thank you very much.":651,"That boy is my friend. That girl is my classmate.":652,"That is a cool cap!":653,"That is a red ball.":654,"That is my mother. She has a big smile.":655,"The Mid-Autumn Festival is coming.":656,"The Spring Festival brings us all together.":657,"The Spring Festival is a traditional festival.":658,"The baby is very cute. She is my sister.":659,"The bag is in the box.":660,"The ball is here, not there!":661,"The banana is yellow.":662,"The bathroom is clean and bright.":663,"The bathroom is small but clean.":664,"The bee is small but very clever.":665,"The big bad wolf wanted to eat the sheep.":666,"The bird can fly. It is in the tree.":667,"The bird sings. It is time to exercise!":668,"The brown dog is big.":669,"The brown horse can run fast.":670,"The bus driver is very nice.":671,"The cake is big and delicious.":672,"The cat is under the chair.":673,"The cat is under the chair. Can you find it?":674,"The chair is near the desk.":675,"The city is different to the village.":676,"The city is modern, but sometimes noisy.":677,"The city is noisy and crowded.":678,"The cold trip is full of warm fun!":679,"The cook makes delicious food.":680,"The country is quiet and beautiful.":681,"The cow is big and white.":682,"The desk is between the bed and the window.":683,"The ears are on both sides.":684,"The elephant is big and heavy.":685,"The farmer picks it up and goes home happily.":686,"The farmer works hard on the farm.":687,"The fox and the mouse watch quietly.":688,"The hare is in such a hurry that it stops for a rest.":689,"The hare runs fast, but the tortoise is steady.":690,"The horse can run very fast.":691,"The horse is fast. The turtle is slow.":692,"The lake is beautiful. We can swim here.":693,"The lion looks scary, but it is beautiful.":694,"The magic word is simple: be thankful.":695,"The monkey has a long tail.":696,"The monkey is funny. It makes me laugh.":697,"The monkey is very funny. It jumps up and down.":698,"The monkey is very funny. It likes bananas.":699,"The museum is near the bank.":700,"The park is quiet and green.":701,"The plants are thin but grow fast.":702,"The post office is on the right.":703,"The red keys are for letters.":704,"The river is long and clean.":705,"The shops were far away from our home.":706,"The sky is blue.":707,"The sky is blue. I like blue.":708,"The sky turns dark and it may rain.":709,"The sofa is in the living room, not here.":710,"The soup smells so good!":711,"The space bar is blue and long.":712,"The sun is bright. It is hot.":713,"The sun is strong at noon.":714,"The supermarket is big and clean.":715,"The temperature is high in summer.":716,"The temperature is often below zero.":717,"The tiger has orange and black stripes.":718,"The tiger has stripes. It is beautiful.":719,"The tortoise carries on slowly but surely.":720,"The toy bus is big and blue.":721,"The traffic is heavy in the city.":722,"The train is fast and comfortable.":723,"The tree is green.":724,"The turtle is very slow.":725,"The weather report says a typhoon is coming.":726,"The weather there is very cold.":727,"The whale is big, but it needs our help too.":728,"The wind blows softly in the garden.":729,"The wind blows. It is very cold.":730,"The wind is cold and the days are short.":731,"The wind is strong today. It is 30 degrees.":732,"The worker builds houses and roads.":733,"The writer writes interesting stories.":734,"The zoo is not far. I love my town!":735,"Then I have breakfast with my family.":736,"Then I try to remember anything new.":737,"Then I wake up and go home quickly.":738,"Then a wise man put up a sign: use kind words.":739,"Then and now, life is getting better and better.":740,"Then go in the right direction for five minutes.":741,"Then we walk along the quiet street.":742,"There are beautiful flowers in the garden.":743,"There are space farms in my dream.":744,"There are three books on the desk.":745,"There is a new fan and a big piano in our room.":746,"There is a picture on the wall.":747,"There is no traffic in this direction.":748,"These are our classroom rules.":749,"They are picking apples from the trees.":750,"They are singing and dancing. So happy!":751,"They still drink fresh milk every morning.":752,"This T-shirt is nice. I like it.":754,"This bag is too expensive.":755,"This festival is my favourite time.":756,"This is a letter A. It is on the wall.":757,"This is a picture of my family. I love them.":758,"This is my bedroom. It is clean and tidy.":759,"This is my bedroom. My bed is big.":760,"This is my body. It is healthy.":761,"This is my classroom. It is big.":762,"This is my dad. He is tall.":763,"This is my face. I wash my face every day.":764,"This is my family. I love my family.":765,"This is my family. There are four people.":766,"This is my father. He is tall.":767,"This is my friend Ben. We play together.":768,"This is my mum. She is beautiful.":769,"This is my new friend. His name is Mike.":770,"This is my pen.":771,"This is my school. It is beautiful.":772,"This is my schoolbag. It is blue.":773,"This is the kitchen. My mother cooks here.":774,"This is the mouth. It is smiling.":775,"Tigers are wild animals. They are in danger.":776,"Today I am on duty.":777,"Today I am the chef in the kitchen.":778,"Today is Monday. I go to school.":779,"Today is Road Helper Day.":780,"Today is my birthday.":781,"Tom is my best friend forever.":782,"Tonight is our music show!":783,"Touch your nose. Good!":784,"Touch your nose. Now touch your eyes.":785,"Touch your toes. Can you do it?":786,"Travel opens our eyes to the world.":787,"Trees grow and make our planet green.":788,"Twelve months make a year.":789,"Wait for your turn and do not push.":790,"Walk along the street. The shop is on the left.":791,"Walk in the forest. It is very quiet.":792,"Was I a good girl back then?":793,"Wash your face in the morning.":794,"Wash your hands before you eat.":795,"Wave your arms. Hello!":796,"We are at the airport. It is very big.":797,"We are going to have an English test next week.":798,"We are going to the museum this Saturday.":799,"We are playing football after school.":800,"We bring the plants inside the house.":801,"We can all do simple experiments.":802,"We can see the fields and rivers on the way.":803,"We can take a plane. It is very fast.":804,"We celebrate the Lantern Festival on the lunar date.":805,"We celebrate this special day together.":806,"We climb the mountain near the sea.":807,"We cook and sing around the fire.":808,"We do our best every day.":809,"We eat jiaozi together and make wishes.":810,"We eat together and laugh happily.":811,"We eat zongzi and race dragon boats.":812,"We give gifts to each other.":813,"We go through the small park.":814,"We go to Beijing by train.":815,"We go to the market to buy food.":816,"We grow fruit and tall flowers there.":817,"We have Art, PE, Science and Maths today.":818,"We have a Christmas tree at home.":820,"We have a large garden with flowers.":821,"We have a picnic in the park. It is fun!":822,"We have a sports day next Friday.":823,"We have dinner at six fifty. Yum!":824,"We look at the stars before sleep.":825,"We make a plan to review every day.":826,"We make a poster for our classroom.":827,"We must keep to the right in the hall.":828,"We plan a trip to Harbin in winter.":829,"We plan everything for the happy day.":830,"We play basketball after school.":831,"We play games and dance together.":832,"We play on the beach in summer.":833,"We play on the playground after school.":834,"We remember him as Dr Sun, a hero of our country.":835,"We run and play on the sandy beach.":836,"We run on the playground.":837,"We see snow and ice sculptures everywhere.":838,"We set up the tent near the river.":839,"We share mooncakes at the big meal.":840,"We should protect the Earth. It is our home.":841,"We should protect the environment.":842,"We should save wild animals.":843,"We sing and play the piano together.":844,"We sit on the sofa and eat cookies.":845,"We sit on the sofa and watch TV.":846,"We spend the evening together.":847,"We stay inside and follow the news.":848,"We travel to Hainan in the winter holiday.":849,"We visit Disneyland and meet Mickey Mouse.":850,"We visit our grandparents with gifts.":851,"We watch a film at the cinema.":852,"We watch dragon boat races in June.":853,"We watch films at the cinema on weekends.":854,"We wear thick coats and warm hats.":855,"We went to the swimming pool. It was fun!":856,"We will also visit South Africa to see the nature.":857,"We will be friends forever.":858,"We will go sightseeing and take many photos.":859,"We will go to Guangzhou by train.":860,"We will graduate. It is a new start.":861,"We will leave early in the morning.":862,"We will meet at the school gate at nine.":863,"We will stay in a hotel near the sea.":864,"Wear a helmet when you ride a bike.":865,"Wednesday is a busy day for me.":866,"Welcome to my home! This is my house.":867,"Welcome to my home. Come on in!":868,"Welcome to my house! Come in, please.":869,"What a funny day!":870,"What a wonderful trip for Ben!":871,"What are those farmers doing? They are working hard!":872,"What are you doing? I am reading a book.":873,"What are you wearing? I am wearing a jacket.":874,"What colour is it? It is red.":875,"What colour is the apple? It is red.":876,"What colour is your pen? It is black.":877,"What day is today? Today is Monday.":878,"What did you do last weekend?":879,"What did you do yesterday?":880,"What do you want to be in the future?":881,"What is that? It is a bag.":882,"What is the date? It is Friday.":883,"What is the matter with you?":884,"What is the matter? I have a headache.":885,"What is the weather like today?":886,"What is this? It is a book.":887,"What is your favourite season?":888,"What is your name? I am Lily.":889,"What is your name? My name is Jiamin.":890,"What is your summer holiday plan?":891,"What subject do you like? I like English.":892,"What time is it? Look at the clock!":893,"What time is it? Look at the clock.":894,"What topic do you want to practice?":895,"When I am ill, he comes to see me.":896,"When I am wrong, he tells me kindly.":897,"When something falls out of my memory, I read again.":898,"When the show ends, everyone claps.":899,"Where are you from? I am from Guangzhou.":900,"Where is my book? It is on the desk.":901,"Where is my pen? It is in the bag.":902,"Where is my rubber? It is in my pencil case.":903,"Where is my teacher? She is there.":904,"Where is the best place to live?":905,"Where is the rabbit? It is behind the door.":906,"Where will you go for the holiday?":907,"Which season do you like best? I like spring.":908,"Who is he? He is my brother.":909,"Who is he? He is my new friend.":910,"Who is she? She is Lily. She is a girl.":911,"Who is she? She is my sister.":912,"Who is that girl? She is my sister.":913,"Who is that lady? She is my grandma.":914,"Who is this man? He is my grandpa.":915,"Whose T-shirt is this? It is my T-shirt.":916,"Why do you feel sad? Tell me.":917,"Why? Because practice makes perfect.":918,"Winter is cold outside but warm at home.":919,"Winter is cold, but snow is beautiful.":920,"Winter is cold. Children love to play in the snow.":921,"Winter is cold. I wear a warm coat.":922,"Would you like to go with us?":923,"Yellow keys are for numbers.":924,"Yes! Now it is your turn.":925,"Yes, I would love to. What time?":926,"You and me, we are friends.":927,"You look tired. Did you sleep well?":929,"You must be quiet in the library.":930,"You should eat more vegetables.":932,"Zero is a number too.":933,"Cheer for your team! Let's go!":934,"Dinner is ready at six. Let's eat!":935,"Don't be afraid of mistakes. Learn from them.":936,"Don't be late for school.":937,"Don't drink too much cola. It is not healthy.":938,"Don't forget to sleep well before the test!":939,"Don't laugh at others. Be kind.":940,"Don't push. Be polite to others.":941,"Don't throw rubbish on the ground.":942,"Great! I can't wait to see the robots.":943,"I can't wait to see you, my dear cousin!":944,"I have lunch at school at twelve o'clock.":945,"I have some money. Let's buy a present.":946,"I like fruit. Let's get some fruit.":947,"I like hamburgers, but I don't eat them every day.":948,"I like to travel. Let's go on a trip!":949,"It is a quarter past seven. Let's go!":950,"It is eight o'clock. Time for school!":951,"It is seven o'clock. I get up.":952,"It is sunny today. Let's go out!":953,"It is warm in spring. Let's go outside!":954,"Let's clean the classroom first!":955,"Let's climb the mountain. The air is fresh!":956,"Let's eat! I am very hungry.":957,"Let's go camping this weekend!":958,"Let's go to the library. I know a short cut!":959,"Let's go to the park on the weekend!":960,"Let's go to the playground and play!":961,"Let's go to the shop. I want to buy a toy.":962,"Let's go to the zoo! I am excited!":963,"Let's go to the zoo! The zoo is big.":964,"Let's play a game together!":965,"Let's play a game! It is a basketball match.":966,"Let's play a guessing game. What animal is it?":967,"Let's review. Practice makes perfect.":968,"Let's sing together! It is really fun!":969,"Let's sing together. La la la!":970,"One, two, three! Let's count!":971,"Put on your jacket and shoes. Let's go!":972,"Put on your shoes. Let's go out!":973,"They take many photos at Tian'anmen Square.":974,"We have PE today. Let's run and jump!":975,"You can sort the books. Let's do it!":976,"You mustn't run in the classroom.":977},_zhWordIdx: {"一":2001,"一五一十":2002,"一心一意":2003,"一把汗":2004,"一本正经":2005,"一清二白":2006,"一起玩":2007,"一马当先":2008,"七上八下":2009,"七嘴八舌":2010,"七律·长征":2011,"七手八脚":2012,"万":2013,"万物复苏":2014,"万里无云":2015,"丈":2016,"三":2017,"三三两两":2018,"三心二意":2019,"三更半夜":2020,"三衢道中":2021,"上":2022,"下":2023,"不":2024,"不屈不挠":2025,"不约而同":2026,"不自量力":2027,"与人为善":2028,"专心致志":2029,"世":2030,"世界":2031,"丘":2032,"丛":2033,"东":2034,"东西":2035,"丝":2036,"丞":2037,"严":2038,"丧":2039,"丰收":2040,"临":2041,"临终":2042,"为":2043,"主":2044,"举":2045,"举世闻名":2046,"乃":2047,"么":2048,"乌黑":2049,"乏":2050,"乐":2051,"九月九日忆山东兄弟":2052,"九牛一毛":2053,"乞巧":2054,"乡":2055,"乡村四月":2056,"书湖阴先生壁":2057,"买":2058,"乾":2059,"了":2060,"予":2061,"争":2062,"二":2063,"云":2064,"云遮雾涌":2065,"互":2066,"五":2067,"五光十色":2068,"五湖四海":2069,"五颜六色":2070,"井":2071,"井井有条":2072,"亡羊补牢":2073,"亩":2074,"京":2075,"亭":2076,"亲":2077,"人":2078,"人声鼎沸":2079,"人山人海":2080,"什":2081,"仅":2082,"从军行":2083,"仔细":2084,"他":2085,"仗":2086,"仙":2087,"仙境":2088,"仞":2089,"以德报怨":2090,"仿":2091,"仿佛":2092,"伏":2093,"休":2094,"众":2095,"优":2096,"伙伴":2097,"会":2098,"伤痕":2099,"似":2100,"位":2101,"低":2102,"余":2103,"佛":2104,"你":2105,"佳":2106,"侄":2107,"例":2108,"侍":2109,"供":2110,"依":2111,"依依不舍":2112,"侨":2113,"侯":2114,"侵":2115,"俊俏":2116,"信":2117,"信赖":2118,"俭":2119,"修":2120,"俯":2121,"俺":2122,"倍":2123,"倒影":2124,"倘":2125,"借":2126,"倦":2127,"倾":2128,"假":2129,"偎":2130,"做":2131,"停":2132,"停止":2133,"偶":2134,"偶尔":2135,"偷":2136,"傅":2137,"催":2138,"傲":2139,"像":2140,"允许":2141,"元日":2142,"兄":2143,"光":2144,"光彩夺目":2145,"党":2146,"入":2147,"全心全意":2148,"全神贯注":2149,"全身贯注":2150,"六月二十七日望湖楼醉书":2151,"兰":2152,"兴高采烈":2153,"其":2154,"典":2155,"兼":2156,"内":2157,"冈":2158,"再":2159,"再接再厉":2160,"冒":2161,"冕":2162,"军":2163,"农":2164,"冠":2165,"冬":2166,"冬天":2167,"冬雪":2168,"冰雪融化":2169,"凄":2170,"准":2171,"凉州词":2172,"凉快":2173,"凌":2174,"凌乱":2175,"减":2176,"凑":2177,"凛":2178,"凡":2179,"凤":2180,"出塞":2181,"出类拔萃":2182,"击":2183,"刨根问底":2184,"别致":2185,"别董大":2186,"刮":2187,"制":2188,"刻舟求剑":2189,"剃":2190,"剑":2191,"剔":2192,"剥":2193,"剪":2194,"副":2195,"割":2196,"劈":2197,"办法":2198,"劣":2199,"动":2200,"助":2201,"劫后余生":2202,"勃勃生机":2203,"勇":2204,"勇冠三军":2205,"勇往直前":2206,"勇敢":2207,"勤":2208,"勾勒":2209,"勿":2210,"匀称":2211,"匆匆忙忙":2212,"化":2213,"北":2214,"匙":2215,"匠心独运":2216,"匣":2217,"匹":2218,"区":2219,"医生":2220,"医院":2221,"十五夜望月":2222,"千奇百怪":2223,"千姿百态":2224,"千言万语":2225,"千里之行，始于足下":2226,"午":2227,"协":2228,"单":2229,"南":2230,"南辕北辙":2231,"博":2232,"卜算子·咏梅":2233,"卜算子·送鲍浩然之浙东":2234,"占":2235,"卧眠":2236,"厚":2237,"原":2238,"原来":2239,"去":2240,"又说又唱":2241,"叉":2242,"双":2243,"叔":2244,"变化多端":2245,"叠":2246,"口":2247,"口笛":2248,"口若悬河":2249,"古朗月行（节选）":2250,"叨":2251,"召":2252,"叮":2253,"叮嘱":2254,"叮嘱再三":2255,"可":2256,"可爱":2257,"右":2258,"叶":2259,"叶子":2260,"号":2261,"司":2262,"吃":2263,"各":2264,"各种各样":2265,"名":2266,"名列前茅":2267,"吞":2268,"吟":2269,"吨":2270,"吩":2271,"吩咐":2272,"含":2273,"含情脉脉":2274,"含羞":2275,"含苞欲放":2276,"听":2277,"吹":2278,"吻":2279,"吾":2280,"告":2281,"告诉":2282,"呐":2283,"员":2284,"呻":2285,"呼":2286,"呼风唤雨":2287,"咆哮":2288,"和风细雨":2289,"咏柳":2290,"咏鹅":2291,"咐":2292,"咙":2293,"咽":2294,"哀":2295,"哇":2296,"响":2297,"哟":2298,"哩":2299,"唤醒":2300,"啃":2301,"商议":2302,"啦":2303,"啼":2304,"喉":2305,"喜":2306,"喧闹":2307,"喷":2308,"嗅":2309,"嗜":2310,"嗡":2311,"嘛":2312,"嘱":2313,"嘴":2314,"噢":2315,"四":2316,"四平八稳":2317,"四时田园杂兴（其三十一）":2318,"四时田园杂兴（其二十五）":2319,"四面八方":2320,"回乡偶书":2321,"回味无穷":2322,"因":2323,"团":2324,"园":2325,"围":2326,"国":2327,"圆":2328,"土":2329,"地":2330,"均":2331,"块":2332,"坚强不屈":2333,"坚持":2334,"坛":2335,"坠":2336,"坤":2337,"坦":2338,"垂":2339,"垂头丧气":2340,"垠":2341,"埋":2342,"培":2343,"堆":2344,"堡":2345,"堤":2346,"堵":2347,"塌":2348,"塞下曲":2349,"境":2350,"境界":2351,"墙":2352,"增添":2353,"墨梅":2354,"墩":2355,"壁":2356,"壶":2357,"备":2358,"夏":2359,"夏天":2360,"夏日绝句":2361,"多":2362,"多灾多难":2363,"多种多样":2364,"夜书所见":2365,"夜以继日":2366,"夜宿山寺":2367,"够":2368,"大":2369,"大义凛然":2370,"大人":2371,"大公无私":2372,"大山":2373,"大惊小怪":2374,"大林寺桃花":2375,"天":2376,"天涯海角":2377,"天马行空":2378,"太":2379,"央":2380,"失望":2381,"奄":2382,"奇丽":2383,"奇观":2384,"奈":2385,"奋不顾身":2386,"奔":2387,"奢":2388,"好奇":2389,"如怨如诉":2390,"如虎添翼":2391,"妈":2392,"妒":2393,"妩媚":2394,"妹":2395,"妻":2396,"姑":2397,"姓":2398,"姿势":2399,"娃":2400,"娘":2401,"婆":2402,"媚":2403,"嫂":2404,"嫌":2405,"嫦娥":2406,"嫩":2407,"嫩芽":2408,"子":2409,"孔":2410,"孔隙":2411,"孕":2412,"字":2413,"孜孜不倦":2414,"季":2415,"孤":2416,"学习":2417,"学富五车":2418,"孵":2419,"宁折不弯":2420,"守":2421,"守株待兔":2422,"安":2423,"安安静静":2424,"安静":2425,"宋":2426,"完好无损":2427,"完璧归赵":2428,"宏伟壮观":2429,"宝":2430,"实":2431,"审阅":2432,"宣":2433,"宫":2434,"害羞":2435,"宴":2436,"宵":2437,"宽":2438,"宽阔":2439,"宾":2440,"宿":2441,"宿建德江":2442,"宿新市徐公店":2443,"寂":2444,"寄":2445,"密密麻麻":2446,"寇":2447,"富":2448,"富丽堂皇":2449,"寒食":2450,"寞":2451,"寨":2452,"寸":2453,"对":2454,"寻":2455,"寻隐者不遇":2456,"寿":2457,"射":2458,"小儿垂钓":2459,"小朋友":2460,"小池":2461,"小溪":2462,"小船":2463,"小鸟":2464,"尖":2465,"尚":2466,"尤":2467,"尤其":2468,"就":2469,"尺":2470,"尽":2471,"尽头":2472,"局":2473,"局促不安":2474,"层":2475,"居":2476,"居高临下":2477,"屈":2478,"屉":2479,"屏":2480,"屏息凝视":2481,"山":2482,"山居秋暝":2483,"山崩地裂":2484,"山行":2485,"山谷":2486,"屹":2487,"屹立":2488,"岂":2489,"岛":2490,"岩":2491,"岳":2492,"峻":2493,"崇":2494,"崇山峻岭":2495,"崖":2496,"崩":2497,"嵌":2498,"巍峨":2499,"巍然屹立":2500,"川":2501,"巢":2502,"左":2503,"巨":2504,"巨大":2505,"巫":2506,"己亥杂诗":2507,"布":2508,"帆":2509,"帐":2510,"帜":2511,"帝":2512,"席":2513,"帮助":2514,"帽":2515,"干净":2516,"平常":2517,"平平安安":2518,"平静":2519,"年老":2520,"幼":2521,"幽":2522,"广":2523,"广播":2524,"床":2525,"序":2526,"库":2527,"应有尽有":2528,"府":2529,"庞":2530,"废寝忘食":2531,"庭":2532,"廊":2533,"延":2534,"建":2535,"开花":2536,"开辟":2537,"异":2538,"异常":2539,"弃":2540,"引":2541,"引人注意":2542,"引人注目":2543,"张牙舞爪":2544,"弩":2545,"弯":2546,"弱":2547,"弹":2548,"强":2549,"强壮":2550,"归":2551,"当":2552,"当之无愧":2553,"录":2554,"形状":2555,"影":2556,"彻":2557,"彼":2558,"征":2559,"径":2560,"待":2561,"很":2562,"徊":2563,"徐":2564,"徘":2565,"微":2566,"忆江南":2567,"忌":2568,"忍饥挨饿":2569,"忐忑不安":2570,"忘":2571,"快":2572,"快乐":2573,"快快乐乐":2574,"忽如一夜春风来":2575,"怀":2576,"怔":2577,"思":2578,"思索":2579,"急":2580,"怨":2581,"怪生无雨都张伞":2582,"怯":2583,"恃":2584,"恋":2585,"恍":2586,"恍然大悟":2587,"恐":2588,"恒":2589,"恢复":2590,"恭":2591,"息":2592,"恰当":2593,"悄":2594,"悉":2595,"悔":2596,"悦":2597,"悬":2598,"悬崖峭壁":2599,"悯农（其一）":2600,"悯农（其二）":2601,"情":2602,"惊天动地":2603,"惜":2604,"惟妙惟肖":2605,"惠":2606,"惠崇春江晚景":2607,"惧":2608,"惩":2609,"惰":2610,"想":2611,"想一想":2612,"惶":2613,"愉快":2614,"感激":2615,"愣":2616,"慈":2617,"慌慌张张":2618,"慕":2619,"慰":2620,"懂":2621,"懈":2622,"懒":2623,"懦":2624,"成竹在胸":2625,"成群结队":2626,"我":2627,"戴":2628,"所":2629,"所见":2630,"手":2631,"手忙脚乱":2632,"手抚纸页":2633,"手舞足蹈":2634,"打":2635,"打扮":2636,"托":2637,"执":2638,"扬":2639,"扭":2640,"扮":2641,"扳":2642,"扶":2643,"扶老携幼":2644,"批":2645,"承":2646,"抄":2647,"抖":2648,"折":2649,"抡":2650,"披":2651,"披头散发":2652,"抵":2653,"抹":2654,"拂":2655,"拂晓":2656,"拌":2657,"拐":2658,"拒":2659,"拒绝":2660,"拔":2661,"拖":2662,"拙":2663,"招":2664,"拜访":2665,"拥":2666,"拨":2667,"括":2668,"拭":2669,"拯":2670,"拴":2671,"拾金不昧":2672,"持":2673,"挡":2674,"挤":2675,"挥":2676,"挨":2677,"挪":2678,"振":2679,"挺":2680,"挺直腰杆":2681,"挽":2682,"捉":2683,"捐":2684,"捕":2685,"捡":2686,"据":2687,"捷":2688,"掌":2689,"排山倒海":2690,"掘":2691,"掠":2692,"探":2693,"探险":2694,"接":2695,"控":2696,"推己及人":2697,"掩":2698,"掩耳盗铃":2699,"揉":2700,"描":2701,"提心吊胆":2702,"揭":2703,"揽":2704,"搂":2705,"搅":2706,"搏":2707,"搏杀":2708,"搓":2709,"搭":2710,"摇头晃脑":2711,"摊":2712,"摩":2713,"撑":2714,"撕":2715,"撕碎":2716,"撞":2717,"撩":2718,"播":2719,"操":2720,"擦":2721,"攀着铁链":2722,"收获":2723,"放":2724,"政":2725,"故":2726,"故乡":2727,"效":2728,"敏":2729,"敕勒歌":2730,"教":2731,"教室":2732,"数":2733,"文思泉涌":2734,"斑":2735,"斗":2736,"斜风细雨":2737,"斤":2738,"斩钉截铁":2739,"断":2740,"方":2741,"方方正正":2742,"施":2743,"施肥":2744,"旋":2745,"旎":2746,"旖":2747,"无":2748,"无价之宝":2749,"无忧无虑":2750,"无赖":2751,"无边无际":2752,"日":2753,"日月":2754,"早发白帝城":2755,"早春呈水部张十八员外":2756,"时":2757,"昂":2758,"昆":2759,"明朗":2760,"明艳":2761,"明辨是非":2762,"昏头昏脑":2763,"昔":2764,"星":2765,"星星":2766,"春":2767,"春回大地":2768,"春夜喜雨":2769,"春天":2770,"春日":2771,"春晓":2772,"春暖花开":2773,"春风":2774,"昧":2775,"昨":2776,"昼":2777,"显":2778,"晓":2779,"晓出净慈寺送林子方":2780,"晕":2781,"晦":2782,"晨":2783,"景":2784,"景色":2785,"晰":2786,"晴":2787,"暖":2788,"暮":2789,"暮江吟":2790,"暴":2791,"曝":2792,"曲":2793,"曳":2794,"曹":2795,"月":2796,"月儿":2797,"有说有笑":2798,"有趣":2799,"服":2800,"服装":2801,"朗读":2802,"望":2803,"望天门山":2804,"望庐山瀑布":2805,"望梅止渴":2806,"望洞庭":2807,"朦":2808,"未":2809,"朱":2810,"杂":2811,"杉":2812,"李":2813,"材":2814,"村":2815,"村居":2816,"村晚":2817,"杖":2818,"杞人忧天":2819,"束":2820,"来":2821,"杭":2822,"杰":2823,"松":2824,"极目远眺":2825,"构":2826,"枝干":2827,"枫":2828,"枫桥夜泊":2829,"架子十足":2830,"柄":2831,"柏":2832,"柔":2833,"柔美":2834,"柔软":2835,"柜":2836,"查":2837,"柱":2838,"柳":2839,"柳条":2840,"柳绿花红":2841,"柳边深巷":2842,"栅":2843,"标":2844,"栏":2845,"树":2846,"树叶":2847,"校":2848,"栩栩如生":2849,"株":2850,"样":2851,"根":2852,"格":2853,"栽":2854,"桂":2855,"桃李不言，下自成蹊":2856,"桃红柳绿":2857,"桃花":2858,"桅":2859,"案":2860,"桐":2861,"桑":2862,"桦":2863,"梅":2864,"梅花":2865,"梦":2866,"梧":2867,"检":2868,"棋":2869,"棍":2870,"森林":2871,"植":2872,"楚":2873,"楷":2874,"榜":2875,"榨":2876,"榴":2877,"横七竖八":2878,"樱":2879,"橡":2880,"檐":2881,"欢呼":2882,"欣喜若狂":2883,"欣赏":2884,"欲":2885,"款":2886,"止":2887,"歪":2888,"歹":2889,"歼":2890,"殃":2891,"殿":2892,"母":2893,"毒":2894,"毛":2895,"毫不可惜":2896,"毯":2897,"气":2898,"气势磅礴":2899,"气吞山河":2900,"气壮山河":2901,"气魄":2902,"氧":2903,"水":2904,"水汪汪":2905,"汁":2906,"求":2907,"求助":2908,"汇":2909,"汉":2910,"汗":2911,"汛":2912,"江":2913,"江上渔者":2914,"江南":2915,"江南春":2916,"江畔独步寻花":2917,"江雪":2918,"池":2919,"池上":2920,"汤":2921,"汴":2922,"汹涌澎湃":2923,"沉着":2924,"沙":2925,"沟渠":2926,"沧海一粟":2927,"沮":2928,"河":2929,"沸":2930,"沼泽":2931,"沾":2932,"泉":2933,"泉水叮咚":2934,"泊船瓜洲":2935,"泛":2936,"波":2937,"波纹":2938,"波纹粼粼":2939,"泥泞":2940,"注":2941,"注视":2942,"泰":2943,"泳":2944,"洋溢":2945,"洒":2946,"洒脱":2947,"洛":2948,"洞":2949,"津津有味":2950,"活泼":2951,"活灵活现":2952,"流淌":2953,"浅":2954,"浆":2955,"浇":2956,"浊":2957,"浣":2958,"浣溪沙":2959,"浪淘沙（其一）":2960,"浪淘沙（其七）":2961,"浮":2962,"浸":2963,"浸润":2964,"涂":2965,"涕":2966,"涛":2967,"涡":2968,"润":2969,"涧":2970,"涯":2971,"液":2972,"淘":2973,"淡淡清香":2974,"深":2975,"深处":2976,"清":2977,"清凉":2978,"清平乐":2979,"清平乐·村居":2980,"清明":2981,"清澄":2982,"渐":2983,"渐渐":2984,"渔歌":2985,"渔歌子":2986,"渗":2987,"渗水":2988,"渡":2989,"温":2990,"温暖":2991,"渲染":2992,"游":2993,"游园不值":2994,"游子吟":2995,"湃":2996,"湖":2997,"湾":2998,"湿润":2999,"湿漉漉":3000,"溪":3001,"溺":3002,"滁州西涧":3003,"滋":3004,"滋润":3005,"滚":3006,"满":3007,"满腔怒火":3008,"满载而归":3009,"滥竽充数":3010,"滩":3011,"滴":3012,"漂":3013,"漠":3014,"漪":3015,"漫":3016,"漫天卷地":3017,"漫天飞舞":3018,"潇":3019,"潭":3020,"潮":3021,"澄":3022,"澈":3023,"澎":3024,"澜":3025,"瀑":3026,"火":3027,"灰":3028,"灵":3029,"灶":3030,"炊":3031,"烁":3032,"烈":3033,"热情":3034,"热情好客":3035,"热血沸腾":3036,"热闹":3037,"焦":3038,"焰":3039,"照":3040,"熏":3041,"熬":3042,"燃":3043,"燕":3044,"燥":3045,"爆":3046,"爱慕":3047,"父":3048,"爸":3049,"爹":3050,"片":3051,"牧":3052,"牲":3053,"牵":3054,"特":3055,"牺":3056,"犹":3057,"狂":3058,"狂欢":3059,"狂澜":3060,"独坐敬亭山":3061,"猛":3062,"猜":3063,"献":3064,"率":3065,"王":3066,"玩":3067,"玫":3068,"玷":3069,"珀":3070,"珊":3071,"珍":3072,"球":3073,"理直气壮":3074,"琥":3075,"瑚":3076,"瑜":3077,"瑞":3078,"瑟":3079,"瑰":3080,"瓢":3081,"瓮":3082,"瓶":3083,"甜":3084,"生":3085,"生机勃勃":3086,"生机盎然":3087,"生硬":3088,"田":3089,"田里":3090,"申":3091,"画":3092,"画蛇添足":3093,"画龙点睛":3094,"界":3095,"留":3096,"留意":3097,"略":3098,"畦":3099,"番":3100,"疆":3101,"疏":3102,"疑":3103,"疙":3104,"疤":3105,"疾":3106,"痕":3107,"瘩":3108,"登":3109,"登鹳雀楼":3110,"白":3111,"白云":3112,"白兔":3113,"白浪翻滚":3114,"百发百中":3115,"百尺竿头，更进一步":3116,"百思不解":3117,"百折不挠":3118,"百花争艳":3119,"百花盛开":3120,"百花齐放":3121,"百鸟争鸣":3122,"皆":3123,"皇":3124,"皮":3125,"盈":3126,"盏":3127,"监":3128,"盘":3129,"盘曲":3130,"盛":3131,"目":3132,"目不转睛":3133,"直":3134,"盼":3135,"盾":3136,"省":3137,"眉开眼笑":3138,"眉飞色舞":3139,"看":3140,"看见":3141,"真真假假":3142,"眠":3143,"眨":3144,"眩":3145,"眼":3146,"睛":3147,"督":3148,"睹":3149,"瞎":3150,"瞻":3151,"矗立":3152,"矛":3153,"矣":3154,"知错就改":3155,"短":3156,"矮":3157,"石":3158,"石灰吟":3159,"石钟乳":3160,"砍":3161,"砖":3162,"砚":3163,"确":3164,"碑":3165,"碟":3166,"磁":3167,"磨":3168,"磨难":3169,"礁":3170,"示":3171,"示儿":3172,"礼":3173,"神奇":3174,"神气":3175,"祭":3176,"禾":3177,"秀":3178,"秀丽":3179,"秉":3180,"秋":3181,"秋夜将晓出篱门迎凉有感":3182,"秋天":3183,"种":3184,"秦":3185,"称":3186,"稀":3187,"稍":3188,"稚":3189,"稚子弄冰":3190,"稠":3191,"稳":3192,"稻":3193,"稿":3194,"穗":3195,"究":3196,"穷":3197,"空隙":3198,"突兀森郁":3199,"突飞猛进":3200,"窍":3201,"童":3202,"童话":3203,"竭":3204,"竹石":3205,"笛":3206,"符":3207,"笼罩":3208,"筋疲力尽":3209,"筐":3210,"筑":3211,"筒":3212,"筹":3213,"箩":3214,"箭":3215,"篱":3216,"篱落":3217,"簸":3218,"籍":3219,"米":3220,"粉":3221,"粉身碎骨":3222,"粗":3223,"粗壮":3224,"粥":3225,"粮食":3226,"粹":3227,"精巧":3228,"精彩":3229,"精美":3230,"精致":3231,"糊":3232,"糕":3233,"糖":3234,"素":3235,"索":3236,"累":3237,"繁":3238,"红":3239,"纯净":3240,"纱":3241,"纳":3242,"纹":3243,"线":3244,"组":3245,"细碎光斑":3246,"绊":3247,"绑":3248,"绒":3249,"结":3250,"结实":3251,"绕":3252,"绘":3253,"绚丽多彩":3254,"绝句":3255,"绞":3256,"绢":3257,"绣":3258,"绦":3259,"绩":3260,"绮":3261,"绸":3262,"绽":3263,"绿树红花":3264,"绿毯":3265,"绿油油":3266,"绿草如茵":3267,"缀":3268,"缓":3269,"缝":3270,"缠":3271,"缩":3272,"缰":3273,"缸":3274,"罐":3275,"罕":3276,"罗":3277,"罚":3278,"罪":3279,"置":3280,"置之不理":3281,"羊儿":3282,"美中不足":3283,"美好":3284,"羞":3285,"羽":3286,"翁":3287,"翔":3288,"翠":3289,"翩":3290,"翩翩起舞":3291,"翻飞蝴蝶":3292,"翼":3293,"老马识途":3294,"考验":3295,"耐":3296,"耕":3297,"耘":3298,"耳":3299,"耳聪目明":3300,"耳闻目睹":3301,"耸":3302,"耻":3303,"耽":3304,"聂":3305,"聊":3306,"职":3307,"聚拢":3308,"聪明":3309,"聪明才智":3310,"肃穆":3311,"肆":3312,"肝胆相照":3313,"肢":3314,"肥":3315,"肿":3316,"胀":3317,"胆大妄为":3318,"胆怯":3319,"背":3320,"胜":3321,"胞":3322,"胧":3323,"胸":3324,"胸无点墨":3325,"胸有成竹":3326,"脂":3327,"脉":3328,"脏":3329,"脑":3330,"脑袋":3331,"脱":3332,"脾":3333,"腊":3334,"腐":3335,"腔":3336,"腕":3337,"腮":3338,"腹":3339,"腻":3340,"腾云驾雾":3341,"膑":3342,"膜":3343,"膝":3344,"膨":3345,"臂":3346,"臣":3347,"自己":3348,"自言自语":3349,"舍":3350,"舍己为人":3351,"舒服":3352,"舞":3353,"舞蹈":3354,"舟夜书所见":3355,"航":3356,"舰":3357,"船":3358,"艘":3359,"艰难险阻":3360,"色":3361,"色素":3362,"艳":3363,"芙":3364,"芙蓉楼送辛渐":3365,"芦":3366,"芬":3367,"花":3368,"花儿盛开":3369,"芳":3370,"芽":3371,"苇":3372,"苍白无力":3373,"苏":3374,"苔":3375,"苗":3376,"苞":3377,"苟":3378,"苦":3379,"茂":3380,"茅":3381,"茎":3382,"茫茫":3383,"茱":3384,"茶":3385,"茸":3386,"荆":3387,"草木皆兵":3388,"荒":3389,"荷":3390,"莲":3391,"莺":3392,"莺歌燕舞":3393,"菜":3394,"菩萨蛮·大柏地":3395,"萍":3396,"萎":3397,"萝":3398,"萧条":3399,"萨":3400,"萸":3401,"落":3402,"著":3403,"著名":3404,"葬":3405,"蒜":3406,"蒸":3407,"蒸蒸日上":3408,"蓉":3409,"蓝":3410,"蓝天":3411,"蓝天白云":3412,"蓟":3413,"蓬":3414,"蔑":3415,"蔓":3416,"蔗":3417,"蕲":3418,"蕾":3419,"薄":3420,"薇":3421,"薪":3422,"藉":3423,"藏":3424,"藤":3425,"蘸":3426,"虎":3427,"虎视眈眈":3428,"虑":3429,"虚":3430,"虫":3431,"虬":3432,"虹":3433,"虾":3434,"蚁":3435,"蚪":3436,"蚱":3437,"蛛":3438,"蜂":3439,"蜓":3440,"蜘":3441,"蜜":3442,"蜻":3443,"蜿蜒":3444,"蜿蜒盘旋":3445,"蝉":3446,"蝌":3447,"蝙":3448,"蝠":3449,"蝴":3450,"蝶":3451,"融":3452,"融化":3453,"行":3454,"衍":3455,"衔":3456,"衡":3457,"衣衫褴楼":3458,"衰":3459,"袄":3460,"袋":3461,"袍":3462,"袭":3463,"袱":3464,"裁":3465,"装":3466,"裳":3467,"裸":3468,"褐":3469,"襄":3470,"襟":3471,"西":3472,"西江月·夜行黄沙道中":3473,"覆":3474,"见":3475,"见义勇为":3476,"观察":3477,"觅":3478,"视":3479,"觉":3480,"角":3481,"解":3482,"解冻":3483,"触":3484,"言而有信":3485,"誉":3486,"誓":3487,"警":3488,"譬":3489,"认真":3490,"讥":3491,"议":3492,"讲":3493,"讳":3494,"许":3495,"论":3496,"讽":3497,"访":3498,"诈":3499,"诉":3500,"词":3501,"诚":3502,"语":3503,"语无伦次":3504,"语重心长":3505,"误":3506,"诲":3507,"说":3508,"诵":3509,"请":3510,"诺":3511,"读":3512,"谈":3513,"谋":3514,"谎":3515,"谐":3516,"谓":3517,"谜":3518,"谦":3519,"谦虚":3520,"豁":3521,"豪":3522,"负荆请罪":3523,"贩":3524,"贫":3525,"贯":3526,"贵":3527,"贷":3528,"贺":3529,"赋得古原草送别（节选）":3530,"赖":3531,"赞":3532,"赠刘景文":3533,"赠汪伦":3534,"赢":3535,"赤":3536,"走开":3537,"趁其不备":3538,"趁虚而入":3539,"足":3540,"足迹":3541,"足迹斑斑":3542,"趴":3543,"跌":3544,"距":3545,"跤":3546,"跨":3547,"路":3548,"跳":3549,"践":3550,"跺":3551,"踏":3552,"踪":3553,"蹄":3554,"蹈":3555,"蹑手蹑脚":3556,"蹒跚而行":3557,"蹭":3558,"蹲":3559,"身处其境":3560,"躬":3561,"躯":3562,"躲":3563,"软":3564,"载":3565,"轿":3566,"辆":3567,"辈":3568,"输":3569,"辛":3570,"辟":3571,"辨":3572,"迁":3573,"过故人庄":3574,"迎":3575,"迎接":3576,"近":3577,"返":3578,"还":3579,"远":3580,"连绵起伏":3581,"迟":3582,"迢迢牵牛星":3583,"迫":3584,"迫不及待":3585,"迸":3586,"送":3587,"送元二使安西":3588,"适宜":3589,"逊":3590,"逐":3591,"逐渐":3592,"递":3593,"途":3594,"逗":3595,"逛":3596,"逸":3597,"遍":3598,"遗":3599,"遥":3600,"遮":3601,"避":3602,"邓":3603,"邮":3604,"郎":3605,"郭":3606,"配合":3607,"酒":3608,"酬":3609,"酬谢":3610,"酸甜可口":3611,"醉":3612,"醋":3613,"醒":3614,"采":3615,"采莲曲":3616,"采薇（节选）":3617,"释":3618,"重":3619,"量":3620,"金":3621,"金碧辉煌":3622,"金黄":3623,"钗":3624,"钝":3625,"钩":3626,"钮":3627,"铃":3628,"铜":3629,"铭":3630,"铲":3631,"银":3632,"锄":3633,"锄头":3634,"锋":3635,"锐":3636,"错":3637,"锦":3638,"镇静":3639,"镜":3640,"长歌行":3641,"长相思":3642,"门":3643,"闪":3644,"问好":3645,"闲散":3646,"闻":3647,"闻名":3648,"闻官军收河南河北":3649,"闼":3650,"阁":3651,"阅":3652,"阔":3653,"队":3654,"阳":3655,"阳光":3656,"阳光明媚":3657,"阻":3658,"附":3659,"陈":3660,"降":3661,"陡峭":3662,"陪":3663,"陶":3664,"陷":3665,"隆":3666,"隔":3667,"隙":3668,"隧":3669,"雀":3670,"雁":3671,"雄":3672,"雅":3673,"集合":3674,"雏":3675,"雕":3676,"雨":3677,"雪梅":3678,"雹":3679,"雾蒙蒙":3680,"需":3681,"震":3682,"霉":3683,"霎":3684,"霏":3685,"霜":3686,"霞":3687,"露":3688,"霸":3689,"青":3690,"青蛙":3691,"静":3692,"静夜思":3693,"静寂":3694,"非常":3695,"面红耳赤":3696,"面面俱到":3697,"革":3698,"鞋":3699,"鞠":3700,"鞭":3701,"音":3702,"顶":3703,"顶天立地":3704,"项":3705,"顺":3706,"顺利":3707,"顽":3708,"顿":3709,"顿时":3710,"颇":3711,"颈":3712,"频频点头":3713,"颓":3714,"题临安邸":3715,"题西林壁":3716,"风":3717,"风号浪吼":3718,"风雨同舟":3719,"飕":3720,"飘":3721,"飞":3722,"飞入":3723,"饥":3724,"饮水思源":3725,"饮湖上初晴后雨":3726,"饰":3727,"饱":3728,"饱满":3729,"饱经风霜":3730,"饶":3731,"饺":3732,"饼":3733,"饿":3734,"馆":3735,"香甜":3736,"马":3737,"马上":3738,"马诗":3739,"驱":3740,"驼":3741,"骄":3742,"骄傲":3743,"骄傲自大":3744,"骆":3745,"高兴":3746,"鬟":3747,"鱼":3748,"鱼儿的家":3749,"鲈":3750,"鲜":3751,"鲜艳":3752,"鸟":3753,"鸟语花香":3754,"鸟鸣涧":3755,"鸡":3756,"鸭":3757,"鸯":3758,"鸳":3759,"鸿":3760,"鹅":3761,"鹊":3762,"鹬蚌相争":3763,"鹭":3764,"鹰":3765,"鹿柴":3766,"麦":3767,"黄鹤楼送孟浩然之广陵":3768,"默默无言":3769,"黛":3770,"鼎":3771,"鼓":3772,"龙":3773,"龙腾虎跃":3774},

  // 英语单词本地索引（20260823，key=小写单词，值N → sounds/sentences/5xxx.ogg，见 enwords_map）
  _enWordIdx: {"a":5001,"a.m.":5002,"abroad":5003,"actor":5004,"advice":5005,"afraid":5006,"africa":5007,"afternoon":5008,"again":5009,"ago":5010,"agree":5011,"ahead":5012,"air":5013,"airport":5014,"all":5015,"along":5016,"am":5017,"america":5018,"american":5019,"ancient":5020,"and":5021,"angry":5022,"animal":5023,"another":5024,"answer":5025,"any":5026,"anything":5027,"appear":5028,"apple":5029,"arm":5030,"around":5031,"arrive":5032,"art":5033,"as":5034,"asia":5035,"astronaut":5036,"ate":5037,"atomic":5038,"august":5039,"aunt":5040,"australia":5041,"australian":5042,"autumn":5043,"baby":5044,"back":5045,"bad":5046,"bag":5047,"ball":5048,"bamboo":5049,"banana":5050,"bank":5051,"basketball":5052,"bathroom":5053,"be":5054,"beach":5055,"bean":5056,"bear":5057,"beautiful":5058,"beauty":5059,"because":5060,"become":5061,"bed":5062,"bedroom":5063,"bee":5064,"begin":5065,"behind":5066,"believe":5067,"below":5068,"besides":5069,"better":5070,"big":5071,"bin":5072,"bird":5073,"birthday":5074,"black":5075,"blackboard":5076,"blue":5077,"body":5078,"boil":5079,"book":5080,"bookstore":5081,"boots":5082,"both":5083,"bottle":5084,"bottom":5085,"bought":5086,"box":5087,"boy":5088,"bread":5089,"breakfast":5090,"bridge":5091,"brightly":5092,"bring":5093,"broken":5094,"brother":5095,"brought":5096,"brush":5097,"bulb":5098,"bus":5099,"busy":5100,"but":5101,"buy":5102,"by":5103,"bye":5104,"cake":5105,"call":5106,"came":5107,"camp":5108,"can":5109,"canada":5110,"candy":5111,"capital":5112,"car":5113,"card":5114,"careful":5115,"careless":5116,"carrot":5117,"carry":5118,"cartoonist":5119,"cat":5120,"catch":5121,"celebrate":5122,"centre":5123,"chair":5124,"chance":5125,"cheap":5126,"check-up":5127,"cheer":5128,"chicken":5129,"china":5130,"chinatown":5131,"chinese":5132,"chocolate":5133,"choice":5134,"choose":5135,"chore":5136,"cinema":5137,"city":5138,"class":5139,"classmate":5140,"clear":5141,"clever":5142,"climb":5143,"closet":5144,"clothes":5145,"coat":5146,"coffee":5147,"cold":5148,"colour":5149,"colourful":5150,"comfortable":5151,"comic":5152,"computer":5153,"cook":5154,"cookie":5155,"cool":5156,"could":5157,"country":5158,"countryside":5159,"cousin":5160,"cow":5161,"crash":5162,"cross":5163,"crossing":5164,"crowded":5165,"cry":5166,"cut":5167,"cute":5168,"dad":5169,"dance":5170,"danger":5171,"dangerous":5172,"dark":5173,"date":5174,"dear":5175,"december":5176,"deer":5177,"delicious":5178,"desk":5179,"diary":5180,"did":5181,"die":5182,"diet":5183,"difficult":5184,"dinner":5185,"direction":5186,"dirty":5187,"disappear":5188,"dish":5189,"disneyland":5190,"do":5191,"doctor":5192,"dog":5193,"doll":5194,"door":5195,"down":5196,"dragon":5197,"draw":5198,"dream":5199,"dress":5200,"drink":5201,"driver":5202,"drop":5203,"dry":5204,"duck":5205,"dumpling":5206,"during":5207,"each":5208,"ear":5209,"earth":5210,"easy":5211,"eat":5212,"egg":5213,"eight":5214,"eighth":5215,"either":5216,"elephant":5217,"eleven":5218,"else":5219,"end":5220,"engineer":5221,"english":5222,"enjoy":5223,"enough":5224,"eraser":5225,"even":5226,"evening":5227,"ever":5228,"everyone":5229,"everything":5230,"except":5231,"excited":5232,"exciting":5233,"experience":5234,"eye":5235,"face":5236,"fair":5237,"fall":5238,"family":5239,"famous":5240,"fan":5241,"far":5242,"farm":5243,"farmer":5244,"fast":5245,"fat":5246,"father":5247,"favourite":5248,"february":5249,"feed":5250,"feeder":5251,"feel":5252,"felt":5253,"festival":5254,"fever":5255,"few":5256,"field":5257,"fifth":5258,"film":5259,"finally":5260,"find":5261,"fine":5262,"finger":5263,"fire":5264,"fireman":5265,"firework":5266,"first":5267,"fish":5268,"five":5269,"flag":5270,"floor":5271,"flower":5272,"fly":5273,"follow":5274,"foot":5275,"for":5276,"forest":5277,"forever":5278,"forget":5279,"forward":5280,"four":5281,"fox":5282,"france":5283,"free":5284,"fresh":5285,"friday":5286,"fridge":5287,"friend":5288,"frog":5289,"from":5290,"front":5291,"fruit":5292,"full":5293,"funny":5294,"fur":5295,"furry":5296,"future":5297,"game":5298,"gate":5299,"gave":5300,"get":5301,"gift":5302,"giraffe":5303,"girl":5304,"glad":5305,"gloves":5306,"glue":5307,"goat":5308,"good":5309,"goodbye":5310,"goose":5311,"grade":5312,"grandma":5313,"grandpa":5314,"grandparent":5315,"grape":5316,"grass":5317,"great":5318,"green":5319,"ground":5320,"group":5321,"grow":5322,"guess":5323,"guest":5324,"guy":5325,"hair":5326,"hamburger":5327,"hand":5328,"hang":5329,"happen":5330,"happy":5331,"harbin":5332,"harbour":5333,"hard":5334,"harder":5335,"hare":5336,"hat":5337,"have":5338,"head":5339,"headache":5340,"health":5341,"healthy":5342,"hear":5343,"heart":5344,"heavy":5345,"hello":5346,"help":5347,"here":5348,"hey":5349,"hi":5350,"him":5351,"himself":5352,"his":5353,"history":5354,"hole":5355,"hometown":5356,"honey":5357,"hope":5358,"horse":5359,"hospital":5360,"host":5361,"hot":5362,"hotel":5363,"hour":5364,"house":5365,"how":5366,"hungry":5367,"hurt":5368,"i":5369,"if":5370,"ill":5371,"impolite":5372,"important":5373,"in":5374,"inside":5375,"interesting":5376,"internet":5377,"into":5378,"invent":5379,"inventor":5380,"invitation":5381,"invite":5382,"island":5383,"it":5384,"its":5385,"jacket":5386,"japan":5387,"jeans":5388,"jeep":5389,"jiaozi":5390,"job":5391,"juice":5392,"jump":5393,"june":5394,"kangaroo":5395,"keep":5396,"kid":5397,"kind":5398,"kitchen":5399,"kite":5400,"kiwi":5401,"know":5402,"lake":5403,"land":5404,"lantern":5405,"last":5406,"late":5407,"later":5408,"laugh":5409,"lead":5410,"leader":5411,"leaf":5412,"least":5413,"leave":5414,"left":5415,"leg":5416,"less":5417,"let":5418,"letter":5419,"library":5420,"life":5421,"light":5422,"like":5423,"line":5424,"lion":5425,"listen":5426,"live":5427,"london":5428,"long":5429,"look":5430,"lose":5431,"lost":5432,"lot":5433,"loud":5434,"lucky":5435,"lunar":5436,"lunch":5437,"lunchroom":5438,"made":5439,"magic":5440,"mall":5441,"manager":5442,"manners":5443,"maple":5444,"march":5445,"market":5446,"match":5447,"maths":5448,"matter":5449,"me":5450,"meal":5451,"mean":5452,"meat":5453,"medicine":5454,"meet":5455,"meeting":5456,"met":5457,"microphone":5458,"middle":5459,"milk":5460,"mind":5461,"minute":5462,"miss":5463,"modern":5464,"monday":5465,"money":5466,"monkey":5467,"month":5468,"moon":5469,"mooncake":5470,"morning":5471,"most":5472,"mother":5473,"motorbike":5474,"mountain":5475,"mouse":5476,"mouth":5477,"move":5478,"movie":5479,"mr":5480,"mrs":5481,"ms":5482,"mum":5483,"museum":5484,"musician":5485,"must":5486,"my":5487,"myself":5488,"name":5489,"natural":5490,"nature":5491,"near":5492,"nearby":5493,"neck":5494,"never":5495,"new":5496,"newspaper":5497,"nice":5498,"night":5499,"nine":5500,"ninth":5501,"nod":5502,"noisy":5503,"none":5504,"noodle":5505,"noodles":5506,"noon":5507,"nose":5508,"not":5509,"note":5510,"nothing":5511,"now":5512,"nurse":5513,"ocean":5514,"of":5515,"office":5516,"often":5517,"oil":5518,"oily":5519,"ok":5520,"old":5521,"on":5522,"once":5523,"one":5524,"only":5525,"oops":5526,"open":5527,"opera":5528,"orange":5529,"other":5530,"ottawa":5531,"our":5532,"outside":5533,"panda":5534,"parent":5535,"paris":5536,"park":5537,"part":5538,"party":5539,"pass":5540,"passport":5541,"password":5542,"past":5543,"patient":5544,"pe":5545,"pencil":5546,"pencil-case":5547,"person":5548,"pet":5549,"photo":5550,"physics":5551,"piano":5552,"pick":5553,"picture":5554,"pig":5555,"ping-pong":5556,"pink":5557,"plan":5558,"plane":5559,"plant":5560,"plastic":5561,"plate":5562,"play":5563,"playground":5564,"poet":5565,"policeman":5566,"policewoman":5567,"polite":5568,"pollute":5569,"poor":5570,"postcard":5571,"poster":5572,"pot":5573,"prefer":5574,"problem":5575,"professor":5576,"proud":5577,"province":5578,"purple":5579,"push":5580,"put":5581,"puzzle":5582,"quiet":5583,"rabbit":5584,"race":5585,"rain":5586,"read":5587,"reading":5588,"ready":5589,"really":5590,"red":5591,"remember":5592,"report":5593,"rest":5594,"restaurant":5595,"reunion":5596,"review":5597,"rice":5598,"ride":5599,"right":5600,"river":5601,"road":5602,"robot":5603,"room":5604,"rose":5605,"rubbish":5606,"ruler":5607,"run":5608,"sad":5609,"safe":5610,"safety":5611,"salad":5612,"salt":5613,"same":5614,"sandals":5615,"sandwich":5616,"sat":5617,"saturday":5618,"sausage":5619,"save":5620,"saw":5621,"say":5622,"scarf":5623,"scary":5624,"science":5625,"scientist":5626,"scooter":5627,"sea":5628,"season":5629,"seat":5630,"second":5631,"secret":5632,"see":5633,"seem":5634,"sell":5635,"sentence":5636,"september":5637,"seven":5638,"several":5639,"share":5640,"sharp":5641,"she":5642,"sheep":5643,"shirt":5644,"shoe":5645,"shoes":5646,"shop":5647,"short":5648,"shorts":5649,"sign":5650,"silly":5651,"simple":5652,"sing":5653,"sink":5654,"sister":5655,"sit":5656,"six":5657,"skate":5658,"ski":5659,"skill":5660,"skip":5661,"skirt":5662,"sleep":5663,"slow":5664,"small":5665,"smile":5666,"snow":5667,"sock":5668,"socks":5669,"sofa":5670,"someone":5671,"something":5672,"song":5673,"sound":5674,"soup":5675,"space":5676,"special":5677,"spell":5678,"spend":5679,"spider":5680,"spoon":5681,"spring":5682,"stair":5683,"stand":5684,"star":5685,"starfish":5686,"start":5687,"steady":5688,"step":5689,"still":5690,"stomachache":5691,"stop":5692,"store":5693,"story":5694,"straight":5695,"stranger":5696,"street":5697,"strong":5698,"student":5699,"study":5700,"such":5701,"suddenly":5702,"summer":5703,"sun":5704,"sunday":5705,"sunglasses":5706,"sunny":5707,"supermarket":5708,"sure":5709,"surf":5710,"surprise":5711,"surprised":5712,"sweater":5713,"sweep":5714,"sweet":5715,"swim":5716,"sydney":5717,"t-shirt":5718,"table":5719,"take":5720,"tall":5721,"tank":5722,"taste":5723,"taxi":5724,"tea":5725,"teach":5726,"teacher":5727,"team":5728,"tell":5729,"temperature":5730,"ten":5731,"tennis":5732,"test":5733,"than":5734,"thank":5735,"thanks!":5736,"that":5737,"the":5738,"theatre":5739,"their":5740,"them":5741,"then":5742,"these":5743,"they":5744,"thin":5745,"third":5746,"thirty":5747,"this":5748,"those":5749,"three":5750,"through":5751,"throw":5752,"thursday":5753,"ticket":5754,"tidy":5755,"tiger":5756,"time":5757,"tired":5758,"to":5759,"today":5760,"tofu":5761,"toilet":5762,"tokyo":5763,"tomorrow":5764,"too":5765,"took":5766,"tooth":5767,"toothache":5768,"toronto":5769,"tortoise":5770,"tour":5771,"tower":5772,"town":5773,"traffic":5774,"train":5775,"trainers":5776,"travel":5777,"tree":5778,"trip":5779,"trouble":5780,"trousers":5781,"tuesday":5782,"turn":5783,"turtle":5784,"twelve":5785,"twice":5786,"two":5787,"umbrella":5788,"uncle":5789,"under":5790,"underground":5791,"understanding":5792,"university":5793,"until":5794,"up":5795,"upset":5796,"us":5797,"usually":5798,"valley":5799,"vegetable":5800,"video":5801,"village":5802,"visit":5803,"walk":5804,"want":5805,"warm":5806,"wash":5807,"washroom":5808,"watch":5809,"water":5810,"waterfall":5811,"watermelon":5812,"way":5813,"wear":5814,"weather":5815,"wednesday":5816,"weekend":5817,"welcome":5818,"well":5819,"wellington":5820,"were":5821,"whale":5822,"what":5823,"when":5824,"where":5825,"which":5826,"white":5827,"who":5828,"why?":5829,"wide":5830,"win":5831,"wind":5832,"windy":5833,"winter":5834,"wish":5835,"without":5836,"wonton":5837,"word":5838,"wore":5839,"worker":5840,"world":5841,"worry":5842,"would":5843,"write":5844,"wrong":5845,"year":5846,"yellow":5847,"yes":5848,"yesterday":5849,"you":5850,"your":5851,"yourself":5852,"zero":5853,"zongzi":5854,"zoo":5855,"a baby sister":5856,"a black sheep":5857,"a cup of tea":5858,"a dark horse":5859,"a few":5860,"a fruit tree":5861,"a home bird":5862,"a light jacket":5863,"a little":5864,"a music show":5865,"a pair of shorts":5866,"a pair of trousers":5867,"a red dress":5868,"add seasoning":5869,"add some water":5870,"add the greens":5871,"add the noodles":5872,"after that, i ...":5873,"all day":5874,"all day long":5875,"an apple tree":5876,"ask others to join in":5877,"at least":5878,"at the end of dinner":5879,"back then":5880,"be afraid ...":5881,"be called":5882,"be careful":5883,"be careful with fire":5884,"be going to":5885,"be ready to help":5886,"beautiful flowers":5887,"before you go":5888,"beijing time":5889,"best wishes":5890,"big ben":5891,"brush my teeth":5892,"busy as a bee":5893,"buy a birthday cake":5894,"bye (goodbye)":5895,"can i have a turn?":5896,"can i join you?":5897,"can you say that again?":5898,"carry food boxes":5899,"carry on ( with )...":5900,"cheer up a friend":5901,"chongyang festival":5902,"classroom rules":5903,"clean the table":5904,"clean up":5905,"clear the table":5906,"clever as a fox":5907,"close the window":5908,"cold and snowy":5909,"coloured pencil":5910,"comb my hair":5911,"come and play!":5912,"come home":5913,"come up to the top":5914,"computer classroom":5915,"cook birthday noodles":5916,"cook dinner":5917,"cook together":5918,"cool and rainy":5919,"department store":5920,"different to ...":5921,"dim sum":5922,"do a puzzle":5923,"do chores":5924,"do my homework":5925,"do you want to join us?":5926,"do you want to try?":5927,"do your best":5928,"don't eat or drink":5929,"don't forget to ...":5930,"don't run in the classroom":5931,"don't run in the hallway":5932,"donald duck":5933,"dr=doctor":5934,"dragon boat festival":5935,"draw a ...":5936,"each other":5937,"easy to grow":5938,"eat healthy foods":5939,"eat mooncakes":5940,"eight twenty":5941,"except for":5942,"excuse me.":5943,"exercise together":5944,"face the speaker":5945,"fall down":5946,"far away":5947,"farmers' market":5948,"fly a kite":5949,"fly like a bird":5950,"fold a sweater":5951,"french fries":5952,"from then on":5953,"get dressed":5954,"get enough sleep":5955,"get hurt":5956,"get in line":5957,"get up":5958,"give a gift":5959,"give a helping hand":5960,"give out gifts":5961,"go ahead.":5962,"go camping":5963,"go fishing":5964,"go for a walk":5965,"go for it":5966,"go hiking":5967,"go home":5968,"go on green":5969,"go running":5970,"go shopping":5971,"go skating":5972,"go swimming":5973,"go to a school club":5974,"go to bed":5975,"go to school":5976,"go to the beach":5977,"go to work":5978,"golden gate bridge":5979,"good morning!":5980,"green grass":5981,"green vegetables":5982,"grow taller":5983,"half an hour":5984,"half past ten":5985,"hand out food":5986,"hand out papers":5987,"hang up":5988,"happen ( to )":5989,"have a big meal":5990,"have a cold":5991,"have a good time":5992,"have a look":5993,"have a meal":5994,"have a video call":5995,"have breakfast":5996,"have class":5997,"have dinner":5998,"have lunch":5999,"have some rice":6000,"have tea":6001,"help ... with ...":6002,"help everyone stand in line":6003,"help out":6004,"help yourself to...":6005,"hold the door":6006,"hold your horses":6007,"hong kong":6008,"hot and sunny":6009,"how can you be a good listener?":6010,"how do you spell ...?":6011,"how long":6012,"hurry up":6013,"i ...":6014,"i ... at ...":6015,"i ... from ... to ...":6016,"i am ...":6017,"i have a question.":6018,"i like \"...\"":6019,"i see.":6020,"i want to ...":6021,"i want to be a/an ...":6022,"i'd like to ...":6023,"i'd like to... = i would like to...":6024,"i'd love to!":6025,"i'm ...":6026,"i'm late!":6027,"i'm sorry to hear that.":6028,"ice cream":6029,"in danger":6030,"in line":6031,"in need":6032,"in such a hurry":6033,"in the afternoon":6034,"in the evening":6035,"in the morning":6036,"in the toilet":6037,"in trouble":6038,"it worker":6039,"it's ...":6040,"it's good to see you!":6041,"it's okay.":6042,"it's time to ...":6043,"jump like a monkey":6044,"keep a good diet":6045,"keep quiet":6046,"keep to the right":6047,"keep your voice down":6048,"kung fu":6049,"lantern festival":6050,"last name":6051,"laugh at":6052,"lead the way":6053,"left hand":6054,"let's ...":6055,"light bulb":6056,"light up":6057,"line leader":6058,"listen carefully":6059,"listen to my teacher":6060,"living room":6061,"long ago":6062,"look left":6063,"look right":6064,"lucky money":6065,"lunch helper":6066,"make a snowman":6067,"make from":6068,"make rice dumplings":6069,"mickey mouse":6070,"mid-autumn festival":6071,"mop the floor":6072,"mopping the floor":6073,"mountain climbing":6074,"music classroom":6075,"my name is ...":6076,"new york":6077,"new zealand":6078,"nice to meet you!":6079,"nine ten":6080,"no problem.":6081,"no, thanks! ... is just not my thing.":6082,"no/ not ... at all":6083,"nod my head":6084,"oh dear!":6085,"oh, sorry!":6086,"on duty":6087,"on foot":6088,"on time":6089,"once a day":6090,"open day":6091,"orange juice":6092,"out of...":6093,"over there":6094,"pack my schoolbag":6095,"pak choi":6096,"pick it up":6097,"pick up":6098,"play a game":6099,"play basketball":6100,"play football":6101,"play ping-pong":6102,"play sports":6103,"play the piano":6104,"police station":6105,"post office":6106,"push in":6107,"put away books":6108,"put away the dishes":6109,"put away the leftovers":6110,"put away the sweaters":6111,"put away your things":6112,"put on":6113,"put them into a drawer":6114,"put up my hand":6115,"quiet as a mouse":6116,"rain cats and dogs":6117,"read a book":6118,"read books":6119,"ride a bike":6120,"right hand":6121,"road sign":6122,"run like a horse":6123,"safety rules":6124,"san francisco":6125,"say \"excuse me\"":6126,"say nice words":6127,"see a doctor":6128,"set the table":6129,"setting the table":6130,"seven forty":6131,"shopping mall":6132,"short cut":6133,"show me ..., please.":6134,"show you around":6135,"sing a song":6136,"six fifty":6137,"skip rope":6138,"skipping rope":6139,"smile and say hi to others":6140,"south africa":6141,"spring festival":6142,"stir the noodles":6143,"stop on red":6144,"strong wind":6145,"sure! ...":6146,"surf the internet":6147,"sweep the floor":6148,"swim like a fish":6149,"swimming pool":6150,"sydney harbour bridge":6151,"sydney opera house":6152,"tai chi":6153,"take a rest":6154,"take a walk":6155,"take breaks":6156,"take out a t-shirt":6157,"take out the rubbish":6158,"take photos of animals":6159,"take the first right":6160,"take turns to speak":6161,"taxi driver":6162,"teacher helper":6163,"teddy bear":6164,"ten o'clock":6165,"ten thirty":6166,"thank you!":6167,"that looks like fun.":6168,"the great wall":6169,"the summer palace":6170,"the united states":6171,"then, i ...":6172,"these are ...":6173,"they are \"...\", \"...\" and \"...\".":6174,"this is ...":6175,"this is my ...":6176,"time difference":6177,"too... to...":6178,"tower bridge":6179,"train station":6180,"try some fish":6181,"try your best":6182,"turn on the lights":6183,"twice a month":6184,"twice a week":6185,"use the computer with care":6186,"visit family and friends":6187,"wait your turn":6188,"wake up":6189,"walk like a bear":6190,"warm and windy":6191,"wash my face":6192,"wash the dishes":6193,"wash the greens":6194,"wash up":6195,"wash your hands":6196,"washing up":6197,"watch a film":6198,"watch fireworks":6199,"watch out":6200,"watch tv":6201,"water festival":6202,"we should ... and ...":6203,"what are the rules in your class?":6204,"what colour is ...?":6205,"what do you do in ...?":6206,"what do you want to be?":6207,"what do you want to do?":6208,"what rules do you like?":6209,"what should we do at school?":6210,"what time do you ...?":6211,"what time is it?":6212,"what would you like to do?":6213,"what's the ...?":6214,"what's the matter?":6215,"what's the wi-fi password?":6216,"what's this?":6217,"what's your name?":6218,"work hard":6219,"would you like...?":6220,"you are here.":6221,"you can go first.":6222,"you're ...":6223,"you're up next!":6224,"you're welcome.":6225},
  // 古诗整诗本地索引（111首，key=正文yi原文，值N → sounds/sentences/1xxx.ogg 即 1000+N，见 poems_map）
  _zhPoemIdx: {"红军不怕远征难，万水千山只等闲。五岭逶迤腾细浪，乌蒙磅礴走泥丸。金沙水拍云崖暖，大渡桥横铁索寒。更喜岷山千里雪，三军过后尽开颜。":0,"梅子黄时日日晴，小溪泛尽却山行。绿阴不减来时路，添得黄鹂四五声。":1,"独在异乡为异客，每逢佳节倍思亲。遥知兄弟登高处，遍插茱萸少一人。":2,"七夕今宵看碧霄，牵牛织女渡河桥。家家乞巧望秋月，穿尽红丝几万条。":3,"绿遍山原白满川，子规声里雨如烟。乡村四月闲人少，才了蚕桑又插田。":4,"茅檐长扫净无苔，花木成畦手自栽。一水护田将绿绕，两山排闼送青来。":5,"青海长云暗雪山，孤城遥望玉门关。黄沙百战穿金甲，不破楼兰终不还。":6,"爆竹声中一岁除，春风送暖入屠苏。千门万户曈曈日，总把新桃换旧符。":7,"黑云翻墨未遮山，白雨跳珠乱入船。卷地风来忽吹散，望湖楼下水如天。":8,"葡萄美酒夜光杯，欲饮琵琶马上催。醉卧沙场君莫笑，古来征战几人回。":9,"黄河远上白云间，一片孤城万仞山。羌笛何须怨杨柳，春风不度玉门关。":10,"秦时明月汉时关，万里长征人未还。但使龙城飞将在，不教胡马度阴山。":11,"千里黄云白日曛，北风吹雁雪纷纷。莫愁前路无知己，天下谁人不识君。":12,"中庭地白树栖鸦，冷露无声湿桂花。今夜月明人尽望，不知秋思落谁家。":13,"风雨送春归，飞雪迎春到。已是悬崖百丈冰，犹有花枝俏。俏也不争春，只把春来报。待到山花烂漫时，她在丛中笑。":14,"水是眼波横，山是眉峰聚。欲问行人去那边？眉眼盈盈处。才始送春归，又送君归去。若到江南赶上春，千万和春住。":15,"小时不识月，呼作白玉盘。又疑瑶台镜，飞在青云端。":16,"碧玉妆成一树高，万条垂下绿丝绦。不知细叶谁裁出，二月春风似剪刀。":17,"鹅，鹅，鹅，曲项向天歌。白毛浮绿水，红掌拨清波。":18,"昼出耘田夜绩麻，村庄儿女各当家。童孙未解供耕织，也傍桑阴学种瓜。":19,"梅子金黄杏子肥，麦花雪白菜花稀。日长篱落无人过，惟有蜻蜓蛱蝶飞。":20,"少小离家老大回，乡音无改鬓毛衰。儿童相见不相识，笑问客从何处来。":21,"月黑雁飞高，单于夜遁逃。欲将轻骑逐，大雪满弓刀。":22,"我家洗砚池头树，朵朵花开淡墨痕。不要人夸好颜色，只留清气满乾坤。":23,"生当作人杰，死亦为鬼雄。至今思项羽，不肯过江东。":24,"萧萧梧叶送寒声，江上秋风动客情。知有儿童挑促织，夜深篱落一灯明。":25,"危楼高百尺，手可摘星辰。不敢高声语，恐惊天上人。":26,"人间四月芳菲尽，山寺桃花始盛开。长恨春归无觅处，不知转入此中来。":27,"云母屏风烛影深，长河渐落晓星沉。嫦娥应悔偷灵药，碧海青天夜夜心。":28,"移舟泊烟渚，日暮客愁新。野旷天低树，江清月近人。":29,"篱落疏疏一径深，树头新绿未成阴。儿童急走追黄蝶，飞入菜花无处寻。":30,"春城无处不飞花，寒食东风御柳斜。日暮汉宫传蜡烛，轻烟散入五侯家。":31,"松下问童子，言师采药去。只在此山中，云深不知处。":32,"蓬头稚子学垂纶，侧坐莓苔草映身。路人借问遥招手，怕得鱼惊不应人。":33,"泉眼无声惜细流，树阴照水爱晴柔。小荷才露尖尖角，早有蜻蜓立上头。":34,"空山新雨后，天气晚来秋。明月松间照，清泉石上流。竹喧归浣女，莲动下渔舟。随意春芳歇，王孙自可留。":35,"远上寒山石径斜，白云生处有人家。停车坐爱枫林晚，霜叶红于二月花。":36,"九州生气恃风雷，万马齐喑究可哀。我劝天公重抖擞，不拘一格降人才。":37,"江南好，风景旧曾谙。日出江花红胜火，春来江水绿如蓝。能不忆江南？":38,"春种一粒粟，秋收万颗子。四海无闲田，农夫犹饿死。":39,"锄禾日当午，汗滴禾下土。谁知盘中餐，粒粒皆辛苦。":40,"竹外桃花三两枝，春江水暖鸭先知。蒌蒿满地芦芽短，正是河豚欲上时。":41,"牧童骑黄牛，歌声振林樾。意欲捕鸣蝉，忽然闭口立。":42,"敕勒川，阴山下。天似穹庐，笼盖四野。天苍苍，野茫茫，风吹草低见牛羊。":43,"朝辞白帝彩云间，千里江陵一日还。两岸猿声啼不住，轻舟已过万重山。":44,"天街小雨润如酥，草色遥看近却无。最是一年春好处，绝胜烟柳满皇都。":45,"好雨知时节，当春乃发生。随风潜入夜，润物细无声。野径云俱黑，江船火独明。晓看红湿处，花重锦官城。":46,"胜日寻芳泗水滨，无边光景一时新。等闲识得东风面，万紫千红总是春。":47,"春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。":48,"毕竟西湖六月中，风光不与四时同。接天莲叶无穷碧，映日荷花别样红。":49,"一道残阳铺水中，半江瑟瑟半江红。可怜九月初三夜，露似真珠月似弓。":50,"天门中断楚江开，碧水东流至此回。两岸青山相对出，孤帆一片日边来。":51,"日照香炉生紫烟，遥看瀑布挂前川。飞流直下三千尺，疑是银河落九天。":52,"湖光秋月两相和，潭面无风镜未磨。遥望洞庭山水翠，白银盘里一青螺。":53,"草长莺飞二月天，拂堤杨柳醉春烟。儿童散学归来早，忙趁东风放纸鸢。":54,"草满池塘水满陂，山衔落日浸寒漪。牧童归去横牛背，短笛无腔信口吹。":55,"月落乌啼霜满天，江枫渔火对愁眠。姑苏城外寒山寺，夜半钟声到客船。":56,"墙角数枝梅，凌寒独自开。遥知不是雪，为有暗香来。":57,"江上往来人，但爱鲈鱼美。君看一叶舟，出没风波里。":58,"江南可采莲，莲叶何田田。鱼戏莲叶间。鱼戏莲叶东，鱼戏莲叶西，鱼戏莲叶南，鱼戏莲叶北。":59,"千里莺啼绿映红，水村山郭酒旗风。南朝四百八十寺，多少楼台烟雨中。":60,"黄四娘家花满蹊，千朵万朵压枝低。留连戏蝶时时舞，自在娇莺恰恰啼。":61,"千山鸟飞绝，万径人踪灭。孤舟蓑笠翁，独钓寒江雪。":62,"小娃撑小艇，偷采白莲回。不解藏踪迹，浮萍一道开。":63,"京口瓜洲一水间，钟山只隔数重山。春风又绿江南岸，明月何时照我还。":64,"游蕲水清泉寺，寺临兰溪，溪水西流。山下兰芽短浸溪，松间沙路净无泥，潇潇暮雨子规啼。谁道人生无再少？门前流水尚能西！休将白发唱黄鸡。":65,"九曲黄河万里沙，浪淘风簸自天涯。如今直上银河去，同到牵牛织女家。":66,"八月涛声吼地来，头高数丈触山回。须臾却入海门去，卷起沙堆似雪堆。":67,"春归何处？寂寞无行路。若有人知春去处，唤取归来同住。春无踪迹谁知？除非问取黄鹂。百啭无人能解，因风飞过蔷薇。":68,"茅檐低小，溪上青青草。醉里吴音相媚好，白发谁家翁媪？大儿锄豆溪东，中儿正织鸡笼。最喜小儿亡赖，溪头卧剥莲蓬。":69,"清明时节雨纷纷，路上行人欲断魂。借问酒家何处有，牧童遥指杏花村。":70,"西塞山前白鹭飞，桃花流水鳜鱼肥。青箬笠，绿蓑衣，斜风细雨不须归。":71,"应怜屐齿印苍苔，小扣柴扉久不开。春色满园关不住，一枝红杏出墙来。":72,"慈母手中线，游子身上衣。临行密密缝，意恐迟迟归。谁言寸草心，报得三春晖。":73,"独怜幽草涧边生，上有黄鹂深树鸣。春潮带雨晚来急，野渡无人舟自横。":74,"众鸟高飞尽，孤云独去闲。相看两不厌，只有敬亭山。":75,"远看山有色，近听水无声。春去花还在，人来鸟不惊。":76,"白日依山尽，黄河入海流。欲穷千里目，更上一层楼。":77,"千锤万凿出深山，烈火焚烧若等闲。粉骨碎身浑不怕，要留清白在人间。":78,"死去元知万事空，但悲不见九州同。王师北定中原日，家祭无忘告乃翁。":79,"三万里河东入海，五千仞岳上摩天。遗民泪尽胡尘里，南望王师又一年。":80,"稚子金盆脱晓冰，彩丝穿取当银钲。敲成玉磬穿林响，忽作玻璃碎地声。":81,"咬定青山不放松，立根原在破岩中。千磨万击还坚劲，任尔东西南北风。":82,"两个黄鹂鸣翠柳，一行白鹭上青天。窗含西岭千秋雪，门泊东吴万里船。":83,"迟日江山丽，春风花草香。泥融飞燕子，沙暖睡鸳鸯。":84,"月黑见渔灯，孤光一点萤。微微风簇浪，散作满河星。":85,"寒雨连江夜入吴，平明送客楚山孤。洛阳亲友如相问，一片冰心在玉壶。":86,"赤橙黄绿青蓝紫，谁持彩练当空舞？雨后复斜阳，关山阵阵苍。当年鏖战急，弹洞前村壁。装点此关山，今朝更好看。":87,"不论平地与山尖，无限风光尽被占。采得百花成蜜后，为谁辛苦为谁甜。":88,"垂緌饮清露，流响出疏桐。居高声自远，非是藉秋风。":89,"明月别枝惊鹊，清风半夜鸣蝉。稻花香里说丰年，听取蛙声一片。七八个星天外，两三点雨山前。旧时茅店社林边，路转溪桥忽见。":90,"离离原上草，一岁一枯荣。野火烧不尽，春风吹又生。":91,"荷尽已无擎雨盖，菊残犹有傲霜枝。一年好景君须记，最是橙黄橘绿时。":92,"李白乘舟将欲行，忽闻岸上踏歌声。桃花潭水深千尺，不及汪伦送我情。":93,"故人具鸡黍，邀我至田家。绿树村边合，青山郭外斜。开轩面场圃，把酒话桑麻。待到重阳日，还来就菊花。":94,"渭城朝雨浥轻尘，客舍青青柳色新。劝君更尽一杯酒，西出阳关无故人。":95,"荷叶罗裙一色裁，芙蓉向脸两边开。乱入池中看不见，闻歌始觉有人来。":96,"昔我往矣，杨柳依依。今我来思，雨雪霏霏。行道迟迟，载渴载饥。我心伤悲，莫知我哀！":97,"青青园中葵，朝露待日晞。阳春布德泽，万物生光辉。常恐秋节至，焜黄华叶衰。百川东到海，何时复西归？少壮不努力，老大徒伤悲！":98,"山一程，水一程，身向榆关那畔行，夜深千帐灯。风一更，雪一更，聒碎乡心梦不成，故园无此声。":99,"剑外忽传收蓟北，初闻涕泪满衣裳。却看妻子愁何在，漫卷诗书喜欲狂。白日放歌须纵酒，青春作伴好还乡。即从巴峡穿巫峡，便下襄阳向洛阳。":100,"梅雪争春未肯降，骚人阁笔费评章。梅须逊雪三分白，雪却输梅一段香。":101,"床前明月光，疑是地上霜。举头望明月，低头思故乡。":102,"山外青山楼外楼，西湖歌舞几时休？暖风熏得游人醉，直把杭州作汴州。":103,"横看成岭侧成峰，远近高低各不同。不识庐山真面目，只缘身在此山中。":104,"解落三秋叶，能开二月花。过江千尺浪，入竹万竿斜。":105,"水光潋滟晴方好，山色空蒙雨亦奇。欲把西湖比西子，淡妆浓抹总相宜。":106,"大漠沙如雪，燕山月似钩。何当金络脑，快走踏清秋。":107,"人闲桂花落，夜静春山空。月出惊山鸟，时鸣春涧中。":108,"空山不见人，但闻人语响。返景入深林，复照青苔上。":109,"故人西辞黄鹤楼，烟花三月下扬州。孤帆远影碧空尽，唯见长江天际流。":110},

  _zhPyIdx: {
    'ài': 0,
    'ǎi': 1,
    'āi': 2,
    'àn': 3,
    'ǎn': 4,
    'ān': 5,
    'áng': 6,
    'àng': 7,
    'áo': 8,
    'ào': 9,
    'ǎo': 10,
    'bá': 11,
    'bà': 12,
    'bǎ': 13,
    'bā': 14,
    'bái': 15,
    'bài': 16,
    'bǎi': 17,
    'bàn': 18,
    'bān': 19,
    'bàng': 20,
    'bǎng': 21,
    'bāng': 22,
    'báo': 23,
    'bào': 24,
    'bǎo': 25,
    'bāo': 26,
    'bèi': 27,
    'běi': 28,
    'bēi': 29,
    'běn': 30,
    'bēn': 31,
    'bèng': 32,
    'bēng': 33,
    'bì': 34,
    'bǐ': 35,
    'biàn': 36,
    'biān': 37,
    'biāo': 38,
    'bié': 39,
    'bìn': 40,
    'bīn': 41,
    'bǐng': 42,
    'bīng': 43,
    'bó': 44,
    'bǒ': 45,
    'bō': 46,
    'bú': 47,
    'bù': 48,
    'bǔ': 49,
    'cā': 50,
    'cái': 51,
    'cài': 52,
    'cǎi': 53,
    'cāi': 54,
    'cáng': 55,
    'cāng': 56,
    'cáo': 57,
    'cǎo': 58,
    'cāo': 59,
    'céng': 60,
    'cèng': 61,
    'chá': 62,
    'chā': 63,
    'chāi': 64,
    'chán': 65,
    'chǎn': 66,
    'cháng': 67,
    'chàng': 68,
    'cháo': 69,
    'chāo': 70,
    'chè': 71,
    'chē': 72,
    'chén': 73,
    'chèn': 74,
    'chéng': 75,
    'chēng': 76,
    'chí': 77,
    'chì': 78,
    'chǐ': 79,
    'chī': 80,
    'chóng': 81,
    'chōng': 82,
    'chóu': 83,
    'chú': 84,
    'chù': 85,
    'chǔ': 86,
    'chū': 87,
    'chuán': 88,
    'chuān': 89,
    'chuáng': 90,
    'chuí': 91,
    'chuī': 92,
    'chún': 93,
    'chūn': 94,
    'cí': 95,
    'cì': 96,
    'cóng': 97,
    'cōng': 98,
    'còu': 99,
    'cù': 100,
    'cū': 101,
    'cuì': 102,
    'cuī': 103,
    'cùn': 104,
    'cūn': 105,
    'cuò': 106,
    'cuō': 107,
    'da': 108,
    'dà': 109,
    'dǎ': 110,
    'dā': 111,
    'dai': 112,
    'dài': 113,
    'dǎi': 114,
    'dàn': 115,
    'dǎn': 116,
    'dān': 117,
    'dàng': 118,
    'dǎng': 119,
    'dāng': 120,
    'dào': 121,
    'dǎo': 122,
    'dāo': 123,
    'de': 124,
    'dé': 125,
    'dèng': 126,
    'dēng': 127,
    'dí': 128,
    'dì': 129,
    'dǐ': 130,
    'dī': 131,
    'diàn': 132,
    'diǎn': 133,
    'diào': 134,
    'diāo': 135,
    'dié': 136,
    'diē': 137,
    'dǐng': 138,
    'dīng': 139,
    'dòng': 140,
    'dǒng': 141,
    'dōng': 142,
    'dòu': 143,
    'dǒu': 144,
    'dōu': 145,
    'dú': 146,
    'dù': 147,
    'dǔ': 148,
    'dū': 149,
    'duàn': 150,
    'duǎn': 151,
    'duān': 152,
    'duì': 153,
    'duī': 154,
    'dùn': 155,
    'dūn': 156,
    'duó': 157,
    'duò': 158,
    'duǒ': 159,
    'duō': 160,
    'é': 161,
    'è': 162,
    'er': 163,
    'ér': 164,
    'èr': 165,
    'ěr': 166,
    'fá': 167,
    'fà': 168,
    'fǎ': 169,
    'fā': 170,
    'fán': 171,
    'fàn': 172,
    'fǎn': 173,
    'fān': 174,
    'fàng': 175,
    'fǎng': 176,
    'fāng': 177,
    'féi': 178,
    'fèi': 179,
    'fēi': 180,
    'fèn': 181,
    'fěn': 182,
    'fēn': 183,
    'féng': 184,
    'fèng': 185,
    'fěng': 186,
    'fēng': 187,
    'fu': 188,
    'fú': 189,
    'fù': 190,
    'fǔ': 191,
    'fū': 192,
    'gǎi': 193,
    'gàn': 194,
    'gǎn': 195,
    'gān': 196,
    'gāng': 197,
    'gào': 198,
    'gǎo': 199,
    'gāo': 200,
    'gé': 201,
    'gè': 202,
    'gē': 203,
    'gēn': 204,
    'gèng': 205,
    'gēng': 206,
    'gōng': 207,
    'gòu': 208,
    'gǒu': 209,
    'gōu': 210,
    'gù': 211,
    'gǔ': 212,
    'gū': 213,
    'guā': 214,
    'guài': 215,
    'guǎi': 216,
    'guàn': 217,
    'guǎn': 218,
    'guān': 219,
    'guàng': 220,
    'guǎng': 221,
    'guāng': 222,
    'guì': 223,
    'guī': 224,
    'gùn': 225,
    'gǔn': 226,
    'guó': 227,
    'guō': 228,
    'hái': 229,
    'hài': 230,
    'hǎi': 231,
    'hán': 232,
    'hàn': 233,
    'hǎn': 234,
    'háng': 235,
    'háo': 236,
    'hào': 237,
    'hǎo': 238,
    'hé': 239,
    'hè': 240,
    'hēi': 241,
    'hén': 242,
    'hěn': 243,
    'héng': 244,
    'hóng': 245,
    'hóu': 246,
    'hòu': 247,
    'hǒu': 248,
    'hú': 249,
    'hù': 250,
    'hǔ': 251,
    'hū': 252,
    'huà': 253,
    'huā': 254,
    'huái': 255,
    'huán': 256,
    'huàn': 257,
    'huǎn': 258,
    'huān': 259,
    'huáng': 260,
    'huàng': 261,
    'huǎng': 262,
    'huāng': 263,
    'huí': 264,
    'huì': 265,
    'huǐ': 266,
    'huī': 267,
    'hūn': 268,
    'huó': 269,
    'huò': 270,
    'huǒ': 271,
    'huō': 272,
    'jí': 273,
    'jì': 274,
    'jǐ': 275,
    'jī': 276,
    'jià': 277,
    'jiǎ': 278,
    'jiā': 279,
    'jiàn': 280,
    'jiǎn': 281,
    'jiān': 282,
    'jiàng': 283,
    'jiǎng': 284,
    'jiāng': 285,
    'jiào': 286,
    'jiǎo': 287,
    'jiāo': 288,
    'jié': 289,
    'jiè': 290,
    'jiě': 291,
    'jiē': 292,
    'jìn': 293,
    'jǐn': 294,
    'jīn': 295,
    'jìng': 296,
    'jǐng': 297,
    'jīng': 298,
    'jiù': 299,
    'jiǔ': 300,
    'jiū': 301,
    'jú': 302,
    'jù': 303,
    'jǔ': 304,
    'jū': 305,
    'juàn': 306,
    'juǎn': 307,
    'juān': 308,
    'jué': 309,
    'jùn': 310,
    'jūn': 311,
    'kǎi': 312,
    'kāi': 313,
    'kàn': 314,
    'kǎn': 315,
    'kǎo': 316,
    'kè': 317,
    'kě': 318,
    'kē': 319,
    'kěn': 320,
    'kòng': 321,
    'kǒng': 322,
    'kōng': 323,
    'kòu': 324,
    'kǒu': 325,
    'kù': 326,
    'kǔ': 327,
    'kuà': 328,
    'kuai': 329,
    'kuài': 330,
    'kuǎn': 331,
    'kuān': 332,
    'kuáng': 333,
    'kuāng': 334,
    'kuì': 335,
    'kūn': 336,
    'kuò': 337,
    'la': 338,
    'là': 339,
    'lái': 340,
    'lài': 341,
    'lán': 342,
    'làn': 343,
    'lǎn': 344,
    'láng': 345,
    'làng': 346,
    'lǎng': 347,
    'láo': 348,
    'lǎo': 349,
    'le': 350,
    'lè': 351,
    'lèi': 352,
    'lěi': 353,
    'lèng': 354,
    'li': 355,
    'lí': 356,
    'lì': 357,
    'lǐ': 358,
    'lián': 359,
    'liàn': 360,
    'liáng': 361,
    'liàng': 362,
    'liǎng': 363,
    'liáo': 364,
    'liè': 365,
    'lín': 366,
    'lǐn': 367,
    'líng': 368,
    'lǐng': 369,
    'liú': 370,
    'liù': 371,
    'liǔ': 372,
    'lóng': 373,
    'lǒng': 374,
    'lǒu': 375,
    'lú': 376,
    'lù': 377,
    'lǜ': 378,
    'lǚ': 379,
    'luàn': 380,
    'lüè': 381,
    'lún': 382,
    'lùn': 383,
    'lūn': 384,
    'luó': 385,
    'luò': 386,
    'luǒ': 387,
    'ma': 388,
    'má': 389,
    'mǎ': 390,
    'mā': 391,
    'mái': 392,
    'mài': 393,
    'mǎi': 394,
    'màn': 395,
    'mǎn': 396,
    'máng': 397,
    'máo': 398,
    'mào': 399,
    'me': 400,
    'méi': 401,
    'mèi': 402,
    'měi': 403,
    'mén': 404,
    'méng': 405,
    'mèng': 406,
    'měng': 407,
    'mí': 408,
    'mì': 409,
    'mǐ': 410,
    'mián': 411,
    'miàn': 412,
    'miǎn': 413,
    'miáo': 414,
    'miào': 415,
    'miè': 416,
    'mǐn': 417,
    'ming': 418,
    'míng': 419,
    'mó': 420,
    'mò': 421,
    'mǒ': 422,
    'móu': 423,
    'mù': 424,
    'mǔ': 425,
    'nà': 426,
    'nài': 427,
    'nǎi': 428,
    'nán': 429,
    'nàn': 430,
    'nao': 431,
    'náo': 432,
    'nào': 433,
    'nǎo': 434,
    'nèi': 435,
    'nèn': 436,
    'ní': 437,
    'nì': 438,
    'nǐ': 439,
    'nián': 440,
    'niáng': 441,
    'niǎo': 442,
    'niè': 443,
    'níng': 444,
    'nìng': 445,
    'niú': 446,
    'niǔ': 447,
    'nóng': 448,
    'nù': 449,
    'nǔ': 450,
    'nuǎn': 451,
    'nuó': 452,
    'nuò': 453,
    'ō': 454,
    'ǒu': 455,
    'pā': 456,
    'pái': 457,
    'pài': 458,
    'pán': 459,
    'pàn': 460,
    'pān': 461,
    'páng': 462,
    'páo': 463,
    'péi': 464,
    'pèi': 465,
    'pēn': 466,
    'péng': 467,
    'pí': 468,
    'pì': 469,
    'pǐ': 470,
    'pī': 471,
    'piàn': 472,
    'piān': 473,
    'piáo': 474,
    'piào': 475,
    'piāo': 476,
    'pín': 477,
    'píng': 478,
    'pó': 479,
    'pò': 480,
    'pō': 481,
    'pù': 482,
    'qí': 483,
    'qì': 484,
    'qǐ': 485,
    'qī': 486,
    'qià': 487,
    'qián': 488,
    'qiàn': 489,
    'qiǎn': 490,
    'qiān': 491,
    'qiáng': 492,
    'qiāng': 493,
    'qiáo': 494,
    'qiào': 495,
    'qiǎo': 496,
    'qiāo': 497,
    'qiè': 498,
    'qín': 499,
    'qǐn': 500,
    'qīn': 501,
    'qíng': 502,
    'qǐng': 503,
    'qīng': 504,
    'qióng': 505,
    'qiú': 506,
    'qiū': 507,
    'qú': 508,
    'qù': 509,
    'qū': 510,
    'quán': 511,
    'què': 512,
    'qún': 513,
    'rán': 514,
    'rǎn': 515,
    'ráo': 516,
    'rào': 517,
    'rè': 518,
    'rén': 519,
    'rèn': 520,
    'rěn': 521,
    'rì': 522,
    'róng': 523,
    'róu': 524,
    'rú': 525,
    'rù': 526,
    'rǔ': 527,
    'ruǎn': 528,
    'ruì': 529,
    'rùn': 530,
    'ruò': 531,
    'sà': 532,
    'sǎ': 533,
    'sāi': 534,
    'sàn': 535,
    'sǎn': 536,
    'sān': 537,
    'sàng': 538,
    'sāng': 539,
    'sǎo': 540,
    'sè': 541,
    'sēn': 542,
    'shà': 543,
    'shā': 544,
    'shàn': 545,
    'shǎn': 546,
    'shān': 547,
    'shang': 548,
    'shàng': 549,
    'shǎng': 550,
    'shāng': 551,
    'shāo': 552,
    'shé': 553,
    'shè': 554,
    'shě': 555,
    'shē': 556,
    'shén': 557,
    'shèn': 558,
    'shěn': 559,
    'shēn': 560,
    'shèng': 561,
    'shěng': 562,
    'shēng': 563,
    'shi': 564,
    'shí': 565,
    'shì': 566,
    'shǐ': 567,
    'shī': 568,
    'shòu': 569,
    'shǒu': 570,
    'shōu': 571,
    'shù': 572,
    'shǔ': 573,
    'shū': 574,
    'shuài': 575,
    'shuāi': 576,
    'shuān': 577,
    'shuāng': 578,
    'shuǐ': 579,
    'shùn': 580,
    'shuò': 581,
    'shuō': 582,
    'sì': 583,
    'sī': 584,
    'sòng': 585,
    'sǒng': 586,
    'sōng': 587,
    'sōu': 588,
    'sù': 589,
    'sū': 590,
    'suàn': 591,
    'suān': 592,
    'suì': 593,
    'sǔn': 594,
    'suǒ': 595,
    'suō': 596,
    'tà': 597,
    'tā': 598,
    'tái': 599,
    'tài': 600,
    'tán': 601,
    'tàn': 602,
    'tǎn': 603,
    'tān': 604,
    'táng': 605,
    'tǎng': 606,
    'tāng': 607,
    'táo': 608,
    'tāo': 609,
    'tè': 610,
    'téng': 611,
    'tí': 612,
    'tì': 613,
    'tī': 614,
    'tián': 615,
    'tiān': 616,
    'tiáo': 617,
    'tiào': 618,
    'tiě': 619,
    'tíng': 620,
    'tǐng': 621,
    'tīng': 622,
    'tóng': 623,
    'tǒng': 624,
    'tou': 625,
    'tóu': 626,
    'tōu': 627,
    'tú': 628,
    'tù': 629,
    'tǔ': 630,
    'tū': 631,
    'tuán': 632,
    'tuí': 633,
    'tuī': 634,
    'tūn': 635,
    'tuó': 636,
    'tuō': 637,
    'wá': 638,
    'wā': 639,
    'wāi': 640,
    'wán': 641,
    'wàn': 642,
    'wǎn': 643,
    'wān': 644,
    'wáng': 645,
    'wàng': 646,
    'wǎng': 647,
    'wāng': 648,
    'wéi': 649,
    'wèi': 650,
    'wěi': 651,
    'wēi': 652,
    'wén': 653,
    'wèn': 654,
    'wěn': 655,
    'wēn': 656,
    'wèng': 657,
    'wēng': 658,
    'wò': 659,
    'wǒ': 660,
    'wō': 661,
    'wú': 662,
    'wù': 663,
    'wǔ': 664,
    'wū': 665,
    'xi': 666,
    'xí': 667,
    'xì': 668,
    'xǐ': 669,
    'xī': 670,
    'xiá': 671,
    'xià': 672,
    'xiā': 673,
    'xián': 674,
    'xiàn': 675,
    'xiǎn': 676,
    'xiān': 677,
    'xiáng': 678,
    'xiàng': 679,
    'xiǎng': 680,
    'xiāng': 681,
    'xiào': 682,
    'xiǎo': 683,
    'xiāo': 684,
    'xié': 685,
    'xiè': 686,
    'xìn': 687,
    'xīn': 688,
    'xing': 689,
    'xíng': 690,
    'xìng': 691,
    'xǐng': 692,
    'xīng': 693,
    'xióng': 694,
    'xiōng': 695,
    'xiù': 696,
    'xiū': 697,
    'xú': 698,
    'xù': 699,
    'xǔ': 700,
    'xū': 701,
    'xuán': 702,
    'xuàn': 703,
    'xuān': 704,
    'xué': 705,
    'xuè': 706,
    'xuě': 707,
    'xún': 708,
    'xùn': 709,
    'xūn': 710,
    'yá': 711,
    'yǎ': 712,
    'yā': 713,
    'yán': 714,
    'yàn': 715,
    'yǎn': 716,
    'yān': 717,
    'yáng': 718,
    'yàng': 719,
    'yǎng': 720,
    'yāng': 721,
    'yáo': 722,
    'yāo': 723,
    'yè': 724,
    'yí': 725,
    'yì': 726,
    'yǐ': 727,
    'yī': 728,
    'yín': 729,
    'yǐn': 730,
    'yīn': 731,
    'yíng': 732,
    'yìng': 733,
    'yǐng': 734,
    'yīng': 735,
    'yō': 736,
    'yǒng': 737,
    'yōng': 738,
    'yóu': 739,
    'yòu': 740,
    'yǒu': 741,
    'yōu': 742,
    'yú': 743,
    'yù': 744,
    'yǔ': 745,
    'yuán': 746,
    'yuàn': 747,
    'yuǎn': 748,
    'yuān': 749,
    'yuè': 750,
    'yuē': 751,
    'yún': 752,
    'yùn': 753,
    'yǔn': 754,
    'zá': 755,
    'zài': 756,
    'zāi': 757,
    'zàn': 758,
    'zàng': 759,
    'zāng': 760,
    'zào': 761,
    'zé': 762,
    'zēng': 763,
    'zhà': 764,
    'zhǎ': 765,
    'zhài': 766,
    'zhàn': 767,
    'zhǎn': 768,
    'zhān': 769,
    'zhàng': 770,
    'zhǎng': 771,
    'zhāng': 772,
    'zhào': 773,
    'zhǎo': 774,
    'zhāo': 775,
    'zhe': 776,
    'zhé': 777,
    'zhè': 778,
    'zhē': 779,
    'zhèn': 780,
    'zhēn': 781,
    'zhèng': 782,
    'zhěng': 783,
    'zhēng': 784,
    'zhí': 785,
    'zhì': 786,
    'zhǐ': 787,
    'zhī': 788,
    'zhòng': 789,
    'zhǒng': 790,
    'zhōng': 791,
    'zhòu': 792,
    'zhōu': 793,
    'zhú': 794,
    'zhù': 795,
    'zhǔ': 796,
    'zhū': 797,
    'zhuǎn': 798,
    'zhuān': 799,
    'zhuàng': 800,
    'zhuāng': 801,
    'zhuì': 802,
    'zhǔn': 803,
    'zhuó': 804,
    'zhuō': 805,
    'zi': 806,
    'zì': 807,
    'zǐ': 808,
    'zī': 809,
    'zōng': 810,
    'zǒu': 811,
    'zú': 812,
    'zǔ': 813,
    'zuì': 814,
    'zuǐ': 815,
    'zuó': 816,
    'zuò': 817,
    'zuǒ': 818,
  },

  // 英语课文整句本地播放：查 _enIdx → APK playSentenceSound / 网页 _playLocalFile('sounds/sentences/N.ogg')
  // 无索引或失败 → onFail（由调用方拆词兜底）
  _enPlaySentence(text, onFail, onEnd) {
    const self = this;
    const mySeq = this._ttsSeq = (this._ttsSeq || 0) + 1;
    const alive = function() { return self._ttsSeq === mySeq; };
    const idx = this._enIdx && this._enIdx[text];
    if (idx == null) { if (onFail) { try { onFail(); } catch (e) {} } return; }
    const fname = idx + '.ogg';
    if (window.AndroidBackup && typeof window.AndroidBackup.playSentenceSound === 'function') {
      try {
        const uid = 'pjse' + mySeq;
        const r = String(window.AndroidBackup.playSentenceSound(fname, uid));
        if (r === '1') {
          this._ttsNativeId = uid;
          let fired = false;
          const finish = function(cb, isFail) {
            if (!alive() || fired) return;
            fired = true;
            if (self._ttsNativeGuard) { clearTimeout(self._ttsNativeGuard); self._ttsNativeGuard = null; }
            self._ttsNativeEndCb = null;
            self._ttsNativeFailCb = null;
            try { if (cb) cb(); } catch (e) {}
          };
          const guard = setTimeout(function() { if (alive() && !fired) { finish(onEnd, false); } }, Math.max(3000, Math.min(20000, Math.ceil(text.length * 220))));
          this._ttsNativeGuard = guard;
          this._ttsNativeEndCb = function() { finish(onEnd, false); };
          this._ttsNativeFailCb = function() { finish(onFail, true); };
          return;
        }
      } catch (e) {}
    }
    this._playLocalFile('sounds/sentences/' + fname, 1, function() {
      if (onFail) { try { onFail(); } catch (e) {} }
    }, function() {
      if (onEnd) { try { onEnd(); } catch (e) {} }
    });
  },

  // 英语整句拆词兜底：无本地索引时逐词播放（单词走既有 playUrl/字母本地音），词间 180ms
  _enPlayWords(text, onEnd) {
    const self = this;
    const words = String(text || '').split(/[^A-Za-z0-9']+/).filter(function(w) { return w && /[A-Za-z0-9]/.test(w); });
    if (!words.length) { if (onEnd) { try { onEnd(); } catch (e) {} } return; }
    const run = function(i) {
      if (i >= words.length) { if (onEnd) { try { onEnd(); } catch (e) {} } return; }
      self._ttsSpeak({ text: words[i], language: 'en-US', volume: 1, skipUrl: false, onEnd: function() { setTimeout(function() { run(i + 1); }, 180); } });
    };
    run(0);
  },

  // 拼音音节本地带调播放：查 _zhPyIdx → APK playPySound / 网页 _playLocalFile('sounds/pinyin/N.ogg')
  // 无索引或失败 → onFallback（剥调走有道/合成）
  _zhPlayPySyl(sylStr, onFallback, onEnd) {
    const self = this;
    const idx = this._zhPyIdx && this._zhPyIdx[sylStr];
    if (idx == null) { if (onFallback) { try { onFallback(); } catch (e) {} } return; }
    const fname = idx + '.ogg';
    if (window.AndroidBackup && typeof window.AndroidBackup.playPySound === 'function') {
      try {
        const r = String(window.AndroidBackup.playPySound(fname));
        if (r === '1') {
          self._ttsPyGuard = setTimeout(function() {
            self._ttsPyGuard = null;
            if (onEnd) { try { onEnd(); } catch (e) {} }
          }, 1200);
          return;
        }
      } catch (e) {}
    }
    this._playLocalFile('sounds/pinyin/' + fname, 1, function() {
      if (onFallback) { try { onFallback(); } catch (e) {} }
    }, function() {
      if (onEnd) { try { onEnd(); } catch (e) {} }
    });
  },

  // 拼音逐音节朗读（带调 → 本地声道，失败回退剥调），供不含"汉字+整体"序列的场景（单元学习页）使用
  _zhSpeakPy(py, onEnd) {
    const self = this;
    const syl = String(py || '').split(/[\s·,，、;；]+/).map(s => s.trim()).filter(s => s && /[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/i.test(s));
    if (!syl.length) { if (onEnd) { try { onEnd(); } catch (e) {} } return; }
    const gap = 350;
    const run = function(i) {
      if (i >= syl.length) { if (onEnd) { try { onEnd(); } catch (e) {} } return; }
      const cur = syl[i];
      self._zhPlayPySyl(cur, function() {
        self._ttsSpeak({ text: self._zhStripTone(cur), language: 'zh-CN', volume: 1, skipUrl: false, onEnd: function() { setTimeout(function() { run(i + 1); }, gap); } });
      }, function() {
        setTimeout(function() { run(i + 1); }, gap);
      });
    };
    run(0);
  },

  _zhSpeakSeq(zi, py, onEnd, opts) {
    const self = this;
    const skipUrl = !!(opts && opts.skipUrl);
    const ziT = String(zi || '').trim();
    const pyRaw = String(py || '').trim();
    const pySyllables = pyRaw.split(/[\s·,，、;；]+/).map(s => s.trim()).filter(s => s && /[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/i.test(s));
    // playTimes=3：字·拼音·字 共3段（听音选字用）；默认2轮：字·拼音·字·拼音（其余场景不变）
    const playTimes = (opts && opts.playTimes === 3) ? 3 : 2;
    const parts = [];
    if (ziT) parts.push({ text: ziT, isPy: false });
    pySyllables.forEach(function(sy) { parts.push({ text: sy, isPy: true }); });
    if (playTimes >= 2) {
      if (ziT) parts.push({ text: ziT, isPy: false });
      pySyllables.forEach(function(sy) { parts.push({ text: sy, isPy: true }); });
    }
    if (!parts.length) {
      if (pyRaw) { self._ttsSpeak({ text: pyRaw, language: 'zh-CN', volume: 1, skipUrl: true, onEnd: onEnd || function() {} }); return; }
      if (onEnd) { try { onEnd(); } catch (e) {} }
      return;
    }
    const gap = 450;
    // 连续拼音音节间用短间隔（150ms）连成一组，保证 playTimes=3 时听感严格为「字|拼音组|字」3 拍
    const gapAfter = function(i) {
      const c = parts[i], n = parts[i + 1];
      return (c && n && c.isPy && n.isPy) ? 150 : gap;
    };
    // 发音链令牌：新链启动/手动停止后，旧链所有未触发的续段一律作废（防多链交错混音）
    const gen = (this._zhSpeakGen = (this._zhSpeakGen || 0) + 1);
    const stale = function() { return gen !== self._zhSpeakGen; };
    const run = function(i) {
      if (stale()) return;
      if (i >= parts.length) { if (onEnd) { try { onEnd(); } catch (e) {} } return; }
      const p = parts[i];
      if (p.isPy) {
        self._zhPlayPySyl(p.text, function() {
          if (stale()) return;
          self._ttsSpeak({ text: self._zhStripTone(p.text), language: 'zh-CN', volume: 1, skipUrl: skipUrl, onEnd: function() { if (stale()) return; setTimeout(function() { run(i + 1); }, gapAfter(i)); } });
        }, function() {
          if (stale()) return;
          setTimeout(function() { run(i + 1); }, gapAfter(i));
        });
      } else {
        self._ttsSpeak({ text: p.text, language: 'zh-CN', volume: 1, skipUrl: skipUrl, onEnd: function() { if (stale()) return; setTimeout(function() { run(i + 1); }, gapAfter(i)); } });
      }
    };
    run(0);
  },

  // 古诗诵读（F 方案，1660 定案）：查 _zhPoemIdx → 本地整诗音频（诗题+作者+正文，Edge TTS XiaoxiaoNeural -10%，
  // sounds/sentences/1xxx.ogg 与英语整句同目录复用 playSentenceSound/路由，零 Java 改动）；未命中 → 回退旧链路
  // （诗题两遍→正文整段走有道/原生/合成——长中文有道 500、坏平板原生+合成皆哑，故仅作兜底）
  _zhSpeakPoem(zi, py, body, onEnd) {
    const self = this;
    const idx = (this._zhPoemIdx && body) ? this._zhPoemIdx[body] : null;
    if (idx == null) {
      this._zhSpeakSeq(zi, py, function() {
        setTimeout(function() {
          if (body) self._zhSpeak(body, onEnd);
          else if (onEnd) { try { onEnd(); } catch (e) {} }
        }, 300);
      });
      return;
    }
    this._zhPlayPoemFile((1000 + idx) + '.ogg', String(body).length, onEnd);
  },

  _zhPlayPoemFile(fname, textLen, onDone) {
    const self = this;
    const mySeq = this._ttsSeq = (this._ttsSeq || 0) + 1;
    const alive = function() { return self._ttsSeq === mySeq; };
    let fired = false;
    const doneOnce = function() {
      if (!alive() || fired) return;
      fired = true;
      if (self._ttsNativeGuard) { clearTimeout(self._ttsNativeGuard); self._ttsNativeGuard = null; }
      self._ttsNativeEndCb = null;
      self._ttsNativeFailCb = null;
      if (onDone) { try { onDone(); } catch (e) {} }
    };
    if (window.AndroidBackup && typeof window.AndroidBackup.playSentenceSound === 'function') {
      try {
        const uid = 'pjpm' + mySeq;
        const r = String(window.AndroidBackup.playSentenceSound(fname, uid));
        if (r === '1') {
          this._ttsNativeId = uid;
          this._ttsNativeGuard = setTimeout(doneOnce, Math.max(4000, Math.min(60000, Math.ceil((textLen || 20) * 700))));
          this._ttsNativeEndCb = doneOnce;
          this._ttsNativeFailCb = function() { setTimeout(doneOnce, 0); };
          return;
        }
      } catch (e) {}
    }
    this._playLocalFile('sounds/sentences/' + fname, 1, doneOnce, doneOnce);
  },

  _zhExitBtn() {
    return '<button class="back-btn" onclick="App.exitToUnit()">← 返回上一级</button>';
  },

  zhStudyUid: 0,
  zhStudyIdx: 0,
  zhStudyAuto: false,

  renderZhStudy(uid) {
    const info = this._zhInfo(uid);
    if (!info.words.length) { this.exitToUnit(); return; }
    this.stopSpeaking();
    this.zhStudyUid = uid;
    this.zhStudyIdx = 0;
    this.zhStudyAuto = false;
    this.currentView = 'zhStudy';
    this.activeSessionId = Storage.startSession('zhStudy', uid, info.unitTitle, info.gradeTitle, { subject: 'chinese', totalItems: info.words.length });
    this._zhStudyRender(info);
  },

  _zhStudyRender(info) {
    const main = document.getElementById('main-content');
    const words = info.words;
    const idx = this.zhStudyIdx;
    const w = words[idx];
    if (!w) { this.goBack(); return; }
    const total = words.length;
    const isPoem = this._zhUnitKind({ words: words }) === 'poem';
    const isZi = String(w.zi || '').length === 1;

    let html = '<div class="reading-container">';
    html += this._zhExitBtn();
    html += `<h2 class="reading-title">${isPoem ? '📜 诵读' : '📖 认读'}：${info.unitTitle}</h2>`;

    if (isPoem) {
      html += `<div class="zh-poem-card">
        <div class="zh-poem-title">${w.zi}</div>
        <div class="zh-poem-author">${w.pinyin || ''}</div>
        <div class="zh-poem-body">${String(w.yi || '').replace(/\n/g, '<br>').replace(/，/g, '，<br>').replace(/。/g, '。<br>')}</div>
      </div>`;
    } else {
      html += `<div class="zh-study-card">
        <div class="zh-study-char">${w.zi}</div>
        <div class="zh-study-pinyin">${w.pinyin || ''}</div>
        <div class="zh-study-meaning">${w.yi || ''}</div>
      </div>`;
      if (isZi) {
        html += `<div class="zh-study-actions">
          <button class="reading-ctrl-btn" id="zh-stroke-btn">✍ 看笔顺</button>
        </div>`;
      }
    }

    html += `<div class="zh-study-nav">
      <button class="reading-ctrl-btn" id="zh-prev-btn">◀ 上一个</button>
      <span class="zh-study-progress">${idx + 1} / ${total}</span>
      <button class="reading-ctrl-btn" id="zh-next-btn">下一个 ▶</button>
      <button class="reading-ctrl-btn" id="zh-speak-btn">🔊 朗读</button>
      <button class="reading-ctrl-btn" id="zh-auto-btn">▶ 自动朗读</button>
    </div>
    <div class="zh-demo-wrap" id="zh-demo-wrap" style="display:none"></div>
    </div>`;
    main.innerHTML = html;

    document.getElementById('zh-speak-btn').addEventListener('click', () => { this._zhSpeakItem(words, idx); });
    document.getElementById('zh-auto-btn').addEventListener('click', () => {
      this.zhStudyAuto = !this.zhStudyAuto;
      const btn = document.getElementById('zh-auto-btn');
      if (btn) btn.textContent = this.zhStudyAuto ? '⏸ 停止自动' : '▶ 自动朗读';
      if (this.zhStudyAuto) this._zhAutoLoop(words, idx);
      else this.stopSpeaking();
    });
    document.getElementById('zh-prev-btn').addEventListener('click', () => {
      this.zhStudyAuto = false;
      this.stopSpeaking();
      if (idx > 0) { this.zhStudyIdx--; this._zhStudyRender(info); }
    });
    document.getElementById('zh-next-btn').addEventListener('click', () => {
      this.zhStudyAuto = false;
      this.stopSpeaking();
      if (idx < total - 1) { this.zhStudyIdx++; this._zhStudyRender(info); }
    });
    const sb = document.getElementById('zh-stroke-btn');
    if (sb) {
      sb.addEventListener('click', () => {
        this.zhStudyAuto = false;
        this.stopSpeaking();
        const wrap = document.getElementById('zh-demo-wrap');
        if (wrap) {
          const shown = wrap.style.display !== 'none';
          wrap.style.display = shown ? 'none' : 'block';
          if (!shown) this._zhDemoRender(wrap, String(w.zi || ''));
        }
      });
    }
  },

  _zhAutoLoop(words, idx) {
    const self = this;
    if (!this.zhStudyAuto) return;
    const w = words[idx];
    if (!w) { this.zhStudyUid = 0; return; }
    const finish = function() {
      setTimeout(function() {
        if (!self.zhStudyAuto) return;
        if (idx < words.length - 1) {
          self.zhStudyIdx++;
          self._zhStudyRender(self._zhInfo(self.zhStudyUid));
          self._zhAutoLoop(words, idx + 1);
        } else {
          self.zhStudyAuto = false;
        }
      }, 500);
    };
    const isPoem = self._zhUnitKind({ words: words }) === 'poem';
    const body = String(w.yi || '');
    if (isPoem && body) {
      setTimeout(function() {
        self._zhSpeakPoem(w.zi, w.pinyin, body, function() { setTimeout(finish, 150); });
      }, 200);
      return;
    }
    this._zhSpeakSeq(w.zi, w.pinyin, function() {
      setTimeout(finish, 300);
    });
  },

  _zhSpeakItem(words, idx) {
    const w = words[idx];
    if (!w) return;
    const self = this;
    const zi = String(w.zi || '');
    const py = String(w.pinyin || '');
    const body = String(w.yi || '');
    const isPoem = this._zhUnitKind({ words: words }) === 'poem';
    const isZi = String(zi).length === 1 && !isPoem;
    if (isPoem) { this._zhSpeakPoem(zi, py, body); return; }
    if (isZi) {
      if (py) { this._zhSpeakPy(py, function() {}); return; }
      this._zhSpeak(String(zi).trim());
      return;
    }
    if (!py) { this._zhSpeak(zi); return; }
    this._zhSpeak(zi, function() {
      setTimeout(function() {
        self._zhSpeakPy(py, function() {});
      }, 300);
    });
  },

  zhStrokeUid: 0,
  zhStrokeIdx: 0,
  zhStrokeTimer: null,
  zhStrokePlaying: false,
  zhStrokeStep: 0,

  renderZhStroke(uid) {
    const info = this._zhInfo(uid);
    const words = (info.words || []).filter(w => String(w.zi || '').length === 1);
    if (!words.length) { this.goBack(); return; }
    this.stopSpeaking();
    this.zhStrokeUid = uid;
    this.zhStrokeIdx = 0;
    this.activeSessionId = Storage.startSession('zhStroke', uid, info.unitTitle, info.gradeTitle, { subject: 'chinese', totalItems: words.length });
    this.currentView = 'zhStroke';

    const main = document.getElementById('main-content');
    let html = '<div class="reading-container">';
    html += this._zhExitBtn();
    html += `<h2 class="reading-title">✍ 笔画学习：${info.unitTitle}</h2>`;
    html += '<div class="zh-stroke-char-tabs">';
    words.forEach((w, i) => {
      html += `<button class="zh-stroke-tab${i === 0 ? ' active' : ''}" data-si="${i}">${w.zi}</button>`;
    });
    html += '</div>';
    html += '<div class="zh-demo-wrap" id="zh-demo-wrap"></div>';
    html += '</div>';
    main.innerHTML = html;

    document.querySelectorAll('.zh-stroke-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.si);
        this.zhStrokeIdx = i;
        this.stopSpeaking();
        this._zhStrokeReset();
        document.querySelectorAll('.zh-stroke-tab').forEach(b => b.classList.toggle('active', parseInt(b.dataset.si) === i));
        this._zhDemoRender(document.getElementById('zh-demo-wrap'), String(words[i].zi || ''));
      });
    });

    this._zhDemoRender(document.getElementById('zh-demo-wrap'), String(words[0].zi || ''));
  },

  _zhStrokeReset() {
    if (this.zhStrokeTimer) { clearInterval(this.zhStrokeTimer); this.zhStrokeTimer = null; }
    this.zhStrokePlaying = false;
    this.zhStrokeStep = 0;
  },

  _ensureZhStrokes(cb) {
    const self = this;
    try {
      if (typeof ZH_STROKES !== 'undefined') { if (cb) { try { cb(); } catch (e) {} } return; }
    } catch (e) {}
    if (self._zhStrokesLoading) {
      if (cb) (self._zhStrokesWait = self._zhStrokesWait || []).push(cb);
      return;
    }
    self._zhStrokesLoading = true;
    self._zhStrokesWait = cb ? [cb] : [];
    const s = document.createElement('script');
    const ver = window.__BUILTIN_VER || window.__SERVER_VER || '';
    s.src = 'js/data-zh-strokes.js' + (ver ? '?v=' + ver + '_' + Date.now() : '');
    s.onload = function() {
      self._zhStrokesLoading = false;
      const pend = self._zhStrokesWait || [];
      self._zhStrokesWait = [];
      pend.forEach(function(f) { try { f(); } catch (e) {} });
    };
    s.onerror = function() {
      self._zhStrokesLoading = false;
      const pend = self._zhStrokesWait || [];
      self._zhStrokesWait = [];
      pend.forEach(function(f) { try { f(); } catch (e) {} });
    };
    try { document.head.appendChild(s); } catch (e) {
      self._zhStrokesLoading = false;
      const pend = self._zhStrokesWait || [];
      self._zhStrokesWait = [];
      pend.forEach(function(f) { try { f(); } catch (e2) {} });
    }
  },

  _zhStrokeNameIndex: { '横':0, '竖':1, '撇':2, '点':3, '横折':4, '捺':5, '横撇':6, '提':7, '横折钩':8, '竖钩':9, '点2':10, '撇折':11, '竖弯钩':12, '竖弯':13, '竖提':14, '斜钩':15, '竖折折钩':16, '横折折撇':17, '撇点':18, '横折折折钩':19, '横斜钩':20, '横折提':21, '弯钩':22, '横折折':23, '竖折撇':24 },

  _zhStrokeSpeak(name, onEnd) {
    const self = this;
    const idx = this._zhStrokeNameIndex && this._zhStrokeNameIndex[name];
    const fallback = function() { self._zhSpeak(name, onEnd, { preventDedup: true }); };
    if (idx == null) { fallback(); return; }
    const fname = idx + '.wav';
    if (window.AndroidBackup && typeof window.AndroidBackup.playStrokeSound === 'function') {
      try {
        const r = String(window.AndroidBackup.playStrokeSound(fname));
        if (r === '1') {
          self._ttsStrokeGuard = setTimeout(function() {
            if (onEnd) { try { onEnd(); } catch(e) {} }
          }, 1100);
          return;
        }
      } catch (e) {}
    }
    this._playLocalFile('sounds/stroke-names/' + fname, 1, fallback, onEnd || function() {});
  },

  _zhDemoRender(wrap, ch) {
    if (!wrap) return;
    const self = this;
    this._ensureZhStrokes(function() {
      self._zhDemoRenderInner(wrap, ch);
    });
  },

  _zhDemoRenderInner(wrap, ch) {
    if (!wrap) return;
    try {
      if (typeof ZH_STROKES === 'undefined' || !ZH_STROKES[ch]) {
        wrap.innerHTML = `<div class="zh-stroke-empty">「${ch}」暂无笔顺数据</div>`;
        return;
      }
    } catch (e) {
      wrap.innerHTML = `<div class="zh-stroke-empty">「${ch}」暂无笔顺数据</div>`;
      return;
    }
    const data = ZH_STROKES[ch] || null;
    if (!data || !data.m || !data.m.length || !data.s) {
      wrap.innerHTML = `<div class="zh-stroke-empty">「${ch}」暂无笔顺数据</div>`;
      return;
    }
    const strokes = data.m;
    const names = data.s;
    this._zhStrokeReset();

    let html = `<div class="zh-demo-char">${ch}</div>`;
    html += `<svg class="zh-stroke-svg" viewBox="-60 -60 1144 1144" xmlns="http://www.w3.org/2000/svg">
      <line x1="512" y1="0" x2="512" y2="1024" class="zh-grid-line"/>
      <line x1="0" y1="512" x2="1024" y2="512" class="zh-grid-line"/>
      <line x1="0" y1="0" x2="1024" y2="1024" class="zh-grid-line"/>
      <line x1="1024" y1="0" x2="0" y2="1024" class="zh-grid-line"/>`;
    strokes.forEach((pts, i) => {
      html += `<polyline id="zh-poly-${i}" class="zh-stroke-line" points=""/>`;
    });
    html += '</svg>';
    html += '<div class="zh-stroke-names">';
    names.forEach((n, i) => {
      html += `<span class="zh-stroke-name" id="zh-name-${i}" data-ni="${i}">${i + 1}.${n}</span>`;
    });
    html += '</div>';
    html += `<div class="zh-demo-controls">
      <button class="reading-ctrl-btn" id="zh-play-btn">▶ 播放</button>
      <button class="reading-ctrl-btn" id="zh-step-btn">⏭ 下一步</button>
      <button class="reading-ctrl-btn" id="zh-clear-btn">◻ 清屏</button>
    </div>`;
    wrap.innerHTML = html;

    this._zhStrokeData = { ch: ch, strokes: strokes, names: names };

    document.getElementById('zh-play-btn').addEventListener('click', () => {
      if (this.zhStrokePlaying) { this.zhStrokePlaying = false; this.stopSpeaking(); return; }
      const d = this._zhStrokeData;
      if (!d) return;
      this.stopSpeaking();
      this.zhStrokePlaying = true;
      document.getElementById('zh-play-btn').textContent = '⏸ 暂停';
      this._zhPlayFrom(this.zhStrokeStep, d);
    });
    document.getElementById('zh-step-btn').addEventListener('click', () => {
      const d = this._zhStrokeData;
      if (!d) return;
      this.zhStrokePlaying = false;
      this.stopSpeaking();
      if (this.zhStrokeStep > 0) this._zhClearStroke(this.zhStrokeStep - 1);
      this.zhStrokeStep++;
      if (this.zhStrokeStep > d.strokes.length) this.zhStrokeStep = 1;
      this._zhDrawOne(this.zhStrokeStep - 1, d);
      const spkNm = String(d.names[this.zhStrokeStep - 1] || '').trim();
      if (spkNm) this._zhStrokeSpeak(spkNm, null);
    });
    document.getElementById('zh-clear-btn').addEventListener('click', () => {
      this.zhStrokePlaying = false;
      this.stopSpeaking();
      this.zhStrokeStep = 0;
      const d = this._zhStrokeData;
      if (!d) return;
      d.strokes.forEach((pts, i) => {
        const el = document.getElementById('zh-poly-' + i);
        if (el) {
          el.setAttribute('points', '');
          el.classList.remove('drawn', 'current');
        }
        const nm = document.getElementById('zh-name-' + i);
        if (nm) nm.classList.remove('done', 'current');
      });
    });
  },

  _zhFlatten(pts) {
    return pts.map(p => p[0].toFixed(1) + ',' + (1024 - p[1]).toFixed(1)).join(' ');
  },

  _zhClearStroke(i) {
    const el = document.getElementById('zh-poly-' + i);
    if (el) { el.setAttribute('points', ''); el.classList.remove('drawn', 'current'); }
    const nm = document.getElementById('zh-name-' + i);
    if (nm) nm.classList.remove('done', 'current');
  },

  _zhDrawOne(i, d) {
    const el = document.getElementById('zh-poly-' + i);
    if (el) el.setAttribute('points', this._zhFlatten(d.strokes[i]));
    if (el) { el.classList.add('drawn'); el.classList.remove('current'); }
    const nm = document.getElementById('zh-name-' + i);
    if (nm) { nm.classList.add('done'); nm.classList.remove('current'); }
  },

  _zhPlayFrom(startIdx, d) {
    const self = this;
    if (!self.zhStrokePlaying) return;
    if (startIdx >= d.strokes.length) {
      self.zhStrokePlaying = false;
      const b = document.getElementById('zh-play-btn');
      if (b) b.textContent = '▶ 播放';
      return;
    }
    if (startIdx > 0) self._zhFinishStroke(startIdx - 1, d);
    const el = document.getElementById('zh-poly-' + startIdx);
    const nm = document.getElementById('zh-name-' + startIdx);
    if (el) { el.classList.remove('drawn'); el.classList.add('current'); }
    if (nm) { nm.classList.remove('done'); nm.classList.add('current'); }

    const pts = d.strokes[startIdx];
    let step = 0;
    let drawDone = false;
    let ttsDone = false;
    let moved = false;
    const frames = Math.min(24, Math.max(4, pts.length));
    const tryNext = function() {
      if (moved || !self.zhStrokePlaying) return;
      if (!drawDone || !ttsDone) return;
      moved = true;
      if (self.zhStrokeTimer) { clearInterval(self.zhStrokeTimer); self.zhStrokeTimer = null; }
      if (self.zhStrokeGuard) { clearTimeout(self.zhStrokeGuard); self.zhStrokeGuard = null; }
      self._zhFinishStroke(startIdx, d);
      self.zhStrokeStep = startIdx + 2;
      setTimeout(function() {
        if (self.zhStrokePlaying) self._zhPlayFrom(startIdx + 1, d);
      }, 350);
    };
    if (self.zhStrokeTimer) { clearInterval(self.zhStrokeTimer); self.zhStrokeTimer = null; }
    if (self.zhStrokeGuard) { clearTimeout(self.zhStrokeGuard); self.zhStrokeGuard = null; }
    self.zhStrokeTimer = setInterval(function() {
      if (!self.zhStrokePlaying) { clearInterval(self.zhStrokeTimer); self.zhStrokeTimer = null; return; }
      step += 1;
      const idx = Math.min(pts.length - 1, Math.round(step * pts.length / frames));
      if (el) el.setAttribute('points', self._zhFlatten(pts.slice(0, idx + 1)));
      if (step >= frames) {
        clearInterval(self.zhStrokeTimer); self.zhStrokeTimer = null;
        drawDone = true;
        tryNext();
      }
    }, 40);
    const spk = String(d.names[startIdx] || '').trim();
    self.zhStrokeGuard = setTimeout(function() {
      if (moved || !self.zhStrokePlaying) return;
      ttsDone = true;
      tryNext();
    }, 8000);
    if (spk) {
      self._zhStrokeSpeak(spk, function() {
        if (moved || !self.zhStrokePlaying) return;
        ttsDone = true;
        tryNext();
      });
    } else {
      ttsDone = true;
    }
  },

  _zhFinishStroke(i, d) {
    const el = document.getElementById('zh-poly-' + i);
    if (el && d && d.strokes[i]) {
      el.setAttribute('points', this._zhFlatten(d.strokes[i]));
      el.classList.add('drawn');
      el.classList.remove('current');
    }
    const nm = document.getElementById('zh-name-' + i);
    if (nm) { nm.classList.add('done'); nm.classList.remove('current'); }
  },

  startZhListenQuiz(uid) {
    const info = this._zhInfo(uid);
    const words = info.words.filter(w => String(w.zi || '').length === 1);
    if (words.length < 2) { this.startLesson(uid); return; }
    this.stopSpeaking();
    this.zhQuizMode = 'listen';
    this.zhQuizInfo = info;
    this.zhQuizWords = words.slice();
    this.zhQuizIdx = 0;
    this.zhQuizCorrect = 0;
    this.zhQuizAnswered = {};
    if (this._zhQuizTimer) { clearTimeout(this._zhQuizTimer); this._zhQuizTimer = null; }
    if (this._zhListenAutoTimer) { clearTimeout(this._zhListenAutoTimer); this._zhListenAutoTimer = null; }
    this.activeSessionId = Storage.startSession('zhListenQuiz', uid, info.unitTitle, info.gradeTitle, { subject: 'chinese', totalItems: words.length });
    this.currentView = 'zhQuiz';
    this._zhListenRender();
  },

  // 听音选字渲染（不显示答案字，只听音；支持上一个/下一个）
  _zhListenRender() {
    const self = this;
    const words = this.zhQuizWords;
    const idx = this.zhQuizIdx;
    const main = document.getElementById('main-content');
    if (idx >= words.length) {
      this.stopSpeaking();
      const pct = words.length ? Math.round((this.zhQuizCorrect / words.length) * 100) : 0;
      if (this.activeSessionId) {
        const stars = pct >= 90 ? 3 : pct >= 60 ? 2 : 1;
        Storage.endSession(this.activeSessionId, { correctCount: this.zhQuizCorrect, wrongCount: words.length - this.zhQuizCorrect, totalItems: words.length, accuracy: pct, stars: stars, xp: this.zhQuizCorrect * 5 });
        this.activeSessionId = null;
        this._autoPushReport();
      }
      main.innerHTML = '<div class="reading-container">' + this._zhExitBtn() +
        '<h2 class="reading-title">🎯 练习完成</h2>' +
        '<div class="quiz-summary">答对 ' + this.zhQuizCorrect + ' / ' + words.length +
        '（' + pct + '%）' + (pct >= 80 ? ' 🎉 棒棒哒！' : ' 💪 继续加油！') + '</div></div>';
      return;
    }
    const q = words[idx];
    const opts = this._zhPickOptions(words, idx, 4);
    const ans = this.zhQuizAnswered[idx];
    let html = '<div class="reading-container">';
    html += this._zhExitBtn();
    html += '<h2 class="reading-title">🎧 听音选字</h2>';
    html += '<div class="quiz-area">';
    html += '<button class="reading-ctrl-btn" id="zh-q-replay">🔊 点击听读音</button>';
    html += '<div class="zh-q-options">';
    opts.forEach((w, i) => {
      html += `<button class="zh-q-opt" data-oi="${i}">${w.zi}</button>`;
    });
    html += '</div>';
    let fbText = '点击🔊听读音，选出正确汉字';
    if (ans) fbText = ans.ok ? ('✅ 回答正确！' + q.zi + ' ' + (q.yi || '')) : ('❌ 答案是「' + q.zi + '」');
    html += `<div class="zh-q-fb" id="zh-q-fb">${fbText}</div>`;
    html += `<div class="zh-q-score" id="zh-q-score">${this.zhQuizCorrect} / ${Object.keys(this.zhQuizAnswered).length}</div>`;
    html += '<div style="display:flex;gap:10px;justify-content:center;margin-top:12px">';
    html += '<button class="reading-ctrl-btn" id="zh-q-prev"' + (idx <= 0 ? ' disabled' : '') + '>⬅ 上一个</button>';
    html += '<button class="reading-ctrl-btn" id="zh-q-next">' + (idx >= words.length - 1 ? '完成 ✓' : '下一个 ➡') + '</button>';
    html += '</div>';
    html += '</div></div>';
    main.innerHTML = html;

    if (ans) {
      document.querySelectorAll('.zh-q-opt').forEach(b => {
        b.disabled = true;
        const t = b.textContent.trim();
        if (t === String(q.zi)) b.classList.add('correct');
        else if (!ans.ok && t === String(ans.picked)) b.classList.add('wrong');
      });
    } else {
      if (self._zhListenAutoTimer) { clearTimeout(self._zhListenAutoTimer); }
      self._zhListenAutoTimer = setTimeout(function() { self._zhListenAutoTimer = null; self._zhSpeakSeq(q.zi, q.pinyin, null, { playTimes: 3 }); }, 200);
    }

    document.getElementById('zh-q-replay').addEventListener('click', function() {
      self.stopSpeaking();
      self._zhSpeakSeq(q.zi, q.pinyin, null, { playTimes: 3 });
    });
    document.querySelectorAll('.zh-q-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        if (self.zhQuizAnswered[idx]) return;
        const oi = parseInt(btn.dataset.oi);
        self._zhQuizAnswer(oi, opts[oi], q);
      });
    });
    const prevBtn = document.getElementById('zh-q-prev');
    if (prevBtn) prevBtn.addEventListener('click', function() {
      if (idx <= 0) return;
      if (self._zhQuizTimer) { clearTimeout(self._zhQuizTimer); self._zhQuizTimer = null; }
      if (self._zhListenAutoTimer) { clearTimeout(self._zhListenAutoTimer); self._zhListenAutoTimer = null; }
      self.stopSpeaking();
      self.zhQuizIdx = idx - 1;
      self._zhListenRender();
    });
    document.getElementById('zh-q-next').addEventListener('click', function() {
      if (self._zhQuizTimer) { clearTimeout(self._zhQuizTimer); self._zhQuizTimer = null; }
      if (self._zhListenAutoTimer) { clearTimeout(self._zhListenAutoTimer); self._zhListenAutoTimer = null; }
      self.stopSpeaking();
      self.zhQuizIdx = idx + 1;
      self._zhListenRender();
    });
  },

  _zhPickOptions(words, correctIdx, n) {
    const opts = [words[correctIdx]];
    const others = words.filter((w, i) => i !== correctIdx);
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = others[i]; others[i] = others[j]; others[j] = t;
    }
    for (let i = 0; i < others.length && opts.length < n; i++) opts.push(others[i]);
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = opts[i]; opts[i] = opts[j]; opts[j] = t;
    }
    return opts;
  },

  _zhQuizAnswer(oi, chosen, correct) {
    const self = this;
    const fb = document.getElementById('zh-q-fb');
    const optBtns = document.querySelectorAll('.zh-q-opt');
    if (optBtns[oi]) optBtns[oi].classList.add('picked');
    const ok = chosen === correct;
    if (this.zhQuizMode === 'listen') {
      if (this.zhQuizAnswered[this.zhQuizIdx]) return;
      if (this._zhListenAutoTimer) { clearTimeout(this._zhListenAutoTimer); this._zhListenAutoTimer = null; }
      this.zhQuizAnswered[this.zhQuizIdx] = { ok: ok, picked: chosen.zi };
    }
    optBtns.forEach(b => b.disabled = true);
    if (ok) {
      this.zhQuizCorrect++;
      if (fb) fb.textContent = '✅ 回答正确！' + correct.zi + ' ' + (correct.yi || '');
      optBtns[oi].classList.add('correct');
      this._zhSpeakSeq(correct.zi, correct.pinyin, null, this.zhQuizMode === 'dailyListen' ? { skipUrl: true, playTimes: 3 } : { playTimes: 3 });
    } else {
      if (fb) fb.textContent = '❌ 答案是「' + correct.zi + '」';
      optBtns[oi].classList.add('wrong');
      optBtns.forEach(b => {
        if (b.textContent.trim() === String(correct.zi)) b.classList.add('correct');
      });
      this._zhAddWrong(correct, this.zhQuizInfo);
      this._zhSpeakSeq(correct.zi, correct.pinyin, null, this.zhQuizMode === 'dailyListen' ? { skipUrl: true, playTimes: 3 } : { playTimes: 3 });
    }
    this.zhQuizIdx++;
    const scoreEl = document.getElementById('zh-q-score');
    if (scoreEl) {
      scoreEl.textContent = this.zhQuizMode === 'listen'
        ? (this.zhQuizCorrect + ' / ' + Object.keys(this.zhQuizAnswered).length)
        : (this.zhQuizCorrect + ' / ' + this.zhQuizIdx);
    }
    this._zhQuizTimer = setTimeout(function() { self._zhQuizTimer = null; self._zhQuizNext(); }, 1400);
  },

  _zhQuizNext() {
    if (this.zhQuizMode === 'dailyListen') { this._zhDailyListenNext(); return; }
    if (this.zhQuizMode === 'listen') { this._zhListenRender(); return; }
  },

  zhMeaningIdx: 0,
  zhMeaningMode: 0,
  zhMeaningWords: [],
  zhMeaningCorrect: 0,

  renderZhMeaningPractice(uid) {
    const info = this._zhInfo(uid);
    const words = info.words.slice();
    if (words.length < 2) { this.startLesson(uid); return; }
    for (let i = words.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = words[i]; words[i] = words[j]; words[j] = t;
    }
    this.stopSpeaking();
    this.zhMeaningWords = words;
    this.zhMeaningIdx = 0;
    this.zhMeaningMode = 0;
    this.zhMeaningCorrect = 0;
    this.zhMeaningDone = [];
    this.zhMeaningChosen = [];
    this.activeSessionId = Storage.startSession('zhMeaning', uid, info.unitTitle, info.gradeTitle, { subject: 'chinese', totalItems: words.length });
    this.currentView = 'zhMeaning';
    this.zhMeaningQueue = this._zhMeaningQueue(words);
    this._zhMeaningRender();
  },

  _zhMeaningQueue(words) {
    const wrongZi = [];
    try {
      const ziSet = {};
      words.forEach(w => { ziSet[String(w.zi || '')] = true; });
      const seen = {};
      Storage.getWrongWords().forEach(rw => {
        const zi = String(rw.wordEn || '');
        if (ziSet[zi] && !seen[zi]) { seen[zi] = true; wrongZi.push(zi); }
      });
    } catch (e) {}
    const queue = [];
    const used = {};
    let wi = 0;
    for (let i = 0; i < words.length; i++) {
      queue.push({ w: words[i], review: false });
      while (wi < wrongZi.length) {
        const zi = wrongZi[wi++];
        const w = words.find(x => String(x.zi || '') === zi);
        if (w && !used[zi]) { used[zi] = true; queue.push({ w: w, review: true }); break; }
      }
    }
    return queue;
  },

  _zhMeaningRender() {
    const queue = this.zhMeaningQueue;
    const idx = this.zhMeaningIdx;
    if (idx >= queue.length) {
      const main = document.getElementById('main-content');
      const total = queue.length;
      const pct = total ? Math.round((this.zhMeaningCorrect / total) * 100) : 0;
      if (this.activeSessionId) {
        const stars = pct >= 90 ? 3 : pct >= 60 ? 2 : 1;
        Storage.endSession(this.activeSessionId, { correctCount: this.zhMeaningCorrect, wrongCount: total - this.zhMeaningCorrect, totalItems: total, accuracy: pct, stars: stars, xp: this.zhMeaningCorrect * 5 });
        this.activeSessionId = null;
        this._autoPushReport();
      }
      main.innerHTML = '<div class="reading-container">' + this._zhExitBtn() +
        '<h2 class="reading-title">🎯 释义练习完成</h2>' +
        '<div class="quiz-summary">答对 ' + this.zhMeaningCorrect + ' / ' + total +
        '（' + pct + '%）' + (pct >= 80 ? ' 🎉 太棒了！' : ' 💪 继续努力！') + '</div></div>';
      return;
    }
    const words = this.zhMeaningWords;
    const q = queue[idx].w;
    const review = queue[idx].review;
    const mode = idx % 2;
    const self = this;
    const done = this.zhMeaningDone[idx];
    const chosen = this.zhMeaningChosen[idx];

    let opts;
    if (mode === 0) {
      opts = this._zhPickOptions(words, words.indexOf(q), 4);
    } else {
      const correct = String(q.yi || '');
      const others = words.filter(w => w !== q).map(w => String(w.yi || '')).filter(y => y && y !== correct);
      opts = [correct];
      for (let i = others.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = others[i]; others[i] = others[j]; others[j] = t;
      }
      for (let i = 0; i < others.length && opts.length < 4; i++) {
        if (!opts.includes(others[i])) opts.push(others[i]);
      }
      for (let i = opts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = opts[i]; opts[i] = opts[j]; opts[j] = t;
      }
    }

    const main = document.getElementById('main-content');
    let html = '<div class="reading-container">';
    html += this._zhExitBtn();
    html += '<h2 class="reading-title">🎯 释义理解' + (review ? ' · 🔁 错题复习' : '') + '</h2>';
    html += '<div class="quiz-area">';
    if (mode === 0) {
      html += `<div class="zh-q-word" id="zh-q-word">${q.zi}</div>`;
      html += '<div class="zh-q-options zh-q-opts-col">';
      opts.forEach((w, i) => {
        const t = String(w.yi || '');
        let cls = 'zh-q-opt zh-q-opt-meaning';
        if (done !== undefined) {
          if (t === String(q.yi || '')) cls += ' correct';
          else if (done === false && chosen === t) cls += ' wrong';
        }
        html += `<button class="${cls}" data-oi="${i}" data-wi="${words.indexOf(w)}"${done !== undefined ? ' disabled' : ''}>${t}</button>`;
      });
      html += '</div>';
    } else {
      html += `<div class="zh-q-word zh-q-def" id="zh-q-word">${q.yi || ''}</div>`;
      html += '<div class="zh-q-options zh-q-opts-col">';
      opts.forEach((y, i) => {
        let wi = -1;
        try { const found = words.find(w => !!w.yi && String(w.yi) === y); wi = found ? words.indexOf(found) : -1; } catch (e) {}
        const t = wi >= 0 ? words[wi].zi : y;
        let cls = 'zh-q-opt';
        if (done !== undefined) {
          if (t === String(q.zi || '')) cls += ' correct';
          else if (done === false && chosen === t) cls += ' wrong';
        }
        html += `<button class="${cls}" data-oi="${i}" data-wi="${wi}"${done !== undefined ? ' disabled' : ''}>${t}</button>`;
      });
      html += '</div>';
    }
    let fbText = '请选择正确答案';
    if (done === true) fbText = '✅ 回答正确！';
    else if (done === false) fbText = '❌ 答案是「' + (mode === 0 ? (q.yi || '') : q.zi) + '」';
    html += `<div class="zh-q-fb" id="zh-q-fb">${fbText}</div>`;
    html += `<div class="zh-q-score" id="zh-q-score">${this.zhMeaningCorrect} / ${this.zhMeaningDone.filter(v => v !== undefined).length}</div>`;
    html += '<div class="zh-q-nav">';
    if (idx > 0) html += '<button class="reading-ctrl-btn" id="zh-prev-q">◀ 上一个</button>';
    html += '<button class="reading-ctrl-btn" id="zh-next-q">下一个 ▶</button>';
    html += '</div></div></div>';
    main.innerHTML = html;

    document.querySelectorAll('.zh-q-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const oi = parseInt(btn.dataset.oi);
        const wi = parseInt(btn.dataset.wi);
        self._zhMeaningAnswer(btn, oi, wi, q, mode);
      });
    });
    const prevBtn = document.getElementById('zh-prev-q');
    if (prevBtn) prevBtn.addEventListener('click', () => {
      self.zhMeaningIdx--;
      self._zhMeaningRender();
    });
    document.getElementById('zh-next-q').addEventListener('click', () => {
      self.zhMeaningIdx++;
      self._zhMeaningRender();
    });
  },

  _zhMeaningAnswer(btn, oi, wi, q, mode) {
    const self = this;
    const fb = document.getElementById('zh-q-fb');
    const optBtns = document.querySelectorAll('.zh-q-opt');
    optBtns.forEach(b => b.disabled = true);
    let ok = false;
    let chosenLabel = '';
    if (mode === 0) {
      ok = String(q.yi || '') === btn.textContent.trim();
      chosenLabel = btn.textContent.trim();
    } else {
      ok = String(q.zi || '') === btn.textContent.trim();
      chosenLabel = btn.textContent.trim();
    }
    this.zhMeaningDone[this.zhMeaningIdx] = ok;
    this.zhMeaningChosen[this.zhMeaningIdx] = chosenLabel;
    if (ok) {
      this.zhMeaningCorrect++;
      if (fb) fb.textContent = '✅ 回答正确！';
      btn.classList.add('correct');
    } else {
      if (fb) fb.textContent = '❌ 答案是「' + (mode === 0 ? (q.yi || '') : q.zi) + '」';
      btn.classList.add('wrong');
      optBtns.forEach(b => {
        const t = b.textContent.trim();
        if ((mode === 0 && t === String(q.yi || '')) || (mode === 1 && t === String(q.zi))) {
          if (!b.disabled || !b.classList.contains('wrong')) b.classList.add('correct');
        }
      });
      this._zhAddWrong(q, this._zhInfo(this.currentUnitId));
    }
    const scoreEl = document.getElementById('zh-q-score');
    if (scoreEl) scoreEl.textContent = this.zhMeaningCorrect + ' / ' + this.zhMeaningDone.filter(v => v !== undefined).length;
  },

  startZhPoemFill(uid) {
    const info = this._zhInfo(uid);
    const words = info.words.slice();
    if (words.length < 2) { this.renderZhStudy(uid); return; }
    const self = this;
    this.stopSpeaking();
    this.zhFillWords = words;
    this.zhFillIdx = 0;
    this.zhFillCorrect = 0;
    this.currentView = 'zhFill';
    this._zhFillRender();
  },

  _zhPoemLines(poemText) {
    const text = String(poemText || '').replace(/\n/g, '');
    const lines = text.split(/[，。！？；]/).map(s => s.trim()).filter(s => s.length > 0 && /[\u4e00-\u9fff]/.test(s));
    return lines;
  },

  _zhFillRender() {
    const self = this;
    const words = this.zhFillWords;
    const idx = this.zhFillIdx;
    if (idx >= words.length) {
      const main = document.getElementById('main-content');
      const pct = words.length ? Math.round((this.zhFillCorrect / words.length) * 100) : 0;
      main.innerHTML = '<div class="reading-container">' + this._zhExitBtn() +
        '<h2 class="reading-title">🧩 接句练习完成</h2>' +
        '<div class="quiz-summary">答对 ' + this.zhFillCorrect + ' / ' + words.length +
        '（' + pct + '%）' + (pct >= 80 ? ' 🎉 熟读成诵！' : ' 💪 多读几遍！') + '</div></div>';
      return;
    }
    const poem = words[idx];
    const lines = this._zhPoemLines(poem.yi);
    if (lines.length < 2) { this.zhFillIdx++; this._zhFillRender(); return; }

    const blank = Math.floor(Math.random() * lines.length);
    const blankText = lines[blank];
    const others = lines.filter(l => l !== blankText);
    let opts = [blankText];
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = others[i]; others[i] = others[j]; others[j] = t;
    }
    for (let i = 0; i < others.length && opts.length < 4; i++) {
      if (!opts.includes(others[i])) opts.push(others[i]);
    }
    while (opts.length < 4) {
      const filler = '明月几时有';
      if (!opts.includes(filler)) opts.push(filler);
      else break;
    }
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = opts[i]; opts[i] = opts[j]; opts[j] = t;
    }

    const main = document.getElementById('main-content');
    let html = '<div class="reading-container">';
    html += this._zhExitBtn();
    html += '<h2 class="reading-title">🧩 接句填空：' + poem.zi + '</h2>';
    html += `<div class="zh-poem-title-small">${poem.pinyin || ''}</div>`;
    html += '<div class="quiz-area">';
    const shown = lines.map((l, i) => i === blank ? '<span class="zh-blank">______</span>' : l);
    html += `<div class="zh-poem-question">${shown.join('，')}</div>`;
    html += '<div class="zh-q-options zh-q-opts-col">';
    opts.forEach((o, i) => {
      html += `<button class="zh-q-opt" data-oi="${i}">${o}</button>`;
    });
    html += '</div>';
    html += `<div class="zh-q-fb" id="zh-q-fb">想一想，哪一句填在空缺处？</div>`;
    html += `<div class="zh-q-score" id="zh-q-score">${this.zhFillCorrect} / ${this.zhFillIdx}</div>`;
    html += '</div></div>';
    main.innerHTML = html;

    document.querySelectorAll('.zh-q-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        const oi = parseInt(btn.dataset.oi);
        self._zhFillAnswer(btn, opts[oi], blankText, poem);
      });
    });
  },

  _zhFillAnswer(btn, chosen, blankText, poem) {
    const self = this;
    const fb = document.getElementById('zh-q-fb');
    const optBtns = document.querySelectorAll('.zh-q-opt');
    optBtns.forEach(b => b.disabled = true);
    const ok = chosen === blankText;
    if (ok) {
      this.zhFillCorrect++;
      if (fb) fb.textContent = '✅ 正确！' + (blankText || '');
      btn.classList.add('correct');
    } else {
      if (fb) fb.textContent = '❌ 正确答案：「' + blankText + '」';
      btn.classList.add('wrong');
      optBtns.forEach(b => { if (b.textContent.trim() === blankText) b.classList.add('correct'); });
      try {
        Storage.addWrongWord(String(poem.zi || ''), String(poem.yi || ''), this.currentUnitId, (this.getUnitInfo(this.currentUnitId) || {}).unitTitle || '', 'chinese');
      } catch (e) {}
    }
    this.zhFillIdx++;
    const scoreEl = document.getElementById('zh-q-score');
    if (scoreEl) scoreEl.textContent = this.zhFillCorrect + ' / ' + this.zhFillIdx;
    setTimeout(function() { self._zhFillRender(); }, 1600);
  },

  startZhPoemAuthor(uid) {
    const info = this._zhInfo(uid);
    const words = info.words.slice();
    if (words.length < 2) { this.renderZhStudy(uid); return; }
    const self = this;
    this.stopSpeaking();
    this.zhAuthorWords = words;
    this.zhAuthorIdx = 0;
    this.zhAuthorCorrect = 0;
    this.activeSessionId = Storage.startSession('zhAuthor', uid, info.unitTitle, info.gradeTitle, { subject: 'chinese', totalItems: words.length });
    this.currentView = 'zhAuthor';
    this._zhAuthorRender();
  },

  _zhAuthorRender() {
    const self = this;
    const words = this.zhAuthorWords;
    const idx = this.zhAuthorIdx;
    if (idx >= words.length) {
      const main = document.getElementById('main-content');
      const pct = words.length ? Math.round((this.zhAuthorCorrect / words.length) * 100) : 0;
      if (this.activeSessionId) {
        const stars = pct >= 90 ? 3 : pct >= 60 ? 2 : 1;
        Storage.endSession(this.activeSessionId, { correctCount: this.zhAuthorCorrect, wrongCount: words.length - this.zhAuthorCorrect, totalItems: words.length, accuracy: pct, stars: stars, xp: this.zhAuthorCorrect * 5 });
        this.activeSessionId = null;
        this._autoPushReport();
      }
      main.innerHTML = '<div class="reading-container">' + this._zhExitBtn() +
        '<h2 class="reading-title">🏛 作者朝代练习完成</h2>' +
        '<div class="quiz-summary">答对 ' + this.zhAuthorCorrect + ' / ' + words.length +
        '（' + pct + '%）' + (pct >= 80 ? ' 🎉 博学多才！' : ' 💪 温故知新！') + '</div></div>';
      return;
    }
    const poem = words[idx];
    const author = String(poem.pinyin || '');
    if (!author) { this.zhAuthorIdx++; this._zhAuthorRender(); return; }
    const others = words.filter(w => w !== poem).map(w => String(w.pinyin || '')).filter(a => a && a !== author);
    let opts = [author];
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = others[i]; others[i] = others[j]; others[j] = t;
    }
    for (let i = 0; i < others.length && opts.length < 4; i++) {
      if (!opts.includes(others[i])) opts.push(others[i]);
    }
    while (opts.length < 4) {
      const filler = '唐·李白';
      if (!opts.includes(filler)) opts.push(filler);
      else break;
    }
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = opts[i]; opts[i] = opts[j]; opts[j] = t;
    }

    const main = document.getElementById('main-content');
    let html = '<div class="reading-container">';
    html += this._zhExitBtn();
    html += '<h2 class="reading-title">🏛 作者朝代："' + poem.zi + '"的作者是谁？</h2>';
    html += '<div class="quiz-area">';
    html += `<div class="zh-poem-question">${String(poem.yi || '').split(/[。！？；\n]/).filter(Boolean).join('<br>')}</div>`;
    html += '<div class="zh-q-options zh-q-opts-col">';
    opts.forEach((a, i) => {
      html += `<button class="zh-q-opt" data-oi="${i}">${a}</button>`;
    });
    html += '</div>';
    html += `<div class="zh-q-fb" id="zh-q-fb">选出这首诗的作者和朝代</div>`;
    html += `<div class="zh-q-score" id="zh-q-score">${this.zhAuthorCorrect} / ${this.zhAuthorIdx}</div>`;
    html += '</div></div>';
    main.innerHTML = html;

    document.querySelectorAll('.zh-q-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        const oi = parseInt(btn.dataset.oi);
        self._zhAuthorAnswer(btn, opts[oi], author, poem);
      });
    });
  },

  _zhAuthorAnswer(btn, chosen, author, poem) {
    const self = this;
    const fb = document.getElementById('zh-q-fb');
    const optBtns = document.querySelectorAll('.zh-q-opt');
    optBtns.forEach(b => b.disabled = true);
    const ok = chosen === author;
    if (ok) {
      this.zhAuthorCorrect++;
      if (fb) fb.textContent = '✅ 正确！';
      btn.classList.add('correct');
    } else {
      if (fb) fb.textContent = '❌ 正确答案：「' + author + '」';
      btn.classList.add('wrong');
      optBtns.forEach(b => { if (b.textContent.trim() === author) b.classList.add('correct'); });
      try {
        Storage.addWrongWord(String(poem.zi || ''), String(poem.pinyin || poem.yi || ''), this.currentUnitId, (this.getUnitInfo(this.currentUnitId) || {}).unitTitle || '', 'chinese');
      } catch (e) {}
    }
    this.zhAuthorIdx++;
    const scoreEl = document.getElementById('zh-q-score');
    if (scoreEl) scoreEl.textContent = this.zhAuthorCorrect + ' / ' + this.zhAuthorIdx;
    setTimeout(function() { self._zhAuthorRender(); }, 1400);
  },

  renderModules(grade) {
    const main = document.getElementById('main-content');
    const progress = this.progress;

    let html = '<div class="module-container">';
    html += `<button class="back-btn" onclick="App.goBack()">← 返回上一级</button>`;
    html += `<h2 class="module-header">${grade.icon} ${grade.title}</h2>`;
    html += `<div class="module-list">`;

    grade.modules.forEach(m => {
      let completedUnits = 0;
      const totalUnits = m.units.length;
      m.units.forEach(u => {
        if (progress.completedLessons[u.id]) completedUnits++;
      });
      const pct = totalUnits > 0 ? Math.round((completedUnits / totalUnits) * 100) : 0;

      html += `
        <div class="module-card" data-midx="${m.id}">
          <div class="module-icon">📖</div>
          <div class="module-info">
            <div class="module-title">${m.title}</div>
            <div class="module-bar"><div class="module-bar-fill" style="width:${pct}%;background:${grade.color}"></div></div>
            <div class="module-progress-text">${completedUnits}/${totalUnits} 单元完成</div>
          </div>
          <div class="module-arrow">▶</div>
        </div>`;
    });

    html += '</div></div>';
    main.innerHTML = html;

    document.querySelectorAll('.module-card').forEach(card => {
      card.addEventListener('click', () => {
        const mid = parseInt(card.dataset.midx);
        const module = grade.modules.find(m => m.id === mid);
        if (module) {
          this.currentModuleId = mid;
          this.navStack.push('module');
          this.renderUnits(grade, module);
        }
      });
    });
  },

  renderUnits(grade, module) {
    const main = document.getElementById('main-content');
    const progress = this.progress;

    let html = '<div class="unit-container">';
    html += '<button class="back-btn" onclick="App.goBack()">← 返回上一级</button>';
    html += '<h2 class="unit-header">📖 ' + module.title + '</h2>';
    html += '<div class="unit-list">';

    module.units.forEach((unit, idx) => {
      const stars = progress.lessonStars[unit.id] || 0;
      const completed = progress.completedLessons[unit.id];
      const starStr = completed ? '⭐'.repeat(stars) + '☆'.repeat(3 - stars) : '☆☆☆';
      const completedCls = completed ? ' completed' : '';

      html += `
        <div class="unit-item${completedCls}">
          <div class="unit-num">${idx + 1}</div>
          <div class="unit-detail">
            <div class="unit-name">${unit.title}</div>
            <div class="unit-word-count">${unit.words.length} 个单词</div>
            <div class="unit-stars-display">${starStr}</div>
          </div>
          <div class="unit-btns">
            <button class="unit-flashcard-btn" data-uid="${unit.id}">🃏 闪卡</button>
            <button class="unit-passage-btn" data-uid="${unit.id}">📖 课文</button>
            <button class="unit-hear-choose-btn" data-uid="${unit.id}">🎧 听选</button>
            <button class="unit-hear-spell-btn" data-uid="${unit.id}">🎤 听拼</button>
            <button class="unit-game-btn" data-uid="${unit.id}">🎮 消消乐</button>
            <button class="unit-start-btn" data-uid="${unit.id}">练习</button>
          </div>
        </div>`;
    });

    html += '</div></div>';
    main.innerHTML = html;

    document.querySelectorAll('.unit-start-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = parseInt(btn.dataset.uid);
        this.currentUnitId = uid;
        this.startLesson(uid);
      });
    });

    document.querySelectorAll('.unit-passage-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = parseInt(btn.dataset.uid);
        this.currentUnitId = uid;
        this.renderReading(uid);
      });
    });

    document.querySelectorAll('.unit-flashcard-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = parseInt(btn.dataset.uid);
        this.currentUnitId = uid;
        this.renderFlashcards(uid);
      });
    });

    document.querySelectorAll('.unit-hear-choose-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = parseInt(btn.dataset.uid);
        this.startSingleType(uid, 'hearChoose', '🎧 听读选词');
      });
    });

    document.querySelectorAll('.unit-hear-spell-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = parseInt(btn.dataset.uid);
        this.startSingleType(uid, 'hearSpell', '🎤 听读拼词');
      });
    });

    document.querySelectorAll('.unit-game-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = parseInt(btn.dataset.uid);
        this.currentUnitId = uid;
        this.startMatchGame(uid);
      });
    });

    document.querySelectorAll('.unit-dictation-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = parseInt(btn.dataset.uid);
        this.currentUnitId = uid;
        this.startDictation(uid);
      });
    });
  },

  dcWords: [], dcIndex: 0, dcRepeat: 0, dcTimer: null, _dcRunning: false, _dcFallback: null,

  mgCards: [], mgFlipped: [], mgMatched: 0, mgMoves: 0, mgLocked: false,

  startMatchGame(unitId, dailyWords) {
    const mgDaily = !!dailyWords;
    const words0 = dailyWords || this.getUnitWords(unitId);
    if (!words0.length) return;
    const words = words0.filter(w => {
      const text = w.zi !== undefined ? String(w.zi).trim() : String(w.en || w.zi || '').trim();
      const face = w.zi !== undefined ? (String(w.yi || '').trim() || String(w.pinyin || '').trim()) : String(w.cn || '').trim();
      return text && face && text !== face;
    });
    if (words.length < 2) { if (mgDaily) this.renderZhDailyModes(); return; }
    const pool = words.slice(0, 6);
    const cards = [];
    pool.forEach((w, i) => {
      const isChinese = w.zi !== undefined;
      const en = isChinese ? w.zi : w.en;
      const face = isChinese ? (String(w.yi || '').trim() || w.pinyin) : w.cn;
      const cn = face;
      cards.push({ id: i, text: en, type: 'en', pairId: i });
      cards.push({ id: i + 100, text: cn, type: 'cn', pairId: i });
    });
    this.mgDaily = mgDaily;
    this.mgCards = cards.sort(() => Math.random() - 0.5);
    this.mgFlipped = [];
    this.mgMatched = 0;
    this.mgMoves = 0;
    this.mgLocked = false;
    this.currentView = 'game';
    this._renderMatchGame();
  },

  _renderMatchGame() {
    const main = document.getElementById('main-content');
    const total = this.mgCards.length / 2;
    const backFn = this.mgDaily ? 'App.renderZhDailyModes()' : 'App.exitToUnit()';
    let html = '<div class="mg-container">';
    html += '<button class="back-btn" onclick="' + backFn + '">← 返回上一级</button>';
    html += '<h2 class="mg-title">🧩 识字配对</h2>';
    html += '<div class="mg-info">配对：<strong>' + this.mgMatched + '/' + total + '</strong> · 步数：' + this.mgMoves + '</div>';
    html += '<div class="mg-grid">';
    this.mgCards.forEach((c, i) => {
      const matched = this.mgFlipped.includes(i) || c.matched;
      const flipped = this.mgFlipped.includes(i);
      const text = matched ? c.text : '?';
      html += '<div class="mg-card' + (matched ? ' mg-matched' : '') + (flipped ? ' mg-flipped' : '') + '" data-idx="' + i + '"><span>' + text + '</span></div>';
    });
    html += '</div>';
    html += '</div>';
    main.innerHTML = html;

    document.querySelectorAll('.mg-card').forEach(card => {
      if (card.classList.contains('mg-matched')) return;
      card.addEventListener('click', () => {
        if (this.mgLocked) return;
        const idx = parseInt(card.dataset.idx);
        if (this.mgFlipped.includes(idx)) return;
        this.mgFlipped.push(idx);
        this._renderMatchGame();
        if (this.mgFlipped.length === 2) {
          this.mgMoves++;
          const c1 = this.mgCards[this.mgFlipped[0]];
          const c2 = this.mgCards[this.mgFlipped[1]];
          if (c1.pairId === c2.pairId && c1.type !== c2.type) {
            this.mgCards[this.mgFlipped[0]].matched = true;
            this.mgCards[this.mgFlipped[1]].matched = true;
            this.mgMatched++;
            this.mgFlipped = [];
            if (this.mgMatched >= this.mgCards.length / 2) {
              setTimeout(() => this._finishMatchGame(), 600);
            } else {
              setTimeout(() => this._renderMatchGame(), 400);
            }
          } else {
            this.mgLocked = true;
            setTimeout(() => {
              this.mgFlipped = [];
              this.mgLocked = false;
              this._renderMatchGame();
            }, 800);
          }
        }
      });
    });
  },

  _finishMatchGame() {
    const main = document.getElementById('main-content');
    const total = this.mgCards.length / 2;
    const backFn = this.mgDaily ? 'App.renderZhDailyModes()' : 'App.exitToUnit()';
    let html = '<div class="result-container">';
    html += '<div class="result-icon">🎉</div>';
    html += '<h2>全部配对成功!</h2>';
    html += '<p>共 ' + total + ' 组词 · ' + this.mgMoves + ' 步完成</p>';
    if (this.mgMoves <= total + 3) html += '<p style="color:var(--primary)">🏆 完美！记忆力超强！</p>';
    else if (this.mgMoves <= total * 2) html += '<p style="color:var(--primary)">👍 做得不错！</p>';
    else html += '<p>💪 继续加油！</p>';
    html += '<button class="continue-btn" onclick="' + backFn + '">' + (this.mgDaily ? '返回语文作业' : '返回上一级') + '</button>';
    html += '</div>';
    main.innerHTML = html;
  },

  startDictation(unitId) {
    const words = this.getUnitWords(unitId);
    if (!words.length) return;
    this.dcWords = words;
    this.dcIndex = 0;
    this.dcRepeat = 0;
    this._dcRunning = false;
    this.stopSpeaking();
    if (this.dcTimer) clearTimeout(this.dcTimer);
this.currentView = 'dictation';
    this._ttsSpeak({ text: word.zi, language: 'zh-CN', volume: 0 });
  },

  _renderDictation() {
    const main = document.getElementById('main-content');
    const word = this.dcWords[this.dcIndex];
    const total = this.dcWords.length;

    let html = '<div class="exercise-container">';
    html += '<button class="back-btn" onclick="App.exitToUnit()">← 返回上一级</button>';
    html += '<div class="exercise-progress-bar"><div class="exercise-progress-fill" style="width:' + ((this.dcIndex + 1) / total * 100) + '%"></div></div>';
    html += '<div class="exercise-count">第 ' + (this.dcIndex + 1) + '/' + total + ' 个词语</div>';
    html += '<div class="question-text" style="font-size:32px;margin:20px 0 10px">' + word.pinyin + '</div>';
    html += '<div class="fill-hint" id="dc-answer" style="min-height:28px;font-size:20px"></div>';
    html += '<div style="text-align:center;margin:16px 0">';
    if (this.dcRepeat === 0) {
      html += '<button class="speaker-btn" id="dc-speak-btn" style="font-size:20px;padding:16px 40px">▶ 开始朗读</button>';
    } else if (this.dcRepeat < 3) {
      html += '<div style="color:var(--primary);font-weight:700;font-size:16px">🔊 朗读第 ' + this.dcRepeat + '/3 遍...</div>';
    } else {
      html += '<div style="color:var(--primary);font-weight:700;font-size:16px">朗读完成 ✓</div>';
    }
    html += '</div>';
    html += '<div class="fc-nav">';
    html += '<button class="fc-nav-btn" id="dc-show-btn">📝 显示答案</button>';
    html += '<button class="fc-nav-btn fc-flip-btn" id="dc-next-btn">下一个 ▶</button>';
    html += '</div></div>';
    main.innerHTML = html;

    const speakBtn = document.getElementById('dc-speak-btn');
    if (speakBtn) {
      speakBtn.addEventListener('click', () => { this._doSpeakWord(); });
    }
    document.getElementById('dc-show-btn').addEventListener('click', () => {
      const w = this.dcWords[this.dcIndex];
      document.getElementById('dc-answer').innerHTML = '<strong>' + w.zi + '</strong> /' + w.pinyin + '/ ' + (w.yi || '');
    });
    document.getElementById('dc-next-btn').addEventListener('click', () => this._nextDictationWord());
  },

  _zhVoices: null,
  _enVoiceCache: null,

  _doSpeakWord() {
    if (this._dcRunning) return;
    this._dcRunning = true;
    this.dcIndex = 0;
    this.dcRepeat = 0;
    this._dcPlayAll();
  },

  _dcPlayAll() {
    if (this.dcIndex >= this.dcWords.length) {
      this._dcRunning = false;
      this.stopSpeaking();
      this._showDictationResult();
      return;
    }
    this._dcRepeat = 0;
    this._dcReadCurrent();
  },

  _dcReadCurrent() {
    if (!this._dcRunning) return;

    if (this.dcRepeat >= 3) {
      this.dcRepeat = 0;
      this.dcIndex++;
      if (this.dcIndex >= this.dcWords.length) {
        this.stopSpeaking();
        this._dcRunning = false;
        this._showDictationResult();
        return;
      }
      this.dcTimer = setTimeout(() => this._dcPlayAll(), 500);
      return;
    }

    const word = this.dcWords[this.dcIndex];
    this._renderDictation();

    let fired = false;
    const next = () => { if (fired) return; fired = true; this.dcRepeat++; this.dcTimer = setTimeout(() => this._dcReadCurrent(), 1000); };

    this._ttsSpeak({ text: word.zi, language: 'zh-CN', volume: 1, onEnd: next });
    if (this._dcFallback) clearTimeout(this._dcFallback);
    this._dcFallback = setTimeout(next, 8000);
  },

  _nextDictationWord() {
    this.stopSpeaking();
    if (this.dcTimer) clearTimeout(this.dcTimer);
    this.dcRepeat = 0;
    if (this.dcIndex < this.dcWords.length - 1) {
      this.dcIndex++;
      this._renderDictation();
    } else {
      this._showDictationResult();
    }
  },

  _showDictationResult() {
    const main = document.getElementById('main-content');
    let html = '<div class="result-container">';
    html += '<div class="result-icon">📝</div>';
    html += '<h2>听写完成！</h2>';
    html += '<p style="margin:8px 0;color:var(--text-light)">共 ' + this.dcWords.length + ' 个词语</p>';
    html += '<div class="result-answers">';
    this.dcWords.forEach((w, i) => {
      html += '<div class="result-answer-item"><span class="result-answer-num">' + (i + 1) + '.</span><span style="font-weight:700;font-size:22px">' + w.zi + '</span></div>';
    });
    html += '</div>';
    html += '<button class="continue-btn" onclick="App.exitToUnit()">返回上一级</button>';
    html += '</div>';
    main.innerHTML = html;
  },

  goBack() {
    this.stopSpeaking();
    this.stopRecognition();
    this._dcRunning = false;
    this.zhStudyAuto = false;
    this.zhStrokePlaying = false;
    if (this.zhStrokeTimer) { clearInterval(this.zhStrokeTimer); this.zhStrokeTimer = null; }
    if (this.dcTimer) { clearTimeout(this.dcTimer); this.dcTimer = null; }
    if (this._dcFallback) { clearTimeout(this._dcFallback); this._dcFallback = null; }
    if (this.fcAutoTimer) { clearTimeout(this.fcAutoTimer); this.fcAutoTimer = null; }
    if (this._fcKeyHandler) { document.removeEventListener('keydown', this._fcKeyHandler); this._fcKeyHandler = null; }
    if (this.readingTimer) { clearTimeout(this.readingTimer); this.readingTimer = null; }

    if (this.navStack.length <= 1 || this.navStack[this.navStack.length - 1] === 'grade') {
      this.renderGrades();
      return;
    }
    this.navStack.pop();
    const prev = this.navStack[this.navStack.length - 1];

    if (prev === 'grade') {
      const grade = this.getCourseData().grades.find(g => g.id === this.currentGradeId);
      if (grade) this.renderAllUnits(grade);
      else this.renderGrades();
    } else if (prev === 'module') {
      const grade = this.getCourseData().grades.find(g => g.id === this.currentGradeId);
      const module = grade ? grade.modules.find(m => m.id === this.currentModuleId) : null;
      if (grade && module) this.renderUnits(grade, module);
      else this.renderGrades();
    } else {
      this.renderGrades();
    }
  },

  readingIdx: 0,
  readingPlaying: false,
  readingTimer: null,

  renderReading(unitId) {
    const PASSAGE_MAP = {
      10001: 110101, 10002: 110103, 10003: 110301, 10004: 110201,
      10005: 120401, 10006: 110401, 10007: 120201, 10008: 210402,
      10009: 210401, 10010: 210402, 10011: 110401, 10012: 120301,
      10013: 120103, 10014: 120301, 10015: 210201, 10016: 220101,
      10017: 120103, 10018: 210402, 10019: 210101, 10020: 210103,
      10021: 210402, 10022: 220101, 10023: 210301, 10024: 210302,
    };
    let passage = UNIT_PASSAGES[PASSAGE_MAP[unitId] || unitId];
    if (!passage) {
      const words = this.getUnitWords(unitId);
      if (!words.length) { this.goBack(); return; }
      const isChinese = words[0].zi !== undefined;
      const sentences = [];
      if (isChinese) {
        const pool = words.slice(0, 16);
        pool.forEach(w => {
          sentences.push({ en: w.zi, cn: w.pinyin + ' · ' + (w.yi || '') });
        });
      } else {
        const pool = words.slice(0, 8);
        const frames = [
          (w) => ({ en: 'I like ' + w.en + '.', cn: '我喜欢' + w.cn + '。' }),
          (w) => ({ en: 'Look at ' + w.en + '.', cn: '看' + w.cn + '。' }),
          (w) => ({ en: 'Can you see ' + w.en + '?', cn: '你能看到' + w.cn + '吗？' }),
          (w) => ({ en: 'This is ' + w.en + '.', cn: '这是' + w.cn + '。' }),
          (w) => ({ en: 'I can ' + w.en + '.', cn: '我可以' + w.cn + '。' }),
          (w) => ({ en: w.en + ' is nice.', cn: w.cn + '很好。' }),
          (w) => ({ en: 'We have ' + w.en + '.', cn: '我们有' + w.cn + '。' }),
          (w) => ({ en: 'Do you like ' + w.en + '?', cn: '你喜欢' + w.cn + '吗？' }),
        ];
        pool.forEach((w, i) => {
          const fn = frames[i % frames.length];
          sentences.push(fn(w));
        });
      }
      passage = { title: 'Unit Reading', sentences };
    }

    this.currentView = 'reading';
    this.readingIdx = 0;
    this.readingPlaying = false;
    if (this.readingTimer) clearTimeout(this.readingTimer);
    this.stopSpeaking();

    const ui = this.getUnitInfo(unitId);
    if (ui.unitTitle) {
      this.activeSessionId = Storage.startSession('reading', unitId, ui.unitTitle, ui.gradeTitle, {
        subject: this.currentSubject,
        totalItems: passage.sentences.length
      });
    }

    const main = document.getElementById('main-content');
    let html = '<div class="reading-container">';
    html += '<button class="back-btn" onclick="App.exitToUnit()">← 返回上一级</button>';
    html += `<h2 class="reading-title">📖 ${passage.title}</h2>`;

    html += '<div class="reading-controls">';
    html += '<button class="reading-ctrl-btn" id="play-all-btn">▶ 播放全文</button>';
    html += '<button class="reading-ctrl-btn" id="follow-btn">🗣 逐句跟读</button>';
    html += '<button class="reading-ctrl-btn reading-record-btn" id="reading-record-btn">🎤 录音跟读</button>';
    html += '</div>';
    html += '<div class="reading-record-fb" id="reading-record-fb"></div>';

    html += '<div class="reading-passage">';
    passage.sentences.forEach((s, i) => {
      html += `<div class="reading-sentence" data-idx="${i}">
        <div class="reading-en">${s.en}</div>
        <div class="reading-cn">${s.cn}</div>
        <button class="reading-speak-btn" data-idx="${i}">🔊</button>
      </div>`;
    });
    html += '</div>';
    html += '</div>';
    main.innerHTML = html;

    document.querySelectorAll('.reading-speak-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        this.speakSentence(passage, idx);
      });
    });

    document.querySelectorAll('.reading-sentence').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx);
        this.speakSentence(passage, idx);
      });
    });

    document.getElementById('play-all-btn').addEventListener('click', () => {
      this.playAllSentences(passage);
    });

    document.getElementById('follow-btn').addEventListener('click', () => {
      this.followRead(passage);
    });

    const recBtn = document.getElementById('reading-record-btn');
    if (recBtn) {
      let isRecording = false;
      const s = passage.sentences[this.readingIdx] || passage.sentences[0];
      this.readingIdx = this.readingIdx || 0;
      recBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const fb = document.getElementById('reading-record-fb');
        if (isRecording) {
          this.stopRecognition();
          this.stopAudioRecording().then(audioUrl => {
            isRecording = false;
            recBtn.classList.remove('recording');
            recBtn.textContent = '🎤 录音跟读';
            if (!fb) return;
            if (audioUrl) {
              fb.innerHTML = '<button class="play-recording-btn" data-url="' + audioUrl + '">🔊 播放录音</button>';
            } else {
              var errMsg = this._recError ? '（' + this._recError + '）' : '（浏览器不支持录音回放）';
              fb.innerHTML = '录制失败' + errMsg;
            }
          });
        } else {
          isRecording = true;
          recBtn.classList.add('recording');
          recBtn.textContent = '⏹ 停止录音';
          if (fb) fb.innerHTML = '<div class="record-listening">🎤 正在听...</div>';
          this._beginFollowRecording(s.en, (data) => {
            if (data.interim && fb) {
              fb.innerHTML = '<div class="record-interim">' + data.result + '</div>';
            }
          });
        }
      });
    }

    this.updateTopBar();
  },

  speakSentence(passage, idx, onEnd) {
    this.stopSpeaking();
    document.querySelectorAll('.reading-sentence').forEach(el => el.classList.remove('active'));
    const el = document.querySelector(`.reading-sentence[data-idx="${idx}"]`);
    if (el) el.classList.add('active');

    const sentence = passage.sentences[idx];
    const text = sentence.en.replace(/\s*\/\s*/g, ', ');
    const hasChinese = /[\u4e00-\u9fff]/.test(sentence.en);

    const lang = hasChinese ? 'zh-CN' : 'en-US';
    const done = () => {
      if (el) el.classList.remove('active');
      if (onEnd) onEnd();
    };
    if (!hasChinese && this._enIdx) {
      const t = text.trim();
      if (this._enIdx[t] != null) {
        this._enPlaySentence(t, () => { this._enPlayWords(t, done); }, done);
        return;
      }
    }
    this._ttsSpeak({
      text: text,
      language: lang,
      volume: 1,
      onEnd: done
    });
  },

  stopSpeaking() {
    this._zhSpeakGen = (this._zhSpeakGen || 0) + 1;
    this._ttsCancel();
    if (this.readingTimer) {
      clearTimeout(this.readingTimer);
      this.readingTimer = null;
    }
  },

  playAllSentences(passage) {
    if (this.readingPlaying) {
      this.readingPlaying = false;
      this.stopSpeaking();
      document.getElementById('play-all-btn').textContent = '▶ 播放全文';
      document.getElementById('follow-btn').disabled = false;
      return;
    }

    this.readingPlaying = true;
    document.getElementById('play-all-btn').textContent = '⏹ 停止播放';
    document.getElementById('follow-btn').disabled = true;

    this.readingIdx = 0;
    this._playNext(passage);
  },

  _playNext(passage) {
    if (!this.readingPlaying || this.readingIdx >= passage.sentences.length) {
      this.readingPlaying = false;
      const btn = document.getElementById('play-all-btn');
      if (btn) { btn.textContent = '▶ 播放全文'; }
      const fbtn = document.getElementById('follow-btn');
      if (fbtn) fbtn.disabled = false;
      document.querySelectorAll('.reading-sentence').forEach(el => el.classList.remove('active'));
      this._finishReadingSession(passage);
      return;
    }

    this.speakSentence(passage, this.readingIdx, () => {
      if (!this.readingPlaying) return;
      this.readingTimer = setTimeout(() => {
        this.readingIdx++;
        this._playNext(passage);
      }, 600);
    });
  },

  followRead(passage) {
    if (this.readingPlaying) return;
    this.readingPlaying = true;
    document.getElementById('follow-btn').textContent = '⏹ 停止';
    document.getElementById('play-all-btn').disabled = true;

    this.readingIdx = 0;
    this._followNext(passage);
  },

  _followNext(passage) {
    if (!this.readingPlaying || this.readingIdx >= passage.sentences.length) {
      this.readingPlaying = false;
      const btn = document.getElementById('follow-btn');
      if (btn) { btn.textContent = '🗣 逐句跟读'; }
      const pbtn = document.getElementById('play-all-btn');
      if (pbtn) pbtn.disabled = false;
      document.querySelectorAll('.reading-sentence').forEach(el => el.classList.remove('active'));
      this._finishReadingSession(passage);
      return;
    }

    this.speakSentence(passage, this.readingIdx, () => {
      if (!this.readingPlaying) return;
      document.querySelectorAll('.reading-sentence').forEach(el => el.classList.remove('active'));
      const el = document.querySelector(`.reading-sentence[data-idx="${this.readingIdx}"]`);
      if (el) el.classList.add('pause-phase');
      this.readingTimer = setTimeout(() => {
        if (el) el.classList.remove('pause-phase');
        this.readingIdx++;
        this._followNext(passage);
      }, 3000);
    });
  },

  fcWords: [],
  fcIndex: 0,
  fcFlipped: false,
  fcAutoPlaying: false,
  fcAutoTimer: null,
  fcRepeatCount: 0,

  getUnitWords(unitId) {
    var info = this._unitIndex[unitId];
    return info ? info.words : [];
  },

  renderFlashcards(unitId) {
    this.fcWords = this.getUnitWords(unitId);
    if (this.fcWords.length === 0) { this.renderGrades(); return; }

    this.currentView = 'flashcard';
    this.fcIndex = 0;
    this.fcFlipped = false;
    this.fcAutoPlaying = false;
    this.fcRepeatCount = 0;
    this._fcActive = true;
    this.stopSpeaking();
    if (this.fcAutoTimer) { clearTimeout(this.fcAutoTimer); this.fcAutoTimer = null; }

    const ui = this.getUnitInfo(unitId);
    if (ui.unitTitle) {
      this.activeSessionId = Storage.startSession('flashcard', unitId, ui.unitTitle, ui.gradeTitle, {
        subject: this.currentSubject,
        totalItems: this.fcWords.length
      });
    }

    this._renderFC();
    this.updateTopBar();
  },

  _renderFC() {
    const main = document.getElementById('main-content');
    const word = this.fcWords[this.fcIndex];
    const total = this.fcWords.length;
    const isFlipped = this.fcFlipped;

    let html = '<div class="fc-container">';
    html += `<button class="back-btn" onclick="App.exitToUnit()">← 返回上一级</button>`;
    html += `<div class="fc-counter">${this.fcIndex + 1} / ${total}</div>`;

    html += `<div class="fc-dots">`;
    for (let i = 0; i < total; i++) {
      html += `<span class="fc-dot${i === this.fcIndex ? ' active' : ''}${i < this.fcIndex ? ' passed' : ''}"></span>`;
    }
    html += '</div>';

    html += `<div class="fc-card${isFlipped ? ' flipped' : ''}" id="fc-card">`;
    html += '<div class="fc-card-inner">';
    const isZh = word.zi !== undefined;
    html += '<div class="fc-front">';
    if (isZh) {
      html += `<div class="fc-word">${word.zi}</div>`;
      html += `<div class="fc-phonetic">${word.pinyin || ''}</div>`;
    } else {
      html += `<div class="fc-word">${word.en}</div>`;
      html += `<div class="fc-phonetic">${word.pronounce || ''}</div>`;
    }
    html += '<div class="fc-front-btns">';
    html += `<button class="fc-speak-btn" id="fc-speak-btn">🔊 拼读</button>`;
    html += `<button class="fc-record-btn" id="fc-record-btn">🎤 跟读</button>`;
    html += '</div>';
    html += '</div>';
    html += '<div class="fc-back">';
    if (isZh) {
      html += `<div class="fc-word-back">${word.zi}</div>`;
      html += `<div class="fc-meaning">${word.yi || ''}</div>`;
      html += `<div class="fc-phonetic-back">${word.pinyin || ''}</div>`;
    } else {
      html += `<div class="fc-word-back">${word.en}</div>`;
      html += `<div class="fc-meaning">${word.cn || ''}</div>`;
      html += `<div class="fc-phonetic-back">${word.pronounce ? '/' + word.pronounce + '/' : ''}</div>`;
      html += `<div class="fc-example">${word.example || ''}</div>`;
    }
    html += '</div>';
    html += '</div>';
    html += '</div>';

    html += `<div class="fc-hint">👆 点击卡片翻转 &nbsp;|&nbsp; 🎤 点跟读录音</div>`;
    html += `<div class="fc-record-feedback" id="fc-record-feedback"></div>`;

    html += '<div class="fc-nav">';
    html += `<button class="fc-nav-btn" id="fc-prev-btn"${this.fcIndex === 0 ? ' disabled' : ''}>◀ 上一个</button>`;
    html += `<button class="fc-nav-btn fc-flip-btn" id="fc-flip-btn">🔄 翻转</button>`;
    html += `<button class="fc-nav-btn" id="fc-auto-btn">${this.fcAutoPlaying ? '⏹ 停止' : '▶ 自动播放'}</button>`;
    html += `<button class="fc-nav-btn" id="fc-next-btn">下一个 ▶</button>`;
    html += '</div>';

    html += '</div>';
    main.innerHTML = html;

    this._attachFCEvents();
  },

  _attachFCEvents() {
    const card = document.getElementById('fc-card');
    if (card) {
      card.addEventListener('click', () => this.flipCard());
    }

    const speakBtn = document.getElementById('fc-speak-btn');
    if (speakBtn) {
      speakBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const word = this.fcWords[this.fcIndex];
        if (word.zi !== undefined) {
          this._ttsSpeak({ text: word.zi, language: 'zh-CN', volume: 1 });
        } else {
          this.speakWordPhonics(word.en);
        }
      });
    }

    const recordBtn = document.getElementById('fc-record-btn');
    if (recordBtn) {
      let isRecording = false;
      recordBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (isRecording) {
          this.stopRecognition();
          this.stopAudioRecording().then(audioUrl => {
            isRecording = false;
            recordBtn.classList.remove('recording');
            recordBtn.textContent = '🎤 跟读';
            const fb = document.getElementById('fc-record-feedback');
            if (!fb) return;
            if (audioUrl) {
              fb.innerHTML = '<button class="play-recording-btn" data-url="' + audioUrl + '">🔊 播放录音</button>';
            } else {
              var errMsg = this._recError ? '（' + this._recError + '）' : '（浏览器不支持录音回放）';
              fb.innerHTML = '录制失败' + errMsg;
            }
          });
        } else {
          isRecording = true;
          const word = this.fcWords[this.fcIndex];
          const fb = document.getElementById('fc-record-feedback');
          if (fb) fb.innerHTML = '<div class="record-listening">🎤 正在听... 点击停止</div>';
          recordBtn.classList.add('recording');
          recordBtn.textContent = '⏹ 停止';
          this._beginFollowRecording(word.zi !== undefined ? word.zi : word.en, (data) => {
            if (data.interim) {
              if (fb) fb.innerHTML = '<div class="record-interim">' + data.result + '</div>';
              return;
            }
          });
        }
      });
    }

    const flipBtn = document.getElementById('fc-flip-btn');
    if (flipBtn) {
      flipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.flipCard();
      });
    }

    const prevBtn = document.getElementById('fc-prev-btn');
    if (prevBtn) {
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.prevCard();
      });
    }

    const nextBtn = document.getElementById('fc-next-btn');
    if (nextBtn) {
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.nextCard();
      });
    }

    const autoBtn = document.getElementById('fc-auto-btn');
    if (autoBtn) {
      autoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleAutoPlay();
      });
    }

    document.addEventListener('keydown', this._fcKeyHandler = (e) => {
      if (this.currentView !== 'flashcard') return;
      if (e.key === 'ArrowLeft') this.prevCard();
      if (e.key === 'ArrowRight') this.nextCard();
      if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); this.flipCard(); }
    });
  },

  flipCard() {
    this.fcFlipped = !this.fcFlipped;
    const card = document.getElementById('fc-card');
    if (card) {
      if (this.fcFlipped) {
        card.classList.add('flipped');
        const word = this.fcWords[this.fcIndex];
        this.speakWord3x(word.en);
      } else {
        card.classList.remove('flipped');
        this.stopSpeaking();
      }
    }
  },

  nextCard() {
    if (this.fcIndex < this.fcWords.length - 1) {
      this.fcIndex++;
      if (this.fcAutoPlaying) {
        this.fcFlipped = false;
        this._renderFC();
        var self = this;
        setTimeout(function() { if (self.fcAutoPlaying && self._fcActive) { self.fcRepeatCount = 0; self.flipCard(); } }, 400);
      } else {
        this.fcFlipped = true;
        this.stopSpeaking();
        this._renderFC();
      }
    } else {
      this._finishFlashcardSession();
    }
  },

  prevCard() {
    if (this.fcIndex > 0) {
      this.fcIndex--;
      this.fcFlipped = true;
      this.stopSpeaking();
      this._renderFC();
    }
  },

  speakWord3x(word) {
    this.stopSpeaking();
    this.fcRepeatCount = 0;
    const text = word.replace(/\s*\/\s*/g, ', ');
    const speak = () => {
      if (this.fcRepeatCount >= 3) return;
      if (!this._fcActive) return;

      const onDone = () => {
        this.fcRepeatCount++;
        if (this.fcRepeatCount < 3 && this._fcActive) {
          this._fcRepTimer = setTimeout(() => speak(), 600);
        }
        if (this.fcRepeatCount >= 3 && this.fcAutoPlaying) {
          this.fcAutoTimer = setTimeout(() => {
            if (this.fcAutoPlaying && this._fcActive) {
              if (this.fcIndex < this.fcWords.length - 1) {
                this.nextCard();
              } else {
                this._finishFlashcardSession();
                this.toggleAutoPlay();
              }
            }
          }, 2000);
        }
      };

      this._ttsSpeak({ text: text, language: 'en-US', volume: 1, onEnd: onDone });
    };
    if (/\s|\//.test(text)) { speak(); return; }
    var self = this;
    var letters = word.toUpperCase().split('');
    var li = 0;
    var spell = function() {
      if (!self._fcActive || li >= letters.length) { setTimeout(speak, 300); return; }
      var letter = letters[li];
      li++;
      self._ttsSpeak({ text: letter, language: 'en-US', volume: 1, noSynthFallback: true, onEnd: function() { setTimeout(spell, 30); } });
    };
    spell();
  },

  speakWordPhonics(word) {
    this.stopSpeaking();
    if (!this._fcActive) return;

    const isPhrase = /\s|\//.test(word);
    const fullText = word.replace(/\s*\/\s*/g, ', ');

    // Step 2: pronounce the full word 3 times at medium speed
    var pc = 0;
    const doPronounce = () => {
      if (!this._fcActive || pc >= 3) return;
      pc++;
      this._ttsSpeak({ text: fullText, language: 'en-US', volume: 1, onEnd: function() { setTimeout(doPronounce, 500); } });
    };

    if (isPhrase) { doPronounce(); return; }

    // Step 1: spell letters one by one for clear pronunciation
    var self = this;
    var letters = word.toUpperCase().split('');
    var li = 0;
    function doSpell() {
      if (!self._fcActive || li >= letters.length) { setTimeout(doPronounce, 300); return; }
      var letter = letters[li];
      li++;
      self._ttsSpeak({ text: letter, language: 'en-US', volume: 1, noSynthFallback: true, onEnd: function() { setTimeout(doSpell, 30); } });
    }

    doSpell();
  },

  toggleAutoPlay() {
    this.fcAutoPlaying = !this.fcAutoPlaying;
    const btn = document.getElementById('fc-auto-btn');
    if (this.fcAutoPlaying) {
      if (btn) btn.textContent = '⏹ 停止';
      if (!this.fcFlipped) this.flipCard();
    } else {
      if (btn) btn.textContent = '▶ 自动播放';
      if (this.fcAutoTimer) { clearTimeout(this.fcAutoTimer); this.fcAutoTimer = null; }
    }
  },

  _scheduleAutoNext() {
    if (!this.fcAutoPlaying) return;
    if (this.fcAutoTimer) clearTimeout(this.fcAutoTimer);
    this.fcAutoTimer = setTimeout(() => {
      if (this.fcIndex < this.fcWords.length - 1) {
        this.nextCard();
      } else {
        this._finishFlashcardSession();
        this.toggleAutoPlay();
      }
    }, 5000);
  },

  _finishFlashcardSession() {
    if (this.activeSessionId && this.currentView === 'flashcard') {
      const viewedCount = this.fcIndex + 1;
      Storage.endSession(this.activeSessionId, {
        correctCount: viewedCount,
        totalItems: this.fcWords.length,
        accuracy: Math.round((viewedCount / this.fcWords.length) * 100),
        stars: viewedCount >= this.fcWords.length ? 3 : viewedCount >= this.fcWords.length / 2 ? 2 : 1,
        xp: viewedCount * 5
      });
      this.activeSessionId = null;
      this._autoPushReport();
    }
  },

  // 数学知识点：按公式/概念卡片展示
  renderMathKnowledge(unitId) {
    const words = this.getUnitWords(unitId);
    if (words.length === 0) { this.renderGrades(); return; }
    this.currentView = 'math-knowledge';
    const ui = this.getUnitInfo(unitId);
    this.activeSessionId = Storage.startSession('mathKnowledge', unitId, ui.unitTitle, ui.gradeTitle, { subject: 'math', totalItems: words.length });
    let html = '<div class="math-container">';
    html += '<button class="back-btn" onclick="App.exitToUnit()">← 返回上一级</button>';
    html += `<div class="math-header"><div class="math-title">${ui.unitTitle}</div><div class="math-subtitle">${ui.gradeTitle} · 知识点</div></div>`;
    words.forEach((w, i) => {
      const term = String(w.en || '').trim();
      const def = String(w.cn || '').trim();
      html += `<div class="math-knowledge-card">
        <div class="math-knowledge-term">${term}</div>
        <div class="math-knowledge-def">${def}</div>
      </div>`;
    });
    html += '</div>';
    document.getElementById('main-content').innerHTML = html;
    this.updateTopBar();
  },

  // 数学讲解：重点展示计算方法/步骤（cn 字段通常包含方法说明）
  renderMathExplain(unitId) {
    const words = this.getUnitWords(unitId);
    if (words.length === 0) { this.renderGrades(); return; }
    this.currentView = 'math-explain';
    const ui = this.getUnitInfo(unitId);
    this.activeSessionId = Storage.startSession('mathExplain', unitId, ui.unitTitle, ui.gradeTitle, { subject: 'math', totalItems: words.length });
    let html = '<div class="math-container">';
    html += '<button class="back-btn" onclick="App.exitToUnit()">← 返回上一级</button>';
    html += `<div class="math-header"><div class="math-title">${ui.unitTitle}</div><div class="math-subtitle">${ui.gradeTitle} · 讲解</div></div>`;
    words.forEach((w, i) => {
      const term = String(w.en || '').trim();
      const method = String(w.cn || '').trim();
      const example = w.example ? `<div class="math-explain-example">${w.example}</div>` : '';
      html += `<div class="math-explain-card">
        <div class="math-explain-title">${term}</div>
        <div class="math-explain-method">${method}</div>
        ${example}
      </div>`;
    });
    html += '</div>';
    document.getElementById('main-content').innerHTML = html;
    this.updateTopBar();
  },

  // 数学应用：生成生活情境应用题（若有 example 则用例句，否则按公式生成应用题）
  renderMathApply(unitId) {
    const words = this.getUnitWords(unitId);
    if (words.length === 0) { this.renderGrades(); return; }
    this.currentView = 'math-apply';
    const ui = this.getUnitInfo(unitId);
    this.activeSessionId = Storage.startSession('mathApply', unitId, ui.unitTitle, ui.gradeTitle, { subject: 'math', totalItems: words.length });
    let html = '<div class="math-container">';
    html += '<button class="back-btn" onclick="App.exitToUnit()">← 返回上一级</button>';
    html += `<div class="math-header"><div class="math-title">${ui.unitTitle}</div><div class="math-subtitle">${ui.gradeTitle} · 应用</div></div>`;
    words.forEach((w, i) => {
      const term = String(w.en || '').trim();
      const def = String(w.cn || '').trim();
      let applyText = '';
      if (w.example) {
        applyText = w.example;
      } else if (term.includes('+') || term.includes('-') || term.includes('×') || term.includes('÷')) {
        // 自动生成简单应用题
        const nums = term.match(/\d+/g) || [];
        if (nums.length >= 2) {
          if (term.includes('+')) applyText = `生活中有 ${nums[0]} 个，又来了 ${nums[1]} 个，一共几个？算式：${term}`;
          else if (term.includes('-')) applyText = `共有 ${nums[0]} 个，用了 ${nums[1]} 个，还剩几个？算式：${term}`;
          else if (term.includes('×')) applyText = `每组 ${nums[1]} 个，共 ${nums[0]} 组，一共几个？算式：${term}`;
          else if (term.includes('÷')) applyText = `把 ${nums[0]} 个平均分成 ${nums[1]} 份，每份几个？算式：${term}`;
          else applyText = def;
        } else {
          applyText = def;
        }
      } else {
        applyText = def || '暂无应用示例';
      }
      html += `<div class="math-apply-card">
        <div class="math-apply-title">${term}</div>
        <div class="math-apply-text">${applyText}</div>
      </div>`;
    });
    html += '</div>';
    document.getElementById('main-content').innerHTML = html;
    this.updateTopBar();
  },

  _finishReadingSession(passage) {
    if (this.activeSessionId && this.currentView === 'reading') {
      const total = passage ? passage.sentences.length : 0;
      Storage.endSession(this.activeSessionId, {
        correctCount: total,
        totalItems: total,
        accuracy: 100,
        stars: 2,
        xp: total * 3
      });
      this.activeSessionId = null;
      this._autoPushReport();
    }
  },

  startSingleType(unitId, exType, label) {
    const words = this.getUnitWords(unitId);
    if (words.length === 0) { this.renderGrades(); return; }

    this.currentView = 'exercise';
    Storage.resetHearts();
    this.progress = Storage.getProgress();
    this.hearts = 5;
    this.currentUnitId = unitId;

    const ui = this.getUnitInfo(unitId);
    if (ui.unitTitle) {
      this.activeSessionId = Storage.startSession(exType, unitId, ui.unitTitle, ui.gradeTitle, {
        subject: this.currentSubject,
        totalItems: words.length
      });
    }

    ExerciseEngine.generateExercises(words, exType);
    this.renderExercise();
    this.updateTopBar();
  },

  startWritePractice(unitId) {
    const words = this.getUnitWords(unitId);
    if (!words.length) { this.renderDailyPractice(); return; }

    this.currentView = 'exercise';
    this.currentUnitId = unitId;
    this._write = { words: words, index: 0, results: [] };

    const ui = this.getUnitInfo(unitId);
    if (ui.unitTitle) {
      this.activeSessionId = Storage.startSession('write', unitId, ui.unitTitle, ui.gradeTitle, {
        subject: this.currentSubject,
        totalItems: words.length
      });
    }
    this.renderWritePractice();
    this.updateTopBar();
  },

  renderWritePractice() {
    const main = document.getElementById('main-content');
    const st = this._write;
    if (!st || st.index >= st.words.length) { this.renderWriteResult(); return; }

    const w = st.words[st.index];
    const toEN = st.index % 2 === 0;
    const total = st.words.length;
    const current = st.index + 1;
    const done = st.results.filter(r => r.ok).length;

    let html = '<div class="exercise-container">';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><button class="back-btn" onclick="App.exitToUnit()">← 返回上一级</button></div>';
    html += '<div class="exercise-progress-bar"><div class="exercise-progress-fill" style="width:' + (current / total) * 100 + '%"></div></div>';
    html += '<div class="exercise-count">第 ' + current + '/' + total + ' 题 · 书写解答 · 已对 ' + done + '</div>';
    html += '<div class="question-text" style="font-size:32px;line-height:1.5;padding:0 12px">' + this._h(toEN ? w.cn : w.en) + '</div>';
    if (toEN && w.en) html += '<button class="speaker-btn" id="speaker-btn">🔊 播放发音</button>';
    html += '<div class="fill-hint">' + (toEN ? '请书写对应的英文单词' : '请书写对应的中文意思') + '</div>';
    html += '<input type="text" class="fill-input" id="write-input" placeholder="在这里书写..." autocomplete="off" autocapitalize="off" spellcheck="false">';
    html += '<button class="submit-btn" id="write-submit">提交</button>';
    html += '<div id="write-fb"></div>';
    html += '</div>';
    main.innerHTML = html;

    const sb = document.getElementById('speaker-btn');
    if (sb) sb.addEventListener('click', () => { this.speakWord(w.en); });
    document.getElementById('write-submit').addEventListener('click', () => { this._writeSubmit(); });
    const fi = document.getElementById('write-input');
    if (fi) {
      fi.addEventListener('keydown', function(e) { if (e.key === 'Enter') this._writeSubmit(); }.bind(this));
      setTimeout(function() { fi.focus(); }, 200);
    }
    this.updateTopBar();
  },

  _writeSubmit() {
    const st = this._write;
    if (!st) return;
    const fi = document.getElementById('write-input');
    if (!fi || !fi.value.trim()) return;

    const w = st.words[st.index];
    const toEN = st.index % 2 === 0;
    const expected = toEN ? w.en : w.cn;
    const norm = function(s) { return String(s || '').toLowerCase().replace(/[\s，。！？,.!?、；;:：'"“”‘’·\-]/g, ''); };
    const a = norm(fi.value);
    const b = norm(expected);
    const ok = a === b || (a.length >= 2 && b.length >= 2 && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0));

    st.results.push({ word: w, toEN: toEN, answer: fi.value.trim(), ok: ok });

    const last = st.index === st.words.length - 1;
    const fb = document.getElementById('write-fb');
    fb.innerHTML = ok
      ? '<div class="answer-feedback correct-fb">✅ 正确!</div>'
      : '<div class="answer-feedback wrong-fb">❌ 答案是：<strong>' + this._h(expected) + '</strong></div>';
    fb.innerHTML += '<button class="submit-btn" id="write-next">' + (last ? '查看成绩 📊' : '下一题 ▶') + '</button>';
    document.getElementById('write-input').disabled = true;
    document.getElementById('write-submit').style.display = 'none';
    document.getElementById('write-next').addEventListener('click', () => {
      if (last) this.renderWriteResult();
      else { st.index++; this.renderWritePractice(); }
    });
  },

  renderWriteResult() {
    const st = this._write;
    if (!st) { this.renderDailyPractice(); return; }
    const correct = st.results.filter(r => r.ok).length;
    const total = st.results.length || st.words.length;
    const acc = total ? Math.round(correct / total * 100) : 0;
    const stars = acc >= 90 ? 3 : acc >= 60 ? 2 : 1;

    if (this.activeSessionId) {
      Storage.endSession(this.activeSessionId, {
        correctCount: correct,
        totalItems: total,
        accuracy: acc,
        stars: stars,
        xp: correct * 3
      });
      this.activeSessionId = null;
      this._autoPushReport();
    }

    const wrongs = st.results.filter(r => !r.ok);
    const main = document.getElementById('main-content');
    let html = '<div class="subject-container">';
    html += '<div style="text-align:center;padding:26px 16px">';
    html += '<div style="font-size:56px">' + (acc >= 90 ? '🌟' : acc >= 60 ? '👍' : '💪') + '</div>';
    html += '<h2 style="margin:8px 0">得分 ' + correct + ' / ' + total + '</h2>';
    html += '<div style="font-size:15px;color:var(--text-light)">正确率 ' + acc + '% · ' + '⭐'.repeat(stars) + '</div>';
    if (wrongs.length) {
      html += '<div style="margin-top:18px;text-align:left;background:#FFF8F8;border:1px solid #FFCDD2;border-radius:10px;padding:12px;font-size:14px">';
      html += '<div style="font-weight:700;margin-bottom:8px">📝 答错 ' + wrongs.length + ' 题：</div>';
      wrongs.forEach(r => {
        const shown = r.toEN ? r.word.cn + ' → ' + r.word.en : r.word.en + ' → ' + r.word.cn;
        html += '<div style="padding:4px 0">' + this._h(shown) + '（你写了：' + this._h(r.answer) + '）</div>';
      });
      html += '</div>';
    }
    html += '<div style="display:flex;gap:10px;margin-top:22px">';
    html += '<button class="admin-gen-btn" style="flex:1" onclick="App.renderDailyPractice()">↩ 完成退出</button>';
    if (wrongs.length) html += '<button class="login-btn" style="flex:1" onclick="App._redoWriteWrongs()">🔁 重做错题</button>';
    html += '</div></div></div>';
    main.innerHTML = html;
    this.updateTopBar();
  },

  _redoWriteWrongs() {
    const seen = {};
    const wrongs = [];
    this._write.results.forEach(r => {
      if (r.ok) return;
      const key = r.word.en || r.word.zi || String(r.word.cn);
      if (seen[key]) return;
      seen[key] = 1;
      wrongs.push(r.word);
    });
    if (!wrongs.length) { this.renderWriteResult(); return; }
    this.currentView = 'exercise';
    this.currentUnitId = DAILY_UNIT_ID;
    this._write = { words: wrongs, index: 0, results: [] };
    const ui = this.getUnitInfo(DAILY_UNIT_ID);
    if (ui.unitTitle) {
      this.activeSessionId = Storage.startSession('write', DAILY_UNIT_ID, ui.unitTitle, ui.gradeTitle, {
        subject: this.currentSubject,
        totalItems: wrongs.length
      });
    }
    this.renderWritePractice();
    this.updateTopBar();
  },

  startLesson(unitId) {
    this.currentView = 'exercise';
    Storage.resetHearts();
    this.progress = Storage.getProgress();
    this.hearts = 5;

    let words = this.getUnitWords(unitId);
    if (words.length === 0) { this.renderGrades(); return; }

    const ui = this.getUnitInfo(unitId);
    if (ui.unitTitle) {
      this.activeSessionId = Storage.startSession('exercise', unitId, ui.unitTitle, ui.gradeTitle, {
        subject: this.currentSubject,
        totalItems: ui.totalWords
      });
    }

    ExerciseEngine.generateExercises(words);
    this.renderExercise();
    this.updateTopBar();
  },

  exitToUnit() {
    this._cleanupView();
    if (this.currentUnitId === DAILY_UNIT_ID) {
      if (this._accFreePractice) { this._accFreePractice = false; this.renderDailyAccumulate(); return; }
      this.renderDailyPractice();
      return;
    }
    const findGrade = (data) => {
      try { return ((data && data.grades) || []).find(g => g.id === this.currentGradeId) || null; } catch (e) { return null; }
    };
    const grade = findGrade(this._getSubjectData(this.currentSubject))
      || findGrade(this.getCourseData())
      || findGrade(this._getSubjectData('chinese'))
      || findGrade(this._getSubjectData('math'));
    if (grade) { this.navStack = ['grade']; this.renderAllUnits(grade); }
    else { this.renderGrades(); }
  },

  renderExercise() {
    const exercise = ExerciseEngine.getCurrentExercise();
    if (!exercise) return this.showResults();

    const main = document.getElementById('main-content');
    const total = ExerciseEngine.exercises.length;
    const current = ExerciseEngine.currentIndex + 1;

    let html = '<div class="exercise-container">';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><button class="back-btn" onclick="App.exitToUnit()">← 返回上一级</button></div>';
    html += `<div class="exercise-progress-bar"><div class="exercise-progress-fill" style="width:${(current/total)*100}%"></div></div>`;
    html += `<div class="exercise-count">第 ${current}/${total} 题</div>`;
    html += `<div class="exercise-hearts">${'❤️'.repeat(this.hearts)}${'🖤'.repeat(5 - this.hearts)}</div>`;

    switch (exercise.type) {
      case 'chooseCN':
      case 'chooseEN':
        html += this.renderChoiceExercise(exercise);
        break;
      case 'listen':
        html += this.renderListenExercise(exercise);
        break;
      case 'fillBlank':
        html += this.renderFillBlankExercise(exercise);
        break;
      case 'match':
        html += this.renderMatchExercise(exercise);
        break;
      case 'hearChoose':
        html += this.renderHearChooseExercise(exercise);
        break;
      case 'hearSpell':
        html += this.renderHearSpellExercise(exercise);
        break;
    }

    html += '</div>';
    main.innerHTML = html;
    this.attachExerciseListeners(exercise);
  },

  renderHearChooseExercise(exercise) {
    return `
      <div class="question-text">${exercise.question}</div>
      <button class="speaker-btn" id="speaker-btn">🔊 播放发音</button>
      <div class="options-grid">
        ${exercise.options.map(opt => `<button class="option-btn" data-answer="${opt}">${opt}</button>`).join('')}
      </div>`;
  },

  renderHearSpellExercise(exercise) {
    return `
      <div class="question-text">${exercise.question}</div>
      <div class="fill-hint">${exercise.hint}</div>
      <button class="speaker-btn" id="speaker-btn">🔊 播放发音</button>
      <input type="text" class="fill-input" id="fill-input" placeholder="输入单词拼写..." autocomplete="off">
      <button class="submit-btn" id="submit-btn">确认</button>`;
  },

  renderChoiceExercise(exercise) {
    const spk = exercise.type === 'chooseCN' ? '<button class="speaker-btn" id="speaker-btn">🔊 放一遍听听</button>' : '';
    return `
      <div class="question-text">${exercise.question}</div>
      ${spk}
      <div class="options-grid">
        ${exercise.options.map(opt => `<button class="option-btn" data-answer="${opt}">${opt}</button>`).join('')}
      </div>`;
  },

  renderListenExercise(exercise) {
    return `
      <div class="question-text">${exercise.question}</div>
      <button class="speaker-btn" id="speaker-btn">🔊 播放发音</button>
      <div class="options-grid">
        ${exercise.options.map(opt => `<button class="option-btn" data-answer="${opt}">${opt}</button>`).join('')}
      </div>`;
  },

  renderFillBlankExercise(exercise) {
    return `
      <div class="question-text">${exercise.question}</div>
      <div class="fill-hint">${exercise.hint}</div>
      <button class="speaker-btn" id="speaker-btn">🔊 再听一遍</button>
      <input type="text" class="fill-input" id="fill-input" placeholder="请输入单词..." autocomplete="off">
      <button class="submit-btn" id="submit-btn">确定</button>`;
  },

  renderMatchExercise(exercise) {
    let html = '<div class="question-text">' + exercise.question + '</div>';
    html += '<div class="match-grid">';
    html += '<div class="match-col match-left">' + exercise.leftItems.map(item =>
      `<button class="match-item match-en" data-en="${item}">${item}</button>`).join('') + '</div>';
    html += '<div class="match-col match-right">' + exercise.rightItems.map(item =>
      `<button class="match-item match-cn" data-cn="${item}">${item}</button>`).join('') + '</div>';
    html += '</div>';
    html += '<div id="match-feedback" class="match-feedback"></div>';
    return html;
  },

  _exT(fn, ms) {
    const id = setTimeout(fn, ms);
    (this._exTimers = this._exTimers || []).push(id);
    return id;
  },

  attachExerciseListeners(exercise) {
    if (exercise.type === 'chooseCN' || exercise.type === 'chooseEN') {
      const wq = exercise.word || {};
      const zhQ = wq.zi !== undefined;
      var sbq = document.getElementById('speaker-btn');
      if (sbq) sbq.addEventListener('click', () => {
        if (zhQ) this.speakChinese(wq.zi); else if (wq.en) this.speakWord(wq.en);
      });
      if (exercise.type === 'chooseCN') {
        if (zhQ) this._exT(() => this.speakChinese(wq.zi), 350);
        else if (wq.en) this._exT(() => this.speakWord(wq.en), 350);
      }
      document.querySelectorAll('.option-btn').forEach(btn => {
        btn.addEventListener('click', () => this.handleAnswer(btn.dataset.answer, btn));
      });
    }

    if (exercise.type === 'listen') {
      var sb = document.getElementById('speaker-btn');
      if (sb) sb.addEventListener('click', () => { this.speakWord(exercise.audioWord); });
      this._exT(() => this.speakWord(exercise.audioWord), 500);
      document.querySelectorAll('.option-btn').forEach(btn => {
        btn.addEventListener('click', () => this.handleAnswer(btn.dataset.answer, btn));
      });
    }

    if (exercise.type === 'fillBlank') {
      var wf = exercise.word || {};
      var sbf = document.getElementById('speaker-btn');
      if (sbf) sbf.addEventListener('click', () => {
        if (wf.zi !== undefined) this.speakChinese(exercise.audioWord); else this.speakWord(exercise.audioWord);
      });
      var sub = document.getElementById('submit-btn');
      if (sub) sub.addEventListener('click', () => { this.handleAnswer(document.getElementById('fill-input').value); });
      var fi = document.getElementById('fill-input');
      if (fi) {
        fi.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') this.handleAnswer(fi.value);
        }.bind(this));
        fi.focus();
      }
      if (exercise.audioWord) {
        this._exT(() => {
          if (wf.zi !== undefined) this.speakChinese(exercise.audioWord); else this.speakWord(exercise.audioWord);
        }, 300);
      }
    }

    if (exercise.type === 'match') {
      this.selectedEN = null;
      this.selectedCN = null;

      document.querySelectorAll('.match-en').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.match-en').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          this.selectedEN = btn.dataset.en;
          const wm = exercise.word || {};
          if (wm.zi !== undefined) this.speakChinese(btn.dataset.en); else if (wm.en) this.speakWord(btn.dataset.en);
          if (this.selectedCN) this.checkMatch(exercise);
        });
      });

      document.querySelectorAll('.match-cn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.match-cn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          this.selectedCN = btn.dataset.cn;
          if (this.selectedEN) this.checkMatch(exercise);
        });
      });
    }

    if (exercise.type === 'hearChoose') {
      var sb2 = document.getElementById('speaker-btn');
      if (sb2) sb2.addEventListener('click', () => { this.speakWord(exercise.audioWord); });
      this._exT(() => this.speakWord(exercise.audioWord), 400);
      document.querySelectorAll('.option-btn').forEach(btn => {
        btn.addEventListener('click', () => this.handleAnswer(btn.dataset.answer, btn));
      });
    }

    if (exercise.type === 'hearSpell') {
      var sb3 = document.getElementById('speaker-btn');
      if (sb3) sb3.addEventListener('click', () => { this.speakWord(exercise.audioWord); });
      this._exT(() => this.speakWord(exercise.audioWord), 300);
      var sub2 = document.getElementById('submit-btn');
      if (sub2) sub2.addEventListener('click', function() { this.handleAnswer(document.getElementById('fill-input').value); }.bind(this));
      var fi2 = document.getElementById('fill-input');
      if (fi2) {
        fi2.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') this.handleAnswer(fi2.value);
        }.bind(this));
        fi2.focus();
      }
    }
  },

  checkMatch(exercise) {
    const isCorrect = exercise.matchMap[this.selectedEN] === this.selectedCN;
    const fb = document.getElementById('match-feedback');

    if (isCorrect) {
      fb.innerHTML = '<span class="correct-fb">正确!</span>';
      const enBtn = document.querySelector(`.match-en[data-en="${this.selectedEN}"]`);
      const cnBtn = document.querySelector(`.match-cn[data-cn="${this.selectedCN}"]`);
      if (enBtn) { enBtn.classList.add('matched'); enBtn.disabled = true; }
      if (cnBtn) { cnBtn.classList.add('matched'); cnBtn.disabled = true; }

      const remaining = document.querySelectorAll('.match-en:not(.matched)');
      if (remaining.length === 0) {
        ExerciseEngine.answers.push({ exercise, answer: null, isCorrect: true });
        ExerciseEngine.correctCount++;
        this._exT(() => this.nextExercise(), 800);
      }
    } else {
      fb.innerHTML = '<span class="wrong-fb">✗ 正确答案是 ' + exercise.matchMap[this.selectedEN] + '</span>';
      const word = exercise.word;
      const ui = this.getUnitInfo(this.currentUnitId);
      Storage.addWrongWord(word.en, word.cn, this.currentUnitId, ui.unitTitle || '');
      ExerciseEngine.answers.push({ exercise, answer: null, isCorrect: false });

      this._exT(() => this.nextExercise(), 1000);
    }

    this.selectedEN = null;
    this.selectedCN = null;
    document.querySelectorAll('.match-en, .match-cn').forEach(b => b.classList.remove('selected'));
  },

  handleAnswer(answer, clickedBtn) {
    const exercise = ExerciseEngine.getCurrentExercise();
    const isCorrect = ExerciseEngine.checkAnswer(answer);

    if (isCorrect) {
      if (clickedBtn) clickedBtn.classList.add('correct');
      document.querySelectorAll('.option-btn').forEach(b => {
        if (b.dataset.answer === exercise.correctAnswer) b.classList.add('correct');
        b.disabled = true;
      });
      const inp = document.getElementById('fill-input');
      const sub = document.getElementById('submit-btn');
      if (inp) { inp.classList.add('correct'); inp.disabled = true; }
      if (sub) sub.disabled = true;
      this.showFeedback(true, exercise);
      const wk = exercise.word || {};
      if (wk.zi !== undefined) this._exT(() => this.speakChinese(wk.zi), 250);
      this._exT(() => this.nextExercise(), 1000);
    } else {
      const word = exercise.word;
      const ui = this.getUnitInfo(this.currentUnitId);
      Storage.addWrongWord(word.en, word.cn, this.currentUnitId, ui.unitTitle || '');
      if (clickedBtn) {
        clickedBtn.classList.add('wrong');
        document.querySelectorAll('.option-btn').forEach(b => {
          if (b.dataset.answer === exercise.correctAnswer) b.classList.add('correct');
          b.disabled = true;
        });
      }
      const inp = document.getElementById('fill-input');
      const sub = document.getElementById('submit-btn');
      if (inp) { inp.classList.add('wrong'); inp.disabled = true; }
      if (sub) sub.disabled = true;
      this.hearts = Storage.loseHeart();
      document.getElementById('heart-count').textContent = this.hearts;
      this.showFeedback(false, exercise);
      const wl = exercise.word || {};
      if (wl.zi !== undefined) this._exT(() => this.speakChinese(wl.zi), 250);
      this._exT(() => {
        if (this.hearts <= 0) {
          this.showOutOfHearts();
        } else {
          this.nextExercise();
        }
      }, 1200);
    }
  },

  showFeedback(isCorrect, exercise) {
    const container = document.querySelector('.exercise-container');
    const fb = document.createElement('div');
    fb.className = 'answer-feedback ' + (isCorrect ? 'correct-fb' : 'wrong-fb');
    fb.innerHTML = isCorrect
      ? '✓ 正确!'
      : '✗ 答案是：<strong>' + exercise.correctAnswer + '</strong>';
    container.appendChild(fb);

    if (!isCorrect && exercise.type === 'fillBlank') {
      const ce = document.createElement('div');
      ce.className = 'correct-answer-show';
      ce.innerHTML = '正确拼写：<strong>' + exercise.correctAnswer + '</strong>';
      container.appendChild(ce);
    }
  },

  nextExercise() {
    if (ExerciseEngine.nextExercise()) {
      this.renderExercise();
    } else {
      Storage.resetHearts();
      this.showResults();
    }
  },

  showOutOfHearts() {
    if (this.activeSessionId) {
      Storage.abortSession(this.activeSessionId);
      this.activeSessionId = null;
    }
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="result-container">
        <div class="hearts-out">💔</div>
        <h2>生命值用完了!</h2>
        <p>别灰心，休息一下再来吧!</p>
        <button class="restart-btn" id="retry-btn">🔄 重新挑战</button>
        <button class="quit-btn" id="quit-btn">↩ 返回课程</button>
      </div>`;
    document.getElementById('retry-btn').addEventListener('click', () => {
      Storage.resetHearts();
      this.progress = Storage.getProgress();
      this.hearts = this.progress.hearts;
      this.startLesson(this.currentUnitId);
    });
    document.getElementById('quit-btn').addEventListener('click', () => this.exitToUnit());
    this.updateTopBar();
  },

  showResults() {
    const results = ExerciseEngine.getResults();
    Storage.markLessonComplete(this.currentUnitId, results.stars);
    this.progress = Storage.getProgress();

    if (this.activeSessionId) {
      const wrongCount = results.total - results.correct;
      Storage.endSession(this.activeSessionId, {
        correctCount: results.correct,
        wrongCount: wrongCount,
        totalItems: results.total,
        accuracy: Math.round((results.correct / results.total) * 100),
        stars: results.stars,
        xp: results.xp
      });
      this.activeSessionId = null;
      this._autoPushReport();
    }

    this.renderReport();
  },

  speakWord(word) {
    if (!word) return;
    const w = String(word);
    // 数学表达式/含中文/当前科目为数学 → 走中文 TTS（避开英语链路在坏平板上全灭）
    const isMathExpr = /[\+\-\×\÷\=]/.test(w);
    const hasZh = /[\u4e00-\u9fff]/.test(w);
    if (isMathExpr || hasZh || this.currentSubject === 'math') {
      this.speakChinese(w);
      return;
    }
    this._ttsCancel();
    this._ttsSpeak({ text: w.replace(/\s*\/\s*/g, ', '), language: 'en-US', volume: 1 });
  },

  speakChinese(word) {
    if (!word) return;
    this._ttsCancel();
    this._ttsSpeak({ text: String(word), language: 'zh-CN', volume: 1 });
  },

_prewarmNetwork() {
    try {
      this._lastNetAct = Date.now();
      if (this._prewarmedNet) return;
      this._prewarmedNet = true;
      var self = this;
      ['https://dict.youdao.com/favicon.ico', 'https://translate.googleapis.com/favicon.ico'].forEach(function(u) {
        try { fetch(u, { mode: 'no-cors', cache: 'no-store' }).then(function() { try { self._lastNetAct = Date.now(); } catch (e) {} }).catch(function() {}); } catch (e) {}
      });
      try {
        var pre = new Audio('https://dict.youdao.com/dictvoice?audio=hello&type=2');
        pre.preload = 'auto';
        pre.muted = true;
        var pt = setTimeout(function() { try { pre.pause(); } catch(e) {} }, 15000);
        pre.addEventListener('canplaythrough', function() { clearTimeout(pt); try { self._lastNetAct = Date.now(); } catch(e) {} });
        pre.addEventListener('error', function() { clearTimeout(pt); });
        try { pre.load(); } catch (e2) {}
        setTimeout(function() {
          try {
            if (pre.paused) {
              var pp = pre.play();
              if (pp && typeof pp.catch === 'function') pp.catch(function() {});
            }
          } catch (e3) {}
          setTimeout(function() { try { pre.pause(); } catch(e4) {} }, 800);
        }, 200);
      } catch (e) {}
    } catch (e) {}
  },

  _netHeartbeat() {
    try {
      var now = Date.now();
      if (this._lastNetAct && now - this._lastNetAct < 60000) return;
      this._lastNetAct = now;
      var self = this;
      ['https://dict.youdao.com/favicon.ico', 'https://translate.googleapis.com/favicon.ico'].forEach(function(u) {
        try { fetch(u, { mode: 'no-cors', cache: 'no-store' }).then(function() {}).catch(function() {}); } catch (e) {}
      });
    } catch (e) {}
  },

_ttsCancel() {
    this._ttsSeq = (this._ttsSeq || 0) + 1;
    this._ttsNativeEndCb = null;
    this._ttsNativeFailCb = null;
    if (this._ttsNativeGuard) { clearTimeout(this._ttsNativeGuard); this._ttsNativeGuard = null; }
    try { if (window.AndroidBackup && typeof window.AndroidBackup.stopSpeak === 'function') { window.AndroidBackup.stopSpeak(); } } catch(e) {}
    if (this._ttsAudioEl) {
      try { this._ttsAudioEl.onended = null; this._ttsAudioEl.onerror = null; this._ttsAudioEl.pause(); } catch(e) {}
      try { this._ttsAudioEl.src = ''; } catch(e) {}
      this._ttsAudioEl = null;
    }
    try {
      if ('speechSynthesis' in window && window.speechSynthesis) { window.speechSynthesis.cancel(); }
    } catch(e) {}
  },

  _ttsSpeak(opts) {
    opts = opts || {};
    const text = String(opts.text || '').trim();
    try { this._netHeartbeat(); } catch (e) {}
    const onEnd = typeof opts.onEnd === 'function' ? opts.onEnd : null;
    const noSynth = !!opts.noSynthFallback;
    this._ttsPreventDedup = !!opts.preventDedup;
    try { (this._ttsDiag = this._ttsDiag || []); this._ttsDiag.push(text.length > 8 ? text.slice(0, 8) + '…' : text); } catch (e) {}
    if (!text) {
      if (onEnd) { try { onEnd(); } catch(e) {} }
      return;
    }
    const lang = opts.language || 'en-US';
    const vol = Math.max(0, Math.min(1, (opts.volume != null) ? opts.volume : 1));
    // 新发音前清空原生队列：Android TTS 默认排队播放，不清会与上一句叠加混音
    try { if (window.AndroidBackup && typeof window.AndroidBackup.stopSpeak === 'function') { window.AndroidBackup.stopSpeak(); } } catch(e) {}
    // 清空旧的原生回调/守卫，防止上一个音频的迟到 notifyTtsEnd 误触发新词的 finDone
    this._ttsNativeEndCb = null;
    this._ttsNativeFailCb = null;
    if (this._ttsNativeGuard) { clearTimeout(this._ttsNativeGuard); this._ttsNativeGuard = null; }
    const self = this;
    const mySeq = (this._ttsSeq = (this._ttsSeq || 0) + 1);
    const alive = function() { return self._ttsSeq === mySeq; };
    let endFired = false;
    const finDone = function() {
      if (!alive() || endFired) return;
      endFired = true;
      clearTimeout(masterGuard);
      self._ttsSeq = mySeq + 1;
      if (onEnd) { try { onEnd(); } catch(e) {} }
    };
    const masterGuard = setTimeout(finDone, Math.min(180000, Math.max(12000, Math.ceil(text.length * 400) + (text.match(/[，。！？；：、\n\r,.!?;:]/g) || []).length * 600)));
    const trySynth = function() {
      if (!alive()) return;
      self._ttsFallbackSynth(text, lang, vol, finDone);
    };
    const tryNative = function() {
      self._ttsTryNative(text, lang, vol, trySynth, finDone, 8000);
    };
    const skipUrl = !!opts.skipUrl;
    const continueChain = function() {
      if (!alive()) return;
      const inApk = !!(window.AndroidBackup && typeof window.AndroidBackup.speakTts === 'function');
      const zh = /^zh/i.test(lang);
      const multiWord = /\s/.test(text) || (zh && /[\u4e00-\u9fff]{2,}/.test(text));
      const urls = [
        'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(text) + '&type=' + (zh ? 1 : 2)
      ];
      const zn = zh ? ((self._zhWordIdx || {})[text] != null ? (self._zhWordIdx || {})[text] : ((self._zhMathIdx || {})[text])) : null;
      const chainNet = function() {
        if (inApk) {
          if (typeof window.AndroidBackup.playUrl === 'function' && !noSynth) {
            if (!skipUrl && Date.now() > (self._urlHangUntil || 0)) {
              const urlTimeout = Math.max(4000, Math.min(10000, 1500 + text.length * 500));
              self._ttsTryJavaUrl(urls[0], vol, function() {
                if (alive()) self._ttsTryNative(text, lang, vol, trySynth, finDone, 8000);
              }, finDone, urlTimeout);
            } else if (skipUrl && zn == null) {
              const _urlStart = Date.now();
              self._ttsTryJavaUrl(urls[0], vol, function() {
                if (!alive()) return;
                self._ttsTryNative(text, lang, vol, trySynth, finDone, 8000);
              }, function() {
                if (!alive()) return;
                if (self._ttsNativeGuard) { clearTimeout(self._ttsNativeGuard); self._ttsNativeGuard = null; }
                if (Date.now() - _urlStart < 300) {
                  try { self._ttsDiag.push('URL过短→原生'); } catch(e) {}
                  self._ttsTryNative(text, lang, vol, trySynth, finDone, 8000);
                } else {
                  finDone();
                }
              }, Math.max(4000, Math.min(10000, 1500 + text.length * 500)));
            } else {
              self._ttsTryNative(text, lang, vol, trySynth, finDone, 8000);
            }
            return;
          }
          self._ttsTryNative(text, lang, vol, trySynth, finDone, 8000);
          return;
        }
        if (noSynth) { tryNative(); return; }
        if (multiWord) { trySynth(); return; }
        self._ttsTryUrls(urls, vol, tryNative, finDone);
      };
      if (zn != null) {
        try { self._ttsDiag.push('词库播放'); } catch(e) {}
        if (window.AndroidBackup && typeof window.AndroidBackup.playSentenceSound === 'function') {
          const zuid = 'pjzw' + mySeq;
          let zrs = '0';
          try { zrs = String(window.AndroidBackup.playSentenceSound(zn + '.ogg', zuid)); } catch(e) {}
          if (zrs === '1') {
            self._ttsNativeId = zuid;
            const zguard = setTimeout(function() {
              if (!alive()) return;
              self._ttsNativeEndCb = null; self._ttsNativeFailCb = null; self._ttsNativeGuard = null;
              trySynth();
            }, Math.max(4000, Math.min(15000, 3000 + text.length * 1200)));
            self._ttsNativeGuard = zguard;
            self._ttsNativeEndCb = function() {
              if (!alive()) return;
              if (self._ttsNativeGuard) { clearTimeout(self._ttsNativeGuard); self._ttsNativeGuard = null; }
              finDone();
            };
            self._ttsNativeFailCb = function() {
              if (!alive()) return;
              if (self._ttsNativeGuard) { clearTimeout(self._ttsNativeGuard); self._ttsNativeGuard = null; }
              chainNet();
            };
            return;
          }
        }
        self._playLocalFile('sounds/sentences/' + zn + '.ogg', vol, chainNet, finDone);
        return;
      }
      const ew = (!zh && /^en/i.test(lang)) ? ((self._enWordIdx || {})[text.toLowerCase()]) : null;
      if (ew != null) {
        try { self._ttsDiag.push('英语词库'); } catch(e) {}
        if (window.AndroidBackup && typeof window.AndroidBackup.playSentenceSound === 'function') {
          const euid = 'pjew' + mySeq;
          let ers = '0';
          try { ers = String(window.AndroidBackup.playSentenceSound(ew + '.ogg', euid)); } catch(e) {}
          if (ers === '1') {
            self._ttsNativeId = euid;
            const eguard = setTimeout(function() {
              if (!alive()) return;
              self._ttsNativeEndCb = null; self._ttsNativeFailCb = null; self._ttsNativeGuard = null;
              chainNet();
            }, Math.max(4000, Math.min(8000, 2500 + text.length * 400)));
            self._ttsNativeGuard = eguard;
            self._ttsNativeEndCb = function() {
              if (!alive()) return;
              if (self._ttsNativeGuard) { clearTimeout(self._ttsNativeGuard); self._ttsNativeGuard = null; }
              finDone();
            };
            self._ttsNativeFailCb = function() {
              if (!alive()) return;
              if (self._ttsNativeGuard) { clearTimeout(self._ttsNativeGuard); self._ttsNativeGuard = null; }
              chainNet();
            };
            return;
          }
        }
        self._playLocalFile('sounds/sentences/' + ew + '.ogg', vol, chainNet, finDone);
        return;
      }      chainNet();
    };
    if (/^[A-Za-z0-9]$/.test(text) && /^en/i.test(lang)) {
      const L = text.toUpperCase();
      if ('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.indexOf(L) >= 0) {
        this._playLocalFile('sounds/letters/' + L + '.wav', vol, continueChain, finDone);
        return;
      }
    }
    continueChain();
  },

  _playLocalFile(path, vol, onFail, onEnd) {
    const self = this;
    const mySeq = this._ttsSeq;
    const alive = function() { return self._ttsSeq === mySeq; };
    const Lm = /^sounds\/letters\/([A-Za-z0-9])\.wav$/i.exec(path);
    if (Lm && window.AndroidBackup && typeof window.AndroidBackup.playAssetSound === 'function') {
      try {
        const r = String(window.AndroidBackup.playAssetSound(Lm[1] + '.wav'));
        if (r === '1') {
          self._ttsNativeGuard = setTimeout(function() {
            if (alive()) { try { self._ttsDiag.push('本地原生OK'); } catch(e) {} onEnd(); }
          }, 1000);
          return;
        }
      } catch (e) {}
    }
    try {
      const el = new Audio(path);
      this._ttsAudioEl = el;
      el.volume = vol;
      var guard = setTimeout(function() { try { el.pause(); } catch(e) {} if (alive()) onFail(); }, 3000);
      el.onplaying = function() { clearTimeout(guard); };
      el.onended = function() { clearTimeout(guard); try { self._ttsDiag.push('本地OK'); } catch(e) {} if (alive()) onEnd(); };
      el.onerror = function() { clearTimeout(guard); try { self._ttsDiag.push('本地失败'); } catch(e) {} if (alive()) onFail(); };
      const p = el.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function() { clearTimeout(guard); try { self._ttsDiag.push('本地失败'); } catch(e) {} if (alive()) onFail(); });
      }
    } catch (e) { try { self._ttsDiag.push('本地失败'); } catch(e2) {} if (alive()) onFail(); }
  },

  _ttsTryUrls(urls, vol, onAllFail, onDone) {
    const self = this;
    const mySeq = this._ttsSeq;
    const alive = function() { return self._ttsSeq === mySeq; };
    if (!alive()) return;
    if (!urls || !urls.length) { try { self._ttsDiag.push('网络失败'); } catch(e) {} onAllFail(); return; }
    const url = urls[0];
    const tryNext = function() {
      if (!alive()) return;
      try {
        if (self._ttsAudioEl) { self._ttsAudioEl.onended = null; self._ttsAudioEl.onerror = null; self._ttsAudioEl.pause(); self._ttsAudioEl.src = ''; self._ttsAudioEl = null; }
      } catch (e) {}
      self._ttsTryUrls(urls.slice(1), vol, onAllFail, onDone);
    };
    try {
      const el = new Audio();
      this._ttsAudioEl = el;
      el.volume = vol;
      var guard = setTimeout(function() { try { el.pause(); } catch(e) {} tryNext(); }, 2000);
      el.onplaying = function() { clearTimeout(guard); };
      el.onended = function() { clearTimeout(guard); try { self._ttsDiag.push('网络OK'); } catch(e) {} if (alive()) onDone(); };
      el.onerror = function() { clearTimeout(guard); tryNext(); };
      el.src = url;
      const p = el.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function() { clearTimeout(guard); tryNext(); });
      }
    } catch (e) { tryNext(); }
  },

  _ttsTryNative(text, lang, vol, onFail, onDone, timeoutMs) {
    const self = this;
    const mySeq = this._ttsSeq;
    const alive = function() { return self._ttsSeq === mySeq; };
    try {
      if (window.AndroidBackup && typeof window.AndroidBackup.speakTts === 'function') {
        const rid = window.AndroidBackup.speakTts(text, lang, 1);
        const rs = String(rid);
        if (rid != null && rs.length > 0 && rs !== '-1' && rs !== 'null' && rs !== 'undefined') {
          this._ttsNativeId = rs;
          try { self._ttsDiag.push('原生OK'); } catch(e) {}
          const t = timeoutMs || 8000;
          const guard = setTimeout(function() {
            if (alive()) {
              self._ttsNativeEndCb = null;
              self._ttsNativeGuard = null;
              if (onDone) onDone();
            }
          }, t);
          this._ttsNativeGuard = guard;
          if (onDone) {
            this._ttsNativeEndCb = function() {
              if (alive()) {
                if (self._ttsNativeGuard) { clearTimeout(self._ttsNativeGuard); self._ttsNativeGuard = null; }
                onDone();
              }
            };
          }
          return;
        }
      }
    } catch (e) {}
    try { self._ttsDiag.push('原生失败'); } catch(e) {}
    if (alive()) onFail();
  },

  _ttsTryJavaUrl(url, vol, onFail, onDone, timeoutMs) {
    const self = this;
    const mySeq = this._ttsSeq;
    const alive = function() { return self._ttsSeq === mySeq; };
    try {
      if (window.AndroidBackup && typeof window.AndroidBackup.playUrl === 'function') {
        const uid = 'pjurl' + mySeq;
        const rs = String(window.AndroidBackup.playUrl(url, uid));
        if (rs === '1') {
          this._ttsNativeId = uid;
          try { self._ttsDiag.push('真人播放'); } catch(e) {}
          const t = timeoutMs || 10000;
          const guard = setTimeout(function() {
            if (alive()) {
              self._ttsNativeEndCb = null;
              self._ttsNativeFailCb = null;
              self._ttsNativeGuard = null;
              try { self._urlHangUntil = Date.now() + 60000; self._ttsDiag.push('真人超时'); } catch(e) {}
              if (onFail) onFail();
            }
          }, t);
          this._ttsNativeGuard = guard;
          this._ttsNativeEndCb = function() {
            if (alive()) {
              if (self._ttsNativeGuard) { clearTimeout(self._ttsNativeGuard); self._ttsNativeGuard = null; }
              onDone();
            }
          };
          this._ttsNativeFailCb = function() {
            if (alive()) {
              if (self._ttsNativeGuard) { clearTimeout(self._ttsNativeGuard); self._ttsNativeGuard = null; }
              onFail();
            }
          };
          return;
        }
      }
    } catch (e) {}
    try { self._ttsDiag.push('真人失败'); } catch(e) {}
    if (alive()) onFail();
  },

  _ttsFallbackSynth(text, lang, vol, finDone) {
    const self = this;
    const mySeq = this._ttsSeq;
    const alive = function() { return self._ttsSeq === mySeq; };
    const langBase = lang.split('-')[0].toLowerCase();
    const findVoice = function() {
      try {
        const vs = window.speechSynthesis.getVoices();
        if (!vs || !vs.length) return null;
        for (let i = 0; i < vs.length; i++) {
          if ((vs[i].lang || '').toLowerCase().indexOf(langBase) === 0) return vs[i];
        }
        return null;
      } catch (e) { return null; }
    };
    const fire = function() {
      if (!alive()) return;
      try {
        self._ttsDiag.push('合成尝试');
        if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { finDone(); return; }
        const gv = (function() { try { return window.speechSynthesis.getVoices() || []; } catch(e) { return []; } })();
        const v = findVoice();
        if (!v) { try { self._ttsDiag.push('无匹配语音'); } catch(e) {} finDone(); return; }
        const u = new SpeechSynthesisUtterance(self._ttsPreventDedup ? text + '\u200B'.repeat((self._ttsDedupSeq = (self._ttsDedupSeq || 0) + 1)) : text);
        u.lang = lang;
        if (v) u.voice = v;
        u.volume = vol;
        const puncts = (text.match(/[，。！？；：、\n\r,.!?;:]/g) || []).length;
        const fbDur = Math.min(180000, Math.max(5000, Math.ceil(text.length * 400) + puncts * 600));
        var fbGuard = setTimeout(function() { try { window.speechSynthesis.cancel(); } catch(e) {} if (alive()) finDone(); }, fbDur);
        u.onend = function() { clearTimeout(fbGuard); try { window.speechSynthesis.cancel(); } catch(e) {} if (alive()) finDone(); };
        u.onerror = function() { clearTimeout(fbGuard); if (alive()) finDone(); };
        window.speechSynthesis.speak(u);
      } catch (e) { if (alive()) finDone(); }
    };
    let vsNow = null;
    try { vsNow = window.speechSynthesis.getVoices(); } catch (e) {}
    if (!vsNow || !vsNow.length) { fire(); return; }
    if (!findVoice()) {
      setTimeout(function() {
        if (!alive()) return;
        if (!findVoice()) { finDone(); return; }
        fire();
      }, 350);
      return;
    }
    fire();
  },

  _ttsNativeEnd(id) {
    try {
      if (id == null) return;
      const norm = String(id).replace(/^pjtts/, '');
      if (this._ttsNativeId && (this._ttsNativeId === String(id) || this._ttsNativeId === norm) && this._ttsNativeEndCb) {
        const cb = this._ttsNativeEndCb;
        this._ttsNativeEndCb = null;
        cb();
      }
    } catch (e) {}
  },

  _ttsNativeFail(id) {
    try {
      if (id == null) return;
      const norm = String(id).replace(/^pjtts/, '');
      if (this._ttsNativeId && (this._ttsNativeId === String(id) || this._ttsNativeId === norm) && this._ttsNativeFailCb) {
        const cb = this._ttsNativeFailCb;
        this._ttsNativeFailCb = null;
        if (this._ttsNativeGuard) { clearTimeout(this._ttsNativeGuard); this._ttsNativeGuard = null; }
        if (this._ttsNativeEndCb) { this._ttsNativeEndCb = null; }
        cb();
      }
    } catch (e) {}
  },

  _bindTtsDiag(el) {
    var self = this;
    if (!el) return;
    var cnt = 0, timer = null;
    el.style.cursor = 'pointer';
    el.addEventListener('click', function() {
      cnt++;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function() { cnt = 0; }, 1600);
      if (cnt < 6) return;
      cnt = 0;
      var lines = [];
      try { lines.push('环境: ' + (window.AndroidBackup ? '平板APK' : '网页版')); } catch (e) {}
      try {
        if (window.AndroidBackup && window.AndroidBackup.mediaVolume) lines.push('媒体音量: ' + window.AndroidBackup.mediaVolume());
      } catch (e) {}
      try {
        if (window.AndroidBackup && window.AndroidBackup.ttsReady) lines.push('TTS引擎: ' + (window.AndroidBackup.ttsReady() ? '可用' : '不可用'));
      } catch (e) {}
      try {
        var vs = window.speechSynthesis ? window.speechSynthesis.getVoices() : null;
        lines.push('合成语音数: ' + (vs ? vs.length : 0));
        if (vs && vs.length) {
          var langs = {};
          for (var i = 0; i < vs.length; i++) { var L = (vs[i].lang || '?').toLowerCase(); langs[L] = (langs[L] || 0) + 1; }
          lines.push('语音语言: ' + Object.keys(langs).join(','));
        }
      } catch (e) {}
      var d = (self._ttsDiag || []).slice(-14);
      lines.push('发音链路: ' + (d.length ? d.join(' → ') : '(无记录，请先点一次发音再来看)'));
      try {
        var el2 = window.__errLog || [];
        lines.push('错误日志(' + el2.length + '): ' + (el2.length ? el2.slice(-6).join(' ‖ ') : '(无)'));
      } catch (e) {}
      try { alert(lines.join('\n')); } catch (e) {}
    });
  },

  _cleanHost(v) {
    return String(v || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:.*$/, '').replace(/\/$/, '');
  },

  _getSavedHost() {
    try {
      const v = localStorage.getItem('vocab_lan_host');
      if (v) return this._cleanHost(v);
    } catch (e) {}
    return this._hostInputVal ? this._cleanHost(this._hostInputVal) : '';
  },

  _saveHost(v) {
    v = this._cleanHost(v);
    if (!v) return;
    this._hostInputVal = v;
    try { localStorage.setItem('vocab_lan_host', v); } catch (e) {}
  },

  _bindHostInput(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const self = this;
    const save = function() { self._saveHost(el.value); };
    el.addEventListener('input', save);
    el.addEventListener('change', save);
    el.addEventListener('blur', save);
  },

  _recPlayError(msg) {
    try {
      var el = document.querySelector('.user-prompt') || document.getElementById('main-content');
      if (el) {
        var d = document.createElement('div');
        d.style.cssText = 'position:fixed;left:50%;top:60%;transform:translateX(-50%);background:#B71C1C;color:#fff;padding:10px 18px;border-radius:10px;font-size:14px;z-index:9999;max-width:80%;text-align:center';
        d.textContent = msg;
        document.body.appendChild(d);
        setTimeout(function() { try { d.parentNode.removeChild(d); } catch(e) {} }, 3500);
      } else {
        alert(msg);
      }
    } catch(e) { try { alert(msg); } catch(e2) {} }
  },

  playRecording() {
    const rec = this._lastRecAudio;
    if (!rec || !rec.samples || rec.samples.length === 0) {
      this._recPlayError('没有可播放的录音，请先跟读录音');
      return;
    }
    this._ttsCancel();
    try { (this._ttsDiag = this._ttsDiag || []).push('播放录音:' + (rec.url ? 'blob' : '') + ' len=' + rec.samples.length); } catch (e2) {}
    var self = this;
    var startPlay = function() {
    var playJavaWav = function() {
      try {
        if (!(window.AndroidBackup && typeof window.AndroidBackup.playPcmWav === 'function')) return false;
        var sr = rec.sampleRate || 44100;
        var n = rec.samples.length;
        var buf = new ArrayBuffer(44 + n * 2);
        var dv = new DataView(buf);
        dv.setUint32(0, 0x46464952, true);
        dv.setUint32(4, 36 + n * 2, true);
        dv.setUint32(8, 0x45564157, true);
        dv.setUint32(12, 0x20746D66, true);
        dv.setUint32(16, 16, true);
        dv.setUint16(20, 1, true);
        dv.setUint16(22, 1, true);
        dv.setUint32(24, sr, true);
        dv.setUint32(28, sr * 2, true);
        dv.setUint16(32, 2, true);
        dv.setUint16(34, 16, true);
        dv.setUint32(36, 0x61746164, true);
        dv.setUint32(40, n * 2, true);
        for (var k = 0; k < n; k++) {
          var v = Math.max(-1, Math.min(1, rec.samples[k]));
          dv.setInt16(44 + k * 2, Math.round((v < 0 ? v * 32768 : v * 32767)), true);
        }
        var bytes = new Uint8Array(buf);
        var b64 = '';
        for (var k2 = 0; k2 < bytes.length; k2 += 0x8000) b64 += String.fromCharCode.apply(null, bytes.subarray(k2, k2 + 0x8000));
        b64 = btoa(b64);
        var r = String(window.AndroidBackup.playPcmWav(b64, 'REC'));
        if (r === '1') {
          self._ttsNativeId = 'REC';
          self._ttsNativeEndCb = function() { try { self._playCtx = null; } catch(e) {} };
          try { self._ttsDiag.push('录音JavaOK'); } catch(e2) {}
          return true;
        }
      } catch (e) {}
      return false;
    };
    var getPlayCtx = function() {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (self._playCtx && self._playCtx.state !== 'closed') return self._playCtx;
      try { self._playCtx = new Ctx(); } catch(e) { self._playCtx = null; }
      return self._playCtx;
    };
    var playWebAudio = function() {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        self._recPlayError('浏览器不支持音频播放');
        return;
      }
      try {
        const ctx = getPlayCtx();
        if (!ctx) {
          self._recPlayError('无法创建音频通道');
          return;
        }
        const buf = ctx.createBuffer(1, rec.samples.length, rec.sampleRate || 44100);
        buf.copyToChannel(rec.samples, 0);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.onended = function() { try { self._playCtx = null; } catch(e) {} };
        const doStart = function() {
          try { src.start(); } catch(e) { self._recPlayError('录音播放失败：' + ((e && e.message) || e)); }
        };
        if (ctx.state === 'suspended' && ctx.resume) {
          var pr = ctx.resume();
          if (pr && typeof pr.then === 'function') {
            var timedOut = false;
            var guard = setTimeout(function() {
              timedOut = true;
              if (ctx.state === 'suspended') {
                try { ctx.close(); } catch(e) {}
                self._playCtx = null;
                self._recPlayError('无法播放录音，音频通道被系统占用，请稍后重试');
              } else {
                doStart();
              }
            }, 3000);
            pr.then(function() { clearTimeout(guard); if (!timedOut) doStart(); }).catch(function() { clearTimeout(guard); if (!timedOut) doStart(); });
          } else {
            doStart();
          }
        } else {
          doStart();
        }
      } catch (e) {
        self._recPlayError('录音播放失败：' + ((e && e.message) || e));
      }
    };
    if (playJavaWav()) return;
    if (rec.url) {
      try {
        const a = new Audio(rec.url);
        this._recPlayEl = a;
        var failed = false;
        a.onended = function() { self._recPlayEl = null; };
        a.onerror = function() { if (self._recPlayEl === a) self._recPlayEl = null; if (!failed) { failed = true; playWebAudio(); } };
        const p = a.play();
        if (p && typeof p.catch === 'function') {
          p.catch(function() { if (!failed) { failed = true; playWebAudio(); } });
        }
        return;
      } catch (e) {}
    }
    playWebAudio();
    };
    if (window.AndroidBackup) {
      setTimeout(startPlay, 150);
    } else {
      startPlay();
    }
  },

  setupNavListeners() {
    var el = document.getElementById('nav-course');
    if (el) el.addEventListener('click', () => { this.setView('grade'); this.renderGrades(); });
    el = document.getElementById('nav-review');
    if (el) el.addEventListener('click', () => { this._cleanupView(); this.setView('review'); this.renderReviewWords(); });
    el = document.getElementById('nav-report');
    if (el) el.addEventListener('click', () => { this._cleanupView(); this.setView('report'); this.renderReport(); });
    el = document.getElementById('nav-stats');
    if (el) el.addEventListener('click', () => { this._cleanupView(); this.setView('stats'); this.showStats(); });
  },

  renderReviewWords() {
    this.currentView = 'review';
    const main = document.getElementById('main-content');
    const wrongWords = Storage.getWrongWords();

    let html = '<div class="review-container">';
    html += '<button class="back-btn" onclick="App.renderGrades()">← 返回上一级</button>';
    html += '<h2 class="review-title">📝 错题复习</h2>';

    if (wrongWords.length === 0) {
      html += '<div class="empty-state"><div class="empty-icon">🎉</div>';
      html += '<h2>没有错题！</h2><p>太棒了，继续保持！</p>';
      html += '<button class="continue-btn" onclick="App.renderGrades()">去学习</button></div>';
    } else {
      html += `<p class="review-subtitle">共 <strong>${wrongWords.length}</strong> 个待复习错题</p>`;
      html += '<div class="review-word-list">';
      wrongWords.forEach(w => {
        html += `<div class="review-word-card">
          <div class="review-word-en">${w.wordEn}</div>
          <div class="review-word-cn">${w.wordCn}</div>
          <div class="review-word-meta">
            <span class="rw-missed">答错 ${w.missedCount} 次</span>
            <span class="rw-unit">${w.unitTitle}</span>
          </div>
        </div>`;
      });
      html += '</div>';
      html += `<button class="continue-btn" id="start-review-btn">🔄 开始错题练习 (${wrongWords.length}题)</button>`;
      html += `<button class="review-clear-btn" id="clear-wrong-btn">🗑 清空错题本</button>`;
    }

    html += '</div>';
    main.innerHTML = html;

    const startBtn = document.getElementById('start-review-btn');
    if (startBtn) {
      startBtn.addEventListener('click', () => this.startReviewExercise());
    }

    const clearBtn = document.getElementById('clear-wrong-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('确定要清空所有错题吗？')) {
          Storage.clearWrongWords();
          this.renderReviewWords();
        }
      });
    }
  },

  reviewWords: [],
  reviewCorrectCount: 0,
  reviewTotal: 0,
  reviewIndex: 0,

  startReviewExercise() {
    const wrongWords = Storage.getWrongWords();
    if (wrongWords.length === 0) { this.renderReviewWords(); return; }

    this.reviewWords = wrongWords.slice();
    this.reviewCorrectCount = 0;
    this.reviewTotal = this.reviewWords.length;
    this.reviewIndex = 0;
    this.currentView = 'review';
    this.hearts = 5;

    this.activeSessionId = Storage.startSession('review', 0, '错题复习', '', {
      subject: this.currentSubject,
      totalItems: this.reviewTotal
    });

    const words = this.reviewWords.map(w => ({
      en: w.wordEn,
      cn: w.wordCn,
      example: '',
      pronounce: ''
    }));

    const enriched = [];
    this.getCourseData().grades.forEach(g => {
      g.modules.forEach(m => {
        m.units.forEach(u => {
          u.words.forEach(dw => {
            const match = words.find(w => w.en === dw.en);
            if (match) {
              enriched.push({ example: dw.example, pronounce: dw.pronounce });
      if (match) {
        for (var _mk in match) enriched[enriched.length - 1][_mk] = match[_mk];
      }
      enriched[enriched.length - 1].example = dw.example;
      enriched[enriched.length - 1].pronounce = dw.pronounce;
            }
          });
        });
      });
    });

    words.forEach(w => {
      if (!enriched.find(e => e.en === w.en)) {
        enriched.push(w);
      }
    });

    ExerciseEngine.generateExercises(enriched);
    this.renderReviewExercise();
    this.updateTopBar();
  },

  renderReviewExercise() {
    const exercise = ExerciseEngine.getCurrentExercise();
    if (!exercise) return this.finishReviewExercise();

    const main = document.getElementById('main-content');
    const total = ExerciseEngine.exercises.length;
    const current = ExerciseEngine.currentIndex + 1;

    let html = '<div class="exercise-container">';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><button class="back-btn" onclick="App._cleanupView();App.renderReviewWords()">← 返回上一级</button></div>';
    html += '<div class="exercise-progress-bar"><div class="exercise-progress-fill review-progress-fill" style="width:' + (current/total*100) + '%"></div></div>';
    html += '<div class="exercise-count">错题复习 第 ' + current + '/' + total + ' 题</div>';
    html += '<div class="exercise-hearts">' + '❤️'.repeat(this.hearts) + '🖤'.repeat(5 - this.hearts) + '</div>';

    switch (exercise.type) {
      case 'chooseCN':
      case 'chooseEN':
        html += this.renderChoiceExercise(exercise);
        break;
      case 'listen':
        html += this.renderListenExercise(exercise);
        break;
      case 'fillBlank':
        html += this.renderFillBlankExercise(exercise);
        break;
      case 'match':
        html += this.renderMatchExercise(exercise);
        break;
      case 'hearChoose':
        html += this.renderHearChooseExercise(exercise);
        break;
      case 'hearSpell':
        html += this.renderHearSpellExercise(exercise);
        break;
    }

    html += '</div>';
    main.innerHTML = html;
    this.attachReviewListeners(exercise);
  },

  attachReviewListeners(exercise) {
    if (exercise.type === 'chooseCN' || exercise.type === 'chooseEN') {
      document.querySelectorAll('.option-btn').forEach(btn => {
        btn.addEventListener('click', () => this.handleReviewAnswer(btn.dataset.answer, btn));
      });
    }

    if (exercise.type === 'listen') {
      document.getElementById('speaker-btn').addEventListener('click', () => {
        this.speakWord(exercise.audioWord);
      });
      this._exT(() => this.speakWord(exercise.audioWord), 500);
      document.querySelectorAll('.option-btn').forEach(btn => {
        btn.addEventListener('click', () => this.handleReviewAnswer(btn.dataset.answer, btn));
      });
    }

    if (exercise.type === 'fillBlank') {
      document.getElementById('submit-btn').addEventListener('click', () => {
        this.handleReviewAnswer(document.getElementById('fill-input').value);
      });
      document.getElementById('fill-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.handleReviewAnswer(document.getElementById('fill-input').value);
      });
      document.getElementById('fill-input').focus();
      if (exercise.audioWord) {
        this._exT(() => this.speakChinese(exercise.audioWord), 300);
      }
    }

    if (exercise.type === 'match') {
      this.selectedEN = null;
      this.selectedCN = null;
      document.querySelectorAll('.match-en').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.match-en').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          this.selectedEN = btn.dataset.en;
          if (this.selectedCN) this.checkMatch(exercise);
        });
      });
      document.querySelectorAll('.match-cn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.match-cn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          this.selectedCN = btn.dataset.cn;
          if (this.selectedEN) this.checkMatch(exercise);
        });
      });
    }

    if (exercise.type === 'hearChoose') {
      document.getElementById('speaker-btn').addEventListener('click', () => {
        this.speakWord(exercise.audioWord);
      });
      this._exT(() => this.speakWord(exercise.audioWord), 400);
      document.querySelectorAll('.option-btn').forEach(btn => {
        btn.addEventListener('click', () => this.handleReviewAnswer(btn.dataset.answer, btn));
      });
    }

    if (exercise.type === 'hearSpell') {
      document.getElementById('speaker-btn').addEventListener('click', () => {
        this.speakWord(exercise.audioWord);
      });
      this._exT(() => this.speakWord(exercise.audioWord), 300);
      document.getElementById('submit-btn').addEventListener('click', () => {
        this.handleReviewAnswer(document.getElementById('fill-input').value);
      });
      document.getElementById('fill-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.handleReviewAnswer(document.getElementById('fill-input').value);
      });
      document.getElementById('fill-input').focus();
    }
  },

  handleReviewAnswer(answer, clickedBtn) {
    const exercise = ExerciseEngine.getCurrentExercise();
    const isCorrect = ExerciseEngine.checkAnswer(answer);

    if (isCorrect) {
      Storage.removeWrongWord(exercise.word.en);
      this.reviewCorrectCount++;
      if (clickedBtn) clickedBtn.classList.add('correct');
      document.querySelectorAll('.option-btn').forEach(b => {
        if (b.dataset.answer === exercise.correctAnswer) b.classList.add('correct');
        b.disabled = true;
      });
      const inp = document.getElementById('fill-input');
      const sub = document.getElementById('submit-btn');
      if (inp) { inp.classList.add('correct'); inp.disabled = true; }
      if (sub) sub.disabled = true;
      this.showFeedback(true, exercise);
      setTimeout(() => this.nextReviewExercise(), 1000);
    } else {
      if (clickedBtn) {
        clickedBtn.classList.add('wrong');
        document.querySelectorAll('.option-btn').forEach(b => {
          if (b.dataset.answer === exercise.correctAnswer) b.classList.add('correct');
          b.disabled = true;
        });
      }
      const inp = document.getElementById('fill-input');
      const sub = document.getElementById('submit-btn');
      if (inp) { inp.classList.add('wrong'); inp.disabled = true; }
      if (sub) sub.disabled = true;
      this.hearts = Math.max(0, this.hearts - 1);
      document.getElementById('heart-count').textContent = this.hearts;
      const existing = Storage.getWrongWords().find(w => w.wordEn === exercise.word.en);
      Storage.addWrongWord(exercise.word.en, exercise.word.cn, existing ? existing.unitId : 0, existing ? existing.unitTitle : '');
      this.showFeedback(false, exercise);
      setTimeout(() => {
        if (this.hearts <= 0) {
          this.finishReviewExercise();
        } else {
          this.nextReviewExercise();
        }
      }, 1200);
    }
  },

  nextReviewExercise() {
    if (ExerciseEngine.nextExercise()) {
      this.renderReviewExercise();
    } else {
      this.finishReviewExercise();
    }
  },

  finishReviewExercise() {
    if (this.activeSessionId) {
      const remaining = Storage.getWrongWords().length;
      const mastered = this.reviewCorrectCount;
      Storage.endSession(this.activeSessionId, {
        correctCount: mastered,
        wrongCount: this.reviewTotal - mastered,
        totalItems: this.reviewTotal,
        accuracy: this.reviewTotal > 0 ? Math.round((mastered / this.reviewTotal) * 100) : 0,
        stars: remaining === 0 ? 3 : remaining <= this.reviewTotal / 2 ? 2 : 1,
        xp: mastered * 5,
        initialWrong: this.reviewTotal,
        remainingWrong: remaining
      });
      this.activeSessionId = null;
      this._autoPushReport();
    }

    this.progress = Storage.getProgress();
    this.hearts = 5;
    this.updateTopBar();
    this.renderReport();
  },

  showStats() {
    this.currentView = 'stats';
    const progress = this.progress;
    const main = document.getElementById('main-content');

    let totalWords = 0;
    let completedUnits = 0;
    let totalUnits = 0;
    this.getCourseData().grades.forEach(g => {
      g.modules.forEach(m => {
        m.units.forEach(u => {
          totalUnits++;
          if (progress.completedLessons[u.id]) {
            completedUnits++;
            totalWords += u.words.length;
          }
        });
      });
    });

    let html = '<div class="stats-container">';
    html += '<button class="back-btn" onclick="App._cleanupView();App.renderSubjectSelector()">← 返回上一级</button>';
    html += '<h2 class="stats-title">📊 学习统计</h2>';
    html += '<button class="daily-mode-btn" id="btn-send-report" style="width:100%;margin-bottom:8px">📤 上报学习情况（发给老师平板）</button>';
    html += '<div id="report-msg" style="font-size:12px;color:var(--text-light);margin-bottom:10px;min-height:16px"></div>';
    const taskUndone = Storage.getTeacherTasks().filter(t => !t.done && !t.submitted).length;
    html += '<button class="daily-mode-btn" id="btn-task" style="width:100%;margin-bottom:8px">📥 老师练习' + (taskUndone ? '（' + taskUndone + ' 题未完成）' : '') + '</button>';
    html += '<div id="task-list" style="margin-bottom:10px"></div>';
    html += '<div id="task-diag" style="font-size:10px;color:#B0BEC5;margin:-6px 0 10px;min-height:12px">' + (this._taskDiag || '') + '</div>';
    html += '<div class="stats-grid">';
    html += `<div class="stat-card"><div class="stat-value">${progress.totalXP || 0}</div><div class="stat-label">总得分</div></div>`;
    html += `<div class="stat-card"><div class="stat-value">${progress.streak || 0}</div><div class="stat-label">连续天数</div></div>`;
    html += `<div class="stat-card"><div class="stat-value">Lv.${progress.level || 1}</div><div class="stat-label">当前等级</div></div>`;
    html += `<div class="stat-card"><div class="stat-value">${totalWords}</div><div class="stat-label">已学单词</div></div>`;
    html += `<div class="stat-card"><div class="stat-value">${completedUnits}/${totalUnits}</div><div class="stat-label">完成课程</div></div>`;
    let totalSec = 0;
    Storage.getSessions().filter(s => s.completed).forEach(s => { totalSec += s.duration || 0; });
    const totalMin = Math.round(totalSec / 60);
    html += `<div class="stat-card"><div class="stat-value">${totalMin}分钟</div><div class="stat-label">学习总时长</div></div>`;
    html += '</div>';

    html += '<h3 class="stats-subtitle">学期进度</h3>';
    this.getCourseData().grades.forEach(g => {
      let c = 0, t = 0;
      g.modules.forEach(m => {
        m.units.forEach(u => {
          t++;
          if (progress.completedLessons[u.id]) c++;
        });
      });
      const pct = t > 0 ? Math.round((c / t) * 100) : 0;
      html += `<div class="stat-unit-row">
        <span>${g.icon} ${g.title}</span>
        <div class="stat-unit-bar"><div class="stat-unit-fill" style="width:${pct}%;background:${g.color}"></div></div>
        <span>${pct}%</span>
      </div>`;
    });

    html += '</div>';
    main.innerHTML = html;

    const reportBtn = document.getElementById('btn-send-report');
    if (reportBtn) {
      reportBtn.addEventListener('click', () => this._sendReport(document.getElementById('report-msg')));
    }

    const taskBtn = document.getElementById('btn-task');
    if (taskBtn) {
      taskBtn.addEventListener('click', () => this._renderTeacherTasks());
    }
  },

  _applyTasks(msgs, myName, myId, myGrade) {
    const norm = v => String(v == null ? '' : v).trim().toLowerCase();
    const exist = Storage.getTeacherTasks();
    const seen = {};
    exist.forEach(t => { seen[t.id] = true; });
    let applied = 0;
    let taskAdded = 0;
    let mineCount = 0;
    msgs.forEach(m => {
      if (!m || typeof m.message !== 'string') return;
      let d = null;
      try { d = JSON.parse(m.message); } catch (e) {}
      if (!d) return;
      if (d.type === 'homework' && d.hw) {
        if (norm(d.toName) !== norm(myName)) return;
        const sid = myId;
        const hw = d.hw;
        if (d.subject === 'chinese') Storage.saveHomeworkZh(sid, hw);
        else if (d.subject === 'math') Storage.saveHomeworkMath(sid, hw);
        else Storage.saveHomework(sid, hw);
        applied++;
        return;
      }
      if (!Array.isArray(d.items) || !d.items.length) return;
      const mine = (d.toName && myName && norm(d.toName) === norm(myName)) || (d.toId !== undefined && d.toId !== null && String(d.toId) === String(myId));
      if (!mine) return;
      mineCount++;
      const mid = m.lan ? 'lan' + String(d.sentAt || '').replace(/\D/g, '') : m.id;
      d.items.forEach((it, idx) => {
        const id = 't' + mid + '_' + idx;
        if (seen[id]) return;
        if (this._isTaskSubmitted(id) || this._isTaskDeleted(id)) return;
        seen[id] = true;
        exist.push({ id: id, subject: it.subject, text: it.text, note: it.note || '', answer: it.answer || '', sentAt: d.sentAt || new Date().toISOString(), done: false });
        taskAdded++;
      });
    });
    return { applied: applied, taskAdded: taskAdded, mineCount: mineCount, count: msgs.length, exist: exist };
  },

  _applyTaskResult(r) {
    if (!r) return;
    if (r.taskAdded > 0) {
      Storage.saveTeacherTasks(r.exist);
      try { this._taskListRefresh && this._taskListRefresh(); } catch (e) {}
      try {
        const tl = document.getElementById('task-list');
        if (tl && tl.childElementCount > 0) this._renderTeacherTaskList(tl);
      } catch (e) {}
    }
    if (r.applied > 0) {
      try { this._subjHomeworkRefresh && this._subjHomeworkRefresh(); } catch (e) {}
    }
    try { this._updateTaskBadge(); } catch (e) {}
  },

  _pullRemoteHomework() {
    try { this._pullGradedAnswers(); } catch (e) {}
    try {
      const me = (Storage.getStudents() || []).find(s => s.id === Storage.getStudent());
      const myName = me ? me.name : '';
      const myId = Storage.getStudent();
      const myGrade = me ? String(Storage.getCurrentGrade(me)) : '';
      if (!myName && myId === null) return;
      const sinceKey = 'pjyx_task_since';
      let sinceTs = 0;
      try { sinceTs = parseInt(localStorage.getItem(sinceKey) || '0', 10) || 0; } catch (e) {}
      const since = sinceTs > 0 ? (sinceTs - 300) : 'all';
      this._lanTaskPull(myName).then(tasks => {
        if (tasks !== null) {
          const msgs = tasks.map(t => ({ lan: true, id: '', time: 0, message: JSON.stringify(t) }));
          const r = this._applyTasks(msgs, myName, myId, myGrade);
          this._applyTaskResult(r);
          try { this._tasksLog('局域网：电脑返回 ' + r.count + ' 条，新增 ' + r.taskAdded + ' 题'); } catch (e) {}
        }
        fetch(Storage.getTaskTopic() + '/json?poll=1&since=' + since, { cache: 'no-store' })
          .then(r => r.text())
          .then(txt => {
            let msgs = [];
            String(txt || '').split(/\r?\n/).forEach(ln => {
              ln = ln.trim();
              if (!ln) return;
              try { const m = JSON.parse(ln); if (m) msgs.push(m); } catch (e) {}
            });
            if (!Array.isArray(msgs)) msgs = [msgs];
            const maxT = msgs.reduce((mx, m) => (m && m.time && m.time > mx ? m.time : mx), 0);
            if (maxT > 0) { try { localStorage.setItem(sinceKey, String(maxT)); } catch (e) {} }
            const r = this._applyTasks(msgs, myName, myId, myGrade);
            this._applyTaskResult(r);
            try { this._tasksLog('拉取 ' + r.count + ' 条，发给我的 ' + r.mineCount + ' 条，新增 ' + r.taskAdded + ' 题；（局域网 ' + (tasks !== null ? '已取' : '不可用') + '）'); } catch (e) {}
          })
          .catch(e => {
            try { this._tasksLog('拉取失败：' + (e && e.message || e) + '（可能无外网）'); } catch (e2) {}
          });
      });
    } catch (e) {
      try { this._tasksLog('拉取异常：' + (e && e.message || e)); } catch (e2) {}
    }
  },

  _applyGraded(records) {
    if (!Array.isArray(records) || !records.length) return 0;
    const tasks = Storage.getTeacherTasks();
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem('pjyx_graded_handled') || '[]') || []; } catch (e) {}
    let n = 0;
    const fpOf = g => String(g.taskId) + '|' + String(g.submittedAt || g.gradedAt || g.time || '');
    records.forEach(g => {
      if (!g || g.taskId == null) return;
      const isCorrect = g.correct === true || String(g.correct) === 'True' || String(g.correct) === 'true';
      const fp = fpOf(g);
      const t = tasks.find(x => String(x.id) === String(g.taskId));
      if (t) {
        if (seen.indexOf(fp) >= 0) return;
        seen.push(fp);
        t.correct = isCorrect;
        t.answer = g.answer || '';
        t.myAnswer = g.myAnswer || t.myAnswer || '';
        t.submitted = true;
        t.graded = true;
        n++;
      } else {
        if (!g.text) return;
        if (this._isTaskDeleted(String(g.taskId))) return;
        if (seen.indexOf(fp) >= 0) return;
        tasks.push({
          id: String(g.taskId),
          subject: g.subject || this._inferTaskSubject(g.text),
          text: g.text,
          note: '',
          answer: g.answer || '',
          sentAt: g.submittedAt || new Date().toISOString(),
          done: false,
          correct: isCorrect,
          myAnswer: g.myAnswer || '',
          submitted: true,
          graded: true
        });
        seen.push(fp);
        n++;
      }
    });
    if (n) Storage.saveTeacherTasks(tasks);
    if (seen.length) {
      if (seen.length > 500) seen = seen.slice(-300);
      try { localStorage.setItem('pjyx_graded_handled', JSON.stringify(seen)); } catch (e) {}
    }
    return n;
  },

  _inferTaskSubject(text) {
    const s = String(text || '').trim();
    if (!s) return 'english';
    if (this._mathOpenEq(s) || /^\s*[-+]?\d+(?:\.\d+)?\s*$/.test(s)) return 'math';
    return /[\u4e00-\u9fff]/.test(s) ? 'chinese' : 'english';
  },

  _isTaskSubmitted(id) {
    try {
      const arr = JSON.parse(localStorage.getItem('pjyx_submitted_ids') || '[]') || [];
      return arr.indexOf(String(id)) >= 0;
    } catch (e) { return false; }
  },

  _markTaskSubmitted(id) {
    try {
      const arr = JSON.parse(localStorage.getItem('pjyx_submitted_ids') || '[]') || [];
      if (arr.indexOf(String(id)) < 0) arr.push(String(id));
      localStorage.setItem('pjyx_submitted_ids', JSON.stringify(arr));
    } catch (e) {}
  },

  _isTaskDeleted(id) {
    try {
      const arr = JSON.parse(localStorage.getItem('pjyx_deleted_ids') || '[]') || [];
      return arr.indexOf(String(id)) >= 0;
    } catch (e) { return false; }
  },

  _markTaskDeleted(id) {
    try {
      const arr = JSON.parse(localStorage.getItem('pjyx_deleted_ids') || '[]') || [];
      if (arr.indexOf(String(id)) < 0) arr.push(String(id));
      localStorage.setItem('pjyx_deleted_ids', JSON.stringify(arr));
    } catch (e) {}
  },

  _lanGradedPull(name) {
    return new Promise((resolve) => {
      const host = this._getSavedHost();
      if (!host) { resolve(null); return; }
      this._lanGet('http://' + host + ':8899/graded-answers?name=' + encodeURIComponent(name || '')).then(res => {
        try {
          if (!res || !res.ok) { resolve(null); return; }
          const j = JSON.parse(res.body || '{}');
          resolve(j.graded || []);
        } catch (e) { resolve(null); }
      });
    });
  },

  _pullGradedAnswers() {
    try {
      const me = (Storage.getStudents() || []).find(s => s.id === Storage.getStudent());
      const myName = me ? me.name : '';
      const myId = Storage.getStudent();
      if (!myName && myId === null) return;
      const sinceKey2 = 'pjyx_graded_since';
      let sinceTs = 0;
      try { sinceTs = parseInt(localStorage.getItem(sinceKey2) || '0', 10) || 0; } catch (e) {}
      const since = sinceTs > 0 ? (sinceTs - 300) : 'all';
      let merged = 0;
      const apply = arr => {
        if (arr && arr.length) merged += this._applyGraded(arr);
      };
      this._lanGradedPull(myName).then(lanArr => {
        apply(lanArr);
        this._fetchJsonTimeout(Storage.getAnswerTopic() + '/json?poll=1&since=' + since, 10000)
          .then(txt => {
            let msgs = [];
            String(txt || '').split(/\r?\n/).forEach(ln => {
              ln = ln.trim();
              if (!ln) return;
              try { const m = JSON.parse(ln); if (m) msgs.push(m); } catch (e) {}
            });
            if (!Array.isArray(msgs)) msgs = [msgs];
            const mine = msgs
              .filter(m => m && typeof m.message === 'string')
              .map(m => { try { return JSON.parse(m.message); } catch (e) { return null; } })
              .filter(d => d && d.graded === true && ((myName && String(d.name).trim().toLowerCase() === String(myName).trim().toLowerCase()) || (d.studentId !== undefined && d.studentId !== null && String(d.studentId) === String(myId))));
            apply(mine);
            const maxT = msgs.reduce((mx, m) => (m && m.time && m.time > mx ? m.time : mx), 0);
            if (maxT > 0) { try { localStorage.setItem(sinceKey2, String(maxT)); } catch (e) {} }
            if (merged > 0) {
              try { this._taskListRefresh && this._taskListRefresh(); } catch (e) {}
              try {
                const tl = document.getElementById('task-list');
                if (tl && tl.childElementCount > 0) this._renderTeacherTaskList(tl);
              } catch (e) {}
              try { this._updateTaskBadge(); } catch (e) {}
            }
          })
          .catch(() => {});
      });
    } catch (e) {}
  },

  _tasksLog(msg) {
    try {
      this._taskDiag = new Date().toLocaleTimeString('zh-CN') + ' ' + msg;
      const el = document.getElementById('task-diag');
      if (el) el.textContent = this._taskDiag;
    } catch (e) {}
  },

  _updateTaskBadge() {
    try {
      const n = Storage.getTeacherTasks().filter(t => !t.done && !t.submitted).length;
      const el = document.getElementById('nav-stats');
      if (!el) return;
      let badge = el.querySelector('.task-badge');
      if (n > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'task-badge';
          badge.style.cssText = 'position:absolute;top:4px;right:2px;background:#E53935;color:#fff;border-radius:10px;font-size:10px;line-height:16px;min-width:16px;height:16px;text-align:center;padding:0 4px;font-weight:700';
          el.style.position = 'relative';
          el.appendChild(badge);
        }
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.style.display = '';
      } else if (badge) {
        badge.style.display = 'none';
      }
    } catch (e) {}
  },

_renderTeacherTasks() {
    const list = document.getElementById('task-list');
    if (!list) return;
    const me = (Storage.getStudents() || []).find(s => s.id === Storage.getStudent());
    const myName = me ? me.name : '';
    const myId = Storage.getStudent();
    const myGrade = me ? String(Storage.getCurrentGrade(me)) : '';
    list.innerHTML = '<div style="font-size:12px;color:var(--text-light)">正在接收老师下发的练习...</div>';
    const render = () => {
      const exist = Storage.getTeacherTasks();
      Storage.saveTeacherTasks(exist);
      this._renderTeacherTaskList(list);
      try { this._updateTaskBadge(); } catch (e) {}
      this._pullGradedAnswers();
      this._taskListRefresh = () => {
        const b = document.getElementById('btn-task');
        if (b) {
          const n = Storage.getTeacherTasks().filter(t => !t.done && !t.submitted).length;
          b.textContent = '📥 老师练习' + (n ? '（' + n + ' 题未完成）' : '');
        }
      };
    };
    this._lanTaskPull(myName).then(tasks => {
      let lanOk = false;
      if (tasks !== null) {
        const msgs = tasks.map(t => ({ lan: true, id: '', time: 0, message: JSON.stringify(t) }));
        const r = this._applyTasks(msgs, myName, myId, myGrade);
        lanOk = true;
        if (r.taskAdded > 0 || r.count > 0) {
          Storage.saveTeacherTasks(r.exist);
          this._renderTeacherTaskList(list);
          try { this._updateTaskBadge(); } catch (e) {}
        }
      }
      this._fetchJsonTimeout(Storage.getTaskTopic() + '/json?poll=1&since=all', 10000)
        .then(txt => {
          let msgs = [];
          String(txt || '').split(/\r?\n/).forEach(ln => {
            ln = ln.trim();
            if (!ln) return;
            try { const m = JSON.parse(ln); if (m) msgs.push(m); } catch (e) {}
          });
          if (!Array.isArray(msgs)) msgs = [msgs];
          this._applyTasks(msgs, myName, myId, myGrade);
          render();
        })
        .catch(e => {
          if (!lanOk) {
            list.innerHTML = '<div style="font-size:12px;color:#C62828">❌ 接收失败：' + this._h(String(e.message || e)) + '，请检查网络</div>';
            return;
          }
          render();
        });
    });
  },

  _renderTeacherTaskList(list) {
    const tasks = Storage.getTeacherTasks();
    const btn = document.getElementById('btn-task');
    if (btn) {
      const undone = tasks.filter(t => !t.done && !t.submitted).length;
      btn.textContent = '📥 老师练习' + (undone ? '（' + undone + ' 题未完成）' : '');
    }
    if (tasks.length === 0) {
      list.innerHTML = '<div style="font-size:12px;color:var(--text-light);background:#F5F7FA;border-radius:10px;padding:12px">暂无老师下发的练习</div>';
      return;
    }
    // 试卷区：待作答 / 重做的题目（整卷展示，一次性交卷）
    const paperQ = tasks.filter(t => !t.done && !t.submitted && !t.graded);
    // 已完成区：已答（批阅/待批）题目，按日期归档展示
    const doneQ = tasks.filter(t => !paperQ.includes(t));

    let html = '<div style="border:1px solid #E0E0E0;border-radius:10px;overflow:hidden">';

    // ---- 试卷作答区 ----
    if (paperQ.length) {
      const filled = paperQ.filter(t => this._paperVal(t.id)).length;
      html += '<div style="padding:8px 10px;background:#F5F7FA;font-size:13px;font-weight:700;border-bottom:1px solid #E0E0E0">📄 练习卷（共 ' + paperQ.length + ' 题）</div>';
      html += '<div style="padding:4px 10px 8px">';
      paperQ.forEach((t, idx) => {
        html += '<div style="padding:8px 0;border-bottom:1px dashed #E0E0E0">';
        html += '<div style="display:flex;justify-content:space-between;align-items:flex-start">';
        html += '<div style="flex:1">';
        html += '<span style="font-weight:700;color:#1565C0">' + (idx + 1) + '.</span> ';
        html += '<span style="font-size:11px;color:#8D6E63">[' + this._subjName(t.subject) + ']</span> ';
        html += '<span style="font-size:14px;white-space:pre-wrap">' + this._h(t.text) + '</span>';
        if (t.note) html += '<div style="font-size:11px;color:#1565C0;margin-top:2px">📘 ' + this._h(t.note) + '</div>';
        html += '</div>';
        html += '<span style="color:#C62828;font-size:14px;cursor:pointer" title="删除此题" data-tdelp="' + this._h(t.id) + '">🗑</span>';
        html += '</div>';
        html += '<input type="' + (t.answer ? 'number' : 'text') + '" class="task-ans-in" data-pwid="' + this._h(t.id) + '" value="' + String(this._paperVal(t.id) || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '" placeholder="' + (t.answer ? '输入答案' : '输入答案或过程') + '" style="width:100%;border:1px solid #BDBDBD;border-radius:8px;padding:6px 8px;font-size:14px;margin-top:4px;box-sizing:border-box"' + (t.answer ? ' inputmode="decimal"' : '') + '>';
        html += '</div>';
      });
      html += '</div>';
      html += '<div style="padding:8px 10px;background:#F5F7FA;border-top:1px solid #E0E0E0">';
      html += '<button class="admin-gen-btn" id="task-submit-all" style="width:100%;background:#1565C0;color:#fff;font-weight:700">📮 交卷（已填 ' + filled + ' / ' + paperQ.length + ' 题）</button>';
      html += '<div style="font-size:11px;color:#8D6E63;text-align:center;margin-top:4px">请在每题输入答案后点「交卷」，一次提交全部已填题目</div>';
      html += '</div>';
    }

    // ---- 已完成区（已答 / 已批阅）----
    if (doneQ.length) {
      const byDate = {};
      doneQ.forEach(t => {
        const d = new Date(t.sentAt).toLocaleDateString('zh-CN');
        (byDate[d] = byDate[d] || []).push(t);
      });
      Object.keys(byDate).sort().reverse().forEach(d => {
        html += '<div style="padding:8px 10px 2px;font-size:11px;color:var(--text-muted);background:#FAFAFA;border-top:1px solid #EEE">📅 ' + d + '</div>';
        byDate[d].forEach(t => {
          html += '<div class="asc-item" style="align-items:flex-start;padding:6px 10px"' + (t.done ? ' style="opacity:.6"' : '') + '>';
          html += '<div style="flex:1">';
          html += '<div style="font-size:12px;color:#8D6E63">[' + this._subjName(t.subject) + ']</div>';
          html += '<div style="font-size:14px;white-space:pre-wrap">' + (t.subject === 'math' ? this._h(this._mathTaskFullEq(t)) : this._h(t.text)) + '</div>';
          if (t.note && !t.done) html += '<div style="font-size:11px;color:#1565C0;margin-top:2px">📘 ' + this._h(t.note) + '</div>';
          if (t.graded) {
            if (t.correct) {
              html += '<div style="font-size:12px;margin-top:3px;color:#2E7D32">✅ 老师已批阅：正确' + (t.answer ? '（标准答案：' + this._h(String(t.answer)) + '）' : '') + '</div>';
            } else {
              html += '<div style="font-size:12px;margin-top:3px;color:#C62828">❌ 老师已批阅：错误' + (t.answer ? '（标准答案：' + this._h(String(t.answer)) + '）' : '') + '</div>';
              html += '<div style="display:flex;gap:6px;margin-top:6px">';
              html += '<button class="admin-gen-btn" data-tredo="' + this._h(t.id) + '" style="flex:1">🔁 重做此题</button>';
              html += '</div>';
            }
          } else if (t.submitted) {
            const hasC = t.correct !== undefined && t.correct !== null;
            html += '<div style="font-size:12px;margin-top:3px;color:' + (hasC && !t.correct ? '#C62828' : '#2E7D32') + '">我的答案：' + this._h(String(t.myAnswer || '')) + (hasC ? (t.correct ? ' ✅ 正确' : ' ❌ 错误' + (t.answer ? '（标准答案：' + this._h(String(t.answer)) + '）' : '')) : '（已提交，待老师查看）') + '</div>';
            html += '<div style="display:flex;gap:6px;margin-top:6px">';
            html += '<button class="admin-gen-btn" data-tredo="' + this._h(t.id) + '" style="flex:1">🔁 重做此题</button>';
            html += '</div>';
          }
          html += '</div>';
          html += '<span style="color:#2E7D32;font-size:15px;cursor:pointer;margin-right:10px" title="重做此题" data-tredo="' + this._h(t.id) + '">🔁</span>';
          html += '<span style="color:#C62828;font-size:14px;cursor:pointer" title="删除此题" data-tdel="' + this._h(t.id) + '">🗑</span>';
          html += '</div>';
        });
      });
    }
    html += '</div>';
    list.innerHTML = html;

    // 试卷区：输入框值暂存（供交卷计数 / 重渲染保留）
    list.querySelectorAll('.task-ans-in[data-pwid]').forEach(inp => {
      inp.addEventListener('input', () => {
        try { this._paperVal(inp.dataset.pwid, inp.value); } catch (e) {}
      });
      const saved = this._paperVal(inp.dataset.pwid);
      if (saved !== null && saved !== undefined && String(saved) !== inp.value) inp.value = saved;
      // 交卷按钮计数实时更新
      inp.addEventListener('input', () => {
        const btn2 = document.getElementById('task-submit-all');
        if (btn2) {
          const filled2 = list.querySelectorAll('.task-ans-in[data-pwid]').length
            ? Array.prototype.filter.call(list.querySelectorAll('.task-ans-in[data-pwid]'), e => (e.value || '').trim().length > 0).length : 0;
          btn2.textContent = '📮 交卷（已填 ' + filled2 + ' 题）';
        }
      });
    });

    const subBtn = document.getElementById('task-submit-all');
    if (subBtn) {
      subBtn.addEventListener('click', () => {
        const tasks2 = Storage.getTeacherTasks();
        let submitted = 0;
        const removeIds = [];
        tasks2.forEach(t => {
          if (t.done || t.submitted || t.graded) return;
          const val = this._paperVal(t.id);
          if (!val) return;
          t.myAnswer = val;
          if (t.answer) {
            const a = String(t.answer).trim();
            const u = val.replace(/[,，]/g, '').replace(/%/g, '');
            t.correct = String(a).replace(/%/g, '') === u.replace(/%/g, '') || Math.abs(parseFloat(a) - parseFloat(u)) < 0.001;
          } else {
            t.correct = undefined;
          }
          t.submitted = true;
          this._publishAnswer(t);
          this._markTaskSubmitted(t.id);
          removeIds.push(t.id);
          submitted++;
        });
        removeIds.forEach(id => { try { delete this._paperIn[id]; } catch (e) {} });
        Storage.saveTeacherTasks(tasks2.filter(x => removeIds.indexOf(x.id) < 0));
        this._renderTeacherTaskList(list);
        if (submitted > 0) {
          // 需求2：交卷后直接删除已完成题目，不再弹提示；交卷成功的反馈轻量显示在待办角标
          try { this._updateTaskBadge && this._updateTaskBadge(); } catch (e) {}
        }
      });
    }

    // 试卷区：删除某题（不弹确认，直接删除）
    list.querySelectorAll('[data-tdelp]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.tdelp;
        this._markTaskDeleted(id);
        try { delete this._paperIn[id]; } catch (e) {}
        Storage.saveTeacherTasks(Storage.getTeacherTasks().filter(x => x.id !== id));
        this._renderTeacherTaskList(list);
      });
    });

    list.querySelectorAll('[data-tredo]').forEach(el => {
      el.addEventListener('click', () => {
        const tasks2 = Storage.getTeacherTasks();
        const t = tasks2.find(x => x.id === el.dataset.tredo);
        if (t) {
          t.submitted = false;
          t.graded = false;
          t.correct = undefined;
          t.myAnswer = '';
          t.done = false;
        }
        Storage.saveTeacherTasks(tasks2);
        this._renderTeacherTaskList(list);
      });
    });
    list.querySelectorAll('[data-tdel]').forEach(el => {
      el.addEventListener('click', () => {
        this._markTaskDeleted(el.dataset.tdel);
        Storage.saveTeacherTasks(Storage.getTeacherTasks().filter(x => x.id !== el.dataset.tdel));
        this._renderTeacherTaskList(list);
      });
    });
  },

  // 试卷区输入框值的暂存（key=任务id，value=输入值）
  _paperIn: {},
  _paperVal(id, val) {
    if (arguments.length >= 2) { this._paperIn[id] = val; return val; }
    const v = this._paperIn[id];
    return (v === null || v === undefined) ? '' : String(v);
  },

  _publishAnswer(t) {
    const sid = Storage.getStudent();
    const me = (Storage.getStudents() || []).find(s => s.id === sid);
const body = {
      name: me ? me.name : '未知学员',
      studentId: sid,
      grade: me && me.grade ? me.grade : '',
      taskId: t.id,
      subject: t.subject,
      text: t.text,
      answer: t.answer || '',
      myAnswer: t.myAnswer || '',
      correct: t.correct === undefined ? null : t.correct,
      submittedAt: new Date().toISOString()
    };
    fetch(Storage.getAnswerTopic(), { method: 'PUT', body: JSON.stringify(body) }).catch(() => {});
    try {
      const host = this._getSavedHost();
      if (host) {
        this._lanPost('http://' + host + ':8899/answer-push', JSON.stringify(body)).catch(() => {});
      }
    } catch (e) {}
  },

  _sendReport(msg) {
    if (!msg) return;
    msg.textContent = '正在上报...';
    msg.style.color = '#0D47A1';
    const rep = Storage.buildReport();
    fetch(Storage.getReportTopic(), { method: 'PUT', body: JSON.stringify(rep) })
      .then(r => {
        msg.textContent = r.ok
          ? '✅ 已上报给老师（' + new Date().toLocaleString('zh-CN') + '）'
          : '❌ 上报失败（' + r.status + '），请稍后重试';
        msg.style.color = r.ok ? '#2E7D32' : '#C62828';
      })
      .catch(e => {
        msg.textContent = '❌ 上报失败：' + (e.message || e) + '，请检查网络';
        msg.style.color = '#C62828';
      });
    try {
      const host = this._getSavedHost();
      if (host) {
        this._lanPost('http://' + host + ':8899/report-push', JSON.stringify(rep)).then(r => {
          if (r && r.ok) {
            msg.textContent = '✅ 已上报给老师（' + new Date().toLocaleString('zh-CN') + '）';
            msg.style.color = '#2E7D32';
          }
        }).catch(() => {});
      }
    } catch (e) {}
  },

  _autoPushReport() {
    try {
      const host = this._getSavedHost();
      if (!host) return;
      const now = Date.now();
      if (this._lastReportPush && now - this._lastReportPush < 5000) return;
      this._lastReportPush = now;
      const rep = Storage.buildReport();
      this._lanPost('http://' + host + ':8899/report-push', JSON.stringify(rep)).catch(() => {});
    } catch (e) {}
  },

  _lanAnswerPull() {
    return new Promise((resolve) => {
      const host = this._getSavedHost();
      if (!host) { resolve(null); return; }
      let lastFail = 0;
      try { lastFail = parseInt(localStorage.getItem('pjyx_lan_fail') || '0', 10) || 0; } catch (e) {}
      if (Date.now() - lastFail < 120000) { resolve(null); return; }
      this._lanGet('http://' + host + ':8899/answers').then(res => {
        try {
          if (!res.ok) {
            try { localStorage.setItem('pjyx_lan_fail', String(Date.now())); } catch (e) {}
            resolve(null);
            return;
          }
          try { localStorage.removeItem('pjyx_lan_fail'); } catch (e) {}
          const j = JSON.parse(res.body || '{}');
          resolve((j.answers || []).slice());
        } catch (e) { resolve(null); }
      });
    });
  },

  renderReport() {
    this.currentView = 'report';
    document.querySelector('.top-bar').style.display = 'flex';
    document.querySelector('.bottom-nav').style.display = 'flex';
    this.setView('report');
    const main = document.getElementById('main-content');
    let sessions = Storage.getSessions();
    const progress = this.progress;

    if (sessions.length === 0 && Object.keys(progress.completedLessons).length > 0) {
      var _ck = Object.keys(progress.completedLessons);
      for (var _ci = 0; _ci < _ck.length; _ci++) {
        var unitIdStr = _ck[_ci];
        var v = progress.completedLessons[unitIdStr];
        const unitId = parseInt(unitIdStr);
        const ui = this.getUnitInfo(unitId);
        if (!ui.unitTitle) continue;
        const stars = progress.lessonStars[unitId] || 0;
        const words = [];
        this.getCourseData().grades.forEach(g => {
          g.modules.forEach(m => {
            m.units.forEach(u => {
              if (u.id === unitId) u.words.forEach(w => words.push(w));
            });
          });
        });
        let fakeId = Date.now();
        sessions.unshift({
          id: ++fakeId,
          type: 'exercise',
          unitId: unitId,
          unitTitle: ui.unitTitle,
          gradeTitle: ui.gradeTitle,
          startTime: new Date(Date.now() - 600000).toISOString(),
          endTime: new Date().toISOString(),
          duration: 180,
          completed: true,
          totalItems: words.length,
          correctCount: Math.round(words.length * stars / 3),
          wrongCount: words.length - Math.round(words.length * stars / 3),
          accuracy: Math.round(stars / 3 * 100),
          stars: stars,
          xp: stars * 10
        });
      }
      Storage.save('sessions', sessions);
    }

    const completed = sessions.filter(s => s.completed);

    let html = '<div class="report-container">';
    html += '<button class="back-btn" onclick="App._cleanupView();App.renderSubjectSelector()">← 返回上一级</button>';
    html += '<h2 class="report-title">📋 学情汇总</h2>';
    html += '<button class="daily-mode-btn" id="rep-send-btn" style="width:100%;margin-bottom:6px">📤 上报学习情况（发给老师平板）</button>';
    html += '<div id="rep-send-msg" style="font-size:12px;color:var(--text-light);margin-bottom:8px;min-height:16px"></div>';

    if (completed.length === 0) {
      html += '<div class="empty-state"><div class="empty-icon">📭</div>';
      html += '<h2>还没有学习记录</h2><p>完成一次学习后这里会显示记录</p>';
      html += '<button class="continue-btn" onclick="App.renderGrades()">去学习</button></div>';
      main.innerHTML = html;
      const rsb = document.getElementById('rep-send-btn');
      if (rsb) rsb.addEventListener('click', () => this._sendReport(document.getElementById('rep-send-msg')));
      return;
    }

    const today = new Date().toDateString();
    let todayMinutes = 0, todaySessions = 0, todayXP = 0;
    let weekMinutes = 0, weekSessions = 0;
    const weekAgo = Date.now() - 7 * 86400000;

    completed.forEach(s => {
      const mins = Math.round(s.duration / 60);
      if (new Date(s.startTime).toDateString() === today) {
        todayMinutes += mins;
        todaySessions++;
        todayXP += s.xp;
      }
      if (new Date(s.startTime).getTime() > weekAgo) {
        weekMinutes += mins;
        weekSessions++;
      }
    });

    html += '<div class="report-summary">';
    html += `<div class="report-summary-card"><div class="rsc-value">${todayMinutes}分钟</div><div class="rsc-label">今日学习</div></div>`;
    html += `<div class="report-summary-card"><div class="rsc-value">${todaySessions}次</div><div class="rsc-label">今日练习</div></div>`;
    html += `<div class="report-summary-card"><div class="rsc-value">${todayXP}分</div><div class="rsc-label">今日得分</div></div>`;
    html += `<div class="report-summary-card"><div class="rsc-value">${weekMinutes}分钟</div><div class="rsc-label">本周学习</div></div>`;
    html += `<div class="report-summary-card"><div class="rsc-value">${completed.length}次</div><div class="rsc-label">总练习</div></div>`;
    html += '</div>';

    const subNames = { english: '📗 英语', chinese: '📕 语文', math: '📘 数学' };
    const subColors = { english: '#E3F2FD', chinese: '#FFF3E0', math: '#E8F5E9' };
    const subStat = {};
    completed.forEach(s => {
      const sub = s.subject || 'english';
      if (!subStat[sub]) subStat[sub] = { count: 0, min: 0, xp: 0, correct: 0, wrong: 0 };
      subStat[sub].count++;
      subStat[sub].min += Math.round(s.duration / 60);
      subStat[sub].xp += s.xp || 0;
      subStat[sub].correct += s.correctCount || 0;
      subStat[sub].wrong += (s.wrongCount != null ? s.wrongCount : ((s.totalItems || 0) - (s.correctCount || 0)));
    });
    const activeSubs = Object.keys(subStat);
    if (activeSubs.length > 0) {
      html += '<h3 class="report-section-title">分科目统计</h3>';
      html += '<div class="report-summary">';
      activeSubs.forEach(sub => {
        const ss = subStat[sub];
        const acc = (ss.correct + ss.wrong) > 0 ? Math.round(ss.correct / (ss.correct + ss.wrong) * 100) : 0;
        html += '<div class="report-summary-card" style="background:' + (subColors[sub] || '#F5F7FA') + '">';
        html += '<div class="rsc-value">' + (subNames[sub] || sub) + '</div>';
        html += '<div class="rsc-label">' + ss.count + '次 · ' + ss.min + '分钟 · 正确率' + acc + '%</div></div>';
      });
      html += '</div>';
    }

    html += '<h3 class="report-section-title">学习记录</h3>';
    html += '<div class="report-session-list">';

    completed.forEach(s => {
      const startDate = new Date(s.startTime);
      const endDate = s.endTime ? new Date(s.endTime) : null;
      const dateStr = startDate.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
      const timeStr = startDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const endTimeStr = endDate ? endDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—';
      const mins = Math.max(1, Math.round(s.duration / 60));
      const typeMap = { exercise: '📝 练习', flashcard: '🃏 闪卡', reading: '📖 课文', review: '🔄 错题复习', hearChoose: '🎧 听选', hearSpell: '🎤 听拼', zhStudy: '📖 认读/诵读', zhListenQuiz: '🎧 听音选字', zhMeaning: '📝 释义理解', zhAuthor: '🏛 作者朝代', zhStroke: '✍ 笔画学习', zhFlashcard: '🃏 翻卡', zhListenChoose: '🎧 听音选字', zhPinyin: '✍️ 拼音训练', zhBubble: '🎲 口诀背诵', zhSay: '🎲 组词造句', zhFly: '🪰 拍苍蝇', mathKnowledge: '📋 知识点', mathExplain: '📖 讲解', mathApply: '📝 应用', mathMemorize: '📋 口诀背诵', mathChallenge: '🎯 闯关挑战', mathQuiz: '📝 练习', mathPattern: '🔢 数字规律', mathCompare: '🧩 对比辨析', mathWrongReview: '❌ 错题重练' };
      const typeLabel = typeMap[s.type] || s.type;
      const starsStr = s.stars > 0 ? '⭐'.repeat(s.stars) : '';
      const accColor = s.accuracy >= 90 ? 'var(--green)' : s.accuracy >= 60 ? 'var(--orange)' : 'var(--red)';
      const wrongCount = s.wrongCount != null ? s.wrongCount : (s.totalItems - s.correctCount);
      const isReview = s.type === 'review';

      html += `<div class="report-session">
        <div class="rs-header">
          <span class="rs-date">${dateStr}</span>
          <span class="rs-type">${typeLabel}</span>
          <span class="rs-stars">${starsStr}</span>
        </div>
        <div class="rs-body">
          <div class="rs-unit">${isReview ? '错题复习' : (s.gradeTitle + ' · ' + s.unitTitle)}</div>
          <div class="rs-meta">
            <span>🕐 ${timeStr} → ${endTimeStr}</span>
            <span>⏱ ${mins}分钟</span>
            <span style="color:var(--green)">✅ ${s.correctCount}</span>
            <span style="color:var(--red)">❌ ${wrongCount}</span>
            <span>⚡ +${s.xp}分</span>
          </div>`;

      if (isReview && s.initialWrong > 0) {
        var rem = s.remainingWrong || 0;
        const mastered = s.initialWrong - Math.max(0, rem);
        html += `<div class="rs-review-detail">
          📋 错题：${s.initialWrong} → 掌握 <strong style="color:var(--green)">${mastered}</strong> 个` +
          (rem > 0 ? `，剩余 <strong style="color:var(--red)">${rem}</strong> 个` : '') +
          `</div>`;
      }

      html += `</div></div>`;
    });

    html += '</div>';

    if (completed.length > 10) {
      html += `<button class="report-clear-btn" id="report-clear-btn">🗑 清除所有记录</button>`;
    }

    if (completed.length > 0) {
      html += '<div style="text-align:center;margin:16px 0">';
      html += '<button class="share-img-btn" id="report-share-btn" style="padding:10px 24px;border:none;border-radius:10px;background:var(--green);color:#fff;font-size:15px;cursor:pointer">📸 学情报告</button>';
      html += '</div>';
      html += '<div id="share-img-preview" style="margin-top:12px"></div>';
    }

    html += '</div>';
    main.innerHTML = html;

    const rsb = document.getElementById('rep-send-btn');
    if (rsb) rsb.addEventListener('click', () => this._sendReport(document.getElementById('rep-send-msg')));

    const shareBtn = document.getElementById('report-share-btn');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        const sid = Storage.getStudent();
        if (!sid) return;
        const data = Storage.getStudentData(sid);
        const cs = data.sessions.filter(s => s.completed);
        let totalMin = 0;
        cs.forEach(s => { totalMin += Math.max(1, Math.round((s.duration || 0) / 60)); });
        const studentList = Storage.getStudents();
        const self = studentList.find(st => st.id === sid);
        const wwc = Storage.getWrongWords().length;
        this._generateShareImage(data, cs, totalMin, self ? self.name : '', null, wwc, true);
      });
    }

    const clearBtn = document.getElementById('report-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('确定要清除所有学习记录吗？此操作不可恢复。')) {
          Storage.save('sessions', []);
          this.renderReport();
        }
      });
    }
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());

document.addEventListener('click', function (e) {
  var el = e.target;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el.tagName === 'BUTTON' || el.tagName === 'A' || /(btn|card|item|tab|entry|folder|mode|option|grid|row)/i.test(el.className || '')) {
      el.classList.add('btn-press');
      setTimeout(function () { el.classList.remove('btn-press'); }, 260);
      break;
    }
    el = el.parentNode;
  }
}, true);

window.__OK_app = true;
window.__SERVER_VER = '20260829-1713';