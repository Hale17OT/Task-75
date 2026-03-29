import { nextTick } from "vue";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAdminConsole } from "../src/composables/useAdminConsole";
import { useContentAnalytics } from "../src/composables/useContentAnalytics";
import { useDashboardsReports } from "../src/composables/useDashboardsReports";
import { useFaceOps } from "../src/composables/useFaceOps";
import { useMembers } from "../src/composables/useMembers";
import type { useAuthStore } from "../src/stores/auth";

const createAuth = () => {
  const api = {
    listMembers: vi.fn(),
    getSelfProfile: vi.fn(),
    startFaceChallenge: vi.fn(),
    createMember: vi.fn(),
    assignCoach: vi.fn(),
    setFaceConsent: vi.fn(),
    setOwnFaceConsent: vi.fn(),
    dedupCheck: vi.fn(),
    getFaceHistory: vi.fn(),
    getFaceAuditTrail: vi.fn(),
    enrollFace: vi.fn(),
    deactivateFace: vi.fn(),
    listPosts: vi.fn(),
    analytics: vi.fn(),
    createPost: vi.fn(),
    recordView: vi.fn(),
    recordSearch: vi.fn(),
    getDashboard: vi.fn(),
    saveDashboard: vi.fn(),
    createTemplate: vi.fn(),
    listSchedules: vi.fn(),
    getInbox: vi.fn(),
    listRecipients: vi.fn(),
    createSchedule: vi.fn(),
    generateReport: vi.fn(),
    downloadInboxItem: vi.fn(),
    getAdminConsole: vi.fn(),
    createBackup: vi.fn(),
    dryRunRestore: vi.fn()
  };

  return {
    auth: {
      api: () => api
    } as unknown as ReturnType<typeof useAuthStore>,
    api
  };
};

