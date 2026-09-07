import { SessionIdentity } from '../models/domain.types.js';

declare global {
  namespace Express {
    interface Request {
      session?: SessionIdentity;
    }
  }
}

export {};
