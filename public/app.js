const STORAGE_KEY = 'mypace:runner:v7';
const SETTINGS_KEY = 'mypace:settings:v3';
const PLAN_VERSION = '6.1.0';
const LOGIN_PATH = '/login';

let state = null;
let settings = loadSettings();
let activeView = 'today';
let selectedWeek = '1';
let syncTimer = null;
let toastTimer = null;
let authConfig = null;
let supabaseClient = null;
let session = null;
let localMode = false;
let modalContext = null;
let resolveAuthReady = null;
const authReady = new Promise((resolve) => {
  resolveAuthReady = resolve;
});

const ROUTES = {
  '/hoje': 'today',
  '/semana': 'week',
  '/preparacao': 'preparation',
  '/evolucao': 'report',
  '/config': 'settings',
};

const VIEW_PATHS = {
  today: '/hoje',
  week: '/semana',
  preparation: '/preparacao',
  report: '/evolucao',
  settings: '/config',
};

const entryView = document.querySelector('#entryView');
const loginView = document.querySelector('#loginView');
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
const toastEl = document.querySelector('#toast');
const registrationModal = document.querySelector('#registrationModal');
const modalContent = document.querySelector('#modalContent');
const modalCloseBtn = document.querySelector('#modalCloseBtn');

applyTheme();

async function boot() {
  bindEvents();
  const startedAtEntry = isEntryRoute();
  if (startedAtEntry) showEntry();

  authConfig = await fetchConfig();
  if (authConfig?.authEnabled) await waitForSupabase();
  setupSupabase();

  if (supabaseClient) {
    const result = await supabaseClient.auth.getSession();
    session = result.data.session;
    supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
    });
    localMode = !session;
  } else {
    localMode = true;
  }
  resolveAuthReady();

  if (isLoginRoute()) {
    if (!authConfig?.authEnabled) {
      navigateTo('/hoje');
      return;
    }
    if (session) navigateTo(nextPathFromLogin());
    else showLogin();
    return;
  }

  if (!isEntryRoute()) await startApp();
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
  document.body.addEventListener('submit', handleSubmit);
  window.addEventListener('popstate', handleRouteChange);
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
  if (!authConfig?.authEnabled || !window.supabase) return;
  supabaseClient = window.supabase.createClient(authConfig.supabaseUrl, authConfig.supabaseAnonKey);
}

function waitForSupabase() {
  if (window.supabase) return Promise.resolve();

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (window.supabase || Date.now() - startedAt > 3000) {
        window.clearInterval(timer);
        resolve();
      }
    }, 50);
  });
}

async function signIn(event) {
  event.preventDefault();
  if (!supabaseClient) {
    setAuthMessage('Login indisponivel. Confira as variaveis do Supabase.');
    return;
  }

  try {
    setAuthMessage('Entrando...');
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: normalizeLogin(loginEmail.value.trim()),
      password: loginPassword.value,
    });

    if (error) {
      setAuthMessage('Usuario ou senha invalidos.');
      return;
    }

    session = data.session;
    localMode = false;
    state = null;
    setAuthMessage('');
    navigateTo(nextPathFromLogin());
  } catch (error) {
    console.error(error);
    setAuthMessage('Nao foi possivel entrar. Tente novamente.');
  }
}

async function logout() {
  if (supabaseClient && session && !localMode) await supabaseClient.auth.signOut();
  session = null;
  state = null;
  localMode = true;
  navigateTo(authConfig?.authEnabled ? LOGIN_PATH : '/');
}

async function startApp() {
  if (requiresLogin()) {
    navigateToLogin();
    return;
  }

  activeView = viewFromPath();
  showApp();
  renderSkeleton();
  state ??= await loadPlan();
  normalizePlanState();
  selectedWeek = String(weekForDate(toIsoDate(new Date()))?.week ?? currentWeek()?.week ?? 1);
  persist({ skipRemote: true, silent: true });
  render();
}

async function loadPlan() {
  const saved = await loadSavedPlan();
  if (saved?.schemaVersion === PLAN_VERSION) return saved;
  if (saved?.weeks?.length) return migrateSavedPlan(saved);
  return fetchInitialPlan();
}

async function loadSavedPlan() {
  if (session && authConfig?.persistenceEnabled && !localMode) {
    try {
      const response = await fetch('/api/user-plan', { headers: authHeaders() });
      if (response.ok) {
        const text = await response.text();
        const row = text ? JSON.parse(text) : null;
        if (row?.plan?.weeks?.length) {
          localStorage.setItem(storageKey(), JSON.stringify(row.plan));
          return row.plan;
        }
      }
    } catch {
      saveStateEl.textContent = 'local';
    }
  }

  return readLocalPlan();
}

function readLocalPlan() {
  const keys = [storageKey(), STORAGE_KEY, ...knownPlanKeys()];
  for (const key of [...new Set(keys)]) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (parsed?.weeks?.length) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

function knownPlanKeys() {
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key) => key?.startsWith('mypace:') && key !== SETTINGS_KEY);
}

async function migrateSavedPlan(saved) {
  const initial = await fetchInitialPlan();
  mergeExecutions(initial, saved);
  initial.schemaVersion = PLAN_VERSION;
  return initial;
}

async function fetchInitialPlan() {
  const response = await fetch('/api/plan');
  if (!response.ok) throw new Error('Falha ao carregar plano inicial');
  return response.json();
}

