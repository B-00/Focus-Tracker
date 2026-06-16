import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodSchema, ZodError } from 'zod';

/// Validate a request body against a Zod schema, mapping failures to
/// `400 { error: 'validation_failed', details: [...] }`.
///
/// Usage:
///
///   @Post('login')
///   login(@Body(new ZodBodyPipe(loginRequestSchema)) body: LoginRequest) {
///     ...
///   }
///
/// Used instead of class-validator DTOs for the auth + telemetry surfaces
/// where the canonical schema lives in `@focus-tracker/shared` as Zod.
export class ZodBodyPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        error: 'validation_failed',
        details: this.formatZodError(result.error),
      });
    }
    return result.data;
  }

  private formatZodError(err: ZodError): Array<{ path: string; message: string }> {
    return err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
  }
}
