const STORAGE_KEY = 'mypace:runner:v8';
const SETTINGS_KEY = 'mypace:settings:v3';
const PLAN_VERSION = '6.2.0';
const LOGIN_PATH = '/login';

const { useCallback, useEffect, useRef, useState } = window.React;
const h = window.React.createElement;

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

const NAV_ITEMS = [
  ['today', 'sun', 'Hoje'],
  ['week', 'calendar-days', 'Semana'],
  ['preparation', 'map', 'Plano'],
  ['report', 'bar-chart-3', 'Evolução'],
  ['settings', 'settings', 'Config'],
];

function App() {
  const [settings, setSettingsState] = useState(loadSettings);
  const [authConfig, setAuthConfig] = useState(null);
  const [supabaseClient, setSupabaseClient] = useState(null);
  const [session, setSession] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [plan, setPlan] = useState(null);
  const [view, setView] = useState(viewFromPath());
  const [selectedWeek, setSelectedWeek] = useState('1');
  const [filters, setFilters] = useState({ week: 'all', phase: 'all', type: 'all', status: 'all' });
  const [authMessage, setAuthMessage] = useState('');
  const [saveState, setSaveState] = useState({ label: 'carregando', status: 'local' });
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true);
  const syncTimer = useRef(null);
  const toastTimer = useRef(null);

  const localMode = Boolean(supabaseClient && !session);
  const routeKind = isEntryRoute() ? 'entry' : isLoginRoute() ? 'login' : 'app';
  const headers = useCallback(() => ({ authorization: `Bearer ${session?.access_token ?? ''}` }), [session]);

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ message, tone });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  const persist = useCallback((nextPlan, options = {}) => {
    if (!nextPlan) return;
    localStorage.setItem(storageKey(session, localMode), JSON.stringify(nextPlan));
    const cloudEnabled = session && !localMode && authConfig?.persistenceEnabled;
    setSaveState({ label: cloudEnabled ? 'sincronizando' : 'salvo local', status: cloudEnabled ? 'syncing' : 'local' });
    window.clearTimeout(syncTimer.current);
    if (!cloudEnabled) return;
    if (options.skipRemote) return;

    syncTimer.current = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/user-plan', {
          method: 'PUT',
          headers: { ...headers(), 'content-type': 'application/json' },
          body: JSON.stringify(nextPlan),
        });
        if (!response.ok) throw new Error('Falha ao salvar');
        setSaveState({ label: 'salvo nuvem', status: 'saved' });
      } catch {
        setSaveState({ label: 'salvo local', status: 'local' });
        showToast('Sem conexao: salvo localmente', 'warn');
      }
    }, 700);
  }, [authConfig, headers, localMode, session, showToast]);

  const updatePlan = useCallback((updater, options = {}) => {
    setPlan((current) => {
      const next = normalizePlanState(typeof updater === 'function' ? updater(clone(current)) : updater);
      persist(next, options);
      return next;
    });
  }, [persist]);

  useEffect(() => {
    applyTheme(settings.theme);
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    let active = true;
    async function boot() {
      syncViewportSize();
      const config = await fetchConfig();
      if (!active) return;
      setAuthConfig(config);
      if (config?.authEnabled) await waitForSupabase();

      const client = config?.authEnabled && window.supabase
        ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
        : null;
      if (!active) return;
      setSupabaseClient(client);

      if (client) {
        const result = await client.auth.getSession();
        if (!active) return;
        setSession(result.data.session);
        client.auth.onAuthStateChange((_event, nextSession) => {
          setSession(nextSession);
          if (!nextSession && !isEntryRoute() && !isLoginRoute()) {
            navigateTo(LOGIN_PATH);
            setView(viewFromPath());
          }
        });
      }

      setLoading(false);
    }
    const handleRouteChange = () => setView(viewFromPath());
    boot();
    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('resize', syncViewportSize);
    window.visualViewport?.addEventListener('resize', syncViewportSize);
    return () => {
      active = false;
      window.removeEventListener('popstate', handleRouteChange);
      window.removeEventListener('resize', syncViewportSize);
      window.visualViewport?.removeEventListener('resize', syncViewportSize);
    };
  }, []);

  useEffect(() => {
    if (routeKind !== 'app') return;
    if (authConfig && !session) {
      navigateTo(LOGIN_PATH);
      setView(viewFromPath());
      return;
    }
    if (!authConfig || plan) return;

    let active = true;
    async function load() {
      setLoading(true);
      const user = await loadCurrentUser(session, localMode, headers);
      const loadedPlan = normalizePlanState(await loadPlan(session, localMode, authConfig, headers));
      if (!active) return;
      setCurrentUser(user);
      setPlan(loadedPlan);
      setSelectedWeek(String(weekForDate(loadedPlan, toIsoDate(new Date()))?.week ?? currentWeek(loadedPlan)?.week ?? 1));
      setSaveState({ label: session && authConfig?.persistenceEnabled ? 'salvo nuvem' : 'salvo local', status: session && authConfig?.persistenceEnabled ? 'saved' : 'local' });
      setLoading(false);
    }
    load().catch((error) => {
      console.error(error);
      showToast('Nao foi possivel carregar o plano.', 'warn');
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [authConfig, headers, localMode, plan, routeKind, session, showToast]);

  useEffect(() => {
    if (!session) {
      setCurrentUser(null);
      setPlan(null);
    }
  }, [session]);

  useEffect(() => {
    document.title = `MyPace | ${headerLabels(view, settings, plan, selectedWeek)[1]}`;
    drawIcons();
  });

  useEffect(() => {
    document.body.classList.toggle('modal-open', Boolean(modal));
  }, [modal]);

  const navigate = useCallback((path) => {
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
    setView(viewFromPath());
  }, []);

  const signIn = useCallback(async (event) => {
    event.preventDefault();
    if (!supabaseClient) {
      setAuthMessage('Login indisponivel. Confira as variaveis do Supabase.');
      return;
    }
    const form = new FormData(event.currentTarget);
    setAuthMessage('Entrando...');
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: normalizeLogin(String(form.get('email') ?? '').trim()),
      password: String(form.get('password') ?? ''),
    });
    if (error) {
      setAuthMessage('Usuario ou senha invalidos.');
      return;
    }
    setSession(data.session);
    setPlan(null);
    setAuthMessage('');
    navigate(nextPathFromLogin());
  }, [navigate, supabaseClient]);

  const logout = useCallback(async () => {
    if (supabaseClient && session) await supabaseClient.auth.signOut();
    setSession(null);
    setPlan(null);
    setCurrentUser(null);
    navigate(LOGIN_PATH);
  }, [navigate, session, supabaseClient]);

  const saveRunnerSettings = useCallback((event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = {
      ...settings,
      name: String(form.get('name') ?? '').trim() || 'Corredor',
      unit: String(form.get('unit') ?? 'km'),
      paceGoal: normalizePaceInput(String(form.get('paceGoal') ?? '5:41')) || '5:41',
    };
    setSettingsState(next);
    showToast('Configuracoes salvas!');
  }, [settings, showToast]);

  const saveCoachWorkout = useCallback(async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      athlete: String(data.get('athlete') ?? '').trim(),
      date: String(data.get('date') ?? '').trim(),
      type: String(data.get('type') ?? '').trim(),
      distanceKm: parseDistanceInput(data.get('distanceKm')),
      paceTarget: String(data.get('paceTarget') ?? '').trim() || 'solto',
      notes: String(data.get('notes') ?? '').trim(),
      guidance: String(data.get('guidance') ?? '').trim(),
    };
    if (!payload.athlete || !payload.date || !payload.type || !Number.isFinite(payload.distanceKm) || payload.distanceKm <= 0 || !payload.notes) {
      showToast('Preencha atleta, data, tipo, distancia e objetivo.', 'warn');
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button?.setAttribute('disabled', '');
    try {
      const response = await fetch('/api/coach/workouts', {
        method: 'POST',
        headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? 'Nao foi possivel criar o treino.');
      form.reset();
      form.querySelector('[name="date"]').value = toIsoDate(new Date());
      form.querySelector('[name="type"]').value = 'Corrida personalizada';
      showToast(`Treino enviado para ${result.athlete?.username || result.athlete?.email || payload.athlete} ✓`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Nao foi possivel criar o treino.', 'warn');
    } finally {
      button?.removeAttribute('disabled');
    }
  }, [headers, showToast]);

  const openRegister = useCallback((weekIndex, workoutIndex, forceEdit = false) => {
    const workout = plan?.weeks?.[weekIndex]?.workouts?.[workoutIndex];
    if (!workout || Number(workout.distanceKm || 0) === 0) return;
    setModal({ kind: 'planned', weekIndex, workoutIndex, forceEdit });
  }, [plan]);

  const openExtra = useCallback((extraIndex = null) => {
    setModal({ kind: 'extra', extraIndex: Number.isInteger(extraIndex) ? extraIndex : null });
  }, []);

  const saveRegistration = useCallback((payload) => {
    updatePlan((draft) => {
      const isExtra = payload.kind === 'extra';
      const workout = isExtra
        ? (Number.isInteger(payload.extraIndex) ? draft.extraWorkouts[payload.extraIndex] : defaultExtraWorkout(draft, payload.date))
        : draft.weeks[payload.weekIndex].workouts[payload.workoutIndex];

      applyWorkoutExecution(draft, workout, payload);

      if (isExtra && !Number.isInteger(payload.extraIndex)) {
        draft.extraWorkouts ??= [];
        draft.extraWorkouts.push(workout);
      }
      return draft;
    }, { silent: true });
    setModal(null);
    showToast(payload.kind === 'extra' ? 'Corrida extra salva ✓' : payload.status === 'perdido' ? 'Treino marcado como perdido' : 'Registro salvo ✓');
  }, [showToast, updatePlan]);

  if (routeKind === 'entry') {
    return h(EntryView, { onEnter: () => navigate(session ? '/hoje' : LOGIN_PATH) });
  }

  if (routeKind === 'login') {
    return h(LoginView, {
      authEnabled: authConfig?.authEnabled,
      authMessage,
      loading,
      onSubmit: signIn,
    });
  }

  if (loading || !plan) {
    return h(AppShell, {
      view,
      settings,
      saveState,
      onNavigate: navigate,
      onLogout: logout,
      onToggleTheme: () => setSettingsState((current) => ({ ...current, theme: current.theme === 'dark' ? 'light' : 'dark' })),
      children: h(Skeleton),
      toast,
    });
  }

  const labels = headerLabels(view, settings, plan, selectedWeek);
  const contentProps = {
    plan,
    settings,
    selectedWeek,
    filters,
    currentUser,
    setSelectedWeek,
    setFilters,
    onOpenRegister: openRegister,
    onOpenExtra: openExtra,
    onSaveSettings: saveRunnerSettings,
    onSaveCoachWorkout: saveCoachWorkout,
  };

  return h(AppShell, {
    view,
    settings,
    saveState,
    labels,
    onNavigate: navigate,
    onLogout: logout,
    onToggleTheme: () => setSettingsState((current) => ({ ...current, theme: current.theme === 'dark' ? 'light' : 'dark' })),
    children: renderView(view, contentProps),
    toast,
    modal: modal && h(RegistrationModal, {
      modal,
      plan,
      onClose: () => setModal(null),
      onSave: saveRegistration,
    }),
  });
}

function EntryView({ onEnter }) {
  return h('section', { className: 'entry-view' },
    h('div', { className: 'entry-card' },
      h('div', { className: 'entry-mark' }, 'MP'),
      h('h1', null, 'MyPace'),
      h('p', null, 'Seu treino de hoje, no seu ritmo.'),
      h('button', { className: 'entry-button', type: 'button', onClick: onEnter }, 'Acessar meus treinos'),
    ),
  );
}

function LoginView({ authEnabled, authMessage, loading, onSubmit }) {
  return h('section', { className: 'login-view' },
    h('form', { className: 'login-card', id: 'loginForm', onSubmit },
      h('div', { className: 'login-brand-stack' },
        h('div', { className: 'login-mark' }, 'MP'),
        h('h1', null, 'Entrar no MyPace'),
        h('p', { className: 'login-copy' }, 'Acesse sua periodização e registros salvos.'),
      ),
      h('label', null, 'Usuário ou email', h('input', { name: 'email', type: 'text', autoComplete: 'username', defaultValue: 'guilherme', required: true })),
      h('label', null, 'Senha', h('input', { name: 'password', type: 'password', autoComplete: 'current-password', minLength: 6, required: true })),
      h('button', { className: 'button primary', type: 'submit', disabled: loading || authEnabled === false }, h('span', null, 'Entrar')),
      h('p', { className: 'inline-error' }, authMessage || (authEnabled === false ? 'Login indisponivel. Configure Supabase para acessar.' : '')),
    ),
  );
}

function AppShell({ view, settings, saveState, labels, onNavigate, onLogout, onToggleTheme, children, toast, modal }) {
  const header = labels ?? headerLabels(view, settings, null, '1');
  return h('div', { className: 'app-view' },
    h('aside', { className: 'app-sidebar' },
      h('div', { className: 'sidebar-brand' },
        h('div', { className: 'brand-mark' }, 'MP'),
        h('div', null, h('strong', null, 'MyPace'), h('span', null, 'Plano pessoal')),
      ),
      h('nav', { className: 'main-nav', 'aria-label': 'Navegação principal' },
        NAV_ITEMS.map(([key, iconName, label]) =>
          h('button', {
            key,
            className: `nav-item${view === key ? ' is-active' : ''}`,
            'aria-current': view === key ? 'true' : undefined,
            type: 'button',
            onClick: () => onNavigate(VIEW_PATHS[key]),
          }, icon(iconName), h('span', null, label)),
        ),
      ),
      h('div', { className: 'sidebar-footer' },
        h('button', { className: 'button ghost', type: 'button', onClick: onToggleTheme }, icon(settings.theme === 'dark' ? 'sun' : 'moon'), h('span', null, 'Tema')),
        h('button', { className: 'button ghost', type: 'button', onClick: onLogout }, icon('log-out'), h('span', null, 'Sair')),
      ),
    ),
    h('main', { className: 'app-main' },
      h('header', { className: 'topbar' },
        h('div', null, h('p', { className: 'eyebrow' }, header[0]), h('h1', null, header[1])),
        h('div', { className: 'topbar-actions' },
          h('span', { className: 'save-state', 'data-status': saveState.status },
            icon('cloud'),
            h('span', { 'aria-live': 'polite' }, saveState.label),
          ),
        ),
      ),
      h('section', { className: 'content-shell' }, children),
    ),
    toast && h('div', { className: 'toast', role: 'status', 'aria-live': 'polite', 'data-tone': toast.tone },
      icon(toast.tone === 'warn' ? 'circle-alert' : 'check-circle-2'),
      h('span', null, toast.message),
    ),
    modal,
  );
}

function Skeleton() {
  return h('div', { className: 'skeleton-grid' }, h('div', { className: 'skeleton-card' }), h('div', { className: 'skeleton-card' }), h('div', { className: 'skeleton-card' }));
}

function renderView(view, props) {
  const views = {
    today: TodayView,
    week: WeekView,
    preparation: PreparationView,
    report: ReportView,
    settings: SettingsView,
  };
  const View = views[view] ?? TodayView;
  return h(View, props);
}

function TodayView({ plan, onOpenRegister, onOpenExtra }) {
  const context = todayContext(plan);
  const week = context.week ?? weekForDate(plan, toIsoDate(new Date())) ?? currentWeek(plan);
  return h('section', { className: 'runner-layout' },
    h(TodayMainCard, { context, onOpenRegister }),
    h('button', { className: 'button secondary extra-run-button', type: 'button', onClick: () => onOpenExtra() }, icon('plus'), h('span', null, 'Adicionar corrida extra')),
    h('div', { className: 'today-support' },
      h(UpcomingWeekList, { plan, week }),
      h(WeekProgressCard, { progress: weekProgress(week) }),
    ),
  );
}

function TodayMainCard({ context, onOpenRegister }) {
  if (context.kind === 'done') {
    return h('article', { className: 'today-card is-done' },
      h('span', { className: 'finish-badge' }, statusLabel(context.workout.status)),
      h('p', { className: 'eyebrow' }, dayFullDate(context.workout.date)),
      h('h2', null, context.workout.type),
      h(WorkoutResultSummary, { workout: context.workout, includeComment: true }),
      h('button', { className: 'button secondary today-action', type: 'button', onClick: () => onOpenRegister(context.weekIndex, context.workoutIndex, true) }, h('span', null, 'Editar registro')),
    );
  }
  if (context.kind === 'missed') {
    return h('article', { className: 'today-card missed-card' },
      h('span', { className: 'status-pill missed' }, 'Nao registrado'),
      h('p', { className: 'eyebrow' }, dayFullDate(context.workout.date)),
      h('h2', null, context.workout.type),
      h('p', null, context.workout.guidance ?? context.workout.notes),
      h('button', { className: 'button primary today-action', type: 'button', onClick: () => onOpenRegister(context.weekIndex, context.workoutIndex, false) }, h('span', null, 'Registrar mesmo assim')),
    );
  }
  if (context.kind === 'rest') {
    return h('article', { className: 'today-card rest-card' },
      h('div', { className: 'rest-symbol' }, icon('moon')),
      h('h2', null, 'Descanso ativo'),
      h('p', null, 'Recuperacao faz parte do treino.'),
      context.next && h('div', { className: 'next-inline' },
        h('span', null, 'Proximo treino'),
        h('strong', null, `${dayShortDate(context.next.workout.date)} · ${context.next.workout.type}`),
        h('small', null, nextWorkoutDetail(context.next.workout)),
      ),
    );
  }
  return h('article', { className: 'today-card' },
    h('p', { className: 'eyebrow' }, dayFullDate(context.workout.date)),
    h('h2', null, context.workout.type),
    h(RecommendationCard, { workout: context.workout }),
    h('button', { className: 'button primary today-action', type: 'button', onClick: () => onOpenRegister(context.weekIndex, context.workoutIndex, false) }, h('span', null, 'Registrar treino')),
  );
}

function RecommendationCard({ workout }) {
  return h('div', { className: 'recommendation-card' },
    h('section', null,
      h('h3', null, 'Como executar hoje'),
      h('div', { className: 'execution-grid' },
        h(Metric, { label: 'Pace alvo', value: formatPaceTarget(workout.paceTarget), className: 'target-pace' }),
        h('div', { className: 'recommendation-metric' }, h('span', null, 'Zona de esforco'), h(ZonePill, { zone: workout.zone ?? zoneFor(workout) })),
        h(IconMetric, { label: 'Duracao estimada', iconName: 'clock-3', value: `~${formatDuration(workout)}` }),
        h(IconMetric, { label: 'Volume estimado', iconName: 'route', value: `~${workout.distanceLabel ?? `${workout.distanceKm} km`}` }),
      ),
    ),
    h('section', null,
      h('h3', null, 'Orientacao'),
      h('p', { className: 'orientation-text' }, workout.notes),
      workout.guidance && h('p', { className: 'guidance-tip' }, workout.guidance),
    ),
  );
}

function WeekView({ plan, selectedWeek, setSelectedWeek, onOpenRegister }) {
  const week = plan.weeks.find((item) => String(item.week) === selectedWeek) ?? currentWeek(plan);
  const weekIndex = plan.weeks.indexOf(week);
  return h('section', { className: 'week-layout' },
    h('article', { className: 'week-picker-card' },
      h('button', { className: 'icon-button', type: 'button', 'aria-label': 'Semana anterior', onClick: () => setSelectedWeek(String(clamp(Number(selectedWeek) - 1, 1, plan.weeks.length))) }, icon('chevron-left')),
      h('div', null, h('h2', null, `Semana ${pad2(week.week)}`), h('p', null, `${week.phase} · ${week.focus}`)),
      h('button', { className: 'icon-button', type: 'button', 'aria-label': 'Proxima semana', onClick: () => setSelectedWeek(String(clamp(Number(selectedWeek) + 1, 1, plan.weeks.length))) }, icon('chevron-right')),
    ),
    h('div', { className: 'week-list' },
      week.workouts.map((workout, workoutIndex) => h(WorkoutRow, { key: workout.id, workout, weekIndex, workoutIndex, mode: 'week', onOpenRegister })),
    ),
  );
}

function PreparationView({ plan, filters, setFilters, onOpenRegister }) {
  const allWorkouts = plan.weeks.flatMap((week) => week.workouts);
  const runWorkouts = allWorkouts.filter((workout) => workout.distanceKm > 0);
  const totalKm = plan.weeks.reduce((sum, week) => sum + Number(week.targetVolumeKm || 0), 0);
  const filteredWeeks = filteredPreparationWeeks(plan, filters);
  const filteredCount = filteredWeeks.reduce((sum, week) => sum + week.workouts.length, 0);
  return h('section', { className: 'preparation-layout' },
    h('article', { className: 'preparation-summary' },
      compactMetricNode('Semanas', plan.weeks.length),
      compactMetricNode('Treinos', allWorkouts.length),
      compactMetricNode('Volume planejado', `${round(totalKm)} km`),
      compactMetricNode('Registros', `${runWorkouts.filter(isWorkoutRecorded).length}/${runWorkouts.length}`),
    ),
    h(FilterCard, { plan, filters, setFilters, count: filteredCount }),
    h('div', { className: 'preparation-list' },
      filteredWeeks.length
        ? filteredWeeks.map((week) => h(PreparationWeekCard, { key: week.week, week, onOpenRegister }))
        : h(EmptyState, { iconName: 'filter-x', title: 'Nenhum treino encontrado', text: 'Ajuste os filtros para visualizar a preparacao.' }),
    ),
  );
}

function FilterCard({ plan, filters, setFilters, count }) {
  const phases = [...new Set(plan.weeks.map((week) => week.phase))];
  const types = [...new Set(plan.weeks.flatMap((week) => week.workouts).filter((workout) => workout.distanceKm > 0).map((workout) => workout.type))];
  const update = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  return h('article', { className: 'filter-card' },
    h(SelectField, { label: 'Semana', value: filters.week, onChange: (value) => update('week', value), options: [['all', 'Todas'], ...plan.weeks.map((week) => [String(week.week), `Semana ${pad2(week.week)}`])] }),
    h(SelectField, { label: 'Fase', value: filters.phase, onChange: (value) => update('phase', value), options: [['all', 'Todas'], ...phases.map((phase) => [phase, phase])] }),
    h(SelectField, { label: 'Tipo', value: filters.type, onChange: (value) => update('type', value), options: [['all', 'Todos'], ...types.map((type) => [type, type])] }),
    h(SelectField, { label: 'Status', value: filters.status, onChange: (value) => update('status', value), options: statusFilterOptions().map((option) => [option.value, option.label]) }),
    h('button', { className: 'button secondary', type: 'button', onClick: () => setFilters({ week: 'all', phase: 'all', type: 'all', status: 'all' }) }, icon('rotate-ccw'), h('span', null, 'Limpar')),
    h('span', { className: 'filter-count' }, `${count} treinos`),
  );
}

function PreparationWeekCard({ week, onOpenRegister }) {
  const runWorkouts = week.workouts.filter((workout) => workout.distanceKm > 0);
  const done = runWorkouts.filter(isWorkoutRecorded).length;
  return h('article', { className: 'preparation-week-card' },
    h('header', { className: 'preparation-week-header' },
      h('div', null, h('span', null, `Semana ${pad2(week.week)} · ${week.phase}`), h('h2', null, week.focus)),
      h('div', null, h('strong', null, week.volumeLabel ?? `${week.targetVolumeKm} km`), h('small', null, `${done}/${runWorkouts.length} feitos`)),
    ),
    h('div', { className: 'preparation-workouts' },
      week.workouts.map((workout, workoutIndex) => h(WorkoutRow, { key: workout.id, workout, weekIndex: week.weekIndex, workoutIndex, mode: 'preparation', onOpenRegister })),
    ),
  );
}

function WorkoutRow({ workout, weekIndex, workoutIndex, mode, onOpenRegister }) {
  const status = workoutVisualStatus(workout);
  const isRest = Number(workout.distanceKm || 0) === 0;
  const className = mode === 'week' ? 'week-workout' : 'preparation-workout';
  const open = () => !isRest && onOpenRegister(weekIndex, workoutIndex, isWorkoutRecorded(workout));
  return h('button', { className: `${className} ${status.className}`, disabled: isRest, type: 'button', onClick: open },
    h('div', { className: mode === 'week' ? 'week-date' : 'preparation-date' }, h('strong', null, dayShortDate(workout.date)), h('span', null, `Treino ${pad2(workout.order ?? workoutIndex + 1)}`)),
    h('div', { className: mode === 'week' ? 'week-main' : 'preparation-main' },
      h('strong', null, isRest ? 'Descanso ativo' : workout.type),
      h('p', { className: 'workout-objective' }, h('b', null, 'Objetivo:'), ` ${workout.guidance ?? workout.notes}`),
      h('div', { className: 'workout-facts' },
        h('span', null, isRest ? 'Recuperacao' : `Volume ${workout.distanceLabel ?? `${workout.distanceKm} km`}`),
        h('span', null, isRest ? 'Sem pace' : `Pace ${compactPaceTarget(workout.paceTarget)}`),
        h('span', null, isRest ? 'Descanso' : `Duracao ~${formatDuration(workout)}`),
        mode === 'preparation' && h('span', null, workout.zone ?? zoneFor(workout)),
      ),
    ),
    mode === 'week' && h('div', { className: 'week-workout-meta' }, h('b', null, isRest ? 'Solto' : compactPaceTarget(workout.paceTarget)), h('span', null, isRest ? 'recuperacao' : `~${formatDuration(workout)}`)),
    h(StatusBadge, { status }),
  );
}

function ReportView({ plan, onOpenRegister, onOpenExtra }) {
  const finished = finishedWorkouts(plan);
  const recorded = recordedWorkouts(plan);
  const summary = reportSummary(plan, finished, recorded);
  const completed = completedWorkouts(plan);
  if (!recorded.length) {
    return h('section', { className: 'report-layout' },
      h(CycleProgressCard, { completed }),
      h(ProgressCards, { summary }),
      h(EmptyState, { iconName: 'bar-chart-3', title: 'Evolucao ainda sem dados', text: 'Os graficos aparecem depois do primeiro registro.' }),
    );
  }
  return h('section', { className: 'report-layout' },
    h(CycleProgressCard, { completed }),
    h(ProgressCards, { summary }),
    h(AlertsCard, { alerts: trainingAlerts(finished, recorded) }),
    h(ProjectionCard, { summary, plan }),
    h('article', { className: 'feature-card chart-card' },
      h('div', { className: 'card-header' }, h('div', null, h('p', { className: 'eyebrow' }, 'Evolucao de pace'), h('h2', null, 'Treinos com pace'))),
      finished.length ? h(PaceChart, { items: finished }) : h('p', null, 'Nenhum registro com pace valido ainda.'),
    ),
    h('div', { className: 'chart-grid' },
      h(SmallBarChart, { title: 'Volume semanal', subtitle: 'Km registrados', items: summary.weekly, valueGetter: (item) => item.volume, max: Math.max(1, ...summary.weekly.map((item) => item.volume)), suffix: 'km' }),
      h(SmallBarChart, { title: 'RPE', subtitle: 'Esforco recente', items: finished.slice(-8).map((item) => ({ chartLabel: item.chartLabel, value: Number(item.execution.rpe || 0) })), valueGetter: (item) => item.value, max: 10, suffix: '' }),
      h(SmallBarChart, { title: 'Aderencia', subtitle: 'Registros por semana', items: summary.weekly, valueGetter: (item) => item.adherence, max: 100, suffix: '%' }),
    ),
    h(HistoryCard, { items: recorded, onOpenRegister, onOpenExtra }),
  );
}

function SettingsView({ settings, currentUser, onSaveSettings, onSaveCoachWorkout }) {
  return h('section', { className: 'settings-layout' },
    h('form', { className: 'settings-card', id: 'settingsForm', onSubmit: onSaveSettings },
      h('label', null, 'Nome', h('input', { name: 'name', type: 'text', defaultValue: settings.name, autoComplete: 'name' })),
      h(SelectField, { label: 'Unidade', name: 'unit', value: settings.unit, options: [['km', 'km'], ['mi', 'mi']] }),
      h('label', null, 'Meta de pace', h('input', { name: 'paceGoal', type: 'text', inputMode: 'numeric', placeholder: '5:41', defaultValue: settings.paceGoal })),
      h('button', { className: 'button primary', type: 'submit' }, h('span', null, 'Salvar configuracoes')),
    ),
    currentUser?.role === 'coach' && h(CoachWorkoutCard, { onSubmit: onSaveCoachWorkout }),
  );
}

function CoachWorkoutCard({ onSubmit }) {
  return h('form', { className: 'settings-card coach-card', id: 'coachWorkoutForm', onSubmit },
    h('div', null, h('p', { className: 'eyebrow' }, 'Coach'), h('h2', null, 'Construir treino para atleta')),
    h('label', null, 'Atleta', h('input', { name: 'athlete', type: 'text', placeholder: 'username ou email', autoComplete: 'off', required: true })),
    h('div', { className: 'form-grid' },
      h('label', null, 'Data', h('input', { name: 'date', type: 'date', defaultValue: toIsoDate(new Date()), required: true })),
      h('label', null, 'Tipo', h('input', { name: 'type', type: 'text', placeholder: 'Corrida longa, intervalado...', defaultValue: 'Corrida personalizada', required: true })),
    ),
    h('div', { className: 'form-grid' },
      h('label', null, 'Distancia', h('div', { className: 'unit-input' }, h('input', { name: 'distanceKm', type: 'text', inputMode: 'decimal', placeholder: '8,0', required: true, onInput: maskDistanceEvent, onBlur: formatDistanceEvent }), h('b', null, 'km'))),
      h('label', null, 'Pace alvo', h('input', { name: 'paceTarget', type: 'text', placeholder: '6:15-6:45/km' })),
    ),
    h('label', null, 'Objetivo', h('textarea', { name: 'notes', rows: 3, placeholder: 'Descreva o treino que o atleta deve executar.', required: true })),
    h('label', null, 'Orientacao', h('textarea', { name: 'guidance', rows: 2, placeholder: 'Ajustes por RPE, observacoes e alternativas.' })),
    h('button', { className: 'button primary', type: 'submit' }, icon('plus'), h('span', null, 'Adicionar ao plano do atleta')),
  );
}

function RegistrationModal({ modal, plan, onClose, onSave }) {
  const [editingSummary, setEditingSummary] = useState(false);
  const isExtra = modal.kind === 'extra';
  const workout = isExtra
    ? (Number.isInteger(modal.extraIndex) ? plan.extraWorkouts?.[modal.extraIndex] : defaultExtraWorkout(plan))
    : plan.weeks[modal.weekIndex]?.workouts?.[modal.workoutIndex];
  if (!workout) return null;
  const showSummary = modal.kind === 'planned' && isWorkoutRecorded(workout) && !modal.forceEdit && !editingSummary;
  return h('div', { className: 'modal-backdrop', onClick: (event) => event.target === event.currentTarget && onClose() },
    h('section', { className: 'quick-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modalTitle' },
      h('div', { className: 'sheet-handle', 'aria-hidden': 'true' }),
      h('button', { className: 'icon-button modal-close', type: 'button', 'aria-label': 'Fechar', onClick: onClose }, icon('x')),
      showSummary
        ? h(RegistrationSummary, { workout, onEdit: () => setEditingSummary(true) })
        : h(RegistrationForm, { modal, workout, onSave }),
    ),
  );
}

function RegistrationSummary({ workout, onEdit }) {
  return h('div', { className: 'quick-register' },
    h('h2', { id: 'modalTitle' }, statusLabel(workout.status)),
    h('p', { className: 'modal-subtitle' }, `${dayFullDate(workout.date)} · ${workout.type}`),
    h(WorkoutResultSummary, { workout, includeComment: true }),
    workout.execution?.desempenho && h('p', { className: 'performance-sentence' }, workout.execution.desempenho),
    workout.execution?.comentario ? h('p', { className: 'summary-comment' }, h('em', null, `"${workout.execution.comentario}"`)) : h('p', { className: 'summary-comment muted' }, 'Sem comentario registrado.'),
    h('button', { className: 'button secondary', type: 'button', onClick: onEdit }, h('span', null, 'Editar registro')),
  );
}

function RegistrationForm({ modal, workout, onSave }) {
  const isExtra = modal.kind === 'extra';
  const execution = normalizeExecution(workout.execution ?? {}, workout.status);
  const [status, setStatus] = useState(execution.status && execution.status !== 'pendente' ? execution.status : 'finalizado');
  const [extraDate, setExtraDate] = useState(workout.date);
  const [extraType, setExtraType] = useState(workout.type);
  const [distance, setDistance] = useState(formatDistanceInput(execution.km_real ?? (isExtra ? '' : workout.distanceKm)));
  const [duration, setDuration] = useState(execution.tempo_real ?? '');
  const [pace, setPace] = useState(execution.pace_real ?? '');
  const [manualPace, setManualPace] = useState(Boolean(execution.pace_real));
  const [rpe, setRpe] = useState(Number(execution.rpe ?? 5));
  const [pain, setPain] = useState(execution.dor ?? 'nenhuma');
  const [sleep, setSleep] = useState(execution.sono ?? 'regular');
  const [weather, setWeather] = useState(execution.clima ?? '');
  const [replacement, setReplacement] = useState(execution.substituicao ?? '');
  const [commentVisible, setCommentVisible] = useState(Boolean(execution.comentario));
  const [comment, setComment] = useState(execution.comentario ?? '');
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (manualPace) return;
    const km = parseDistanceInput(distance);
    const seconds = parseDurationToSeconds(duration);
    if (Number.isFinite(km) && km > 0 && seconds) setPace(formatPace(Math.round(seconds / km)));
  }, [distance, duration, manualPace]);

  const submit = (event) => {
    event.preventDefault();
    const km = parseDistanceInput(distance);
    const normalizedDuration = normalizeDurationInput(duration);
    const normalizedPace = normalizePaceInput(pace);
    const requiresTrainingData = status !== 'perdido';
    const nextErrors = {
      extraDate: isExtra && !parseLocalDate(extraDate),
      extraType: isExtra && extraType.trim().length < 3,
      distance: requiresTrainingData && (!Number.isFinite(km) || km <= 0),
      duration: requiresTrainingData && !isValidDuration(normalizedDuration),
      pace: requiresTrainingData && !isValidPace(normalizedPace),
      replacement: status === 'substituido' && replacement.trim().length < 3,
    };
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    onSave({
      ...modal,
      date: extraDate,
      type: extraType.trim(),
      status,
      distance: km,
      duration: normalizedDuration,
      pace: normalizedPace,
      rpe,
      pain,
      sleep,
      weather: weather.trim(),
      replacement: replacement.trim(),
      comment: comment.trim(),
    });
  };

  return h('form', { className: 'quick-register', id: 'quickRegisterForm', noValidate: true, onSubmit: submit },
    h('h2', { id: 'modalTitle' }, isExtra ? 'Corrida extra' : 'Registrar treino'),
    h('p', { className: 'modal-subtitle' }, `${dayFullDate(extraDate)} · ${extraType}`),
    isExtra && h('div', { className: 'form-grid' },
      h(Field, { label: 'Data', error: errors.extraDate && 'Informe a data da corrida.' }, h('input', { type: 'date', value: extraDate, onChange: (event) => setExtraDate(event.target.value), 'aria-invalid': errors.extraDate || undefined, required: true })),
      h(Field, { label: 'Nome', error: errors.extraType && 'Informe um nome para a corrida.' }, h('input', { type: 'text', value: extraType, onChange: (event) => setExtraType(event.target.value), 'aria-invalid': errors.extraType || undefined, required: true })),
    ),
    h(SelectField, { label: 'Status do treino', value: status, onChange: setStatus, options: executionStatusOptions().map((option) => [option.value, option.label]) }),
    status !== 'perdido' && h('fieldset', { className: 'training-fields' },
      h('legend', null, 'Dados da corrida feita'),
      h(Field, { label: 'Distancia real', error: errors.distance && 'Informe uma distancia maior que zero.' },
        h('div', { className: 'unit-input' }, h('input', { type: 'text', inputMode: 'decimal', value: distance, onInput: (event) => setDistance(maskDistance(event.target.value)), onBlur: (event) => setDistance(formatDistanceInput(parseDistanceInput(event.target.value))), 'aria-invalid': errors.distance || undefined, required: true }), h('b', null, 'km')),
      ),
      h(Field, { label: 'Tempo total', error: errors.duration && 'Digite o tempo em mm:ss ou h:mm:ss.' },
        h('input', { type: 'text', inputMode: 'numeric', placeholder: '42:30 ou 1:42:30', value: duration, onInput: (event) => setDuration(sanitizeDurationInput(event.target.value)), onBlur: () => setDuration(normalizeDurationInput(duration)), 'aria-invalid': errors.duration || undefined, required: true }),
      ),
      h(Field, { label: 'Pace medio', hint: manualPace ? 'Pace editado manualmente. Limpe o campo para recalcular.' : 'Calculado automaticamente pela distancia e tempo.', error: errors.pace && 'Digite no formato mm:ss.' },
        h('input', { type: 'text', inputMode: 'numeric', placeholder: firstPace(workout.paceTarget) ?? '5:41', value: pace, onInput: (event) => { setManualPace(Boolean(event.target.value)); setPace(sanitizePaceInput(event.target.value)); }, onBlur: () => setPace(normalizePaceInput(pace)), 'aria-invalid': errors.pace || undefined, required: true }),
      ),
    ),
    h('label', { className: 'rpe-field' },
      h('span', null, 'Como foi o esforco?'),
      h('div', { className: 'rpe-heading' }, h('strong', null, rpe)),
      h('input', { type: 'range', min: 1, max: 10, step: 1, value: rpe, onChange: (event) => setRpe(Number(event.target.value)) }),
      h('div', { className: 'rpe-markers' }, h('small', { className: 'easy' }, 'Facil'), h('small', { className: 'moderate' }, 'Moderado'), h('small', { className: 'hard' }, 'Forte'), h('small', { className: 'max' }, 'Maximo')),
    ),
    h('div', { className: 'form-grid' },
      h(SelectField, { label: 'Dor', value: pain, onChange: setPain, options: ['nenhuma', 'leve', 'moderada', 'forte'].map((value) => [value, capitalize(value)]) }),
      h(SelectField, { label: 'Sono', value: sleep, onChange: setSleep, options: ['bom', 'regular', 'ruim'].map((value) => [value, capitalize(value)]) }),
    ),
    h('label', null, 'Clima', h('input', { type: 'text', placeholder: 'Ex.: quente, umido, chuva leve', value: weather, onChange: (event) => setWeather(event.target.value) })),
    status === 'substituido' && h(Field, { label: 'O que substituiu?', error: errors.replacement && 'Descreva o treino substituto.' }, h('input', { type: 'text', placeholder: 'Ex.: bike 45 min, esteira leve, caminhada', value: replacement, onChange: (event) => setReplacement(event.target.value), 'aria-invalid': errors.replacement || undefined })),
    !commentVisible && h('button', { className: 'text-link', type: 'button', onClick: () => setCommentVisible(true) }, '+ Adicionar comentario'),
    commentVisible && h('label', { className: 'quick-note' }, 'Comentario', h('textarea', { rows: 3, placeholder: 'Como voce se sentiu? Alguma observacao sobre o treino...', value: comment, onChange: (event) => setComment(event.target.value) })),
    h('button', { className: 'button confirm', type: 'submit' }, h('span', null, isExtra ? 'Salvar corrida extra ✓' : 'Salvar treino ✓')),
  );
}

