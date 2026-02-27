import * as FileSystem from 'expo-file-system/legacy';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import type { InstalledApp } from '@/hooks/useInstalledApps';

// ── Utility ───────────────────────────────────────────────────────────────────

export async function createDemoApp(
  db: SQLiteDatabase,
  appId: string,
  name: string,
  emoji: string,
  bgColor: string,
  htmlContent: string,
): Promise<InstalledApp> {
  const dir = FileSystem.documentDirectory + 'apps/' + appId + '/';

  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  await FileSystem.writeAsStringAsync(dir + 'index.html', htmlContent, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const info = await FileSystem.getInfoAsync(dir + 'index.html');
  const bundleSize = info.exists && 'size' in info ? info.size : 0;

  // Strip "file://" prefix — viewer re-adds it: `file://${bundle_path}/index.html`
  const bundlePath = dir.replace(/^file:\/\//, '').replace(/\/$/, '');

  await db.runAsync(
    `INSERT OR IGNORE INTO apps
       (app_id, name, icon_emoji, icon_bg_color, bundle_path, source_type, bundle_size)
     VALUES (?, ?, ?, ?, ?, 'bundle', ?)`,
    appId,
    name,
    emoji,
    bgColor,
    bundlePath,
    bundleSize,
  );

  return (await db.getFirstAsync<InstalledApp>('SELECT * FROM apps WHERE app_id = ?', appId))!;
}

// ── Seeder ────────────────────────────────────────────────────────────────────

export async function seedDemoApps(db: SQLiteDatabase): Promise<void> {
  if (Platform.OS === 'web') return;

  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM apps');
  if ((row?.n ?? 0) !== 0) return;

  await Promise.all([
    createDemoApp(db, 'demo-workout', 'Workout Log', '💪', '#DBEAFE', WORKOUT_HTML),
    createDemoApp(db, 'demo-habits', 'Daily Habits', '✅', '#D1FAE5', HABITS_HTML),
    createDemoApp(db, 'demo-expense', 'Expense Snap', '💰', '#FEF3C7', EXPENSE_HTML),
  ]);
}

// ── Demo App 1: Workout Log ───────────────────────────────────────────────────

const WORKOUT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Workout Log</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
      background: #F2F2F7;
      color: #1C1C1E;
      -webkit-font-smoothing: antialiased;
    }
    .header {
      background: #fff;
      padding: 16px 16px 12px;
      border-bottom: 0.5px solid #C6C6C8;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .header h1 { font-size: 22px; font-weight: 700; }
    .header .subtitle { font-size: 13px; color: #8E8E93; margin-top: 2px; }
    .card {
      background: #fff;
      border-radius: 12px;
      margin: 12px;
      overflow: hidden;
    }
    .card-title {
      font-size: 12px;
      font-weight: 600;
      color: #8E8E93;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      padding: 12px 16px 8px;
    }
    .pills {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 0 16px 16px;
    }
    .pill {
      background: #EFF6FF;
      color: #007AFF;
      border: 1.5px solid #007AFF;
      border-radius: 20px;
      padding: 7px 16px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      font-family: inherit;
    }
    .pill.active {
      background: #007AFF;
      color: #fff;
    }
    .log-form {
      display: none;
      padding: 0 16px 16px;
    }
    .log-form.show { display: block; }
    .form-ex-name {
      font-size: 15px;
      font-weight: 600;
      color: #1C1C1E;
      margin-bottom: 10px;
    }
    .inputs-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 12px;
    }
    .inputs-row input {
      flex: 1;
      border: 1px solid #C6C6C8;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 15px;
      background: #FAFAFA;
      color: #1C1C1E;
      -webkit-appearance: none;
      font-family: inherit;
      min-width: 0;
    }
    .inputs-row input:focus { outline: none; border-color: #007AFF; }
    .sep { font-size: 16px; color: #8E8E93; flex-shrink: 0; }
    .btn-log {
      background: #007AFF;
      color: #fff;
      border: none;
      border-radius: 12px;
      padding: 13px;
      width: 100%;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      -webkit-tap-highlight-color: transparent;
    }
    .btn-log:active { opacity: 0.75; }
    .ex-item {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 0.5px solid #F2F2F7;
    }
    .ex-item:last-child { border-bottom: none; }
    .ex-body { flex: 1; }
    .ex-name { font-size: 15px; font-weight: 600; }
    .ex-detail { font-size: 13px; color: #8E8E93; margin-top: 2px; }
    .ex-del {
      color: #FF3B30;
      font-size: 22px;
      padding: 4px 4px 4px 12px;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      line-height: 1;
    }
    .empty-msg {
      text-align: center;
      color: #8E8E93;
      font-size: 14px;
      padding: 20px 16px;
    }
    .stat-row {
      display: flex;
      align-items: center;
      padding: 14px 16px;
      gap: 12px;
    }
    .stat-num { font-size: 34px; font-weight: 700; color: #007AFF; }
    .stat-lbl { font-size: 14px; color: #8E8E93; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Workout Log</h1>
    <div class="subtitle" id="date-lbl"></div>
  </div>

  <div class="card">
    <div class="card-title">Quick Add</div>
    <div class="pills" id="pills"></div>
    <div class="log-form" id="log-form">
      <div class="form-ex-name" id="form-ex-name"></div>
      <div class="inputs-row">
        <input type="number" id="inp-sets" placeholder="Sets" min="1">
        <span class="sep">x</span>
        <input type="number" id="inp-reps" placeholder="Reps" min="1">
        <input type="number" id="inp-weight" placeholder="kg (opt)" step="0.5">
      </div>
      <button class="btn-log" id="btn-log">Log Exercise</button>
    </div>
  </div>

  <div class="card">
    <div class="card-title">Today</div>
    <div id="today-list"></div>
  </div>

  <div class="card">
    <div class="card-title">This Week</div>
    <div class="stat-row">
      <div class="stat-num" id="week-num">0</div>
      <div class="stat-lbl">total exercises logged</div>
    </div>
  </div>

  <script>
    var EXERCISES = ['Push-ups','Squats','Deadlift','Bench','Running','Pull-ups'];
    var selected = null;

    function dateKey(d) {
      var y = d.getFullYear();
      var m = String(d.getMonth()+1).padStart(2,'0');
      var day = String(d.getDate()).padStart(2,'0');
      return 'workouts_' + y + '-' + m + '-' + day;
    }

    var today = new Date();
    var todayKey = dateKey(today);

    document.getElementById('date-lbl').textContent = today.toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    function load() { return JSON.parse(localStorage.getItem(todayKey) || '[]'); }
    function save(arr) { localStorage.setItem(todayKey, JSON.stringify(arr)); }

    function renderPills() {
      var c = document.getElementById('pills');
      c.innerHTML = EXERCISES.map(function(ex) {
        return '<button class="pill' + (selected===ex?' active':'') + '" data-ex="' + ex + '">' + ex + '</button>';
      }).join('');
      c.querySelectorAll('.pill').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var ex = this.dataset.ex;
          if (selected === ex) {
            selected = null;
            document.getElementById('log-form').classList.remove('show');
          } else {
            selected = ex;
            document.getElementById('form-ex-name').textContent = ex;
            document.getElementById('inp-sets').value = '';
            document.getElementById('inp-reps').value = '';
            document.getElementById('inp-weight').value = '';
            document.getElementById('log-form').classList.add('show');
          }
          renderPills();
        });
      });
    }

    function renderList() {
      var arr = load();
      var c = document.getElementById('today-list');
      if (!arr.length) {
        c.innerHTML = '<div class="empty-msg">No exercises yet. Tap a pill above to start!</div>';
        return;
      }
      c.innerHTML = arr.map(function(ex, i) {
        var detail = ex.sets + ' sets x ' + ex.reps + ' reps' + (ex.weight ? ' · ' + ex.weight + 'kg' : '');
        return '<div class="ex-item"><div class="ex-body"><div class="ex-name">' + ex.name +
          '</div><div class="ex-detail">' + detail + '</div></div>' +
          '<div class="ex-del" data-i="' + i + '">x</div></div>';
      }).join('');
      c.querySelectorAll('.ex-del').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var arr2 = load();
          arr2.splice(parseInt(this.dataset.i), 1);
          save(arr2);
          renderList();
          renderWeek();
        });
      });
    }

    function renderWeek() {
      var total = 0;
      for (var i = 0; i < 7; i++) {
        var d = new Date(today);
        d.setDate(d.getDate() - i);
        var raw = localStorage.getItem(dateKey(d));
        if (raw) total += JSON.parse(raw).length;
      }
      document.getElementById('week-num').textContent = total;
    }

    document.getElementById('btn-log').addEventListener('click', function() {
      var sets = parseInt(document.getElementById('inp-sets').value);
      var reps = parseInt(document.getElementById('inp-reps').value);
      var weight = document.getElementById('inp-weight').value.trim();
      if (!sets || sets < 1 || !reps || reps < 1) {
        alert('Please enter sets and reps.');
        return;
      }
      var arr = load();
      arr.push({ name: selected, sets: sets, reps: reps, weight: weight || null });
      save(arr);
      selected = null;
      document.getElementById('log-form').classList.remove('show');
      renderPills();
      renderList();
      renderWeek();
    });

    renderPills();
    renderList();
    renderWeek();
  </script>
