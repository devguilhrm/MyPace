# MyPace Design System

## Tokens

### Cores

```text
Midnight    #0F172A  header, sidebar, cards destacados
Lava        #F97316  CTAs, pace atual, intensidade alta
Pace Green  #22C55E  metas, progresso positivo, PRs
Cloud       #F1F5F9  fundo geral e superfícies secundarias
Slate       #94A3B8  labels, texto secundario, placeholders
White       #FFFFFF  cards, inputs, modais
Border      #E2E8F0  separadores obrigatorios
```

### Tipografia

```text
Fonte: Inter, system sans-serif
Headings: 600-700, letter-spacing -0.02em
Dados numericos: tabular nums / mono quando pace
Body: 14-16px, line-height 1.6
```

### Espaçamento

```text
Card padding: 20px
Grid gap desktop: 16px
Grid gap compacto: 10-12px
Radius: 8px
Sidebar: 240px
```

## Tela 1: Dashboard do Coach

Layout:

- Sidebar fixa de 240px com 4 itens: Dashboard, Atleta, Treino, Relatório.
- Header com avatar do atleta selecionado, semana atual, toggle Coach/Atleta e status de salvamento.
- Grid de cards de atletas em 3 colunas no desktop.

Componentes:

- `athlete-card`: avatar, nome, próximo treino, badge de status.
- `mini-metric`: máximo 3 métricas por atleta.
- `progress-track`: progresso semanal.
- `quick-actions`: Adicionar treino, Ver relatório, Mensagem.

Estados:

- Skeleton cards durante carregamento.
- Badges: No prazo, Atrasado, Lesionado.
- Toast verde no salvamento.

Mobile:

- Sidebar vira bottom nav.
- Cards passam para 1 coluna.

## Tela 2: Perfil do Atleta

Layout:

- Card destacado Midnight com avatar, objetivo e KPIs.
- Grid de zonas de pace.
- Strip de semanas do ciclo.

Componentes:

- `midnight-card`: destaque do atleta.
- `zone-item`: zona, pace e RPE.
- `week-pill`: seleção rápida de semana.

Estados:

- Semana ativa em Lava.
- Dados secundários em Slate.

Mobile:

- Métricas e zonas em 1 coluna.
- Strip de semanas vira lista vertical.

## Tela 3: Montagem de Treino

Layout:

- Side card com semana atual, select de semana e carga.
- Timeline vertical de blocos de treino.
- Registro de execução inline.

Componentes:

- `timeline-block`: índice, tipo, detalhe, duração, pace alvo e zona.
- `intensity-pill`: Easy, Moderate, Hard, Race.
- `execution-card`: feito, km, pace, RPE e observações.

Estados:

- Edição inline em campos de execução.
- Erros inline, nunca modal.
- Salvar gera toast no canto inferior direito.

Mobile:

- Side card sobe para o topo.
- Timeline e execução ficam em 1 coluna.

## Tela 4: Relatório de Evolução

Layout:

- Card de gráfico de pace.
- Métricas técnicas.
- Empty state contextual para exportação e relatórios avançados.

Componentes:

- `pace-chart`: barras Lava e linha de meta Pace Green.
- `pace-number`: pace grande em mono/tabular nums.
- `empty-state`: ilustração simples + CTA.

Mobile:

- Gráfico mantém altura fixa.
- Métricas ficam empilhadas.