function Field({ label, hint, error, children }) {
  return h('label', null,
    label,
    children,
    hint && h('span', { className: 'field-hint', 'aria-live': 'polite' }, hint),
    error && h('span', { className: 'field-error' }, error),
  );
}

function SelectField({ label, name, value, options, onChange }) {
  const selectProps = onChange
    ? { name, value, onChange: (event) => onChange(event.target.value) }
    : { name, defaultValue: value };
  return h('label', null,
    label,
    h('select', selectProps,
      options.map(([optionValue, optionLabel]) => h('option', { key: optionValue, value: optionValue }, optionLabel)),
    ),
  );
}

function Metric({ label, value, className }) {
  return h('div', { className: 'recommendation-metric' }, h('span', null, label), h('strong', { className }, value));
}

function IconMetric({ label, iconName, value }) {
  return h('div', { className: 'recommendation-metric icon-metric' }, h('span', null, label), h('strong', null, icon(iconName), value));
}

function ZonePill({ zone }) {
  return h('span', { className: `zone-pill ${String(zone).toLowerCase()}` }, zone);
}

function StatusBadge({ status }) {
  if (status.className === 'rest') return h('span', { className: 'status-pill' }, 'Descanso');
  if (status.className === 'finalizado') return h('span', { className: 'status-pill done' }, 'Feito ✓');
  if (status.className === 'parcial') return h('span', { className: 'status-pill partial' }, 'Parcial');
  if (status.className === 'substituido') return h('span', { className: 'status-pill replaced' }, 'Substituido');
  if (status.className === 'perdido') return h('span', { className: 'status-pill lost' }, 'Perdido');
  return h('span', { className: `status-pill ${status.className === 'today' ? 'today' : status.className === 'missed' ? 'missed' : ''}` }, icon('list-checks'), 'Checklist');
}