</body>
</html>`;

// ── Demo App 2: Daily Habits ──────────────────────────────────────────────────

const HABITS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Daily Habits</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
      background: #F2F2F7;
      color: #1C1C1E;
      -webkit-font-smoothing: antialiased;
    }
    .header {
      background: #fff;
      padding: 14px 16px;
      border-bottom: 0.5px solid #C6C6C8;
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header-left h1 { font-size: 22px; font-weight: 700; }
    .streak { font-size: 14px; font-weight: 600; color: #FF9500; margin-top: 3px; }
    .btn-add {
      background: #34C759;
      color: #fff;
      border: none;
      border-radius: 20px;
      width: 34px;
      height: 34px;
      font-size: 22px;
      font-family: inherit;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .btn-add:active { opacity: 0.75; }
    .card {
      background: #fff;
      border-radius: 12px;
      margin: 12px;
      overflow: hidden;
    }
    .card-title {
      font-size: 12px;
      font-weight: 600;
      color: #8E8E93;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      padding: 12px 16px 8px;
    }
    .habit-row {
      display: flex;
      align-items: center;
      padding: 14px 16px;
      border-bottom: 0.5px solid #F2F2F7;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .habit-row:last-child { border-bottom: none; }
    .circle {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: 2px solid #34C759;
      margin-right: 14px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .circle.done { background: #34C759; }
    .check {
      display: none;
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      margin-top: -1px;
    }
    .circle.done .check { display: block; }
    .habit-name { font-size: 16px; flex: 1; }
    .habit-name.done { text-decoration: line-through; color: #8E8E93; }
    .progress-wrap { padding: 10px 16px 16px; }
    .progress-label { font-size: 13px; color: #8E8E93; margin-bottom: 6px; }
    .progress-bar-bg {
      height: 8px;
      background: #E5E5EA;
      border-radius: 4px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      background: #34C759;
      border-radius: 4px;
      transition: width 0.3s ease;
    }
    .heatmap {
      padding: 4px 16px 16px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .hm-cell {
      width: calc((100% - 29px) / 30);
      aspect-ratio: 1;
      border-radius: 3px;
      background: #E5E5EA;
      min-width: 6px;
    }
    .hm-partial { background: #BBF7D0; }
    .hm-done { background: #16A34A; }
    .hm-today { outline: 2px solid #34C759; outline-offset: 1px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>Daily Habits</h1>
      <div class="streak" id="streak-lbl">-- 0 day streak</div>
    </div>
    <button class="btn-add" id="btn-add">+</button>
  </div>

  <div class="card">
    <div class="card-title">Today</div>
    <div id="habits-list"></div>
    <div class="progress-wrap">
      <div class="progress-label" id="progress-lbl">0 of 5 complete</div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" id="progress-fill" style="width:0%"></div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">Last 30 Days</div>
    <div class="heatmap" id="heatmap"></div>
  </div>

  <script>
    var DEFAULT_HABITS = ['Drink 2L Water','Exercise 30min','Read 20min','No junk food','Sleep by 11pm'];

    function dateStr(d) {
      var y = d.getFullYear();
      var m = String(d.getMonth()+1).padStart(2,'0');
      var day = String(d.getDate()).padStart(2,'0');
      return y + '-' + m + '-' + day;
    }

    var today = new Date();
    var todayStr = dateStr(today);

    function getHabits() {
      var raw = localStorage.getItem('habits_list');
      return raw ? JSON.parse(raw) : DEFAULT_HABITS.slice();
    }
    function setHabits(arr) { localStorage.setItem('habits_list', JSON.stringify(arr)); }
    function getTodayDone() {
      var raw = localStorage.getItem('habits_' + todayStr);
      return raw ? JSON.parse(raw) : [];
    }
    function setTodayDone(arr) { localStorage.setItem('habits_' + todayStr, JSON.stringify(arr)); }

    function renderHabits() {
      var habits = getHabits();
      var done = getTodayDone();
      var c = document.getElementById('habits-list');
      c.innerHTML = habits.map(function(h, i) {
        var isDone = done.indexOf(h) !== -1;
        return '<div class="habit-row" data-i="' + i + '">' +
          '<div class="circle' + (isDone ? ' done' : '') + '"><span class="check">v</span></div>' +
          '<div class="habit-name' + (isDone ? ' done' : '') + '">' + h + '</div>' +
          '</div>';
      }).join('');
      c.querySelectorAll('.habit-row').forEach(function(row) {
        row.addEventListener('click', function() {
          var habits2 = getHabits();
          var habit = habits2[parseInt(this.dataset.i)];
          var done2 = getTodayDone();
          var idx = done2.indexOf(habit);
          if (idx === -1) done2.push(habit); else done2.splice(idx, 1);
          setTodayDone(done2);
          renderHabits();
          renderStreak();
          renderHeatmap();
        });
      });
      var total = habits.length;
      var doneCount = done.filter(function(h) { return habits.indexOf(h) !== -1; }).length;
      document.getElementById('progress-lbl').textContent = doneCount + ' of ' + total + ' complete';
      document.getElementById('progress-fill').style.width = (total ? Math.round(doneCount / total * 100) : 0) + '%';
    }

    function renderStreak() {
      var streak = 0;
      for (var i = 1; i <= 365; i++) {
        var d = new Date(today);
        d.setDate(d.getDate() - i);
        var ds = dateStr(d);
        var habits = getHabits();
        var done = JSON.parse(localStorage.getItem('habits_' + ds) || '[]');
        var allDone = habits.length > 0 && habits.every(function(h) { return done.indexOf(h) !== -1; });
        if (allDone) streak++; else break;
      }
      var lbl = document.getElementById('streak-lbl');
      lbl.textContent = (streak > 0 ? '\uD83D\uDD25' : '\uD83D\uDCA4') + ' ' + streak + ' day streak';
    }

    function renderHeatmap() {
      var habits = getHabits();
      var c = document.getElementById('heatmap');
      var cells = [];
      for (var i = 29; i >= 0; i--) {
        var d = new Date(today);
        d.setDate(d.getDate() - i);
        var ds = dateStr(d);
        var done = JSON.parse(localStorage.getItem('habits_' + ds) || '[]');
        var doneCount = habits.filter(function(h) { return done.indexOf(h) !== -1; }).length;
        var cls = 'hm-cell';
        if (habits.length > 0 && doneCount === habits.length) cls += ' hm-done';
        else if (doneCount > 0) cls += ' hm-partial';
        if (i === 0) cls += ' hm-today';
        cells.push('<div class="' + cls + '" title="' + ds + '"></div>');
      }
      c.innerHTML = cells.join('');
    }

    document.getElementById('btn-add').addEventListener('click', function() {
      var name = window.prompt('New habit name:');
      if (!name || !name.trim()) return;
      var habits = getHabits();
      habits.push(name.trim());
      setHabits(habits);
      renderHabits();
      renderHeatmap();
    });

    renderHabits();
    renderStreak();
    renderHeatmap();
  </script>
</body>
</html>`;

