/**
 * 项目管理 - 主应用逻辑
 */

// ====== 全局状态 ======
let currentPanel = 'dashboard';
let currentDay = getToday();
let currentPhotoTab = 'all';
let currentReworkTab = 'in-progress';
let recordingMediaRecorder = null;
let recordingChunks = [];
let recordingTimer = null;
let recordingSeconds = 0;
let cameraCallback = null; // 拍照回调

// ====== 初始化 ======
document.addEventListener('DOMContentLoaded', async () => {
  await initApp();
});

// 点击仪表盘施工阶段 → 跳转计划页面
document.addEventListener('click', e => {
  const phase = e.target.closest('.clickable-phase');
  if (phase) switchPanel('planning');
});

async function initApp() {
  // 恢复上次使用的项目
  const projects = await getAllProjects();
  const currentId = getCurrentProjectId();
  let project = projects.find(p => p.id === currentId);
  if (!project && projects.length > 0) {
    project = projects[0];
    setCurrentProjectId(project.id);
  }

  document.getElementById('planName').value = project ? project.name || '' : '';
  if (project) {
    document.getElementById('planStartDate').value = project.startDate || getToday();
    document.getElementById('planTotalDays').value = project.totalDays || 70;
  }
  updateProjectEndDate();

  // 更新今天日期 + 每天自动刷新
  currentDay = getToday();
  updateHeaderDate();

  // 每分钟刷新一次日期（跨天自动更新）
  setInterval(() => {
    const newToday = getToday();
    if (newToday !== currentDay) {
      currentDay = newToday;
      updateHeaderDate();
      if (currentPanel === 'daily') refreshDaily();
    }
  }, 60000);

  // 先显示项目列表
  switchPanel('projects');
}