function WorkoutResultSummary({ workout, includeComment = false }) {
  const execution = normalizeExecution(workout.execution ?? {}, workout.status);
  return h(window.React.Fragment, null,
    h('div', { className: 'result-summary' },
      compactMetricNode('Km real', execution.km_real ? `${execution.km_real} km` : '-'),
      compactMetricNode('Tempo', execution.tempo_real || '-'),
      compactMetricNode('Pace real', execution.pace_real ? `${execution.pace_real}/km` : '-', true),
    ),
    h('div', { className: 'context-line' },
      h('span', null, `Planejado: ${workout.distanceLabel ?? `${workout.distanceKm} km`}`),
      h('span', null, `Alvo: ${compactPaceTarget(workout.paceTarget)}`),
      h('span', null, `Sono: ${execution.sono ?? '-'}`),
      h('span', null, `Clima: ${execution.clima || '-'}`),
      execution.substituicao && h('span', null, `Substituto: ${execution.substituicao}`),
    ),
    execution.desempenho && h('p', { className: 'performance-sentence' }, execution.desempenho),
    includeComment && execution.comentario && h('p', { className: 'summary-comment' }, h('em', null, `"${execution.comentario}"`)),
  );
}

function WeekProgressCard({ progress }) {
  return h('article', { className: 'feature-card progress-card' },
    h('div', { className: 'progress-label' }, h('span', null, 'Semana'), h('strong', null, `${progress.done}/${progress.total} feitos`)),
    h('div', { className: 'progress-track' }, h('span', { style: { width: `${progress.percent}%` } })),
  );
}