function mergeExecutions(target, saved) {
  const savedWorkouts = saved.weeks.flatMap((week) => week.workouts ?? []);
  const byId = new Map(savedWorkouts.map((workout) => [workout.id, workout]));
  const byDateType = new Map(savedWorkouts.map((workout) => [`${workout.date}|${workout.type}`, workout]));

  target.weeks.forEach((week) => {
    week.workouts.forEach((workout) => {
      const old = byId.get(workout.id) ?? byDateType.get(`${workout.date}|${workout.type}`);
      if (!old) return;
      workout.status = old.status === 'finalizado' ? 'finalizado' : 'pendente';
      workout.execution = normalizeExecution(old.execution ?? {});
    });
  });
}

function handleClick(event) {
  const action = event.target.closest('[data-action]');
  if (action) {
    const { action: name } = action.dataset;

    if (name === 'enter-app') {
      navigateTo('/hoje');
      return;
    }

    if (name === 'open-register') {
      openRegistrationModal(Number(action.dataset.week), Number(action.dataset.workout), false);
      return;
    }

    if (name === 'edit-register') {
      openRegistrationModal(Number(action.dataset.week), Number(action.dataset.workout), true);
      return;
    }

    if (name === 'view-register') {
      openRegistrationModal(Number(action.dataset.week), Number(action.dataset.workout), false);
      return;
    }

    if (name === 'toggle-comment') {
      const note = document.querySelector('#commentField');
      const button = document.querySelector('[data-action="toggle-comment"]');
      if (note && button) {
        note.hidden = false;
        button.hidden = true;
        note.querySelector('textarea')?.focus();
      }
      return;
    }

    if (name === 'week-prev' || name === 'week-next') {
      const delta = name === 'week-prev' ? -1 : 1;
      selectedWeek = String(clamp(Number(selectedWeek) + delta, 1, state.weeks.length));
      render();
      return;
    }
  }

  const nav = event.target.closest('[data-view]');
  if (nav) {
    navigateTo(VIEW_PATHS[nav.dataset.view] ?? '/hoje');
  }
}

async function handleRouteChange() {
  if (!authConfig) await authReady;

  if (isEntryRoute()) {
    showEntry();
    return;
  }

  if (isLoginRoute()) {
    if (!authConfig?.authEnabled) {
      navigateTo('/hoje');
      return;
    }
    if (session) navigateTo(nextPathFromLogin());
    else showLogin();
    return;
  }

  activeView = viewFromPath();
  if (requiresLogin()) {
    navigateToLogin();
    return;
  }

  if (!state) {
    await startApp();
    return;
  }

  showApp();
  render();
}

function navigateTo(path) {
  if (window.location.pathname !== path) {
    window.history.pushState({}, '', path);
  }
  handleRouteChange();
}

function handleSubmit(event) {
  if (event.target.id === 'quickRegisterForm') {
    event.preventDefault();
    confirmRegistration(event.target);
  }

  if (event.target.id === 'settingsForm') {
    event.preventDefault();
    saveRunnerSettings(new FormData(event.target));
  }
}

function handleInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;

  if (target.name === 'pace') {
    const cursorAtEnd = target.selectionStart === target.value.length;
    target.value = maskPace(target.value);
    if (cursorAtEnd) target.setSelectionRange(target.value.length, target.value.length);
  }

  if (target.name === 'rpe') {
    document.querySelector('#rpeValue').textContent = target.value;
  }
}

function render() {
  normalizePlanState();
  syncNavigation();
  renderHeader();
  document.title = `MyPace | ${viewTitle.textContent}`;
  const renderers = {
    today: renderToday,
    week: renderWeek,
    preparation: renderPreparation,
    report: renderReport,
    settings: renderSettings,
  };
  mainContent.innerHTML = (renderers[activeView] ?? renderToday)();
  drawIcons();
}

function renderHeader() {
  const today = toIsoDate(new Date());
  const labels = {
    today: [dayFullDate(today), `Bom dia, ${settings.name || 'Guilherme'}`],
    week: ['Semana', `Semana ${pad2(selectedWeek)}`],
    preparation: ['Preparacao', 'Todos os treinos'],
    report: ['Evolucao', 'Relatorio e metricas'],
    settings: ['Configuracoes', 'Preferencias'],
  };
  viewEyebrow.textContent = labels[activeView]?.[0] ?? 'Hoje';
  viewTitle.textContent = labels[activeView]?.[1] ?? 'O que faco hoje?';
}

function syncNavigation() {
  document.querySelectorAll('[data-view]').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.view === activeView);
  });
}

function renderToday() {
  const context = todayContext();
  const week = context.week ?? weekForDate(toIsoDate(new Date())) ?? currentWeek();
  const completed = weekProgress(week);

  return `
    <section class="runner-layout">
      ${todayMainCard(context)}
      <div class="today-support">
        ${upcomingWeekList(week)}
        ${weekProgressCard(completed)}
      </div>
    </section>
  `;
}

function todayMainCard(context) {
  if (context.kind === 'done') return todayDoneCard(context);
  if (context.kind === 'rest') return todayRestCard(context);
  if (context.kind === 'missed') return todayMissedCard(context);
  return todayPendingCard(context);
}

function todayPendingCard({ workout, weekIndex, workoutIndex }) {
  return `
    <article class="today-card">
      <p class="eyebrow">${dayFullDate(workout.date)}</p>
      <h2>${escapeHtml(workout.type)}</h2>
      ${recommendationCard(workout)}
      <button class="button primary today-action" data-action="open-register" data-week="${weekIndex}" data-workout="${workoutIndex}" type="button">
        <span>Registrar treino</span>
      </button>
    </article>
  `;
}

function todayDoneCard({ workout, weekIndex, workoutIndex }) {
  return `
    <article class="today-card is-done">
      <span class="finish-badge">Concluido hoje ✓</span>
      <p class="eyebrow">${dayFullDate(workout.date)}</p>
      <h2>${escapeHtml(workout.type)}</h2>
      ${workoutResultSummary(workout, true)}
      <button class="button secondary today-action" data-action="edit-register" data-week="${weekIndex}" data-workout="${workoutIndex}" type="button">
        <span>Editar registro</span>
      </button>
    </article>
  `;
}

