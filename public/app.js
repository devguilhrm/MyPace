const STORAGE_KEY = 'mypace:guilherme:v6';
const SETTINGS_KEY = 'mypace:settings:v2';
const PLAN_VERSION = '5.1.0';

let state = null;
let settings = loadSettings();
let activeView = 'dashboard';
let selectedWeek = '1';
let syncTimer = null;
let toastTimer = null;
let authConfig = null;
let supabaseClient = null;
let session = null;
let localMode = false;
let modalContext = null;

const authView = document.querySelector('#authView');
const appView = document.querySelector('#appView');
const loginForm = document.querySelector('#loginForm');
const loginEmail = document.querySelector('#loginEmail');
const loginPassword = document.querySelector('#loginPassword');
const authMessage = document.querySelector('#authMessage');
const mainContent = document.querySelector('#mainContent');
const saveStateEl = document.querySelector('#saveState');
const themeToggleBtn = document.querySelector('#themeToggleBtn');
const logoutBtn = document.querySelector('#logoutBtn');
const viewTitle = document.querySelector('#viewTitle');
const viewEyebrow = document.querySelector('#viewEyebrow');
const currentWeekLabel = document.querySelector('#currentWeekLabel');
const selectedAthleteName = document.querySelector('#selectedAthleteName');
const selectedAvatar = document.querySelector('#selectedAvatar');
const toastEl = document.querySelector('#toast');
const registrationModal = document.querySelector('#registrationModal');
const modalContent = document.querySelector('#modalContent');
const modalCloseBtn = document.querySelector('#modalCloseBtn');

applyTheme();

async function boot() {
  bindEvents();
  authConfig = await fetchConfig();
  setupSupabase();

  if (supabaseClient) {
    const result = await supabaseClient.auth.getSession();
    session = result.data.session;
    supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      if (session && !state) {
        startApp();
      }
    });
  }

  if (session) {
    await startApp();
  } else {
    showAuth();
  }
}

function bindEvents() {
  loginForm.addEventListener('submit', signIn);
  themeToggleBtn.addEventListener('click', toggleTheme);
  logoutBtn.addEventListener('click', logout);
  modalCloseBtn.addEventListener('click', closeRegistrationModal);
  registrationModal.addEventListener('click', (event) => {
    if (event.target === registrationModal) closeRegistrationModal();
  });

  document.body.addEventListener('click', handleClick);
  document.body.addEventListener('input', handleInput);
  document.body.addEventListener('change', handleInput);
  document.body.addEventListener('submit', handleSubmit);
}

async function fetchConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Config indisponivel');
    return response.json();
  } catch {
    return { authEnabled: false, persistenceEnabled: false, supabaseUrl: '', supabaseAnonKey: '' };
  }
}

function setupSupabase() {
  if (!authConfig?.authEnabled || !window.supabase) {
    return;
  }

  supabaseClient = window.supabase.createClient(authConfig.supabaseUrl, authConfig.supabaseAnonKey);
}

async function signIn(event) {
  event.preventDefault();
  if (!supabaseClient) {
    setAuthMessage('Ambiente indisponível. Tente novamente em instantes.');
    return;
  }

  try {
    setAuthMessage('Entrando...');
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: normalizeLogin(loginEmail.value.trim()),
      password: loginPassword.value,
    });

    if (error) {
      setAuthMessage('Usuário ou senha inválidos.');
      return;
    }

    session = data.session;
    localMode = false;
    setAuthMessage('Carregando MyPace...');
    await startApp();
    setAuthMessage('');
  } catch (error) {
    console.error(error);
    setAuthMessage('Não foi possível entrar. Tente novamente.');
  }
}

async function logout() {
  if (supabaseClient && session && !localMode) {
    await supabaseClient.auth.signOut();
  }
  session = null;
  state = null;
  localMode = false;
  showAuth();
}

async function startApp() {
  showApp();
  renderSkeleton();
  state = await loadPlan();
  selectedWeek = String(todayWeek()?.week ?? currentWeek()?.week ?? 1);
  persist({ skipRemote: true, silent: true });
  render();
}

async function loadPlan() {
  if (session && authConfig?.persistenceEnabled && !localMode) {
    try {
      const response = await fetch('/api/user-plan', { headers: authHeaders() });
      if (response.ok) {
        const text = await response.text();
        const row = text ? JSON.parse(text) : null;
        if (row?.plan?.schemaVersion === PLAN_VERSION) {
          localStorage.setItem(storageKey(), JSON.stringify(row.plan));
          return row.plan;
        }
      }
    } catch {
      saveStateEl.textContent = 'local';
    }
  }

  const local = readLocalPlan();
  return local ?? fetchInitialPlan();
}

