import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AppUserIdentity,
  CoachAthleteStatus,
  CoachAthleteSummary,
  CoachInvite,
  CoachInviteInput,
  TrainingPlan,
  UserRole,
} from './types';

interface SupabaseUserResponse {
  id?: string;
  email?: string;
  user_metadata?: {
    username?: string;
    display_name?: string;
    role?: UserRole;
    user_role?: UserRole;
  };
  app_metadata?: {
    role?: UserRole;
    user_role?: UserRole;
  };
}

export interface StoredPlanRow {
  plan: TrainingPlan;
  updated_at: string;
}

interface SupabaseAdminUsersResponse {
  users?: SupabaseUserResponse[];
}

interface CoachAthleteRow {
  coach_id: string;
  athlete_id: string;
  status?: CoachAthleteStatus;
  created_at?: string;
}

interface CoachInviteRow {
  id: string;
  coach_id: string;
  email: string;
  token: string;
  status: CoachInvite['status'];
  created_at: string;
  expires_at: string;
}

@Injectable()
export class SupabaseService {
  private readonly url = process.env.SUPABASE_URL ?? '';
  private readonly anonKey = process.env.SUPABASE_ANON_KEY ?? '';
  private readonly serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  publicConfig() {
    return {
      authEnabled: Boolean(this.url && this.anonKey),
      authRequired: true,
      supabaseUrl: this.url,
      supabaseAnonKey: this.anonKey,
      persistenceEnabled: Boolean(this.url && this.serviceRoleKey),
    };
  }

  async getUserPlan(authorization: string | undefined) {
    const user = await this.requireUser(authorization);

    if (!this.isPersistenceReady()) {
      return null;
    }

    return this.getUserPlanByUserId(user.id);
  }

  async getUserPlanByUserId(userId: string) {
    if (!this.isPersistenceReady()) {
      return null;
    }

    const response = await fetch(
      `${this.url}/rest/v1/training_plans?user_id=eq.${encodeURIComponent(userId)}&select=plan,updated_at&limit=1`,
      {
        headers: this.serviceHeaders(),
      },
    );

    if (!response.ok) {
      throw new Error(`Supabase read failed: ${response.status}`);
    }

    const rows = (await response.json()) as StoredPlanRow[];
    return rows[0] ?? { plan: null, updated_at: null };
  }

  async saveUserPlan(authorization: string | undefined, plan: TrainingPlan) {
    const user = await this.requireUser(authorization);

    if (!this.isPersistenceReady()) {
      return { saved: false, reason: 'supabase_not_configured' };
    }

    return this.saveUserPlanByUserId(user.id, plan);
  }

  async saveUserPlanByUserId(userId: string, plan: TrainingPlan) {
    if (!this.isPersistenceReady()) {
      return { saved: false, reason: 'supabase_not_configured' };
    }

    const response = await fetch(`${this.url}/rest/v1/training_plans?on_conflict=user_id`, {
      method: 'POST',
      headers: {
        ...this.serviceHeaders(),
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        user_id: userId,
        plan,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Supabase save failed: ${response.status}`);
    }

    return { saved: true };
  }

  async findUserByHandle(handle: string): Promise<AppUserIdentity | null> {
    if (!this.isPersistenceReady()) {
      return null;
    }

    const normalized = handle.trim().toLowerCase();
    if (!normalized) return null;

    const response = await fetch(`${this.url}/auth/v1/admin/users?per_page=1000`, {
      headers: this.serviceHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Supabase user lookup failed: ${response.status}`);
    }

    const payload = (await response.json()) as SupabaseAdminUsersResponse | SupabaseUserResponse[];
    const users = Array.isArray(payload) ? payload : payload.users ?? [];
    const user = users.find((item) => {
      const email = item.email?.toLowerCase() ?? '';
      const username = item.user_metadata?.username?.toLowerCase() ?? '';
      return email === normalized || username === normalized;
    });

    if (!user?.id) return null;
    return {
      id: user.id,
      email: user.email ?? '',
      username: user.user_metadata?.username ?? '',
      displayName: user.user_metadata?.display_name ?? '',
      role: this.resolveRole(user),
    };
  }

  async listCoachAthletes(coach: AppUserIdentity): Promise<CoachAthleteSummary[]> {
    if (!this.isPersistenceReady()) {
      return [];
    }

    const response = await fetch(
      `${this.url}/rest/v1/coach_athletes?coach_id=eq.${encodeURIComponent(coach.id)}&select=athlete_id,status,created_at`,
      { headers: this.serviceHeaders() },
    );

    if (!response.ok) {
      throw new Error(`Supabase coach athletes read failed: ${response.status}`);
    }

    const rows = (await response.json()) as CoachAthleteRow[];
    const athletes = await Promise.all(rows.map((row) => this.findUserById(row.athlete_id)));

    return rows.map((row, index) => ({
      athleteId: row.athlete_id,
      email: athletes[index]?.email ?? '',
      username: athletes[index]?.username ?? '',
      displayName: athletes[index]?.displayName ?? '',
      status: row.status ?? 'active',
      linkedAt: row.created_at,
    }));
  }

  async createCoachInvite(coach: AppUserIdentity, input: CoachInviteInput): Promise<CoachInvite> {
    if (!this.isPersistenceReady()) {
      throw new Error('Persistencia indisponivel para criar convite.');
    }

    const email = input.email.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      throw new Error('Email do atleta invalido.');
    }

    const token = randomUUID();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 1000 * 60 * 60 * 24 * 7);

