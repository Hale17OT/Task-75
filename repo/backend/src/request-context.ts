import type { AuthenticatedUser, SessionRecord } from "./types.js";

declare global {
  namespace Express {
    interface Request {
      currentUser?: AuthenticatedUser;
      currentSession?: SessionRecord;
      stationToken?: string | null;
      requestId?: string;
    }
  }
}

export {};

