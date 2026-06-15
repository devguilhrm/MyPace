const STORAGE_KEY = 'mypace:runner:v8';
const SETTINGS_KEY = 'mypace:settings:v3';
const PLAN_VERSION = '6.2.0';
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
let preparationFilters = { week: 'all', phase: 'all', type: 'all', status: 'all' };
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
      if (!session && !isEntryRoute() && !isLoginRoute()) {
        state = null;
        navigateToLogin();
      }
    });
    localMode = !session;
  } else {
    localMode = false;
  }
  resolveAuthReady();

  if (isLoginRoute()) {
    if (session) navigateTo(nextPathFromLogin());
    else showLogin(authConfig?.authEnabled ? '' : 'Login indisponivel. Configure Supabase para acessar.');
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
  document.body.addEventListener('change', handleInput);
  document.body.addEventListener('submit', handleSubmit);
  window.addEventListener('popstate', handleRouteChange);
}

async function fetchConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Config indisponivel');
    return response.json();
  } catch {
    return { authEnabled: false, authRequired: true, persistenceEnabled: false, supabaseUrl: '', supabaseAnonKey: '' };
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
  localMode = false;
  navigateTo(LOGIN_PATH);
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
  const keys = session && !localMode
    ? [storageKey()]
    : [storageKey(), STORAGE_KEY, ...knownPlanKeys()];
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
  const options = session && !localMode ? { headers: authHeaders() } : undefined;
  const response = await fetch('/api/plan', options);
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
      workout.status = normalizeWorkoutStatus(old.status);
      workout.execution = normalizeExecution(old.execution ?? {});
    });
  });
}

