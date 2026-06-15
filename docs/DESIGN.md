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

Objetivo: responder rapidamente "qual e meu proximo treino?".

Componentes:

- Card principal Midnight com proximo treino, data, distancia e pace-alvo.
- Quatro metricas: semana, volume planejado, treinos restantes e conclusao do ciclo.
- Lista dos treinos da semana atual.
- Comentarios principais importados do plano.

Estados:

- Skeleton cards no carregamento.
- Checkbox simples para marcar treino como feito.
- Toast verde apos salvar.

## Tela 2: Plano

Objetivo: consultar a periodizacao completa, semana por semana.

Componentes:

- Select de semana.
- Barra de carga baseada no volume planejado.
- Cards de treino com data, tipo, distancia, pace-alvo, RPE e orientacao.
- Badge de fase do ciclo.

Estados:

- Semana selecionada preservada na navegacao.
- Treino feito recebe superficie Cloud.
- Sem edicao inline de treino planejado.

## Tela 3: Ritmos

Objetivo: manter as referencias tecnicas sempre visiveis.

Componentes:

- Objetivo do ciclo.
- Zonas praticas de pace e RPE.
- Cenarios de prova.
- Regras importantes da periodizacao.

Mobile:

- Sidebar vira bottom nav.
- Cards e metricas empilham em uma coluna.
- Acoes ficam com largura total para toque confortavel.