function todayRestCard({ next }) {
  return `
    <article class="today-card rest-card">
      <div class="rest-symbol"><i data-lucide="moon"></i></div>
      <h2>Descanso ativo</h2>
      <p>Recuperacao faz parte do treino.</p>
      ${next ? `
        <div class="next-inline">
          <span>Proximo treino</span>
          <strong>${dayShortDate(next.workout.date)} · ${escapeHtml(next.workout.type)}</strong>
          <small>${escapeHtml(nextWorkoutDetail(next.workout))}</small>
        </div>
      ` : ''}
    </article>
  `;
}

function todayMissedCard({ workout, weekIndex, workoutIndex }) {
  return `
    <article class="today-card missed-card">
      <span class="status-pill missed">Nao registrado</span>
      <p class="eyebrow">${dayFullDate(workout.date)}</p>
      <h2>${escapeHtml(workout.type)}</h2>
      <p>${escapeHtml(workout.guidance ?? workout.notes)}</p>
      <button class="button primary today-action" data-action="open-register" data-week="${weekIndex}" data-workout="${workoutIndex}" type="button">
        <span>Registrar mesmo assim</span>
      </button>
    </article>
  `;
}

function recommendationCard(workout) {
  return `
    <div class="recommendation-card">
      <section>
        <h3>Como executar hoje</h3>
        <div class="execution-grid">
          <div class="recommendation-metric">
            <span>Pace alvo</span>
            <strong class="target-pace">${escapeHtml(formatPaceTarget(workout.paceTarget))}</strong>
          </div>
          <div class="recommendation-metric">
            <span>Zona de esforco</span>
            ${zonePill(workout.zone ?? zoneFor(workout))}
          </div>
          <div class="recommendation-metric icon-metric">
            <span>Duracao estimada</span>
            <strong><i data-lucide="clock-3"></i>${escapeHtml(`~${formatDuration(workout)}`)}</strong>
          </div>
          <div class="recommendation-metric icon-metric">
            <span>Volume estimado</span>
            <strong><i data-lucide="route"></i>${escapeHtml(`~${workout.distanceLabel ?? `${workout.distanceKm} km`}`)}</strong>
          </div>
        </div>
      </section>
      <section>
        <h3>Orientacao</h3>
        <p class="orientation-text">${escapeHtml(workout.notes)}</p>
        ${workout.guidance ? `<p class="guidance-tip">${escapeHtml(workout.guidance)}</p>` : ''}
      </section>
    </div>
  `;
}

function renderWeek() {
  const week = state.weeks.find((item) => String(item.week) === selectedWeek) ?? currentWeek();
  const weekIndex = state.weeks.indexOf(week);

  return `
    <section class="week-layout">
      <article class="week-picker-card">
        <button class="icon-button" data-action="week-prev" type="button" aria-label="Semana anterior">
          <i data-lucide="chevron-left"></i>
        </button>
        <div>
          <h2>Semana ${pad2(week.week)}</h2>
          <p>${escapeHtml(week.phase)} · ${escapeHtml(week.focus)}</p>
        </div>
        <button class="icon-button" data-action="week-next" type="button" aria-label="Proxima semana">
          <i data-lucide="chevron-right"></i>
        </button>
      </article>

      <div class="week-list">
        ${week.workouts.map((workout, workoutIndex) => weekWorkoutRow(workout, weekIndex, workoutIndex)).join('')}
      </div>
    </section>
  `;
}

function renderPreparation() {
  const allWorkouts = state.weeks.flatMap((week) => week.workouts);
  const runWorkouts = allWorkouts.filter((workout) => workout.distanceKm > 0);
  const completed = runWorkouts.filter(isWorkoutFinished).length;
  const totalKm = state.weeks.reduce((sum, week) => sum + Number(week.targetVolumeKm || 0), 0);

  return `
    <section class="preparation-layout">
      <article class="preparation-summary">
        ${compactMetric('Semanas', state.weeks.length)}
        ${compactMetric('Treinos', allWorkouts.length)}
        ${compactMetric('Volume planejado', `${round(totalKm)} km`)}
        ${compactMetric('Corridas concluidas', `${completed}/${runWorkouts.length}`)}
      </article>

      <div class="preparation-list">
        ${state.weeks.map((week, weekIndex) => preparationWeekCard(week, weekIndex)).join('')}
      </div>
    </section>
  `;
}

function preparationWeekCard(week, weekIndex) {
  const runWorkouts = week.workouts.filter((workout) => workout.distanceKm > 0);
  const done = runWorkouts.filter(isWorkoutFinished).length;

  return `
    <article class="preparation-week-card">
      <header class="preparation-week-header">
        <div>
          <span>Semana ${pad2(week.week)} · ${escapeHtml(week.phase)}</span>
          <h2>${escapeHtml(week.focus)}</h2>
        </div>
        <div>
          <strong>${escapeHtml(week.volumeLabel ?? `${week.targetVolumeKm} km`)}</strong>
          <small>${done}/${runWorkouts.length} feitos</small>
        </div>
      </header>

      <div class="preparation-workouts">
        ${week.workouts.map((workout, workoutIndex) => preparationWorkoutRow(workout, weekIndex, workoutIndex)).join('')}
      </div>
    </article>
  `;
}

