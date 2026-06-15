const STORAGE_KEY = 'mypace:guilherme:v6';
const SETTINGS_KEY = 'mypace:settings:v2';
const PLAN_VERSION = '5.0.0';

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
let viewMode = 'coach';

const authView = document.querySelector('#authView');
const appView = document.querySelector('#appView');
const loginForm = document.querySelector('#loginForm');
const loginEmail = document.querySelector('#loginEmail');
const loginPassword = document.querySelector('#loginPassword');
const authMessage = document.querySelector('#authMessage');
const authModeLabel = document.querySelector('#authModeLabel');
const mainContent = document.querySelector('#mainContent');
const saveStateEl = document.querySelector('#saveState');
const themeToggleBtn = document.querySelector('#themeToggleBtn');
const logoutBtn = document.querySelector('#logoutBtn');
const viewTitle = document.querySelector('#viewTitle');
const viewEyebrow = document.querySelector('#viewEyebrow');
const currentWeekLabel = document.querySelector('#currentWeekLabel');
const selectedAthleteName = document.querySelector('#selectedAthleteName');
const selectedAvatar = document.querySelector('#selectedAvatar');
const modeToggle = document.querySelector('#modeToggle');
const toastEl = document.querySelector('#toast');

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
  modeToggle.addEventListener('change', () => {
    viewMode = modeToggle.checked ? 'athlete' : 'coach';
    render();
  });

  document.body.addEventListener('click', handleClick);
  document.body.addEventListener('input', handleInput);
  document.body.addEventListener('change', handleInput);
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
    authModeLabel.textContent = '';
    return;
  }

  supabaseClient = window.supabase.createClient(authConfig.supabaseUrl, authConfig.supabaseAnonKey);
  authModeLabel.textContent = '';
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
  selectedWeek = String(currentWeek()?.week ?? 1);
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

function handleInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
  if (!target.dataset.week || !target.dataset.workout || !target.dataset.execution) return;

  const workout = state.weeks[Number(target.dataset.week)].workouts[Number(target.dataset.workout)];
  workout.execution ??= { done: false };
  workout.execution[target.dataset.execution] = readInputValue(target);
  persist();
  renderHeader();
}

function readInputValue(target) {
  if (target.type === 'checkbox') return target.checked;
  if (target.type === 'number') return target.value === '' ? undefined : Number(target.value);
  return target.value;
}

function render() {
  renderHeader();
  const renderers = {
    dashboard: renderDashboard,
    athlete: renderAthleteProfile,
    workout: renderWorkoutBuilder,
    report: renderReport,
  };
  mainContent.innerHTML = renderers[activeView]();
  drawIcons();
}

function renderHeader() {
  const athlete = state?.athlete?.name ?? 'Guilherme';
  const week = currentWeek();
  const labels = {
    dashboard: ['Dashboard do coach', viewMode === 'coach' ? 'Atletas acompanhados' : 'Minha semana'],
    athlete: ['Perfil do atleta', athlete],
    workout: ['Montagem de treino', `Semana ${selectedWeek}`],
    report: ['Relatório de evolução', 'Pace e consistência'],
  };
  viewEyebrow.textContent = labels[activeView][0];
  viewTitle.textContent = labels[activeView][1];
  selectedAthleteName.textContent = athlete;
  selectedAvatar.textContent = athlete.slice(0, 1).toUpperCase();
  currentWeekLabel.textContent = week ? `Semana ${week.week} • ${week.keyWorkout}` : 'Ciclo completo';
}

function renderDashboard() {
  const athletes = coachAthletes();
  return `
    <section class="coach-grid">
      ${athletes.map((athlete) => athleteCard(athlete)).join('')}
    </section>
  `;
}

