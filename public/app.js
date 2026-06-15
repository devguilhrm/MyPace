const STORAGE_KEY = 'mypace:guilherme:v5';
const SETTINGS_KEY = 'mypace:settings:v1';
const PLAN_VERSION = '5.0.0';

let state = null;
let settings = loadSettings();
let selectedPhase = 'todas';
let selectedWeek = '1';
let syncTimer = null;
let authConfig = null;
let supabaseClient = null;
let session = null;
let localMode = false;

const authView = document.querySelector('#authView');
const appView = document.querySelector('#appView');
const loginForm = document.querySelector('#loginForm');
const loginEmail = document.querySelector('#loginEmail');
const loginPassword = document.querySelector('#loginPassword');
const authMessage = document.querySelector('#authMessage');
const authModeLabel = document.querySelector('#authModeLabel');
const summaryEl = document.querySelector('#summary');
const weeksEl = document.querySelector('#weeks');
const phaseTabsEl = document.querySelector('#phaseTabs');
const weekSelectEl = document.querySelector('#weekSelect');
const saveStateEl = document.querySelector('#saveState');
const themeToggleBtn = document.querySelector('#themeToggleBtn');
const methodologyPanel = document.querySelector('#methodologyPanel');

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
  document.querySelector('#exportBtn').addEventListener('click', exportJson);
  document.querySelector('#resetBtn').addEventListener('click', resetPlan);
  document.querySelector('#logoutBtn').addEventListener('click', logout);
  themeToggleBtn.addEventListener('click', toggleTheme);
  weekSelectEl.addEventListener('change', (event) => {
    selectedWeek = event.target.value;
    renderWeek();
  });
  document.body.addEventListener('input', handleExecutionInput);
  document.body.addEventListener('change', handleExecutionInput);
}

async function fetchConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) {
      throw new Error('Config indisponivel');
    }
    return response.json();
  } catch {
    return {
      authEnabled: false,
      persistenceEnabled: false,
      supabaseUrl: '',
      supabaseAnonKey: '',
    };
  }
}

function setupSupabase() {
  if (!authConfig?.authEnabled || !window.supabase) {
    authModeLabel.textContent = 'offline';
    return;
  }

  supabaseClient = window.supabase.createClient(
    authConfig.supabaseUrl,
    authConfig.supabaseAnonKey,
  );
  authModeLabel.textContent = authConfig.persistenceEnabled ? 'nuvem' : 'login';
}

async function signIn(event) {
  event.preventDefault();
  const loginId = loginEmail.value.trim();
  const password = loginPassword.value;

  if (!supabaseClient) {
    setAuthMessage('Supabase nao configurado. Configure as variaveis de ambiente para entrar.');
    return;
  }

  try {
    setAuthMessage('Entrando...');
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: normalizeLogin(loginId),
      password,
    });

    if (error) {
      setAuthMessage('Usuario ou senha invalidos.');
      return;
    }

    session = data.session;
    localMode = false;
    setAuthMessage('Carregando plano...');
    await startApp();
    setAuthMessage('');
  } catch (error) {
    console.error(error);
    setAuthMessage('Login feito, mas nao foi possivel carregar o plano. Tente atualizar a pagina.');
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
  state = await loadPlan();
  selectedPhase = 'todas';
  selectedWeek = '1';
  persist({ skipRemote: true });
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
      saveStateEl.textContent = 'offline';
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
  if (!response.ok) {
    throw new Error('Falha ao carregar plano inicial');
  }
  return response.json();
}

function handleExecutionInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
    return;
  }
  if (!target.dataset.week || !target.dataset.workout || !target.dataset.execution) {
    return;
  }

  const workout = state.weeks[Number(target.dataset.week)].workouts[Number(target.dataset.workout)];
  workout.execution ??= { done: false };
  workout.execution[target.dataset.execution] = readInputValue(target);

  persist();
  renderSummary();

  if (target.type === 'checkbox') {
    renderWeek();
  }
}

function readInputValue(target) {
  if (target.type === 'checkbox') {
    return target.checked;
  }
  if (target.type === 'number') {
    return target.value === '' ? undefined : Number(target.value);
  }
  return target.value;
}