function readLocalPlan() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey()) ?? 'null');
    return parsed?.schemaVersion === PLAN_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

async function fetchInitialPlan() {
  const response = await fetch('/api/plan');
  if (!response.ok) throw new Error('Falha ao carregar plano inicial');
  return response.json();
}

function handleClick(event) {
  const action = event.target.closest('[data-action]');
  if (action?.dataset.action === 'open-register') {
    openRegistrationModal(Number(action.dataset.week), Number(action.dataset.workout));
    return;
  }

  const nav = event.target.closest('[data-view]');
  if (nav) {
    activeView = nav.dataset.view;
    if (nav.dataset.week) {
      selectedWeek = String(nav.dataset.week);
    }
    document.querySelectorAll('[data-view]').forEach((item) => item.classList.toggle('is-active', item.dataset.view === activeView));
    render();
    return;
  }

  const weekButton = event.target.closest('[data-week]');
  if (weekButton) {
    selectedWeek = weekButton.dataset.week;
    activeView = 'workout';
    document.querySelectorAll('[data-view]').forEach((item) => item.classList.toggle('is-active', item.dataset.view === activeView));
    render();
  }
}

function handleSubmit(event) {
  if (event.target.id !== 'quickRegisterForm') return;
  event.preventDefault();
  confirmQuickRegistration(new FormData(event.target));
}

function handleInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
  if (target.name === 'feeling') {
    document.querySelector('#rpeValue').textContent = target.value;
    return;
  }
  if (!target.dataset.week || !target.dataset.workout || !target.dataset.execution) return;

  const workout = state.weeks[Number(target.dataset.week)].workouts[Number(target.dataset.workout)];
  workout.execution ??= { done: false };
  workout.status ??= workout.execution.done ? 'finalizado' : 'pendente';

  if (target.type === 'checkbox' && target.checked && !canFinalizeWorkout(workout)) {
    target.checked = false;
    showToast(workout.distanceKm > 0 ? 'Preencha km, pace e RPE antes de finalizar' : 'Informe RPE antes de finalizar o descanso');
    return;
  }

  workout.execution[target.dataset.execution] = readInputValue(target);
  if (target.type === 'checkbox') {
    workout.status = target.checked ? 'finalizado' : 'pendente';
    workout.execution.done = target.checked;
    workout.execution.executedAt = target.checked ? toIsoDate(new Date()) : undefined;
  } else if (workout.status === 'finalizado' && !canFinalizeWorkout(workout)) {
    workout.status = 'pendente';
    workout.execution.done = false;
    workout.execution.executedAt = undefined;
    showToast('Treino voltou para pendente: dados reais incompletos');
  }
  persist();
  if (target.type === 'checkbox') {
    render();
    return;
  }
  renderHeader();
}

function readInputValue(target) {
  if (target.type === 'checkbox') return target.checked;
  if (target.type === 'number') return target.value === '' ? undefined : Number(target.value);
  return target.value;
}

function render() {
  normalizePlanState();
  renderHeader();
  const renderers = {
    dashboard: renderDashboard,
    workout: renderWorkoutBuilder,
    report: renderReport,
  };
  mainContent.innerHTML = (renderers[activeView] ?? renderDashboard)();
  drawIcons();
}

function renderHeader() {
  const athlete = state?.athlete?.name ?? 'Guilherme';
  const week = currentWeek();
  const labels = {
    dashboard: ['Hoje', 'Treino do dia'],
    workout: ['Semana', `Semana ${selectedWeek}`],
    report: ['Evolução', 'Pace e consistência'],
  };
  viewEyebrow.textContent = labels[activeView][0];
  viewTitle.textContent = labels[activeView][1];
  selectedAthleteName.textContent = athlete;
  selectedAvatar.textContent = athlete.slice(0, 1).toUpperCase();
  currentWeekLabel.textContent = week ? `Semana ${week.week} • ${week.keyWorkout}` : 'Ciclo completo';
}