function athleteCard(athlete) {
  return `
    <article class="athlete-card">
      <header class="card-header">
        <div class="avatar">${escapeHtml(athlete.initials)}</div>
        <div>
          <h2>${escapeHtml(athlete.name)}</h2>
          <p>${escapeHtml(athlete.nextWorkout)}</p>
        </div>
        ${statusBadge(athlete.status)}
      </header>

      <div class="metric-row">
        ${compactMetric('Pace semanal', athlete.weeklyPace, true)}
        ${compactMetric('Carga', athlete.loadLabel)}
        ${compactMetric('Volume', `${athlete.volume} km`)}
      </div>

      <div>
        <div class="progress-label">
          <span>Progresso semanal</span>
          <strong>${athlete.progress}%</strong>
        </div>
        <div class="progress-track"><span style="width:${athlete.progress}%"></span></div>
      </div>

      <div class="quick-actions">
        <button class="button primary" data-view="workout" data-week="${selectedWeek}" type="button"><i data-lucide="plus"></i><span>Adicionar treino</span></button>
        <button class="button" data-view="report" type="button"><i data-lucide="file-line-chart"></i><span>Ver relatório</span></button>
        <button class="button" type="button"><i data-lucide="message-circle"></i><span>Mensagem</span></button>
      </div>
    </article>
  `;
}

function renderAthleteProfile() {
  const week = currentWeek();
  const completed = completedWorkouts();
  return `
    <section class="profile-layout">
      <article class="feature-card midnight-card">
        <div class="profile-hero">
          <div class="avatar large">G</div>
          <div>
            <p class="eyebrow lava-text">Atleta selecionado</p>
            <h2>${escapeHtml(state.athlete.name)}</h2>
            <p>${escapeHtml(state.athlete.objective)}</p>
          </div>
        </div>
        <div class="metric-row">
          ${compactMetric('Semana atual', `S${week.week}`)}
          ${compactMetric('Próximo treino', nextWorkout()?.type ?? 'Completo')}
          ${compactMetric('Conclusão', `${completed.percent}%`)}
          ${compactMetric('Meta', '2h05')}
        </div>
      </article>

      <article class="feature-card">
        <h2>Zonas e ritmos</h2>
        <div class="zones-grid">
          ${(state.planMeta.paceZones ?? []).map((zone) => `
            <div class="zone-item">
              <strong>${escapeHtml(zone.name)}</strong>
              <span>${escapeHtml(zone.pace)}</span>
              <small>RPE ${escapeHtml(zone.rpe)}</small>
            </div>
          `).join('')}
        </div>
      </article>

      <article class="feature-card">
        <h2>Semanas do ciclo</h2>
        <div class="week-strip">
          ${state.weeks.map((item) => `
            <button class="week-pill ${String(item.week) === selectedWeek ? 'is-active' : ''}" data-week="${item.week}" type="button">
              <span>S${item.week}</span>
              <strong>${escapeHtml(item.volumeLabel ?? `${item.targetVolumeKm} km`)}</strong>
            </button>
          `).join('')}
        </div>
      </article>
    </section>
  `;
}

function renderWorkoutBuilder() {
  const week = state.weeks.find((item) => String(item.week) === selectedWeek) ?? currentWeek();
  const weekIndex = state.weeks.indexOf(week);
  const selectedWorkout = week.workouts.find((workout) => workout.distanceKm > 0) ?? week.workouts[0];
  const blocks = workoutBlocks(selectedWorkout);

  return `
    <section class="workout-layout">
      <aside class="week-picker-card">
        <h2>Semana de treino</h2>
        <select class="week-select" onchange="window.setWeek(this.value)">
          ${state.weeks.map((item) => `<option value="${item.week}" ${item.week === week.week ? 'selected' : ''}>Semana ${item.week} • ${escapeHtml(item.keyWorkout ?? item.focus)}</option>`).join('')}
        </select>
        <div class="load-bar"><span style="width:${loadPercent(week)}%"></span></div>
        <p>${escapeHtml(week.focus)} • ${escapeHtml(week.volumeLabel ?? `${week.targetVolumeKm} km`)}</p>
      </aside>

      <article class="feature-card">
        <div class="card-header">
          <div>
            <p class="eyebrow">Timeline do treino</p>
            <h2>${escapeHtml(selectedWorkout.type)}</h2>
            <p>${escapeHtml(selectedWorkout.guidance ?? selectedWorkout.notes)}</p>
          </div>
          ${intensityPill(selectedWorkout)}
        </div>

        <div class="timeline">
          ${blocks.map((block, index) => workoutBlock(block, index)).join('')}
        </div>
      </article>

      <article class="feature-card">
        <h2>Registro da execução</h2>
        <div class="execution-list">
          ${week.workouts.map((workout, workoutIndex) => executionCard(workout, weekIndex, workoutIndex)).join('')}
        </div>
      </article>
    </section>
  `;
}