function UpcomingWeekList({ plan, week }) {
  const today = toIsoDate(new Date());
  const items = (week?.workouts ?? []).filter((workout) => workout.distanceKm > 0 && workout.date >= today).slice(0, 3);
  const fallback = allWorkoutRefs(plan).map((item) => item.workout).filter((workout) => workout.distanceKm > 0 && workout.date >= today).slice(0, 3);
  const list = items.length ? items : fallback;
  return h('article', { className: 'feature-card compact-list' },
    h('h2', null, 'Proximos treinos'),
    list.length ? list.map((workout) => h('div', { className: 'compact-row', key: workout.id },
      h('span', null, dayShortDate(workout.date)),
      h('div', null, h('strong', null, workout.type), h('small', null, nextWorkoutDetail(workout))),
    )) : h('p', null, 'Nenhum treino futuro na periodizacao.'),
  );
}

function EmptyState({ iconName, title, text }) {
  return h('article', { className: 'empty-state' }, h('div', { className: 'empty-icon' }, icon(iconName)), h('div', null, h('h2', null, title), h('p', null, text)));
}

function CycleProgressCard({ completed }) {
  return h('article', { className: 'feature-card progress-card' },
    h('div', { className: 'progress-label' }, h('span', null, 'Ciclo'), h('strong', null, `${completed.done}/${completed.total} treinos`)),
    h('div', { className: 'progress-track' }, h('span', { style: { width: `${completed.percent}%` } })),
  );
}