function preparationWorkoutRow(workout, weekIndex, workoutIndex) {
  const isRest = Number(workout.distanceKm || 0) === 0;
  const status = workoutVisualStatus(workout);
  const action = isWorkoutFinished(workout) ? 'view-register' : 'open-register';
  const disabled = isRest ? 'disabled' : '';

  return `
    <button class="preparation-workout ${status.className}" ${disabled} data-action="${action}" data-week="${weekIndex}" data-workout="${workoutIndex}" type="button">
      <div class="preparation-date">
        <strong>${dayShortDate(workout.date)}</strong>
        <span>Treino ${pad2(workout.order ?? workoutIndex + 1)}</span>
      </div>
      <div class="preparation-main">
        <strong>${escapeHtml(isRest ? 'Descanso ativo' : workout.type)}</strong>
        <p><b>Objetivo:</b> ${escapeHtml(workout.guidance ?? workout.notes)}</p>
        <div class="workout-facts">
          <span>${escapeHtml(isRest ? 'Recuperacao' : `Volume ${workout.distanceLabel ?? `${workout.distanceKm} km`}`)}</span>
          <span>${escapeHtml(isRest ? 'Sem pace fixo' : `Pace ${compactPaceTarget(workout.paceTarget)}`)}</span>
          <span>${escapeHtml(isRest ? 'Descanso' : `Duracao ~${formatDuration(workout)}`)}</span>
          <span>${escapeHtml(workout.zone ?? zoneFor(workout))}</span>
        </div>
      </div>
      ${statusBadge(status)}
    </button>
  `;
}

function weekWorkoutRow(workout, weekIndex, workoutIndex) {
  const status = workoutVisualStatus(workout);
  const isRest = Number(workout.distanceKm || 0) === 0;
  const action = isWorkoutFinished(workout) ? 'view-register' : 'open-register';
  const disabled = isRest ? 'disabled' : '';

  return `
    <button class="week-workout ${status.className}" ${disabled} data-action="${action}" data-week="${weekIndex}" data-workout="${workoutIndex}" type="button">
      <div class="week-date">
        <strong>${dayShortDate(workout.date)}</strong>
        <span>Treino ${pad2(workout.order ?? workoutIndex + 1)}</span>
      </div>
      <div class="week-main">
        <strong>${escapeHtml(isRest ? 'Descanso ativo' : workout.type)}</strong>
        <p class="workout-objective"><b>Objetivo:</b> ${escapeHtml(workout.guidance ?? workout.notes)}</p>
        <div class="workout-facts">
          <span>${escapeHtml(isRest ? 'Recuperacao' : `Volume ${workout.distanceLabel ?? `${workout.distanceKm} km`}`)}</span>
          <span>${escapeHtml(isRest ? 'Sem pace' : `Pace ${compactPaceTarget(workout.paceTarget)}`)}</span>
          <span>${escapeHtml(isRest ? 'Descanso' : `Duracao ~${formatDuration(workout)}`)}</span>
        </div>
      </div>
      <div class="week-workout-meta">
        <b>${escapeHtml(isRest ? 'Solto' : compactPaceTarget(workout.paceTarget))}</b>
        <span>${escapeHtml(isRest ? 'recuperacao' : `~${formatDuration(workout)}`)}</span>
      </div>
      ${statusBadge(status)}
    </button>
  `;
}

function renderReport() {
  const finished = finishedWorkouts();
  const summary = reportSummary(finished);
  const completed = completedWorkouts();

  if (!finished.length) {
    return `
      <section class="report-layout">
        ${cycleProgressCard(completed)}
        <article class="empty-state">
          <div class="empty-icon"><i data-lucide="bar-chart-3"></i></div>
          <div>
            <h2>Evolucao ainda sem dados</h2>
            <p>Os graficos aparecem depois do primeiro treino finalizado.</p>
          </div>
        </article>
      </section>
    `;
  }

  return `
    <section class="report-layout">
      ${cycleProgressCard(completed)}

      <article class="feature-card">
        <div class="card-header">
          <div>
            <p class="eyebrow">Evolucao de pace</p>
            <h2>Treinos finalizados</h2>
          </div>
        </div>
        ${paceChart(finished)}
      </article>

      <div class="report-metrics">
        ${compactMetric('Pace medio', summary.averagePace, true)}
        ${compactMetric('Volume total', summary.totalKm)}
        ${compactMetric('PR provavel', summary.probablePr)}
        ${compactMetric('Carga', summary.load)}
      </div>

      ${recentCommentsCard(finished)}

      <article class="export-card">
        <div class="export-icon"><i data-lucide="file-text"></i></div>
        <div>
          <h2>Relatorio exportavel</h2>
          <p>Exporta somente treinos finalizados com registros reais.</p>
        </div>
        <button class="button primary" type="button" onclick="window.exportJson()">Exportar JSON</button>
      </article>
    </section>
  `;
}

function renderSettings() {
  return `
    <section class="settings-layout">
      <form class="settings-card" id="settingsForm">
        <label>
          Nome
          <input name="name" type="text" value="${escapeAttr(settings.name)}" autocomplete="name" />
        </label>
        <label>
          Unidade
          <select name="unit">
            <option value="km" ${settings.unit === 'km' ? 'selected' : ''}>km</option>
            <option value="mi" ${settings.unit === 'mi' ? 'selected' : ''}>mi</option>
          </select>
        </label>
        <label>
          Meta de pace
          <input name="paceGoal" type="text" inputmode="numeric" placeholder="5:41" value="${escapeAttr(settings.paceGoal)}" />
        </label>
        <button class="button primary" type="submit">
          <span>Salvar configuracoes</span>
        </button>
      </form>
    </section>
  `;
}