// ===================================================================
// 项目列表
// ===================================================================
async function refreshProjectList() {
  const projects = await getAllProjects();
  const currentId = getCurrentProjectId();
  const container = document.getElementById('projectList');

  if (!projects || projects.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><p>暂无项目，点击上方新建</p></div>';
    return;
  }

  container.innerHTML = projects.map(p => {
    const isActive = p.id === currentId;
    const isCompleted = p.completed;
    const daysElapsed = p.startDate ? daysBetween(p.startDate, getToday()) + 1 : 0;
    const progress = isCompleted ? 100 : (p.totalDays > 0 ? Math.round(Math.min(100, (daysElapsed / p.totalDays) * 100)) : 0);
    const remaining = Math.max(0, p.totalDays - daysElapsed);
    const status = isCompleted ? '✅' : (remaining <= 0 ? '✅' : daysElapsed > 0 ? '🔄' : '⏳');

    return `<div class="card" style="cursor:pointer;${isActive ? 'border-color:var(--primary);' : ''} ${isCompleted ? 'opacity:0.85;' : ''}" onclick="openProject('${p.id}')">
      <div class="flex-between mb-8">
        <span style="font-size:16px;font-weight:600;">${p.name} ${isCompleted ? '✅ 已竣工' : ''}</span>
        <span style="font-size:12px;">${isActive ? '● 当前' : ''}</span>
      </div>
      <div style="font-size:13px;color:var(--text-dim);margin-bottom:8px;">
        ${p.startDate} · 共${p.totalDays}天 · ${isCompleted ? '已竣工' : '剩余' + remaining + '天'}
      </div>
      <div class="progress-bar" style="margin-bottom:4px;">
        <div class="progress-fill ${isCompleted ? 'green' : (progress >= 100 ? 'green' : 'yellow')}" style="width:${isCompleted ? 100 : progress}%;"></div>
      </div>
      <div class="flex-between">
        <span style="font-size:12px;color:var(--text-dim);">${status} ${isCompleted ? '已竣工 (100%)' : '进度 ' + progress + '%'}</span>
        <div>
          <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();switchProject('${p.id}')">进入</button>
          <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteProjectConfirm('${p.id}','${p.name}')" style="margin-left:4px;">×</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function showNewProjectForm() {
  document.getElementById('newProjName').value = '';
  document.getElementById('newProjStart').value = getToday();
  document.getElementById('newProjDays').value = '70';
  openModal('newProjectModal');
  // 聚焦名称输入框
  setTimeout(() => document.getElementById('newProjName').focus(), 300);
}

async function confirmNewProject() {
  const name = document.getElementById('newProjName').value.trim();
  const startDate = document.getElementById('newProjStart').value;
  const days = parseInt(document.getElementById('newProjDays').value);
  if (!name) { showToast('⚠️ 请输入项目名称'); return; }
  if (!startDate) { showToast('⚠️ 请选择开工日期'); return; }
  if (!days || days < 1) { showToast('⚠️ 请输入有效工期'); return; }

  const p = await createProject(name, startDate, days);
  setCurrentProjectId(p.id);
  closeModal('newProjectModal');
  refreshProjectList();
  document.getElementById('headerTitle').textContent = p.name;
  showToast('✅ 项目已创建: ' + name);
  // 自动进入仪表盘
  switchPanel('dashboard');
}

async function switchProject(id) {
  setCurrentProjectId(id);
  const p = await getProject(id);
  if (p) document.getElementById('headerTitle').textContent = p.name;
  // 切换到仪表盘
  switchPanel('dashboard');
  showToast('已切换到: ' + p.name);
}

async function openProject(id) {
  // 点击卡片直接进入
  if (id === getCurrentProjectId()) {
    switchPanel('dashboard');
  } else {
    await switchProject(id);
  }
}

async function deleteProjectConfirm(id, name) {
  if (!confirm('确定删除项目「' + name + '」及其所有数据？（不可恢复）')) return;
  await deleteProject(id);
  const current = getCurrentProjectId();
  const p = await getProject(current);
  document.getElementById('headerTitle').textContent = p ? p.name : '项目列表';
  // 如果在竣工面板，重置显示
  if (currentPanel === 'completion') refreshCompletion();
  refreshProjectList();
  showToast('✅ 已删除');
}

// 智能返回：有项目回仪表盘，无项目回列表
function goBack() {
  getProject().then(p => {
    switchPanel(p ? 'dashboard' : 'projects');
  });
}

// 顶部日期显示
function updateHeaderDate() {
  const d = new Date();
  const weekDays = ['日','一','二','三','四','五','六'];
  const el = document.getElementById('headerDate');
  if (el) {
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    el.textContent = `${m}/${day} 周${weekDays[d.getDay()]}`;
  }
}

function refreshAll() {
  refreshProjectList();
  refreshDashboard();
  refreshDaily();
  refreshPhotos();
  refreshRework();
  refreshPlanning();
  refreshRecordings();
  updatePhotoCounts();
  updateHeaderStatus();
}

// ====== Toast ======
let toastTimer;

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ====== 导航 ======
function switchPanel(name) {
  if (name === 'more') return;
  // 隐藏所有面板
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('panel-' + name);
  if (target) target.classList.add('active');

  // 更新导航高亮
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navBtn = document.querySelector(`.nav-item[data-panel="${name}"]`);
  if (navBtn) navBtn.classList.add('active');

  currentPanel = name;

  // 底部导航：仅列表页和设置页隐藏
  const appEl = document.getElementById('app');
  if (name === 'projects' || name === 'settings') {
    appEl.classList.add('no-project');
  } else {
    appEl.classList.remove('no-project');
  }

  // 更新顶部标题
  const titleEl = document.getElementById('headerTitle');
  if (name === 'projects') {
    titleEl.textContent = '项目列表';
  } else if (name === 'completion') {
    titleEl.textContent = '竣工总览';
  } else {
    getProject().then(p => { if (p) titleEl.textContent = p.name; });
  }

  // 刷新对应面板
  if (name === 'projects') refreshProjectList();
  else if (name === 'dashboard') refreshDashboard();
  else if (name === 'daily') refreshDaily();
  else if (name === 'photos') refreshPhotos();
  else if (name === 'rework') refreshRework();
  else if (name === 'planning') refreshPlanning();
  else if (name === 'recording') refreshRecordings();
  else if (name === 'report') { /* 按需生成 */ }
  else if (name === 'completion') refreshCompletion();
  else if (name === 'settings') updatePhotoCounts();

  // 关闭抽屉
  closeDrawer();
}

function toggleDrawer() {
  const d = document.getElementById('drawer');
  const o = document.getElementById('drawerOverlay');
  d.classList.toggle('open');
  o.classList.toggle('open');
}

function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawerOverlay').classList.remove('open');
}

// ====== 弹窗 ======
function openModal(id) { document.getElementById(id).classList.add('open'); }

function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ====== 顶部栏状态 ======
async function updateHeaderStatus() {
  const project = await getProject();
  const reworks = await getAllRework();
  const delayed = reworks.filter(r => r.status !== 'resolved' && r.deadline && r.deadline < getToday());
  const openReworks = reworks.filter(r => r.status !== 'resolved');

  const el = document.getElementById('headerStatus');
  if (delayed.length > 0) {
    el.textContent = `⚠ ${delayed.length}项超期`;
    el.className = 'header-status status-danger';
  } else if (openReworks.length > 0) {
    el.textContent = `● ${openReworks.length}项待处理`;
    el.className = 'header-status status-warn';
  } else {
    el.textContent = '✓ 正常';
    el.className = 'header-status status-healthy';
  }
}

// ===================================================================
// 仪表盘
// ===================================================================
async function refreshDashboard(reworks) {
  const project = await getProject();
  if (!project) {
    document.querySelectorAll('#panel-dashboard .card').forEach(c => c.style.display = 'none');
    document.getElementById('dashProgress').textContent = '—';
    document.getElementById('dashDayCount').textContent = '—';
    return;
  }
  document.querySelectorAll('#panel-dashboard .card').forEach(c => c.style.display = '');
  const allLogs = await getAllDayLogs();
  const phases = await getPhases();
  if (!reworks) reworks = await getAllRework();
  // 兼容旧数据
  reworks.forEach(r => { if (r.status === 'open') r.status = 'in-progress'; });
  const todayLog = await getDayLog(getToday());

  const daysElapsed = daysBetween(project.startDate, getToday()) + 1;
  const total = project.totalDays || 70;
  const clampedDays = Math.max(0, Math.min(daysElapsed, total));
  const progress = total > 0 ? Math.round((clampedDays / total) * 100) : 0;

  // 实际平均进度
  let actualProgress = 0;
  if (allLogs.length > 0) {
    const sum = allLogs.reduce((a, l) => a + (l.progress || 0), 0);
    actualProgress = Math.round(sum / allLogs.length);
  }

  const openReworks = reworks.filter(r => r.status !== 'resolved');

  document.getElementById('dashProgress').textContent = actualProgress + '%';
  document.getElementById('dashProgress').className = 'metric-value ' + (actualProgress >= progress ? 'text-green' : 'text-yellow');
  document.getElementById('dashDayCount').textContent = `${clampedDays}/${total}`;
  document.getElementById('dashRemain').textContent = Math.max(0, total - clampedDays);
  document.getElementById('dashDelayed').textContent = openReworks.length;
  document.getElementById('dashDelayed').className = 'metric-value ' + (openReworks.length > 0 ? 'text-red' : '');

  // 时间进度条
  document.getElementById('dashTimeProgressFill').style.width = progress + '%';
  document.getElementById('dashTimeProgressLabel').textContent = progress + '%';
  if (project.startDate) {
    document.getElementById('dashStartDate').textContent = '开始: ' + formatDateCN(project.startDate);
    const endDate = addDays(project.startDate, total - 1);
    document.getElementById('dashEndDate').textContent = '结束: ' + formatDateCN(endDate);
  }

  // 进度曲线
  drawProgressChart(project, allLogs);

  // 施工阶段（含实际日期）
  const phaseHtml = phases.length > 0 ? phases.map(p => {
    const pStart = Math.max(1, p.startDay);
    const pEnd = Math.min(total, p.endDay);
    const pTotal = pEnd - pStart + 1;
    const pProgress = pTotal > 0 ? Math.round((Math.max(0, clampedDays - pStart + 1) / pTotal) * 100) : 0;
    const sDate = formatDateShort(addDays(project.startDate, p.startDay - 1));
    const eDate = formatDateShort(addDays(project.startDate, p.endDay - 1));
    return `<div class="flex-between mb-8 clickable-phase" style="font-size:13px;cursor:pointer;">
      <span style="display:flex;align-items:center;gap:6px;">
        <span style="width:10px;height:10px;border-radius:3px;background:${p.color};display:inline-block;"></span>
        ${p.name}
      </span>
      <span class="text-dim" style="font-size:11px;">${sDate}~${eDate} <span class="${pProgress >= 100 ? 'text-green' : 'text-dim'}">${Math.min(100,pProgress)}%</span></span>
    </div>`;
  }).join('') : '<div class="empty-state"><p>暂无施工阶段，请前往"计划"设置</p></div>';
  document.getElementById('dashPhases').innerHTML = phaseHtml;

  // 跟进概览
  renderDailyOverview(project, allLogs, todayLog);

  // 待处理返工（整块可点击跳转）
  const openList = reworks.filter(r => r.status !== 'resolved').slice(0, 5);
  const dashReworkEl = document.getElementById('dashRework');
  dashReworkEl.style.cursor = 'pointer';
  dashReworkEl.onclick = () => jumpToRework();
  dashReworkEl.innerHTML = openList.length > 0 ?
    openList.map(r => `<div class="flex-between" style="font-size:13px;padding:6px 0;border-bottom:1px solid var(--border);">
      <span>${r.description ? r.description.slice(0, 20) : '未描述'}${r.description && r.description.length > 20 ? '…' : ''}</span>
      <span class="${r.deadline && r.deadline < getToday() ? 'text-red' : 'text-dim'}" style="font-size:12px;">${r.deadline || '无期限'}</span>
    </div>`) :
    '<div style="font-size:13px;color:var(--text-dim);">暂无待处理返工</div>';

  // 今日纪要
  document.getElementById('dashToday').textContent = todayLog ?
    (todayLog.notes || '暂无记录') :
    '今日尚未记录';

  // 甘特图
  const milestones = await getMilestones();
  const sortedPhases = phases.sort((a, b) => (a.sortOrder || a.startDay) - (b.sortOrder || b.startDay));
  renderGantt(project, sortedPhases, milestones, allLogs);
}

// ====== 跟进概览（仪表盘） ======
function renderDailyOverview(project, allLogs, todayLog) {
  const el = document.getElementById('dashDailyOverview');
  if (!el) return;
  const today = getToday();
  const weekDays = ['日','一','二','三','四','五','六'];

  // dayLogs 的 date 是 "projectId_yyyy-mm-dd"，提取纯日期比较
  function logDateMatch(log, dateStr) {
    return log.date === dateStr || log.date.endsWith('_' + dateStr);
  }

  // 最近7天热力条
  let heatHtml = '<div style="margin-bottom:10px;">';
  heatHtml += '<div style="display:flex;gap:4px;justify-content:space-between;margin-bottom:4px;">';
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const dayStr = String(d.getDate()).padStart(2,'0');
    const weekStr = weekDays[d.getDay()];
    const log = allLogs.find(l => logDateMatch(l, dateStr));
    const isFuture = dateStr > today;
    const dot = isFuture ? '○' : (log ? '●' : '○');
    const color = isFuture ? 'var(--text-dim)' : (log ? 'var(--green)' : 'var(--red)');
    heatHtml += `<div style="text-align:center;flex:1;">
      <div style="font-size:18px;color:${color};">${dot}</div>
      <div style="font-size:10px;color:var(--text-dim);">${dayStr}</div>
      <div style="font-size:9px;color:var(--text-dim);">周${weekStr}</div>
    </div>`;
  }
  heatHtml += '</div></div>';

  // 昨天摘要
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesStr = yesterday.toISOString().split('T')[0];
  const yesLog = allLogs.find(l => logDateMatch(l, yesStr));
  let summaryHtml = '';
  if (yesLog) {
    const done = (yesLog.actualTasks || []).map(t => '✅ ' + t).join(' ');
    summaryHtml += `<div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;line-height:1.6;">
      <span class="text-dim">昨日(${formatDateShort(yesStr)}):</span> ${done || '未记录'} ${yesLog.workers ? '| 出工' + yesLog.workers + '人' : ''}
    </div>`;
  }

  // 今天计划
  if (todayLog) {
    const planned = (todayLog.plannedTasks || []).filter(t => !t.done).map(t => '□ ' + t.text).join(' ');
    summaryHtml += `<div style="font-size:12px;color:var(--text-dim);line-height:1.6;">
      <span class="text-dim">今日(${formatDateShort(today)}):</span> ${planned || '暂无计划'}
    </div>`;
  } else {
    summaryHtml += `<div style="font-size:12px;color:var(--text-dim);">今日(${formatDateShort(today)}): 尚未跟进</div>`;
  }

  // 统计
  const totalPlanned = allLogs.reduce((s, l) => s + (l.plannedTasks || []).length, 0);
  const totalDone = allLogs.reduce((s, l) => s + (l.actualTasks || []).length, 0);
  const daysWithData = allLogs.length;
  const startDate = project.startDate;
  const totalDays = project.totalDays || 70;
  const elapsed = Math.min(daysBetween(startDate, today) + 1, totalDays);
  const trackedRate = elapsed > 0 ? Math.min(100, Math.round((daysWithData / elapsed) * 100)) : 0;

  el.innerHTML = `
    ${heatHtml}
    ${summaryHtml}
    <div style="font-size:11px;color:var(--text-dim);margin-top:6px;padding-top:6px;border-top:1px solid var(--border);display:flex;justify-content:space-between;">
      <span>📝 计划${totalPlanned}项 · 完成${totalDone}项</span>
      <span>📊 跟进率${trackedRate}% (${daysWithData}/${elapsed}天)</span>
    </div>
  `;
}

// ====== 进度曲线图 ======
async function drawProgressChart(project, allLogs) {
  const canvas = document.getElementById('progressCanvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const pad = { top: 10, bottom: 20, left: 35, right: 10 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  const totalDays = project.totalDays || 70;
  const daysElapsed = Math.min(daysBetween(project.startDate, getToday()), totalDays);

  // 网格
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (ch / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText((100 - i * 25) + '%', pad.left - 5, y + 4);
  }

  if (totalDays <= 0) return;

  // 计划曲线（直线）
  ctx.strokeStyle = 'rgba(59,130,246,0.6)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + ch);
  ctx.lineTo(pad.left + cw, pad.top);
  ctx.stroke();
  ctx.setLineDash([]);

  // 计划标注
  ctx.fillStyle = 'rgba(91,127,165,0.8)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('— 计划', w - pad.right - 60, pad.top + 14);

  // 实际进度曲线
  if (allLogs.length > 0) {
    // 按日期排序
    const sorted = allLogs.sort((a, b) => a.date.localeCompare(b.date));
    ctx.strokeStyle = '#53d769';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    let first = true;
    for (const log of sorted) {
      const dayIdx = daysBetween(project.startDate, log.date);
      if (dayIdx < 0 || dayIdx > totalDays) continue;
      const x = pad.left + (dayIdx / totalDays) * cw;
      const y = pad.top + ch - (Math.min(100, log.progress || 0) / 100) * ch;
      if (first) { ctx.moveTo(x, y);
        first = false; } else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 实际标注
    ctx.fillStyle = '#53d769';
    ctx.font = '10px sans-serif';
    ctx.fillText('— 实际', w - pad.right - 60, pad.top + 28);

    // 当前点
    if (daysElapsed >= 0 && daysElapsed <= totalDays) {
      const cx = pad.left + (daysElapsed / totalDays) * cw;
      const lastLog = sorted[sorted.length - 1];
      const cy = pad.top + ch - (Math.min(100, lastLog ? lastLog.progress || 0 : 0) / 100) * ch;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#53d769';
      ctx.fill();
    }
  }
}

// ===================================================================
// 每日跟进
// ===================================================================
async function refreshDaily() {
  const project = await getProject();
  if (!project) { showToast('⚠️ 请先选择项目'); switchPanel('projects'); return; }
  const log = await getDayLog(currentDay) || { date: currentDay, plannedTasks: [], actualTasks: [], notes: '', progress: 0, workers: '', weather: '晴' };

  const dayIndex = daysBetween(project.startDate, currentDay) + 1;
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  const d = new Date(currentDay);
  const weekStr = weekDays[d.getDay()];

  document.getElementById('dailyDate').textContent = currentDay;
  document.getElementById('dailyWeek').textContent = `第${dayIndex}天 周${weekStr}`;

  // 现场信息
  document.getElementById('dailyWorkers').value = log.workers || '';
  document.getElementById('dailyWeather').value = log.weather || '晴';

  // 计划任务
  const planned = log.plannedTasks || [];
  document.getElementById('dailyPlannedTasks').innerHTML = planned.map((t, i) =>
    `<div class="todo-item">
      <input type="checkbox" style="width:18px;height:18px;accent-color:var(--green);margin-top:1px;" ${t.done ? 'checked' : ''} onchange="toggleDailyPlannedTask(${i})">
      <span class="todo-text ${t.done ? 'done' : ''}">${t.text}</span>
      <span style="color:var(--red);font-size:16px;cursor:pointer;" onclick="removeDailyPlannedTask(${i})">×</span>
    </div>`
  ).join('') || '<div class="text-dim" style="font-size:13px;padding:8px 0;">暂无计划任务</div>';

  // 完成任务
  const actual = log.actualTasks || [];
  document.getElementById('dailyActualTasks').innerHTML = actual.map((t, i) =>
    `<div class="todo-item">
      <span class="text-green" style="font-size:16px;">✓</span>
      <span class="todo-text">${t}</span>
      <span style="color:var(--red);font-size:16px;cursor:pointer;" onclick="removeDailyActualTask(${i})">×</span>
    </div>`
  ).join('') || '<div class="text-dim" style="font-size:13px;padding:8px 0;">暂无完成记录</div>';

  // 现场记录
  document.getElementById('dailyNotes').value = log.notes || '';

  // 照片
  const photos = await getPhotosByCategory('daily');
  const dailyPhotos = photos.filter(p => p.date === currentDay);
  document.getElementById('dailyPhotos').innerHTML = dailyPhotos.map(p =>
    `<div class="photo-item"><img src="${p.data}" onclick="previewImage('${p.data}')"><button class="photo-del" onclick="deletePhotoById(${p.id})">×</button></div>`
  ).join('') || '<div class="text-dim" style="font-size:13px;">暂无照片</div>';
}

async function saveDailyLog() {
  const log = await getDayLog(currentDay) || {};
  log.plannedTasks = log.plannedTasks || [];
  log.actualTasks = log.actualTasks || [];
  log.notes = document.getElementById('dailyNotes').value;
  log.progress = 100; // 每日跟进完成即代表当天工作完成
  log.workers = document.getElementById('dailyWorkers').value;
  log.weather = document.getElementById('dailyWeather').value;
  await saveDayLog(log, currentDay);
  showToast('✅ 已保存 ' + currentDay);
  refreshAll();
}

function changeDay(offset) {
  const d = new Date(currentDay);
  d.setDate(d.getDate() + offset);
  currentDay = d.toISOString().split('T')[0];
  refreshDaily();
}

function jumpToToday() {
  currentDay = getToday();
  refreshDaily();
}

function updateDailyProgress(val) {
  document.getElementById('dailyProgressFill').style.width = val + '%';
  document.getElementById('dailyProgressLabel').textContent = val + '%';
}

function saveDailyField() {
  // 自动保存到内存中，保存按钮负责写入DB
}

function addDailyPlannedTask() {
  const text = prompt('请输入计划任务：');
  if (!text) return;
  getDayLog(currentDay).then(log => {
    log = log || { date: currentDay, plannedTasks: [], actualTasks: [] };
    log.plannedTasks = log.plannedTasks || [];
    log.plannedTasks.push({ text, done: false });
    return saveDayLog(log);
  }).then(() => refreshDaily());
}

function toggleDailyPlannedTask(idx) {
  getDayLog(currentDay).then(log => {
    if (!log || !log.plannedTasks) return;
    log.plannedTasks[idx].done = !log.plannedTasks[idx].done;
    return saveDayLog(log);
  }).then(() => refreshDaily());
}

function removeDailyPlannedTask(idx) {
  if (!confirm('删除此计划任务？')) return;
  getDayLog(currentDay).then(log => {
    if (!log || !log.plannedTasks) return;
    log.plannedTasks.splice(idx, 1);
    return saveDayLog(log);
  }).then(() => refreshDaily());
}

function addDailyActualTask() {
  const text = prompt('请输入已完成的工作：');
  if (!text) return;
  getDayLog(currentDay).then(log => {
    log = log || { date: currentDay, plannedTasks: [], actualTasks: [] };
    log.actualTasks = log.actualTasks || [];
    log.actualTasks.push(text);
    return saveDayLog(log);
  }).then(() => refreshDaily());
}

function removeDailyActualTask(idx) {
  if (!confirm('删除此完成记录？')) return;
  getDayLog(currentDay).then(log => {
    if (!log || !log.actualTasks) return;
    log.actualTasks.splice(idx, 1);
    return saveDayLog(log);
  }).then(() => refreshDaily());
}

// ===================================================================
// 照片（影像日志）
// ===================================================================
async function refreshPhotos() {
  const project = await getProject();
  if (!project) { switchPanel('projects'); return; }
  const allPhotos = await getAllPhotos();
  // 读取临时存储的筛选类别
  const filtered = currentPhotoTab === 'all' ? allPhotos : allPhotos.filter(p => p.category === currentPhotoTab);
  const grid = document.getElementById('photoGrid');

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">📸</div><p>暂无照片</p></div>';
    return;
  }

  grid.innerHTML = filtered.sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(p =>
    `<div class="photo-item">
      <img src="${p.data}" onclick="previewImage('${p.data}')">
      <button class="photo-del" onclick="deletePhotoById(${p.id})">×</button>
      <div class="photo-cat">${getCategoryLabel(p.category)} ${p.date || ''}</div>
    </div>`
  ).join('');
}

function switchPhotoTab(cat) {
  currentPhotoTab = cat;
  document.querySelectorAll('#photoTabs .tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`#photoTabs .tab[data-cat="${cat}"]`).classList.add('active');
  refreshPhotos();
}

function getCategoryLabel(cat) {
  const map = { daily: '📋施工', rework: '🔧返工', meeting: '📞会议' };
  return map[cat] || cat;
}

function showPhotoCategoryMenu() {
  openModal('photoCategoryModal');
}

// ====== 拍照 ======
function takePhoto(category) {
  cameraCallback = category;
  const input = document.getElementById('cameraInput');
  // 支持 capture 属性 — 手机上直接打开相机
  input.setAttribute('capture', 'environment');
  input.value = '';
  input.click();
}

async function handlePhotoCapture(event) {
  const file = event.target.files[0];
  if (!file || !cameraCallback) return;

  const category = cameraCallback;
  const reader = new FileReader();
  reader.onload = async function(e) {
    const dataUrl = e.target.result;

    // 加水印
    const catLabel = getCategoryLabel(category);
    const watermarked = await addWatermark(dataUrl, catLabel + ' ' + getToday());

    await savePhoto({
      data: watermarked,
      category: category,
      date: getToday(),
      originalName: file.name
    });

    showToast('✅ 照片已保存（' + catLabel + '）');
    cameraCallback = null;
    refreshAll();
  };
  reader.readAsDataURL(file);
}

function previewImage(src) {
  document.getElementById('imagePreviewImg').src = src;
  document.getElementById('imagePreview').classList.add('open');
}

function closeImagePreview() {
  document.getElementById('imagePreview').classList.remove('open');
}

async function deletePhotoById(id) {
  if (!confirm('删除此照片？')) return;
  await deletePhoto(id);
  showToast('已删除');
  refreshAll();
}

async function updatePhotoCounts() {
  const all = await getAllPhotos();
  const daily = all.filter(p => p.category === 'daily').length;
  const rework = all.filter(p => p.category === 'rework').length;
  const meeting = all.filter(p => p.category === 'meeting').length;
  const recs = await getAllRecordings();
  document.getElementById('photoCount_daily').textContent = daily;
  document.getElementById('photoCount_rework').textContent = rework;
  document.getElementById('photoCount_meeting').textContent = meeting;
  document.getElementById('recordingCount').textContent = recs.length;
}

// ===================================================================
// 录音
// ===================================================================
async function refreshRecordings() {
  const project = await getProject();
  if (!project) { switchPanel('projects'); return; }
  const recs = await getAllRecordings();
  const list = document.getElementById('recordingList');
  if (recs.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">🎙️</div><p>暂无录音记录</p></div>';
    return;
  }
  list.innerHTML = recs.sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(r =>
    `<div class="recording-item">
      <span>🎙️</span>
      <div style="flex:1;">
        <div style="font-size:14px;">${r.title || '未命名录音'}</div>
        <div style="font-size:12px;color:var(--text-dim);">${r.date} · ${r.duration || '0:00'}${r.summary ? ' · 已总结' : ''}</div>
      </div>
      <div class="btn-group">
        ${r.data ? `<button class="btn btn-sm btn-secondary" onclick="playRecording('${r.id}')">▶</button>` : ''}
        <button class="btn btn-sm btn-secondary" onclick="summarizeRecording(${r.id})">AI总结</button>
        <button class="btn btn-sm btn-danger" onclick="deleteRecordingById(${r.id})">×</button>
      </div>
    </div>`
  ).join('');
}

async function toggleRecording() {
  if (recordingMediaRecorder && recordingMediaRecorder.state === 'recording') {
    stopRecording();
    return;
  }
  startRecording();
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingMediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    recordingChunks = [];
    recordingSeconds = 0;

    recordingMediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) recordingChunks.push(e.data);
    };

    recordingMediaRecorder.onstop = async () => {
      const blob = new Blob(recordingChunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onload = async function(e) {
        const title = prompt('录音名称：', currentDay + ' 会议') || '录音';
        await saveRecording({
          data: e.target.result,
          title: title,
          duration: formatTime(recordingSeconds),
          date: getToday(),
          summary: ''
        });
        showToast('✅ 录音已保存');
        refreshRecordings();
      };
      reader.readAsDataURL(blob);
      stream.getTracks().forEach(t => t.stop());
    };

    recordingMediaRecorder.start();
    document.getElementById('recordBtn').classList.add('recording');
    document.getElementById('recordBtn').textContent = '■';
    document.getElementById('recorderStatus').textContent = '录音中…';

    recordingTimer = setInterval(() => {
      recordingSeconds++;
      document.getElementById('recorderTime').textContent = formatTime(recordingSeconds);
    }, 1000);

  } catch (err) {
    showToast('❌ 无法访问麦克风: ' + err.message);
  }
}