function ProgressCards({ summary }) {
  return h('div', { className: 'report-metrics' },
    compactMetricNode('Km registrados', summary.totalKm),
    compactMetricNode('Treinos registrados', summary.workoutsDone),
    compactMetricNode('Consistencia', summary.consistency),
    compactMetricNode('Melhor pace', summary.bestPace, true),
  );
}

function AlertsCard({ alerts }) {
  return h('article', { className: `feature-card alerts-card ${alerts.some((alert) => alert.level === 'danger') ? 'has-danger' : ''}` },
    h('div', { className: 'card-header' }, h('div', null, h('p', { className: 'eyebrow' }, 'Alertas'), h('h2', null, 'Fadiga e meta'))),
    alerts.map((alert) => h('div', { className: `alert-row ${alert.level}`, key: alert.message }, icon(alert.icon), h('p', null, alert.message))),
  );
}

function ProjectionCard({ summary, plan }) {
  const distance = targetDistanceKm(plan);
  const goal = targetGoalPaceSeconds(plan);
  const delta = summary.projectionSeconds ? summary.projectionSeconds - goal : null;
  const title = distance >= 20 ? 'Meia maratona provavel' : `${formatDistanceLabel(distance)} provavel`;
  const message = delta === null
    ? 'Registre alguns treinos com pace para projetar o alvo.'
    : delta <= 0
      ? 'A tendencia atual conversa com a meta do plano.'
      : `A tendencia esta ${Math.round(delta)}s/km acima da referencia. Ajuste carga, recuperacao e consistencia antes de forcar ritmo.`;
  return h('article', { className: 'feature-card projection-card' },
    h('div', null, h('p', { className: 'eyebrow' }, 'Projecao'), h('h2', null, title)),
    h('div', { className: 'projection-main' }, h('strong', null, summary.probablePr), h('span', null, summary.projectionSeconds ? `${formatPace(summary.projectionSeconds)}/km` : '-')),
    h('p', null, message),
  );
}