function openRegistrationModal(weekIndex, workoutIndex, forceEdit) {
  const workout = state.weeks[weekIndex]?.workouts[workoutIndex];
  if (!workout || Number(workout.distanceKm || 0) === 0) return;
  modalContext = { weekIndex, workoutIndex };
  modalContent.innerHTML = isWorkoutFinished(workout) && !forceEdit
    ? registrationSummary(workout, weekIndex, workoutIndex)
    : registrationForm(workout);
  registrationModal.hidden = false;
  drawIcons();
}

function closeRegistrationModal() {
  modalContext = null;
  registrationModal.hidden = true;
  modalContent.innerHTML = '';
}

function registrationForm(workout) {
  const execution = normalizeExecution(workout.execution ?? {});
  const hasComment = Boolean(execution.comentario);

  return `
    <form id="quickRegisterForm" class="quick-register" novalidate>
      <h2 id="modalTitle">Registrar treino</h2>
      <p class="modal-subtitle">${dayFullDate(workout.date)} · ${escapeHtml(workout.type)}</p>

      <label>
        Quantos km voce correu?
        <div class="unit-input">
          <input name="distance" type="number" min="0" step="0.1" value="${escapeAttr(execution.km_real ?? workout.distanceKm)}" required />
          <b>km</b>
        </div>
      </label>

      <label>
        Qual foi seu pace medio?
        <input name="pace" type="text" inputmode="numeric" placeholder="${escapeAttr(firstPace(workout.paceTarget) ?? '6:55')}" value="${escapeAttr(execution.pace_real ?? '')}" required />
        <span class="field-error" id="paceError" hidden>Digite no formato mm:ss</span>
      </label>

      <label class="rpe-field">
        <span>Como foi o esforco?</span>
        <div class="rpe-heading"><strong id="rpeValue">${escapeHtml(execution.rpe ?? 5)}</strong></div>
        <input name="rpe" type="range" min="1" max="10" step="1" value="${escapeAttr(execution.rpe ?? 5)}" />
        <div class="rpe-markers">
          <small class="easy">Facil</small>
          <small class="moderate">Moderado</small>
          <small class="hard">Forte</small>
          <small class="max">Maximo</small>
        </div>
      </label>

      <button class="text-link" data-action="toggle-comment" type="button" ${hasComment ? 'hidden' : ''}>+ Adicionar comentario</button>
      <label class="quick-note" id="commentField" ${hasComment ? '' : 'hidden'}>
        Comentario
        <textarea name="comment" rows="3" placeholder="Como voce se sentiu? Alguma observacao sobre o treino...">${escapeHtml(execution.comentario ?? '')}</textarea>
      </label>

      <button class="button confirm" type="submit">
        <span>Salvar treino ✓</span>
      </button>
    </form>
  `;
}

function registrationSummary(workout, weekIndex, workoutIndex) {
  const execution = normalizeExecution(workout.execution ?? {});
  return `
    <div class="quick-register">
      <h2 id="modalTitle">Registro concluido</h2>
      <p class="modal-subtitle">${dayFullDate(workout.date)} · ${escapeHtml(workout.type)}</p>
      ${workoutResultSummary(workout, true)}
      ${execution.comentario ? `<p class="summary-comment"><em>&ldquo;${escapeHtml(execution.comentario)}&rdquo;</em></p>` : '<p class="summary-comment muted">Sem comentario registrado.</p>'}
      <button class="button secondary" data-action="edit-register" data-week="${weekIndex}" data-workout="${workoutIndex}" type="button">
        <span>Editar registro</span>
      </button>
    </div>
  `;
}

function confirmRegistration(form) {
  if (!modalContext) return;
  const workout = state.weeks[modalContext.weekIndex].workouts[modalContext.workoutIndex];
  const data = new FormData(form);
  const distance = Number(data.get('distance'));
  const pace = normalizePaceInput(String(data.get('pace') ?? ''));
  const rpe = Number(data.get('rpe') ?? 5);
  const comment = String(data.get('comment') ?? '').trim();
  const paceField = form.querySelector('[name="pace"]');
  const paceError = form.querySelector('#paceError');

  paceField.classList.toggle('is-invalid', !isValidPace(pace));
  paceError.hidden = isValidPace(pace);

  if (!Number.isFinite(distance) || distance <= 0) {
    form.querySelector('[name="distance"]').focus();
    return;
  }

  if (!isValidPace(pace)) {
    paceField.focus();
    return;
  }

  const current = normalizeExecution(workout.execution ?? {});
  const executionDate = current.data_execucao ?? toIsoDate(new Date());
  workout.status = 'finalizado';
  workout.execution = {
    done: true,
    km_real: round(distance),
    pace_real: pace,
    rpe,
    comentario: comment,
    data_execucao: executionDate,
    atualizado_em: new Date().toISOString(),
    distanceKm: round(distance),
    pace,
    feeling: rpe,
    notes: comment,
    executedAt: executionDate,
  };

  persist({ silent: true });
  closeRegistrationModal();
  render();
  showToast('Treino salvo ✓');
}

function todayContext() {
  const today = toIsoDate(new Date());
  const current = workoutByDate(today);
  if (current) {
    if (Number(current.workout.distanceKm || 0) === 0) {
      return { kind: 'rest', ...current, next: nextWorkoutFromDate(today) };
    }
    return { kind: isWorkoutFinished(current.workout) ? 'done' : 'pending', ...current };
  }

  const missed = latestMissedWorkout(today);
  if (missed) return { kind: 'missed', ...missed };
  return { kind: 'rest', week: weekForDate(today), next: nextWorkoutFromDate(today) };
}

function latestMissedWorkout(date) {
  return allWorkoutRefs()
    .filter((item) => item.workout.date < date && item.workout.distanceKm > 0 && !isWorkoutFinished(item.workout))
    .sort((a, b) => b.workout.date.localeCompare(a.workout.date))[0] ?? null;
}

