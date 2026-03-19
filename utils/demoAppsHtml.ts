// ── Workout Log ───────────────────────────────────────────────────────────────

export const WORKOUT_LOG_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
<title>Workout Log</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #F2F2F7; color: #1C1C1E; padding: 0;
    padding-top: env(safe-area-inset-top, 20px);
    padding-bottom: env(safe-area-inset-bottom, 20px);
    min-height: 100vh;
  }
  .header {
    background: #F2F2F7; padding: 16px 20px 8px; position: sticky; top: 0; z-index: 10;
  }
  .header h1 { font-size: 28px; font-weight: 700; }
  .header .date { font-size: 14px; color: #8E8E93; margin-top: 2px; }
  .section { background: #fff; border-radius: 12px; margin: 12px 16px; overflow: hidden; }
  .section-title { font-size: 13px; font-weight: 600; color: #8E8E93; text-transform: uppercase; padding: 8px 16px 4px; }
  .quick-adds { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 16px; }
  .pill {
    padding: 8px 16px; border-radius: 20px; border: 1.5px solid #007AFF;
    color: #007AFF; font-size: 14px; font-weight: 500; background: #fff;
    cursor: pointer; transition: all 0.15s;
  }
  .pill:active, .pill.active { background: #007AFF; color: #fff; }
  .form-area { padding: 0 16px 16px; display: none; }
  .form-area.visible { display: block; }
  .form-row { display: flex; gap: 8px; margin-top: 10px; align-items: center; }
  .form-row input {
    flex: 1; padding: 10px 12px; border: 1px solid #E5E5EA; border-radius: 10px;
    font-size: 16px; font-family: inherit; background: #F9F9F9;
  }
  .form-row input:focus { outline: none; border-color: #007AFF; background: #fff; }
  .form-label { font-size: 12px; color: #8E8E93; min-width: 40px; }
  .btn-log {
    width: 100%; padding: 12px; background: #007AFF; color: #fff; border: none;
    border-radius: 10px; font-size: 16px; font-weight: 600; margin-top: 12px;
    cursor: pointer; font-family: inherit;
  }
  .btn-log:active { background: #005EC4; }
  .btn-cancel {
    width: 100%; padding: 10px; background: none; color: #8E8E93; border: none;
    font-size: 14px; margin-top: 6px; cursor: pointer; font-family: inherit;
  }
  .workout-list { list-style: none; }
  .workout-item {
    padding: 14px 16px; border-bottom: 0.5px solid #E5E5EA;
    display: flex; justify-content: space-between; align-items: center;
  }
  .workout-item:last-child { border-bottom: none; }
  .workout-item .name { font-size: 16px; font-weight: 500; }
  .workout-item .details { font-size: 14px; color: #8E8E93; margin-top: 2px; }
  .workout-item .delete {
    color: #FF3B30; font-size: 13px; padding: 6px 12px; border: 1px solid #FF3B30;
    border-radius: 8px; background: none; cursor: pointer; font-family: inherit;
  }
  .summary-card {
    padding: 16px; display: flex; justify-content: space-around; text-align: center;
  }
  .summary-stat .number { font-size: 28px; font-weight: 700; color: #007AFF; }
  .summary-stat .label { font-size: 12px; color: #8E8E93; margin-top: 2px; }
  .empty { text-align: center; padding: 32px 16px; color: #8E8E93; font-size: 15px; }
  .notify-btn {
    display: block; margin: 0 auto; padding: 10px 20px; background: none;
    color: #007AFF; border: 1px solid #007AFF; border-radius: 10px;
    font-size: 14px; cursor: pointer; font-family: inherit; margin-top: 12px;
  }
</style>
</head>
<body>
<div class="header">
  <h1>Workout Log</h1>
  <div class="date" id="todayDate"></div>
</div>

<div class="section">
  <div class="section-title">Quick Add</div>
  <div class="quick-adds" id="quickAdds"></div>
  <div class="form-area" id="formArea">
    <div class="form-row">
      <span class="form-label">Sets</span>
      <input type="number" id="inputSets" placeholder="3" min="1" inputmode="numeric">
      <span class="form-label">Reps</span>
      <input type="number" id="inputReps" placeholder="10" min="1" inputmode="numeric">
    </div>
    <div class="form-row">
      <span class="form-label">Weight</span>
      <input type="number" id="inputWeight" placeholder="Optional (kg)" min="0" step="0.5" inputmode="decimal">
    </div>
    <button class="btn-log" onclick="logExercise()">Log Exercise</button>
    <button class="btn-cancel" onclick="cancelForm()">Cancel</button>
  </div>
</div>

<div class="section">
  <div class="section-title">Today's Workout</div>
  <ul class="workout-list" id="workoutList"></ul>
  <div class="empty" id="emptyState">No exercises logged today. Tap an exercise above to start!</div>
</div>

<div class="section">
  <div class="section-title">This Week</div>
  <div class="summary-card">
    <div class="summary-stat">
      <div class="number" id="weekWorkouts">0</div>
      <div class="label">Workouts</div>
    </div>
    <div class="summary-stat">
      <div class="number" id="weekExercises">0</div>
      <div class="label">Exercises</div>
    </div>
    <div class="summary-stat">
      <div class="number" id="weekVolume">0</div>
      <div class="label">Total Volume</div>
    </div>
  </div>
</div>

<div style="padding: 16px; text-align: center;">
  <button class="notify-btn" onclick="setReminder()">🔔 Remind me to workout in 1 hour</button>
</div>

<script>
var EXERCISES = ['Push-ups', 'Squats', 'Deadlift', 'Bench Press', 'Running', 'Pull-ups'];
var selectedExercise = null;

function getDateKey(d) {
  return d.toISOString().split('T')[0];
}

var today = getDateKey(new Date());

document.getElementById('todayDate').textContent = new Date().toLocaleDateString(undefined, {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
});

var quickAddsEl = document.getElementById('quickAdds');
EXERCISES.forEach(function(ex) {
  var pill = document.createElement('button');
  pill.className = 'pill';
  pill.textContent = ex;
  pill.onclick = function() { selectExercise(ex, pill); };
  quickAddsEl.appendChild(pill);
});

function selectExercise(name, pillEl) {
  document.querySelectorAll('.pill').forEach(function(p) { p.classList.remove('active'); });
  pillEl.classList.add('active');
  selectedExercise = name;
  document.getElementById('formArea').classList.add('visible');
  document.getElementById('inputSets').focus();
}

function cancelForm() {
  document.querySelectorAll('.pill').forEach(function(p) { p.classList.remove('active'); });
  document.getElementById('formArea').classList.remove('visible');
  selectedExercise = null;
}

function logExercise() {
  if (!selectedExercise) return;
  var sets = parseInt(document.getElementById('inputSets').value) || 3;
  var reps = parseInt(document.getElementById('inputReps').value) || 10;
  var weight = parseFloat(document.getElementById('inputWeight').value) || 0;

  var workouts = JSON.parse(localStorage.getItem('workouts_' + today) || '[]');
  workouts.push({
    id: Date.now().toString(),
    name: selectedExercise,
    sets: sets, reps: reps, weight: weight,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });
  localStorage.setItem('workouts_' + today, JSON.stringify(workouts));

  if (window.VaultAPI && window.VaultAPI.device && window.VaultAPI.device.haptic) {
    window.VaultAPI.device.haptic('medium');
  }

  document.getElementById('inputSets').value = '';
  document.getElementById('inputReps').value = '';
  document.getElementById('inputWeight').value = '';
  cancelForm();
  renderToday();
  renderWeekSummary();
}

function deleteExercise(id) {
  var workouts = JSON.parse(localStorage.getItem('workouts_' + today) || '[]');
  workouts = workouts.filter(function(w) { return w.id !== id; });
  localStorage.setItem('workouts_' + today, JSON.stringify(workouts));
  renderToday();
  renderWeekSummary();
}

function renderToday() {
  var workouts = JSON.parse(localStorage.getItem('workouts_' + today) || '[]');
  var list = document.getElementById('workoutList');
  var empty = document.getElementById('emptyState');

  if (workouts.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = workouts.map(function(w) {
    var weightStr = w.weight > 0 ? ' @ ' + w.weight + 'kg' : '';
    return '<li class="workout-item"><div><div class="name">' + w.name + '</div>' +
      '<div class="details">' + w.sets + ' \u00d7 ' + w.reps + weightStr + ' \u00b7 ' + w.time + '</div></div>' +
      '<button class="delete" onclick="deleteExercise(\\'' + w.id + '\\')">Remove</button></li>';
  }).join('');
}

function renderWeekSummary() {
  var totalWorkoutDays = 0, totalExercises = 0, totalVolume = 0;
  var now = new Date();
  for (var i = 0; i < 7; i++) {
    var d = new Date(now);
    d.setDate(d.getDate() - i);
    var key = getDateKey(d);
    var workouts = JSON.parse(localStorage.getItem('workouts_' + key) || '[]');
    if (workouts.length > 0) totalWorkoutDays++;
    totalExercises += workouts.length;
    workouts.forEach(function(w) { totalVolume += (w.sets * w.reps * (w.weight || 1)); });
  }
  document.getElementById('weekWorkouts').textContent = totalWorkoutDays;
  document.getElementById('weekExercises').textContent = totalExercises;
  document.getElementById('weekVolume').textContent = totalVolume > 999
    ? (totalVolume / 1000).toFixed(1) + 'k' : totalVolume;
}

function setReminder() {
  if (window.VaultAPI && window.VaultAPI.device && window.VaultAPI.device.notify) {
    window.VaultAPI.device.notify({
      title: 'Time to workout! \uD83D\uDCAA',
      body: 'Your daily workout reminder from Workout Log',
      delay_seconds: 3600
    });
    alert('Reminder set for 1 hour from now!');
  } else {
    alert('Notifications not available in browser. Install in Cottix for reminders!');
  }
}

renderToday();
renderWeekSummary();
</script>
</body>
</html>`;

// ── Daily Habits ──────────────────────────────────────────────────────────────

export const DAILY_HABITS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
<title>Daily Habits</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #F2F2F7; color: #1C1C1E;
    padding-top: env(safe-area-inset-top, 20px);
    padding-bottom: env(safe-area-inset-bottom, 20px);
    min-height: 100vh;
  }
  .header { background: #F2F2F7; padding: 16px 20px 8px; position: sticky; top: 0; z-index: 10; }
  .header h1 { font-size: 28px; font-weight: 700; }
  .streak { display: inline-block; font-size: 15px; color: #FF9500; font-weight: 600; margin-top: 4px; }
  .section { background: #fff; border-radius: 12px; margin: 12px 16px; overflow: hidden; }
  .section-title { font-size: 13px; font-weight: 600; color: #8E8E93; text-transform: uppercase; padding: 8px 16px 4px; }
  .habit-item {
    padding: 14px 16px; border-bottom: 0.5px solid #E5E5EA;
    display: flex; align-items: center; gap: 14px; cursor: pointer;
    transition: background 0.1s;
  }
  .habit-item:active { background: #F2F2F7; }
  .habit-item:last-child { border-bottom: none; }
  .habit-check {
    width: 28px; height: 28px; border-radius: 50%; border: 2px solid #D1D1D6;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; transition: all 0.2s; flex-shrink: 0;
  }
  .habit-check.done { background: #34C759; border-color: #34C759; color: #fff; }
  .habit-name { font-size: 16px; flex: 1; }
  .habit-name.done { color: #8E8E93; text-decoration: line-through; }
  .progress-bar-container { padding: 16px; }
  .progress-bar-bg {
    height: 8px; background: #E5E5EA; border-radius: 4px; overflow: hidden;
  }
  .progress-bar-fill {
    height: 100%; background: #34C759; border-radius: 4px; transition: width 0.3s ease;
  }
  .progress-text { font-size: 14px; color: #8E8E93; margin-top: 6px; text-align: center; }
  .add-btn {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    padding: 14px 16px; color: #007AFF; font-size: 16px; cursor: pointer;
    border-bottom: none; font-weight: 500;
  }
  .heatmap { padding: 16px; }
  .heatmap-grid { display: flex; gap: 3px; flex-wrap: wrap; justify-content: center; }
  .heatmap-cell {
    width: 16px; height: 16px; border-radius: 3px; background: #E5E5EA;
  }
  .heatmap-cell.partial { background: #A8E6A3; }
  .heatmap-cell.full { background: #34C759; }
  .heatmap-cell.today { outline: 2px solid #007AFF; outline-offset: 1px; }
  .heatmap-legend {
    display: flex; justify-content: center; gap: 12px; margin-top: 10px; font-size: 11px; color: #8E8E93;
  }
  .heatmap-legend span { display: flex; align-items: center; gap: 4px; }
  .heatmap-legend .box { width: 12px; height: 12px; border-radius: 2px; display: inline-block; }
  .delete-habit {
    color: #FF3B30; font-size: 13px; padding: 4px 10px; border: 1px solid #FF3B30;
    border-radius: 6px; background: none; cursor: pointer; font-family: inherit;
  }
</style>
</head>
<body>
<div class="header">
  <h1>Daily Habits</h1>
  <div class="streak" id="streakDisplay">\uD83D\uDD25 0 day streak</div>
</div>

<div class="section">
  <div id="habitsList"></div>
  <div class="add-btn" onclick="addHabit()">+ Add Habit</div>
</div>

<div class="section">
  <div class="progress-bar-container">
    <div class="progress-bar-bg"><div class="progress-bar-fill" id="progressFill"></div></div>
    <div class="progress-text" id="progressText">0 of 0 complete</div>
  </div>
</div>

<div class="section">
  <div class="section-title">Last 30 Days</div>
  <div class="heatmap">
    <div class="heatmap-grid" id="heatmapGrid"></div>
    <div class="heatmap-legend">
      <span><div class="box" style="background:#E5E5EA"></div> None</span>
      <span><div class="box" style="background:#A8E6A3"></div> Some</span>
      <span><div class="box" style="background:#34C759"></div> All done</span>
    </div>
  </div>
</div>

<script>
var DEFAULT_HABITS = ['Drink 2L Water', 'Exercise 30min', 'Read 20min', 'No junk food', 'Sleep by 11pm'];

function getDateKey(d) { return d.toISOString().split('T')[0]; }
var today = getDateKey(new Date());

function getHabits() {
  var stored = localStorage.getItem('habits_list');
  if (!stored) {
    localStorage.setItem('habits_list', JSON.stringify(DEFAULT_HABITS));
    return DEFAULT_HABITS.slice();
  }
  return JSON.parse(stored);
}

function getTodayStatus() {
  return JSON.parse(localStorage.getItem('habits_' + today) || '{}');
}

function saveTodayStatus(status) {
  localStorage.setItem('habits_' + today, JSON.stringify(status));
}

function toggleHabit(name) {
  var status = getTodayStatus();
  status[name] = !status[name];
  saveTodayStatus(status);

  if (window.VaultAPI && window.VaultAPI.device && window.VaultAPI.device.haptic) {
    window.VaultAPI.device.haptic('light');
  }

  var habits = getHabits();
  var allDone = habits.every(function(h) { return status[h]; });
  if (allDone && window.VaultAPI && window.VaultAPI.device && window.VaultAPI.device.haptic) {
    window.VaultAPI.device.haptic('success');
  }

  render();
}

function addHabit() {
  var name = prompt('New habit name:');
  if (!name || !name.trim()) return;
  var habits = getHabits();
  habits.push(name.trim());
  localStorage.setItem('habits_list', JSON.stringify(habits));
  render();
}

function deleteHabit(name) {
  if (!confirm('Delete "' + name + '"?')) return;
  var habits = getHabits();
  habits = habits.filter(function(h) { return h !== name; });
  localStorage.setItem('habits_list', JSON.stringify(habits));
  render();
}

function calculateStreak() {
  var habits = getHabits();
  var streak = 0;
  var now = new Date();

  for (var i = 0; i < 365; i++) {
    var d = new Date(now);
    d.setDate(d.getDate() - i);
    var key = getDateKey(d);
    var status = JSON.parse(localStorage.getItem('habits_' + key) || '{}');
    var allDone = habits.length > 0 && habits.every(function(h) { return status[h]; });

    if (i === 0 && !allDone) continue;
    if (i > 0 && !allDone) break;
    streak++;
  }
  return streak;
}

function render() {
  var habits = getHabits();
  var status = getTodayStatus();
  var doneCount = habits.filter(function(h) { return status[h]; }).length;

  document.getElementById('habitsList').innerHTML = habits.map(function(h) {
    var done = status[h];
    var safeName = h.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");
    return '<div class="habit-item" onclick="toggleHabit(\\'' + safeName + '\\')">' +
      '<div class="habit-check ' + (done ? 'done' : '') + '">' + (done ? '\u2713' : '') + '</div>' +
      '<span class="habit-name ' + (done ? 'done' : '') + '">' + h + '</span>' +
      '<button class="delete-habit" onclick="event.stopPropagation(); deleteHabit(\\'' + safeName + '\\')">×</button>' +
      '</div>';
  }).join('');

  var pct = habits.length > 0 ? (doneCount / habits.length * 100) : 0;
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressText').textContent = doneCount + ' of ' + habits.length + ' complete';

  var streak = calculateStreak();
  document.getElementById('streakDisplay').textContent = '\uD83D\uDD25 ' + streak + ' day streak';

  renderHeatmap(habits);
}

function renderHeatmap(habits) {
  var grid = document.getElementById('heatmapGrid');
  grid.innerHTML = '';
  var now = new Date();

  for (var i = 29; i >= 0; i--) {
    var d = new Date(now);
    d.setDate(d.getDate() - i);
    var key = getDateKey(d);
    var status = JSON.parse(localStorage.getItem('habits_' + key) || '{}');

    var doneCount = habits.filter(function(h) { return status[h]; }).length;
    var cls = 'heatmap-cell';
    if (doneCount > 0 && doneCount < habits.length) cls += ' partial';
    else if (doneCount > 0 && doneCount >= habits.length) cls += ' full';
    if (i === 0) cls += ' today';

    var cell = document.createElement('div');
    cell.className = cls;
    cell.title = key + ': ' + doneCount + '/' + habits.length;
    grid.appendChild(cell);
  }
}

render();
</script>
</body>
</html>`;

// ── Expense Snap ──────────────────────────────────────────────────────────────

export const EXPENSE_SNAP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
<title>Expense Snap</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #F2F2F7; color: #1C1C1E;
    padding-top: env(safe-area-inset-top, 20px);
    padding-bottom: env(safe-area-inset-bottom, 20px);
    min-height: 100vh;
  }
  .header { background: #F2F2F7; padding: 16px 20px 8px; position: sticky; top: 0; z-index: 10; }
  .header h1 { font-size: 28px; font-weight: 700; }
  .month-nav {
    display: flex; align-items: center; justify-content: center; gap: 20px;
    padding: 12px 0;
  }
  .month-nav button {
    background: none; border: none; color: #007AFF; font-size: 20px;
    cursor: pointer; padding: 4px 8px; font-family: inherit;
  }
  .month-nav .month-label { font-size: 17px; font-weight: 600; min-width: 160px; text-align: center; }
  .section { background: #fff; border-radius: 12px; margin: 12px 16px; overflow: hidden; }
  .summary-cards { display: flex; gap: 8px; padding: 12px 16px; }
  .summary-card {
    flex: 1; background: #F2F2F7; border-radius: 10px; padding: 12px; text-align: center;
  }
  .summary-card .amount { font-size: 20px; font-weight: 700; color: #1C1C1E; }
  .summary-card .label { font-size: 11px; color: #8E8E93; margin-top: 2px; }
  .add-expense-btn {
    display: block; width: calc(100% - 32px); margin: 12px 16px; padding: 14px;
    background: #007AFF; color: #fff; border: none; border-radius: 12px;
    font-size: 16px; font-weight: 600; cursor: pointer; font-family: inherit;
    text-align: center;
  }
  .add-expense-btn:active { background: #005EC4; }
  .overlay {
    display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.4); z-index: 100; justify-content: flex-end;
    align-items: stretch; flex-direction: column;
  }
  .overlay.visible { display: flex; }
  .form-sheet {
    background: #F2F2F7; border-radius: 16px 16px 0 0; padding: 20px;
    padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
    max-height: 80vh; overflow-y: auto;
  }
  .form-sheet .drag-handle {
    width: 36px; height: 5px; background: #D1D1D6; border-radius: 3px;
    margin: 0 auto 16px;
  }
  .form-sheet h2 { font-size: 20px; font-weight: 600; margin-bottom: 16px; }
  .form-group { margin-bottom: 14px; }
  .form-group label { font-size: 13px; color: #8E8E93; display: block; margin-bottom: 4px; font-weight: 600; }
  .form-group input, .form-group select {
    width: 100%; padding: 12px; border: 1px solid #E5E5EA; border-radius: 10px;
    font-size: 16px; font-family: inherit; background: #fff;
  }
  .form-group input:focus, .form-group select:focus { outline: none; border-color: #007AFF; }
  .amount-input-wrapper { position: relative; }
  .amount-input-wrapper .currency {
    position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
    font-size: 18px; font-weight: 600; color: #8E8E93;
  }
  .amount-input-wrapper input { padding-left: 28px; font-size: 24px; font-weight: 600; }
  .form-actions { display: flex; gap: 10px; margin-top: 16px; }
  .form-actions button {
    flex: 1; padding: 14px; border-radius: 10px; font-size: 16px; font-weight: 600;
    cursor: pointer; font-family: inherit; border: none;
  }
  .btn-save { background: #007AFF; color: #fff; }
  .btn-save:active { background: #005EC4; }
  .btn-form-cancel { background: #E5E5EA; color: #1C1C1E; }
  .expense-group-header { padding: 8px 16px; font-size: 13px; font-weight: 600; color: #8E8E93; }
  .expense-item {
    padding: 12px 16px; border-bottom: 0.5px solid #E5E5EA;
    display: flex; align-items: center; gap: 12px;
  }
  .expense-item:last-child { border-bottom: none; }
  .expense-emoji { font-size: 24px; width: 36px; text-align: center; }
  .expense-info { flex: 1; }
  .expense-info .category { font-size: 14px; font-weight: 500; }
  .expense-info .note { font-size: 13px; color: #8E8E93; }
  .expense-amount { font-size: 16px; font-weight: 600; color: #1C1C1E; }
  .empty { text-align: center; padding: 32px 16px; color: #8E8E93; font-size: 15px; }
  .pie-container { padding: 16px; display: flex; justify-content: center; align-items: center; gap: 16px; flex-wrap: wrap; }
  .pie-legend { font-size: 13px; }
  .pie-legend-item { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .pie-legend-dot { width: 10px; height: 10px; border-radius: 50%; }
  .share-btn {
    display: block; margin: 12px auto; padding: 10px 20px; background: none;
    color: #007AFF; border: 1px solid #007AFF; border-radius: 10px;
    font-size: 14px; cursor: pointer; font-family: inherit;
  }
</style>
</head>
<body>
<div class="header">
  <h1>Expense Snap</h1>
</div>

<div class="month-nav">
  <button onclick="changeMonth(-1)">\u2039</button>
  <span class="month-label" id="monthLabel"></span>
  <button onclick="changeMonth(1)">\u203a</button>
</div>

<div class="section">
  <div class="summary-cards">
    <div class="summary-card">
      <div class="amount" id="totalSpent">\u20b90</div>
      <div class="label">Total Spent</div>
    </div>
    <div class="summary-card">
      <div class="amount" id="dailyAvg">\u20b90</div>
      <div class="label">Daily Avg</div>
    </div>
    <div class="summary-card">
      <div class="amount" id="topCategory">-</div>
      <div class="label">Top Category</div>
    </div>
  </div>
</div>

<button class="add-expense-btn" onclick="showForm()">+ Add Expense</button>

<div class="section" id="pieSection" style="display:none;">
  <div style="padding:8px 16px 4px; font-size:13px; font-weight:600; color:#8E8E93; text-transform:uppercase;">By Category</div>
  <div class="pie-container" id="pieContainer"></div>
</div>

<div class="section">
  <div id="expensesList"></div>
  <div class="empty" id="emptyState">No expenses this month. Tap + to add one!</div>
</div>

<div style="padding: 16px; text-align: center;">
  <button class="share-btn" onclick="shareReport()">\uD83D\uDCE4 Share Monthly Report</button>
</div>

<div class="overlay" id="formOverlay" onclick="if(event.target===this)hideForm()">
  <div class="form-sheet">
    <div class="drag-handle"></div>
    <h2>Add Expense</h2>
    <div class="form-group">
      <label>Amount</label>
      <div class="amount-input-wrapper">
        <span class="currency">\u20b9</span>
        <input type="number" id="inputAmount" placeholder="0" min="0" step="1" inputmode="numeric">
      </div>
    </div>
    <div class="form-group">
      <label>Category</label>
      <select id="inputCategory">
        <option value="Food">\uD83C\uDF55 Food</option>
        <option value="Transport">\uD83D\uDE97 Transport</option>
        <option value="Shopping">\uD83D\uDECD\uFE0F Shopping</option>
        <option value="Bills">\uD83D\uDCF1 Bills</option>
        <option value="Health">\uD83C\uDFE5 Health</option>
        <option value="Entertainment">\uD83C\uDFAE Entertainment</option>
        <option value="Other">\uD83D\uDCE6 Other</option>
      </select>
    </div>
    <div class="form-group">
      <label>Note (optional)</label>
      <input type="text" id="inputNote" placeholder="What was this for?">
    </div>
    <div class="form-group">
      <label>Date</label>
      <input type="date" id="inputDate">
    </div>
    <div class="form-actions">
      <button class="btn-form-cancel" onclick="hideForm()">Cancel</button>
      <button class="btn-save" onclick="saveExpense()">Save</button>
    </div>
  </div>
</div>

<script>
var CATEGORY_EMOJI = { Food:'\uD83C\uDF55', Transport:'\uD83D\uDE97', Shopping:'\uD83D\uDECD\uFE0F', Bills:'\uD83D\uDCF1', Health:'\uD83C\uDFE5', Entertainment:'\uD83C\uDFAE', Other:'\uD83D\uDCE6' };
var CATEGORY_COLORS = { Food:'#FF9500', Transport:'#007AFF', Shopping:'#AF52DE', Bills:'#5856D6', Health:'#FF2D55', Entertainment:'#34C759', Other:'#8E8E93' };

var currentYear, currentMonth;

function init() {
  var now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();
  document.getElementById('inputDate').value = now.toISOString().split('T')[0];
  render();
}

function getMonthKey() { return currentYear + '-' + String(currentMonth + 1).padStart(2, '0'); }

function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  render();
}

function getExpenses() {
  return JSON.parse(localStorage.getItem('expenses_' + getMonthKey()) || '[]');
}

function showForm() {
  document.getElementById('formOverlay').classList.add('visible');
  document.getElementById('inputAmount').focus();
}

function hideForm() {
  document.getElementById('formOverlay').classList.remove('visible');
  document.getElementById('inputAmount').value = '';
  document.getElementById('inputNote').value = '';
}

function saveExpense() {
  var amount = parseFloat(document.getElementById('inputAmount').value);
  if (!amount || amount <= 0) { alert('Please enter an amount'); return; }

  var category = document.getElementById('inputCategory').value;
  var note = document.getElementById('inputNote').value.trim();
  var date = document.getElementById('inputDate').value;

  var expMonth = date.substring(0, 7);
  var expenses = JSON.parse(localStorage.getItem('expenses_' + expMonth) || '[]');
  expenses.push({
    id: Date.now().toString(), amount: amount, category: category, note: note, date: date,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });
  expenses.sort(function(a, b) { return b.date.localeCompare(a.date) || b.id.localeCompare(a.id); });
  localStorage.setItem('expenses_' + expMonth, JSON.stringify(expenses));

  if (window.VaultAPI && window.VaultAPI.device && window.VaultAPI.device.haptic) {
    window.VaultAPI.device.haptic('medium');
  }

  hideForm();
  render();
}

function deleteExpense(id) {
  var expenses = getExpenses();
  expenses = expenses.filter(function(e) { return e.id !== id; });
  localStorage.setItem('expenses_' + getMonthKey(), JSON.stringify(expenses));
  render();
}

function render() {
  var expenses = getExpenses();
  var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('monthLabel').textContent = monthNames[currentMonth] + ' ' + currentYear;

  var total = expenses.reduce(function(s, e) { return s + e.amount; }, 0);
  var daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  var todayDate = new Date();
  var daysElapsed = (currentYear === todayDate.getFullYear() && currentMonth === todayDate.getMonth())
    ? todayDate.getDate() : daysInMonth;

  document.getElementById('totalSpent').textContent = '\u20b9' + total.toLocaleString('en-IN');
  document.getElementById('dailyAvg').textContent = '\u20b9' + (daysElapsed > 0 ? Math.round(total / daysElapsed).toLocaleString('en-IN') : '0');

  var byCat = {};
  expenses.forEach(function(e) { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
  var topCatEntries = Object.entries(byCat).sort(function(a, b) { return b[1] - a[1]; });
  var topCat = topCatEntries[0] || null;
  document.getElementById('topCategory').textContent = topCat ? (CATEGORY_EMOJI[topCat[0]] || '') + ' ' + topCat[0] : '-';

  var pieSection = document.getElementById('pieSection');
  if (expenses.length > 0) {
    pieSection.style.display = 'block';
    renderPie(byCat, total);
  } else {
    pieSection.style.display = 'none';
  }

  var listEl = document.getElementById('expensesList');
  var emptyEl = document.getElementById('emptyState');

  if (expenses.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';

  var grouped = {};
  expenses.forEach(function(e) {
    if (!grouped[e.date]) grouped[e.date] = [];
    grouped[e.date].push(e);
  });

  var html = '';
  Object.keys(grouped).sort().reverse().forEach(function(date) {
    var d = new Date(date + 'T12:00:00');
    var label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    var dayTotal = grouped[date].reduce(function(s, e) { return s + e.amount; }, 0);
    html += '<div class="expense-group-header">' + label + ' \u00b7 \u20b9' + dayTotal.toLocaleString('en-IN') + '</div>';
    grouped[date].forEach(function(e) {
      html += '<div class="expense-item" onclick="if(confirm(\\'Delete this expense?\\'))deleteExpense(\\'' + e.id + '\\')">' +
        '<span class="expense-emoji">' + (CATEGORY_EMOJI[e.category] || '\uD83D\uDCE6') + '</span>' +
        '<div class="expense-info"><div class="category">' + e.category + '</div>' +
        (e.note ? '<div class="note">' + e.note + '</div>' : '') +
        '</div><span class="expense-amount">\u20b9' + e.amount.toLocaleString('en-IN') + '</span></div>';
    });
  });
  listEl.innerHTML = html;
}

function renderPie(byCat, total) {
  var container = document.getElementById('pieContainer');
  if (total === 0) { container.innerHTML = ''; return; }

  var entries = Object.entries(byCat).sort(function(a, b) { return b[1] - a[1]; });
  var gradParts = [];
  var cumPct = 0;

  entries.forEach(function(entry) {
    var cat = entry[0], amt = entry[1];
    var pct = (amt / total) * 100;
    var color = CATEGORY_COLORS[cat] || '#8E8E93';
    gradParts.push(color + ' ' + cumPct + '% ' + (cumPct + pct) + '%');
    cumPct += pct;
  });

  var pieStyle = 'width:120px;height:120px;border-radius:50%;background:conic-gradient(' + gradParts.join(',') + ');flex-shrink:0;';

  var legendHtml = entries.map(function(entry) {
    var cat = entry[0], amt = entry[1];
    var pct = Math.round((amt / total) * 100);
    return '<div class="pie-legend-item"><div class="pie-legend-dot" style="background:' + (CATEGORY_COLORS[cat] || '#8E8E93') + '"></div>' +
      (CATEGORY_EMOJI[cat] || '') + ' ' + cat + ' (' + pct + '%)</div>';
  }).join('');

  container.innerHTML = '<div style="' + pieStyle + '"></div><div class="pie-legend">' + legendHtml + '</div>';
}

function shareReport() {
  var expenses = getExpenses();
  var total = expenses.reduce(function(s, e) { return s + e.amount; }, 0);
  var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var text = monthNames[currentMonth] + ' ' + currentYear + ' expenses: \u20b9' + total.toLocaleString('en-IN') + ' total across ' + expenses.length + ' transactions.';

  if (window.VaultAPI && window.VaultAPI.device && window.VaultAPI.device.share) {
    window.VaultAPI.device.share({ text: text });
  } else if (navigator.share) {
    navigator.share({ text: text });
  } else {
    alert(text);
  }
}

init();
</script>
</body>
</html>`;

// Lookup map used by the viewer as a fallback when bundle_html is missing
// from the DB (e.g. records created before the column was added).
export const DEMO_HTML_BY_NAME: Record<string, string> = {
  'Workout Log': WORKOUT_LOG_HTML,
  'Daily Habits': DAILY_HABITS_HTML,
  'Expense Snap': EXPENSE_SNAP_HTML,
};
