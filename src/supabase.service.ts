import { Injectable, UnauthorizedException } from '@nestjs/common';
import { TrainingPlan } from './types';

interface SupabaseUserResponse {
  id?: string;
  email?: string;
}

export interface StoredPlanRow {
  plan: TrainingPlan;
  updated_at: string;
}

@Injectable()
export class SupabaseService {
  private readonly url = process.env.SUPABASE_URL ?? '';
  private readonly anonKey = process.env.SUPABASE_ANON_KEY ?? '';
  private readonly serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  publicConfig() {
    return {
      authEnabled: Boolean(this.url && this.anonKey),
      supabaseUrl: this.url,
      supabaseAnonKey: this.anonKey,
      persistenceEnabled: Boolean(this.url && this.serviceRoleKey),
    };
  }

  async getUserPlan(authorization: string | undefined) {
    if (!this.isPersistenceReady()) {
      return null;
    }

    const user = await this.requireUser(authorization);
    const response = await fetch(
      `${this.url}/rest/v1/training_plans?user_id=eq.${encodeURIComponent(user.id)}&select=plan,updated_at&limit=1`,
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
    if (!this.isPersistenceReady()) {
      return { saved: false, reason: 'supabase_not_configured' };
    }

    const user = await this.requireUser(authorization);
    const response = await fetch(`${this.url}/rest/v1/training_plans?on_conflict=user_id`, {
      method: 'POST',
      headers: {
        ...this.serviceHeaders(),
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        user_id: user.id,
        plan,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Supabase save failed: ${response.status}`);
    }

    return { saved: true };
  }

  private async requireUser(authorization: string | undefined) {
    const token = authorization?.replace(/^Bearer\s+/i, '').trim();
    if (!this.url || !this.anonKey || !token) {
      throw new UnauthorizedException('Login necessario.');
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

    return { id: user.id, email: user.email ?? '' };
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