function render() {
  renderSummary();
  renderMethodology();
  renderPhaseTabs();
  renderWeekSelect();
  renderWeek();
  drawIcons();
}

function renderSummary() {
  const planned = state.weeks.reduce((sum, week) => sum + Number(week.targetVolumeKm || 0), 0);
  const executed = state.weeks.reduce((sum, week) => sum + executedWeekVolume(week), 0);
  const allWorkouts = state.weeks.flatMap((week) => week.workouts);
  const completed = allWorkouts.filter((workout) => workout.execution?.done).length;
  const runWorkouts = allWorkouts.filter((workout) => workout.distanceKm > 0).length;
  const next = nextWorkout();
  const adherence = runWorkouts ? Math.round((completed / allWorkouts.length) * 100) : 0;
  const risk = riskSummary();

  summaryEl.innerHTML = [
    metric('Meta', '2h05-2h10', 'Ritmo realista 6:00-6:10/km'),
    metric('Proximo', next ? next.type : 'Plano completo', next ? `${formatDate(next.date)} - ${next.distanceLabel ?? `${round(next.distanceKm)} km`}` : 'Sem treinos pendentes'),
    metric('Volume', `${round(executed)} / ${round(planned)} km`, `${state.planMeta.weeks} semanas no ciclo`),
    metric('Conclusao', `${adherence}%`, `${completed}/${allWorkouts.length} itens registrados`),
    metric('Status', risk.label, risk.note),
  ].join('');
}

function metric(label, value, note) {
  return `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <p>${escapeHtml(note)}</p>
    </article>
  `;
}

function renderMethodology() {
  const zones = state.planMeta?.paceZones ?? [];
  const scenarios = state.planMeta?.raceScenarios ?? [];
  methodologyPanel.innerHTML = `
    <h3>Ritmos</h3>
    <div class="zone-list">
      ${zones.map((zone) => `
        <div class="zone-chip">
          <strong>${escapeHtml(zone.name)}</strong>
          <span>${escapeHtml(zone.pace)} | RPE ${escapeHtml(zone.rpe)}</span>
        </div>
      `).join('')}
    </div>
    <h3>Cenarios</h3>
    <div class="scenario-list">
      ${scenarios.map((scenario) => `
        <div>
          <strong>${escapeHtml(scenario.name)}</strong>
          <span>${escapeHtml(scenario.time)} | ${escapeHtml(scenario.pace)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderPhaseTabs() {
  const phases = ['todas', ...state.phases.map((phase) => phase.name)];
  phaseTabsEl.innerHTML = phases
    .map((phase) => `
      <button class="tab-button ${selectedPhase === phase ? 'is-active' : ''}" type="button" data-phase="${escapeHtml(phase)}">
        ${escapeHtml(labelPhase(phase))}
      </button>
    `)
    .join('');

  phaseTabsEl.querySelectorAll('[data-phase]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedPhase = button.dataset.phase;
      selectedWeek = String(filteredWeeks()[0]?.week ?? 1);
      renderPhaseTabs();
      renderWeekSelect();
      renderWeek();
    });
  });
}

function renderWeekSelect() {
  const weeks = filteredWeeks();
  if (!weeks.some((week) => String(week.week) === selectedWeek) && weeks[0]) {
    selectedWeek = String(weeks[0].week);
  }

  weekSelectEl.innerHTML = weeks
    .map((week) => `<option value="${week.week}">Semana ${week.week} - ${escapeHtml(week.keyWorkout ?? week.focus)}</option>`)
    .join('');
  weekSelectEl.value = selectedWeek;
}

