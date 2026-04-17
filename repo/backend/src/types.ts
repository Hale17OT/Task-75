export const roles = ["Member", "Coach", "Administrator"] as const;

export type Role = (typeof roles)[number];

export interface AuthenticatedUser {
  id: number;
  username: string;
  fullName: string;
  roles: Role[];
  hasMemberProfile?: boolean;
}

export interface AppErrorShape {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface SessionRecord {
  id: number;
  userId: number;
  sessionToken: string;
  sessionSecret: string;
  sessionSecretKeyId: string;
  stationToken: string;
  workstationBindingHash: string | null;
  warmLockedAt: Date | null;
  lastActivityAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
}
