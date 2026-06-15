import { Injectable } from '@nestjs/common';
import {
  AppUserIdentity,
  CoachWorkoutInput,
  TrainingPhase,
  TrainingPlan,
  TrainingWeek,
  Workout,
  WorkoutAuthor,
  WorkoutType,
} from './types';

interface PlannedWorkout {
  offsetDays: number;
  type: WorkoutType;
  distanceKm: number;
  distanceLabel?: string;
  paceTarget: string;
  effort: number;
  notes: string;
  guidance: string;
}

interface WeekTemplate {
  phase: TrainingPhase;
  focus: string;
  targetVolumeKm: number;
  volumeLabel: string;
  longRunLabel: string;
  keyWorkout: string;
  workouts: PlannedWorkout[];
}

const MS_PER_DAY = 86_400_000;

type AthleteIdentity = AppUserIdentity;

const SYSTEM_COACH: WorkoutAuthor = {
  id: 'system-coach',
  role: 'system',
  name: 'MyPace Coach Seed',
};

@Injectable()
export class PlanService {
  getPlanForUser(user: AthleteIdentity | null): TrainingPlan {
    const plan = this.isFelipe(user) ? this.getFelipePlan() : this.getInitialPlan();
    return this.withSeedAuthorship(plan, user);
  }

  getInitialPlan(): TrainingPlan {
    return {
      schemaVersion: '6.2.0',
      planMeta: {
        generatedAt: new Date().toISOString(),
        startDate: '2026-06-15',
        weeks: 20,
        targetRaceDistanceKm: 21.1,
        warning: 'Plano recalibrado para meia maratona sub-2h: pace medio de prova abaixo de 5:41/km.',
        methodology: [
          'Plano adaptado a partir do arquivo Markdown(8).md colado.',
          'Frequencia maxima de 4 corridas por semana; sem sessoes de academia no app.',
          'Objetivo principal: completar 21,1 km abaixo de 2 horas, sustentando media inferior a 5:41/km.',
          'Longao e prioridade. Se houver fadiga, corte intensidade antes de cortar descanso.',
          'Z2 sub-2h: 6:15-6:45/km na fase central do ciclo, sempre validado por RPE.',
          'RPE manda mais que pace: se passar do alvo, reduza 15-30s/km.',
        ],
        references: [
          'Markdown(8).md colado',
          'Data-base: 15/06/2026. Prova: 31/10/2026. Meta: sub-2h.',
        ],
        paceZones: [
          { name: 'Regenerativo', rpe: '2-3', pace: '6:45-7:20/km' },
          { name: 'Facil / Z2', rpe: '3-4', pace: '6:15-6:45/km' },
          { name: 'Longao facil', rpe: '3-4', pace: '6:20-6:55/km' },
          { name: 'Moderado', rpe: '5-6', pace: '5:40-6:00/km' },
          { name: 'Ritmo de meia sub-2h', rpe: '6-7', pace: '5:35-5:45/km' },
          { name: 'Tempo / limiar', rpe: '7-8', pace: '5:05-5:25/km' },
          { name: 'Intervalado', rpe: '7-8', pace: '4:45-5:10/km' },
        ],
        raceScenarios: [
          { name: 'Conservador', pace: '5:55-6:05/km', time: '2h05-2h08' },
          { name: 'Controle', pace: '5:45-5:50/km', time: '2h01-2h03' },
          { name: 'Sub-2h', pace: '5:37-5:41/km', time: '1h58-1h59' },
          { name: 'Dia forte', pace: '5:30-5:35/km', time: '1h56-1h58' },
        ],
      },
      phases: [
        {
          name: 'retorno',
          weeks: '1-4',
          purpose:
            'Voltar a correr com regularidade sem irritar panturrilha, lombar, joelho ou canela.',
        },
        {
          name: 'base forte',
          weeks: '5-8',
          purpose: 'Consolidar frequencia e aumentar longao sem exagerar na intensidade.',
        },
        {
          name: 'construcao',
          weeks: '9-12',
          purpose: 'Introduzir estimulos de limiar e melhorar sustentacao.',
        },
        {
          name: 'especifica',
          weeks: '13-17',
          purpose: 'Aproximar o corpo do esforco real da meia maratona.',
        },
        {
          name: 'tapering',
          weeks: '18-20',
          purpose: 'Reduzir fadiga, manter coordenacao e chegar descansado.',
        },
      ],
      weeks: this.buildWeeks('2026-06-15', this.templates(), true),
    };
  }

  addCoachWorkout(plan: TrainingPlan, athlete: AppUserIdentity, coach: AppUserIdentity, input: CoachWorkoutInput): TrainingPlan {
    const date = this.parseDate(input.date);
    if (Number.isNaN(date.getTime())) {
      throw new Error('Data do treino invalida.');
    }

    const weekIndex = this.weekIndexForDate(plan, input.date);
    const targetWeek = plan.weeks[weekIndex];
    if (!targetWeek) {
      throw new Error('Plano sem semana disponivel para receber treino.');
    }

    const distanceKm = Number(input.distanceKm || 0);
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
      throw new Error('Distancia do treino precisa ser maior que zero.');
    }

    const order = targetWeek.workouts.length + 1;
    const workout: Workout = {
      id: `coach-${coach.id}-${Date.now()}`,
      source: 'coach',
      createdBy: {
        id: coach.id,
        role: 'coach',
        name: coach.displayName || coach.username || coach.email || 'Coach',
      },
      assignedToUserId: athlete.id,
      week: targetWeek.week,
      order,
      date: input.date,
      day: this.weekday(date),
      type: input.type.trim() || 'Corrida personalizada',
      status: 'pendente',
      distanceKm,
      distanceLabel: input.distanceLabel?.trim() || `${distanceKm} km`,
      paceTarget: input.paceTarget?.trim() || 'solto',
      zone: input.zone || 'Z2',
      durationMinutes: Math.max(10, Math.round((distanceKm * 420) / 60)),
      effort: input.effort ?? 4,
      notes: input.notes.trim(),
      guidance: input.guidance?.trim() || 'Treino criado pelo coach.',
      execution: {
        done: false,
      },
    };

    const weeks = plan.weeks.map((week, index) => {
      if (index !== weekIndex) return week;
      const workouts = [...week.workouts, workout].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
      return {
        ...week,
        workouts: workouts.map((item, itemIndex) => ({ ...item, order: itemIndex + 1 })),
      };
    });