function handleClick(event) {
  const action = event.target.closest('[data-action]');
  if (action) {
    const { action: name } = action.dataset;

    if (name === 'enter-app') {
      navigateTo(session ? '/hoje' : LOGIN_PATH);
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

    if (name === 'clear-preparation-filters') {
      preparationFilters = { week: 'all', phase: 'all', type: 'all', status: 'all' };
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
    if (session) navigateTo(nextPathFromLogin());
    else showLogin(authConfig?.authEnabled ? '' : 'Login indisponivel. Configure Supabase para acessar.');
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
    const previousAutoPace = target.dataset.autoPace ?? '';
    const cursorAtEnd = target.selectionStart === target.value.length;
    target.value = maskPace(target.value);
    if (cursorAtEnd) placeCursorAtEnd(target);
    target.dataset.manualPace = String(Boolean(target.value.trim() && target.value !== previousAutoPace));
  }

  if (target.name === 'duration') {
    target.value = maskDuration(target.value);
    if (event.type === 'input') placeCursorAtEnd(target);
  }

  if (target.name === 'distance') {
    target.value = maskDistance(target.value);
  }

  if (['distance', 'duration'].includes(target.name)) {
    updateAutoPace(target.closest('form'));
  }

  if (target.name === 'executionStatus') {
    target.closest('form')?.querySelector('#replacementField')?.toggleAttribute('hidden', target.value !== 'substituido');
    target.closest('form')?.querySelector('#trainingFields')?.toggleAttribute('hidden', target.value === 'perdido');
  }

  if (target.name === 'rpe') {
    document.querySelector('#rpeValue').textContent = target.value;
  }

  if (target.dataset.filter) {
    preparationFilters[target.dataset.filter] = target.value;
    render();
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
      <span class="finish-badge">${escapeHtml(statusLabel(workout.status))}</span>
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
  const completed = runWorkouts.filter(isWorkoutRecorded).length;
  const totalKm = state.weeks.reduce((sum, week) => sum + Number(week.targetVolumeKm || 0), 0);
  const filteredWeeks = filteredPreparationWeeks();
  const filteredCount = filteredWeeks.reduce((sum, week) => sum + week.workouts.length, 0);

  return `
    <section class="preparation-layout">
      <article class="preparation-summary">
        ${compactMetric('Semanas', state.weeks.length)}
        ${compactMetric('Treinos', allWorkouts.length)}
        ${compactMetric('Volume planejado', `${round(totalKm)} km`)}
        ${compactMetric('Registros', `${completed}/${runWorkouts.length}`)}
      </article>

      ${preparationFiltersCard(filteredCount)}

      <div class="preparation-list">
        ${filteredWeeks.map((week) => preparationWeekCard(week, week.weekIndex)).join('') || emptyFilteredState()}
      </div>
    </section>
  `;
}

function preparationFiltersCard(count) {
  const phases = [...new Set(state.weeks.map((week) => week.phase))];
  const types = [...new Set(state.weeks.flatMap((week) => week.workouts).filter((workout) => workout.distanceKm > 0).map((workout) => workout.type))];
  return `
    <article class="filter-card">
      <label>
        Semana
        <select data-filter="week">
          <option value="all" ${preparationFilters.week === 'all' ? 'selected' : ''}>Todas</option>
          ${state.weeks.map((week) => `<option value="${week.week}" ${String(preparationFilters.week) === String(week.week) ? 'selected' : ''}>Semana ${pad2(week.week)}</option>`).join('')}
        </select>
      </label>
      <label>
        Fase
        <select data-filter="phase">
          <option value="all" ${preparationFilters.phase === 'all' ? 'selected' : ''}>Todas</option>
          ${phases.map((phase) => `<option value="${escapeAttr(phase)}" ${preparationFilters.phase === phase ? 'selected' : ''}>${escapeHtml(phase)}</option>`).join('')}
        </select>
      </label>
      <label>
        Tipo
        <select data-filter="type">
          <option value="all" ${preparationFilters.type === 'all' ? 'selected' : ''}>Todos</option>
          ${types.map((type) => `<option value="${escapeAttr(type)}" ${preparationFilters.type === type ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('')}
        </select>
      </label>
      <label>
        Status
        <select data-filter="status">
          ${statusFilterOptions().map((option) => `<option value="${option.value}" ${preparationFilters.status === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}
        </select>
      </label>
      <button class="button secondary" data-action="clear-preparation-filters" type="button">
        <i data-lucide="rotate-ccw"></i>
        <span>Limpar</span>
      </button>
      <span class="filter-count">${count} treinos</span>
    </article>
  `;
}

function filteredPreparationWeeks() {
  return state.weeks
    .map((week, weekIndex) => ({
      ...week,
      weekIndex,
      workouts: week.workouts.filter((workout) => matchesPreparationFilters(week, workout)),
    }))
    .filter((week) => week.workouts.length);
}

function matchesPreparationFilters(week, workout) {
  if (preparationFilters.week !== 'all' && String(week.week) !== String(preparationFilters.week)) return false;
  if (preparationFilters.phase !== 'all' && week.phase !== preparationFilters.phase) return false;
  if (preparationFilters.type !== 'all' && workout.type !== preparationFilters.type) return false;
  if (preparationFilters.status !== 'all' && workoutStatusKey(workout) !== preparationFilters.status) return false;
  return true;
}

function statusFilterOptions() {
  return [
    { value: 'all', label: 'Todos' },
    { value: 'finalizado', label: 'Feitos' },
    { value: 'parcial', label: 'Parciais' },
    { value: 'substituido', label: 'Substituidos' },
    { value: 'perdido', label: 'Perdidos' },
    { value: 'pendente', label: 'Pendentes' },
  ];
}

function emptyFilteredState() {
  return `
    <article class="empty-state">
      <div class="empty-icon"><i data-lucide="filter-x"></i></div>
      <div>
        <h2>Nenhum treino encontrado</h2>
        <p>Ajuste os filtros para visualizar a preparacao.</p>
      </div>
    </article>
  `;
}

function preparationWeekCard(week, weekIndex) {
  const runWorkouts = week.workouts.filter((workout) => workout.distanceKm > 0);
  const done = runWorkouts.filter(isWorkoutRecorded).length;

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
  const action = isWorkoutRecorded(workout) ? 'view-register' : 'open-register';
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
  const action = isWorkoutRecorded(workout) ? 'view-register' : 'open-register';
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
  const recorded = recordedWorkouts();
  const summary = reportSummary(finished, recorded);
  const completed = completedWorkouts();
  const alerts = trainingAlerts(finished, recorded);

  if (!recorded.length) {
    return `
      <section class="report-layout">
        ${cycleProgressCard(completed)}
        ${progressCards(summary)}
        <article class="empty-state">
          <div class="empty-icon"><i data-lucide="bar-chart-3"></i></div>
          <div>
            <h2>Evolucao ainda sem dados</h2>
            <p>Os graficos aparecem depois do primeiro registro.</p>
          </div>
        </article>
      </section>
    `;
  }

  return `
    <section class="report-layout">
      ${cycleProgressCard(completed)}
      ${progressCards(summary)}
      ${alertsCard(alerts)}
      ${projectionCard(summary)}

      <article class="feature-card chart-card">
        <div class="card-header">
          <div>
            <p class="eyebrow">Evolucao de pace</p>
            <h2>Treinos com pace</h2>
          </div>
        </div>
        ${finished.length ? paceChart(finished) : '<p>Nenhum registro com pace valido ainda.</p>'}
      </article>

      <div class="chart-grid">
        ${weeklyVolumeChart(summary.weekly)}
        ${rpeChart(finished)}
        ${adherenceChart(summary.weekly)}
      </div>

      ${recentCommentsCard(finished)}
      ${historyCard(recorded)}

      <article class="export-card">
        <div class="export-icon"><i data-lucide="file-text"></i></div>
        <div>
          <h2>Relatorio exportavel</h2>
          <p>Exporta todos os registros com status, contexto e desempenho.</p>
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
  modalContent.innerHTML = isWorkoutRecorded(workout) && !forceEdit
    ? registrationSummary(workout, weekIndex, workoutIndex)
    : registrationForm(workout);
  registrationModal.hidden = false;
  document.body.classList.add('modal-open');
  modalContent.scrollTop = 0;
  drawIcons();
}

function closeRegistrationModal() {
  modalContext = null;
  registrationModal.hidden = true;
  document.body.classList.remove('modal-open');
  modalContent.innerHTML = '';
}

function registrationForm(workout) {
  const execution = normalizeExecution(workout.execution ?? {}, workout.status);
  const hasComment = Boolean(execution.comentario);
  const status = execution.status && execution.status !== 'pendente' ? execution.status : 'finalizado';
  const trainingFieldsHidden = status === 'perdido' ? 'hidden' : '';
  const replacementHidden = status === 'substituido' ? '' : 'hidden';

  return `
    <form id="quickRegisterForm" class="quick-register" novalidate>
      <h2 id="modalTitle">Registrar treino</h2>
      <p class="modal-subtitle">${dayFullDate(workout.date)} · ${escapeHtml(workout.type)}</p>

      <label>
        Status do treino
        <select name="executionStatus">
          ${executionStatusOptions().map((option) => `<option value="${option.value}" ${status === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}
        </select>
      </label>

      <div class="training-fields" id="trainingFields" ${trainingFieldsHidden}>
        <label>
          Distancia real
          <div class="unit-input">
            <input name="distance" type="text" inputmode="decimal" autocomplete="off" value="${escapeAttr(formatDistanceInput(execution.km_real ?? workout.distanceKm))}" />
            <b>km</b>
          </div>
          <span class="field-error" id="distanceError" hidden>Informe uma distancia maior que zero.</span>
        </label>

        <label>
          Tempo total
          <input name="duration" type="text" inputmode="numeric" placeholder="42:30 ou 1:42:30" value="${escapeAttr(execution.tempo_real ?? '')}" />
          <span class="field-error" id="durationError" hidden>Digite o tempo em mm:ss ou h:mm:ss.</span>
        </label>

        <label>
          Pace medio
          <input name="pace" type="text" inputmode="numeric" placeholder="${escapeAttr(firstPace(workout.paceTarget) ?? '5:41')}" value="${escapeAttr(execution.pace_real ?? '')}" />
          <span class="field-hint" id="paceHint">Calculado automaticamente pela distancia e tempo.</span>
          <span class="field-error" id="paceError" hidden>Digite no formato mm:ss.</span>
        </label>
      </div>

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

      <div class="form-grid">
        <label>
          Dor
          <select name="pain">
            ${selectOptions(['nenhuma', 'leve', 'moderada', 'forte'], execution.dor ?? 'nenhuma')}
          </select>
        </label>
        <label>
          Sono
          <select name="sleep">
            ${selectOptions(['bom', 'regular', 'ruim'], execution.sono ?? 'regular')}
          </select>
        </label>
      </div>

      <label>
        Clima
        <input name="weather" type="text" placeholder="Ex.: quente, umido, chuva leve" value="${escapeAttr(execution.clima ?? '')}" />
      </label>

      <label id="replacementField" ${replacementHidden}>
        O que substituiu?
        <input name="replacement" type="text" placeholder="Ex.: bike 45 min, esteira leve, caminhada" value="${escapeAttr(execution.substituicao ?? '')}" />
        <span class="field-error" id="replacementError" hidden>Descreva o treino substituto.</span>
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
  const execution = normalizeExecution(workout.execution ?? {}, workout.status);
  return `
    <div class="quick-register">
      <h2 id="modalTitle">${escapeHtml(statusLabel(workout.status))}</h2>
      <p class="modal-subtitle">${dayFullDate(workout.date)} · ${escapeHtml(workout.type)}</p>
      ${workoutResultSummary(workout, true)}
      ${execution.desempenho ? `<p class="performance-sentence">${escapeHtml(execution.desempenho)}</p>` : ''}
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
  const status = String(data.get('executionStatus') ?? 'finalizado');
  const distance = parseDistanceInput(data.get('distance'));
  const duration = normalizeDurationInput(String(data.get('duration') ?? ''));
  const pace = normalizePaceInput(String(data.get('pace') ?? ''));
  const rpe = Number(data.get('rpe') ?? 5);
  const pain = String(data.get('pain') ?? 'nenhuma');
  const sleep = String(data.get('sleep') ?? 'regular');
  const weather = String(data.get('weather') ?? '').trim();
  const replacement = String(data.get('replacement') ?? '').trim();
  const comment = String(data.get('comment') ?? '').trim();
  const requiresTrainingData = status !== 'perdido';
  const paceField = form.querySelector('[name="pace"]');
  const paceError = form.querySelector('#paceError');
  const distanceField = form.querySelector('[name="distance"]');
  const distanceError = form.querySelector('#distanceError');
  const durationField = form.querySelector('[name="duration"]');
  const durationError = form.querySelector('#durationError');
  const replacementField = form.querySelector('[name="replacement"]');
  const replacementError = form.querySelector('#replacementError');
  const validDistance = !requiresTrainingData || (Number.isFinite(distance) && distance > 0);
  const validDuration = !requiresTrainingData || isValidDuration(duration);
  const validPace = !requiresTrainingData || isValidPace(pace);
  const validReplacement = status !== 'substituido' || replacement.length >= 3;

  distanceField?.classList.toggle('is-invalid', !validDistance);
  durationField?.classList.toggle('is-invalid', !validDuration);
  paceField?.classList.toggle('is-invalid', !validPace);
  replacementField?.classList.toggle('is-invalid', !validReplacement);
  if (distanceError) distanceError.hidden = validDistance;
  if (durationError) durationError.hidden = validDuration;
  if (paceError) paceError.hidden = validPace;
  if (replacementError) replacementError.hidden = validReplacement;

  if (!validDistance) {
    distanceField?.focus();
    return;
  }

  if (!validDuration) {
    durationField?.focus();
    return;
  }

  if (!validPace) {
    paceField?.focus();
    return;
  }

  if (!validReplacement) {
    replacementField?.focus();
    return;
  }

  const current = normalizeExecution(workout.execution ?? {}, workout.status);
  const executionDate = current.data_execucao ?? toIsoDate(new Date());
  workout.status = status;
  workout.execution = {
    done: status === 'finalizado',
    status,
    km_real: requiresTrainingData ? round(distance) : 0,
    tempo_real: requiresTrainingData ? duration : '',
    pace_real: requiresTrainingData ? pace : '',
    rpe,
    dor: pain,
    sono: sleep,
    clima: weather,
    substituicao: replacement,
    comentario: comment,
    desempenho: performanceSentence(workout, { status, distance, pace, rpe, pain }),
    data_execucao: executionDate,
    atualizado_em: new Date().toISOString(),
    distanceKm: requiresTrainingData ? round(distance) : 0,
    duration: requiresTrainingData ? duration : '',
    pace: requiresTrainingData ? pace : '',
    feeling: rpe,
    notes: comment,
    executedAt: executionDate,
  };

  persist({ silent: true });
  closeRegistrationModal();
  render();
  showToast(status === 'perdido' ? 'Treino marcado como perdido' : 'Registro salvo ✓');
}

function todayContext() {
  const today = toIsoDate(new Date());
  const current = workoutByDate(today);
  if (current) {
    if (Number(current.workout.distanceKm || 0) === 0) {
      return { kind: 'rest', ...current, next: nextWorkoutFromDate(today) };
    }
    return { kind: isWorkoutRecorded(current.workout) ? 'done' : 'pending', ...current };
  }

  const missed = latestMissedWorkout(today);
  if (missed) return { kind: 'missed', ...missed };
  return { kind: 'rest', week: weekForDate(today), next: nextWorkoutFromDate(today) };
}

function latestMissedWorkout(date) {
  return allWorkoutRefs()
    .filter((item) => item.workout.date < date && item.workout.distanceKm > 0 && !isWorkoutRecorded(item.workout))
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
        <span>${progress.done} de ${progress.total} treinos registrados esta semana</span>
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
        <strong>${progress.done} de ${progress.total} treinos registrados na periodizacao · ${progress.percent}%</strong>
      </div>
      <div class="progress-track"><span style="width:${progress.percent}%"></span></div>
    </article>
  `;
}

function workoutResultSummary(workout, includeComment = false) {
  const execution = normalizeExecution(workout.execution ?? {}, workout.status);
  const status = statusLabel(workout.status);
  return `
    <div class="result-summary">
      ${compactMetric('Status', status)}
      ${compactMetric('Km real', execution.km_real ? `${execution.km_real} km` : '-')}
      ${compactMetric('Tempo', execution.tempo_real || '-')}
      ${compactMetric('Pace real', execution.pace_real ? `${execution.pace_real}/km` : '-', true)}
      ${compactMetric('RPE', execution.rpe ?? '-')}
      ${compactMetric('Dor', execution.dor ?? '-')}
    </div>
    <div class="context-line">
      <span>Planejado: ${escapeHtml(workout.distanceLabel ?? `${workout.distanceKm} km`)}</span>
      <span>Alvo: ${escapeHtml(compactPaceTarget(workout.paceTarget))}</span>
      <span>Sono: ${escapeHtml(execution.sono ?? '-')}</span>
      <span>Clima: ${escapeHtml(execution.clima || '-')}</span>
      ${execution.substituicao ? `<span>Substituto: ${escapeHtml(execution.substituicao)}</span>` : ''}
    </div>
    ${execution.desempenho ? `<p class="performance-sentence">${escapeHtml(execution.desempenho)}</p>` : ''}
    ${includeComment && execution.comentario ? `<p class="summary-comment"><em>&ldquo;${escapeHtml(execution.comentario)}&rdquo;</em></p>` : ''}
  `;
}

function paceChart(items) {
  const paces = items.map((item) => item.paceSeconds);
  const min = Math.min(...paces);
  const max = Math.max(...paces);
  const range = Math.max(1, max - min);
  const ticks = Array.from({ length: 5 }, (_, index) => formatPace(Math.round(min + (range / 4) * index))).reverse();
  const goal = targetGoalPaceSeconds();

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

function progressCards(summary) {
  return `
    <div class="report-metrics">
      ${compactMetric('Km registrados', summary.totalKm)}
      ${compactMetric('Treinos registrados', summary.workoutsDone)}
      ${compactMetric('Consistencia', summary.consistency)}
      ${compactMetric('Melhor pace', summary.bestPace, true)}
    </div>
  `;
}

function alertsCard(alerts) {
  return `
    <article class="feature-card alerts-card ${alerts.some((alert) => alert.level === 'danger') ? 'has-danger' : ''}">
      <div class="card-header">
        <div>
          <p class="eyebrow">Alertas</p>
          <h2>Fadiga e meta</h2>
        </div>
      </div>
      ${alerts.map((alert) => `
        <div class="alert-row ${alert.level}">
          <i data-lucide="${alert.icon}"></i>
          <p>${escapeHtml(alert.message)}</p>
        </div>
      `).join('')}
    </article>
  `;
}

function projectionCard(summary) {
  const projection = summary.probablePr;
  const pace = summary.projectionSeconds ? `${formatPace(summary.projectionSeconds)}/km` : '-';
  const distance = targetDistanceKm();
  const goal = targetGoalPaceSeconds();
  const delta = summary.projectionSeconds ? summary.projectionSeconds - goal : null;
  const title = distance >= 20 ? 'Meia maratona provavel' : `${formatDistanceLabel(distance)} provavel`;
  const message = delta === null
    ? 'Registre alguns treinos com pace para projetar o alvo.'
    : delta <= 0
      ? 'A tendencia atual conversa com a meta do plano.'
      : `A tendencia esta ${Math.round(delta)}s/km acima da referencia. Ajuste carga, recuperacao e consistencia antes de forcar ritmo.`;

  return `
    <article class="feature-card projection-card">
      <div>
        <p class="eyebrow">Projecao</p>
        <h2>${escapeHtml(title)}</h2>
      </div>
      <div class="projection-main">
        <strong>${escapeHtml(projection)}</strong>
        <span>${escapeHtml(pace)}</span>
      </div>
      <p>${escapeHtml(message)}</p>
    </article>
  `;
}

function weeklyVolumeChart(weekly) {
  const visible = weekly.filter((week) => week.recorded || week.week <= Number(selectedWeek)).slice(-8);
  const max = Math.max(1, ...visible.map((week) => week.volume));
  return smallBarChart('Volume semanal', 'Km registrados', visible, (week) => week.volume, max, 'km');
}

function rpeChart(items) {
  const visible = items.slice(-8).map((item) => ({ week: item.chartLabel, value: Number(item.execution.rpe || 0) }));
  return smallBarChart('RPE', 'Esforco recente', visible, (item) => item.value, 10, '');
}

function adherenceChart(weekly) {
  const visible = weekly.filter((week) => week.recorded || week.week <= Number(selectedWeek)).slice(-8);
  return smallBarChart('Aderencia', 'Registros por semana', visible, (week) => week.adherence, 100, '%');
}

function smallBarChart(title, subtitle, items, valueGetter, max, suffix) {
  return `
    <article class="feature-card mini-chart-card">
      <p class="eyebrow">${escapeHtml(subtitle)}</p>
      <h2>${escapeHtml(title)}</h2>
      <div class="mini-chart">
        ${items.map((item) => {
          const value = Number(valueGetter(item) || 0);
          const height = Math.max(8, Math.round((value / Math.max(1, max)) * 112));
          const label = item.chartLabel ?? `S${pad2(item.week)}`;
          return `
            <div class="mini-bar-item">
              <span>${escapeHtml(`${value}${suffix}`)}</span>
              <b style="height:${height}px"></b>
              <small>${escapeHtml(label)}</small>
            </div>
          `;
        }).join('') || '<p>Sem dados.</p>'}
      </div>
    </article>
  `;
}

function trainingAlerts(finished, recorded) {
  const alerts = [];
  const recentRecorded = recorded.slice(-5);
  const highRpe = recentRecorded.filter((workout) => Number(workout.execution.rpe) >= 8).length;
  const pain = recentRecorded.filter((workout) => ['moderada', 'forte'].includes(workout.execution.dor)).length;
  const lost = recentRecorded.filter((workout) => workout.status === 'perdido').length;
  const goal = targetGoalPaceSeconds();
  const recentPace = finished.slice(-4);
  const avgRecentPace = recentPace.length
    ? Math.round(recentPace.reduce((sum, workout) => sum + workout.paceSeconds, 0) / recentPace.length)
    : null;

  if (highRpe >= 2) alerts.push({ level: 'danger', icon: 'activity', message: 'RPE alto em pelo menos 2 registros recentes. Reduza intensidade se isso vier com sono ruim ou dor.' });
  if (pain >= 1) alerts.push({ level: 'danger', icon: 'circle-alert', message: 'Dor moderada/forte apareceu nos registros recentes. Evite qualidade ate correr sem alterar passada.' });
  if (lost >= 2) alerts.push({ level: 'warn', icon: 'calendar-x', message: 'Dois treinos recentes foram perdidos. Mantenha o calendario e nao tente compensar volume de uma vez.' });
  if (avgRecentPace && avgRecentPace > goal + 25) alerts.push({ level: 'warn', icon: 'target', message: 'Pace recente ainda esta acima da referencia do plano. A meta pode precisar de ajuste se isso persistir nos checkpoints.' });
  if (!alerts.length) alerts.push({ level: 'good', icon: 'check-circle-2', message: 'Sem alerta relevante pelos registros recentes. Continue priorizando consistencia e recuperacao.' });
  return alerts;
}

function historyCard(items) {
  return `
    <article class="feature-card history-card">
      <div class="card-header">
        <div>
          <p class="eyebrow">Historico</p>
          <h2>Todos os registros</h2>
        </div>
      </div>
      <div class="history-list">
        ${items.slice().reverse().map((item) => `
          <div class="history-row">
            <div>
              <strong>${dayShortDate(item.execution.data_execucao ?? item.date)} · ${escapeHtml(item.type)}</strong>
              <span>${escapeHtml(statusLabel(item.status))} · Planejado ${escapeHtml(item.distanceLabel ?? `${item.distanceKm} km`)} · Real ${escapeHtml(item.execution.km_real ? `${item.execution.km_real} km` : '-')}</span>
              ${item.execution.desempenho ? `<p>${escapeHtml(item.execution.desempenho)}</p>` : ''}
            </div>
            <div>
              <b>${escapeHtml(item.execution.pace_real ? `${item.execution.pace_real}/km` : '-')}</b>
              <small>RPE ${escapeHtml(item.execution.rpe ?? '-')}</small>
            </div>
          </div>
        `).join('')}
      </div>
    </article>
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
  if (status.className === 'finalizado') return '<span class="status-pill done">Feito ✓</span>';
  if (status.className === 'parcial') return '<span class="status-pill partial">Parcial</span>';
  if (status.className === 'substituido') return '<span class="status-pill replaced">Substituido</span>';
  if (status.className === 'perdido') return '<span class="status-pill lost">Perdido</span>';
  if (status.className === 'today') return '<span class="status-pill today">Hoje</span>';
  if (status.className === 'missed') return '<span class="status-pill missed">Nao registrado</span>';
  return '<span class="status-pill">Futuro</span>';
}

function workoutVisualStatus(workout) {
  if (Number(workout.distanceKm || 0) === 0) return { className: 'rest' };
  if (isWorkoutRecorded(workout)) return { className: workoutStatusKey(workout) };
  if (workout.date === toIsoDate(new Date())) return { className: 'today' };
  if (workout.date < toIsoDate(new Date())) return { className: 'missed' };
  return { className: 'future' };
}

function currentWeek() {
  return weekForDate(toIsoDate(new Date()))
    ?? state.weeks.find((week) => week.workouts.some((workout) => !isWorkoutRecorded(workout) && workout.distanceKm > 0))
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
  return allWorkoutRefs().find((item) => item.workout.date > date && !isWorkoutRecorded(item.workout) && item.workout.distanceKm > 0)
    ?? allWorkoutRefs().find((item) => !isWorkoutRecorded(item.workout) && item.workout.distanceKm > 0)
    ?? null;
}

function weekProgress(week) {
  const all = (week?.workouts ?? []).filter((workout) => workout.distanceKm > 0);
  const done = all.filter(isWorkoutRecorded);
  return { done: done.length, total: all.length, percent: all.length ? Math.round((done.length / all.length) * 100) : 0 };
}

function completedWorkouts() {
  const all = state.weeks.flatMap((week) => week.workouts).filter((workout) => workout.distanceKm > 0);
  const done = all.filter(isWorkoutRecorded);
  return { done: done.length, total: all.length, percent: all.length ? Math.round((done.length / all.length) * 100) : 0 };
}

function finishedWorkouts() {
  const items = state.weeks
    .flatMap((week) => week.workouts.map((workout) => ({ ...workout, weekNumber: week.week, execution: normalizeExecution(workout.execution ?? {}, workout.status) })))
    .filter((workout) =>
      isWorkoutRecorded(workout)
      && workout.status !== 'perdido'
      && workout.distanceKm > 0
      && Number(workout.execution.km_real || 0) > 0
      && isValidPace(workout.execution.pace_real)
      && validRpe(workout.execution.rpe)
      && workout.execution.data_execucao
    )
    .map((workout) => ({ ...workout, paceSeconds: parsePaceToSeconds(workout.execution.pace_real) }));
  return withDistinctChartLabels(items);
}

function recordedWorkouts() {
  return state.weeks
    .flatMap((week) => week.workouts.map((workout) => ({ ...workout, weekNumber: week.week, execution: normalizeExecution(workout.execution ?? {}, workout.status) })))
    .filter((workout) => workout.distanceKm > 0 && isWorkoutRecorded(workout))
    .sort((a, b) => `${a.execution.data_execucao ?? a.date}`.localeCompare(`${b.execution.data_execucao ?? b.date}`));
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

function reportSummary(items, recorded = recordedWorkouts()) {
  const count = items.length;
  const totalKm = recorded.reduce((sum, item) => sum + Number(item.execution.km_real || 0), 0);
  const avgPace = count ? Math.round(items.reduce((sum, item) => sum + item.paceSeconds, 0) / count) : null;
  const bestPace = count ? Math.min(...items.map((item) => item.paceSeconds)) : null;
  const completed = completedWorkouts();
  const adherence = completed.percent;
  const weekly = weeklyStats(recorded);
  return {
    averagePace: avgPace ? `${formatPace(avgPace)}/km` : '-',
    totalKm: `${round(totalKm)} km`,
    bestPace: bestPace ? `${formatPace(bestPace)}/km` : '-',
    probablePr: bestPace ? estimateDistanceTime(projectedRacePace(items), targetDistanceKm()) : '-',
    projectionSeconds: bestPace ? projectedRacePace(items) : null,
    load: classifyWeekLoad(items.at(-1)?.weekNumber),
    workoutsDone: `${recorded.length}/${allRunWorkouts().length}`,
    consistency: `${adherence}%`,
    weekly,
  };
}

function allRunWorkouts() {
  return state.weeks.flatMap((week) => week.workouts).filter((workout) => workout.distanceKm > 0);
}

function weeklyStats(recorded) {
  return state.weeks.map((week) => {
    const runWorkouts = week.workouts.filter((workout) => workout.distanceKm > 0);
    const records = recorded.filter((workout) => workout.weekNumber === week.week);
    const done = records.filter((workout) => workout.status === 'finalizado').length;
    const partial = records.filter((workout) => workout.status === 'parcial' || workout.status === 'substituido').length;
    const lost = records.filter((workout) => workout.status === 'perdido').length;
    const volume = records.reduce((sum, workout) => sum + Number(workout.execution.km_real || 0), 0);
    const rpes = records.map((workout) => Number(workout.execution.rpe)).filter(validRpe);
    return {
      week: week.week,
      planned: runWorkouts.length,
      recorded: records.length,
      done,
      partial,
      lost,
      adherence: runWorkouts.length ? Math.round((records.length / runWorkouts.length) * 100) : 0,
      volume: round(volume),
      avgRpe: rpes.length ? round(rpes.reduce((sum, value) => sum + value, 0) / rpes.length) : 0,
    };
  });
}

function projectedRacePace(items) {
  const recent = items.slice(-6);
  const weighted = recent.reduce((sum, item, index) => sum + item.paceSeconds * (index + 1), 0);
  const weights = recent.reduce((sum, _item, index) => sum + index + 1, 0);
  return Math.round(weighted / Math.max(1, weights));
}

function classifyWeekLoad(weekNumber) {
  const week = state.weeks.find((item) => item.week === weekNumber);
  if (!week) return '-';
  const realVolume = week.workouts
    .filter(isWorkoutRecorded)
    .reduce((sum, workout) => sum + Number(normalizeExecution(workout.execution ?? {}, workout.status).km_real || 0), 0);
  if (realVolume < 16) return 'baixa';
  if (realVolume <= 32) return 'media';
  return 'alta';
}

function estimateDistanceTime(secondsPerKm, distanceKm) {
  const totalSeconds = Math.round(secondsPerKm * distanceKm);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours <= 0) return `${minutes}:${String(seconds).padStart(2, '0')}`;
  return `${hours}h${String(minutes).padStart(2, '0')}`;
}

function targetDistanceKm() {
  return Number(state?.planMeta?.targetRaceDistanceKm || 21.1);
}

function targetGoalPaceSeconds() {
  const defaultGoal = targetDistanceKm() >= 20 ? 341 : 536;
  const parsed = parsePaceToSeconds(settings.paceGoal);
  if (targetDistanceKm() < 10 && settings.paceGoal === '5:41') return defaultGoal;
  return parsed ?? defaultGoal;
}

function formatDistanceLabel(distanceKm) {
  return Number.isInteger(distanceKm) ? `${distanceKm} km` : `${String(distanceKm).replace('.', ',')} km`;
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
      workout.status = normalizeWorkoutStatus(workout.execution?.status ?? workout.status);
      workout.execution = normalizeExecution(workout.execution ?? {}, workout.status);
      if (['finalizado', 'parcial', 'substituido'].includes(workout.status) && !canFinalizeWorkout(workout)) workout.status = 'pendente';
      if (workout.status === 'perdido') workout.execution.done = false;
      else workout.execution.done = workout.status === 'finalizado';
      workout.execution.status = workout.status;
    });
  });
}

function normalizeExecution(execution, fallbackStatus = 'pendente') {
  const km = execution.km_real ?? execution.distanceKm;
  const duration = execution.tempo_real ?? execution.duration ?? '';
  const pace = execution.pace_real ?? execution.pace;
  const rpe = execution.rpe ?? execution.feeling;
  const comment = execution.comentario ?? execution.notes ?? '';
  const date = execution.data_execucao ?? execution.executedAt;
  const status = normalizeWorkoutStatus(execution.status ?? fallbackStatus);
  return {
    ...execution,
    done: status === 'finalizado',
    status,
    km_real: km,
    tempo_real: duration,
    pace_real: pace,
    rpe,
    dor: execution.dor ?? 'nenhuma',
    sono: execution.sono ?? 'regular',
    clima: execution.clima ?? '',
    substituicao: execution.substituicao ?? '',
    comentario: comment,
    desempenho: execution.desempenho ?? '',
    data_execucao: date,
    distanceKm: km,
    duration,
    pace,
    feeling: rpe,
    notes: comment,
    executedAt: date,
  };
}

function isWorkoutFinished(workout) {
  return workout.status === 'finalizado';
}

function isWorkoutRecorded(workout) {
  return ['finalizado', 'parcial', 'substituido', 'perdido'].includes(workout.status);
}

function normalizeWorkoutStatus(value) {
  return ['finalizado', 'parcial', 'substituido', 'perdido'].includes(value) ? value : 'pendente';
}

function workoutStatusKey(workout) {
  return normalizeWorkoutStatus(workout.status);
}

function canFinalizeWorkout(workout) {
  const execution = normalizeExecution(workout.execution ?? {}, workout.status);
  if (Number(workout.distanceKm || 0) === 0) return false;
  return Number(execution.km_real || 0) > 0 && isValidPace(execution.pace_real) && validRpe(execution.rpe);
}

function validRpe(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 10;
}

function executionStatusOptions() {
  return [
    { value: 'finalizado', label: 'Feito' },
    { value: 'parcial', label: 'Parcial' },
    { value: 'substituido', label: 'Substituido' },
    { value: 'perdido', label: 'Perdido' },
  ];
}

function selectOptions(values, selected) {
  return values.map((value) => `<option value="${escapeAttr(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(capitalize(value))}</option>`).join('');
}

function statusLabel(status) {
  const labels = {
    finalizado: 'Treino feito',
    parcial: 'Treino parcial',
    substituido: 'Treino substituido',
    perdido: 'Treino perdido',
    pendente: 'Pendente',
  };
  return labels[normalizeWorkoutStatus(status)] ?? 'Pendente';
}

function isValidPace(value) {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})$/);
  return Boolean(match && Number(match[2]) < 60);
}