function renderDashboard() {
  const today = todayWorkout();
  const next = nextWorkoutFromDate(toIsoDate(new Date()));
  const workout = today?.workout;
  const weekIndex = today?.weekIndex ?? (next?.weekIndex ?? 0);
  const workoutIndex = today?.workoutIndex ?? (next?.workoutIndex ?? 0);
  const completed = completedWorkouts();

  if (!workout) {
    return `
      <section class="today-layout">
        <article class="today-card rest-card">
          <p class="eyebrow">Hoje</p>
          <h2>Descanso ativo</h2>
          <p>Não há treino agendado para hoje. Use o dia para recuperar, dormir bem e chegar inteiro na próxima sessão.</p>
          ${next ? nextSessionCard(next) : ''}
        </article>
        ${cycleProgressCard(completed)}
      </section>
    `;
  }

  const isFinished = isWorkoutFinished(workout);
  const isRest = Number(workout.distanceKm || 0) === 0;
  return `
    <section class="today-layout">
      <article class="today-card ${isFinished ? 'is-done' : ''}">
        <div class="today-card-header">
          <div>
            <p class="eyebrow">${isRest ? 'Descanso ativo' : 'Treino de hoje'}</p>
            <h2>${escapeHtml(workout.type)}</h2>
          </div>
          ${isFinished ? '<span class="finish-badge">Concluído</span>' : ''}
        </div>
        <p>${escapeHtml(workout.guidance ?? workout.notes)}</p>
        <strong class="today-pace">${isRest ? 'solto' : escapeHtml(paceFrom(workout.paceTarget))}</strong>
        <div class="today-meta">
          ${compactMetric('Duração', formatDuration(workout))}
          ${compactMetric('Volume', workout.distanceLabel ?? `${workout.distanceKm} km`)}
          ${compactMetric('Semana', `S${state.weeks[weekIndex].week}`)}
        </div>
        ${isFinished ? workoutResultSummary(workout) : ''}
        <button class="button ${isFinished ? 'secondary' : 'primary'} today-action" data-action="open-register" data-week="${weekIndex}" data-workout="${workoutIndex}" type="button">
          <i data-lucide="${isFinished ? 'clipboard-list' : 'plus-circle'}"></i>
          <span>${isFinished ? 'Ver registro' : isRest ? 'Registrar descanso' : 'Registrar treino'}</span>
        </button>
      </article>
      ${!isRest ? cycleProgressCard(completed) : next ? nextSessionCard(next) : cycleProgressCard(completed)}
    </section>
  `;
}

function renderWorkoutBuilder() {
  const week = state.weeks.find((item) => String(item.week) === selectedWeek) ?? currentWeek();
  const weekIndex = state.weeks.indexOf(week);
  const completedInWeek = week.workouts.filter(isWorkoutFinished).length;

  return `
    <section class="week-layout">
      <article class="week-picker-card">
        <div>
          <h2>Semana de treino</h2>
          <p>${escapeHtml(week.focus)} • ${escapeHtml(week.volumeLabel ?? `${week.targetVolumeKm} km`)}</p>
        </div>
        <div>
          <select class="week-select" onchange="window.setWeek(this.value)">
            ${state.weeks.map((item) => `<option value="${item.week}" ${item.week === week.week ? 'selected' : ''}>Semana ${item.week} • ${escapeHtml(item.keyWorkout ?? item.focus)}</option>`).join('')}
          </select>
          <div class="load-bar"><span style="width:${loadPercent(week)}%"></span></div>
        </div>
        <div class="week-summary">
          ${compactMetric('Concluídos', `${completedInWeek}/${week.workouts.length}`)}
          ${compactMetric('Longão', week.longRunLabel ?? '-')}
        </div>
      </article>

      <div class="week-list">
        ${week.workouts.map((workout, workoutIndex) => weekWorkoutCard(workout, weekIndex, workoutIndex)).join('')}
      </div>
    </section>
  `;
}

function weekWorkoutCard(workout, weekIndex, workoutIndex) {
  const status = workoutVisualStatus(workout);
  const isFinished = isWorkoutFinished(workout);
  return `
    <button class="week-workout ${status.className}" data-action="open-register" data-week="${weekIndex}" data-workout="${workoutIndex}" type="button">
      <span class="status-symbol">${status.symbol}</span>
      <div>
        <strong>${escapeHtml(workout.type)}</strong>
        <p>${formatDate(workout.date)} • ${escapeHtml(workout.guidance ?? workout.notes)}</p>
      </div>
      <div class="week-workout-meta">
        <b>${escapeHtml(paceFrom(workout.paceTarget))}</b>
        <span>${escapeHtml(workout.distanceLabel ?? `${workout.distanceKm} km`)}</span>
      </div>
      <span class="status-pill ${status.className}">${isFinished ? 'Concluído' : status.label}</span>
    </button>
  `;
}

