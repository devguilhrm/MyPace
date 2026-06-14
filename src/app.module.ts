import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';
import { SupabaseService } from './supabase.service';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
      exclude: ['/api{/*path}'],
    }),
  ],
  controllers: [PlanController],
  providers: [PlanService, SupabaseService],
})
export class AppModule {}