function isValidDuration(value) {
  return parseDurationToSeconds(value) !== null;
}

function normalizePaceInput(value) {
  const masked = maskPace(value);
  return isValidPace(masked) ? masked : value.trim();
}

function normalizeDurationInput(value) {
  return maskDuration(value).trim();
}

function formatDistanceInput(value) {
  const distance = Number(value);
  if (!Number.isFinite(distance)) return '';
  return String(distance).replace('.', ',');
}

function parseDistanceInput(value) {
  const normalized = String(value ?? '').replace(',', '.').trim();
  const distance = Number(normalized);
  return Number.isFinite(distance) ? distance : NaN;
}

function maskDistance(value) {
  const raw = String(value ?? '');
  const separator = raw.includes(',') ? ',' : raw.includes('.') ? '.' : '';
  const normalized = raw.replace(',', '.');
  const [integer = '', decimal = ''] = normalized.split('.');
  const integerDigits = integer.replace(/\D/g, '').slice(0, 3);
  const decimalDigits = decimal.replace(/\D/g, '').slice(0, 2);
  if (separator) return `${integerDigits}${separator}${decimalDigits}`;
  return integerDigits;
}

function maskPace(value) {
  const raw = String(value ?? '').trim();
  if (raw.includes(':')) return raw.replace(/[^\d:]/g, '').replace(/:{2,}/g, ':').slice(0, 5);
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${Number(digits.slice(0, -2))}:${digits.slice(-2)}`;
}

function maskDuration(value) {
  const raw = String(value ?? '').trim();
  if (raw.includes(':')) return raw.replace(/[^\d:]/g, '').replace(/:{2,}/g, ':').slice(0, 8);
  const digits = raw.replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${Number(digits.slice(0, -2))}:${digits.slice(-2)}`;
  return `${Number(digits.slice(0, -4))}:${digits.slice(-4, -2)}:${digits.slice(-2)}`;
}

