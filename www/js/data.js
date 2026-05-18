/**
 * 项目管理 - 数据层
 * IndexedDB 持久化存储 + 导出导入
 */

const DB_NAME = 'pm_app';
const DB_VERSION = 1;

// -------- 打开数据库 ---------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('project')) {
        db.createObjectStore('project', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('phases')) {
        const ps = db.createObjectStore('phases', { keyPath: 'id', autoIncrement: true });
        ps.createIndex('sortOrder', 'sortOrder');
      }
      if (!db.objectStoreNames.contains('dayLogs')) {
        db.createObjectStore('dayLogs', { keyPath: 'date' });
      }
      if (!db.objectStoreNames.contains('photos')) {
        const pstore = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
        pstore.createIndex('category', 'category');
        pstore.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('recordings')) {
        const rstore = db.createObjectStore('recordings', { keyPath: 'id', autoIncrement: true });
        rstore.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('rework')) {
        const rw = db.createObjectStore('rework', { keyPath: 'id', autoIncrement: true });
        rw.createIndex('status', 'status');
        rw.createIndex('deadline', 'deadline');
      }
      if (!db.objectStoreNames.contains('milestones')) {
        db.createObjectStore('milestones', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('materials')) {
        db.createObjectStore('materials', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('attendance')) {
        db.createObjectStore('attendance', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// -------- 通用 CRUD ---------
async function dbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(storeName, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbGetByIndex(storeName, indexName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).index(indexName).getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbClear(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// -------- 项目（多项目支持） ---------
// currentProjectId 存在 localStorage
function getCurrentProjectId() {
  return localStorage.getItem('pm_current_project') || 'main';
}
function setCurrentProjectId(id) {
  localStorage.setItem('pm_current_project', id);
}

async function getProject(projectId) {
  const id = projectId || getCurrentProjectId();
  const p = await dbGet('project', id);
  return p || null;
}

async function saveProject(data) {
  return dbPut('project', { ...data, id: data.id || getCurrentProjectId() });
}

async function getAllProjects() {
  return dbGetAll('project');
}

async function createProject(name, startDate, totalDays) {
  const id = 'proj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const p = { id, name: name || '新项目', startDate: startDate || getToday(), totalDays: totalDays || 70, createdAt: new Date().toISOString() };
  await dbPut('project', p);
  return p;
}

async function deleteProject(id) {
  // 删除项目相关所有数据
  const allProj = await dbGetAll('project');
  const allPhotos = await getAllPhotos();
  for (const item of allPhotos.filter(x => x.projectId === id)) await dbDelete('photos', item.id);
  const allRecs = await getAllRecordings();
  for (const item of allRecs.filter(x => x.projectId === id)) await dbDelete('recordings', item.id);
  const allReworks = await getAllRework();
  for (const item of allReworks.filter(x => x.projectId === id)) await dbDelete('rework', item.id);
  const allPhases = await getPhases();
  for (const item of allPhases.filter(x => x.projectId === id)) await deletePhase(item.id);
  const allLogs = await getAllDayLogs();
  for (const item of allLogs.filter(x => x.projectId === id)) await dbDelete('dayLogs', item.date);

  // 从 project 存储中移除（可靠方式）
  const remaining = allProj.filter(p => p.id !== id);
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('project', 'readwrite');
    const store = tx.objectStore('project');
    store.clear();
    for (const item of remaining) store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  if (getCurrentProjectId() === id) setCurrentProjectId(remaining.length > 0 ? remaining[0].id : '');
}

// -------- 施工阶段（按项目） ---------
async function getPhases(projectId) {
  const all = await dbGetAll('phases');
  const pid = projectId || getCurrentProjectId();
  return all.filter(p => (p.projectId || 'main') === pid);
}

async function savePhase(phase) {
  if (!phase.projectId) phase.projectId = getCurrentProjectId();
  return dbPut('phases', phase);
}

async function deletePhase(id) {
  // 改用 "读全部→筛除→覆盖" 方式，避免 IndexedDB delete 在某些环境失效
  const all = await dbGetAll('phases');
  const filtered = all.filter(p => String(p.id) !== String(id));
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('phases', 'readwrite');
    const store = tx.objectStore('phases');
    // 清空
    store.clear();
    // 重新写入（排除删除项）
    for (const item of filtered) store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// -------- 每日日志（按项目） ---------
async function getDayLog(date, projectId) {
  const pid = projectId || getCurrentProjectId();
  return dbGet('dayLogs', pid + '_' + date);
}

async function saveDayLog(log, rawDate) {
  const pid = log.projectId || getCurrentProjectId();
  // rawDate 是纯日期（如 "2026-05-18"），用于构造 key
  const pureDate = rawDate || getToday();
  const key = pid + '_' + pureDate;
  return dbPut('dayLogs', { ...log, projectId: pid, date: key, _rawDate: pureDate });
}

async function getAllDayLogs(projectId) {
  const all = await dbGetAll('dayLogs');
  const pid = projectId || getCurrentProjectId();
  return all.filter(l => l.projectId === pid);
}

// -------- 照片（按项目） ---------
async function savePhoto(photo) {
  const pid = photo.projectId || getCurrentProjectId();
  return dbPut('photos', { ...photo, projectId: pid, date: photo.date || getToday() });
}

async function getPhotosByCategory(category, projectId) {
  const all = await dbGetByIndex('photos', 'category', category);
  const pid = projectId || getCurrentProjectId();
  return all.filter(p => (p.projectId || 'main') === pid);
}

async function getAllPhotos(projectId) {
  const all = await dbGetAll('photos');
  const pid = projectId || getCurrentProjectId();
  return all.filter(p => (p.projectId || 'main') === pid);
}

async function deletePhoto(id) {
  return dbDelete('photos', id);
}

// -------- 录音（按项目） ---------
async function saveRecording(rec) {
  const pid = rec.projectId || getCurrentProjectId();
  return dbPut('recordings', { ...rec, projectId: pid, date: rec.date || getToday() });
}

async function getAllRecordings(projectId) {
  const all = await dbGetAll('recordings');
  const pid = projectId || getCurrentProjectId();
  return all.filter(r => (r.projectId || 'main') === pid);
}

async function deleteRecording(id) {
  return dbDelete('recordings', id);
}

// -------- 返工（按项目） ---------
async function saveRework(item) {
  const pid = item.projectId || getCurrentProjectId();
  return dbPut('rework', { ...item, projectId: pid });
}

async function getAllRework(projectId) {
  const all = await dbGetAll('rework');
  if (projectId) return all.filter(r => r.projectId === projectId);
  return all; // 不过滤，返回全部
}

async function getReworkByStatus(status, projectId) {
  const all = await dbGetByIndex('rework', 'status', status);
  const pid = projectId || getCurrentProjectId();
  return all.filter(r => (r.projectId || 'main') === pid);
}

async function deleteRework(id) {
  // 先检查数据是否存在
  const all = await dbGetAll('rework');
  const before = all.length;
  const target = all.find(r => String(r.id) === String(id));

  if (!target) { console.log('deleteRework: 未找到 id=' + id); return; }

  // 使用原生 delete，但确保事务完整提交
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('rework', 'readwrite');
    const store = tx.objectStore('rework');
    const req = store.delete(id);
    req.onsuccess = () => { console.log('deleteRework: 成功删除 id=' + id); };
    req.onerror = () => { console.log('deleteRework: 删除失败', req.error); };
    tx.oncomplete = () => { console.log('deleteRework: 事务完成'); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

// -------- 里程碑 ---------
async function getMilestones(projectId) {
  const all = await dbGetAll('milestones');
  const pid = projectId || getCurrentProjectId();
  return all.filter(m => (m.projectId || 'main') === pid);
}
async function saveMilestone(m) {
  if (!m.projectId) m.projectId = getCurrentProjectId();
  return dbPut('milestones', m);
}
async function deleteMilestone(id) { return dbDelete('milestones', id); }

// -------- 材料 ---------
async function getMaterials(projectId) {
  const all = await dbGetAll('materials');
  const pid = projectId || getCurrentProjectId();
  return all.filter(m => (m.projectId || 'main') === pid);
}
async function saveMaterial(m) {
  if (!m.projectId) m.projectId = getCurrentProjectId();
  return dbPut('materials', m);
}
async function deleteMaterial(id) { return dbDelete('materials', id); }

// -------- 考勤 ---------
async function getAttendance(projectId) {
  const all = await dbGetAll('attendance');
  const pid = projectId || getCurrentProjectId();
  return all.filter(a => (a.projectId || 'main') === pid);
}
async function saveAttendance(a) {
  if (!a.projectId) a.projectId = getCurrentProjectId();
  return dbPut('attendance', a);
}

// -------- 工具函数 ---------
function getToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.getMonth()+1 + '/' + d.getDate();
}

// 短日期 5/28 格式
function formatDateShort(dateStr) {
  if (!dateStr) return '?';
  const d = new Date(dateStr);
  return (d.getMonth()+1) + '/' + d.getDate();
}

// 完整日期 2026/05/28 格式
function formatDateFull(dateStr) {
  if (!dateStr) return '?';
  const d = new Date(dateStr);
  return d.getFullYear() + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + String(d.getDate()).padStart(2,'0');
}

// 中文日期 5月28日 格式
function formatDateCN(dateStr) {
  if (!dateStr) return '?';
  const d = new Date(dateStr);
  return (d.getMonth()+1) + '月' + d.getDate() + '日';
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function daysBetween(start, end) {
  const s = new Date(start), e = new Date(end);
  return Math.round((e - s) / (1000*60*60*24));
}

// -------- 导出/导入 ---------
async function exportAllData(projectId) {
  const pid = projectId || getCurrentProjectId();
  const data = {
    version: 2,
    exportedAt: new Date().toISOString(),
    projects: await dbGetAll('project'),
    project: await dbGet('project', pid),
    phases: await getPhases(pid),
    dayLogs: await getAllDayLogs(pid),
    photos: await getAllPhotos(pid),
    recordings: await getAllRecordings(pid),
    rework: await getAllRework(pid),
    milestones: await getMilestones(pid),
    materials: await getMaterials(pid),
    attendance: await getAttendance(pid),
    exportedProjectId: pid,
  };
  return data;
}

async function importAllData(data) {
  // 清空旧数据
  const stores = ['project','phases','dayLogs','photos','recordings','rework','milestones','materials','attendance'];
  for (const s of stores) await dbClear(s);

  // 导入新数据
  if (data.project) await dbPut('project', data.project);
  if (data.phases) for (const p of data.phases) await dbPut('phases', p);
  if (data.dayLogs) for (const d of data.dayLogs) await dbPut('dayLogs', d);
  if (data.photos) for (const p of data.photos) await dbPut('photos', p);
  if (data.recordings) for (const r of data.recordings) await dbPut('recordings', r);
  if (data.rework) for (const r of data.rework) await dbPut('rework', r);
  if (data.milestones) for (const m of data.milestones) await dbPut('milestones', m);
  if (data.materials) for (const m of data.materials) await dbPut('materials', m);
  if (data.attendance) for (const a of data.attendance) await dbPut('attendance', a);
}

async function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function readJSONFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { try { resolve(JSON.parse(r.result)); } catch(e) { reject(e); } };
    r.onerror = reject;
    r.readAsText(file);
  });
}

// -------- 甘特图计算 ---------
function calcPlannedProgress(project, phases, dateStr) {
  if (!project || !phases.length) return 0;
  const dayIndex = daysBetween(project.startDate, dateStr) + 1;
  if (dayIndex < 1) return 0;
  if (dayIndex > project.totalDays) return 100;
  return Math.round((dayIndex / project.totalDays) * 100);
}

function calcActualProgress(dayLogs, project) {
  if (!project) return 0;
  let total = 0, count = 0;
  for (const key in dayLogs) {
    const log = dayLogs[key];
    if (log.progress != null) { total += log.progress; count++; }
  }
  return count > 0 ? Math.round(total / count) : 0;
}

// -------- 水印工具 ---------
function addWatermark(imageDataUrl, text) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);

      // 右下角水印
      ctx.font = `${Math.max(14, img.width * 0.03)}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';

      // 背景
      const tw = ctx.measureText(text).width + 20;
      const th = parseInt(ctx.font) + 16;
      const x = img.width - 10, y = img.height - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - tw, y - th, tw + 10, th + 10);

      // 文字
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(text, x + 5, y - 5);

      // 日期
      ctx.font = `${Math.max(10, img.width * 0.02)}px sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(getToday(), x + 5, y - th + parseInt(ctx.font) + 4);

      resolve(c.toDataURL('image/jpeg', 0.9));
    };
    img.src = imageDataUrl;
  });
}