function stopRecording() {
  if (recordingMediaRecorder && recordingMediaRecorder.state === 'recording') {
    recordingMediaRecorder.stop();
  }
  document.getElementById('recordBtn').classList.remove('recording');
  document.getElementById('recordBtn').textContent = '●';
  document.getElementById('recorderStatus').textContent = '录音已结束';
  clearInterval(recordingTimer);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function playRecording(id) {
  getAllRecordings().then(recs => {
    const rec = recs.find(r => r.id == id);
    if (!rec || !rec.data) return;
    const audio = new Audio(rec.data);
    audio.play();
  });
}

async function deleteRecordingById(id) {
  if (!confirm('删除此录音？')) return;
  await deleteRecording(id);
  refreshRecordings();
}

// ====== AI 录音总结 ======
async function summarizeRecording(id) {
  const useAI = confirm('是否连接外部API进行AI总结？\n\n确认=调用AI\n取消=手动输入总结');
  const recs = await getAllRecordings();
  const rec = recs.find(r => r.id == id);
  if (!rec) return;

  if (useAI) {
    // 调用外部AI API
    const apiKey = prompt('请输入 API Key（留空使用环境变量）：');
    const summary = await callAISummary(rec.data, apiKey);
    if (summary) {
      rec.summary = summary;
      await saveRecording(rec);
      showToast('✅ AI总结完成');
      refreshRecordings();
    }
  } else {
    const summary = prompt('输入总结内容：');
    if (summary) {
      rec.summary = summary;
      await saveRecording(rec);
      refreshRecordings();
    }
  }
}

async function callAISummary(audioDataUrl, apiKey) {
  try {
    // 先尝试用 Web Speech API 做语音识别
    // 由于浏览器限制，用 whsiper API 方案
    const key = apiKey || '';
    if (!key) {
      showToast('⚠️ 需要API Key才能AI总结');
      return prompt('手动输入总结内容：') || '';
    }

    // 将 base64 转为 blob
    const fetchResp = await fetch(audioDataUrl);
    const audioBlob = await fetchResp.blob();

    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    formData.append('model', 'whisper-1');

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key },
      body: formData
    });

    if (!resp.ok) {
      showToast('❌ API调用失败: ' + resp.status);
      return prompt('手动输入总结内容：') || '';
    }

    const data = await resp.json();
    const transcript = data.text || '';

    // 用第二次调用做总结（或用 prompt 让 whisper 直接总结）
    const summaryResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: '你是一个会议记录助手。将以下会议录音转写内容总结为要点清单，简明扼要。' },
          { role: 'user', content: transcript }
        ]
      })
    });

    if (!summaryResp.ok) {
      showToast('⚠️ 转写成功但总结失败，返回原文');
      return transcript;
    }

    const summaryData = await summaryResp.json();
    return summaryData.choices[0].message.content;

  } catch (err) {
    showToast('❌ AI总结失败: ' + err.message);
    return prompt('手动输入总结内容：') || '';
  }
}