function parseDurationToSeconds(value) {
  const parts = String(value ?? '').split(':').map(Number);
  if (![2, 3].includes(parts.length) || parts.some((part) => !Number.isFinite(part))) return null;
  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  if (minutes >= 60 || seconds >= 60 || hours < 0 || minutes < 0 || seconds < 0) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}

function updateAutoPace(form) {
  if (!form) return;
  const distance = parseDistanceInput(form.querySelector('[name="distance"]')?.value);
  const duration = parseDurationToSeconds(form.querySelector('[name="duration"]')?.value);
  const paceField = form.querySelector('[name="pace"]');
  if (!paceField || !Number.isFinite(distance) || distance <= 0 || !duration) return;
  const nextPace = formatPace(Math.round(duration / distance));
  if (paceField.dataset.manualPace === 'true' && paceField.value.trim() && paceField.value !== paceField.dataset.autoPace) return;
  paceField.value = nextPace;
  paceField.dataset.autoPace = nextPace;
  paceField.dataset.manualPace = 'false';
}

function placeCursorAtEnd(input) {
  window.requestAnimationFrame(() => {
    try {
      input.setSelectionRange(input.value.length, input.value.length);
    } catch {
      // Some mobile keyboards do not expose selection for every input state.
    }
  });
}

function parsePaceToSeconds(value) {
  const match = String(value ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!match || Number(match[2]) >= 60) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function performanceSentence(workout, execution) {
  if (execution.status === 'perdido') return 'Treino perdido registrado. O melhor ajuste e seguir o calendario sem tentar compensar tudo de uma vez.';
  if (execution.status === 'substituido') return 'Treino substituido registrado. Mantem aderencia, mas nao substitui totalmente o estimulo especifico planejado.';

  const plannedKm = Number(workout.distanceKm || 0);
  const realKm = Number(execution.distance || 0);
  const targetPace = parsePaceToSeconds(firstPace(workout.paceTarget));
  const realPace = parsePaceToSeconds(execution.pace);
  const kmRatio = plannedKm ? realKm / plannedKm : 1;
  const paceDelta = targetPace && realPace ? realPace - targetPace : 0;
  const rpe = Number(execution.rpe || 0);
  const pain = execution.pain;

  if (execution.status === 'parcial') {
    return `Parcial bem registrado: voce fez ${Math.round(kmRatio * 100)}% do volume planejado. Preserve a recuperacao e volte ao plano no proximo treino.`;
  }

  if (pain === 'moderada' || pain === 'forte') {
    return 'Treino concluido, mas a dor merece atencao. Se ela repetir ou alterar a passada, reduza o proximo estimulo.';
  }

  if (kmRatio >= 0.95 && paceDelta <= 0 && rpe <= 7) {
    return 'Excelente execucao: volume completo, pace dentro ou melhor que o alvo e esforco controlado.';
  }

  if (kmRatio >= 0.9 && Math.abs(paceDelta) <= 15 && rpe <= 8) {
    return 'Boa execucao: voce ficou muito perto do planejado e manteve o treino no caminho da meta.';
  }

  if (paceDelta > 25 || rpe >= 9) {
    return 'Execucao pesada: o registro sugere fadiga ou ritmo acima do custo ideal. Priorize recuperar antes de intensificar.';
  }

  if (kmRatio < 0.8) {
    return 'Volume abaixo do planejado. Conta como treino, mas vale observar energia, agenda e recuperacao.';
  }

  return 'Treino registrado dentro de uma faixa util para a preparacao. A consistencia aqui vale muito.';
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
    workouts: recordedWorkouts().map((workout) => ({
      id: workout.id,
      week: workout.weekNumber,
      order: workout.order,
      date_planned: workout.date,
      data_execucao: workout.execution.data_execucao,
      title: workout.type,
      status: workout.status,
      km_real: Number(workout.execution.km_real || 0),
      tempo_real: workout.execution.tempo_real ?? '',
      pace_real: workout.execution.pace_real,
      rpe: Number(workout.execution.rpe),
      dor: workout.execution.dor ?? '',
      sono: workout.execution.sono ?? '',
      clima: workout.execution.clima ?? '',
      substituicao: workout.execution.substituicao ?? '',
      desempenho: workout.execution.desempenho ?? '',
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

function showLogin(message = '') {
  entryView.hidden = true;
  loginView.hidden = false;
  appView.hidden = true;
  document.body.dataset.route = 'login';
  document.title = 'MyPace | Login';
  setAuthMessage(message);
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
  return !session;
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

function capitalize(value) {
  const text = String(value ?? '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
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