function renderWeek() {
  const week = state.weeks.find((item) => String(item.week) === selectedWeek);
  if (!week) {
    weeksEl.innerHTML = '<div class="empty-state">Nenhuma semana encontrada.</div>';
    return;
  }

  const weekIndex = state.weeks.indexOf(week);
  const visibleWeeks = filteredWeeks();
  const visibleIndex = visibleWeeks.findIndex((item) => item.week === week.week);
  const previousWeek = visibleWeeks[visibleIndex - 1];
  const nextWeekItem = visibleWeeks[visibleIndex + 1];
  const risk = weekRisk(week, weekIndex);

  weeksEl.innerHTML = `
    <article class="week-card">
      <header class="week-hero">
        <div>
          <span class="phase-label">${escapeHtml(labelPhase(week.phase))}</span>
          <h2>Semana ${week.week}</h2>
          <p>${escapeHtml(week.focus)}</p>
        </div>
        <div class="week-numbers">
          <span><b>${escapeHtml(week.volumeLabel ?? `${round(week.targetVolumeKm)} km`)}</b> volume</span>
          <span><b>${escapeHtml(week.longRunLabel ?? '-')}</b> longao</span>
          <span class="${risk.level}"><b>${escapeHtml(risk.label)}</b> status</span>
        </div>
      </header>

      <div class="workout-list">
        ${week.workouts.map((workout, workoutIndex) => workoutCard(workout, weekIndex, workoutIndex)).join('')}
      </div>

      <section class="coach-panel ${risk.level}">
        <h3>Comentario da semana</h3>
        <p>${escapeHtml(risk.note)}</p>
      </section>

      <nav class="week-nav">
        <button class="button" type="button" ${previousWeek ? '' : 'disabled'} onclick="goToWeek('${previousWeek?.week ?? ''}')">
          <i data-lucide="arrow-left"></i><span>Anterior</span>
        </button>
        <button class="button" type="button" ${nextWeekItem ? '' : 'disabled'} onclick="goToWeek('${nextWeekItem?.week ?? ''}')">
          <span>Proxima</span><i data-lucide="arrow-right"></i>
        </button>
      </nav>
    </article>
  `;

  drawIcons();
}

function workoutCard(workout, weekIndex, workoutIndex) {
  const execution = workout.execution ?? {};
  const done = Boolean(execution.done);
  return `
    <article class="workout-card ${done ? 'is-done' : ''}">
      <div class="workout-main">
        <label class="check-row">
          <input data-week="${weekIndex}" data-workout="${workoutIndex}" data-execution="done" type="checkbox" ${done ? 'checked' : ''} />
          <span>${done ? 'Feito' : 'Pendente'}</span>
        </label>
        <div>
          <span class="workout-date">${escapeHtml(workout.day)} | ${formatDate(workout.date)}</span>
          <h3>${escapeHtml(workout.type)}</h3>
          <p>${escapeHtml(workout.notes)}</p>
        </div>
      </div>

      <div class="workout-facts">
        <span><b>${escapeHtml(workout.distanceLabel ?? `${round(workout.distanceKm)} km`)}</b> distancia</span>
        <span><b>${escapeHtml(workout.paceTarget)}</b> ritmo</span>
        <span><b>RPE ${escapeHtml(workout.effort)}</b> alvo</span>
      </div>

      <p class="guidance">${escapeHtml(workout.guidance ?? '')}</p>

      <div class="execution-grid">
        <label>
          Km feitos
          <input data-week="${weekIndex}" data-workout="${workoutIndex}" data-execution="distanceKm" type="number" min="0" step="0.1" value="${execution.distanceKm ?? ''}" placeholder="${workout.distanceKm || 0}" />
        </label>
        <label>
          Pace medio
          <input data-week="${weekIndex}" data-workout="${workoutIndex}" data-execution="pace" type="text" value="${escapeAttr(execution.pace ?? '')}" placeholder="6:45/km" />
        </label>
        <label>
          RPE real
          <input data-week="${weekIndex}" data-workout="${workoutIndex}" data-execution="feeling" type="number" min="1" max="10" value="${execution.feeling ?? ''}" placeholder="${workout.effort}" />
        </label>
        <label>
          Observacoes
          <textarea data-week="${weekIndex}" data-workout="${workoutIndex}" data-execution="notes" rows="2" placeholder="dor, sono, calor, abastecimento">${escapeHtml(execution.notes ?? '')}</textarea>
        </label>
      </div>
    </article>
  `;
}