describe("frontend composables", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("covers member workflows through the members composable", async () => {
    const { auth, api } = createAuth();
    const setFeedback = vi.fn();
    api.listMembers
      .mockResolvedValueOnce({
        members: [{ id: 1, username: "member", fullName: "Member", phoneMasked: null, phoneLast4: null, locationCode: "HQ", notes: null, active: true, coachUserId: null, faceConsentStatus: "unknown" }],
        coaches: [{ id: 2, username: "coach", fullName: "Coach Carter" }]
      })
      .mockResolvedValueOnce({
        members: [{ id: 1, username: "member", fullName: "Member", phoneMasked: null, phoneLast4: null, locationCode: "HQ", notes: null, active: true, coachUserId: 2, faceConsentStatus: "granted" }],
        coaches: [{ id: 2, username: "coach", fullName: "Coach Carter" }]
      })
      .mockResolvedValueOnce({
        members: [{ id: 1, username: "member", fullName: "Member", phoneMasked: null, phoneLast4: null, locationCode: "HQ", notes: null, active: true, coachUserId: 2, faceConsentStatus: "granted" }],
        coaches: [{ id: 2, username: "coach", fullName: "Coach Carter" }]
      });
    api.getSelfProfile.mockResolvedValue({ member: { id: 1, username: "member", fullName: "Member", phoneMasked: null, phoneLast4: null, locationCode: "HQ", notes: null, active: true, coachUserId: null, faceConsentStatus: "unknown" } });
    api.createMember.mockResolvedValue({});
    api.assignCoach.mockResolvedValue({});
    api.setFaceConsent.mockResolvedValue({});
    api.setOwnFaceConsent.mockResolvedValue({ member: { id: 1, username: "member", fullName: "Member", phoneMasked: null, phoneLast4: null, locationCode: "HQ", notes: null, active: true, coachUserId: null, faceConsentStatus: "granted" } });

    const composable = useMembers(auth, setFeedback);
    composable.membersState.form.username = "member";
    composable.membersState.form.fullName = "Member";
    composable.membersState.form.password = "Member12345!X";

    await composable.loadMembers();
    await composable.loadSelf();
    await composable.handleCreateMember();
    await composable.handleAssignCoach(1, 2);
    await composable.handleMemberConsent(1, "granted");
    await composable.handleOwnConsent("granted");

    expect(api.createMember).toHaveBeenCalled();
    expect(composable.membersState.form.password).toBe("");
    expect(composable.memberSelf.value?.faceConsentStatus).toBe("granted");
  });

  it("resets member state and prevents duplicate member submissions", async () => {
    const { auth, api } = createAuth();
    const setFeedback = vi.fn();
    let releaseCreate: () => void = () => {};
    api.createMember.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseCreate = () => resolve({});
        })
    );
    api.listMembers.mockResolvedValue({ members: [], coaches: [] });

    const composable = useMembers(auth, setFeedback);
    composable.membersState.form.username = "member";
    composable.membersState.form.fullName = "Member";
    composable.membersState.form.password = "Member12345!X";

    const first = composable.handleCreateMember();
    const second = composable.handleCreateMember();
    expect(api.createMember).toHaveBeenCalledTimes(1);
    releaseCreate();
    await first;
    await second;

    composable.membersState.members = [{ id: 1, username: "u", fullName: "f", phoneMasked: null, phoneLast4: null, locationCode: "HQ", notes: null, active: true, coachUserId: null, faceConsentStatus: "unknown" }];
    composable.memberSelf.value = { id: 1, username: "u", fullName: "f", phoneMasked: null, phoneLast4: null, locationCode: "HQ", notes: null, active: true, coachUserId: null, faceConsentStatus: "unknown" };
    composable.resetMembersState();
    expect(composable.membersState.members).toEqual([]);
    expect(composable.memberSelf.value).toBeNull();
  });

  it("covers member error handling branches", async () => {
    const { auth, api } = createAuth();
    const setFeedback = vi.fn();
    api.getSelfProfile.mockRejectedValue(new Error("profile missing"));
    api.createMember.mockRejectedValue(new Error("create failed"));
    api.assignCoach.mockRejectedValue(new Error("assign failed"));
    api.setFaceConsent.mockRejectedValue(new Error("consent failed"));
    api.setOwnFaceConsent.mockRejectedValue(new Error("self consent failed"));

    const composable = useMembers(auth, setFeedback);
    composable.membersState.form.password = "Member12345!X";
    await composable.loadSelf();
    await composable.handleCreateMember();
    await composable.handleAssignCoach(1, 2);
    await composable.handleMemberConsent(1, "declined");
    await composable.handleOwnConsent("declined");

    expect(composable.memberSelf.value).toBeNull();
    expect(setFeedback).toHaveBeenCalledWith({ error: "create failed" });
    expect(setFeedback).toHaveBeenCalledWith({ error: "assign failed" });
    expect(setFeedback).toHaveBeenCalledWith({ error: "consent failed" });
    expect(setFeedback).toHaveBeenCalledWith({ error: "self consent failed" });
  });

  it("covers face workflows including explicit import source handling", async () => {
    const { auth, api } = createAuth();
    const setFeedback = vi.fn();
    api.getFaceHistory.mockResolvedValue({ history: [{ faceRecordId: 7, versionNumber: 1, status: "active" }] });
    api.getFaceAuditTrail.mockResolvedValue({ auditTrail: [{ eventType: "face_enrolled", actorName: "Coach", details: {}, createdAt: "2026-03-28T00:00:00.000Z" }] });
    api.startFaceChallenge.mockResolvedValue({ challenge: { challengeId: "challenge-1", issuedAt: "2026-03-28T10:00:00.000Z", expiresAt: "2026-03-28T10:00:30.000Z", minDelayMs: 1000, maxDelayMs: 30000 } });
    api.dedupCheck.mockResolvedValue({ dedup: { duplicateWarning: { memberUserId: 88, similarity: 1 }, warningDetected: true } });
    api.enrollFace.mockResolvedValue({ result: { duplicateWarning: false, blurScore: 20, livenessScore: 0.9 } });
    api.deactivateFace.mockResolvedValue({});

    const composable = useFaceOps(auth, setFeedback);
    composable.faceState.selectedMemberId = 3;
    composable.faceState.centerImageBase64 = "data:image/png;base64,aaa";
    composable.faceState.turnImageBase64 = "data:image/png;base64,bbb";
    composable.faceState.centerSourceType = "import";
    composable.faceState.turnSourceType = "import";
    composable.faceState.centerAnnotation = { faceBox: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 }, landmarks: { leftEye: { x: 0.3, y: 0.3 }, rightEye: { x: 0.6, y: 0.3 }, nose: { x: 0.45, y: 0.5 } } };
    composable.faceState.turnAnnotation = { faceBox: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 }, landmarks: { leftEye: { x: 0.28, y: 0.3 }, rightEye: { x: 0.58, y: 0.3 }, nose: { x: 0.55, y: 0.5 } } };

    await composable.loadFaceHistory();
    await nextTick();
    await Promise.resolve();
    await composable.handleEnrollFace();
    await composable.handleDeactivateFace(7);

    expect(api.startFaceChallenge).toHaveBeenCalledWith(3);
    expect(api.dedupCheck).toHaveBeenCalled();
    expect(composable.faceState.dedupPreview).toEqual({ memberUserId: 88, similarity: 1 });
    expect(composable.faceState.challengeId).toBeNull();
    expect(api.enrollFace).toHaveBeenCalledWith(expect.objectContaining({ sourceType: "import" }));
    expect(composable.faceState.history).toHaveLength(1);
  });

  it("covers face validation and empty-history branches", async () => {
    const { auth, api } = createAuth();
    const setFeedback = vi.fn();
    api.enrollFace.mockRejectedValue(new Error("should not run"));
    api.deactivateFace.mockRejectedValue(new Error("deactivate failed"));

    const composable = useFaceOps(auth, setFeedback);
    await composable.loadFaceHistory();
    await composable.handleEnrollFace();
    await composable.handleDeactivateFace(5);

    expect(composable.faceState.history).toEqual([]);
    expect(setFeedback).toHaveBeenCalledWith({ error: "Capture the center image, start the timed challenge, and complete the head-turn capture before submission" });
    expect(setFeedback).toHaveBeenCalledWith({ error: "deactivate failed" });
  });

  it("covers content publishing, analytics refresh, search capture, and drilldowns", async () => {
    const { auth, api } = createAuth();
    const setFeedback = vi.fn();
    api.listPosts.mockResolvedValue({
      posts: [{ id: 4, kind: "tip", title: "Mobility", body: "Longer mobility body", locationCode: "HQ", authorName: "Coach", createdAt: "2026-03-28T00:00:00.000Z" }]
    });
    api.analytics.mockResolvedValue({
      analytics: {
        viewsByStation: [{ stationToken: "Desk-A", views: 3 }],
        topPosts: [{ title: "Mobility", views: 3 }],
        searchTrends: [{ term: "mobility", uses: 2 }]
      }
    });
    api.createPost.mockResolvedValue({});
    api.recordView.mockResolvedValue({});
    api.recordSearch.mockResolvedValue({});

    const composable = useContentAnalytics(auth, setFeedback);
    composable.contentState.postForm.title = "Mobility";
    composable.contentState.postForm.body = "Longer mobility body";
    composable.contentState.searchTerm = "mobility";
    composable.contentState.filters.startDateText = "03/28/2026";
    composable.contentState.filters.endDateText = "03/28/2026";

    await composable.loadContent();
    await composable.loadAnalytics();
    await composable.handleCreatePost();
    await composable.handleViewPost(4, "HQ");
    await composable.handleSearchContent();
    await composable.handleRefreshAnalytics();
    composable.selectStationDrilldown(0);
    composable.selectPostDrilldown(0);
    composable.selectSearchDrilldown(0);

    expect(api.recordView).toHaveBeenCalledWith(4, "HQ");
    expect(composable.analyticsDrilldown.rows.length).toBeGreaterThan(0);
  });

  it("covers analytics validation and empty-search branches", async () => {
    const { auth } = createAuth();
    const setFeedback = vi.fn();
    const composable = useContentAnalytics(auth, setFeedback);
    composable.contentState.filters.startDateText = "bad-date";

    await composable.handleRefreshAnalytics();
    composable.contentState.filters.startDateText = "03/28/2026";
    composable.contentState.filters.endDateText = "bad-date";
    await composable.handleRefreshAnalytics();
    composable.contentState.searchTerm = "";
    await composable.handleSearchContent();
    composable.selectStationDrilldown(99);
    composable.selectPostDrilldown(99);
    composable.selectSearchDrilldown(99);

    expect(setFeedback).toHaveBeenCalledWith({ error: "Start date must use MM/DD/YYYY" });
    expect(setFeedback).toHaveBeenCalledWith({ error: "End date must use MM/DD/YYYY" });
    expect(setFeedback).toHaveBeenCalledWith({ error: "Enter a search term before recording an onsite search" });
    expect(composable.analyticsDrilldown.rows).toEqual([]);
  });

  it("resets content state and blocks duplicate in-flight actions", async () => {
    const { auth, api } = createAuth();
    const setFeedback = vi.fn();
    api.listPosts.mockResolvedValue({ posts: [] });
    api.analytics.mockResolvedValue({ analytics: { viewsByStation: [], topPosts: [], searchTrends: [] } });
    let resolvePublish: () => void = () => {};
    api.createPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePublish = () => resolve({});
        })
    );

    const composable = useContentAnalytics(auth, setFeedback);
    composable.contentState.postForm.title = "Tip";
    const firstPublish = composable.handleCreatePost();
    const secondPublish = composable.handleCreatePost();
    expect(api.createPost).toHaveBeenCalledTimes(1);
    resolvePublish();
    await firstPublish;
    await secondPublish;

    composable.contentState.posts = [{ id: 1, kind: "tip", title: "A", body: "B", locationCode: "HQ", authorName: "Coach", createdAt: "2026-03-28T00:00:00.000Z" }];
    composable.contentState.searchTerm = "mobility";
    composable.resetContentState();
    expect(composable.contentState.posts).toEqual([]);
    expect(composable.contentState.searchTerm).toBe("");
    expect(composable.analyticsDrilldown.rows).toEqual([]);
  });

  it("covers dashboard and report flows including widget edits and downloads", async () => {
    const { auth, api } = createAuth();
    auth.currentUser = {
      id: 1,
      username: "admin",
      fullName: "System Administrator",
      roles: ["Administrator"]
    };
    const setFeedback = vi.fn();
    api.getDashboard.mockResolvedValue({
      layout: [{ id: "views-1", widgetType: "viewsByStation", title: "Views", locationCode: "HQ", x: 0, y: 0, width: 6, height: 4 }],
      templates: [{ id: 1, name: "Weekly", layout: [], createdAt: "2026-03-28T00:00:00.000Z" }]
    });
    api.listSchedules.mockResolvedValue({ schedules: [] });
    api.getInbox.mockResolvedValue({ inbox: [] });
    api.listRecipients.mockResolvedValue({ recipients: [{ id: 1, username: "admin", fullName: "Admin", roles: ["Administrator"] }] });
    api.saveDashboard.mockResolvedValue({});
    api.createTemplate.mockResolvedValue({});
    api.createSchedule.mockResolvedValue({ schedule: { id: 1 } });
    api.generateReport.mockResolvedValue({ report: { exportId: 5 } });
    api.downloadInboxItem.mockResolvedValue({ blob: new Blob(["demo"]), fileName: "report.pdf" });

    Object.defineProperty(URL, "createObjectURL", {
      writable: true,
      value: vi.fn(() => "blob:test")
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      writable: true,
      value: vi.fn()
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const composable = useDashboardsReports(auth, setFeedback);
    await composable.loadReports();
    expect(api.getDashboard).toHaveBeenCalledTimes(1);
    expect(composable.reportsState.templateId).toBe(1);
    composable.addWidget("searchTrends", "Search trends");
    composable.moveWidget(1, 0);
    composable.updateWidgetTitle(composable.dashboardState.layout[0].id, "Updated");
    composable.removeWidget(composable.dashboardState.layout[1].id);
    composable.dashboardState.templateName = "Operations";
    composable.reportsState.subscriberUserIds = [1];
    await composable.handleSaveDashboard();
    await composable.handleCreateTemplate();
    await composable.handleCreateSchedule();
    await composable.handleGenerateReport();
    await composable.downloadInboxItem(5);

    expect(api.saveDashboard).toHaveBeenCalled();
    expect(api.generateReport).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("resets dashboard/report state and blocks duplicate generation while in-flight", async () => {
    const { auth, api } = createAuth();
    auth.currentUser = {
      id: 1,
      username: "admin",
      fullName: "System Administrator",
      roles: ["Administrator"]
    };
    const setFeedback = vi.fn();
    api.getInbox.mockResolvedValue({ inbox: [] });
    api.listSchedules.mockResolvedValue({ schedules: [] });
    api.listRecipients.mockResolvedValue({ recipients: [] });
    api.getDashboard.mockResolvedValue({ layout: [], templates: [{ id: 7, name: "T", layout: [], createdAt: "2026-03-28T00:00:00.000Z" }] });
    let resolveGenerate: () => void = () => {};
    api.generateReport.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGenerate = () => resolve({ report: { exportId: 7 } });
        })
    );

    const composable = useDashboardsReports(auth, setFeedback);
    await composable.loadReports();
    const first = composable.handleGenerateReport();
    const second = composable.handleGenerateReport();
    expect(api.generateReport).toHaveBeenCalledTimes(1);
    resolveGenerate();
    await first;
    await second;

    composable.dashboardState.layout = [{ id: "x", widgetType: "viewsByStation", title: "X", x: 0, y: 0, width: 6, height: 4 }];
    composable.reportsState.inbox = [{ id: 1, reportExportId: 1, title: "R", isRead: false, createdAt: "2026-03-28T00:00:00.000Z", format: "pdf", status: "completed", fileName: "r.pdf" }];
    composable.resetDashboardsReportsState();
    expect(composable.dashboardState.layout).toEqual([]);
    expect(composable.reportsState.inbox).toEqual([]);
  });

  it("loads subscriber inbox without admin-only report metadata calls", async () => {
    const { auth, api } = createAuth();
    auth.currentUser = {
      id: 2,
      username: "coach",
      fullName: "Coach User",
      roles: ["Coach", "Member"]
    };
    const setFeedback = vi.fn();
    api.getInbox.mockResolvedValue({
      inbox: [{ id: 9, reportExportId: 12, title: "Weekly Snapshot (PDF)", isRead: false, createdAt: "2026-03-28T00:00:00.000Z", format: "pdf", status: "completed", fileName: "demo.pdf" }]
    });

    const composable = useDashboardsReports(auth, setFeedback);
    await composable.loadReports();

    expect(api.getInbox).toHaveBeenCalledTimes(1);
    expect(api.listSchedules).not.toHaveBeenCalled();
    expect(api.listRecipients).not.toHaveBeenCalled();
    expect(api.getDashboard).not.toHaveBeenCalled();
    expect(composable.reportsState.inbox).toHaveLength(1);
  });

  it("resets face state and blocks duplicate enroll/deactivate submissions", async () => {
    const { auth, api } = createAuth();
    const setFeedback = vi.fn();
    api.getFaceHistory.mockResolvedValue({ history: [] });
    api.getFaceAuditTrail.mockResolvedValue({ auditTrail: [] });
    let resolveEnroll: () => void = () => {};
    api.enrollFace.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEnroll = () => resolve({ result: { duplicateWarning: false, blurScore: 20, livenessScore: 0.9 } });
        })
    );
    let resolveDeactivate: () => void = () => {};
    api.deactivateFace.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDeactivate = () => resolve({});
        })
    );

    const composable = useFaceOps(auth, setFeedback);
    composable.faceState.selectedMemberId = 1;
    composable.faceState.centerImageBase64 = "data:image/png;base64,a";
    composable.faceState.turnImageBase64 = "data:image/png;base64,b";
    composable.faceState.challengeId = "challenge-1";

    const firstEnroll = composable.handleEnrollFace();
    const secondEnroll = composable.handleEnrollFace();
    expect(api.enrollFace).toHaveBeenCalledTimes(1);
    resolveEnroll();
    await firstEnroll;
    await secondEnroll;

    const firstDeactivate = composable.handleDeactivateFace(8);
    const secondDeactivate = composable.handleDeactivateFace(8);
    expect(api.deactivateFace).toHaveBeenCalledTimes(1);
    resolveDeactivate();
    await firstDeactivate;
    await secondDeactivate;

    composable.resetFaceState();
    expect(composable.faceState.selectedMemberId).toBe(0);
    expect(composable.faceState.history).toEqual([]);
  });

  it("covers admin console backup and dry-run recovery actions", async () => {
    const { auth, api } = createAuth();
    const setFeedback = vi.fn();
    api.getAdminConsole.mockResolvedValue({ console: { metrics: {}, recentLogs: [], recentAlerts: [] } });
    api.createBackup.mockResolvedValue({ backup: { id: 42 } });
    api.dryRunRestore.mockResolvedValue({ recovery: { status: "passed" } });

    const composable = useAdminConsole(auth, setFeedback);
    await composable.loadAdmin();
    await composable.handleCreateBackup();
    await composable.handleDryRunRestore();

    expect(composable.adminState.dryRunBackupId).toBe("42");
    expect(composable.adminState.recoveryResult).toEqual({ status: "passed" });
  });

  it("covers the admin dry-run guard when no backup is selected", async () => {
    const { auth, api } = createAuth();
    const setFeedback = vi.fn();
    const composable = useAdminConsole(auth, setFeedback);

    await composable.handleDryRunRestore();

    expect(api.dryRunRestore).not.toHaveBeenCalled();
  });

  it("covers admin console failure branches", async () => {
    const { auth, api } = createAuth();
    const setFeedback = vi.fn();
    api.createBackup.mockRejectedValue(new Error("backup failed"));
    api.dryRunRestore.mockRejectedValue(new Error("restore failed"));

    const composable = useAdminConsole(auth, setFeedback);
    composable.adminState.dryRunBackupId = "12";
    await composable.handleCreateBackup();
    await composable.handleDryRunRestore();

    expect(setFeedback).toHaveBeenCalledWith({ error: "backup failed" });
    expect(setFeedback).toHaveBeenCalledWith({ error: "restore failed" });
  });

  it("resets admin state and ignores duplicate backup clicks while loading", async () => {
    const { auth, api } = createAuth();
    const setFeedback = vi.fn();
    let resolveBackup: () => void = () => {};
    api.createBackup.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBackup = () => resolve({ backup: { id: 5 } });
        })
    );
    api.getAdminConsole.mockResolvedValue({ console: { metrics: {}, recentLogs: [], recentAlerts: [] } });

    const composable = useAdminConsole(auth, setFeedback);
    const first = composable.handleCreateBackup();
    const second = composable.handleCreateBackup();
    expect(api.createBackup).toHaveBeenCalledTimes(1);
    resolveBackup();
    await first;
    await second;

    composable.resetAdminState();
    expect(composable.adminState.console).toBeNull();
    expect(composable.adminState.dryRunBackupId).toBe("");
  });
});