function workoutBlock(block, index) {
  return `
    <article class="timeline-block">
      <span class="block-index">${index + 1}</span>
      <div>
        <strong contenteditable="true">${escapeHtml(block.title)}</strong>
        <p contenteditable="true">${escapeHtml(block.detail)}</p>
      </div>
      <div class="block-data">
        <span contenteditable="true">${escapeHtml(block.duration)}</span>
        <b contenteditable="true">${escapeHtml(block.pace)}</b>
        <small contenteditable="true">${escapeHtml(block.zone)}</small>
      </div>
    </article>
  `;
}

function executionCard(workout, weekIndex, workoutIndex) {
  const execution = workout.execution ?? {};
  return `
    <article class="execution-card">
      <label class="done-check">
        <input data-week="${weekIndex}" data-workout="${workoutIndex}" data-execution="done" type="checkbox" ${execution.done ? 'checked' : ''} />
        <span>${escapeHtml(workout.type)}</span>
      </label>
      <div class="inline-fields">
        <input data-week="${weekIndex}" data-workout="${workoutIndex}" data-execution="distanceKm" type="number" min="0" step="0.1" value="${execution.distanceKm ?? ''}" placeholder="${workout.distanceKm || 0} km" />
        <input data-week="${weekIndex}" data-workout="${workoutIndex}" data-execution="pace" type="text" value="${escapeAttr(execution.pace ?? '')}" placeholder="mm:ss/km" />
        <input data-week="${weekIndex}" data-workout="${workoutIndex}" data-execution="feeling" type="number" min="1" max="10" value="${execution.feeling ?? ''}" placeholder="RPE" />
      </div>
      <textarea data-week="${weekIndex}" data-workout="${workoutIndex}" data-execution="notes" rows="2" placeholder="Observações">${escapeHtml(execution.notes ?? '')}</textarea>
    </article>
  `;
}

function renderReport() {
  const points = paceTrend();
  return `
    <section class="report-layout">
      <article class="feature-card">
        <div class="card-header">
          <div>
            <p class="eyebrow">Evolução de pace</p>
            <h2>Últimas semanas</h2>
          </div>
          <strong class="pace-number">${points.at(-1)?.pace ?? '6:05'}/km</strong>
        </div>
        <div class="pace-chart" aria-label="Gráfico simples de evolução de pace">
          ${points.map((point, index) => `<span style="height:${point.height}%" title="S${index + 1} ${point.pace}/km"></span>`).join('')}
          <i></i>
        </div>
        <div class="chart-legend">
          <span><b class="lava-dot"></b>Pace</span>
          <span><b class="green-dot"></b>Meta</span>
        </div>
      </article>

      <article class="feature-card">
        <h2>Resumo técnico</h2>
        <div class="metric-row">
          ${compactMetric('Pace médio', averagePace(), true)}
          ${compactMetric('Volume total', `${round(totalExecuted() || totalPlanned())} km`)}
          ${compactMetric('PR provável', '2h06')}
          ${compactMetric('Carga', riskSummary().label)}
        </div>
      </article>

      <article class="empty-state">
        <div class="empty-illustration"></div>
        <div>
          <h2>Relatório exportável</h2>
          <p>Quando houver mais execuções registradas, o relatório ganha comparativos por bloco e por fase.</p>
          <button class="button primary" type="button" onclick="window.exportJson()"><i data-lucide="download"></i><span>Exportar JSON</span></button>
        </div>
      </article>
    </section>
  `;
}