function weekRisk(week, weekIndex) {
  const planned = Number(week.targetVolumeKm || 0);
  const executed = executedWeekVolume(week);
  const doneRuns = week.workouts.filter((workout) => workout.distanceKm > 0 && workout.execution?.done);
  const highRpe = week.workouts.some((workout) => Number(workout.execution?.feeling || 0) >= 8);
  const previous = state.weeks[weekIndex - 1];

  if (executed > planned * 1.15 && executed > 0) {
    return {
      level: 'red',
      label: 'vermelho',
      note: 'Voce passou mais de 15% do volume-alvo. Reduza impacto nas proximas 48h e nao compense treino perdido.',
    };
  }

  if (highRpe) {
    return {
      level: 'amber',
      label: 'amarelo',
      note: 'Houve RPE alto. Mantenha os proximos treinos faceis e remova intensidade se a fadiga persistir.',
    };
  }

  if (previous && planned > Number(previous.targetVolumeKm || 0) * 1.12 && week.phase !== 'tapering') {
    return {
      level: 'amber',
      label: 'amarelo',
      note: 'Semana com aumento relevante de volume. Execute os faceis em Z2 real e proteja o longao.',
    };
  }

  if (doneRuns.length >= 3 || executed === 0) {
    return {
      level: 'green',
      label: 'verde',
      note: 'Plano coerente com a fase. Complete os treinos sem acelerar os dias faceis.',
    };
  }

  return {
    level: 'amber',
    label: 'amarelo',
    note: 'Semana parcialmente registrada. Se perdeu treino, siga o calendario sem tentar pagar no dia seguinte.',
  };
}

function riskSummary() {
  const currentWeek = state.weeks.find((week) => week.workouts.some((workout) => !workout.execution?.done && workout.distanceKm > 0)) ?? state.weeks.at(-1);
  return weekRisk(currentWeek, state.weeks.indexOf(currentWeek));
}

function executedWeekVolume(week) {
  return week.workouts.reduce((sum, workout) => {
    if (!workout.execution?.done) {
      return sum;
    }
    return sum + Number(workout.execution.distanceKm ?? workout.distanceKm ?? 0);
  }, 0);
}

function nextWorkout() {
  return state.weeks
    .flatMap((week) => week.workouts)
    .find((workout) => !workout.execution?.done && workout.distanceKm > 0);
}

function filteredWeeks() {
  return selectedPhase === 'todas'
    ? state.weeks
    : state.weeks.filter((week) => week.phase === selectedPhase);
}

function goToWeek(week) {
  if (!week) {
    return;
  }
  selectedWeek = String(week);
  renderWeekSelect();
  renderWeek();
}

async function resetPlan() {
  state = await fetchInitialPlan();
  selectedPhase = 'todas';
  selectedWeek = '1';
  persist();
  render();
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `mypace-guilherme-${toIsoDate(new Date())}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function persist(options = {}) {
  localStorage.setItem(storageKey(), JSON.stringify(state));
  const mode = session && !localMode && authConfig?.persistenceEnabled ? 'nuvem' : 'local';
  saveStateEl.textContent = `salvo ${mode}`;
  if (!options.skipRemote) {
    scheduleRemoteSync();
  }
}

function scheduleRemoteSync() {
  window.clearTimeout(syncTimer);
  if (!session || localMode || !authConfig?.persistenceEnabled) {
    return;
  }
  saveStateEl.textContent = 'sincronizando';
  syncTimer = window.setTimeout(syncRemote, 700);
}

async function syncRemote() {
  try {
    const response = await fetch('/api/user-plan', {
      method: 'PUT',
      headers: {
        ...authHeaders(),
        'content-type': 'application/json',
      },
      body: JSON.stringify(state),
    });
    if (!response.ok) {
      throw new Error('Falha ao salvar');
    }
    saveStateEl.textContent = 'salvo nuvem';
  } catch {
    saveStateEl.textContent = 'salvo local';
  }
}

function authHeaders() {
  return {
    authorization: `Bearer ${session?.access_token ?? ''}`,
  };
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

function labelPhase(value) {
  const labels = {
    todas: 'Todas',
    retorno: 'Retorno',
    'base forte': 'Base forte',
    construcao: 'Construcao',
    especifica: 'Especifica',
    tapering: 'Taper',
  };
  return labels[value] ?? value;
}

function formatDate(value) {
  const date = parseLocalDate(value);
  if (!date) {
    return value;
  }
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
}

function parseLocalDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function round(value) {
  return Number(value || 0).toFixed(1).replace('.0', '');
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
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

window.goToWeek = goToWeek;

boot().catch((error) => {
  console.error(error);
  showApp();
  weeksEl.innerHTML = '<div class="empty-state">Nao foi possivel carregar o plano.</div>';
});