// ===================================================================
// 返工管理
// ===================================================================
async function refreshRework() {
  const project = await getProject();
  if (!project) { switchPanel('projects'); return; }
  const all = await getAllRework();
  // 兼容旧数据：open 状态视为 in-progress
  const normalized = all.map(r => {
    if (r.status === 'open') r.status = 'in-progress';
    return r;
  });
  const filtered = normalized.filter(r => {
    if (currentReworkTab === 'in-progress') return r.status === 'in-progress';
    if (currentReworkTab === 'resolved') return r.status === 'resolved';
    return true;
  });

  // 先更新标签高亮（必须在 return 之前）
  document.querySelectorAll('#reworkTabs .tab').forEach(t => t.classList.remove('active'));
  const tabIdx = { 'in-progress': 0, 'resolved': 1 }[currentReworkTab] || 0;
  const tabs = document.querySelectorAll('#reworkTabs .tab');
  if (tabs[tabIdx]) tabs[tabIdx].classList.add('active');

  const list = document.getElementById('reworkList');
  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><p>暂无记录</p></div>';
    return;
  }

  list.innerHTML = filtered.sort((a, b) => a.id - b.id).reverse().map(r => {
    const isOverdue = r.deadline && r.deadline < getToday() && r.status !== 'resolved';
    const sevClass = r.severity === 'high' ? 'severe' : '';
    const doneClass = r.status === 'resolved' ? 'done' : '';
    const statusMap = { 'in-progress': '整改中', 'resolved': '整改完' };
    const statusClass = { 'in-progress': 'in-progress', 'resolved': 'resolved' };

    return `<div class="rework-card ${sevClass} ${doneClass}" onclick="showReworkDetail(${r.id})">
      <div class="flex-between mb-8">
        <span class="rework-status ${statusClass[r.status] || 'in-progress'}">${statusMap[r.status] || r.status}</span>
        ${isOverdue ? '<span class="text-red" style="font-size:12px;">⚠ 已超期</span>' : ''}
      </div>
      <div style="font-size:14px;font-weight:500;margin-bottom:4px;">${r.description || '未描述'}</div>
      <div style="font-size:12px;color:var(--text-dim);">
        ${r.location ? '📍 ' + r.location : ''} ${r.deadline ? '📅 ' + r.deadline : ''} ${r.assignee ? '👤 ' + r.assignee : ''}
      </div>
    </div>`;
  }).join('');
}

function switchReworkTab(tab) {
  currentReworkTab = tab;
  refreshRework();
}

function showReworkForm() {
  document.getElementById('reworkFormId').value = '';
  document.getElementById('reworkFormDesc').value = '';
  document.getElementById('reworkFormLocation').value = '';
  document.getElementById('reworkFormSeverity').value = 'medium';
  document.getElementById('reworkFormDeadline').value = '';
  document.getElementById('reworkFormAssignee').value = '';
  document.getElementById('reworkFormPhotos').innerHTML = '';
  openModal('reworkModal');
}

function editReworkForm(id) {
  getAllRework().then(all => {
    const r = all.find(x => x.id == id);
    if (!r) return;
    document.getElementById('reworkFormId').value = r.id;
    document.getElementById('reworkFormDesc').value = r.description || '';
    document.getElementById('reworkFormLocation').value = r.location || '';
    document.getElementById('reworkFormSeverity').value = r.severity || 'medium';
    document.getElementById('reworkFormDeadline').value = r.deadline || '';
    document.getElementById('reworkFormAssignee').value = r.assignee || '';
    // 照片
    const photos = r.photos || [];
    document.getElementById('reworkFormPhotos').innerHTML = photos.map(p =>
      `<div class="photo-item"><img src="${p}" style="width:100%;height:100%;object-fit:cover;"></div>`
    ).join('');
    openModal('reworkModal');
  });
}

async function saveReworkForm() {
  const id = document.getElementById('reworkFormId').value;
  const item = id ? (await getReworkById(id)) || {} : {};

  item.description = document.getElementById('reworkFormDesc').value;
  item.location = document.getElementById('reworkFormLocation').value;
  item.severity = document.getElementById('reworkFormSeverity').value;
  item.deadline = document.getElementById('reworkFormDeadline').value;
  item.assignee = document.getElementById('reworkFormAssignee').value;
  item.status = item.status || 'in-progress';
  item.photos = item.photos || [];

  if (!item.description) { showToast('⚠️ 请填写问题描述'); return; }

  await saveRework(item);
  closeModal('reworkModal');
  showToast('✅ 返工记录已保存');
  refreshAll();
}

async function deleteReworkForm() {
  const id = document.getElementById('reworkFormId').value;
  if (!id || !confirm('删除此返工记录？')) return;
  await deleteRework(id);
  closeModal('reworkModal');
  refreshAll();
}

async function getReworkById(id) {
  const all = await getAllRework();
  return all.find(r => r.id == id);
}

async function showReworkDetail(id) {
  const r = (await getAllRework()).find(x => x.id == id);
  if (!r) return;

  document.getElementById('reworkDetailTitle').textContent = '返工详情 #' + r.id;
  const photosHtml = (r.photos || []).map(p =>
    `<div class="photo-item" style="aspect-ratio:auto;height:80px;" onclick="previewImage('${p}')">
      <img src="${p}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;">
    </div>`
  ).join('');

  const isOverdue = r.deadline && r.deadline < getToday() && r.status !== 'resolved';
  const severityLabel = { low: '一般', medium: '中等', high: '严重' };
  const statusLabel = { 'in-progress': '整改中', resolved: '整改完' };

  document.getElementById('reworkDetailContent').innerHTML = `
    <div style="font-size:15px;font-weight:500;margin-bottom:12px;">${r.description || '未描述'}</div>
    <div style="font-size:13px;color:var(--text-dim);line-height:1.8;">
      ${r.location ? '📍 位置: ' + r.location + '<br>' : ''}
      ⚠ 严重程度: ${severityLabel[r.severity] || r.severity}<br>
      📅 限改日期: ${r.deadline || '未设置'} ${isOverdue ? '<span class="text-red">(已超期!)</span>' : ''}<br>
      👤 负责人: ${r.assignee || '未指定'}<br>
      📌 状态: ${statusLabel[r.status] || r.status}<br>
      📅 创建日期: ${r.date || '未知'}<br>
      ${r.resolvedDate ? '✅ 完成日期: ' + r.resolvedDate + '<br>' : ''}
      ${r.resolvedNote ? '📝 整改说明: ' + r.resolvedNote + '<br>' : ''}
    </div>
    ${photosHtml ? '<div class="mt-12"><div style="font-size:13px;color:var(--text-dim);margin-bottom:6px;">📸 照片:</div><div style="display:flex;gap:6px;flex-wrap:wrap;">' + photosHtml + '</div></div>' : ''}
    ${r.resolvedPhotos && r.resolvedPhotos.length > 0 ? '<div class="mt-12"><div style="font-size:13px;color:var(--text-dim);margin-bottom:6px;">✅ 完成照片:</div><div style="display:flex;gap:6px;flex-wrap:wrap;">' + r.resolvedPhotos.map(p => `<div class="photo-item" style="aspect-ratio:auto;height:80px;" onclick="previewImage('${p}')"><img src="${p}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;"></div>`).join('') + '</div></div>' : ''}
    ${r.status !== 'resolved' ? '<div class="mt-12"><button class="btn btn-sm btn-secondary" onclick="editReworkForm(' + r.id + ');closeModal(\'reworkDetailModal\')">✏️ 编辑</button></div>' : ''}
  `;

  document.getElementById('reworkDetailDeleteBtn').style.display = 'inline-flex';
  const isResolved = r.status === 'resolved';
  document.getElementById('reworkDetailResolveBtn').style.display = isResolved ? 'none' : 'inline-flex';
  document.getElementById('reworkDetailResolveBtn').onclick = () => resolveReworkItem(r.id);
  document.getElementById('reworkDetailUnresolveBtn').style.display = isResolved ? 'inline-flex' : 'none';

  // 存到全局以备删除
  window._currentReworkId = r.id;
  openModal('reworkDetailModal');
}

async function deleteReworkItem() {
  const id = window._currentReworkId;
  if (!id || !confirm('删除此返工记录？')) return;
  try {
    // 先把所有返工数据读出来
    const allReworks = await getAllRework();
    const remaining = allReworks.filter(r => String(r.id) !== String(id));
    // 再从 IndexedDB 删除
    await deleteRework(id);
    // 关闭所有弹窗
    document.querySelectorAll('.modal-overlay.open, .image-preview-overlay.open').forEach(el => el.classList.remove('open'));
    window._currentReworkId = null;
    // 用剩余数据直接刷新仪表盘（绕过 IndexedDB 读取）
    await refreshDashboard(remaining);
    await refreshRework();
    // 切换到返工面板
    switchPanel('rework');
    showToast('✅ 已删除');
  } catch (err) {
    showToast('❌ 删除失败: ' + err.message);
  }
}