function compactMetric(label, value, mono = false) {
  return `<div class="mini-metric"><span>${escapeHtml(label)}</span><strong class="${mono ? 'mono' : ''}">${escapeHtml(value)}</strong></div>`;
}

function statusBadge(status) {
  const labels = { green: 'No prazo', lava: 'Atrasado', midnight: 'Lesionado' };
  return `<span class="status-badge ${status}">${labels[status]}</span>`;
}

function intensityPill(workout) {
  const effort = Number(workout.effort || 0);
  const label = workout.type === 'Prova' ? 'Race' : effort >= 7 ? 'Hard' : effort >= 5 ? 'Moderate' : 'Easy';
  return `<span class="intensity-pill ${label.toLowerCase()}">${label}</span>`;
}

function coachAthletes() {
  const completed = completedWorkouts();
  const next = nextWorkout();
  const executed = totalExecuted();
  return [
    {
      initials: 'G',
      name: state.athlete.name,
      nextWorkout: next ? `${next.type} • ${next.distanceLabel}` : 'Ciclo completo',
      weeklyPace: averagePace(),
      loadLabel: riskSummary().label,
      volume: round(executed || currentWeek().targetVolumeKm),
      progress: completed.percent,
      status: 'green',
    },
    { initials: 'M', name: 'Marina Costa', nextWorkout: 'Tempo run • 8 km', weeklyPace: '5:48/km', loadLabel: 'média', volume: 28, progress: 72, status: 'green' },
    { initials: 'R', name: 'Rafael Lima', nextWorkout: 'Longão • 16 km', weeklyPace: '6:12/km', loadLabel: 'alta', volume: 36, progress: 64, status: 'lava' },
    { initials: 'B', name: 'Bianca Alves', nextWorkout: 'Easy • 5 km', weeklyPace: '6:40/km', loadLabel: 'baixa', volume: 18, progress: 86, status: 'green' },
    { initials: 'T', name: 'Thiago Reis', nextWorkout: 'Recuperação', weeklyPace: '7:05/km', loadLabel: 'baixa', volume: 12, progress: 42, status: 'midnight' },
    { initials: 'L', name: 'Luiza Rocha', nextWorkout: 'Intervalado • 6x800m', weeklyPace: '5:22/km', loadLabel: 'média', volume: 31, progress: 78, status: 'green' },
  ];
}

function workoutBlocks(workout) {
  if (workout.type === 'Intervalado') {
    return [
      { title: 'Aquecimento', detail: 'Rodagem leve + mobilidade dinâmica', duration: '12 min', pace: '6:50/km', zone: 'Z2' },
      { title: workout.paceTarget.split(' em ')[0], detail: 'Repetições técnicas com controle de forma', duration: '24 min', pace: paceFrom(workout.paceTarget), zone: 'Z4' },
      { title: 'Recuperação', detail: '2 min trote entre repetições', duration: '10 min', pace: '7:20/km', zone: 'Z1' },
      { title: 'Desaquecimento', detail: 'Soltar respiração e cadência', duration: '8 min', pace: '7:10/km', zone: 'Z1' },
    ];
  }
  if (workout.type === 'Ritmo de meia' || workout.type === 'Tempo run') {
    return [
      { title: 'Aquecimento', detail: 'Entrada progressiva sem pressa', duration: '12 min', pace: '6:45/km', zone: 'Z2' },
      { title: workout.notes, detail: workout.guidance ?? 'Bloco controlado', duration: '30 min', pace: paceFrom(workout.paceTarget), zone: 'Z3/Z4' },
      { title: 'Recuperação', detail: 'Trote leve entre blocos', duration: '6 min', pace: '7:10/km', zone: 'Z1' },
      { title: 'Desaquecimento', detail: 'Fechar melhor do que começou', duration: '8 min', pace: '7:20/km', zone: 'Z1' },
    ];
  }
  return [
    { title: 'Preparação', detail: 'Respiração, cadência e saída controlada', duration: '5 min', pace: 'leve', zone: 'Z1' },
    { title: workout.type, detail: workout.notes, duration: estimateDuration(workout), pace: paceFrom(workout.paceTarget), zone: workout.effort >= 7 ? 'Z4' : 'Z2' },
    { title: 'Fechamento', detail: workout.guidance ?? 'Registrar sensação ao final', duration: '5 min', pace: 'solto', zone: 'Z1' },
  ];
}

