import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { Request, Response } from 'express';
import { AppModule } from '../src/app.module';

let cachedServer: express.Express | undefined;

async function bootstrap(): Promise<express.Express> {
  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    logger: ['error', 'warn', 'log'],
  });

  app.enableCors();
  await app.init();

  return server;
}

export default async function handler(req: Request, res: Response) {
  cachedServer ??= await bootstrap();
  return cachedServer(req, res);
}