function allWorkoutRefs() {
  return state.weeks.flatMap((week, weekIndex) =>
    week.workouts.map((workout, workoutIndex) => ({ week, weekIndex, workoutIndex, workout })),
  );
}

function upcomingWeekList(week) {
  const today = toIsoDate(new Date());
  const items = (week?.workouts ?? [])
    .filter((workout) => workout.distanceKm > 0 && workout.date >= today)
    .slice(0, 3);
  const fallback = allWorkoutRefs()
    .map((item) => item.workout)
    .filter((workout) => workout.distanceKm > 0 && workout.date >= today)
    .slice(0, 3);
  const list = items.length ? items : fallback;

  return `
    <article class="feature-card compact-list">
      <h2>Proximos treinos</h2>
      ${list.map((workout) => `
        <div class="compact-row">
          <span>${dayShortDate(workout.date)}</span>
          <div>
            <strong>${escapeHtml(workout.type)}</strong>
            <small>${escapeHtml(nextWorkoutDetail(workout))}</small>
          </div>
        </div>
      `).join('') || '<p>Nenhum treino futuro na periodizacao.</p>'}
    </article>
  `;
}

function weekProgressCard(progress) {
  return `
    <article class="feature-card progress-card">
      <div class="progress-label">
        <span>${progress.done} de ${progress.total} treinos concluidos esta semana</span>
        <strong>${progress.percent}%</strong>
      </div>
      <div class="progress-track"><span style="width:${progress.percent}%"></span></div>
    </article>
  `;
}

function cycleProgressCard(progress) {
  return `
    <article class="feature-card progress-card">
      <div class="progress-label">
        <span>Total geral</span>
        <strong>${progress.done} de ${progress.total} treinos concluidos na periodizacao · ${progress.percent}%</strong>
      </div>
      <div class="progress-track"><span style="width:${progress.percent}%"></span></div>
    </article>
  `;
}

function workoutResultSummary(workout, includeComment = false) {
  const execution = normalizeExecution(workout.execution ?? {});
  return `
    <div class="result-summary">
      ${compactMetric('Km real', execution.km_real ? `${execution.km_real} km` : '-')}
      ${compactMetric('Pace real', execution.pace_real ? `${execution.pace_real}/km` : '-', true)}
      ${compactMetric('RPE', execution.rpe ?? '-')}
    </div>
    ${includeComment && execution.comentario ? `<p class="summary-comment"><em>&ldquo;${escapeHtml(execution.comentario)}&rdquo;</em></p>` : ''}
  `;
}