function PaceChart({ items }) {
  const paces = items.map((item) => item.paceSeconds);
  const min = Math.min(...paces);
  const max = Math.max(...paces);
  const range = Math.max(1, max - min);
  const ticks = Array.from({ length: 5 }, (_, index) => formatPace(Math.round(min + (range / 4) * index))).reverse();
  return h('div', { className: 'pace-chart' },
    h('div', { className: 'y-axis' }, ticks.map((tick) => h('span', { key: tick }, tick))),
    h('div', { className: 'chart-bars' },
      h('div', { className: 'goal-line' }, h('span', null, 'Meta')),
      items.map((item) => {
        const height = 28 + Math.round(((max - item.paceSeconds) / range) * 172);
        return h('div', { className: 'bar-item', key: `${item.id}-${item.chartLabel}` },
          h('span', { className: `bar-value ${height < 56 ? 'dark' : ''}` }, item.execution.pace_real),
          h('div', { className: `pace-bar ${height > 150 ? 'goal' : ''}`, style: { height: `${height}px` } }),
          h('small', null, item.chartLabel),
        );
      }),
    ),
  );
}

function SmallBarChart({ title, subtitle, items, valueGetter, max, suffix }) {
  return h('article', { className: 'feature-card mini-chart-card' },
    h('p', { className: 'eyebrow' }, subtitle),
    h('h2', null, title),
    h('div', { className: 'mini-chart' },
      items.length ? items.slice(-8).map((item) => {
        const value = Number(valueGetter(item) || 0);
        const height = Math.max(8, Math.round((value / Math.max(1, max)) * 112));
        const label = item.chartLabel ?? `S${pad2(item.week)}`;
        return h('div', { className: 'mini-bar-item', key: label }, h('span', null, `${value}${suffix}`), h('b', { style: { height: `${height}px` } }), h('small', null, label));
      }) : h('p', null, 'Sem dados.'),
    ),
  );
}

function HistoryCard({ items, onOpenRegister, onOpenExtra }) {
  return h('article', { className: 'feature-card history-card' },
    h('div', { className: 'card-header' }, h('div', null, h('p', { className: 'eyebrow' }, 'Historico'), h('h2', null, 'Todos os registros'))),
    h('div', { className: 'history-list' },
      items.slice().reverse().map((item) => h('div', { className: 'history-row', key: `${item.source}-${item.id}` },
        h('div', null,
          h('strong', null, `${dayShortDate(item.execution.data_execucao ?? item.date)} · ${item.type}`),
          h('span', null, `${item.source === 'extra' ? 'Corrida extra' : statusLabel(item.status)} · Planejado ${item.source === 'extra' ? 'fora do plano' : item.distanceLabel ?? `${item.distanceKm} km`} · Real ${item.execution.km_real ? `${item.execution.km_real} km` : '-'}`),
          item.execution.desempenho && h('p', null, item.execution.desempenho),
        ),
        h('div', null,
          h('b', null, item.execution.pace_real ? `${item.execution.pace_real}/km` : '-'),
          h('small', null, `RPE ${item.execution.rpe ?? '-'}`),
          item.source === 'extra'
            ? h('button', { className: 'icon-button history-edit', type: 'button', 'aria-label': `Editar corrida extra ${item.type}`, onClick: () => onOpenExtra(item.extraIndex) }, icon('pencil'))
            : h('button', { className: 'icon-button history-edit', type: 'button', 'aria-label': `Editar treino ${item.type}`, onClick: () => onOpenRegister(item.weekIndex, item.workoutIndex, true) }, icon('pencil')),
        ),
      )),
    ),
  );
}

function compactMetricNode(label, value, mono = false) {
  return h('div', { className: 'mini-metric' }, h('span', null, label), h('strong', { className: mono ? 'mono' : '' }, value));
}

