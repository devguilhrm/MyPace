export type TrainingPhase =
  | 'retorno'
  | 'adaptacao'
  | 'base inicial'
  | 'base continua'
  | 'base forte'
  | 'construcao'
  | 'resistencia'
  | 'consolidacao'
  | 'finalizacao'
  | 'especifica'
  | 'tapering';

export type WorkoutType =
  | 'Corrida facil (Z2)'
  | 'Intervalado'
  | 'Tempo run'
  | 'Fartlek'
  | 'Corrida longa'
  | 'Strides'
  | 'Regenerativo'
  | 'Cross-training'
  | 'Mobilidade'
  | 'Subidas'
  | 'Teste'
  | 'Ritmo de meia'
  | 'Progressivo'
  | 'Descanso completo'
  | 'Prova';

export type UserRole = 'user' | 'coach';
export type WorkoutSource = 'seed' | 'coach' | 'user-extra';

export interface AppUserIdentity {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: UserRole;
}

export interface WorkoutAuthor {
  id: string;
  role: UserRole | 'system';
  name: string;
}

export interface CoachWorkoutInput {
  athlete: string;
  date: string;
  type: string;
  distanceKm: number;
  distanceLabel?: string;
  paceTarget?: string;
  zone?: Workout['zone'];
  effort?: number;
  notes: string;
  guidance?: string;
}

export interface WorkoutExecution {
  done: boolean;
  status?: WorkoutStatus;
  km_real?: number;
  tempo_real?: string;
  pace_real?: string;
  rpe?: number;
  dor?: 'nenhuma' | 'leve' | 'moderada' | 'forte';
  sono?: 'bom' | 'regular' | 'ruim';
  clima?: string;
  substituicao?: string;
  comentario?: string;
  desempenho?: string;
  data_execucao?: string;
  atualizado_em?: string;
  distanceKm?: number;
  duration?: string;
  pace?: string;
  feeling?: number;
  executedAt?: string;
  notes?: string;
}

export type WorkoutStatus = 'pendente' | 'finalizado' | 'perdido' | 'parcial' | 'substituido';

export interface Workout {
  id: string;
  source?: WorkoutSource;
  createdBy?: WorkoutAuthor;
  assignedToUserId?: string;
  week: number;
  order: number;
  date: string;
  day: string;
  type: WorkoutType | string;
  status: WorkoutStatus;
  distanceKm: number;
  distanceLabel?: string;
  paceTarget: string;
  zone: 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5' | 'Descanso';
  durationMinutes: number;
  effort: number;
  notes: string;
  guidance?: string;
  execution: WorkoutExecution;
}

export interface TrainingWeek {
  week: number;
  startsAt: string;
  phase: TrainingPhase;
  focus: string;
  targetVolumeKm: number;
  volumeLabel?: string;
  longRunLabel?: string;
  keyWorkout?: string;
  workouts: Workout[];
}

export interface TrainingPlan {
  schemaVersion: string;
  planMeta: {
    generatedAt: string;
    startDate: string;
    weeks: number;
    targetRaceDistanceKm: number;
    warning: string;
    methodology: string[];
    references: string[];
    paceZones?: Array<{
      name: string;
      rpe: string;
      pace: string;
    }>;
    raceScenarios?: Array<{
      name: string;
      pace: string;
      time: string;
    }>;
  };
  phases: Array<{
    name: TrainingPhase;
    weeks: string;
    purpose: string;
  }>;
  weeks: TrainingWeek[];
  extraWorkouts?: Workout[];
}
