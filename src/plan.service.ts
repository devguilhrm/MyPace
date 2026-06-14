import { Injectable } from '@nestjs/common';
import {
  AthleteProfile,
  TrainingPhase,
  TrainingPlan,
  TrainingWeek,
  Workout,
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

@Injectable()
export class PlanService {
  getInitialPlan(): TrainingPlan {
    const athlete: AthleteProfile = {
      name: 'Guilherme',
      objective:
        'Meia maratona entre 2h05 e 2h10; sub-2h apenas se os checkpoints confirmarem evolucao forte.',
      assumedRaceDate: '2026-10-31',
      originalObjectiveText: 'Maratona de Aracaju 2026 - 21 km em 31/10/2026',
      level:
        'Intermediario em retorno: historico atletico forte, pausa/reducao em 2026 e retomada progressiva.',
      availabilityDays: 4,
      currentFiveKm:
        'Percepcao atual: Z2 realista perto de 6:40-7:10/km, com RPE mandando mais que pace.',
      recentHistory: [
        '2026-06-09: 4,19 km em 27min17s, pace 6:30/km',
        '2026-06-11: 2,76 km em 18min03s, pace 6:32/km',
      ],
      restrictions:
        'Nao compensar treino perdido. Dor que altera passada exige reducao ou descanso.',
    };

    return {
      schemaVersion: '5.0.0',
      athlete,
      planMeta: {
        generatedAt: new Date().toISOString(),
        startDate: '2026-06-15',
        weeks: 20,
        targetRaceDistanceKm: 21.1,
        warning: '',
        methodology: [
          'Plano fiel ao detalhamento semana a semana do arquivo periodizacao_meia_maratona_guilherme_com_ritmos.md.',
          'Frequencia maxima de 4 corridas por semana; sem sessoes de academia no app.',
          'Longao e prioridade. Se houver fadiga, corte intensidade antes de cortar descanso.',
          'Z2 realista: 6:40-7:10/km. Acima de 7:30/km entra como regenerativo.',
          'RPE manda mais que pace: se passar do alvo, reduza 15-30s/km.',
        ],
        references: [
          'periodizacao_meia_maratona_guilherme_com_ritmos.md',
          'Data-base: 15/06/2026. Prova: 31/10/2026.',
        ],
        paceZones: [
          { name: 'Regenerativo', rpe: '2-3', pace: '7:10-7:50/km' },
          { name: 'Facil / Z2', rpe: '3-4', pace: '6:40-7:10/km' },
          { name: 'Longao facil', rpe: '3-4', pace: '6:45-7:20/km' },
          { name: 'Moderado', rpe: '5-6', pace: '6:05-6:30/km' },
          { name: 'Ritmo de meia', rpe: '6-7', pace: '5:50-6:10/km' },
          { name: 'Tempo / limiar', rpe: '7-8', pace: '5:25-5:55/km' },
          { name: 'Intervalado', rpe: '7-8', pace: '5:00-5:40/km' },
        ],
        raceScenarios: [
          { name: 'Conservador', pace: '6:20-6:35/km', time: '2h13-2h19' },
          { name: 'Realista', pace: '6:00-6:10/km', time: '2h06-2h10' },
          { name: 'Boa prova', pace: '5:45-5:55/km', time: '2h01-2h05' },
          { name: 'Sub-2h', pace: '5:35-5:41/km', time: '1h58-2h00' },
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
      weeks: this.buildWeeks(),
    };
  }

  private buildWeeks(): TrainingWeek[] {
    const start = this.parseDate('2026-06-15');

    return this.templates().map((template, index) => {
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
        workouts: template.workouts.map((workout) =>
          this.workout(index + 1, weekStart, workout),
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
      paceTarget: '-',
      effort: 1,
      notes,
      guidance,
    };
  }

  private workout(
    week: number,
    weekStart: Date,
    planned: PlannedWorkout,
  ): Workout {
    const date = new Date(weekStart.getTime() + planned.offsetDays * MS_PER_DAY);

    return {
      id: `w${week}-${planned.offsetDays}-${planned.type.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      date: this.formatDate(date),
      day: this.weekday(date),
      type: planned.type,
      distanceKm: planned.distanceKm,
      distanceLabel: planned.distanceLabel ?? `${planned.distanceKm} km`,
      paceTarget: planned.paceTarget,
      effort: planned.effort,
      notes: planned.notes,
      guidance: planned.guidance,
      execution: {
        done: false,
      },
    };
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
