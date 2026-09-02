import { AuthContext } from '../services/authService';
import { Validated } from '../middleware/validate';

declare global {
  namespace Express {
    interface Request {
      /** Populated by requireAuth from a fresh DB read — never trust stale JWT claims for this. */
      user?: AuthContext;
      /** Populated by the `validate` middleware — coerced/defaulted body+query+params. */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      validated?: Validated<any, any, any>;
    }
  }
}

export {};