function workoutSummaryCard(workout, weekIndex) {
  const isRest = Number(workout.distanceKm || 0) === 0;
  const isFinished = isWorkoutFinished(workout);
  return `
    <article class="plan-card ${isFinished ? 'is-done' : ''}">
      <div class="plan-date">
        <strong>${formatDate(workout.date)}</strong>
        <span>${escapeHtml(workout.day)}</span>
      </div>
      <div>
        <h3>${escapeHtml(workout.type)}</h3>
        <p>${escapeHtml(workout.guidance ?? workout.notes)}</p>
      </div>
      <div class="plan-meta">
        <strong>${escapeHtml(workout.distanceLabel ?? `${workout.distanceKm} km`)}</strong>
        <span>${isRest ? 'recuperação' : escapeHtml(paceFrom(workout.paceTarget))}</span>
      </div>
      ${isFinished ? '<span class="finish-badge">Finalizado</span>' : ''}
      ${doneToggle(workout, weekIndex)}
    </article>
  `;
}

function workoutDetailCard(workout, weekIndex, index) {
  const isFinished = isWorkoutFinished(workout);
  return `
    <article class="plan-card detail ${isFinished ? 'is-done' : ''}">
      <span class="plan-number">${index + 1}</span>
      <div>
        <div class="card-header compact">
          <div>
            <h3>${escapeHtml(workout.type)}</h3>
            <p>${escapeHtml(workout.guidance ?? workout.notes)}</p>
          </div>
          ${intensityPill(workout)}
        </div>
      </div>
      <div class="plan-meta">
        <span>${escapeHtml(formatDuration(workout))}</span>
        <strong class="target-pace">${escapeHtml(paceFrom(workout.paceTarget))}</strong>
        <small>${escapeHtml(workout.zone ?? zoneFor(workout))}</small>
      </div>
      ${isFinished ? '<span class="finish-badge">Finalizado</span>' : ''}
    </article>
  `;
}

function executionCard(workout, weekIndex, workoutIndex) {
  const execution = workout.execution ?? {};
  const isFinished = isWorkoutFinished(workout);
  return `
    <article class="execution-card">
      <label class="execution-check">
        <input data-week="${weekIndex}" data-workout="${workoutIndex}" data-execution="done" type="checkbox" ${isFinished ? 'checked' : ''} />
        <span>${escapeHtml(workout.type)}</span>
      </label>
      <div class="execution-fields">
        ${executionInput('Distância', 'km', 'number', weekIndex, workoutIndex, 'distanceKm', execution.distanceKm ?? '', '0.1')}
        ${executionInput('Pace', 'mm:ss', 'text', weekIndex, workoutIndex, 'pace', execution.pace ?? '')}
        ${executionInput('Esforço', 'RPE 1-10', 'number', weekIndex, workoutIndex, 'feeling', execution.feeling ?? '', '1')}
      </div>
      <label class="execution-note">
        <span>Observações</span>
        <textarea data-week="${weekIndex}" data-workout="${workoutIndex}" data-execution="notes" rows="2">${escapeHtml(execution.notes ?? '')}</textarea>
      </label>
    </article>
  `;
}

function doneToggle(workout, weekIndex) {
  const workoutIndex = state.weeks[weekIndex].workouts.findIndex((item) => item.id === workout.id);
  const isFinished = isWorkoutFinished(workout);
  return `
    <label class="done-chip">
      <input data-week="${weekIndex}" data-workout="${workoutIndex}" data-execution="done" type="checkbox" ${isFinished ? 'checked' : ''} />
      <span>${isFinished ? 'Finalizado' : 'Pendente'}</span>
    </label>
  `;
}

function executionInput(label, placeholder, type, weekIndex, workoutIndex, executionKey, value, step = '') {
  return `
    <label>
      <span>${label}</span>
      <input data-week="${weekIndex}" data-workout="${workoutIndex}" data-execution="${executionKey}" type="${type}" ${type === 'number' ? 'min="0"' : ''} ${step ? `step="${step}"` : ''} value="${escapeAttr(value)}" placeholder="${placeholder}" />
    </label>
  `;
}

function openRegistrationModal(weekIndex, workoutIndex) {
  const workout = state.weeks[weekIndex]?.workouts[workoutIndex];
  if (!workout) return;
  modalContext = { weekIndex, workoutIndex };
  modalContent.innerHTML = isWorkoutFinished(workout) ? registrationSummary(workout) : registrationForm(workout);
  registrationModal.hidden = false;
  drawIcons();
}

function closeRegistrationModal() {
  modalContext = null;
  registrationModal.hidden = true;
  modalContent.innerHTML = '';
}