// ── Demo App 3: Expense Snap ──────────────────────────────────────────────────

const EXPENSE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Expense Snap</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
      background: #F2F2F7;
      color: #1C1C1E;
      -webkit-font-smoothing: antialiased;
    }
    .header {
      background: #fff;
      padding: 12px 16px;
      border-bottom: 0.5px solid #C6C6C8;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .header h1 { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
    .month-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .month-btn {
      background: none;
      border: none;
      font-size: 24px;
      color: #007AFF;
      cursor: pointer;
      padding: 2px 10px;
      -webkit-tap-highlight-color: transparent;
      font-family: inherit;
      line-height: 1;
    }
    .month-btn:active { opacity: 0.6; }
    .month-label { font-size: 15px; font-weight: 600; }
    .add-btn {
      background: #007AFF;
      color: #fff;
      border: none;
      border-radius: 12px;
      padding: 11px 18px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      font-family: inherit;
      display: block;
      margin: 12px 12px 4px;
      width: calc(100% - 24px);
    }
    .add-btn:active { opacity: 0.8; }
    .card {
      background: #fff;
      border-radius: 12px;
      margin: 12px;
      overflow: hidden;
    }
    .card-title {
      font-size: 12px;
      font-weight: 600;
      color: #8E8E93;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      padding: 12px 16px 8px;
    }
    .summary-grid { display: flex; }
    .summary-cell {
      flex: 1;
      padding: 10px 14px 14px;
      border-right: 0.5px solid #F2F2F7;
    }
    .summary-cell:last-child { border-right: none; }
    .summary-val { font-size: 17px; font-weight: 700; }
    .summary-lbl { font-size: 11px; color: #8E8E93; margin-top: 2px; }
    .chart-wrap {
      padding: 8px 16px 16px;
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .chart-legend { flex: 1; min-width: 0; }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 5px;
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
    }
    .legend-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
    .date-header {
      font-size: 12px;
      font-weight: 600;
      color: #8E8E93;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      padding: 10px 16px 4px;
    }
    .exp-row {
      display: flex;
      align-items: center;
      padding: 11px 16px;
      border-bottom: 0.5px solid #F2F2F7;
    }
    .exp-row:last-child { border-bottom: none; }
    .exp-emoji { font-size: 22px; margin-right: 12px; flex-shrink: 0; }
    .exp-body { flex: 1; min-width: 0; }
    .exp-cat { font-size: 14px; font-weight: 500; }
    .exp-note { font-size: 12px; color: #8E8E93; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .exp-amount { font-size: 15px; font-weight: 600; flex-shrink: 0; margin-left: 8px; }
    .empty-msg { text-align: center; color: #8E8E93; font-size: 14px; padding: 24px 16px; }
    /* Bottom sheet */
    .backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      z-index: 100;
    }
    .backdrop.open { display: block; }
    .sheet {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #F2F2F7;
      border-radius: 16px 16px 0 0;
      padding-bottom: 40px;
      transform: translateY(100%);
      transition: transform 0.28s ease;
      z-index: 101;
    }
    .sheet.open { transform: translateY(0); }
    .sheet-handle {
      width: 36px;
      height: 5px;
      background: #C6C6C8;
      border-radius: 3px;
      margin: 10px auto 0;
    }
    .sheet-title { font-size: 17px; font-weight: 600; text-align: center; padding: 12px 0 8px; }
    .sheet-card {
      background: #fff;
      border-radius: 12px;
      margin: 8px 12px;
      overflow: hidden;
    }
    .sheet-row {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 0.5px solid #F2F2F7;
    }
    .sheet-row:last-child { border-bottom: none; }
    .sheet-row label { font-size: 15px; color: #8E8E93; width: 80px; flex-shrink: 0; }
    .amt-wrap { display: flex; align-items: center; flex: 1; }
    .amt-prefix { font-size: 20px; font-weight: 600; margin-right: 4px; }
    .sheet-row input, .sheet-row select {
      flex: 1;
      border: none;
      background: none;
      color: #1C1C1E;
      font-family: inherit;
      -webkit-appearance: none;
      outline: none;
      min-width: 0;
    }
    .sheet-row input[type=number] { font-size: 20px; font-weight: 600; }
    .sheet-row input[type=text], .sheet-row input[type=date] { font-size: 15px; }
    .sheet-row select { font-size: 15px; }
    .sheet-btns { display: flex; gap: 8px; margin: 8px 12px 0; }
    .sheet-btn {
      flex: 1;
      padding: 14px;
      border-radius: 12px;
      border: none;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      -webkit-tap-highlight-color: transparent;
    }
    .sheet-btn.save { background: #007AFF; color: #fff; }
    .sheet-btn.cancel { background: #fff; color: #007AFF; }
    .sheet-btn:active { opacity: 0.75; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Expense Snap</h1>
    <div class="month-nav">
      <button class="month-btn" id="prev-btn">&lsaquo;</button>
      <span class="month-label" id="month-lbl"></span>
      <button class="month-btn" id="next-btn">&rsaquo;</button>
    </div>
  </div>

  <button class="add-btn" id="add-btn">+ Add Expense</button>

  <div class="card" id="summary-card">
    <div class="card-title">This Month</div>
    <div class="summary-grid">
      <div class="summary-cell">
        <div class="summary-val" id="total-val">Rs.0</div>
        <div class="summary-lbl">Total Spent</div>
      </div>
      <div class="summary-cell">
        <div class="summary-val" id="avg-val">Rs.0</div>
        <div class="summary-lbl">Daily Avg</div>
      </div>
      <div class="summary-cell">
        <div class="summary-val" id="top-val">--</div>
        <div class="summary-lbl">Top Category</div>
      </div>
    </div>
    <div class="chart-wrap">
      <svg id="pie-svg" width="80" height="80" viewBox="0 0 80 80" style="flex-shrink:0"></svg>
      <div class="chart-legend" id="legend"></div>
    </div>
  </div>

  <div id="expense-list"></div>

  <div class="backdrop" id="backdrop"></div>
  <div class="sheet" id="sheet">
    <div class="sheet-handle"></div>
    <div class="sheet-title">Add Expense</div>
    <div class="sheet-card">
      <div class="sheet-row">
        <label>Amount</label>
        <div class="amt-wrap">
          <span class="amt-prefix">Rs.</span>
          <input type="number" id="inp-amount" placeholder="0" min="0" step="1">
        </div>
      </div>
      <div class="sheet-row">
        <label>Category</label>
        <select id="inp-cat">
          <option value="Food">Food</option>
          <option value="Transport">Transport</option>
          <option value="Shopping">Shopping</option>
          <option value="Bills">Bills</option>
          <option value="Health">Health</option>
          <option value="Entertainment">Entertainment</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <div class="sheet-row">
        <label>Note</label>
        <input type="text" id="inp-note" placeholder="Optional">
      </div>
      <div class="sheet-row">
        <label>Date</label>
        <input type="date" id="inp-date">
      </div>
    </div>
    <div class="sheet-btns">
      <button class="sheet-btn cancel" id="btn-cancel">Cancel</button>
      <button class="sheet-btn save" id="btn-save">Save</button>
    </div>
  </div>

  <script>
    var CAT_EMOJI = {
      'Food': '\uD83C\uDF55',
      'Transport': '\uD83D\uDE97',
      'Shopping': '\uD83D\uDECD\uFE0F',
      'Bills': '\uD83D\uDCF1',
      'Health': '\uD83C\uDFE5',
      'Entertainment': '\uD83C\uDFAE',
      'Other': '\uD83D\uDCE6'
    };
    var CAT_COLORS = {
      'Food': '#FF6B6B',
      'Transport': '#4ECDC4',
      'Shopping': '#A29BFE',
      'Bills': '#FDCB6E',
      'Health': '#6C5CE7',
      'Entertainment': '#FD79A8',
      'Other': '#B2BEC3'
    };

    var viewYear, viewMonth;
    var today = new Date();

    function initMonth() {
      viewYear = today.getFullYear();
      viewMonth = today.getMonth();
    }
    initMonth();

    function monthKey() {
      return 'expenses_' + viewYear + '-' + String(viewMonth + 1).padStart(2, '0');
    }

    function fmtMonth() {
      return new Date(viewYear, viewMonth, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    }

    function loadExpenses() {
      return JSON.parse(localStorage.getItem(monthKey()) || '[]');
    }
    function saveExpenses(arr) { localStorage.setItem(monthKey(), JSON.stringify(arr)); }

    function fmt(n) {
      return 'Rs.' + Math.round(n).toLocaleString('en-IN');
    }

    function renderAll() {
      document.getElementById('month-lbl').textContent = fmtMonth();
      var expenses = loadExpenses();

      var total = expenses.reduce(function(s, e) { return s + e.amount; }, 0);
      var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
      var avg = daysInMonth > 0 ? total / daysInMonth : 0;

      var catTotals = {};
      expenses.forEach(function(e) {
        catTotals[e.category] = (catTotals[e.category] || 0) + e.amount;
      });
      var topCat = Object.keys(catTotals).sort(function(a, b) { return catTotals[b] - catTotals[a]; })[0] || null;

      document.getElementById('total-val').textContent = fmt(total);
      document.getElementById('avg-val').textContent = fmt(avg);
      document.getElementById('top-val').textContent = topCat ? (CAT_EMOJI[topCat] || '') + ' ' + topCat : '--';

      renderPie(catTotals, total);

      var byDate = {};
      expenses.forEach(function(e) {
        if (!byDate[e.date]) byDate[e.date] = [];
        byDate[e.date].push(e);
      });
      var dates = Object.keys(byDate).sort(function(a, b) { return b.localeCompare(a); });

      var listEl = document.getElementById('expense-list');
      if (!dates.length) {
        listEl.innerHTML = '<div class="card"><div class="empty-msg">No expenses this month.<br>Tap \u201c+ Add Expense\u201d to start!</div></div>';
        return;
      }
      listEl.innerHTML = dates.map(function(date) {
        var d = new Date(date + 'T00:00:00');
        var header = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
        var rows = byDate[date].map(function(e) {
          return '<div class="exp-row">' +
            '<div class="exp-emoji">' + (CAT_EMOJI[e.category] || '') + '</div>' +
            '<div class="exp-body"><div class="exp-cat">' + e.category + '</div>' +
            (e.note ? '<div class="exp-note">' + e.note + '</div>' : '') +
            '</div><div class="exp-amount">' + fmt(e.amount) + '</div></div>';
        }).join('');
        return '<div class="card"><div class="date-header">' + header + '</div>' + rows + '</div>';
      }).join('');
    }

    function polarXY(cx, cy, r, angleDeg) {
      var rad = (angleDeg - 90) * Math.PI / 180;
      return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
    }

    function slicePath(cx, cy, r, startAngle, endAngle) {
      var s = polarXY(cx, cy, r, startAngle);
      var e = polarXY(cx, cy, r, endAngle);
      var large = (endAngle - startAngle) > 180 ? 1 : 0;
      return 'M ' + cx + ' ' + cy +
        ' L ' + s.x.toFixed(2) + ' ' + s.y.toFixed(2) +
        ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + e.x.toFixed(2) + ' ' + e.y.toFixed(2) + ' Z';
    }

    function renderPie(catTotals, total) {
      var svg = document.getElementById('pie-svg');
      var legend = document.getElementById('legend');
      if (!total) {
        svg.innerHTML = '<circle cx="40" cy="40" r="38" fill="#E5E5EA"/>';
        legend.innerHTML = '<div style="font-size:12px;color:#8E8E93">No data yet</div>';
        return;
      }
      var cats = Object.keys(catTotals).sort(function(a, b) { return catTotals[b] - catTotals[a]; });
      var angle = 0;
      var paths = '';
      cats.forEach(function(cat) {
        var slice = catTotals[cat] / total * 360;
        if (slice < 0.5) return;
        paths += '<path d="' + slicePath(40, 40, 38, angle, angle + slice) +
          '" fill="' + (CAT_COLORS[cat] || '#B2BEC3') + '"/>';
        angle += slice;
      });
      svg.innerHTML = paths;
      legend.innerHTML = cats.slice(0, 4).map(function(cat) {
        var pct = Math.round(catTotals[cat] / total * 100);
        return '<div class="legend-item"><div class="legend-dot" style="background:' +
          (CAT_COLORS[cat] || '#B2BEC3') + '"></div>' +
          (CAT_EMOJI[cat] || '') + ' ' + cat + ' ' + pct + '%</div>';
      }).join('');
    }

    document.getElementById('prev-btn').addEventListener('click', function() {
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      renderAll();
    });
    document.getElementById('next-btn').addEventListener('click', function() {
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      renderAll();
    });

    function todayStr() {
      var y = today.getFullYear();
      var m = String(today.getMonth() + 1).padStart(2, '0');
      var d = String(today.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }

    function openSheet() {
      document.getElementById('inp-amount').value = '';
      document.getElementById('inp-cat').value = 'Food';
      document.getElementById('inp-note').value = '';
      document.getElementById('inp-date').value = todayStr();
      document.getElementById('backdrop').classList.add('open');
      document.getElementById('sheet').classList.add('open');
    }
    function closeSheet() {
      document.getElementById('backdrop').classList.remove('open');
      document.getElementById('sheet').classList.remove('open');
    }

    document.getElementById('add-btn').addEventListener('click', openSheet);
    document.getElementById('backdrop').addEventListener('click', closeSheet);
    document.getElementById('btn-cancel').addEventListener('click', closeSheet);
    document.getElementById('btn-save').addEventListener('click', function() {
      var amount = parseFloat(document.getElementById('inp-amount').value);
      if (!amount || amount <= 0) { alert('Please enter a valid amount.'); return; }
      var cat = document.getElementById('inp-cat').value;
      var note = document.getElementById('inp-note').value.trim();
      var date = document.getElementById('inp-date').value;
      if (!date) { alert('Please select a date.'); return; }
      var expenses = loadExpenses();
      expenses.push({ id: Date.now().toString(), amount: amount, category: cat, note: note, date: date });
      saveExpenses(expenses);
      closeSheet();
      renderAll();
    });

    renderAll();
  </script>
</body>
</html>`;