// 当从仪表盘返工区域跳转时，强制刷新数据
function jumpToRework() {
  refreshRework();
  switchPanel('rework');
}

async function resolveReworkItem(id) {
  if (!id) id = window._currentReworkId;
  const all = await getAllRework();
  const r = all.find(x => x.id == id);
  if (!r) return;

  // 拍整改后照片
  const hasPhotos = await new Promise(resolve => {
    if (confirm('是否拍摄整改后照片？')) {
      cameraCallback = 'rework_resolve_' + id;
      const input = document.getElementById('cameraInput');
      input.setAttribute('capture', 'environment');
      input.value = '';
      input.onchange = async function(e) {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = async (ev) => {
            const watermarked = await addWatermark(ev.target.result, '返工完成 ' + getToday());
            r.resolvedPhotos = r.resolvedPhotos || [];
            r.resolvedPhotos.push(watermarked);
            r.resolvedNote = prompt('整改说明：') || '';
            r.status = 'resolved';
            r.resolvedDate = getToday();
            await saveRework(r);
            closeModal('reworkDetailModal');
            showToast('✅ 返工已闭环');
            refreshAll();
          };
          reader.readAsDataURL(file);
        }
      };
      input.click();
    } else {
      r.resolvedNote = prompt('整改说明：') || '';
      r.status = 'resolved';
      r.resolvedDate = getToday();
      saveRework(r).then(() => {
        closeModal('reworkDetailModal');
        showToast('✅ 返工已闭环');
        refreshAll();
      });
    }
  });
}

async function unresolveReworkItem(id) {
  if (!id) id = window._currentReworkId;
  if (!confirm('将此项撤回为「整改中」状态？')) return;
  const all = await getAllRework();
  const r = all.find(x => x.id == id);
  if (!r) return;
  r.status = 'in-progress';
  r.resolvedDate = '';
  r.resolvedNote = '';
  await saveRework(r);
  closeModal('reworkDetailModal');
  showToast('✅ 已撤回为整改中');
  refreshAll();
}

// ===================================================================
// 计划 & 甘特图
// ===================================================================
async function refreshPlanning() {
  const project = await getProject();
  if (!project) { switchPanel('projects'); return; }
  const phases = await getPhases();
  const milestones = await getMilestones();
  const allLogs = await getAllDayLogs();
  updateProjectEndDate();

  // 阶段列表（含实际日期）
  const sorted = phases.sort((a, b) => (a.sortOrder || a.startDay) - (b.sortOrder || b.startDay));
  document.getElementById('phaseList').innerHTML = sorted.length > 0 ?
    sorted.map(p => {
      const startDateStr = addDays(project.startDate, p.startDay - 1);
      const endDateStr = addDays(project.startDate, p.endDay - 1);
      const fmtStart = formatDateShort(startDateStr);
      const fmtEnd = formatDateShort(endDateStr);
      return `<div class="flex-between" style="padding:10px 0;border-bottom:1px solid var(--border);font-size:14px;">
        <div style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;" onclick="editPhase(${p.id})">
          <span style="width:12px;height:12px;border-radius:3px;background:${p.color};display:inline-block;"></span>
          ${p.name}
          <span class="text-dim" style="font-size:12px;">第${p.startDay}-${p.endDay}天 · ${fmtStart} ~ ${fmtEnd}</span>
        </div>
        <span style="color:var(--red);font-size:18px;cursor:pointer;padding:0 6px;" onclick="event.stopPropagation();quickDeletePhase(${p.id})">×</span>
      </div>`;
    }).join('') :
    '<div class="empty-state"><p>暂无施工阶段，点击下方添加</p></div>';

  // 里程碑
  document.getElementById('milestoneList').innerHTML = milestones.length > 0 ?
    milestones.sort((a, b) => a.day - b.day).map(m =>
      `<div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">
        <span>🏁 ${m.name}</span>
        <span class="text-dim">第${m.day}天</span>
      </div>`
    ).join('') :
    '<div class="text-dim" style="font-size:13px;padding:8px 0;">暂无里程碑</div>';

  // 甘特图
  renderGantt(project, sorted, milestones, allLogs);
}

function renderGantt(project, phases, milestones, dayLogs) {
  const container = document.getElementById('ganttContainer');
  const totalDays = project.totalDays || 70;
  const today = getToday();
  const startDate = project.startDate;

  if (!startDate || totalDays <= 0) {
    container.innerHTML = '<div class="empty-state"><p>请先设置项目开始日期和总工期</p></div>';
    return;
  }

  // 只显示最近的35天窗口，以今天为中心
  const todayIdx = daysBetween(startDate, today);
  let startIdx = Math.max(0, todayIdx - 17);
  let endIdx = Math.min(totalDays, startIdx + 34);
  if (endIdx - startIdx < 34) startIdx = Math.max(0, endIdx - 34);

  let html = '<div style="display:flex;min-width:100%;">';

  // 左侧固定列（阶段名 + 日期范围调试）
  html += '<div style="flex-shrink:0;">';
  html += '<div class="gantt-label-col" style="height:38px;display:flex;align-items:center;">阶段</div>';
  for (const p of phases) {
    const startDateStr = addDays(startDate, p.startDay - 1);
    const endDateStr = addDays(startDate, p.endDay - 1);
    html += `<div class="gantt-row-label" style="height:36px;font-size:11px;flex-direction:column;align-items:flex-start;">
      <span>${p.name}</span>
      <span style="font-size:10px;color:var(--text-dim);">📅 ${formatDateShort(startDateStr)}~${formatDateShort(endDateStr)}</span>
    </div>`;
  }
  html += '</div>';

  // 右侧滚动区域（日期+条）
  html += '<div style="overflow-x:auto;flex:1;-webkit-overflow-scrolling:touch;">';

  // 日期头（全部按日期显示 M/D）
  html += '<div class="gantt-days" style="height:38px;">';
  for (let i = startIdx; i <= endIdx; i++) {
    const date = addDays(startDate, i);
    const isToday = date === today;
    const md = formatDate(date);
    html += `<div class="gantt-day ${isToday ? 'today' : ''}">${md}</div>`;
  }
  html += '</div>';

  // 每一行
  for (const p of phases) {
    const pStart = Math.max(startIdx, p.startDay - 1);
    const pEnd = Math.min(endIdx, p.endDay - 1);
    const barLeft = ((pStart - startIdx) / (endIdx - startIdx + 1)) * 100;
    const barWidth = Math.max(((pEnd - pStart + 1) / (endIdx - startIdx + 1)) * 100, 2);

    html += '<div class="gantt-row" style="height:36px;position:relative;">';
    // 网格背景
    for (let i = startIdx; i <= endIdx; i++) {
      const date = addDays(startDate, i);
      const isToday = date === today;
      html += `<div class="gantt-cell" style="height:100%;border-right:1px solid var(--border);${isToday ? 'background:rgba(233,69,96,0.08);' : ''}"></div>`;
    }
    // 阶段条
    if (pStart <= pEnd) {
      const percent = (pStart - startIdx) / (endIdx - startIdx + 1) * 100;
      const width = (pEnd - pStart + 1) / (endIdx - startIdx + 1) * 100;
      html += `<div class="gantt-bar" style="left:${percent}%;width:${width}%;background:${p.color};top:8px;"></div>`;

      // 实际进度条（如果有日志）
      let actualDays = 0;
      for (let i = pStart; i <= pEnd; i++) {
        const date = addDays(startDate, i);
        if (dayLogs.find(l => l.date === date && l.progress > 0)) actualDays++;
      }
      if (actualDays > 0) {
        const actPercent = (actualDays / (pEnd - pStart + 1)) * width;
        html += `<div class="gantt-bar actual" style="left:${percent}%;width:${actPercent}%;background:var(--green);top:24px;"></div>`;
      }
    }
    html += '</div>';
  }

  html += '</div></div>'; // end flex, end scroll

  container.innerHTML = html;

  // 滚动到今天
  setTimeout(() => {
    const scrollContainer = container.querySelector('div[style*="overflow"]');
    if (scrollContainer) {
      const todayOffset = (todayIdx - startIdx) * 30 - 60;
      scrollContainer.scrollLeft = Math.max(0, todayOffset);
    }
  }, 100);
}

function updateProjectEndDate() {
  const el = document.getElementById('projectEndDateDisplay');
  if (!el) return;
  const startDate = document.getElementById('planStartDate').value;
  const totalDays = parseInt(document.getElementById('planTotalDays').value);
  if (startDate && totalDays && totalDays > 0) {
    const endDate = addDays(startDate, totalDays - 1);
    el.textContent = `📅 ${formatDateCN(startDate)} → ${formatDateCN(endDate)}（共${totalDays}天）`;
  } else {
    el.textContent = '';
  }
}

function savePlanSettings() {
  getProject().then(p => {
    p.name = document.getElementById('planName').value;
    p.startDate = document.getElementById('planStartDate').value;
    p.totalDays = parseInt(document.getElementById('planTotalDays').value) || 70;
    return saveProject(p);
  }).then(() => {
    document.getElementById('headerTitle').textContent = document.getElementById('planName').value || '项目管理';
    refreshAll();
    showToast('✅ 设置已保存');
  });
}

function updatePhaseDatePreview() {
  const el = document.getElementById('phaseDatePreview');
  if (!el) return;
  getProject().then(p => {
    const startVal = document.getElementById('phaseFormStart').value;
    const days = parseInt(document.getElementById('phaseFormDays').value);
    if (p && p.startDate && startVal && days && days > 0) {
      const day1 = daysBetween(p.startDate, startVal) + 1;
      const endDate = addDays(startVal, days - 1);
      const endVal = formatDateCN(endDate);
      const day2 = daysBetween(p.startDate, endDate) + 1;
      el.textContent = `📅 ${formatDateCN(startVal)} → ${endVal}（第${day1}-${day2}天，共${days}天）`;
    } else if (p && p.startDate && startVal) {
      el.textContent = `📅 从 ${formatDateCN(startVal)} 开始，请输入天数`;
    } else {
      el.textContent = '';
    }
  });
}

function showPhaseForm() {
  getProject().then(p => {
    document.getElementById('phaseFormId').value = '';
    document.getElementById('phaseFormName').value = '';
    document.getElementById('phaseFormStart').value = getToday();
    document.getElementById('phaseFormDays').value = '';
    document.getElementById('phaseFormColor').value = '#e94560';
    document.getElementById('phaseDeleteBtn').style.display = 'none';
    document.getElementById('phaseDatePreview').textContent = '';
    // 绑定起始日期范围
    const startInput = document.getElementById('phaseFormStart');
    if (p && p.startDate && p.totalDays) {
      const endDate = addDays(p.startDate, p.totalDays - 1);
      startInput.min = p.startDate;
      startInput.max = endDate;
    }
  });
  openModal('phaseModal');
  setTimeout(() => document.getElementById('phaseFormName').focus(), 300);
}

