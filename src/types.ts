export type TrainingPhase =
  | 'retorno'
  | 'base forte'
  | 'construcao'
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

export interface AthleteProfile {
  name: string;
  objective: string;
  assumedRaceDate: string;
  originalObjectiveText: string;
  level: string;
  availabilityDays: number;
  currentFiveKm: string;
  recentHistory: string[];
  restrictions: string;
}

export interface WorkoutExecution {
  done: boolean;
  distanceKm?: number;
  pace?: string;
  feeling?: number;
  executedAt?: string;
  notes?: string;
}

export type WorkoutStatus = 'pendente' | 'finalizado';

export interface Workout {
  id: string;
  week: number;
  order: number;
  date: string;
  day: string;
  type: WorkoutType;
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
  athlete: AthleteProfile;
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
}
