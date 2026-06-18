import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type {
  ApiKeyAuthenticatedRequest,
  ApiKeyRequestContext,
} from '../../auth/api-key-auth.guard';

/// Pulls the API-key auth context populated by `ApiKeyAuthGuard`.
/// Symmetric counterpart to `@CurrentUser()` (which exposes the JWT context).
///
/// Usage:
///
///   @UseGuards(ApiKeyAuthGuard)
///   @Post('batch')
///   ingest(
///     @CurrentApiClient() client: ApiKeyRequestContext,
///     @Body(...) batch: TelemetryBatch,
///   ) { ... }
///
/// Throws if used on a route that isn't guarded by ApiKeyAuthGuard —
/// surfaces wiring mistakes loudly rather than passing `undefined`.
export const CurrentApiClient = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ApiKeyRequestContext => {
    const req = ctx.switchToHttp().getRequest<ApiKeyAuthenticatedRequest>();
    if (!req.apiClient) {
      throw new Error(
        'CurrentApiClient used on a route without ApiKeyAuthGuard — req.apiClient is not populated.',
      );
    }
    return req.apiClient;
  },
);