function registrationForm(workout) {
  const execution = workout.execution ?? {};
  const isRest = Number(workout.distanceKm || 0) === 0;
  return `
    <form id="quickRegisterForm" class="quick-register">
      <p class="eyebrow">${isRest ? 'Registrar descanso' : 'Registrar treino'}</p>
      <h2 id="modalTitle">${escapeHtml(workout.type)}</h2>
      <p>${escapeHtml(workout.guidance ?? workout.notes)}</p>
      <div class="quick-fields ${isRest ? 'rest-only' : ''}">
        ${isRest ? '' : `
          <label>
            <span>Distância real</span>
            <div class="unit-input">
              <input name="distanceKm" type="number" min="0" step="0.01" value="${escapeAttr(execution.distanceKm ?? '')}" required />
              <b>km</b>
            </div>
          </label>
          <label>
            <span>Pace médio real</span>
            <input name="pace" type="text" inputmode="numeric" pattern="\\d{1,2}:\\d{2}" placeholder="mm:ss" value="${escapeAttr(execution.pace ?? '')}" required />
          </label>
        `}
        <label class="rpe-field">
          <span>Esforço percebido</span>
          <input name="feeling" type="range" min="1" max="10" step="1" value="${escapeAttr(execution.feeling ?? 5)}" />
          <div><small>Fácil</small><strong id="rpeValue">${escapeHtml(execution.feeling ?? 5)}</strong><small>Máximo</small></div>
        </label>
      </div>
      <label class="quick-note">
        <span>Observação</span>
        <textarea name="notes" rows="3">${escapeHtml(execution.notes ?? '')}</textarea>
      </label>
      <button class="button confirm" type="submit">
        <i data-lucide="check-circle-2"></i>
        <span>Confirmar treino</span>
      </button>
    </form>
  `;
}

function registrationSummary(workout) {
  return `
    <div class="quick-register">
      <p class="eyebrow">Registro concluído</p>
      <h2 id="modalTitle">${escapeHtml(workout.type)}</h2>
      ${workoutResultSummary(workout)}
      ${workout.execution?.notes ? `<p>${escapeHtml(workout.execution.notes)}</p>` : '<p>Sem observações registradas.</p>'}
      <button class="button secondary" type="button" onclick="window.closeQuickRegister()">
        <i data-lucide="check"></i>
        <span>Fechar</span>
      </button>
    </div>
  `;
}

function confirmQuickRegistration(formData) {
  if (!modalContext) return;
  const workout = state.weeks[modalContext.weekIndex].workouts[modalContext.workoutIndex];
  const isRest = Number(workout.distanceKm || 0) === 0;
  workout.execution ??= { done: false };
  workout.execution.distanceKm = isRest ? 0 : Number(formData.get('distanceKm'));
  workout.execution.pace = isRest ? undefined : normalizePaceInput(String(formData.get('pace') ?? ''));
  workout.execution.feeling = Number(formData.get('feeling'));
  workout.execution.notes = String(formData.get('notes') ?? '').trim();

  if (!canFinalizeWorkout(workout)) {
    showToast(isRest ? 'Informe o esforço percebido' : 'Confira km, pace e RPE');
    return;
  }

  workout.status = 'finalizado';
  workout.execution.done = true;
  workout.execution.executedAt = toIsoDate(new Date());
  persist();
  closeRegistrationModal();
  render();
  showToast('Treino confirmado');
}

function normalizePaceInput(value) {
  const digits = value.replace(/\D/g, '');
  if (/^\d{3,4}$/.test(digits)) {
    return `${digits.slice(0, -2)}:${digits.slice(-2)}`;
  }
  return value;
}

function renderReport() {
  const finished = finishedWorkouts();
  const summary = reportSummary(finished);
  const completed = completedWorkouts();
  return `
    <section class="report-layout">
      ${cycleProgressCard(completed)}

      <article class="feature-card">
        <div class="card-header">
          <div>
            <p class="eyebrow">Evolução de pace</p>
            <h2>Treinos finalizados</h2>
          </div>
        </div>
        ${finished.length ? paceChart(finished) : '<div class="chart-empty">Nenhum treino finalizado</div>'}
      </article>

      <div class="report-metrics">
        ${compactMetric('Pace médio', summary.averagePace, true)}
        ${compactMetric('Volume total', summary.totalKm)}
        ${compactMetric('PR provável', summary.probablePr)}
        ${compactMetric('Carga', summary.load)}
      </div>

      <article class="export-card">
        <div class="export-icon"><i data-lucide="file-text"></i></div>
        <div>
          <h2>Relatório exportável</h2>
          <p>Exporte seu plano com registros de execução, paces finalizados e observações pessoais.</p>
        </div>
        <button class="button primary" type="button" onclick="window.exportJson()" ${finished.length ? '' : 'disabled title="Finalize ao menos um treino para exportar um relatório útil"'}>Exportar JSON</button>
      </article>
    </section>
  `;
}

