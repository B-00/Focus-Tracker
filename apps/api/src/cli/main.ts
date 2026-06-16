import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { CliModule } from './cli.module';

/// Entry point for `pnpm api:<command>` scripts. Bootstraps a minimal Nest
/// context (no HTTP server) and dispatches to the right command class based
/// on argv.
async function bootstrap(): Promise<void> {
  await CommandFactory.run(CliModule, {
    logger: ['warn', 'error'],
    errorHandler: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`\nCLI error: ${message}\n`);
      process.exit(1);
    },
  });
}

bootstrap();