// 日期预览绑定
document.addEventListener('DOMContentLoaded', () => {
  const waitInit = setInterval(() => {
    const s = document.getElementById('phaseFormStart');
    if (s) {
      s.addEventListener('change', updatePhaseDatePreview);
      clearInterval(waitInit);
    }
  }, 100);
});

let _editingPhaseId = null;

async function editPhase(id) {
  const phases = await getPhases();
  const p = phases.find(x => x.id == id);
  if (!p) { showToast('⚠️ 未找到该阶段'); return; }
  _editingPhaseId = p.id;
  // 读取项目开始日期，计算实际日期
  getProject().then(proj => {
    const startInput = document.getElementById('phaseFormStart');
    if (proj && proj.startDate && proj.totalDays) {
      const projEnd = addDays(proj.startDate, proj.totalDays - 1);
      startInput.min = proj.startDate;
      startInput.max = projEnd;
    }
    document.getElementById('phaseFormId').value = p.id;
    document.getElementById('phaseFormName').value = p.name;
    document.getElementById('phaseFormStart').value = proj && proj.startDate ? addDays(proj.startDate, p.startDay - 1) : '';
    document.getElementById('phaseFormDays').value = p.endDay - p.startDay + 1;
    document.getElementById('phaseFormColor').value = p.color || '#e94560';
    document.getElementById('phaseDeleteBtn').style.display = 'inline-flex';
    updatePhaseDatePreview();
    openModal('phaseModal');
  });
}

async function savePhaseForm() {
  const project = await getProject();
  if (!project || !project.startDate) { showToast('⚠️ 请先设置项目开工日期'); return; }

  const startDate = document.getElementById('phaseFormStart').value;
  const days = parseInt(document.getElementById('phaseFormDays').value);
  if (!startDate) { showToast('⚠️ 请选择起始日期'); return; }
  if (!days || days < 1) { showToast('⚠️ 请输入有效天数'); return; }

  const startDay = daysBetween(project.startDate, startDate) + 1;
  if (startDay < 1) { showToast('⚠️ 起始日期不能早于开工日期'); return; }
  if (startDay + days - 1 > project.totalDays) { showToast('⚠️ 超出项目总工期'); return; }

  const id = document.getElementById('phaseFormId').value;
  const phase = id ? (await getPhases()).find(p => p.id == id) || {} : {};
  phase.name = document.getElementById('phaseFormName').value;
  phase.startDay = startDay;
  phase.endDay = startDay + days - 1;
  phase.color = document.getElementById('phaseFormColor').value;
  phase.sortOrder = phase.sortOrder || startDay;

  if (!phase.name) { showToast('⚠️ 请输入阶段名称'); return; }

  await savePhase(phase);
  closeModal('phaseModal');
  showToast('✅ 阶段已保存');
  refreshAll();
}

// 快速删除（从阶段列表直接点×）
async function quickDeletePhase(id) {
  const phases = await getPhases();
  const p = phases.find(x => x.id == id);
  const name = p ? p.name : '此阶段';
  if (!confirm('确定删除「' + name + '」？（不可恢复）')) return;
  try {
    await deletePhase(id);
    showToast('✅ 已删除 ' + name);
    refreshPlanning();
  } catch (err) {
    showToast('❌ 删除失败: ' + err.message);
  }
}

async function deletePhaseForm() {
  // 从弹窗删除
  let id = _editingPhaseId || parseInt(document.getElementById('phaseFormId').value);
  if (!id || isNaN(id)) { showToast('⚠️ 无法获取阶段ID'); return; }
  const phases = await getPhases();
  const p = phases.find(x => x.id == id);
  if (!p) { showToast('⚠️ 未找到该阶段'); return; }
  if (!confirm('确定删除「' + p.name + '」？')) return;
  try {
    await deletePhase(id);
    _editingPhaseId = null;
    closeModal('phaseModal');
    showToast('✅ 已删除');
    refreshAll();
  } catch (err) {
    showToast('❌ 删除失败: ' + err.message);
  }
}

// 里程碑
function showMilestoneForm() {
  document.getElementById('milestoneFormId').value = '';
  document.getElementById('milestoneFormName').value = '';
  document.getElementById('milestoneFormDay').value = '';
  openModal('milestoneModal');
}

async function saveMilestoneForm() {
  const id = document.getElementById('milestoneFormId').value;
  const m = id ? (await getMilestones()).find(x => x.id == id) || {} : {};
  m.name = document.getElementById('milestoneFormName').value;
  m.day = parseInt(document.getElementById('milestoneFormDay').value);
  if (!m.name || !m.day) { showToast('⚠️ 请填写完整'); return; }
  await saveMilestone(m);
  closeModal('milestoneModal');
  showToast('✅ 里程碑已保存');
  refreshAll();
}

// ===================================================================
// 报告生成
// ===================================================================
let lastReportText = '';

async function genDailyReport() {
  const project = await getProject();
  const todayLog = await getDayLog(getToday());
  const reworks = await getAllRework();
  const phases = await getPhases();

  const dayIdx = daysBetween(project.startDate, getToday()) + 1;
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  const weekStr = weekDays[new Date(getToday()).getDay()];

  let report = `╔════════════════════════════════╗\n`;
  report += `║       施 工 日 报                ║\n`;
  report += `╚════════════════════════════════╝\n\n`;
  report += `项目名称：${project.name}\n`;
  report += `日期：${getToday()}（周${weekStr}）第${dayIdx}天\n`;
  report += `总工期：${project.totalDays}天\n\n`;

  report += `─── 今日进度 ───\n`;
  report += `实际进度：${todayLog ? (todayLog.progress || 0) : 0}%\n`;
  report += `出工人数：${todayLog ? (todayLog.workers || '未记录') : '未记录'}\n`;
  report += `天气：${todayLog ? (todayLog.weather || '未记录') : '未记录'}\n\n`;

  report += `─── 今日完成 ───\n`;
  if (todayLog && todayLog.actualTasks && todayLog.actualTasks.length > 0) {
    todayLog.actualTasks.forEach(t => report += `  ✓ ${t}\n`);
  } else {
    report += `  （暂无记录）\n`;
  }
  report += '\n';

  report += `─── 现场记录 ───\n`;
  report += `${todayLog ? (todayLog.notes || '无') : '无'}\n\n`;

  const openReworks = reworks.filter(r => r.status !== 'resolved');
  if (openReworks.length > 0) {
    report += `─── 待处理问题 ───\n`;
    openReworks.forEach(r => {
      const isOverdue = r.deadline && r.deadline < getToday();
      report += `  ${isOverdue ? '⚠' : '●'} ${r.description}${r.deadline ? '（期限:' + r.deadline + '）' : ''}${isOverdue ? ' 已超期!' : ''}\n`;
    });
    report += '\n';
  }

  report += `─── 明日计划 ───\n`;
  if (todayLog && todayLog.plannedTasks) {
    const undone = todayLog.plannedTasks.filter(t => !t.done);
    if (undone.length > 0) {
      undone.forEach(t => report += `  □ ${t.text}\n`);
    } else {
      report += `  按计划继续施工\n`;
    }
  } else {
    report += `  按计划继续施工\n`;
  }
  report += '\n';

  const photos = await getPhotosByCategory('daily');
  const todayPhotos = photos.filter(p => p.date === getToday());
  if (todayPhotos.length > 0) {
    report += `─── 今日照片 ───\n`;
    report += `  共 ${todayPhotos.length} 张现场照片\n\n`;
  }

  report += `═══════════════════════════════════\n`;
  report += `生成时间：${new Date().toLocaleString()}\n`;

  document.getElementById('reportContent').textContent = report;
  lastReportText = report;
  showToast('📋 日报已生成');
}

async function genWeeklyReport() {
  const project = await getProject();
  const allLogs = await getAllDayLogs();
  const reworks = await getAllRework();

  // 本周范围（最近7天）
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekStart = weekAgo.toISOString().split('T')[0];

  const weekLogs = allLogs.filter(l => l.date >= weekStart).sort((a, b) => a.date.localeCompare(b.date));
  const weekProgress = weekLogs.map(l => l.progress || 0);
  const avgProgress = weekProgress.length > 0 ? Math.round(weekProgress.reduce((a, b) => a + b, 0) / weekProgress.length) : 0;
  const weekPhotos = (await getPhotosByCategory('daily')).filter(p => p.date >= weekStart);

  let report = `╔════════════════════════════════╗\n`;
  report += `║       施 工 周 报                ║\n`;
  report += `╚════════════════════════════════╝\n\n`;
  report += `项目名称：${project.name}\n`;
  report += `统计周期：${weekStart} ~ ${getToday()}\n`;
  report += `记录天数：${weekLogs.length} 天\n`;
  report += `平均进度：${avgProgress}%\n`;
  report += `本周照片：${weekPhotos.length} 张\n\n`;

  report += `─── 每日进度明细 ───\n`;
  for (const log of weekLogs) {
    report += `  ${log.date}  进度 ${log.progress || 0}%  出工 ${log.workers || '-'}人  ${log.weather || ''}\n`;
  }
  report += '\n';

  const openReworks = reworks.filter(r => r.status !== 'resolved');
  const overdueReworks = openReworks.filter(r => r.deadline && r.deadline < getToday());
  if (overdueReworks.length > 0) {
    report += `─── 超期问题 ⚠ ───\n`;
    overdueReworks.forEach(r => report += `  ⚠ ${r.description}（期限:${r.deadline}）\n`);
    report += '\n';
  }

  const newReworks = reworks.filter(r => r.date >= weekStart && r.status !== 'resolved');
  if (newReworks.length > 0) {
    report += `─── 本周新增问题 ───\n`;
    newReworks.forEach(r => report += `  ● ${r.description} [${r.severity === 'high' ? '严重' : r.severity === 'medium' ? '中等' : '一般'}]\n`);
    report += '\n';
  }

  report += `─── 下周计划 ───\n`;
  const phases = await getPhases();
  const dayIdx = daysBetween(project.startDate, getToday()) + 1;
  const nextPhase = phases.find(p => p.startDay <= dayIdx + 7 && p.endDay >= dayIdx);
  if (nextPhase) {
    report += `  继续 ${nextPhase.name}（第${nextPhase.startDay}-${nextPhase.endDay}天）\n`;
  } else {
    report += `  按施工计划推进\n`;
  }
  report += '\n';
  report += `═══════════════════════════════════\n`;

  document.getElementById('reportContent').textContent = report;
  lastReportText = report;
  showToast('📊 周报已生成');
}