function paceChart(items) {
  const paces = items.map((item) => item.paceSeconds);
  const min = Math.min(...paces);
  const max = Math.max(...paces);
  const range = Math.max(1, max - min);
  const ticks = Array.from({ length: 5 }, (_, index) => formatPace(Math.round(min + (range / 4) * index))).reverse();
  const goal = parsePaceToSeconds(settings.paceGoal) ?? 341;

  return `
    <div class="pace-chart">
      <div class="y-axis">${ticks.map((tick) => `<span>${tick}</span>`).join('')}</div>
      <div class="chart-bars">
        <div class="goal-line"><span>Meta</span></div>
        ${items.map((item) => {
          const height = 28 + Math.round(((max - item.paceSeconds) / range) * 172);
          const isGoal = item.paceSeconds <= goal;
          return `
            <div class="bar-item">
              <span class="bar-value ${height < 56 ? 'dark' : ''}">${escapeHtml(item.execution.pace_real)}</span>
              <div class="pace-bar ${isGoal ? 'goal' : ''}" style="height:${height}px"></div>
              <small>${escapeHtml(item.chartLabel)}</small>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function recentCommentsCard(items) {
  const comments = items
    .filter((item) => item.execution.comentario)
    .slice(-3)
    .reverse();

  if (!comments.length) return '';

  return `
    <article class="feature-card recent-comments">
      <h2>Comentarios recentes</h2>
      ${comments.map((item) => `
        <div class="comment-card">
          <span>${dayShortDate(item.execution.data_execucao)} · ${escapeHtml(item.type)}</span>
          <p><em>&ldquo;${escapeHtml(item.execution.comentario)}&rdquo;</em></p>
        </div>
      `).join('')}
    </article>
  `;
}

function compactMetric(label, value, mono = false) {
  return `<div class="mini-metric"><span>${escapeHtml(label)}</span><strong class="${mono ? 'mono' : ''}">${escapeHtml(value)}</strong></div>`;
}

function nextWorkoutDetail(workout) {
  if (Number(workout.distanceKm || 0) === 0) return workout.guidance ?? workout.notes ?? 'Recuperacao';
  const volume = workout.distanceLabel ?? `${workout.distanceKm} km`;
  return `${volume} · ${compactPaceTarget(workout.paceTarget)} · ${workout.guidance ?? workout.notes}`;
}

function zonePill(zone) {
  return `<span class="zone-pill ${escapeAttr(String(zone).toLowerCase())}">${escapeHtml(zone)}</span>`;
}

function statusBadge(status) {
  if (status.className === 'rest') return '<span class="status-pill">Descanso</span>';
  if (status.className === 'done') return '<span class="status-pill done">Feito ✓</span>';
  if (status.className === 'today') return '<span class="status-pill today">Hoje</span>';
  if (status.className === 'missed') return '<span class="status-pill missed">Nao registrado</span>';
  return '<span class="status-pill">Futuro</span>';
}

function workoutVisualStatus(workout) {
  if (Number(workout.distanceKm || 0) === 0) return { className: 'rest' };
  if (isWorkoutFinished(workout)) return { className: 'done' };
  if (workout.date === toIsoDate(new Date())) return { className: 'today' };
  if (workout.date < toIsoDate(new Date())) return { className: 'missed' };
  return { className: 'future' };
}

function currentWeek() {
  return weekForDate(toIsoDate(new Date()))
    ?? state.weeks.find((week) => week.workouts.some((workout) => !isWorkoutFinished(workout) && workout.distanceKm > 0))
    ?? state.weeks.at(-1);
}

function weekForDate(date) {
  return state.weeks.find((week, index) => {
    const start = week.startsAt;
    const next = state.weeks[index + 1]?.startsAt;
    return date >= start && (!next || date < next);
  });
}

function workoutByDate(date) {
  for (const [weekIndex, week] of state.weeks.entries()) {
    const workoutIndex = week.workouts.findIndex((workout) => workout.date === date);
    if (workoutIndex >= 0) return { week, weekIndex, workoutIndex, workout: week.workouts[workoutIndex] };
  }
  return null;
}

function nextWorkoutFromDate(date) {
  return allWorkoutRefs().find((item) => item.workout.date > date && !isWorkoutFinished(item.workout) && item.workout.distanceKm > 0)
    ?? allWorkoutRefs().find((item) => !isWorkoutFinished(item.workout) && item.workout.distanceKm > 0)
    ?? null;
}

function weekProgress(week) {
  const all = (week?.workouts ?? []).filter((workout) => workout.distanceKm > 0);
  const done = all.filter(isWorkoutFinished);
  return { done: done.length, total: all.length, percent: all.length ? Math.round((done.length / all.length) * 100) : 0 };
}

function completedWorkouts() {
  const all = state.weeks.flatMap((week) => week.workouts).filter((workout) => workout.distanceKm > 0);
  const done = all.filter(isWorkoutFinished);
  return { done: done.length, total: all.length, percent: all.length ? Math.round((done.length / all.length) * 100) : 0 };
}

function finishedWorkouts() {
  const items = state.weeks
    .flatMap((week) => week.workouts.map((workout) => ({ ...workout, weekNumber: week.week, execution: normalizeExecution(workout.execution ?? {}) })))
    .filter((workout) =>
      workout.status === 'finalizado'
      && workout.distanceKm > 0
      && Number(workout.execution.km_real || 0) > 0
      && isValidPace(workout.execution.pace_real)
      && validRpe(workout.execution.rpe)
      && workout.execution.data_execucao
    )
    .map((workout) => ({ ...workout, paceSeconds: parsePaceToSeconds(workout.execution.pace_real) }));
  return withDistinctChartLabels(items);
}

function withDistinctChartLabels(items) {
  const seen = new Map();
  return items.map((item) => {
    const base = formatDateShort(item.execution.data_execucao);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { ...item, chartLabel: count > 1 ? `${base} #${count}` : base };
  });
}

function reportSummary(items) {
  const count = items.length;
  const totalKm = items.reduce((sum, item) => sum + Number(item.execution.km_real || 0), 0);
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
    .reduce((sum, workout) => sum + Number(normalizeExecution(workout.execution ?? {}).km_real || 0), 0);
  if (realVolume < 16) return 'baixa';
  if (realVolume <= 32) return 'media';
  return 'alta';
}

function estimateHalfMarathonTime(secondsPerKm) {
  const totalSeconds = Math.round(secondsPerKm * 21.1);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h${String(minutes).padStart(2, '0')}`;
}

function normalizePlanState() {
  if (!state?.weeks) return;
  state.schemaVersion = PLAN_VERSION;
  state.weeks.forEach((week, weekIndex) => {
    week.workouts.forEach((workout, workoutIndex) => {
      workout.week ??= week.week ?? weekIndex + 1;
      workout.order ??= workoutIndex + 1;
      workout.zone ??= zoneFor(workout);
      workout.durationMinutes ??= estimatedDurationMinutes(workout);
      workout.execution = normalizeExecution(workout.execution ?? {});
      if (workout.status === 'finalizado' && !canFinalizeWorkout(workout)) workout.status = 'pendente';
      workout.status = workout.status === 'finalizado' ? 'finalizado' : 'pendente';
      workout.execution.done = workout.status === 'finalizado';
    });
  });
}

function normalizeExecution(execution) {
  const km = execution.km_real ?? execution.distanceKm;
  const pace = execution.pace_real ?? execution.pace;
  const rpe = execution.rpe ?? execution.feeling;
  const comment = execution.comentario ?? execution.notes ?? '';
  const date = execution.data_execucao ?? execution.executedAt;
  return {
    ...execution,
    done: Boolean(execution.done),
    km_real: km,
    pace_real: pace,
    rpe,
    comentario: comment,
    data_execucao: date,
    distanceKm: km,
    pace,
    feeling: rpe,
    notes: comment,
    executedAt: date,
  };
}

function isWorkoutFinished(workout) {
  return workout.status === 'finalizado';
}

function canFinalizeWorkout(workout) {
  const execution = normalizeExecution(workout.execution ?? {});
  if (Number(workout.distanceKm || 0) === 0) return false;
  return Number(execution.km_real || 0) > 0 && isValidPace(execution.pace_real) && validRpe(execution.rpe);
}

function validRpe(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 10;
}

function isValidPace(value) {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})$/);
  return Boolean(match && Number(match[2]) < 60);
}

function normalizePaceInput(value) {
  const masked = maskPace(value);
  return isValidPace(masked) ? masked : value.trim();
}

function maskPace(value) {
  const digits = String(value).replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${Number(digits.slice(0, -2))}:${digits.slice(-2)}`;
}

function parsePaceToSeconds(value) {
  const match = String(value ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!match || Number(match[2]) >= 60) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatPace(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatPaceTarget(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === 'solto') return 'Solto, sem pace fixo';
  return raw.includes('/km') ? raw : `${raw}/km`;
}

function compactPaceTarget(value) {
  const pace = firstPace(value);
  return pace ? `${pace}/km` : 'Solto';
}

function firstPace(value) {
  return String(value ?? '').match(/\d{1,2}:\d{2}/)?.[0] ?? '';
}

function zoneFor(workout) {
  if (workout.distanceKm === 0) return 'Descanso';
  if (workout.effort >= 9) return 'Z5';
  if (workout.effort >= 7) return 'Z4';
  if (workout.effort >= 5) return 'Z3';
  if (workout.effort >= 3) return 'Z2';
  return 'Z1';
}

function estimatedDurationMinutes(workout) {
  if (!workout.distanceKm) return 0;
  const seconds = parsePaceToSeconds(firstPace(workout.paceTarget)) ?? 420;
  return Math.max(10, Math.round((seconds * workout.distanceKm) / 60));
}

function formatDuration(workout) {
  const minutes = Number(workout.durationMinutes) || estimatedDurationMinutes(workout);
  return `${minutes} min`;
}

function saveRunnerSettings(formData) {
  settings.name = String(formData.get('name') ?? '').trim() || 'Corredor';
  settings.unit = String(formData.get('unit') ?? 'km');
  settings.paceGoal = normalizePaceInput(String(formData.get('paceGoal') ?? '5:41')) || '5:41';
  saveSettings();
  showToast('Configuracoes salvas!');
  render();
}

function persist(options = {}) {
  localStorage.setItem(storageKey(), JSON.stringify(state));
  const mode = session && !localMode && authConfig?.persistenceEnabled ? 'nuvem' : 'local';
  saveStateEl.textContent = `salvo ${mode}`;
  if (!options.skipRemote) {
    scheduleRemoteSync();
    if (!options.silent) showToast('Treino salvo ✓');
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
    schemaVersion: state.schemaVersion,
    workouts: finishedWorkouts().map((workout) => ({
      id: workout.id,
      week: workout.weekNumber,
      order: workout.order,
      date_planned: workout.date,
      data_execucao: workout.execution.data_execucao,
      title: workout.type,
      status: workout.status,
      km_real: Number(workout.execution.km_real || 0),
      pace_real: workout.execution.pace_real,
      rpe: Number(workout.execution.rpe),
      comentario: workout.execution.comentario ?? '',
    })),
  };
  if (!payload.workouts.length) return;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `mypace-${toIsoDate(new Date())}.json`;
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
  }, 3000);
}

