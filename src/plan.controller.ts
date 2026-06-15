import { Body, Controller, Get, Headers, Put } from '@nestjs/common';
import { PlanService } from './plan.service';
import { SupabaseService } from './supabase.service';
import { TrainingPlan } from './types';

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
}
