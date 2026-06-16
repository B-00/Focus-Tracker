import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';

/// Wraps argon2 with our chosen parameters and a stable surface.
///
/// Parameters per Auth.md §7.1 — tuned for ~250ms per hash on a modern
/// machine. They live ONLY here so re-tuning is a single-file change; argon2
/// embeds the params into the stored hash string, so existing hashes remain
/// verifiable when params change.
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  timeCost: 3,
  memoryCost: 65536, // 64 MiB
  parallelism: 4,
  hashLength: 32,
};

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, ARGON2_OPTIONS);
  }

  /// Returns true iff the plaintext matches the stored hash. Defensive: if
  /// the stored hash is malformed (e.g. legacy / corrupted row), returns
  /// false instead of throwing so login still produces `invalid_credentials`
  /// rather than a 500.
  async verify(storedHash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(storedHash, plaintext);
    } catch (err) {
      this.logger.warn(
        `argon2.verify threw — treating as failed login. Stored hash may be malformed. ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  /// If true, the caller should re-hash the password with current params and
  /// persist the new hash. Cheap to call on every login (Auth.md §7.3).
  needsRehash(storedHash: string): boolean {
    return argon2.needsRehash(storedHash, ARGON2_OPTIONS);
  }
}
