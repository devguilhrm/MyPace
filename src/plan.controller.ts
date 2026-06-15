import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Post, Put } from '@nestjs/common';
import { PlanService } from './plan.service';
import { SupabaseService } from './supabase.service';
import { CoachInviteInput, CoachWorkoutInput, TrainingPlan } from './types';

@Controller('api')
export class PlanController {
  constructor(
    private readonly planService: PlanService,
    private readonly supabaseService: SupabaseService,
  ) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      app: 'mypace',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('plan')
  async getPlan(@Headers('authorization') authorization?: string) {
    const user = await this.supabaseService.identifyUser(authorization);
    return this.planService.getPlanForUser(user);
  }

  @Get('config')
  getConfig() {
    return this.supabaseService.publicConfig();
  }

  @Get('me')
  getMe(@Headers('authorization') authorization?: string) {
    return this.supabaseService.requireUser(authorization);
  }

  @Get('user-plan')
  getUserPlan(@Headers('authorization') authorization?: string) {
    return this.supabaseService.getUserPlan(authorization);
  }

  @Put('user-plan')
  saveUserPlan(
    @Headers('authorization') authorization: string | undefined,
    @Body() plan: TrainingPlan,
  ) {
    return this.supabaseService.saveUserPlan(authorization, plan);
  }

  @Get('coach/athletes')
  async listCoachAthletes(@Headers('authorization') authorization?: string) {
    const coach = await this.requireCoach(authorization);
    return {
      athletes: await this.supabaseService.listCoachAthletes(coach),
    };
  }

  @Post('coach/invites')
  async createCoachInvite(
    @Headers('authorization') authorization: string | undefined,
    @Body() input: CoachInviteInput,
  ) {
    const coach = await this.requireCoach(authorization);
    try {
      const invite = await this.supabaseService.createCoachInvite(coach, input);
      return {
        invite,
        inviteUrl: `/login?invite=${encodeURIComponent(invite.token)}`,
      };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Nao foi possivel criar convite.');
    }
  }

  @Post('coach/workouts')
  async addCoachWorkout(
    @Headers('authorization') authorization: string | undefined,
    @Body() input: CoachWorkoutInput,
  ) {
    const coach = await this.requireCoach(authorization);
    const athlete = await this.supabaseService.findUserByHandle(input.athlete);
    if (!athlete) {
      throw new BadRequestException('Atleta nao encontrado. Use username ou email cadastrado.');
    }

    try {
      await this.supabaseService.assertCoachCanManageAthlete(coach, athlete.id);
      const stored = await this.supabaseService.getUserPlanByUserId(athlete.id);
      const basePlan = stored?.plan?.weeks?.length
        ? stored.plan
        : this.planService.getPlanForUser(athlete);
      const plan = this.planService.addCoachWorkout(basePlan, athlete, coach, input);
      await this.supabaseService.saveUserPlanByUserId(athlete.id, plan);
      return {
        saved: true,
        athlete: {
          id: athlete.id,
          username: athlete.username,
          email: athlete.email,
          displayName: athlete.displayName,
        },
      };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Nao foi possivel criar treino.');
    }
  }

  private async requireCoach(authorization: string | undefined) {
    const coach = await this.supabaseService.requireUser(authorization);
    if (coach.role !== 'coach') {
      throw new ForbiddenException('Apenas coaches podem acessar recursos de coach.');
    }
    return coach;
  }
}