    const response = await fetch(`${this.url}/rest/v1/coach_invites`, {
      method: 'POST',
      headers: {
        ...this.serviceHeaders(),
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({
        coach_id: coach.id,
        email,
        token,
        status: 'pending',
        created_at: createdAt.toISOString(),
        expires_at: expiresAt.toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Supabase coach invite create failed: ${response.status}`);
    }

    const rows = (await response.json()) as CoachInviteRow[];
    const row = rows[0];
    return {
      id: row.id,
      coachId: row.coach_id,
      email: row.email,
      token: row.token,
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  async assertCoachCanManageAthlete(coach: AppUserIdentity, athleteId: string) {
    if (!this.isPersistenceReady()) {
      throw new Error('Persistencia indisponivel para validar atleta.');
    }

    const response = await fetch(
      `${this.url}/rest/v1/coach_athletes?coach_id=eq.${encodeURIComponent(coach.id)}&athlete_id=eq.${encodeURIComponent(athleteId)}&status=eq.active&select=athlete_id&limit=1`,
      { headers: this.serviceHeaders() },
    );

    if (!response.ok) {
      throw new Error(`Supabase coach athlete validation failed: ${response.status}`);
    }

    const rows = (await response.json()) as Array<{ athlete_id: string }>;
    if (!rows.length) {
      throw new Error('Atleta nao esta vinculado a este coach.');
    }
  }

  private async findUserById(userId: string): Promise<AppUserIdentity | null> {
    if (!this.isPersistenceReady()) {
      return null;
    }

    const response = await fetch(`${this.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      headers: this.serviceHeaders(),
    });

    if (!response.ok) {
      return null;
    }

    const user = (await response.json()) as SupabaseUserResponse;
    if (!user.id) return null;
    return {
      id: user.id,
      email: user.email ?? '',
      username: user.user_metadata?.username ?? '',
      displayName: user.user_metadata?.display_name ?? '',
      role: this.resolveRole(user),
    };
  }

  async identifyUser(authorization: string | undefined) {
    return this.requireUser(authorization);
  }

  async requireUser(authorization: string | undefined) {
    const token = authorization?.replace(/^Bearer\s+/i, '').trim();
    if (!this.url || !this.anonKey || !token) {
      throw new UnauthorizedException('Login necessario. Configure Supabase e informe um token valido.');
    }

    const response = await fetch(`${this.url}/auth/v1/user`, {
      headers: {
        apikey: this.anonKey,
        authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new UnauthorizedException('Sessao invalida.');
    }

    const user = (await response.json()) as SupabaseUserResponse;
    if (!user.id) {
      throw new UnauthorizedException('Sessao invalida.');
    }

    const identity: AppUserIdentity = {
      id: user.id,
      email: user.email ?? '',
      username: user.user_metadata?.username ?? '',
      displayName: user.user_metadata?.display_name ?? '',
      role: this.resolveRole(user),
    };
    return identity;
  }

  private resolveRole(user: SupabaseUserResponse): UserRole {
    const metadataRole = user.app_metadata?.role
      ?? user.app_metadata?.user_role
      ?? user.user_metadata?.role
      ?? user.user_metadata?.user_role;
    if (metadataRole === 'coach') return 'coach';

    const coachEmails = this.csv(process.env.COACH_EMAILS);
    const coachUsernames = this.csv(process.env.COACH_USERNAMES);
    const email = user.email?.toLowerCase() ?? '';
    const username = user.user_metadata?.username?.toLowerCase() ?? '';

    return coachEmails.includes(email) || coachUsernames.includes(username) ? 'coach' : 'user';
  }

  private csv(value: string | undefined) {
    return (value ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }

  private serviceHeaders() {
    return {
      apikey: this.serviceRoleKey,
      authorization: `Bearer ${this.serviceRoleKey}`,
    };
  }

  private isPersistenceReady() {
    return Boolean(this.url && this.anonKey && this.serviceRoleKey);
  }
}