async function genPhaseReport() {
  const project = await getProject();
  const phases = await getPhases();
  const allLogs = await getAllDayLogs();
  const reworks = await getAllRework();

  const dayIdx = daysBetween(project.startDate, getToday()) + 1;
  const currentPhase = phases.find(p => p.startDay <= dayIdx && p.endDay >= dayIdx);

  let report = `╔════════════════════════════════╗\n`;
  report += `║       阶 段 报 告                ║\n`;
  report += `╚════════════════════════════════╝\n\n`;
  report += `项目：${project.name}\n`;
  report += `当前阶段：${currentPhase ? currentPhase.name : '—'}\n`;
  report += `施工天数：第1~${Math.min(dayIdx, project.totalDays)}天 / 共${project.totalDays}天\n\n`;

  // 各阶段进度
  report += `─── 各阶段进度 ───\n`;
  for (const p of phases) {
    const pLogs = [];
    for (let d = p.startDay; d <= Math.min(p.endDay, dayIdx); d++) {
      const date = addDays(project.startDate, d - 1);
      const log = allLogs.find(l => l.date === date);
      if (log) pLogs.push(log.progress || 0);
    }
    const pAvg = pLogs.length > 0 ? Math.round(pLogs.reduce((a, b) => a + b, 0) / pLogs.length) : 0;
    const pPhotos = (await getAllPhotos()).filter(ph => ph.category === 'daily' && ph.date >= addDays(project.startDate, p.startDay - 1) && ph.date <= addDays(project.startDate, p.endDay - 1));
    report += `  ${p.name} (第${p.startDay}-${p.endDay}天) ${pAvg}% ${pPhotos.length}张照片\n`;
  }
  report += '\n';

  // 问题统计
  report += `─── 问题统计 ───\n`;
  const openCount = reworks.filter(r => r.status !== 'resolved').length;
  const resolvedCount = reworks.filter(r => r.status === 'resolved').length;
  const totalCount = reworks.length;
  report += `  总计问题：${totalCount} 个\n`;
  report += `  已完成：${resolvedCount} 个\n`;
  report += `  待处理：${openCount} 个\n`;
  report += `  解决率：${totalCount > 0 ? Math.round(resolvedCount / totalCount * 100) : 0}%\n\n`;

  report += `─── 综合评估 ───\n`;
  const avgAllProgress = allLogs.length > 0 ? Math.round(allLogs.reduce((a, l) => a + (l.progress || 0), 0) / allLogs.length) : 0;
  const delayRisk = openCount > 3 || avgAllProgress < Math.round(dayIdx / project.totalDays * 100) - 10;
  report += `  平均进度：${avgAllProgress}%\n`;
  report += `  风险评估：${delayRisk ? '⚠ 注意，存在延期风险' : '✓ 正常'}\n`;
  report += '\n';
  report += `═══════════════════════════════════\n`;

  document.getElementById('reportContent').textContent = report;
  lastReportText = report;
  showToast('📑 阶段报告已生成');
}

function copyReport() {
  if (!lastReportText) { showToast('⚠️ 请先生成报告'); return; }
  navigator.clipboard.writeText(lastReportText).then(() => showToast('📋 已复制到剪贴板'));
}