    return {
      ...plan,
      weeks,
    };
  }

  private getFelipePlan(): TrainingPlan {
    return {
      schemaVersion: '6.2.0-felipe.1',
      planMeta: {
        generatedAt: new Date().toISOString(),
        startDate: '2026-06-19',
        weeks: 28,
        targetRaceDistanceKm: 5,
        warning: 'Plano de retorno para Felipe: foco em folego, perda de peso, consistencia e evolucao gradual ate dezembro.',
        methodology: [
          'Plano adaptado do arquivo periodizacao_felipe_ate_dezembro.md.',
          'Disponibilidade principal: sexta, sabado e domingo.',
          'Objetivo: melhorar condicionamento, aumentar tempo em movimento e apoiar perda de peso.',
          'RPE manda mais que pace; terminar com reserva vale mais que acelerar.',
          'Sabado funciona como ponte leve: caminhada, forca, mobilidade ou descanso ativo.',
        ],
        references: [
          'periodizacao_felipe_ate_dezembro.md',
          'Data-base: 15/06/2026. Periodo: 19/06/2026 a 27/12/2026.',
        ],
        paceZones: [
          { name: 'Muito leve', rpe: '2-3', pace: 'caminhada ou trote solto' },
          { name: 'Leve', rpe: '3-4', pace: '8:50-10:00/km' },
          { name: 'Moderado', rpe: '5-6', pace: '8:10-8:45/km' },
          { name: 'Caminhada forte', rpe: '3-4', pace: '10:30-12:30/km' },
        ],
        raceScenarios: [
          { name: 'Marco 1', pace: 'livre', time: '3 km continuo confortavel' },
          { name: 'Marco 2', pace: 'controlado', time: '5 km continuo confortavel' },
          { name: 'Fechamento', pace: 'leve', time: '8-12 km se estiver adaptado' },
        ],
      },
      phases: [
        { name: 'adaptacao', weeks: '1-4', purpose: 'Acostumar o corpo ao impacto e criar rotina.' },
        { name: 'base inicial', weeks: '5-8', purpose: 'Aumentar tempo em movimento sem sofrimento extremo.' },
        { name: 'base continua', weeks: '9-12', purpose: 'Buscar corrida continua confortavel.' },
        { name: 'construcao', weeks: '13-16', purpose: 'Melhorar resistencia e tolerar treinos mais longos.' },
        { name: 'resistencia', weeks: '17-20', purpose: 'Chegar aos 5 km continuos com controle.' },
        { name: 'consolidacao', weeks: '21-24', purpose: 'Sustentar maior volume semanal com seguranca.' },
        { name: 'finalizacao', weeks: '25-28', purpose: 'Fechar o ano com autonomia entre 5 e 8 km, podendo chegar a 10-12 km.' },
      ],
      weeks: this.buildWeeks('2026-06-19', this.felipeTemplates(), false),
    };
  }

  private isFelipe(user: AthleteIdentity | null) {
    const email = user?.email?.toLowerCase() ?? '';
    const username = user?.username?.toLowerCase() ?? '';
    return username === 'felipe' || email === 'felipe@run.local' || email.startsWith('felipe@');
  }

  private buildWeeks(startDate: string, templates: WeekTemplate[], adaptSubTwo: boolean): TrainingWeek[] {
    const start = this.parseDate(startDate);

    return templates.map((template, index) => {
      const weekStart = new Date(start.getTime() + index * 7 * MS_PER_DAY);

      return {
        week: index + 1,
        startsAt: this.formatDate(weekStart),
        phase: template.phase,
        focus: template.focus,
        targetVolumeKm: template.targetVolumeKm,
        volumeLabel: template.volumeLabel,
        longRunLabel: template.longRunLabel,
        keyWorkout: template.keyWorkout,
        workouts: template.workouts.map((workout, workoutIndex) =>
          this.workout(index + 1, workoutIndex + 1, weekStart, workout, adaptSubTwo),
        ),
      };
    });
  }

  private templates(): WeekTemplate[] {
    return [
      this.week('retorno', 'Retorno: reacostumar impacto', 12, '12 km', '4-5 km', 'Facil', [
        this.run(1, 'Corrida facil (Z2)', 3, '3 km', '6:55-7:20/km', 4, 'Corrida facil.', 'Mantenha conversa possivel. Este treino nao e teste de ritmo.'),
        this.run(3, 'Strides', 4, '4 km', '6:55-7:20/km + 4x15s forte/solto', 5, 'Corrida facil com 4 strides de 15s.', 'Strides sao soltos e tecnicos; nao sprintar.'),
        this.rest(5, 'Descanso ou mobilidade.', 'Use o sabado para chegar inteiro ao longao.'),
        this.run(6, 'Corrida longa', 5, '4-5 km', '7:00-7:30/km', 4, 'Longao facil.', 'Termine com reserva clara. Se precisar, faca 4 km.'),
      ]),
      this.week('retorno', 'Retorno: continuidade com strides', 15, '15 km', '6 km', 'Strides', [
        this.run(1, 'Corrida facil (Z2)', 4, '4 km', '6:55-7:20/km', 4, 'Corrida facil.', 'Segure o impulso de acelerar; consistencia e o objetivo.'),
        this.run(3, 'Strides', 5, '5 km', '6:50-7:20/km + 5x15s solto', 5, 'Corrida facil com 5 strides.', 'Recupere bem entre strides; tecnica acima de velocidade.'),
        this.rest(5, 'Descanso.', 'Nao trocar por treino perdido. Preserve a semana.'),
        this.run(6, 'Corrida longa', 6, '6 km', '7:00-7:25/km', 4, 'Longao facil.', 'Ritmo leve e sustentavel do inicio ao fim.'),
      ]),
      this.week('retorno', 'Base inicial: fartlek leve', 18, '18 km', '7 km', 'Fartlek leve', [
        this.run(1, 'Corrida facil (Z2)', 4, '4 km', '6:50-7:15/km', 4, 'Corrida facil.', 'RPE controla o treino; se passar de 4, desacelere.'),
        this.run(3, 'Fartlek', 5, '5 km', '6x30s em 5:35-6:05/km / 90s leve', 6, 'Fartlek leve com 6 repeticoes de 30s forte e 90s leve.', 'Fortes controlados, sem sprint. Recuperacao em trote leve.'),
        this.run(5, 'Regenerativo', 2, '2 km', '7:20-7:50/km ou caminhada forte', 2, 'Regenerativo curto ou caminhada forte.', 'Se houver peso nas pernas, caminhar forte cumpre o objetivo.'),
        this.run(6, 'Corrida longa', 7, '7 km', '6:55-7:25/km', 4, 'Longao facil.', 'Nao force final. O ganho aqui e tempo consistente em pe.'),
      ]),
      this.week('retorno', 'Alivio: absorver o retorno', 14, '14 km', '5-6 km', 'Regenerativo', [
        this.run(1, 'Corrida facil (Z2)', 4, '4 km', '6:55-7:25/km', 4, 'Corrida facil.', 'Semana de alivio. Sair melhor do que entrou.'),
        this.run(3, 'Regenerativo', 3, '3 km', '7:10-7:50/km', 3, 'Regenerativo.', 'Nao acelerar. Avalie dor, sono e fadiga.'),
        this.rest(5, 'Descanso.', 'Descanso faz parte do checkpoint da semana.'),
        this.run(6, 'Corrida longa', 6, '5-6 km', '7:00-7:30/km', 4, 'Longao facil.', 'Escolha 5 km se houver qualquer sinal de sobrecarga.'),
      ]),
      this.week('base forte', 'Base forte: consolidar frequencia', 21, '21 km', '9 km', 'Strides', [
        this.run(1, 'Corrida facil (Z2)', 5, '5 km', '6:45-7:15/km', 4, 'Corrida facil.', 'Facil de verdade; respirar e conversar sem brigar com o pace.'),
        this.run(3, 'Strides', 5, '5 km', '6:45-7:15/km + 6x15-20s forte/solto', 5, 'Corrida facil com 6 strides.', 'Strides curtos, postura alta, passada solta.'),
        this.run(5, 'Regenerativo', 2, '2 km', '7:10-7:50/km', 2, 'Regenerativo.', 'Solte as pernas; nao transforme em rodagem.'),
        this.run(6, 'Corrida longa', 9, '9 km', '6:55-7:25/km', 4, 'Longao facil.', 'Ritmo estavel. Se o RPE subir, ajuste antes de cansar.'),
      ]),
      this.week('base forte', 'Base forte: moderado curto', 24, '24 km', '10 km', 'Tempo curto', [
        this.run(1, 'Corrida facil (Z2)', 5, '5 km', '6:45-7:10/km', 4, 'Corrida facil.', 'Nao antecipe intensidade da quinta.'),
        this.run(3, 'Tempo run', 6, '6 km', '3x5min em 6:10-6:35/km', 6, '3 blocos de 5min moderado dentro de 6 km.', 'Moderado firme, mas controlado. Recuperar em trote leve.'),
        this.run(5, 'Regenerativo', 3, '3 km', '7:10-7:40/km', 2, 'Regenerativo.', 'Treino para recuperar, nao para somar ego.'),
        this.run(6, 'Corrida longa', 10, '10 km', '6:55-7:25/km', 4, 'Longao facil.', 'Feche inteiro. O longao vale mais que acelerar no final.'),
      ]),
      this.week('base forte', 'Base forte: subidas curtas', 27, '27 km', '12 km', 'Subidas curtas', [
        this.run(1, 'Corrida facil (Z2)', 6, '6 km', '6:45-7:10/km', 4, 'Corrida facil.', 'Passada economica e RPE baixo.'),
        this.run(3, 'Subidas', 6, '6 km', '6x20s subida forte/controlada', 7, '6 subidas de 20s dentro de 6 km.', 'Forte tecnico, sem sprint. Desca caminhando ou trotando leve.'),
        this.run(5, 'Regenerativo', 3, '3 km', '7:10-7:40/km', 2, 'Regenerativo.', 'Se panturrilha pesar, reduza ou caminhe.'),
        this.run(6, 'Corrida longa', 12, '12 km', '6:55-7:25/km', 4, 'Longao facil.', 'Controle desde o primeiro quilometro.'),
      ]),
      this.week('base forte', 'Alivio/teste: 5 km confortavel', 21, '21 km', '8 km', '5 km confortavel', [
        this.run(1, 'Corrida facil (Z2)', 5, '5 km', '6:45-7:15/km', 4, 'Corrida facil.', 'Treino para chegar bem ao checkpoint.'),
        this.run(3, 'Teste', 5, '5 km', '6:35-7:00/km', 5, '5 km continuo confortavel.', 'Terminar inteiro. Nao bater recorde.'),
        this.run(5, 'Regenerativo', 3, '3 km', '7:10-7:40/km', 2, 'Regenerativo.', 'Ritmo solto para absorver o teste.'),
        this.run(6, 'Corrida longa', 8, '8 km', '6:55-7:25/km', 4, 'Longao facil.', 'Longao curto de alivio. Nao compensar volume.'),
      ]),
      this.week('construcao', 'Construcao: 4 x 1 km', 29, '29 km', '13 km', '4 x 1 km', [
        this.run(1, 'Corrida facil (Z2)', 6, '6 km', '6:40-7:10/km', 4, 'Corrida facil.', 'Guarde perna para o intervalado.'),
        this.run(3, 'Intervalado', 7, '7 km', '4x1km em 5:25-5:45/km', 8, '4 repeticoes de 1 km forte controlado.', 'Aquecimento em 6:50-7:15/km; recuperacao de 2min trotando.'),
        this.run(5, 'Regenerativo', 3, '3 km', '7:10-7:40/km', 2, 'Regenerativo.', 'Muito leve. O corpo absorve aqui.'),
        this.run(6, 'Corrida longa', 13, '13 km', '6:50-7:20/km', 4, 'Longao facil.', 'Nao disputar pace depois da semana intensa.'),
      ]),
      this.week('construcao', 'Construcao: 2 x 12 min tempo', 32, '32 km', '14 km', '2 x 12 min tempo', [
        this.run(1, 'Corrida facil (Z2)', 6, '6 km', '6:40-7:10/km', 4, 'Corrida facil.', 'Solto e conversavel.'),
        this.run(3, 'Tempo run', 8, '8 km', '2x12min em 5:40-6:00/km', 8, '2 blocos de 12min tempo dentro de 8 km.', 'Forte sustentavel, sem sprint. Recuperacao de 3min trotando.'),
        this.run(5, 'Regenerativo', 4, '4 km', '7:10-7:40/km', 2, 'Regenerativo.', 'Se o RPE subir, esta rapido demais.'),
        this.run(6, 'Corrida longa', 14, '14 km', '6:50-7:20/km', 4, 'Longao facil.', 'Hidrate e mantenha constancia.'),
      ]),
      this.week('construcao', 'Construcao: economia de corrida', 35, '35 km', '15 km', '5 x 800 m', [
        this.run(1, 'Corrida facil (Z2)', 7, '7 km', '6:40-7:10/km', 4, 'Corrida facil.', 'Volume um pouco maior, intensidade baixa.'),
        this.run(3, 'Intervalado', 8, '8 km', '5x800m em 5:10-5:35/km', 8, '5 repeticoes de 800 m controlado.', 'Aquecimento em 6:50-7:10/km; recuperacao de 2min trotando.'),
        this.run(5, 'Regenerativo', 5, '5 km', '7:10-7:40/km', 2, 'Regenerativo.', 'Recuperar para sustentar o longao.'),
        this.run(6, 'Corrida longa', 15, '15 km', '6:50-7:20/km', 4, 'Longao facil.', 'Sem final forte. Prioridade e completar bem.'),
      ]),
      this.week('construcao', 'Alivio/teste: calibrar meta', 27, '27 km', '10 km', 'Teste 5 km', [
        this.run(1, 'Corrida facil (Z2)', 5, '5 km', '6:45-7:15/km', 4, 'Corrida facil.', 'Chegue descansado para o teste.'),
        this.run(3, 'Teste', 9, '9 km totais', 'Teste de 5 km forte controlado', 8, '1-2 km leve, 5 km forte controlado e desaquecimento.', 'Nao sair rasgando no km 1. O teste calibra a meta, nao mede sofrimento.'),
        this.run(5, 'Regenerativo', 3, '3 km', '7:10-7:40/km', 2, 'Regenerativo.', 'Soltar depois do teste.'),
        this.run(6, 'Corrida longa', 10, '10 km', '6:55-7:25/km', 4, 'Longao facil.', 'Semana de alivio; nao tentar compensar.'),
      ]),
      this.week('especifica', 'Especifica: ritmo de meia', 36, '36 km', '16 km', '3 x 10 min ritmo de meia', [
        this.run(1, 'Corrida facil (Z2)', 7, '7 km', '6:35-7:05/km', 4, 'Corrida facil.', 'Facil, mesmo com pace naturalmente melhor.'),
        this.run(3, 'Ritmo de meia', 8, '8 km', '3x10min em 5:50-6:10/km', 7, '3 blocos de 10min em ritmo de meia.', 'Controlado, exige foco. Recuperacao de 3min trotando.'),
        this.run(5, 'Regenerativo', 5, '5 km', '7:10-7:40/km', 2, 'Regenerativo.', 'Proteja o longao de domingo.'),
        this.run(6, 'Corrida longa', 16, '16 km', '6:45-7:15/km', 4, 'Longao facil.', 'Treino-chave de resistencia. Hidrate.'),
      ]),
      this.week('especifica', 'Especifica: 6 x 1 km', 38, '38 km', '17 km', '6 x 1 km', [
        this.run(1, 'Corrida facil (Z2)', 7, '7 km', '6:35-7:05/km', 4, 'Corrida facil.', 'Manter baixo custo energetico.'),
        this.run(3, 'Intervalado', 9, '9 km', '6x1km em 5:05-5:30/km', 8, '6 repeticoes de 1 km controlado.', 'Forte e tecnico. Recuperacao de 2min trotando.'),
        this.run(5, 'Regenerativo', 5, '5 km', '7:10-7:40/km', 2, 'Regenerativo.', 'Nao negociar leveza.'),
        this.run(6, 'Corrida longa', 17, '17 km', '6:45-7:15/km', 4, 'Longao facil.', 'Controle alimentacao e hidratacao.'),
      ]),
      this.week('especifica', 'Alivio: tempo leve', 32, '32 km', '13-14 km', 'Tempo leve', [
        this.run(1, 'Corrida facil (Z2)', 6, '6 km', '6:40-7:10/km', 4, 'Corrida facil.', 'Semana de alivio. Nao acelerar.'),
        this.run(3, 'Tempo run', 7, '7 km', '20min em 5:35-5:55/km', 7, '20min tempo leve dentro de 7 km.', 'Aquecimento em 6:45-7:10/km; desaquecimento leve.'),
        this.run(5, 'Regenerativo', 5, '5 km', '7:10-7:40/km', 2, 'Regenerativo.', 'Muito solto para absorver.'),
        this.run(6, 'Corrida longa', 14, '13-14 km', '6:50-7:20/km', 4, 'Longao facil reduzido.', 'Use 13 km se a semana estiver pesada.'),
      ]),
      this.week('especifica', 'Checkpoint: progressivo especifico', 40, '40 km', '18 km', 'Progressivo', [
        this.run(1, 'Corrida facil (Z2)', 7, '7 km', '6:35-7:05/km', 4, 'Corrida facil.', 'Base baixa para chegar bem ao progressivo.'),
        this.run(3, 'Progressivo', 9, '9 km', '6:40-6:50 -> 6:15-6:25 -> 5:55-6:05/km', 6, '9 km progressivo.', 'Sem sprint final. Confirmar resistencia especifica.'),
        this.run(5, 'Regenerativo', 5, '5 km', '7:10-7:40/km', 2, 'Regenerativo.', 'Treino de manutencao e recuperacao.'),
        this.run(6, 'Corrida longa', 18, '18 km', '6:45-7:15/km', 4, 'Longao facil.', 'Se terminar inteiro, o ciclo esta no caminho certo.'),
      ]),
      this.week('especifica', 'Pico: blocos longos no ritmo de meia', 42, '42 km', '18-19 km', '3 x 15 min ritmo de meia', [
        this.run(1, 'Corrida facil (Z2)', 8, '8 km', '6:35-7:05/km', 4, 'Corrida facil.', 'Controle total. Semana de pico nao permite vaidade.'),
        this.run(3, 'Ritmo de meia', 10, '10 km', '3x15min em 5:45-6:05/km', 7, '3 blocos de 15min em ritmo de meia.', 'Aquecimento em 6:45-7:10/km; recuperacao de 3min trotando.'),
        this.run(5, 'Regenerativo', 5, '5 km', '7:10-7:40/km', 2, 'Regenerativo.', 'Soltar, nao somar carga.'),
        this.run(6, 'Corrida longa', 19, '18-19 km', '6:45-7:15/km', 4, 'Longao facil.', 'Testar hidratacao e gel. Nada novo depois daqui.'),
      ]),
      this.week('tapering', 'Absorcao: ritmo de prova curto', 34, '34 km', '14-16 km', 'Ritmo de prova curto', [
        this.run(1, 'Corrida facil (Z2)', 7, '7 km', '6:40-7:10/km', 4, 'Corrida facil.', 'Comecar a reduzir fadiga.'),
        this.run(3, 'Ritmo de meia', 8, '8 km', '2x10min em 5:50-6:05/km', 6, '2 blocos de 10min em ritmo de prova.', 'Curto e controlado. Recuperacao de 3min trotando.'),
        this.run(5, 'Regenerativo', 4, '4 km', '7:10-7:40/km', 2, 'Regenerativo.', 'Deixe as pernas melhores para domingo.'),
        this.run(6, 'Corrida longa', 15, '14-16 km', '6:50-7:20/km', 4, 'Longao facil com abastecimento.', 'Ensaiar agua/gel/ritmo. Nada novo no dia da prova.'),
      ]),
      this.week('tapering', 'Taper: manter coordenacao', 26, '24-26 km', '8-10 km', 'Strides', [
        this.run(1, 'Corrida facil (Z2)', 6, '6 km', '6:45-7:15/km', 4, 'Corrida facil.', 'Reduzir fadiga, nao buscar ganho novo.'),
        this.run(3, 'Ritmo de meia', 6, '6 km', '3x5min em 5:50-6:05/km', 6, '3 blocos de 5min em ritmo de meia.', 'Estimulo curto. Saia melhor do que entrou.'),
        this.run(5, 'Regenerativo', 4, '3-4 km', '7:00-7:30/km', 2, 'Corrida leve.', 'Pode virar descanso se houver fadiga.'),
        this.run(6, 'Corrida longa', 10, '8-10 km', '6:55-7:25/km', 4, 'Longao curto facil.', 'Nao passar de 10 km.'),
      ]),
      this.week('tapering', 'Semana da prova', 27.1, '5-7 km + prova', '21,1 km', 'Prova', [
        this.run(1, 'Strides', 5, '4-5 km', '6:50-7:20/km + 4x15s soltos', 4, 'Corrida leve com 4 strides.', 'Solto, sem sprint. Objetivo e coordenacao.'),
        this.run(3, 'Regenerativo', 3, '2-3 km', '7:10-7:40/km', 2, 'Muito leve.', 'Parar com vontade de correr mais.'),
        this.rest(4, 'Descanso.', 'Separar roupa, gel, tenis e plano de prova.'),
        this.run(5, 'Prova', 21.1, '21,1 km', '6:00-6:10/km inicial', 9, 'Meia maratona.', 'Plano B: km 1-3 em 6:15-6:20; km 4-10 em 6:05-6:10; km 11-16 em 6:00-6:10; km 17-21 acelerar se sobrar.'),
        this.rest(6, 'Descanso total.', 'Recuperar. Nada de treino pos-prova.'),
      ]),
    ];
  }

  private felipeTemplates(): WeekTemplate[] {
    return [
      this.week('adaptacao', 'Adaptacao: corrida/caminhada leve', 4, '4 km', '2 km', '1 min correndo + 2 min caminhando', [
        this.run(0, 'Corrida facil (Z2)', 2, '2 km', '8:50-10:00/km', 3, 'Caminhada/corrida leve: 1 min correndo + 2 min caminhando.', 'Completar com folga. Se faltar ar, use 1 min correndo + 3 min caminhando.'),
        this.run(1, 'Cross-training', 2, '20-30 min caminhada', '10:30-12:30/km', 2, 'Caminhada leve + mobilidade.', 'Movimento leve para aumentar gasto calorico sem pesar o impacto.'),
        this.run(2, 'Corrida facil (Z2)', 2, '2 km', '8:50-10:00/km', 3, 'Corrida leve, sem forcar pace.', 'Terminar com a sensacao de que conseguiria fazer um pouco mais.'),
      ]),
      this.week('adaptacao', 'Adaptacao: repetir com mais volume', 5, '5 km', '2,5 km', '1 min corrida + 2 min caminhada', [
        this.run(0, 'Corrida facil (Z2)', 2.5, '2,5 km', '8:50-10:00/km', 3, '1 min corrida + 2 min caminhada.', 'Ritmo confortavel, respiracao sob controle.'),
        this.run(1, 'Cross-training', 2, '20-30 min caminhada + forca', '10:30-12:30/km', 3, 'Caminhada e forca basica.', 'Forca com amplitude segura: agachamento, panturrilha, ponte, prancha e core.'),
        this.run(2, 'Corrida facil (Z2)', 2.5, '2,5 km', '8:50-10:00/km', 3, 'Corrida leve.', 'Nao transformar domingo em teste.'),
      ]),
      this.week('adaptacao', 'Adaptacao: reduzir caminhadas', 6, '6 km', '3 km', '1 min corrida + 90s caminhada', [
        this.run(0, 'Corrida facil (Z2)', 3, '3 km', '8:50-10:00/km', 4, '1 min corrida + 90s caminhada.', 'Se ficar pesado, volte para 2 min caminhando.'),
        this.run(1, 'Cross-training', 2.5, '25-35 min caminhada', '10:30-12:30/km', 2, 'Caminhada leve.', 'Manter leve; sabado nao e treino forte.'),
        this.run(2, 'Corrida facil (Z2)', 3, '3 km', '8:50-10:00/km', 3, 'Corrida leve.', 'Terminar inteiro e sem dor.'),
      ]),
      this.week('adaptacao', 'Alivio: absorver impacto', 4.5, '4,5 km', '2,5 km', 'Semana leve', [
        this.run(0, 'Corrida facil (Z2)', 2, '2 km', '8:50-10:00/km', 3, 'Corrida leve.', 'Semana de alivio; nao compensar treino perdido.'),
        this.run(1, 'Mobilidade', 1, 'mobilidade + caminhada curta', 'livre', 2, 'Mobilidade e caminhada curta.', 'Soltar o corpo e observar sinais de dor.'),
        this.run(2, 'Corrida facil (Z2)', 2.5, '2,5 km', '8:50-10:00/km', 3, 'Corrida leve.', 'Finalizar com reserva clara.'),
      ]),
      this.week('base inicial', 'Base inicial: mais tempo correndo', 6.5, '6,5 km', '3,5 km', 'Corrida facil', [
        this.run(0, 'Corrida facil (Z2)', 3, '3 km', '8:50-10:00/km', 3, 'Corrida facil.', 'Conforto acima do pace.'),
        this.run(1, 'Cross-training', 2.5, '30 min caminhada + forca', '10:30-12:30/km', 3, 'Caminhada + forca.', 'Forca basica, sem buscar exaustao.'),
        this.run(2, 'Corrida longa', 3.5, '3,5 km', '8:50-10:00/km', 3, 'Longo leve da semana.', 'Ritmo leve e sustentavel.'),
      ]),
      this.week('base inicial', 'Base inicial: aceleracoes curtas', 7, '7 km', '4 km', '4 aceleracoes de 15s', [
        this.run(0, 'Strides', 3, '3 km + 4x15s', '8:50-10:00/km + solto', 4, 'Corrida facil + 4 aceleracoes de 15s.', 'Aceleracoes soltas, sem sprint.'),
        this.run(1, 'Cross-training', 2.5, '30 min caminhada leve', '10:30-12:30/km', 2, 'Caminhada leve.', 'Sair melhor do que entrou.'),
        this.run(2, 'Corrida longa', 4, '4 km', '8:50-10:00/km', 3, 'Longo leve.', 'Controle a respiracao do inicio ao fim.'),
      ]),
      this.week('base inicial', 'Base inicial: consolidar 4,5 km', 8, '8 km', '4,5 km', 'Domingo leve maior', [
        this.run(0, 'Corrida facil (Z2)', 3.5, '3,5 km', '8:50-10:00/km', 3, 'Corrida facil.', 'Sem pressa; manter conversa possivel.'),
        this.run(1, 'Cross-training', 2, 'forca + caminhada 20 min', '10:30-12:30/km', 3, 'Forca + caminhada curta.', 'Use carga leve e boa tecnica.'),
        this.run(2, 'Corrida longa', 4.5, '4,5 km', '8:50-10:00/km', 3, 'Longo leve.', 'Se houver dor, reduza para 4 km.'),
      ]),
      this.week('base inicial', 'Alivio: fechar fase inteiro', 6.5, '6,5 km', '3,5 km', 'Semana leve', [
        this.run(0, 'Corrida facil (Z2)', 3, '3 km', '8:50-10:00/km', 3, 'Corrida leve.', 'Treino de manutencao.'),
        this.run(1, 'Mobilidade', 0, 'mobilidade', 'solto', 1, 'Mobilidade.', 'Descanso ativo sem impacto.'),
        this.run(2, 'Corrida longa', 3.5, '3,5 km', '8:50-10:00/km', 3, 'Longo leve reduzido.', 'Chegar descansado para a proxima fase.'),
      ]),
      this.week('base continua', 'Base continua: primeiro 5 km leve', 9, '9 km', '5 km', '5 km leve', [
        this.run(0, 'Corrida facil (Z2)', 4, '4 km', '8:50-10:00/km', 3, 'Corrida facil.', 'Controle de respiracao.'),
        this.run(1, 'Cross-training', 3, '35 min caminhada forte ou bike leve', '10:30-12:30/km', 3, 'Caminhada forte ou bike leve.', 'Baixo impacto e gasto calorico.'),
        this.run(2, 'Corrida longa', 5, '5 km', '8:50-10:00/km', 4, 'Longo leve.', 'Primeiro marco de resistencia, sem acelerar.'),
      ]),
      this.week('base continua', 'Base continua: blocos moderados curtos', 9.5, '9,5 km', '5,5 km', '4 x 1 min moderado', [
        this.run(0, 'Fartlek', 4, '4 km', '4x1min em 8:10-8:45/km', 5, '4 km com 4 x 1 min moderado.', 'Recupere caminhando/trotando leve; folego controlado.'),
        this.run(1, 'Cross-training', 2, 'forca + caminhada leve', '10:30-12:30/km', 3, 'Forca + caminhada leve.', 'Nao pesar pernas para domingo.'),
        this.run(2, 'Corrida longa', 5.5, '5,5 km', '8:50-10:00/km', 4, 'Longo leve.', 'Ritmo facil, sem buscar recorde.'),
      ]),
      this.week('base continua', 'Base continua: aumentar domingo', 10.5, '10,5 km', '6 km', '6 km leve', [
        this.run(0, 'Corrida facil (Z2)', 4.5, '4,5 km', '8:50-10:00/km', 3, 'Corrida facil.', 'Respirar bem e terminar inteiro.'),
        this.run(1, 'Cross-training', 3.5, '35-40 min caminhada', '10:30-12:30/km', 2, 'Caminhada.', 'Leve a moderado, sem virar treino pesado.'),
        this.run(2, 'Corrida longa', 6, '6 km', '8:50-10:00/km', 4, 'Longo leve.', 'Se o RPE passar de 5, caminhe trechos curtos.'),
      ]),
      this.week('base continua', 'Alivio/teste: 3 km continuo', 6, '6 km', '3 km teste', 'Teste 3 km confortavel', [
        this.run(0, 'Corrida facil (Z2)', 3, '3 km', '8:50-10:00/km', 3, 'Corrida leve.', 'Poupar para o teste.'),
        this.run(1, 'Mobilidade', 1, 'mobilidade + core', 'solto', 2, 'Mobilidade + core.', 'Core leve e controle de postura.'),
        this.run(2, 'Teste', 3, '3 km continuos', 'confortavel', 5, 'Teste: 3 km continuos confortavel.', 'Nao e teste de velocidade; e teste de controle.'),
      ]),
      this.week('construcao', 'Construcao: retomar volume', 11, '11 km', '6,5 km', '6,5 km leve', [
        this.run(0, 'Corrida facil (Z2)', 4.5, '4,5 km', '8:50-10:00/km', 3, 'Corrida facil.', 'Foco em constancia.'),
        this.run(1, 'Cross-training', 2, 'forca + caminhada 25 min', '10:30-12:30/km', 3, 'Forca + caminhada.', 'Forca sem falhar repeticoes.'),
        this.run(2, 'Corrida longa', 6.5, '6,5 km', '8:50-10:00/km', 4, 'Longo leve.', 'Hidrate e mantenha leve.'),
      ]),
      this.week('construcao', 'Construcao: 5 x 1 min moderado', 12, '12 km', '7 km', '5 x 1 min moderado', [
        this.run(0, 'Fartlek', 5, '5 km', '5x1min em 8:10-8:45/km', 5, '5 km com 5 x 1 min moderado.', 'Moderado e controlado, nunca sprint.'),
        this.run(1, 'Cross-training', 3, '35 min caminhada leve', '10:30-12:30/km', 2, 'Caminhada leve.', 'Recuperar para domingo.'),
        this.run(2, 'Corrida longa', 7, '7 km', '8:50-10:00/km', 4, 'Longo leve.', 'Se cansar, use caminhada curta.'),
      ]),
      this.week('construcao', 'Construcao: estabilidade', 12.5, '12,5 km', '7,5 km', '7,5 km leve', [
        this.run(0, 'Corrida facil (Z2)', 5, '5 km', '8:50-10:00/km', 3, 'Corrida facil.', 'Controle e postura.'),
        this.run(1, 'Mobilidade', 0, 'forca + mobilidade', 'solto', 2, 'Forca + mobilidade.', 'Reduzir impacto no sabado.'),
        this.run(2, 'Corrida longa', 7.5, '7,5 km', '8:50-10:00/km', 4, 'Longo leve.', 'Nao precisa acelerar no final.'),
      ]),
      this.week('construcao', 'Alivio: reduzir fadiga', 9.5, '9,5 km', '5,5 km', 'Semana leve', [
        this.run(0, 'Corrida facil (Z2)', 4, '4 km', '8:50-10:00/km', 3, 'Corrida leve.', 'Semana de alivio.'),
        this.run(1, 'Mobilidade', 0, 'caminhada curta ou descanso', 'solto', 1, 'Caminhada curta ou descanso.', 'Escolha descanso se houver fadiga.'),
        this.run(2, 'Corrida longa', 5.5, '5,5 km', '8:50-10:00/km', 3, 'Longo leve reduzido.', 'Chegar renovado para a resistencia.'),
      ]),
      this.week('resistencia', 'Resistencia: domingo de 8 km', 13, '13 km', '8 km', '8 km leve', [
        this.run(0, 'Corrida facil (Z2)', 5, '5 km', '8:50-10:00/km', 3, 'Corrida facil.', 'Solto e conversavel.'),
        this.run(1, 'Cross-training', 3.5, '40 min caminhada forte', '10:30-12:30/km', 3, 'Caminhada forte.', 'Forte na caminhada, sem impacto de corrida.'),
        this.run(2, 'Corrida longa', 8, '8 km', '8:50-10:00/km', 4, 'Longo leve.', 'Marco importante; caminhar curto e permitido se necessario.'),
      ]),
      this.week('resistencia', 'Resistencia: firme controlado', 14, '14 km', '8,5 km', '2 x 5 min firme', [
        this.run(0, 'Tempo run', 5.5, '5,5 km', '2x5min em 8:10-8:45/km', 5, '5,5 km com 2 x 5 min firme controlado.', 'Firme, mas sem perder controle da respiracao.'),
        this.run(1, 'Cross-training', 2.5, 'forca + caminhada leve', '10:30-12:30/km', 3, 'Forca + caminhada leve.', 'Preservar pernas para domingo.'),
        this.run(2, 'Corrida longa', 8.5, '8,5 km', '8:50-10:00/km', 4, 'Longo leve.', 'Terminar com reserva.'),
      ]),
      this.week('resistencia', 'Resistencia: 9 km leve', 14.5, '14,5 km', '9 km', '9 km leve', [
        this.run(0, 'Corrida facil (Z2)', 5.5, '5,5 km', '8:50-10:00/km', 3, 'Corrida facil.', 'Leve de verdade.'),
        this.run(1, 'Cross-training', 3, '35 min caminhada + mobilidade', '10:30-12:30/km', 2, 'Caminhada + mobilidade.', 'Soltar sem cansar.'),
        this.run(2, 'Corrida longa', 9, '9 km', '8:50-10:00/km', 4, 'Longo leve.', 'Hidratacao e controle.'),
      ]),
      this.week('resistencia', 'Alivio/teste: 5 km continuo', 9, '9 km', '5 km teste', 'Teste 5 km confortavel', [
        this.run(0, 'Corrida facil (Z2)', 4, '4 km', '8:50-10:00/km', 3, 'Corrida leve.', 'Chegar bem ao teste.'),
        this.run(1, 'Mobilidade', 1, 'mobilidade + core', 'solto', 2, 'Mobilidade + core.', 'Ativar sem cansar.'),
        this.run(2, 'Teste', 5, '5 km continuos', 'confortavel', 5, 'Teste: 5 km continuos confortavel.', 'Km 1 leve, km 2-3 confortavel, km 4 controle, km 5 aperta so se estiver bem.'),
      ]),
      this.week('consolidacao', 'Consolidacao: mais volume semanal', 15.5, '15,5 km', '9,5 km', '9,5 km leve', [
        this.run(0, 'Corrida facil (Z2)', 6, '6 km', '8:50-10:00/km', 3, 'Corrida facil.', 'Boa postura e controle.'),
        this.run(1, 'Cross-training', 3.5, '40 min caminhada leve', '10:30-12:30/km', 2, 'Caminhada leve.', 'Baixo impacto.'),
        this.run(2, 'Corrida longa', 9.5, '9,5 km', '8:50-10:00/km', 4, 'Longo leve.', 'Pode reduzir para 8 km se houver dor.'),
      ]),
      this.week('consolidacao', 'Consolidacao: 6 x 1 min moderado', 16, '16 km', '10 km', '6 x 1 min moderado', [
        this.run(0, 'Fartlek', 6, '6 km', '6x1min em 8:10-8:45/km', 5, '6 km com 6 x 1 min moderado.', 'Recuperar bem entre blocos.'),
        this.run(1, 'Cross-training', 2, 'forca + caminhada curta', '10:30-12:30/km', 3, 'Forca + caminhada curta.', 'Sem deixar o sabado pesado.'),
        this.run(2, 'Corrida longa', 10, '10 km', '8:50-10:00/km', 4, 'Longo leve.', 'Marco de resistencia; pace nao e prioridade.'),
      ]),
      this.week('consolidacao', 'Consolidacao: sustentar 10,5 km', 16.5, '16,5 km', '10,5 km', '10,5 km leve', [
        this.run(0, 'Corrida facil (Z2)', 6, '6 km', '8:50-10:00/km', 3, 'Corrida facil.', 'Treino de base.'),
        this.run(1, 'Cross-training', 3.5, '40 min caminhada forte', '10:30-12:30/km', 3, 'Caminhada forte.', 'Gasto calorico sem impacto alto.'),
        this.run(2, 'Corrida longa', 10.5, '10,5 km', '8:50-10:00/km', 4, 'Longo leve.', 'Se segunda-feira costuma pesar, reduza.'),
      ]),
      this.week('consolidacao', 'Alivio: recuperar', 11.5, '11,5 km', '7 km', 'Semana leve', [
        this.run(0, 'Corrida facil (Z2)', 4.5, '4,5 km', '8:50-10:00/km', 3, 'Corrida leve.', 'Reduzir fadiga acumulada.'),
        this.run(1, 'Mobilidade', 0, 'mobilidade ou descanso', 'solto', 1, 'Mobilidade ou descanso.', 'Descanso tambem treina.'),
        this.run(2, 'Corrida longa', 7, '7 km', '8:50-10:00/km', 3, 'Longo leve reduzido.', 'Fechar novembro inteiro.'),
      ]),
      this.week('finalizacao', 'Finalizacao: domingo de 11 km', 17, '17 km', '11 km', '11 km leve', [
        this.run(0, 'Corrida facil (Z2)', 6, '6 km', '8:50-10:00/km', 3, 'Corrida facil.', 'Ritmo confortavel.'),
        this.run(1, 'Cross-training', 2.5, 'forca leve + caminhada', '10:30-12:30/km', 2, 'Forca leve + caminhada.', 'Manter sem gerar dor.'),
        this.run(2, 'Corrida longa', 11, '11 km', '8:50-10:00/km', 4, 'Longo leve.', 'Apenas se estiver sem dor e recuperando bem.'),
      ]),
      this.week('finalizacao', 'Finalizacao: progressivo leve', 18.5, '18,5 km', '12 km', '6,5 km progressivo leve', [
        this.run(0, 'Progressivo', 6.5, '6,5 km', '9:30 -> 8:50/km', 5, 'Progressivo leve.', 'Comecar bem leve e terminar um pouco melhor, sem sprint.'),
        this.run(1, 'Cross-training', 3, '35 min caminhada', '10:30-12:30/km', 2, 'Caminhada.', 'Recuperacao ativa.'),
        this.run(2, 'Corrida longa', 12, '12 km', '8:50-10:00/km', 4, 'Longo leve.', 'Opcao maxima do ciclo; reduza para 10 km se estiver pesado.'),
      ]),
      this.week('finalizacao', 'Alivio ativo: preservar', 13, '13 km', '8 km', '8 km leve', [
        this.run(0, 'Corrida facil (Z2)', 5, '5 km', '8:50-10:00/km', 3, 'Corrida leve.', 'Manter consistencia.'),
        this.run(1, 'Mobilidade', 1, 'mobilidade + caminhada curta', 'solto', 2, 'Mobilidade + caminhada curta.', 'Soltar.'),
        this.run(2, 'Corrida longa', 8, '8 km', '8:50-10:00/km', 3, 'Longo leve.', 'Semana de alivio ativo.'),
      ]),
      this.week('finalizacao', 'Fechamento: teste confortavel', 13, '10-13 km', '5 ou 8 km teste', 'Teste final confortavel', [
        this.run(0, 'Corrida facil (Z2)', 5, '5 km', '8:50-10:00/km', 3, '5 km leve ou caminhada se houver viagem/festa.', 'Flexivel: manter movimento sem culpa.'),
        this.rest(1, 'Descanso/mobilidade.', 'Usar o sabado para chegar bem ao teste final.'),
        this.run(2, 'Teste', 8, '5 ou 8 km confortavel', 'confortavel', 5, 'Teste final: 5 km ou 8 km confortavel.', 'Escolha 5 km se estiver cansado; 8 km se estiver inteiro.'),
      ]),
    ];
  }

  private week(
    phase: TrainingPhase,
    focus: string,
    targetVolumeKm: number,
    volumeLabel: string,
    longRunLabel: string,
    keyWorkout: string,
    workouts: PlannedWorkout[],
  ): WeekTemplate {
    return { phase, focus, targetVolumeKm, volumeLabel, longRunLabel, keyWorkout, workouts };
  }

  private run(
    offsetDays: number,
    type: WorkoutType,
    distanceKm: number,
    distanceLabel: string,
    paceTarget: string,
    effort: number,
    notes: string,
    guidance: string,
  ): PlannedWorkout {
    return { offsetDays, type, distanceKm, distanceLabel, paceTarget, effort, notes, guidance };
  }

  private rest(offsetDays: number, notes: string, guidance: string): PlannedWorkout {
    return {
      offsetDays,
      type: 'Descanso completo',
      distanceKm: 0,
      distanceLabel: '0 km',
      paceTarget: 'solto',
      effort: 1,
      notes,
      guidance,
    };
  }

  private workout(
    week: number,
    order: number,
    weekStart: Date,
    planned: PlannedWorkout,
    adaptSubTwo: boolean,
  ): Workout {
    const adapted = adaptSubTwo ? this.subTwoWorkout(week, planned) : planned;
    const date = new Date(weekStart.getTime() + planned.offsetDays * MS_PER_DAY);

    return {
      id: `w${week}-${planned.offsetDays}-${planned.type.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      source: 'seed',
      createdBy: SYSTEM_COACH,
      week,
      order,
      date: this.formatDate(date),
      day: this.weekday(date),
      type: adapted.type,
      status: 'pendente',
      distanceKm: adapted.distanceKm,
      distanceLabel: adapted.distanceLabel ?? `${adapted.distanceKm} km`,
      paceTarget: this.paceTarget(adapted),
      zone: this.zoneFor(adapted),
      durationMinutes: this.durationMinutes(adapted),
      effort: adapted.effort,
      notes: adapted.notes,
      guidance: adapted.guidance,
      execution: {
        done: false,
      },
    };
  }

  private withSeedAuthorship(plan: TrainingPlan, user: AthleteIdentity | null): TrainingPlan {
    return {
      ...plan,
      extraWorkouts: plan.extraWorkouts ?? [],
      weeks: plan.weeks.map((week) => ({
        ...week,
        workouts: week.workouts.map((workout) => ({
          ...workout,
          source: workout.source ?? 'seed',
          createdBy: workout.createdBy ?? SYSTEM_COACH,
          assignedToUserId: user?.id ?? workout.assignedToUserId,
        })),
      })),
    };
  }

  private weekIndexForDate(plan: TrainingPlan, date: string): number {
    const index = plan.weeks.findIndex((week, weekIndex) => {
      const next = plan.weeks[weekIndex + 1]?.startsAt;
      return date >= week.startsAt && (!next || date < next);
    });
    return index >= 0 ? index : Math.max(0, plan.weeks.length - 1);
  }

  private subTwoWorkout(week: number, planned: PlannedWorkout): PlannedWorkout {
    if (planned.distanceKm === 0) return planned;

    const phase = this.subTwoPhase(week);
    const target = this.subTwoPaceTarget(week, planned, phase);
    const guidance = this.subTwoGuidance(planned, target);

    return {
      ...planned,
      paceTarget: target,
      guidance,
    };
  }

  private subTwoPhase(week: number) {
    if (week <= 4) return 'return';
    if (week <= 8) return 'base';
    if (week <= 12) return 'build';
    if (week <= 17) return 'specific';
    return 'taper';
  }

  private subTwoPaceTarget(week: number, planned: PlannedWorkout, phase: string): string {
    if (planned.type === 'Prova') return '5:38-5:41/km inicial';
    if (planned.type === 'Regenerativo') return phase === 'return' ? '6:55-7:25/km' : '6:45-7:20/km';
    if (planned.type === 'Corrida longa') return this.subTwoLongRunPace(phase);
    if (planned.type === 'Corrida facil (Z2)') return this.subTwoEasyPace(phase);
    if (planned.type === 'Strides') return `${this.subTwoEasyPace(phase)} + strides soltos`;
    if (planned.type === 'Ritmo de meia') return week >= 18 ? '2 blocos em 5:35-5:43/km' : '5:35-5:45/km';
    if (planned.type === 'Tempo run') return week >= 15 ? '5:05-5:25/km' : '5:15-5:30/km';
    if (planned.type === 'Intervalado') return week >= 14 ? '4:45-5:05/km' : '4:55-5:10/km';
    if (planned.type === 'Fartlek') return '6x30s em 5:10-5:25/km / 90s leve';
    if (planned.type === 'Subidas') return '6x20s subida forte/controlada';
    if (planned.type === 'Teste') return week >= 12 ? 'Teste 5 km em 4:55-5:15/km' : '5:55-6:15/km';
    if (planned.type === 'Progressivo') return '6:15-6:25 -> 5:50-6:00 -> 5:35-5:45/km';
    return planned.paceTarget;
  }

  private subTwoEasyPace(phase: string): string {
    if (phase === 'return') return '6:35-7:05/km';
    if (phase === 'base') return '6:25-6:55/km';
    if (phase === 'build') return '6:15-6:45/km';
    if (phase === 'specific') return '6:10-6:40/km';
    return '6:25-6:55/km';
  }

  private subTwoLongRunPace(phase: string): string {
    if (phase === 'return') return '6:45-7:15/km';
    if (phase === 'base') return '6:35-7:05/km';
    if (phase === 'build') return '6:25-6:55/km';
    if (phase === 'specific') return '6:20-6:50/km';
    return '6:35-7:05/km';
  }

  private subTwoGuidance(planned: PlannedWorkout, target: string): string {
    if (planned.type === 'Prova') {
      return 'Meta sub-2h: largar controlado perto de 5:40/km, estabilizar abaixo de 5:41/km e acelerar apenas se sobrar depois do km 16.';
    }

    if (planned.type === 'Ritmo de meia') {
      return `Ensaiar ritmo de prova sub-2h em ${target}. Forte controlado, sem transformar em teste maximo.`;
    }

    if (planned.type === 'Tempo run' || planned.type === 'Intervalado' || planned.type === 'Progressivo') {
      return `${planned.guidance} Referencia sub-2h: ${target}. Controle a tecnica antes de buscar pace.`;
    }

    if (planned.type === 'Corrida longa') {
      return `${planned.guidance} Longao para sustentar resistencia sub-2h; terminar inteiro vale mais que acelerar.`;
    }

    if (planned.type === 'Corrida facil (Z2)') {
      return `${planned.guidance} Facil de verdade: este treino constrói base para correr abaixo de 2h.`;
    }

    return planned.guidance;
  }

  private zoneFor(planned: PlannedWorkout): Workout['zone'] {
    if (planned.distanceKm === 0) return 'Descanso';
    if (planned.effort >= 9) return 'Z5';
    if (planned.effort >= 7) return 'Z4';
    if (planned.effort >= 5) return 'Z3';
    if (planned.effort >= 3) return 'Z2';
    return 'Z1';
  }

  private paceTarget(planned: PlannedWorkout): string {
    return /\d{1,2}:\d{2}/.test(planned.paceTarget) ? planned.paceTarget : 'solto';
  }

  private durationMinutes(planned: PlannedWorkout): number {
    if (planned.distanceKm === 0) return 0;
    const pace = planned.paceTarget.match(/(\d{1,2}):(\d{2})/);
    const secondsPerKm = pace ? Number(pace[1]) * 60 + Number(pace[2]) : 420;
    return Math.max(10, Math.round((secondsPerKm * planned.distanceKm) / 60));
  }

  private parseDate(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12));
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private weekday(date: Date): string {
    return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' })
      .format(date)
      .replace('.', '');
  }
}
