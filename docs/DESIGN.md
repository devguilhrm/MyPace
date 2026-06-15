# MyPace Design System

Interface pensada para uso pessoal: consulta rapida da periodizacao, sem dados simulados e sem painel multiusuario.

## Tokens

```text
Midnight    #0F172A  sidebar, cards destacados
Lava        #F97316  CTA, pace-alvo e destaques
Pace Green  #22C55E  treino feito e progresso positivo
Cloud       #F1F5F9  fundo geral e superficies secundarias
Slate       #94A3B8  labels e texto secundario
White       #FFFFFF  cards, inputs e formulario
Border      #E2E8F0  separadores
```

```text
Fonte: Inter ou system sans-serif
Headings: 600-800, letter-spacing -0.02em
Pace/distancia: tabular nums ou mono
Body: 14-16px, line-height 1.6
Radius: 8px
Card padding: 20px
Sidebar desktop: 240px
Bottom nav mobile: 3 itens
```

## Tela 1: Hoje

Objetivo: responder rapidamente "qual e o treino de hoje?".

Componentes:

- Card principal com treino do dia detectado pela data atual.
- Pace alvo em Lava, duracao e volume estimados.
- Botao primario full-width para abrir registro rapido.
- Dia sem treino mostra descanso ativo e a proxima sessao.

Estados:

- Skeleton cards no carregamento.
- Treino concluido mostra resumo e badge Concluido.
- Toast verde apos salvar.

## Tela 2: Semana

Objetivo: consultar a semana atual e registrar rapidamente qualquer treino pendente.

Componentes:

- Select de semana.
- Lista vertical dos treinos da semana.
- Status visual: concluido, pendente e pendente passado.
- Clique em pendente abre modal de registro.
- Clique em concluido abre resumo somente leitura.

Estados:

- Semana selecionada preservada na navegacao.
- Treino feito recebe superficie Cloud.
- Sem edicao inline do treino planejado.

## Tela 3: Evolucao

Objetivo: mostrar evolucao real sem dados simulados.

Componentes:

- Grafico de barras apenas com treinos finalizados e pace registrado.
- Eixo de pace invertido, linha de meta verde e labels de data.
- Progresso total concluido vs planejado.
- Quatro cards tecnicos com pace medio, volume real, PR provavel e carga.
- Exportacao JSON desabilitada enquanto nao houver treino finalizado.

Mobile:

- Sidebar vira bottom nav.
- Cards e metricas empilham em uma coluna.
- Acoes ficam com largura total para toque confortavel.
