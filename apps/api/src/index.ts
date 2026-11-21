import 'reflect-metadata';
import { AppModule } from './app.module';

let handlerPromise: Promise<(event: any, context: any) => Promise<any>> | undefined;
export async function handler(event: unknown, context: unknown) {
  handlerPromise ??= import('@ycforge/nestjs-connector')
    .then(({ createYandexHandler }) => createYandexHandler(AppModule))
    .catch((error) => { handlerPromise = undefined; throw error; });
  return (await handlerPromise)(event as never, context as never);
}