function weekRisk(week, weekIndex) {
  const planned = Number(week.targetVolumeKm || 0);
  const executed = executedWeekVolume(week);
  const highRpe = week.workouts.some((workout) => Number(workout.execution?.feeling || 0) >= 8);
  const previous = state.weeks[weekIndex - 1];
  if (executed > planned * 1.15 && executed > 0) return { level: 'lava', label: 'alta', note: 'Carga acima do planejado. Reduzir impacto nas próximas 48h.' };
  if (highRpe) return { level: 'lava', label: 'média', note: 'RPE alto registrado. Manter próximos treinos fáceis.' };
  if (previous && planned > Number(previous.targetVolumeKm || 0) * 1.12 && week.phase !== 'tapering') return { level: 'lava', label: 'média', note: 'Semana com aumento de volume. Priorizar Z2 e sono.' };
  return { level: 'green', label: 'baixa', note: 'Carga coerente com a fase atual.' };
}

function riskSummary() {
  const week = currentWeek();
  return weekRisk(week, state.weeks.indexOf(week));
}

function currentWeek() {
  return state.weeks.find((week) => week.workouts.some((workout) => !workout.execution?.done && workout.distanceKm > 0)) ?? state.weeks.at(-1);
}

function nextWorkout() {
  return state.weeks.flatMap((week) => week.workouts).find((workout) => !workout.execution?.done && workout.distanceKm > 0);
}

function completedWorkouts() {
  const all = state.weeks.flatMap((week) => week.workouts).filter((workout) => workout.distanceKm > 0);
  const done = all.filter((workout) => workout.execution?.done);
  return { done: done.length, total: all.length, percent: all.length ? Math.round((done.length / all.length) * 100) : 0 };
}

function executedWeekVolume(week) {
  return week.workouts.reduce((sum, workout) => workout.execution?.done ? sum + Number(workout.execution.distanceKm ?? workout.distanceKm ?? 0) : sum, 0);
}

function totalExecuted() {
  return state.weeks.reduce((sum, week) => sum + executedWeekVolume(week), 0);
}

function totalPlanned() {
  return state.weeks.reduce((sum, week) => sum + Number(week.targetVolumeKm || 0), 0);
}

function averagePace() {
  const paces = state.weeks.flatMap((week) => week.workouts).map((workout) => workout.execution?.pace).filter(Boolean);
  return paces.at(-1) ?? '6:05/km';
}

function paceTrend() {
  return ['6:52', '6:44', '6:38', '6:31', '6:22', '6:15', '6:09', '6:05'].map((pace, index) => ({
    pace,
    height: 34 + index * 7,
  }));
}

function paceFrom(value) {
  const match = String(value).match(/\d:\d{2}(?:-\d:\d{2})?/);
  return match ? `${match[0]}/km` : value;
}

function estimateDuration(workout) {
  const km = Number(workout.distanceKm || 0);
  return km ? `${Math.max(12, Math.round(km * 7))} min` : '15 min';
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
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
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

function round(value) {
  return Number(value || 0).toFixed(1).replace('.0', '');
}

function formatDate(value) {
  const date = parseLocalDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
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

boot().catch((error) => {
  console.error(error);
  showApp();
  mainContent.innerHTML = '<div class="empty-state"><div class="empty-illustration"></div><div><h2>Não foi possível carregar</h2><p>Tente atualizar a página.</p></div></div>';
});