function exportReportTxt() {
  if (!lastReportText) { showToast('⚠️ 请先生成报告'); return; }
  const blob = new Blob([lastReportText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `日报_${getToday()}.txt`; a.click();
  URL.revokeObjectURL(url);
  showToast('💾 已导出TXT');
}

// ===================================================================
// 竣工管理（总览 + 单项目详情）
// ===================================================================
let _completionOverview = false;

function showCompletionOverview() {
  _completionOverview = true;
  switchPanel('completion');
}

async function refreshCompletion() {
  const project = await getProject();
  const el = document.getElementById('completionContent');
  const titleEl = document.getElementById('completionTitle');
  const isOverview = _completionOverview || !project;
  _completionOverview = false; // 一次性标记

  if (isOverview) {
    // 总览模式：项目列表，点击查看只读竣工报告
    titleEl.textContent = '竣工总览';
    const projects = await getAllProjects();
    if (!projects || projects.length === 0) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><p>暂无项目</p></div>';
      return;
    }
    el.innerHTML = projects.map(p => {
      const files = p.completionFiles || [];
      const fileSummary = files.filter(f => f.type === 'image').length + '张照片 ' + files.filter(f => f.type !== 'image').length + '份文档';
      const hasFiles = files.length > 0;
      return `<div class="card">
        <div class="flex-between mb-8">
          <span style="font-size:16px;font-weight:600;">${p.name}</span>
          <span class="${p.completed ? 'text-green' : 'text-dim'}">${p.completed ? '✅ 已竣工' : '⏳'}</span>
        </div>
        ${p.completedDate ? `<div style="font-size:12px;color:var(--text-dim);margin-bottom:4px;">竣工日期: ${p.completedDate}</div>` : ''}
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:8px;">${hasFiles ? '📎 ' + fileSummary : '暂无竣工文件'}</div>
        ${hasFiles ? `<button class="btn btn-sm btn-secondary" onclick="showCompletionReport('${p.id}')">👁 查看竣工报告</button>` : '<span style="font-size:12px;color:var(--text-dim);">未上传报告</span>'}
      </div>`;
    }).join('');
  } else {
    // 项目内模式：显示当前项目的竣工详情 + 上传/确认
    titleEl.textContent = '竣工 - ' + project.name;
    const files = project.completionFiles || [];
    const completed = project.completed;

    let html = `<div class="card">
      <div style="font-size:18px;font-weight:600;margin-bottom:8px;">${completed ? '✅ 已竣工' : '⏳ 未竣工'}</div>
      ${completed ? `<div style="font-size:13px;color:var(--text-dim);margin-bottom:8px;">竣工日期: ${project.completedDate || '—'}</div>` : ''}`;

    // 文件列表
    html += '<div style="margin-top:12px;">';
    if (files.length > 0) {
      files.forEach(f => {
        if (f.type === 'image') {
          html += `<div class="photo-item" style="width:100%;aspect-ratio:16/9;margin-bottom:6px;" onclick="previewImage('${f.data}')"><img src="${f.data}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;"></div>`;
        } else {
          html += `<div class="flex-between" style="padding:8px;background:var(--bg-card2);border-radius:6px;margin-bottom:4px;font-size:13px;"><span>📄 ${f.name}</span><span class="text-dim" style="font-size:11px;">${f.date || ''}</span></div>`;
        }
      });
    } else {
      html += '<div style="font-size:13px;color:var(--text-dim);padding:8px 0;">暂无竣工文件</div>';
    }
    html += '</div></div>';

    // 操作按钮
    html += `<div class="card">
      <div class="btn-group">
        <button class="btn btn-sm btn-secondary" onclick="uploadCompletionFile('image')">📸 上传照片</button>
        <button class="btn btn-sm btn-secondary" onclick="uploadCompletionFile('document')">📄 上传文档</button>
      </div>
      <div class="mt-12">
        <button class="btn btn-block ${completed ? 'btn-danger' : 'btn-success'}" onclick="toggleCompletionStatus()">${completed ? '撤回竣工' : '✅ 确认竣工'}</button>
      </div>
    </div>`;

    el.innerHTML = html;
  }
}

async function uploadCompletionFile(type) {
  const project = await getProject();
  if (!project) return;
  const input = document.getElementById('cameraInput');
  type === 'image' ? input.setAttribute('capture', 'environment') : input.removeAttribute('capture');
  input.accept = type === 'image' ? 'image/*' : '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.png';
  input.value = '';
  input.onchange = async function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      project.completionFiles = project.completionFiles || [];
      let data = ev.target.result;
      if (type === 'image') data = await addWatermark(data, '竣工资料 ' + getToday());
      project.completionFiles.push({ name: file.name, data, type, date: getToday() });
      await saveProject(project);
      refreshCompletion();
      showToast('✅ 已上传');
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

// 只读查看竣工报告（从总览点击，不绑当前项目）
async function showCompletionReport(projectId) {
  const project = await dbGet('project', projectId);
  if (!project) return;
  const files = project.completionFiles || [];
  const completed = project.completed;

  const fileHtml = files.length > 0 ? files.map(f =>
    f.type === 'image'
      ? `<div class="photo-item" style="width:100%;aspect-ratio:16/9;margin-bottom:6px;cursor:pointer;" onclick="previewImage('${f.data}')"><img src="${f.data}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;"></div>`
      : `<div class="flex-between" style="padding:8px;background:var(--bg-card2);border-radius:6px;margin-bottom:4px;font-size:13px;"><span>📄 ${f.name}</span><span class="text-dim" style="font-size:11px;">${f.date || ''}</span></div>`
  ).join('') : '<div style="font-size:13px;color:var(--text-dim);padding:8px 0;">暂无竣工文件</div>';

  // 复用 reworkDetailModal
  document.getElementById('reworkDetailTitle').textContent = '竣工报告 - ' + project.name;
  document.getElementById('reworkDetailContent').innerHTML = `
    <div style="font-size:15px;font-weight:600;margin-bottom:8px;">${completed ? '✅ 已竣工' : '⏳ 未竣工'}</div>
    ${completed && project.completedDate ? `<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">竣工日期: ${project.completedDate}</div>` : ''}
    <div style="margin-top:8px;">${fileHtml}</div>
  `;
  document.getElementById('reworkDetailDeleteBtn').style.display = 'none';
  document.getElementById('reworkDetailResolveBtn').style.display = 'none';
  document.getElementById('reworkDetailUnresolveBtn').style.display = 'none';
  openModal('reworkDetailModal');
}

async function toggleCompletionStatus() {
  const project = await getProject();
  if (!project) return;
  const completed = project.completed;
  const action = completed ? '撤回竣工' : '确认竣工';
  if (!confirm('确定' + action + '？')) return;
  if (completed) {
    project.completed = false;
    project.completedDate = '';
  } else {
    project.completed = true;
    project.completedDate = getToday();
  }
  await saveProject(project);
  refreshCompletion();
  refreshProjectList();
  showToast('✅ ' + action);
}

// ===================================================================
// 数据导出导入
// ===================================================================
async function exportData() {
  const data = await exportAllData();
  const project = await getProject();
  downloadJSON(data, `项目数据_${project.name}_${getToday()}.json`);
  showToast('📤 数据已导出');
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const data = await readJSONFile(file);
    await importAllData(data);
    showToast('✅ 数据导入成功');
    refreshAll();
  } catch (err) {
    showToast('❌ 导入失败: ' + err.message);
  }
  event.target.value = '';
}

// ===================================================================
// 局域网同步
// ===================================================================
let syncServerBase = '';

function getSyncServerUrl() {
  let ip = document.getElementById('syncServerIP').value.trim();
  // 处理全角冒号（中文输入法）
  ip = ip.replace(/[：:]/g, ':').replace(/[，,]/g, '.');
  if (!ip) { showToast('⚠️ 请先输入服务器地址'); return null; }
  const base = ip.startsWith('http') ? ip : 'http://' + ip;
  syncServerBase = base.replace(/\/+$/, '');
  return syncServerBase;
}

// 通过 WebRTC 获取本机局域网 IP
async function getDeviceIP() {
  return new Promise((resolve) => {
    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      let resolved = false;
      pc.createDataChannel('');
      pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => {});
      pc.onicecandidate = (e) => {
        if (!e.candidate) {
          if (!resolved) { resolved = true; resolve(null); }
          return;
        }
        const m = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (m) {
          const ip = m[1];
          if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) && !ip.startsWith('127.')) {
            resolved = true;
            pc.close();
            resolve(ip);
          }
        }
      };
      setTimeout(() => { if (!resolved) { resolved = true; pc.close(); resolve(null); } }, 2000);
    } catch(e) {
      resolve(null);
    }
  });
}

// 快速探测单个IP (用 Promise.race 兼容旧 WebView)
function probeIP(ip) {
  const url = 'http://' + ip + ':3456/api/status';
  const fetchPromise = fetch(url).then(resp => resp.ok ? resp.json() : Promise.reject()).then(data => ({ ip: data.ip, port: data.port, files: data.files }));
  const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 800));
  return Promise.race([fetchPromise, timeoutPromise]).catch(() => null);
}

// 并行探测一批IP，返回第一个成功的
async function probeBatch(ips) {
  const results = await Promise.all(ips.map(ip => probeIP(ip)));
  return results.find(r => r !== null) || null;
}

async function discoverServer() {
  showToast('🔍 正在扫描局域网...');
  const statusEl = document.getElementById('syncStatus');
  statusEl.textContent = '搜索中...';

  // 1) 先尝试用户输入的地址
  let input = document.getElementById('syncServerIP').value.trim();
  if (input) {
    const base = input.startsWith('http') ? input : 'http://' + input;
    try {
      const resp = await fetchTimeout(base.replace(/\/+$/, '') + '/api/status', {}, 3000);
      if (resp.ok) {
        const data = await resp.json();
        statusEl.textContent = `✅ 已连接服务器 (${data.ip}:${data.port}) 文件: ${data.files.length} 个`;
        document.getElementById('syncServerIP').value = data.ip + ':' + data.port;
        showToast('✅ 服务器连接成功');
        return;
      }
    } catch(e) {}
  }

  // 2) URL 推断 (PC浏览器访问时有效)
  const currentUrl = window.location.hostname;
  if (currentUrl && currentUrl !== 'localhost' && currentUrl !== '127.0.0.1') {
    const result = await probeIP(currentUrl);
    if (result) {
      document.getElementById('syncServerIP').value = result.ip + ':' + result.port;
      statusEl.textContent = `✅ 已连接服务器 (${result.ip}:${result.port}) 文件: ${result.files.length} 个`;
      showToast('✅ 服务器连接成功');
      return;
    }
  }

  // 3) 获取本机IP，扫描同网段
  statusEl.textContent = '获取本机网络...';
  const myIP = await getDeviceIP();

  if (myIP) {
    const parts = myIP.split('.');
    const prefix = parts[0] + '.' + parts[1] + '.' + parts[2];
    statusEl.textContent = `扫描 ${prefix}.xxx ...`;

    // 优先扫网关（.1）和常用低段 (.2-.30)
    const priority = [1, 2, 3, 100, 101, 102, 103];
    // 然后扫其余 (.31-.254)，排除自己
    const rest = [];
    for (let i = 4; i <= 254; i++) {
      if (i === parseInt(parts[3])) continue;
      if (!priority.includes(i)) rest.push(i);
    }
    const allTargets = [...priority, ...rest];

    // 分批并行扫描，每批 20 个
    for (let b = 0; b < allTargets.length; b += 20) {
      const batch = allTargets.slice(b, b + 20).map(n => prefix + '.' + n);
      statusEl.textContent = `扫描中... (${b + 1}-${Math.min(b + 20, allTargets.length)} / ${allTargets.length})`;
      const hit = await probeBatch(batch);
      if (hit) {
        document.getElementById('syncServerIP').value = hit.ip + ':' + hit.port;
        statusEl.textContent = `✅ 已连接服务器 (${hit.ip}:${hit.port}) 文件: ${hit.files.length} 个`;
        showToast('✅ 服务器连接成功');
        return;
      }
    }
  }

  // 4) 尝试几个常见网段作为 fallback（每网段扫 .1-.50 的前30个）
  statusEl.textContent = '扩展搜索常见网段...';
  const commonPrefixes = ['192.168.1', '192.168.0', '192.168.31', '10.0.0', '172.16.0'];
  for (const prefix of commonPrefixes) {
    const ips = [];
    // 优先扫低段+常见段，总共扫50个
    for (let i = 1; i <= 50; i++) ips.push(prefix + '.' + i);
    // 再加几个常见的
    ips.push(prefix + '.100', prefix + '.101', prefix + '.102');
    for (let b = 0; b < ips.length; b += 20) {
      const batch = ips.slice(b, b + 20);
      statusEl.textContent = `扫描 ${prefix}.x (${b + 1}-${Math.min(b + 20, ips.length)})`;
      const hit = await probeBatch(batch);
      if (hit) {
        document.getElementById('syncServerIP').value = hit.ip + ':' + hit.port;
        statusEl.textContent = `✅ 已连接服务器 (${hit.ip}:${hit.port}) 文件: ${hit.files.length} 个`;
        showToast('✅ 服务器连接成功');
        return;
      }
    }
  }

  statusEl.textContent = '❌ 未找到服务器，请确认电脑已连接同一WiFi并运行 server.js';
  showToast('❌ 未找到服务器');
}

function setSyncStatus(msg) {
  const el = document.getElementById('syncStatus');
  if (el) el.textContent = msg;
}

// fetch 带超时 (兼容不支持 AbortSignal.timeout 的旧 WebView)
function fetchTimeout(url, opts, ms) {
  const fetchPromise = fetch(url, opts);
  const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('请求超时')), ms));
  return Promise.race([fetchPromise, timeoutPromise]);
}

async function syncPush() {
  if (!getSyncServerUrl()) return;
  setSyncStatus('⏳ 正在推送数据...');

  try {
    const allData = await exportAllData();

    // 分类型推送
    const types = ['project', 'phases', 'dayLogs', 'photos', 'recordings', 'rework', 'milestones', 'materials', 'attendance'];
    for (const type of types) {
      if (allData[type] && (Array.isArray(allData[type]) ? allData[type].length > 0 : allData[type])) {
        const resp = await fetchTimeout(syncServerBase + '/api/sync/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, payload: allData[type] })
        }, 30000);
        if (!resp.ok) throw new Error(type + ' 推送失败');
      }
    }

    setSyncStatus('✅ 数据已推送到服务器');
    showToast('📤 数据推送完成');
  } catch (err) {
    setSyncStatus('❌ 推送失败: ' + err.message);
    showToast('❌ 推送失败');
  }
}

async function syncPull() {
  if (!getSyncServerUrl()) return;
  setSyncStatus('⏳ 正在拉取数据...');

  try {
    // 获取所有可用数据类型
    const listResp = await fetchTimeout(syncServerBase + '/api/sync/pull', {}, 5000);
    const listData = await listResp.json();
    if (!listData.types || listData.types.length === 0) {
      setSyncStatus('⚠️ 服务器上没有数据');
      return;
    }

    // 逐个拉取
    for (const type of listData.types) {
      const resp = await fetchTimeout(syncServerBase + '/api/sync/pull?type=' + type, {}, 30000);
      if (resp.ok) {
        const data = await resp.json();
        if (data.data) {
          // 存储到本地 IndexedDB
          const storeMap = {
            'project': 'project', 'phases': 'phases', 'dayLogs': 'dayLogs',
            'photos': 'photos', 'recordings': 'recordings', 'rework': 'rework',
            'milestones': 'milestones', 'materials': 'materials', 'attendance': 'attendance'
          };
          const store = storeMap[type];
          if (store) {
            if (type === 'project' && data.data) {
              await dbPut('project', data.data);
            } else if (Array.isArray(data.data)) {
              for (const item of data.data) await dbPut(store, item);
            }
          }
        }
      }
    }

    setSyncStatus('✅ 数据拉取完成');
    showToast('📥 数据拉取完成');
    refreshAll();
  } catch (err) {
    setSyncStatus('❌ 拉取失败: ' + err.message);
    showToast('❌ 拉取失败');
  }
}

async function syncFull() {
  if (!getSyncServerUrl()) return;
  setSyncStatus('⏳ 正在双向同步...');

  try {
    // 先推送本地数据
    const localData = await exportAllData();
    const pushPayload = {};
    const types = ['project', 'phases', 'dayLogs', 'photos', 'recordings', 'rework', 'milestones', 'materials', 'attendance'];
    for (const type of types) {
      if (localData[type] && (Array.isArray(localData[type]) ? localData[type].length > 0 : localData[type])) {
        pushPayload[type] = localData[type];
      }
    }

    const resp = await fetchTimeout(syncServerBase + '/api/sync/full', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ push: pushPayload })
    }, 60000);

    if (!resp.ok) throw new Error('同步请求失败');
    const result = await resp.json();

    // 将服务器数据写入本地
    if (result.data) {
      for (const [type, data] of Object.entries(result.data)) {
        const storeMap = {
          'project': 'project', 'phases': 'phases', 'dayLogs': 'dayLogs',
          'photos': 'photos', 'recordings': 'recordings', 'rework': 'rework',
          'milestones': 'milestones', 'materials': 'materials', 'attendance': 'attendance'
        };
        const store = storeMap[type];
        if (store) {
          if (type === 'project' && data) {
            await dbPut('project', data);
          } else if (Array.isArray(data)) {
            for (const item of data) await dbPut(store, item);
          }
        }
      }
    }

    setSyncStatus('✅ 双向同步完成');
    showToast('🔄 同步完成');
    refreshAll();
  } catch (err) {
    setSyncStatus('❌ 同步失败: ' + err.message);
    showToast('❌ 同步失败');
  }
}

// ====== 快捷键 ======
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeDrawer();
    document.querySelectorAll('.modal-overlay.open, .image-preview-overlay.open').forEach(el => {
      el.classList.remove('open');
    });
  }
});

// ====== 注册Service Worker ======
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

console.log('🏗️ 项目管理 v1.0 已加载 (版本: 2026-05-15-v2)');
