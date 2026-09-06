// 机构装机码：只有输入此码的设备才能使用本应用（请机构管理员妥善保管，勿发给老师）
const INSTALL_CODE = 'PJJY250412';
const MANAGER_PW = 'PJJY250412';

// 百度智能云 OCR 内置密钥（全平板共用，请妥善保管）
const BAIDU_OCR_API_KEY = 'Eih0Ht4SUiqzhLkcqOBcjNIx';
const BAIDU_OCR_SECRET_KEY = 'wm79xhc5KoZLe6KembilO5VevaiH002D';

// 云端错题中转（跨网络传输用，免费公开服务 ntfy.sh，消息默认保留 1 天）
const CLOUD_TOPIC_BASE = 'pjyx-wrong';
const CLOUD_URL = 'https://ntfy.sh/' + CLOUD_TOPIC_BASE + '-' + INSTALL_CODE.toLowerCase();

const Storage = {
  _studentId: null,

  getDeviceId() {
    if (this._deviceId !== undefined) return this._deviceId;
    this._deviceId = '';
    try {
      if (window.AndroidBackup && window.AndroidBackup.getDeviceId) {
        this._deviceId = window.AndroidBackup.getDeviceId() || '';
      }
    } catch (e) {}
    if (!this._deviceId) {
      try {
        let id = localStorage.getItem('vocab_browser_device_id');
        if (!id) {
          id = 'web-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
          localStorage.setItem('vocab_browser_device_id', id);
        }
        this._deviceId = id;
      } catch (e) {}
    }
    return this._deviceId;
  },

  isAuthorized() {
    try {
      const raw = localStorage.getItem('vocab_authorized_device');
      if (!raw) return false;
      const info = JSON.parse(raw);
      return !!info && info.deviceId === this.getDeviceId();
    } catch (e) { return false; }
  },

  authorizeDevice(code) {
    return false;
  },

  recordAuthorization(code) {
    try {
      const deviceId = this.getDeviceId();
      if (!deviceId) return false;
      localStorage.setItem('vocab_authorized_device', JSON.stringify({ deviceId, code: String(code || '').trim(), activatedAt: new Date().toISOString() }));
      return true;
    } catch (e) { return false; }
  },

  getAuthCode() {
    try {
      const raw = localStorage.getItem('vocab_authorized_device');
      if (!raw) return '';
      const info = JSON.parse(raw);
      return (info && info.code) || '';
    } catch (e) { return ''; }
  },

  verifyManagerPw(pw) {
    try { return String(pw || '').trim() === MANAGER_PW; } catch (e) { return false; }
  },

  setStudent(id) {
    this._studentId = id;
  },

  getStudent() {
    return this._studentId;
  },

  _key(key) {
    return 'vocab_' + (this._studentId ? 's' + this._studentId + '_' : '') + key;
  },

  save(key, value) {
    try {
      localStorage.setItem(this._key(key), JSON.stringify(value));
    } catch (e) {
      console.warn('Storage full:', e);
    }
    this.scheduleBackup();
    if ((key === 'wrongWords' || key === 'daily') && window.App && typeof App._onLocalSave === 'function') {
      try { App._onLocalSave(key, this._studentId); } catch (e) {}
    }
  },

  scheduleBackup() {
    if (this._backupTimer) clearTimeout(this._backupTimer);
    this._backupTimer = setTimeout(() => this.exportBackup(), 400);
  },

  flushBackup() {
    if (this._backupTimer) { clearTimeout(this._backupTimer); this._backupTimer = null; }
    this.exportBackup();
  },

  exportBackup() {
    try {
      if (!window.AndroidBackup || !window.AndroidBackup.saveBackup) return false;
      const obj = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('vocab_') === 0) obj[k] = localStorage.getItem(k);
      }
      const keys = Object.keys(obj);
      if (keys.length === 0) return false;
      if (!obj['vocab_students']) return false;
      obj['vocab_backup_device'] = this.getDeviceId();
      const ok = window.AndroidBackup.saveBackup(JSON.stringify(obj));
      if (ok) this._lastBackupTime = Date.now();
      return !!ok;
    } catch (e) {
      console.warn('backup export failed:', e);
      return false;
    }
  },

  restoreBackup(rawOverride) {
    try {
      if (!window.AndroidBackup || !window.AndroidBackup.readBackup) return false;
      var raw = rawOverride;
      if (raw === null || raw === undefined) raw = window.AndroidBackup.readBackup();
      if (!raw) return false;
      const obj = JSON.parse(raw);
      let devMatch = false;
      if (!this.isAuthorized()) {
        const bakAuth = obj['vocab_authorized_device'];
        const bakDev = obj['vocab_backup_device'];
        let bakDeviceId = '';
        try { bakDeviceId = bakAuth ? (JSON.parse(bakAuth).deviceId || '') : ''; } catch (e) {}
        devMatch = !!bakDeviceId && bakDeviceId === this.getDeviceId();
        if (devMatch || bakAuth || bakDev) {
          devMatch = true;
          try {
            localStorage.setItem('vocab_authorized_device', JSON.stringify({ deviceId: this.getDeviceId(), code: this.getAuthCode() || 'backup-restore', activatedAt: new Date().toISOString() }));
          } catch (e) {}
        }
      }
      let restored = 0;
      const existingList = [];
      try {
        const cur = JSON.parse(localStorage.getItem('vocab_students'));
        if (Array.isArray(cur)) cur.forEach(s => existingList.push(s));
      } catch (e) {}
      if (obj['vocab_students']) {
        const backupList = [];
        try {
          const bl = JSON.parse(obj['vocab_students']);
          if (Array.isArray(bl)) backupList.push.apply(backupList, bl);
        } catch (e) {}
        const merged = existingList.slice();
        backupList.forEach(function(s) {
          if (!merged.some(function(x) { return String(x.id) === String(s.id); })) merged.push(s);
        });
        if (merged.length !== existingList.length) {
          localStorage.setItem('vocab_students', JSON.stringify(merged));
          restored++;
        }
      }
      const activeIds = [];
      try {
        const list = JSON.parse(localStorage.getItem('vocab_students')) || [];
        list.forEach(s => activeIds.push(String(s.id)));
      } catch (e) {}
      for (const k in obj) {
        if (k.indexOf('vocab_') !== 0 || k === 'vocab_students') continue;
        if (k === 'vocab_authorized_device' || k === 'vocab_backup_device') continue;
        const m = k.match(/^vocab_s(\d+)_/);
        if (m && activeIds.indexOf(m[1]) === -1) continue;
        if (localStorage.getItem(k) !== null) continue;
        localStorage.setItem(k, obj[k]);
        restored++;
      }
      if (restored > 0) {
        try {
          const list = JSON.parse(localStorage.getItem('vocab_students')) || [];
          this._restoredStudentCount = list.length;
        } catch (e) {}
        try { localStorage.setItem('vocab_backup_restored_ok', '1'); } catch (e) {}
        if (devMatch || this.isAuthorized()) {
          try {
            localStorage.setItem('vocab_authorized_device', JSON.stringify({ deviceId: this.getDeviceId(), activatedAt: new Date().toISOString() }));
          } catch (e) {}
        }
      }
      return restored > 0 || devMatch;
    } catch (e) {
      console.warn('backup restore failed:', e);
      return false;
    }
  },

  getRestoredStudentCount() {
    return this._restoredStudentCount || 0;
  },

  load(key, defaultValue = null) {
    try {
      const val = localStorage.getItem(this._key(key));
      if (!val) return defaultValue;
      try {
        return JSON.parse(val);
      } catch (parseError) {
        console.error('Storage parse error for', this._key(key), parseError);
        localStorage.removeItem(this._key(key));
        return defaultValue;
      }
    } catch (e) {
      return defaultValue;
    }
  },

  // 学年起点年：9 月开学，1-8 月注册属上一学年（学年中段），9-12 月注册属本学年。
  // 供 addStudent/_ensureStudentIds/getCurrentGrade 共用（勿回退为注册日自然年，否则 8/31 后无法自动升年级）
  _academicStartYear(regDate) {
    const d = (regDate instanceof Date && !isNaN(regDate.getTime())) ? regDate : null;
    if (!d) return new Date().getFullYear();
    return d.getFullYear() - (d.getMonth() < 8 ? 1 : 0);
  },

  // 给缺失 id 的学员补唯一数字 id（云端/电脑 /students.json 只回 name/grade/createdAt 无 id，
  // 旧版 merge 原样入库曾导致所有学员 id=undefined → 登录串台、作业共用同一本地键）。一次性自愈。
  _ensureStudentIds(list) {
    let changed = false;
    if (!Array.isArray(list)) return false;
    const seen = new Set();
    list.forEach(s => { if (s && s.id !== undefined && s.id !== null && s.id !== '') seen.add(String(s.id)); });
    list.forEach(s => {
      if (!s || typeof s !== 'object') return;
      if (s.id === undefined || s.id === null || s.id === '') {
        let id = Date.now() + Math.floor(Math.random() * 10000);
        while (seen.has(String(id))) id = Date.now() + Math.floor(Math.random() * 10000);
        s.id = id;
        seen.add(String(id));
        changed = true;
      }
      if (s.gradeStartYear == null) s.gradeStartYear = this._academicStartYear(s.createdAt ? new Date(s.createdAt) : new Date());
      if (s.createdAt == null) s.createdAt = new Date().toISOString();
    });
    return changed;
  },

  getStudents() {
    const prev = this._studentId;
    this._studentId = null;
    const list = this.load('students', []);
    if (this._ensureStudentIds(list)) this.save('students', list);
    this._studentId = prev;
    return list;
  },

  // 平板当前地点：连接哪个地点的电脑，就在 _syncStudentsFromCloud 时经 receiver /site 学到。
  // 平板自由流动，地点由"连到的电脑"唯一决定，无需手动填写（勿回退）。
  getMySite() {
    try { return localStorage.getItem('vocab_mySite') || ''; } catch (e) { return ''; }
  },

  setMySite(site) {
    try { localStorage.setItem('vocab_mySite', site || ''); } catch (e) {}
  },

  // 只读当前地点的注册学员：site 匹配本地点，或历史无 site（老数据视为本地点，兼容既有名单）。
  // 内部 id 关联（登录/进度/作业按 studentId 取数）请用 getStudents()，勿直接过滤，避免数据串位。
  // 防云直连泄漏：平板从未连接任何地点电脑（my 为空）时，只保留无 site 老数据，不再显示全部点名册（勿回退）
  getSiteStudents() {
    const my = this.getMySite();
    if (!my) return this.getStudents().filter(s => !s.site);
    return this.getStudents().filter(s => !s.site || s.site === my);
  },

  addStudent(name, grade, createdAt) {
    const prev = this._studentId;
    this._studentId = null;
    const students = this.getStudents();
    if (students.find(s => s.name === name)) { this._studentId = prev; return null; }
    // 远端自动建档（其他平板已注册 → 本机重建）必须沿用远端原始注册时间，
    // 否则 8/31 学年滚动后本机算出的当前年级会差一级，回流改写电脑端学员库文件夹（勿回退）
    let created = new Date();
    if (createdAt) {
      const d = new Date(createdAt);
      if (!isNaN(d.getTime())) created = d;
    }
    const student = {
      id: Date.now(),
      name: name,
      grade: grade || 1,
      createdAt: created.toISOString(),
      gradeStartYear: this._academicStartYear(created),
      site: this.getMySite() || ''
    };
    students.push(student);
    this.save('students', students);
    this._studentId = prev;
    return student;
  },

  getCurrentGrade(student) {
    if (!student || !student.grade) return 1;
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), 7, 31);
    const base = Number(student.grade) || 1;
    // 学年起点：有注册时间则按 1-8 月注册属上一学年折算（8/31 后自动升年级），
    // 无 createdAt 的旧记录沿用旧口径（gradeStartYear 视为注册自然年）保证行为不突变
    let start;
    if (student.createdAt) {
      start = this._academicStartYear(new Date(student.createdAt));
    } else if (student.gradeStartYear != null) {
      start = Number(student.gradeStartYear);
    } else {
      start = now.getFullYear();
    }
    const acadNow = now > cutoff ? now.getFullYear() : now.getFullYear() - 1;
    return Math.min(6, base + Math.max(0, acadNow - start));
  },

  getSubject() {
    return localStorage.getItem('vocab_subject') || 'english';
  },

  setSubject(subject) {
    localStorage.setItem('vocab_subject', subject);
    this.scheduleBackup();
  },

  findStudent(name) {
    // 站点隔离：登录/重名判断只在本地点注册学员内搜；平板自由流动，不可登录他点学员（勿回退）
    var list = this.getSiteStudents();
    console.log('findStudent: name=' + name + ' count=' + list.length + ' students=' + JSON.stringify(list.map(function(s){return s.name;})));
    return list.find(s => s.name === name) || null;
  },

  mergeStudents(list) {
    if (!Array.isArray(list) || !list.length) return;
    // 墓碑防复活：本地有"已删学员"记录（pendingStudentRemovals）时，合并名单中该学员一律跳过，
    // 且本地残留的同名学员一并剔除，确保已删学员不会被云端/局域网名单合回来（勿回退）
    const tombstones = this.getPendingStudentRemovals();
    const dead = {};
    tombstones.forEach(r => { if (r && r.name) dead[String(r.name)] = true; });
    const existing = this.getStudents().filter(s => !(s && s.name && dead[String(s.name)]));
    const dict = {};
    existing.forEach(s => { if (s && s.name) dict[s.name] = s; });
    list.forEach(incoming => {
      if (!incoming || !incoming.name) return;
      if (dead[String(incoming.name)]) return;
      const local = dict[incoming.name];
      if (local) {
        // 本地已有该学员：保留本地真实身份（id/年级/入学年/注册时间）以维持学习数据关联，仅补前端缺失字段
        const keep = Object.assign({}, incoming);
        keep.id = local.id;
        if (local.grade != null) keep.grade = local.grade;
        if (local.gradeStartYear != null) keep.gradeStartYear = local.gradeStartYear;
        // 地点以本地为准（本地先注册/先接收的档案含本地点 site；云端名单可能漏带 site）
        if (local.site) keep.site = local.site;
        // 注册时间取"最早"：远端自动建档的副本（晚于原始注册）若不收敛，8/31 学年滚动后
        // 各设备算出的当前年级相差 1，会交替改写电脑端学员库文件夹（二年级↔三年级 往复）。
        // 统一取最早注册时间让所有设备口径一致（勿回退）
        let locT = null, incT = null;
        if (local.createdAt) { const d = new Date(local.createdAt); if (!isNaN(d.getTime())) locT = d.getTime(); }
        if (incoming.createdAt) { const d = new Date(incoming.createdAt); if (!isNaN(d.getTime())) incT = d.getTime(); }
        if (locT != null && incT != null && incT < locT) keep.createdAt = incoming.createdAt;
        else if (locT == null && incT != null) keep.createdAt = incoming.createdAt;
        else if (locT != null) keep.createdAt = local.createdAt;
        dict[incoming.name] = keep;
      } else {
        dict[incoming.name] = incoming;
      }
    });
    const merged = Object.values(dict);
    // 云端合并来的新学员可能无 id → 补唯一 id（否则所有学员共用 undefined 的存储键/登录串台）
    this._ensureStudentIds(merged);
    const prev = this._studentId;
    this._studentId = null;
    this.save('students', merged);
    this._studentId = prev;
    console.log('合并学员完成，共', merged.length, '人');
  },

  deleteStudent(id) {
    const prev = this._studentId;
    this._studentId = null;
    const targetId = String(id);
    const students = this.getStudents().filter(s => String(s.id) !== targetId);
    this.save('students', students);
    // 1) 删除该学员所有按 id 隔离的本地键（学习进度/错题本/作业/每日/听写/扫描等，含历史遗留键）
    const prefix = 'vocab_s' + targetId + '_';
    const dropKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(prefix) === 0) dropKeys.push(k);
    }
    dropKeys.forEach(k => localStorage.removeItem(k));
    // 2) 从全局（跨学员、条目带 studentId）列表中剔除该学员记录
    const cleanGlobal = (key) => {
      const list = this.load(key, []);
      const kept = list.filter(x => x && String(x.studentId) !== targetId);
      if (kept.length !== list.length) this.save(key, kept);
    };
    ['weekWrongs', 'practiceExtra', 'practicePending', 'practiceArchive'].forEach(cleanGlobal);
    this._studentId = prev;
    this.exportBackup();
  },

  // 删除学员后，把删除动作持久化到全局队列（离线删除时保留，连线后由 app.js 补发到电脑/云端）
  addPendingStudentRemoval(name, grade) {
    const prev = this._studentId;
    this._studentId = null;
    try {
      const list = this.load('pendingStudentRemovals', []);
      if (!Array.isArray(list)) { this._studentId = prev; return; }
      const exists = list.some(r => r && String(r.name) === String(name) && String(r.grade) === String(grade));
      if (!exists) {
        list.push({ name: String(name), grade: String(grade), at: new Date().toISOString() });
        this.save('pendingStudentRemovals', list);
      }
    } catch (e) {}
    this._studentId = prev;
  },

  getPendingStudentRemovals() {
    const prev = this._studentId;
    this._studentId = null;
    const list = this.load('pendingStudentRemovals', []);
    this._studentId = prev;
    return Array.isArray(list) ? list : [];
  },

  clearPendingStudentRemovals(removed) {
    const prev = this._studentId;
    this._studentId = null;
    try {
      const done = removed || [];
      const set = {};
      done.forEach(r => { if (r) set[String(r.name) + '|' + String(r.grade)] = true; });
      const list = this.load('pendingStudentRemovals', []).filter(r => !(r && set[String(r.name) + '|' + String(r.grade)]));
      this.save('pendingStudentRemovals', list);
    } catch (e) {}
    this._studentId = prev;
  },

  saveScanWorks(studentId, list) {
    const prev = this._studentId;
    this._studentId = studentId;
    this.save('scanWorks', list);
    this._studentId = prev;
  },

  getScanWorks(studentId) {
    const prev = this._studentId;
    this._studentId = studentId;
    const list = this.load('scanWorks', []);
    this._studentId = prev;
    return Array.isArray(list) ? list : [];
  },

  saveWrongQuestions(studentId, list) {
    const prev = this._studentId;
    this._studentId = studentId;
    this.save('wrongQuestions', list);
    this._studentId = prev;
  },

  getWrongQuestions(studentId) {
    const prev = this._studentId;
    this._studentId = studentId;
    const list = this.load('wrongQuestions', []);
    this._studentId = prev;
    return Array.isArray(list) ? list : [];
  },

  getWeekWrongs() {
    const prev = this._studentId;
    this._studentId = null;
    const list = this.load('weekWrongs', []);
    this._studentId = prev;
    return Array.isArray(list) ? list : [];
  },

  getPublicWrongs() {
    const prev = this._studentId;
    this._studentId = null;
    const list = this.load('publicWrongBank', []);
    this._studentId = prev;
    return Array.isArray(list) ? list : [];
  },

  savePublicWrongs(list) {
    const prev = this._studentId;
    this._studentId = null;
    this.save('publicWrongBank', Array.isArray(list) ? list : []);
    this._studentId = prev;
  },

  getJsCache(name) {
    return localStorage.getItem('vocab_cache_js_' + name);
  },

  getJsCacheHash(name) {
    return localStorage.getItem('vocab_cache_js_hash_' + name) || '';
  },

  setJsCache(name, code, hash) {
    localStorage.setItem('vocab_cache_js_' + name, code);
    localStorage.setItem('vocab_cache_js_hash_' + name, hash || '');
  },

  getApkInfo() {
    try { return JSON.parse(localStorage.getItem('vocab_apk_info') || 'null'); } catch (e) { return null; }
  },

  setApkInfo(info) {
    localStorage.setItem('vocab_apk_info', JSON.stringify(info || null));
  },

  addWeekWrong(studentId, subject, text) {
    const prev = this._studentId;
    this._studentId = null;
    const list = this.load('weekWrongs', []);
    let id = Date.now();
    while (list.some(w => w.id === id)) id++;
    const item = { id: id, studentId: String(studentId), subject: subject, text: text, createdAt: new Date().toISOString() };
    list.push(item);
    this.save('weekWrongs', list);
    this._studentId = prev;
    return item;
  },

  removeWeekWrongs(ids) {
    const prev = this._studentId;
    this._studentId = null;
    const set = {};
    ids.forEach(i => { set[i] = true; });
    this.save('weekWrongs', this.load('weekWrongs', []).filter(w => !set[w.id]));
    this._studentId = prev;
  },

  markWeekWrongPracticed(id) {
    const prev = this._studentId;
    this._studentId = null;
    const list = this.load('weekWrongs', []);
    const w = list.find(x => x.id === id);
    if (w && !w.pracGen) { w.pracGen = true; this.save('weekWrongs', list); }
    this._studentId = prev;
    return !!w;
  },

  clearWeekWrongPracticed(id) {
    const prev = this._studentId;
    this._studentId = null;
    const list = this.load('weekWrongs', []);
    const w = list.find(x => x.id === id);
    if (w && w.pracGen) { w.pracGen = false; this.save('weekWrongs', list); }
    this._studentId = prev;
    return !!w;
  },

  addWeekWrongsFromGen(srcId, studentId, subject, items) {
    const prev = this._studentId;
    this._studentId = null;
    const list = this.load('weekWrongs', []);
    let n = 0;
    (items || []).forEach(it => {
      if (!it || !it.text) return;
      let id = Date.now() + Math.floor(Math.random() * 10000);
      while (list.some(w => w.id === id)) id++;
      list.push({
        id: id, studentId: String(studentId), subject: subject, text: it.text,
        kind: it.kind || '加练', srcId: srcId, note: it.note || '', answer: it.answer || '',
        createdAt: new Date().toISOString()
      });
      n++;
    });
    this.save('weekWrongs', list);
    this._studentId = prev;
    return n;
  },

  clearWeekWrongs() {
    const prev = this._studentId;
    this._studentId = null;
    this.save('weekWrongs', []);
    this._studentId = prev;
  },

  archiveWeekWrongs() {
    const prev = this._studentId;
    this._studentId = null;
    const list = this.load('weekWrongs', []);
    const byStudent = {};
    list.forEach(w => {
      const sid = String(w.studentId);
      (byStudent[sid] = byStudent[sid] || []).push(w);
    });
    let archived = 0;
    Object.keys(byStudent).forEach(sid => {
      this._studentId = sid;
      const wrongs = this.load('wrongQuestions', []);
      const seen = {};
      wrongs.forEach(w => { seen[w.id] = true; });
      byStudent[sid].forEach(w => {
        if (seen[w.id]) return;
        wrongs.push({ id: w.id, subject: w.subject, text: w.text, createdAt: w.createdAt });
        archived++;
      });
      this.save('wrongQuestions', wrongs);
    });
    this._studentId = null;
    this.save('weekWrongs', []);
    this._studentId = prev;
    return archived;
  },

  archiveWeekWrongsByIds(ids) {
    const prev = this._studentId;
    this._studentId = null;
    const set = {};
    (ids || []).forEach(i => { set[i] = true; });
    const list = this.load('weekWrongs', []);
    const byStudent = {};
    list.forEach(w => {
      if (!set[w.id]) return;
      const sid = String(w.studentId);
      (byStudent[sid] = byStudent[sid] || []).push(w);
    });
    let archived = 0;
    Object.keys(byStudent).forEach(sid => {
      this._studentId = sid;
      const wrongs = this.load('wrongQuestions', []);
      const seen = {};
      wrongs.forEach(w => { seen[w.id] = true; });
      byStudent[sid].forEach(w => {
        if (seen[w.id]) return;
        wrongs.push({ id: w.id, subject: w.subject, text: w.text, createdAt: w.createdAt });
        archived++;
      });
      this.save('wrongQuestions', wrongs);
    });
    this._studentId = null;
    this.save('weekWrongs', list.filter(w => !set[w.id]));
    this._studentId = prev;
    return archived;
  },

  getPracticeExtra() {
    const prev = this._studentId;
    this._studentId = null;
    const list = this.load('practiceExtra', []);
    this._studentId = prev;
    return Array.isArray(list) ? list : [];
  },

  addPracticeExtra(studentId, subject, items) {
    const prev = this._studentId;
    this._studentId = null;
    const list = this.load('practiceExtra', []);
    items.forEach(it => {
      let id = Date.now();
      while (list.some(x => x.id === id)) id++;
      list.push({ id: id, studentId: String(studentId), subject: subject, text: it.text, kind: it.kind || '加练', note: it.note || '', source: it.source || '', createdAt: new Date().toISOString() });
    });
    this.save('practiceExtra', list);
    this._studentId = prev;
    return items.length;
  },

  removePracticeExtra(ids) {
    const prev = this._studentId;
    this._studentId = null;
    const set = {};
    ids.forEach(i => { set[i] = true; });
    this.save('practiceExtra', this.load('practiceExtra', []).filter(x => !set[x.id]));
    this._studentId = prev;
  },

  getPendingPractice() {
    const prev = this._studentId;
    this._studentId = null;
    const list = this.load('practicePending', []);
    this._studentId = prev;
    return Array.isArray(list) ? list : [];
  },

  addPendingPractice(studentId, subject, items) {
    const prev = this._studentId;
    this._studentId = null;
    const list = this.load('practicePending', []);
    items.forEach(it => {
      let id = Date.now();
      while (list.some(x => x.id === id)) id++;
      list.push({ id: id, studentId: String(studentId), subject: subject, text: it.text, kind: it.kind || '加练', note: it.note || '', answer: it.answer || '', source: it.source || '', createdAt: new Date().toISOString() });
    });
    this.save('practicePending', list);
    this._studentId = prev;
    return items.length;
  },

  removePendingPractice(ids) {
    const prev = this._studentId;
    this._studentId = null;
    const set = {};
    ids.forEach(i => { set[i] = true; });
    this.save('practicePending', this.load('practicePending', []).filter(x => !set[x.id]));
    this._studentId = prev;
  },

  confirmPractice(id) {
    const prev = this._studentId;
    this._studentId = null;
    const pend = this.load('practicePending', []);
    const idx = pend.findIndex(x => x.id === id);
    if (idx < 0) { this._studentId = prev; return false; }
    const it = pend[idx];
    pend.splice(idx, 1);
    const list = this.load('practiceExtra', []);
    list.push(it);
    this.save('practicePending', pend);
    this.save('practiceExtra', list);
    this._studentId = prev;
    return true;
  },

  archivePracticeExtra() {
    const prev = this._studentId;
    this._studentId = null;
    const list = this.load('practiceExtra', []);
    const arch = this.load('practiceArchive', []);
    const seen = {};
    arch.forEach(x => { seen[x.id] = true; });
    let moved = 0;
    list.forEach(x => {
      if (seen[x.id]) return;
      seen[x.id] = true;
      arch.push(Object.assign({}, x, { archivedAt: new Date().toISOString() }));
      moved++;
    });
    this.save('practiceArchive', arch);
    this.save('practiceExtra', []);
    this._studentId = prev;
    return moved;
  },

  getPracticeArchive() {
    const prev = this._studentId;
    this._studentId = null;
    const list = this.load('practiceArchive', []);
    this._studentId = prev;
    return Array.isArray(list) ? list : [];
  },

  removePracticeArchive(ids) {
    const prev = this._studentId;
    this._studentId = null;
    const set = {};
    ids.forEach(i => { set[i] = true; });
    this.save('practiceArchive', this.load('practiceArchive', []).filter(x => !set[x.id]));
    this._studentId = prev;
  },

  getOcrConfig() {
    const over = this.getOcrOverride();
    if (over) return over;
    return { apiKey: BAIDU_OCR_API_KEY, secretKey: BAIDU_OCR_SECRET_KEY };
  },

  getOcrOverride() {
    try {
      const over = JSON.parse(localStorage.getItem('vocab_ocr_config'));
      if (over && over.apiKey && over.secretKey) return { apiKey: over.apiKey, secretKey: over.secretKey };
    } catch (e) {}
    return null;
  },

  clearOcrOverride() {
    localStorage.removeItem('vocab_ocr_config');
    this.scheduleBackup();
  },

  saveOcrConfig(cfg) {
    localStorage.setItem('vocab_ocr_config', JSON.stringify(cfg));
    this.scheduleBackup();
  },

  getCloudTopic() {
    return CLOUD_URL;
  },

  getTransportMode() {
    return localStorage.getItem('vocab_transport_mode') || 'lan';
  },

  setTransportMode(mode) {
    localStorage.setItem('vocab_transport_mode', mode === 'cloud' ? 'cloud' : 'lan');
  },

  getReportTopic() {
    return 'https://ntfy.sh/pjyx-report-' + INSTALL_CODE.toLowerCase();
  },

  getTaskTopic() {
    return 'https://ntfy.sh/pjyx-task-' + INSTALL_CODE.toLowerCase();
  },

  getAnswerTopic() {
    return 'https://ntfy.sh/pjyx-answer-' + INSTALL_CODE.toLowerCase();
  },

  getCodesTopic() {
    return 'https://ntfy.sh/pjyx-install-' + INSTALL_CODE.toLowerCase();
  },

  getClaimsTopic() {
    return 'https://ntfy.sh/pjyx-claim-' + INSTALL_CODE.toLowerCase();
  },

  getTeacherTasks() {
    const list = this.load('teacherTasks', []);
    return Array.isArray(list) ? list : [];
  },

  saveTeacherTasks(list) {
    this.save('teacherTasks', Array.isArray(list) ? list : []);
  },

  getAdminGrades() {
    try {
      const arr = JSON.parse(localStorage.getItem('vocab_admin_grades'));
      if (Array.isArray(arr) && arr.length) return arr.map(String);
    } catch (e) {}
    const legacy = localStorage.getItem('vocab_admin_grade') || '';
    if (legacy === 'all' || legacy === '') return [];
    return [String(legacy)];
  },

  setAdminGrades(list) {
    const arr = Array.isArray(list) ? list.map(String).filter(Boolean) : [];
    localStorage.setItem('vocab_admin_grades', JSON.stringify(arr));
    localStorage.removeItem('vocab_admin_grade');
  },

  buildReport() {
    const progress = this.getProgress();
    const sessions = this.getSessions();
    const sid = this.getStudent();
    const student = (this.getStudents() || []).find(s => s.id === sid) || {};
    let stars = 0;
    const ls = progress.lessonStars || {};
    Object.keys(ls).forEach(k => { stars += ls[k] || 0; });
    let practiceSec = 0;
    const completed = (sessions || []).filter(s => s.completed);
    completed.forEach(s => { practiceSec += s.duration || 0; });
    const wrongs = this.getWrongQuestions(sid);

    const subjects = ['english', 'chinese', 'math'];
    const subjectNames = { english: '英语', chinese: '语文', math: '数学' };
    const subjectStats = {};
    subjects.forEach(sub => {
      const subSessions = completed.filter(s => s.subject === sub);
      let subSec = 0;
      let subCorrect = 0, subWrong = 0, subTotal = 0;
      let subStars = 0, subXp = 0;
      const subTypes = {};
      subSessions.forEach(s => {
        subSec += s.duration || 0;
        subCorrect += s.correctCount || 0;
        subWrong += s.wrongCount || 0;
        subTotal += s.totalItems || 0;
        subStars += s.stars || 0;
        subXp += s.xp || 0;
        const t = s.type || 'other';
        if (!subTypes[t]) subTypes[t] = { count: 0, correct: 0, wrong: 0, minutes: 0 };
        subTypes[t].count++;
        subTypes[t].correct += s.correctCount || 0;
        subTypes[t].wrong += s.wrongCount || 0;
        subTypes[t].minutes += Math.round((s.duration || 0) / 60);
      });
      subjectStats[sub] = {
        name: subjectNames[sub],
        sessions: subSessions.length,
        minutes: Math.round(subSec / 60),
        correct: subCorrect,
        wrong: subWrong,
        total: subTotal,
        accuracy: subTotal > 0 ? Math.round((subCorrect / subTotal) * 100) : 0,
        stars: subStars,
        xp: subXp,
        types: subTypes
      };
    });
    const subWrongs = { english: 0, chinese: 0, math: 0 };
    (wrongs || []).forEach(w => {
      const sub = w.subject || 'english';
      if (subWrongs.hasOwnProperty(sub)) subWrongs[sub]++;
      else subWrongs.english++;
    });

    return {
      deviceId: this.getDeviceId() || 'unknown',
      name: student.name || '未知学员',
      grade: this.getCurrentGrade(student),
      updatedAt: new Date().toISOString(),
      stats: {
        xp: progress.totalXP || 0,
        level: progress.level || 1,
        stars: stars,
        lessons: Object.keys(progress.completedLessons || {}).length,
        wordsLearned: progress.wordsLearned || 0,
        streak: progress.streak || 0,
        lastPractice: progress.lastPracticeDate || '',
        minutes: Math.round(practiceSec / 60),
        wrongs: wrongs.length,
        history: completed.length,
        subjects: subjectStats,
        subjectWrongs: subWrongs
      }
    };
  },

  saveHomework(studentId, homework) {
    const prev = this._studentId;
    this._studentId = studentId;
    this.save('homework', homework);
    this._studentId = prev;
  },

  getHomework(studentId) {
    const prev = this._studentId;
    this._studentId = studentId;
    const hw = this.load('homework', null);
    this._studentId = prev;
    return hw;
  },

  saveHomeworkZh(studentId, homework) {
    const prev = this._studentId;
    this._studentId = studentId;
    this.save('homework_zh', homework);
    this._studentId = prev;
  },

  getHomeworkZh(studentId) {
    const prev = this._studentId;
    this._studentId = studentId;
    const hw = this.load('homework_zh', null);
    this._studentId = prev;
    return hw;
  },

  saveHomeworkMath(studentId, homework) {
    const prev = this._studentId;
    this._studentId = studentId;
    this.save('homework_math', homework);
    this._studentId = prev;
  },

  getHomeworkMath(studentId) {
    const prev = this._studentId;
    this._studentId = studentId;
    const hw = this.load('homework_math', null);
    this._studentId = prev;
    return hw;
  },

  saveDailyProgress(studentId, progress) {
    const prev = this._studentId;
    this._studentId = studentId;
    this.save('daily', progress);
    this._studentId = prev;
  },

  getDailyProgress(studentId) {
    const prev = this._studentId;
    this._studentId = studentId;
    const p = this.load('daily', null);
    this._studentId = prev;
    return p;
  },

  loginStudent(id) {
    this._studentId = id;
  },

  logout() {
    this._studentId = null;
  },

  getProgress() {
    return this.load('progress', {
      completedLessons: {},
      lessonStars: {},
      totalXP: 0,
      streak: 0,
      lastPracticeDate: null,
      hearts: 5,
      level: 1,
      wordsLearned: 0
    });
  },

  saveProgress(progress) {
    this.save('progress', progress);
  },

  markLessonComplete(lessonId, stars) {
    const progress = this.getProgress();
    const key = String(lessonId);
    progress.completedLessons[key] = true;
    const prev = progress.lessonStars[key] || 0;
    progress.lessonStars[key] = Math.max(prev, stars);
    progress.totalXP += stars * 10;
    progress.wordsLearned = Object.keys(progress.completedLessons).length * 6;
    progress.lastPracticeDate = new Date().toDateString();
    const today = new Date().toDateString();
    const prevDate = this.load('lastStreakDate', '');
    if (prevDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      progress.streak = (prevDate === yesterday) ? progress.streak + 1 : 1;
      this.save('lastStreakDate', today);
    }
    progress.level = Math.floor(progress.totalXP / 100) + 1;
    this.saveProgress(progress);
  },

  loseHeart() {
    const progress = this.getProgress();
    if (progress.hearts > 0) {
      progress.hearts--;
      this.saveProgress(progress);
    }
    return progress.hearts;
  },

  resetHearts() {
    const progress = this.getProgress();
    progress.hearts = 5;
    this.saveProgress(progress);
  },

  getLearnedWordIds() {
    return this.load('learnedWords', []);
  },

  addLearnedWords(wordIds) {
    const learned = this.getLearnedWordIds();
    for (const id of wordIds) {
      if (!learned.includes(id)) learned.push(id);
    }
    this.save('learnedWords', learned);
  },

  getSessions() {
    return this.load('sessions', []);
  },

  startSession(type, unitId, unitTitle, gradeTitle, meta) {
    const session = {
      id: Date.now(),
      type: type,
      subject: meta.subject || 'english',
      unitId: unitId,
      unitTitle: unitTitle,
      gradeTitle: gradeTitle,
      startTime: new Date().toISOString(),
      endTime: null,
      duration: 0,
      completed: false,
      totalItems: meta.totalItems || 0,
      correctCount: 0,
      accuracy: 0,
      stars: meta.stars || 0,
      xp: meta.xp || 0
    };
    const sessions = this.getSessions();
    sessions.unshift(session);
    this.save('sessions', sessions);
    return session.id;
  },

  endSession(sessionId, results) {
    const sessions = this.getSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      session.endTime = new Date().toISOString();
      session.duration = Math.round((new Date(session.endTime) - new Date(session.startTime)) / 1000);
      session.completed = true;
      session.correctCount = results.correctCount || 0;
      session.wrongCount = results.wrongCount != null ? results.wrongCount : 0;
      session.accuracy = results.accuracy || 0;
      session.stars = results.stars || 0;
      session.xp = results.xp || 0;
      session.totalItems = results.totalItems || session.totalItems;
      session.initialWrong = results.initialWrong || 0;
      session.remainingWrong = results.remainingWrong != null ? results.remainingWrong : -1;
      this.save('sessions', sessions);
    }
  },

  abortSession(sessionId) {
    const sessions = this.getSessions();
    const idx = sessions.findIndex(s => s.id === sessionId);
    if (idx >= 0) {
      sessions.splice(idx, 1);
      this.save('sessions', sessions);
    }
  },

  getWrongWords() {
    const list = this.load('wrongWords', []);
    const clean = list.filter(w => w && typeof w.wordEn === 'string' && w.wordEn && typeof w.wordCn === 'string' && w.wordCn);
    if (clean.length !== list.length) this.save('wrongWords', clean);
    return clean;
  },

  addWrongWord(wordEn, wordCn, unitId, unitTitle, subject) {
    wordEn = String(wordEn == null ? '' : wordEn).trim();
    wordCn = String(wordCn == null ? '' : wordCn).trim();
    if (!wordEn || !wordCn) return;
    subject = subject == null || String(subject).trim() === '' ? 'english' : String(subject).trim();
    const list = this.getWrongWords();
    const existing = list.find(w => w.wordEn === wordEn);
    if (existing) {
      existing.missedCount = (existing.missedCount || 1) + 1;
      existing.lastMissed = new Date().toISOString();
      if (subject !== 'english' || !existing.subject) existing.subject = subject;
    } else {
      list.push({
        wordEn: wordEn,
        wordCn: wordCn,
        unitId: unitId,
        unitTitle: unitTitle,
        subject: subject,
        missedCount: 1,
        lastMissed: new Date().toISOString()
      });
    }
    this.save('wrongWords', list);
  },

  removeWrongWord(wordEn) {
    const list = this.getWrongWords().filter(w => w.wordEn !== wordEn);
    this.save('wrongWords', list);
  },

  clearWrongWords() {
    this.save('wrongWords', []);
  },

  getAdminPassword() {
    return 'admin888';
  },

  setAdminPassword(newPw) {
    localStorage.setItem('vocab_admin_pw', newPw);
    this.scheduleBackup();
  },

  getInviteCodes() {
    const raw = localStorage.getItem('vocab_invite_codes');
    return raw ? JSON.parse(raw) : [];
  },

  saveInviteCodes(list) {
    localStorage.setItem('vocab_invite_codes', JSON.stringify(list));
    this.scheduleBackup();
  },

  generateInviteCodes(count) {
    const list = this.getInviteCodes();
    for (let i = 0; i < count; i++) {
      const code = 'PJ' + Math.random().toString(36).substring(2, 8).toUpperCase();
      list.push({ code, used: false, usedBy: '', usedAt: '' });
    }
    this.saveInviteCodes(list);
    return list;
  },

  checkInviteCode(code) {
    const list = this.getInviteCodes();
    const entry = list.find(c => c.code === code);
    return entry && !entry.used;
  },

  useInviteCode(code, studentName) {
    const list = this.getInviteCodes();
    const entry = list.find(c => c.code === code);
    if (entry && !entry.used) {
      entry.used = true;
      entry.usedBy = studentName;
      entry.usedAt = new Date().toISOString();
      this.saveInviteCodes(list);
      return true;
    }
    return false;
  },

  deleteInviteCode(code) {
    const list = this.getInviteCodes().filter(c => c.code !== code);
    this.saveInviteCodes(list);
  },

  getAllStudentsData() {
    const outer = this._studentId;
    this._studentId = null;
    const students = this.getStudents();
    const result = students.map(s => {
      const prev = this._studentId;
      this._studentId = s.id;
      const progress = this.getProgress();
      const sessions = this.getSessions();
      this._studentId = prev;
      return { student: s, progress, sessions };
    });
    this._studentId = outer;
    return result;
  },

  // 只读当前地点学员的完整数据（进度/会话），与 getAllStudentsData 同构但按本地点过滤。
  // 管理后台"学员汇总/未练习"用此隔离各点名单；超级密码登录时用 getAllStudentsData 看全部点。
  getSiteStudentsData() {
    const outer = this._studentId;
    this._studentId = null;
    const students = this.getSiteStudents();
    const result = students.map(s => {
      const prev = this._studentId;
      this._studentId = s.id;
      const progress = this.getProgress();
      const sessions = this.getSessions();
      this._studentId = prev;
      return { student: s, progress, sessions };
    });
    this._studentId = outer;
    return result;
  },

  getStudentData(studentId) {
    const prev = this._studentId;
    this._studentId = studentId;
    const progress = this.getProgress();
    const sessions = this.getSessions();
    this._studentId = prev;
    return { progress, sessions };
  }
};
window.__OK_storage = true;