function paceChart(items) {
  const paces = items.map((item) => item.paceSeconds);
  const min = Math.min(...paces);
  const max = Math.max(...paces);
  const range = Math.max(1, max - min);
  const ticks = Array.from({ length: 5 }, (_, index) => formatPace(Math.round(min + (range / 4) * index))).reverse();
  const meta = 370;

  return `
    <div class="pace-chart">
      <div class="y-axis">${ticks.map((tick) => `<span>${tick}</span>`).join('')}</div>
      <div class="chart-bars">
        <div class="goal-line"><span>Meta</span></div>
        ${items.map((item) => {
          const height = 28 + Math.round(((max - item.paceSeconds) / range) * 172);
          const isGoal = item.paceSeconds <= meta;
          return `
            <div class="bar-item">
              <span class="bar-value ${height < 56 ? 'dark' : ''}">${escapeHtml(item.execution.pace)}</span>
              <div class="pace-bar ${isGoal ? 'goal' : ''}" style="height:${height}px"></div>
              <small>${escapeHtml(item.chartLabel)}</small>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function phaseBadge(phase) {
  return `<span class="status-badge green">${escapeHtml(phase)}</span>`;
}

function remainingWorkouts(week) {
  return week.workouts.filter((workout) => !isWorkoutFinished(workout) && workout.distanceKm > 0);
}

function compactMetric(label, value, mono = false) {
  return `<div class="mini-metric"><span>${escapeHtml(label)}</span><strong class="${mono ? 'mono' : ''}">${escapeHtml(value)}</strong></div>`;
}

function intensityPill(workout) {
  const effort = Number(workout.effort || 0);
  const label = workout.type === 'Prova' ? 'Race' : effort >= 7 ? 'Hard' : effort >= 5 ? 'Moderate' : 'Easy';
  return `<span class="intensity-pill ${label.toLowerCase()}">${label}</span>`;
}

function currentWeek() {
  return state.weeks.find((week) => week.workouts.some((workout) => !isWorkoutFinished(workout) && workout.distanceKm > 0)) ?? state.weeks.at(-1);
}

function nextWorkout() {
  return state.weeks.flatMap((week) => week.workouts).find((workout) => !isWorkoutFinished(workout) && workout.distanceKm > 0);
}

function completedWorkouts() {
  const all = state.weeks.flatMap((week) => week.workouts).filter((workout) => workout.distanceKm > 0);
  const done = all.filter(isWorkoutFinished);
  return { done: done.length, total: all.length, percent: all.length ? Math.round((done.length / all.length) * 100) : 0 };
}

function todayWeek() {
  const today = toIsoDate(new Date());
  return state.weeks.find((week) => week.workouts.some((workout) => workout.date === today));
}

function todayWorkout() {
  return workoutByDate(toIsoDate(new Date()));
}

function workoutByDate(date) {
  for (const [weekIndex, week] of state.weeks.entries()) {
    const workoutIndex = week.workouts.findIndex((workout) => workout.date === date);
    if (workoutIndex >= 0) return { week, weekIndex, workoutIndex, workout: week.workouts[workoutIndex] };
  }
  return null;
}

function nextWorkoutFromDate(date) {
  const items = state.weeks.flatMap((week, weekIndex) =>
    week.workouts.map((workout, workoutIndex) => ({ week, weekIndex, workoutIndex, workout })),
  );
  return items.find((item) => item.workout.date >= date && !isWorkoutFinished(item.workout) && item.workout.distanceKm > 0)
    ?? items.find((item) => !isWorkoutFinished(item.workout) && item.workout.distanceKm > 0)
    ?? null;
}

function workoutVisualStatus(workout) {
  if (isWorkoutFinished(workout)) return { className: 'done', symbol: '✓', label: 'Concluído' };
  if (workout.date < toIsoDate(new Date())) return { className: 'missed', symbol: '✕', label: 'Pendente passado' };
  return { className: 'pending', symbol: '○', label: 'Pendente' };
}

function nextSessionCard(item) {
  return `
    <article class="next-session-card">
      <p class="eyebrow">Próxima sessão</p>
      <h3>${escapeHtml(item.workout.type)}</h3>
      <p>${formatDate(item.workout.date)} • ${escapeHtml(item.workout.distanceLabel ?? `${item.workout.distanceKm} km`)} • ${escapeHtml(paceFrom(item.workout.paceTarget))}</p>
      <button class="button primary" data-action="open-register" data-week="${item.weekIndex}" data-workout="${item.workoutIndex}" type="button">
        <i data-lucide="plus-circle"></i>
        <span>Registrar quando fizer</span>
      </button>
    </article>
  `;
}

function cycleProgressCard(completed) {
  return `
    <article class="feature-card progress-card">
      <div class="progress-label">
        <span>Periodização completa</span>
        <strong>${completed.done} de ${completed.total} — ${completed.percent}%</strong>
      </div>
      <div class="progress-track"><span style="width:${completed.percent}%"></span></div>
    </article>
  `;
}

function workoutResultSummary(workout) {
  const execution = workout.execution ?? {};
  return `
    <div class="result-summary">
      ${compactMetric('Km real', execution.distanceKm ? `${execution.distanceKm} km` : '-')}
      ${compactMetric('Pace real', execution.pace ? `${execution.pace}/km` : '-', true)}
      ${compactMetric('RPE', execution.feeling ?? '-')}
    </div>
  `;
}

function paceFrom(value) {
  const match = String(value).match(/\d:\d{2}(?:-\d:\d{2})?/);
  return match ? `${match[0]}/km` : value;
}

function zoneFor(workout) {
  if (workout.distanceKm === 0) return 'Descanso';
  if (workout.effort >= 8) return 'Z4';
  if (workout.effort >= 6) return 'Z3';
  if (workout.effort >= 3) return 'Z2';
  return 'Z1';
}

function estimatedDuration(workout) {
  if (!workout.distanceKm) return 'recuperação';
  const seconds = parsePaceToSeconds(paceFrom(workout.paceTarget)) ?? 420;
  const minutes = Math.round((seconds * workout.distanceKm) / 60);
  return `${minutes} min`;
}

function formatDuration(workout) {
  if (Number(workout.durationMinutes) > 0) return `${workout.durationMinutes} min`;
  return estimatedDuration(workout);
}

function finishedWorkouts() {
  const items = state.weeks
    .flatMap((week) => week.workouts.map((workout) => ({ ...workout, weekNumber: week.week })))
    .filter((workout) =>
      workout.status === 'finalizado'
      && workout.distanceKm > 0
      && Number(workout.execution?.distanceKm || 0) > 0
      && parsePaceToSeconds(workout.execution?.pace)
      && validRpe(workout.execution?.feeling)
      && workout.execution?.executedAt
    )
    .map((workout) => ({ ...workout, paceSeconds: parsePaceToSeconds(workout.execution.pace) }));
  return withDistinctChartLabels(items);
}

function withDistinctChartLabels(items) {
  const seen = new Map();
  return items.map((item) => {
    const base = formatDateShort(item.execution.executedAt);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { ...item, chartLabel: count > 1 ? `${base} #${count}` : base };
  });
}

function reportSummary(items) {
  const count = items.length;
  if (!count) return { averagePace: '-', totalKm: '-', probablePr: '-', load: '-' };
  const totalKm = items.reduce((sum, item) => sum + Number(item.execution.distanceKm || 0), 0);
  const avgPace = Math.round(items.reduce((sum, item) => sum + item.paceSeconds, 0) / count);
  const bestPace = Math.min(...items.map((item) => item.paceSeconds));
  return {
    averagePace: `${formatPace(avgPace)}/km`,
    totalKm: `${round(totalKm)} km`,
    probablePr: estimateHalfMarathonTime(bestPace),
    load: classifyWeekLoad(items.at(-1)?.weekNumber),
  };
}

function classifyWeekLoad(weekNumber) {
  const week = state.weeks.find((item) => item.week === weekNumber);
  if (!week) return '-';
  const realVolume = week.workouts
    .filter((workout) => workout.status === 'finalizado')
    .reduce((sum, workout) => sum + Number(workout.execution?.distanceKm || 0), 0);
  if (realVolume === 0) return '-';
  if (realVolume < 16) return 'baixa';
  if (realVolume <= 32) return 'média';
  return 'alta';
}

function estimateHalfMarathonTime(secondsPerKm) {
  const totalSeconds = Math.round(secondsPerKm * 21.1);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h${String(minutes).padStart(2, '0')}`;
}

function isWorkoutFinished(workout) {
  return workout.status === 'finalizado';
}

function canFinalizeWorkout(workout) {
  const execution = workout.execution ?? {};
  if (Number(workout.distanceKm || 0) === 0) return validRpe(execution.feeling);
  return Number(execution.distanceKm || 0) > 0
    && Boolean(parsePaceToSeconds(execution.pace))
    && validRpe(execution.feeling);
}

function validRpe(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 10;
}

function parsePaceToSeconds(value) {
  const match = String(value ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatPace(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function round(value) {
  return Number(value || 0).toFixed(1).replace('.0', '');
}

function loadPercent(week) {
  const max = Math.max(...state.weeks.map((item) => Number(item.targetVolumeKm || 0)));
  return Math.round((Number(week.targetVolumeKm || 0) / max) * 100);
}

function renderSkeleton() {
  mainContent.innerHTML = `
    <div class="skeleton-grid">
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
    </div>
  `;
}

function normalizePlanState() {
  if (!state?.weeks) return;
  state.weeks.forEach((week, weekIndex) => {
    week.workouts.forEach((workout, workoutIndex) => {
      workout.week ??= week.week ?? weekIndex + 1;
      workout.order ??= workoutIndex + 1;
      workout.zone ??= zoneFor(workout);
      workout.durationMinutes ??= Number.parseInt(estimatedDuration(workout), 10) || 0;
      workout.execution ??= { done: false };
      if (!workout.status && workout.execution.done && canFinalizeWorkout(workout)) {
        workout.status = 'finalizado';
        workout.execution.executedAt ??= workout.date;
      }
      workout.status = workout.status === 'finalizado' ? 'finalizado' : 'pendente';
      workout.execution.done = workout.status === 'finalizado';
    });
  });
}

function persist(options = {}) {
  localStorage.setItem(storageKey(), JSON.stringify(state));
  const mode = session && !localMode && authConfig?.persistenceEnabled ? 'nuvem' : 'local';
  saveStateEl.textContent = `salvo ${mode}`;
  if (!options.skipRemote) {
    scheduleRemoteSync();
    if (!options.silent) showToast('Execução salva');
  }
}

function scheduleRemoteSync() {
  window.clearTimeout(syncTimer);
  if (!session || localMode || !authConfig?.persistenceEnabled) return;
  saveStateEl.textContent = 'sincronizando';
  syncTimer = window.setTimeout(syncRemote, 700);
}

async function syncRemote() {
  try {
    const response = await fetch('/api/user-plan', {
      method: 'PUT',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(state),
    });
    if (!response.ok) throw new Error('Falha ao salvar');
    saveStateEl.textContent = 'salvo nuvem';
  } catch {
    saveStateEl.textContent = 'salvo local';
  }
}

function exportJson() {
  const payload = {
    exportedAt: new Date().toISOString(),
    athlete: state.athlete.name,
    workouts: finishedWorkouts().map((workout) => ({
      id: workout.id,
      week: workout.weekNumber,
      order: workout.order,
      date_planned: workout.date,
      data_execucao: workout.execution.executedAt,
      title: workout.type,
      status: workout.status,
      km_real: Number(workout.execution.distanceKm || 0),
      pace_real: workout.execution.pace,
      rpe_real: Number(workout.execution.feeling),
      observacoes: workout.execution.notes ?? '',
    })),
  };
  if (!payload.workouts.length) return;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `mypace-guilherme-${toIsoDate(new Date())}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function showToast(message) {
  toastEl.querySelector('span').textContent = message;
  toastEl.hidden = false;
  drawIcons();
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 2200);
}

function authHeaders() {
  return { authorization: `Bearer ${session?.access_token ?? ''}` };
}

function storageKey() {
  const userId = session?.user?.id;
  return userId && !localMode ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;
}

function showAuth() {
  authView.hidden = false;
  appView.hidden = true;
  drawIcons();
}

function showApp() {
  authView.hidden = true;
  appView.hidden = false;
}

function setAuthMessage(message) {
  authMessage.textContent = message;
}

function normalizeLogin(value) {
  return value.includes('@') ? value : `${value.toLowerCase()}@run.local`;
}

function loadSettings() {
  try {
    return { theme: 'light', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { theme: 'light' };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function toggleTheme() {
  settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
  saveSettings();
  applyTheme();
}

function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
}

function formatDate(value) {
  const date = parseLocalDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
}

function formatDateShort(value) {
  const date = parseLocalDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(date).replace('.', '');
}

function parseLocalDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('\n', ' ');
}

function drawIcons() {
  if (window.lucide) window.lucide.createIcons();
}

window.setWeek = (week) => {
  selectedWeek = String(week);
  render();
};
window.exportJson = exportJson;
window.closeQuickRegister = closeRegistrationModal;

boot().catch((error) => {
  console.error(error);
  showApp();
  mainContent.innerHTML = '<div class="empty-state"><div class="empty-illustration"></div><div><h2>Não foi possível carregar</h2><p>Tente atualizar a página.</p></div></div>';
});
