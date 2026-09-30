import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** Hachage Argon2id des mots de passe et PIN (§3.2). */
@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | null = null;

  hash(secret: string): Promise<string> {
    return argon2.hash(secret, OPTIONS);
  }

  async verify(hash: string | null | undefined, secret: string): Promise<boolean> {
    if (!hash) {
      // Temps de réponse constant même si l'utilisateur n'existe pas.
      this.dummyHash ??= argon2.hash('dummy-password-for-timing', OPTIONS);
      await argon2.verify(await this.dummyHash, secret).catch(() => false);
      return false;
    }
    try {
      return await argon2.verify(hash, secret);
    } catch {
      return false;
    }
  }
}
