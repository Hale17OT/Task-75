import type {
  AdminConsole,
  AnalyticsBundle,
  CoachSummary,
  ContentPost,
  DashboardTemplate,
  DashboardWidget,
  FaceAuditEntry,
  MemberSummary,
  RecipientSummary,
  ReportInboxItem,
  ReportScheduleSummary,
  RestoreSessionResponse,
  SessionInfo
} from "../types";

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL ||
  `${window.location.protocol}//${window.location.hostname}:3000`;

const sha256Hex = async (input: string) => {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
};

const hmacHex = async (secret: string, payload: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(secret), (char) => char.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));

  return Array.from(new Uint8Array(signature))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
};

const buildPayload = async (method: string, path: string, timestamp: string, nonce: string, body?: unknown) => {
  const bodyHash = await sha256Hex(body ? JSON.stringify(body) : "");
  return [method.toUpperCase(), path, timestamp, nonce, bodyHash].join("\n");
};

const parseResponse = async <T>(response: Response) => {
  const payload = (await response.json()) as {
    ok: boolean;
    data?: T;
    error?: { code: string; message: string };
  };

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error?.message ?? `Request failed with status ${response.status}`);
  }

  return payload.data as T;
};

export const createApiClient = (getSessionSecret: () => string | null, getStationToken: () => string) => {
  const buildHeaders = async (
    method: string,
    path: string,
    body?: unknown,
    options?: { unsigned?: boolean; contentType?: string | null }
  ) => {
    const headers: Record<string, string> = {
      "x-station-token": getStationToken()
    };

    if (options?.contentType !== null) {
      headers["Content-Type"] = options?.contentType ?? "application/json";
    }

    if (!options?.unsigned) {
      const sessionSecret = getSessionSecret();
      if (!sessionSecret) {
        throw new Error("Signed session secret is not available");
      }

      const timestamp = new Date().toISOString();
      const nonce = crypto.randomUUID();
      const payload = await buildPayload(method, path, timestamp, nonce, body);
      headers["x-sf-timestamp"] = timestamp;
      headers["x-sf-nonce"] = nonce;
      headers["x-sf-signature"] = await hmacHex(sessionSecret, payload);
    }

    return headers;
  };

  const signedRequest = async <T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { unsigned?: boolean }
  ) => {
    const headers = await buildHeaders(method, path, body, options);

    const response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      credentials: "include",
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    return parseResponse<T>(response);
  };

  const signedBlobRequest = async (
    method: string,
    path: string,
    body?: unknown,
    options?: { unsigned?: boolean }
  ) => {
    const headers = await buildHeaders(method, path, body, {
      ...options,
      contentType: body ? "application/json" : null
    });
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      credentials: "include",
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null) as
        | { error?: { message?: string } }
        | null;
      throw new Error(payload?.error?.message ?? `Request failed with status ${response.status}`);
    }

    return {
      blob: await response.blob(),
      fileName:
        response.headers.get("content-disposition")?.match(/filename=\"?([^\";]+)\"?/)?.[1] ??
        "download.bin"
    };
  };

  return {
    getBootstrapStatus: () =>
      signedRequest<{ requiresBootstrap: boolean }>("GET", "/api/auth/bootstrap/status", undefined, {
        unsigned: true
      }),
    restoreSession: () =>
      signedRequest<RestoreSessionResponse>(
        "POST",
        "/api/auth/restore",
        undefined,
        { unsigned: true }
      ),
    bootstrapAdministrator: (body: { username: string; fullName: string; password: string }) =>
      signedRequest<{ currentUser: SessionInfo["currentUser"]; sessionSecret: string; hasPin: boolean; warmLockMinutes: number; sessionTimeoutMinutes: number }>(
        "POST",
        "/api/auth/bootstrap/admin",
        body,
        { unsigned: true }
      ),
    login: (body: { username: string; password: string }) =>
      signedRequest<{ currentUser: SessionInfo["currentUser"]; sessionSecret: string; hasPin: boolean; warmLockMinutes: number; sessionTimeoutMinutes: number }>(
        "POST",
        "/api/auth/login",
        body,
        { unsigned: true }
      ),
    getSession: () =>
      signedRequest<{ session: SessionInfo | null }>("GET", "/api/auth/session"),
    getSelfProfile: () => signedRequest<{ member: MemberSummary }>("GET", "/api/self/profile"),
    setOwnFaceConsent: (consentStatus: "granted" | "declined") =>
      signedRequest<{ member: MemberSummary }>("POST", "/api/self/consent/face", { consentStatus }),
    setupPin: (pin: string) => signedRequest<{ hasPin: boolean }>("POST", "/api/auth/pin/setup", { pin }),
    pinReenter: (body: { username: string; pin: string }) =>
      signedRequest<{ currentUser: SessionInfo["currentUser"]; sessionSecret: string; hasPin: boolean; warmLockMinutes: number; sessionTimeoutMinutes: number }>(
        "POST",
        "/api/auth/pin/reenter",
        body,
        { unsigned: true }
      ),
    warmLock: () => signedRequest<{ warmLocked: boolean }>("POST", "/api/auth/warm-lock"),
    logout: () => signedRequest<{ loggedOut: boolean }>("POST", "/api/auth/logout"),
    listMembers: () =>
      signedRequest<{ members: MemberSummary[]; coaches: CoachSummary[] }>("GET", "/api/members"),
    createMember: (body: Record<string, unknown>) =>
      signedRequest<{ member: MemberSummary }>("POST", "/api/members", body),
    assignCoach: (memberId: number, coachUserId: number) =>
      signedRequest<{ member: MemberSummary }>("POST", `/api/members/${memberId}/coach-assignment`, {
        coachUserId
      }),
    setFaceConsent: (memberId: number, consentStatus: "granted" | "declined") =>
      signedRequest<{ member: MemberSummary }>("POST", `/api/members/${memberId}/consent/face`, {
        consentStatus
      }),
    startFaceChallenge: (memberUserId: number) =>
      signedRequest<{ challenge: { challengeId: string; issuedAt: string; expiresAt: string; minDelayMs: number; maxDelayMs: number } }>(
        "POST",
        "/api/faces/challenge",
        { memberUserId }
      ),
    dedupCheck: (body: Record<string, unknown>) =>
      signedRequest<{ dedup: { duplicateWarning: Record<string, unknown> | null; warningDetected: boolean } }>(
        "POST",
        "/api/faces/dedup-check",
        body
      ),
    enrollFace: (body: Record<string, unknown>) =>
      signedRequest<{ result: Record<string, unknown> }>("POST", "/api/faces/enroll", body),
    deactivateFace: (faceRecordId: number) =>
      signedRequest<{ deactivated: boolean }>("PATCH", `/api/faces/${faceRecordId}/deactivate`),
    getFaceHistory: (memberUserId: number) =>
      signedRequest<{ history: Array<Record<string, unknown>> }>("GET", `/api/faces/history/${memberUserId}`),
    getFaceAuditTrail: (memberUserId: number) =>
      signedRequest<{ auditTrail: FaceAuditEntry[] }>("GET", `/api/faces/audit/${memberUserId}`),
    createPost: (body: Record<string, unknown>) =>
      signedRequest<{ post: ContentPost }>("POST", "/api/content/posts", body),
    listPosts: () => signedRequest<{ posts: ContentPost[] }>("GET", "/api/content/posts"),
    recordView: (postId: number, locationCode: string) =>
      signedRequest<{ recorded: boolean }>("POST", "/api/content/views", { postId, locationCode }),
    recordSearch: (searchTerm: string, locationCode: string) =>
      signedRequest<{ recorded: boolean }>("POST", "/api/content/search-events", { searchTerm, locationCode }),
    analytics: (query: URLSearchParams) =>
      signedRequest<{ analytics: AnalyticsBundle }>("GET", `/api/content/analytics?${query.toString()}`),
    getDashboard: () =>
      signedRequest<{ layout: DashboardWidget[]; templates: DashboardTemplate[] }>("GET", "/api/dashboards/me"),
    saveDashboard: (layout: DashboardWidget[]) =>
      signedRequest<{ layout: DashboardWidget[] }>("PUT", "/api/dashboards/me", { layout }),
    createTemplate: (name: string, layout: DashboardWidget[]) =>
      signedRequest<{ template: DashboardTemplate }>("POST", "/api/dashboards/templates", { name, layout }),
    listSchedules: () => signedRequest<{ schedules: ReportScheduleSummary[] }>("GET", "/api/reports/schedules"),
    listRecipients: () => signedRequest<{ recipients: RecipientSummary[] }>("GET", "/api/reports/recipients"),
    createSchedule: (body: Record<string, unknown>) =>
      signedRequest<{ schedule: Record<string, unknown> }>("POST", "/api/reports/schedules", body),
    generateReport: (body: Record<string, unknown>) =>
      signedRequest<{ report: Record<string, unknown> }>("POST", "/api/reports/generate", body),
    getInbox: () => signedRequest<{ inbox: ReportInboxItem[] }>("GET", "/api/reports/inbox"),
    downloadInboxItem: (id: number) => signedBlobRequest("GET", `/api/reports/inbox/${id}/download`),
    getAdminConsole: () => signedRequest<{ console: AdminConsole }>("GET", "/api/admin/console"),
    createBackup: () => signedRequest<{ backup: Record<string, unknown> }>("POST", "/api/admin/backups"),
    dryRunRestore: (backupRunId: number) =>
      signedRequest<{ recovery: Record<string, unknown> }>("POST", "/api/admin/recovery/dry-run", {
        backupRunId
      })
  };
};