function icon(name) {
  return h('i', { 'data-lucide': name });
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

async function loadCurrentUser(session, localMode, headers) {
  if (!session || localMode) return null;
  try {
    const response = await fetch('/api/me', { headers: headers() });
    if (!response.ok) throw new Error('Perfil indisponivel');
    return response.json();
  } catch {
    return {
      id: session.user?.id ?? '',
      email: session.user?.email ?? '',
      username: session.user?.user_metadata?.username ?? '',
      displayName: session.user?.user_metadata?.display_name ?? '',
      role: 'user',
    };
  }
}

async function loadPlan(session, localMode, authConfig, headers) {
  const saved = await loadSavedPlan(session, localMode, authConfig, headers);
  if (saved?.weeks?.length) return saved;
  return fetchInitialPlan(session, localMode, headers);
}

async function loadSavedPlan(session, localMode, authConfig, headers) {
  if (session && authConfig?.persistenceEnabled && !localMode) {
    try {
      const response = await fetch('/api/user-plan', { headers: headers() });
      if (response.ok) {
        const text = await response.text();
        const row = text ? JSON.parse(text) : null;
        if (row?.plan?.weeks?.length) {
          localStorage.setItem(storageKey(session, localMode), JSON.stringify(row.plan));
          return row.plan;
        }
      }
    } catch {
      // Local fallback below.
    }
  }
  const keys = session && !localMode
    ? [storageKey(session, localMode)]
    : [storageKey(session, localMode), STORAGE_KEY, ...knownPlanKeys()];
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
  return Array.from({ length: localStorage.length }, (_item, index) => localStorage.key(index)).filter((key) => key?.startsWith('mypace:') && key !== SETTINGS_KEY);
}

async function fetchInitialPlan(session, localMode, headers) {
  const options = session && !localMode ? { headers: headers() } : undefined;
  const response = await fetch('/api/plan', options);
  if (!response.ok) throw new Error('Falha ao carregar plano inicial');
  return response.json();
}

function normalizePlanState(input) {
  const plan = input ?? { weeks: [] };
  plan.schemaVersion = PLAN_VERSION;
  plan.extraWorkouts ??= [];
  plan.weeks?.forEach((week, weekIndex) => {
    week.workouts?.forEach((workout, workoutIndex) => {
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
  plan.extraWorkouts = plan.extraWorkouts
    .filter((workout) => workout?.date)
    .map((workout, index) => {
      const status = normalizeWorkoutStatus(workout.execution?.status ?? workout.status ?? 'finalizado');
      const execution = normalizeExecution(workout.execution ?? {}, status);
      const distance = Number(execution.km_real || workout.distanceKm || 0);
      return {
        ...defaultExtraWorkout(plan, workout.date),
        ...workout,
        id: workout.id ?? `extra-${workout.date}-${index + 1}`,
        source: 'extra',
        order: workout.order ?? index + 1,
        week: weekForDate(plan, workout.date)?.week ?? workout.week ?? 0,
        status,
        distanceKm: distance,
        distanceLabel: distance ? formatDistanceLabel(round(distance)) : workout.distanceLabel ?? '',
        execution,
      };
    });
  return plan;
}

function applyWorkoutExecution(plan, workout, payload) {
  const requiresTrainingData = payload.status !== 'perdido';
  if (payload.kind === 'extra') {
    workout.id ||= `extra-${Date.now()}`;
    workout.date = payload.date;
    workout.day = weekdayAbbrev(payload.date);
    workout.type = payload.type;
    workout.week = weekForDate(plan, payload.date)?.week ?? 0;
    workout.order ||= (plan.extraWorkouts?.length ?? 0) + 1;
    workout.source = 'extra';
    workout.notes = 'Corrida extra fora da preparacao.';
    workout.guidance = 'Registro extra, sem impacto na aderencia do plano.';
    workout.paceTarget = 'solto';
  }
  workout.status = payload.status;
  workout.distanceKm = requiresTrainingData ? round(payload.distance) : 0;
  workout.distanceLabel = requiresTrainingData ? formatDistanceLabel(round(payload.distance)) : '0 km';
  workout.durationMinutes = requiresTrainingData ? Math.round((parseDurationToSeconds(payload.duration) ?? 0) / 60) : 0;
  workout.zone = workout.zone ?? 'Z2';
  workout.effort = payload.rpe;
  workout.execution = {
    done: payload.status === 'finalizado',
    status: payload.status,
    km_real: requiresTrainingData ? round(payload.distance) : 0,
    tempo_real: requiresTrainingData ? payload.duration : '',
    pace_real: requiresTrainingData ? payload.pace : '',
    rpe: payload.rpe,
    dor: payload.pain,
    sono: payload.sleep,
    clima: payload.weather,
    substituicao: payload.replacement,
    comentario: payload.comment,
    desempenho: performanceSentence(workout, payload),
    data_execucao: payload.kind === 'extra' ? payload.date : normalizeExecution(workout.execution ?? {}, workout.status).data_execucao ?? toIsoDate(new Date()),
    atualizado_em: new Date().toISOString(),
    distanceKm: requiresTrainingData ? round(payload.distance) : 0,
    duration: requiresTrainingData ? payload.duration : '',
    pace: requiresTrainingData ? payload.pace : '',
    feeling: payload.rpe,
    notes: payload.comment,
    executedAt: payload.kind === 'extra' ? payload.date : toIsoDate(new Date()),
  };
}

function todayContext(plan) {
  const today = toIsoDate(new Date());
  const current = workoutByDate(plan, today);
  if (current) {
    if (Number(current.workout.distanceKm || 0) === 0) return { kind: 'rest', ...current, next: nextWorkoutFromDate(plan, today) };
    return { kind: isWorkoutRecorded(current.workout) ? 'done' : 'pending', ...current };
  }
  const missed = latestMissedWorkout(plan, today);
  if (missed) return { kind: 'missed', ...missed };
  return { kind: 'rest', week: weekForDate(plan, today), next: nextWorkoutFromDate(plan, today) };
}

function allWorkoutRefs(plan) {
  return (plan?.weeks ?? []).flatMap((week, weekIndex) => week.workouts.map((workout, workoutIndex) => ({ source: 'planned', week, weekIndex, workoutIndex, workout })));
}

function extraWorkoutRefs(plan) {
  return (plan?.extraWorkouts ?? []).map((workout, extraIndex) => ({ source: 'extra', week: weekForDate(plan, workout.date), weekIndex: -1, workoutIndex: -1, extraIndex, workout }));
}

function reportWorkoutRefs(plan) {
  return [...allWorkoutRefs(plan), ...extraWorkoutRefs(plan)];
}

function workoutByDate(plan, date) {
  return allWorkoutRefs(plan).find((item) => item.workout.date === date) ?? null;
}

function latestMissedWorkout(plan, date) {
  return allWorkoutRefs(plan).filter((item) => item.workout.date < date && item.workout.distanceKm > 0 && !isWorkoutRecorded(item.workout)).sort((a, b) => b.workout.date.localeCompare(a.workout.date))[0] ?? null;
}

function nextWorkoutFromDate(plan, date) {
  return allWorkoutRefs(plan).find((item) => item.workout.date > date && !isWorkoutRecorded(item.workout) && item.workout.distanceKm > 0)
    ?? allWorkoutRefs(plan).find((item) => !isWorkoutRecorded(item.workout) && item.workout.distanceKm > 0)
    ?? null;
}

function currentWeek(plan) {
  return weekForDate(plan, toIsoDate(new Date()))
    ?? plan?.weeks?.find((week) => week.workouts.some((workout) => !isWorkoutRecorded(workout) && workout.distanceKm > 0))
    ?? plan?.weeks?.at(-1);
}

function weekForDate(plan, date) {
  return plan?.weeks?.find((week, index) => {
    const next = plan.weeks[index + 1]?.startsAt;
    return date >= week.startsAt && (!next || date < next);
  });
}

function weekProgress(week) {
  const all = (week?.workouts ?? []).filter((workout) => workout.distanceKm > 0);
  const done = all.filter(isWorkoutRecorded);
  return { done: done.length, total: all.length, percent: all.length ? Math.round((done.length / all.length) * 100) : 0 };
}

function completedWorkouts(plan) {
  const all = (plan?.weeks ?? []).flatMap((week) => week.workouts).filter((workout) => workout.distanceKm > 0);
  const done = all.filter(isWorkoutRecorded);
  return { done: done.length, total: all.length, percent: all.length ? Math.round((done.length / all.length) * 100) : 0 };
}

function finishedWorkouts(plan) {
  const items = reportWorkoutRefs(plan)
    .map((item) => ({ ...item.workout, source: item.source, weekIndex: item.weekIndex, workoutIndex: item.workoutIndex, extraIndex: item.extraIndex, weekNumber: item.week?.week ?? item.workout.week ?? 0, execution: normalizeExecution(item.workout.execution ?? {}, item.workout.status) }))
    .filter((workout) => isWorkoutRecorded(workout) && workout.status !== 'perdido' && workout.distanceKm > 0 && Number(workout.execution.km_real || 0) > 0 && isValidPace(workout.execution.pace_real) && validRpe(workout.execution.rpe) && workout.execution.data_execucao)
    .map((workout) => ({ ...workout, paceSeconds: parsePaceToSeconds(workout.execution.pace_real) }));
  return withDistinctChartLabels(items);
}

function recordedWorkouts(plan) {
  return reportWorkoutRefs(plan)
    .map((item) => ({ ...item.workout, source: item.source, weekIndex: item.weekIndex, workoutIndex: item.workoutIndex, extraIndex: item.extraIndex, weekNumber: item.week?.week ?? item.workout.week ?? 0, execution: normalizeExecution(item.workout.execution ?? {}, item.workout.status) }))
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

function reportSummary(plan, items, recorded) {
  const count = items.length;
  const totalKm = recorded.reduce((sum, item) => sum + Number(item.execution.km_real || 0), 0);
  const avgPace = count ? Math.round(items.reduce((sum, item) => sum + item.paceSeconds, 0) / count) : null;
  const bestPace = count ? Math.min(...items.map((item) => item.paceSeconds)) : null;
  const completed = completedWorkouts(plan);
  return {
    averagePace: avgPace ? `${formatPace(avgPace)}/km` : '-',
    totalKm: `${round(totalKm)} km`,
    bestPace: bestPace ? `${formatPace(bestPace)}/km` : '-',
    probablePr: bestPace ? estimateDistanceTime(projectedRacePace(items), targetDistanceKm(plan)) : '-',
    projectionSeconds: bestPace ? projectedRacePace(items) : null,
    workoutsDone: `${recorded.length}/${allRunWorkouts(plan).length}`,
    consistency: `${completed.percent}%`,
    weekly: weeklyStats(plan, recorded),
  };
}

function weeklyStats(plan, recorded) {
  return (plan?.weeks ?? []).map((week) => {
    const runWorkouts = week.workouts.filter((workout) => workout.distanceKm > 0);
    const records = recorded.filter((workout) => workout.weekNumber === week.week);
    const plannedRecords = records.filter((workout) => workout.source !== 'extra');
    const volume = records.reduce((sum, workout) => sum + Number(workout.execution.km_real || 0), 0);
    return {
      week: week.week,
      planned: runWorkouts.length,
      recorded: plannedRecords.length,
      done: plannedRecords.filter((workout) => workout.status === 'finalizado').length,
      partial: plannedRecords.filter((workout) => workout.status === 'parcial' || workout.status === 'substituido').length,
      lost: plannedRecords.filter((workout) => workout.status === 'perdido').length,
      adherence: runWorkouts.length ? Math.round((plannedRecords.length / runWorkouts.length) * 100) : 0,
      volume: round(volume),
    };
  });
}

function filteredPreparationWeeks(plan, filters) {
  return (plan?.weeks ?? []).map((week, weekIndex) => ({
    ...week,
    weekIndex,
    workouts: week.workouts.filter((workout) => {
      const status = workoutVisualStatus(workout).className;
      return (filters.week === 'all' || String(week.week) === String(filters.week))
        && (filters.phase === 'all' || week.phase === filters.phase)
        && (filters.type === 'all' || workout.type === filters.type)
        && (filters.status === 'all' || status === filters.status || workout.status === filters.status);
    }),
  })).filter((week) => week.workouts.length);
}

function allRunWorkouts(plan) {
  return (plan?.weeks ?? []).flatMap((week) => week.workouts).filter((workout) => workout.distanceKm > 0);
}

function trainingAlerts(finished, recorded) {
  const alerts = [];
  const recentRecorded = recorded.slice(-5);
  const highRpe = recentRecorded.filter((workout) => Number(workout.execution.rpe) >= 8).length;
  const pain = recentRecorded.filter((workout) => ['moderada', 'forte'].includes(workout.execution.dor)).length;
  const lost = recentRecorded.filter((workout) => workout.status === 'perdido').length;
  const recentPace = finished.slice(-4);
  const avgRecentPace = recentPace.length ? Math.round(recentPace.reduce((sum, workout) => sum + workout.paceSeconds, 0) / recentPace.length) : null;
  if (highRpe >= 2) alerts.push({ level: 'danger', icon: 'activity', message: 'RPE alto em pelo menos 2 registros recentes. Reduza intensidade se isso vier com sono ruim ou dor.' });
  if (pain >= 1) alerts.push({ level: 'danger', icon: 'circle-alert', message: 'Dor moderada/forte apareceu nos registros recentes. Evite qualidade ate correr sem alterar passada.' });
  if (lost >= 2) alerts.push({ level: 'warn', icon: 'calendar-x', message: 'Dois treinos recentes foram perdidos. Mantenha o calendario e nao tente compensar volume de uma vez.' });
  if (avgRecentPace && avgRecentPace > 366) alerts.push({ level: 'warn', icon: 'target', message: 'Pace recente ainda esta acima da referencia do plano. A meta pode precisar de ajuste se isso persistir nos checkpoints.' });
  if (!alerts.length) alerts.push({ level: 'good', icon: 'check-circle-2', message: 'Sem alerta relevante pelos registros recentes. Continue priorizando consistencia e recuperacao.' });
  return alerts;
}

function projectedRacePace(items) {
  const recent = items.slice(-6);
  const weighted = recent.reduce((sum, item, index) => sum + item.paceSeconds * (index + 1), 0);
  const weights = recent.reduce((sum, _item, index) => sum + index + 1, 0);
  return Math.round(weighted / Math.max(1, weights));
}

function estimateDistanceTime(secondsPerKm, distanceKm) {
  const totalSeconds = Math.round(secondsPerKm * distanceKm);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours <= 0) return `${minutes}:${String(seconds).padStart(2, '0')}`;
  return `${hours}h${String(minutes).padStart(2, '0')}`;
}

function defaultExtraWorkout(plan, date = toIsoDate(new Date())) {
  return {
    id: `extra-${Date.now()}`,
    source: 'extra',
    week: weekForDate(plan, date)?.week ?? 0,
    order: (plan?.extraWorkouts?.length ?? 0) + 1,
    date,
    day: weekdayAbbrev(date),
    type: 'Corrida extra',
    status: 'finalizado',
    distanceKm: 0,
    distanceLabel: '',
    paceTarget: 'solto',
    zone: 'Z2',
    durationMinutes: 0,
    effort: 5,
    notes: 'Corrida extra fora da preparacao.',
    guidance: 'Registro extra, sem impacto na aderencia do plano.',
    execution: normalizeExecution({ status: 'finalizado', data_execucao: date, rpe: 5 }, 'finalizado'),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function headerLabels(view, settings, plan, selectedWeek) {
  const today = toIsoDate(new Date());
  return {
    today: [dayFullDate(today), `Bom dia, ${settings.name || 'Guilherme'}`],
    week: ['Semana', `Semana ${pad2(selectedWeek)}`],
    preparation: ['Preparacao', 'Todos os treinos'],
    report: ['Evolucao', 'Relatorio e metricas'],
    settings: ['Configuracoes', 'Preferencias'],
  }[view] ?? ['Hoje', 'O que faco hoje?'];
}

function navigateTo(path) {
  if (window.location.pathname !== path) window.history.pushState({}, '', path);
}

function viewFromPath() {
  return ROUTES[window.location.pathname] ?? 'today';
}

function isEntryRoute() {
  return window.location.pathname === '/';
}

function isLoginRoute() {
  return window.location.pathname === LOGIN_PATH;
}

function nextPathFromLogin() {
  const params = new URLSearchParams(window.location.search);
  return params.get('next') || '/hoje';
}

function normalizeLogin(value) {
  if (value.includes('@')) return value;
  return `${value}@run.local`;
}

function loadSettings() {
  const defaults = { theme: 'light', name: 'Guilherme', unit: 'km', paceGoal: '5:41' };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') };
  } catch {
    return defaults;
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}

function storageKey(session, localMode) {
  const userId = session?.user?.id;
  return userId && !localMode ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;
}

function syncViewportSize() {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
}

function drawIcons() {
  if (window.lucide) window.lucide.createIcons();
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

function normalizeWorkoutStatus(value) {
  return ['finalizado', 'parcial', 'substituido', 'perdido'].includes(value) ? value : 'pendente';
}

function isWorkoutRecorded(workout) {
  return ['finalizado', 'parcial', 'substituido', 'perdido'].includes(workout.status);
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

function workoutVisualStatus(workout) {
  if (Number(workout.distanceKm || 0) === 0) return { className: 'rest' };
  if (isWorkoutRecorded(workout)) return { className: normalizeWorkoutStatus(workout.status) };
  if (workout.date === toIsoDate(new Date())) return { className: 'today' };
  if (workout.date < toIsoDate(new Date())) return { className: 'missed' };
  return { className: 'future' };
}

function executionStatusOptions() {
  return [
    { value: 'finalizado', label: 'Feito' },
    { value: 'parcial', label: 'Parcial' },
    { value: 'substituido', label: 'Substituido' },
    { value: 'perdido', label: 'Perdido' },
  ];
}

function statusFilterOptions() {
  return [
    { value: 'all', label: 'Todos' },
    { value: 'today', label: 'Hoje' },
    { value: 'future', label: 'Futuro' },
    { value: 'missed', label: 'Nao registrado' },
    { value: 'finalizado', label: 'Feito' },
    { value: 'parcial', label: 'Parcial' },
    { value: 'substituido', label: 'Substituido' },
    { value: 'perdido', label: 'Perdido' },
  ];
}

function statusLabel(status) {
  return {
    finalizado: 'Treino feito',
    parcial: 'Treino parcial',
    substituido: 'Treino substituido',
    perdido: 'Treino perdido',
    pendente: 'Pendente',
  }[normalizeWorkoutStatus(status)] ?? 'Pendente';
}

function zoneFor(workout) {
  if (Number(workout.distanceKm || 0) === 0) return 'Descanso';
  const text = `${workout.paceTarget ?? ''} ${workout.type ?? ''}`.toLowerCase();
  if (text.includes('interval') || text.includes('forte')) return 'Z5';
  if (text.includes('tempo') || text.includes('ritmo')) return 'Z4';
  if (text.includes('fartlek') || text.includes('progressivo')) return 'Z3';
  if (text.includes('regenerativo')) return 'Z1';
  return 'Z2';
}

function estimatedDurationMinutes(workout) {
  if (!workout.distanceKm) return 0;
  const seconds = parsePaceToSeconds(firstPace(workout.paceTarget)) ?? 420;
  return Math.max(10, Math.round((seconds * workout.distanceKm) / 60));
}

function formatDuration(workout) {
  const minutes = Number(workout.durationMinutes) || estimatedDurationMinutes(workout);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h${String(rest).padStart(2, '0')}` : `${hours}h`;
}

function formatPaceTarget(raw) {
  if (!raw || raw === 'solto') return 'Solto, sem pace fixo';
  return String(raw).replaceAll('/km', '') + (String(raw).includes('/km') ? '' : '/km');
}

function compactPaceTarget(raw) {
  if (!raw || raw === 'solto') return 'Solto';
  const pace = firstPace(raw);
  return pace ? `${pace}/km` : 'Solto';
}

function firstPace(value) {
  return String(value ?? '').match(/\d{1,2}:\d{2}/)?.[0] ?? null;
}

function nextWorkoutDetail(workout) {
  if (Number(workout.distanceKm || 0) === 0) return workout.guidance ?? workout.notes ?? 'Recuperacao';
  const volume = workout.distanceLabel ?? `${workout.distanceKm} km`;
  return `${volume} · ${compactPaceTarget(workout.paceTarget)} · ${workout.guidance ?? workout.notes}`;
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
  if (execution.pain === 'moderada' || execution.pain === 'forte') return 'Treino concluido, mas a dor merece atencao. Se ela repetir ou alterar a passada, reduza o proximo estimulo.';
  if (kmRatio >= 0.95 && paceDelta <= 0 && execution.rpe <= 7) return 'Excelente execucao: volume completo, pace dentro ou melhor que o alvo e esforco controlado.';
  if (kmRatio >= 0.9 && Math.abs(paceDelta) <= 15 && execution.rpe <= 8) return 'Boa execucao: voce ficou muito perto do planejado e manteve o treino no caminho da meta.';
  if (paceDelta > 25 || execution.rpe >= 9) return 'Execucao pesada: o registro sugere fadiga ou ritmo acima do custo ideal. Priorize recuperar antes de intensificar.';
  if (kmRatio < 0.8) return 'Volume abaixo do planejado. Conta como treino, mas vale observar energia, agenda e recuperacao.';
  return 'Treino registrado dentro de uma faixa util para a preparacao. A consistencia aqui vale muito.';
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
  if (value === '' || value === null || value === undefined || Number.isNaN(value)) return '';
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

function maskDistanceEvent(event) {
  event.currentTarget.value = maskDistance(event.currentTarget.value);
}

function formatDistanceEvent(event) {
  const distance = parseDistanceInput(event.currentTarget.value);
  if (Number.isFinite(distance)) event.currentTarget.value = formatDistanceInput(distance);
}

function sanitizePaceInput(value) {
  const raw = String(value ?? '').trim();
  if (raw.includes(':')) return raw.replace(/[^\d:]/g, '').replace(/:{2,}/g, ':').slice(0, 5);
  return raw.replace(/\D/g, '').slice(0, 4);
}

function maskPace(value) {
  const raw = sanitizePaceInput(value);
  if (raw.includes(':')) return raw.replace(/[^\d:]/g, '').replace(/:{2,}/g, ':').slice(0, 5);
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${Number(digits.slice(0, -2))}:${digits.slice(-2)}`;
}

function sanitizeDurationInput(value) {
  const raw = String(value ?? '').trim();
  if (raw.includes(':')) return raw.replace(/[^\d:]/g, '').replace(/:{2,}/g, ':').slice(0, 8);
  return raw.replace(/\D/g, '').slice(0, 6);
}

function maskDuration(value) {
  const raw = sanitizeDurationInput(value);
  if (raw.includes(':')) return raw.replace(/[^\d:]/g, '').replace(/:{2,}/g, ':').slice(0, 8);
  const digits = raw.replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${Number(digits.slice(0, -2))}:${digits.slice(-2)}`;
  return `${Number(digits.slice(0, -4))}:${digits.slice(-4, -2)}:${digits.slice(-2)}`;
}

function parseDurationToSeconds(value) {
  const formatted = String(value ?? '').includes(':') ? String(value ?? '') : maskDuration(value);
  const parts = formatted.split(':').map(Number);
  if (![2, 3].includes(parts.length) || parts.some((part) => !Number.isFinite(part))) return null;
  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  if (minutes >= 60 || seconds >= 60 || hours < 0 || minutes < 0 || seconds < 0) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}

function parsePaceToSeconds(value) {
  const match = String(value ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!match || Number(match[2]) >= 60) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatPace(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function targetDistanceKm(plan) {
  return Number(plan?.planMeta?.targetRaceDistanceKm || 21.1);
}

function targetGoalPaceSeconds(plan) {
  return targetDistanceKm(plan) >= 20 ? 341 : 536;
}

function formatDistanceLabel(distanceKm) {
  return Number.isInteger(Number(distanceKm)) ? `${distanceKm} km` : `${String(distanceKm).replace('.', ',')} km`;
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
  const formatted = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).format(date).replace('.', '');
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

window.drawMyPaceIcons = drawIcons;

window.ReactDOM.createRoot(document.querySelector('#root')).render(h(App));
