export type Role = "Member" | "Coach" | "Administrator";

export interface SessionUser {
  id: number;
  username: string;
  fullName: string;
  roles: Role[];
  hasMemberProfile?: boolean;
}

export interface SessionInfo {
  currentUser: SessionUser;
  hasPin: boolean;
  warmLocked?: boolean;
  sessionSecret?: string | null;
  warmLockMinutes: number;
  sessionTimeoutMinutes: number;
  lastActivityAt?: string;
}

export interface MemberSummary {
  id: number;
  username: string;
  fullName: string;
  phoneMasked: string | null;
  phoneLast4: string | null;
  locationCode: string;
  notes: string | null;
  active: boolean;
  coachUserId: number | null;
  faceConsentStatus: string;
}

export interface CoachSummary {
  id: number;
  username: string;
  fullName: string;
}

export interface RecipientSummary {
  id: number;
  username: string;
  fullName: string;
  roles: string[];
}

export interface ContentPost {
  id: number;
  kind: string;
  title: string;
  body: string;
  locationCode: string;
  authorName: string;
  createdAt: string;
}

export interface AnalyticsBundle {
  viewsByStation: Array<{ stationToken: string; views: number }>;
  topPosts: Array<{ id: number; title: string; views: number }>;
  searchTrends: Array<{ term: string; uses: number }>;
  posts: ContentPost[];
}

export interface DashboardWidget {
  id: string;
  widgetType?: string;
  title?: string;
  locationCode?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DashboardTemplate {
  id: number;
  name: string;
  layout: DashboardWidget[];
  createdAt: string;
}

export interface FaceAuditEntry {
  eventType: string;
  actorName: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface ReportInboxItem {
  id: number;
  reportExportId: number;
  title: string;
  isRead: boolean;
  createdAt: string;
  format: string;
  status: string;
  fileName: string;
}

export interface ReportScheduleSummary {
  id: number;
  templateId: number;
  name: string;
  cronExpression: string;
  exportFormat: "csv" | "excel" | "pdf";
  locationCode: string | null;
  isActive: boolean;
  lastRunAt: string | null;
  createdAt: string;
  subscriberUserIds: number[];
}

export interface AdminConsole {
  metrics: {
    totalLogs: number;
    openAlerts: number;
    uptimeSeconds: number;
    averageRequestDurationMs: number;
    serverErrorRate: number;
    lastReportDurationMs: number;
    lastBackupDurationMs: number;
  };
  recentLogs: Array<{
    category: string;
    level: string;
    message: string;
    createdAt: string;
  }>;
  recentAlerts: Array<{
    alertType: string;
    severity: string;
    message: string;
    createdAt: string;
  }>;
}
