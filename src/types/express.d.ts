import type { AuthUser, LocalUser } from './auth.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      localUser?: LocalUser;
    }
  }
}

export {};