function authHeaders() {
  return { authorization: `Bearer ${session?.access_token ?? ''}` };
}

function storageKey() {
  const userId = session?.user?.id;
  return userId && !localMode ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;
}

function showApp() {
  entryView.hidden = true;
  loginView.hidden = true;
  appView.hidden = false;
  document.body.dataset.route = 'app';
}

function showEntry() {
  entryView.hidden = false;
  loginView.hidden = true;
  appView.hidden = true;
  document.body.dataset.route = 'entry';
  document.title = 'MyPace';
  drawIcons();
}

function showLogin() {
  entryView.hidden = true;
  loginView.hidden = false;
  appView.hidden = true;
  document.body.dataset.route = 'login';
  document.title = 'MyPace | Login';
  setAuthMessage('');
  drawIcons();
}

function isEntryRoute() {
  return window.location.pathname === '/';
}

function isLoginRoute() {
  return window.location.pathname === LOGIN_PATH;
}

function viewFromPath() {
  const view = ROUTES[window.location.pathname];
  if (view) return view;
  window.history.replaceState({}, '', '/hoje');
  return 'today';
}

function requiresLogin() {
  return Boolean(authConfig?.authEnabled && !session);
}

function navigateToLogin() {
  const next = encodeURIComponent(window.location.pathname || '/hoje');
  navigateTo(`${LOGIN_PATH}?next=${next}`);
}

function nextPathFromLogin() {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && ROUTES[next] ? next : '/hoje';
}

function setAuthMessage(message) {
  authMessage.textContent = message;
}

function normalizeLogin(value) {
  return value.includes('@') ? value : `${value.toLowerCase()}@run.local`;
}

function loadSettings() {
  const defaults = { theme: 'light', name: 'Guilherme', unit: 'km', paceGoal: '5:41' };

  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    const next = { ...defaults, ...stored };
    next.paceGoal = next.paceGoal === '6:10' ? defaults.paceGoal : next.paceGoal;
    return next;
  } catch {
    return defaults;
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

function renderSkeleton() {
  mainContent.innerHTML = `
    <div class="skeleton-grid">
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
    </div>
  `;
}

function parseLocalDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dayFullDate(value) {
  const date = parseLocalDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(date);
}

function dayShortDate(value) {
  const date = parseLocalDate(value);
  if (!date) return value;
  const formatted = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })
    .format(date)
    .replace('.', '');
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function formatDateShort(value) {
  const date = parseLocalDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(date).replace('.', '');
}

function weekdayAbbrev(value) {
  const date = parseLocalDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(date).replace('.', '').toUpperCase();
}

function dateNumeric(value) {
  const date = parseLocalDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
}

function round(value) {
  return Number(Number(value || 0).toFixed(1));
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
  return escapeHtml(value);
}

function drawIcons() {
  if (window.lucide) window.lucide.createIcons();
}

window.exportJson = exportJson;
window.closeQuickRegister = closeRegistrationModal;
window.drawMyPaceIcons = drawIcons;

boot();
