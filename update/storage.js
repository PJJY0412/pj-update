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

  getStudents() {
    const prev = this._studentId;
    this._studentId = null;
    const list = this.load('students', []);
    this._studentId = prev;
    return list;
  },

  addStudent(name, grade) {
    const prev = this._studentId;
    this._studentId = null;
    const students = this.getStudents();
    if (students.find(s => s.name === name)) { this._studentId = prev; return null; }
    const student = {
      id: Date.now(),
      name: name,
      grade: grade || 1,
      gradeStartYear: new Date().getFullYear(),
      createdAt: new Date().toISOString()
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
    const yearsPassed = now.getFullYear() - (student.gradeStartYear || (student.createdAt ? new Date(student.createdAt).getFullYear() : now.getFullYear()));
    if (now > cutoff) return Math.min(6, base + Math.max(0, yearsPassed));
    return Math.min(6, base + Math.max(0, yearsPassed - 1));
  },

  getSubject() {
    return localStorage.getItem('vocab_subject') || 'english';
  },

  setSubject(subject) {
    localStorage.setItem('vocab_subject', subject);
    this.scheduleBackup();
  },

  findStudent(name) {
    var list = this.getStudents();
    console.log('findStudent: name=' + name + ' count=' + list.length + ' students=' + JSON.stringify(list.map(function(s){return s.name;})));
    return list.find(s => s.name === name) || null;
  },

  deleteStudent(id) {
    const prev = this._studentId;
    this._studentId = null;
    const students = this.getStudents().filter(s => s.id !== id);
    this.save('students', students);
    const keys = ['progress', 'sessions', 'learnedWords', 'lastStreakDate', 'homework', 'homework_zh', 'homework_math', 'daily', 'scanWorks', 'wrongQuestions'];
    const oldId = id;
    keys.forEach(k => {
      localStorage.removeItem('vocab_s' + oldId + '_' + k);
    });
    this._studentId = prev;
    this.exportBackup();
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
        history: completed.length
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

  addWrongWord(wordEn, wordCn, unitId, unitTitle) {
    wordEn = String(wordEn == null ? '' : wordEn).trim();
    wordCn = String(wordCn == null ? '' : wordCn).trim();
    if (!wordEn || !wordCn) return;
    const list = this.getWrongWords();
    const existing = list.find(w => w.wordEn === wordEn);
    if (existing) {
      existing.missedCount = (existing.missedCount || 1) + 1;
      existing.lastMissed = new Date().toISOString();
    } else {
      list.push({
        wordEn: wordEn,
        wordCn: wordCn,
        unitId: unitId,
        unitTitle: unitTitle,
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
window.__SERVER_VER = '20260814-1580';
