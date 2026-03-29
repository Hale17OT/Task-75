import { reactive, watch } from "vue";
import { useAuthStore } from "../stores/auth";
import type { FaceAuditEntry } from "../types";

type FeedbackSetter = (value: { error?: string | null; success?: string | null }) => void;

export const useFaceOps = (auth: ReturnType<typeof useAuthStore>, setFeedback: FeedbackSetter) => {
  const faceState = reactive({
    selectedMemberId: 0,
    centerImageBase64: "",
    turnImageBase64: "",
    centerSourceType: "camera" as "camera" | "import",
    turnSourceType: "camera" as "camera" | "import",
    centerAnnotation: null as Record<string, unknown> | null,
    turnAnnotation: null as Record<string, unknown> | null,
    dedupPreview: null as Record<string, unknown> | null,
    dedupChecking: false,
    result: null as Record<string, unknown> | null,
    history: [] as Array<Record<string, unknown>>,
    auditTrail: [] as FaceAuditEntry[],
    lastDedupSignature: "",
    challengeId: null as string | null,
    challengeIssuedAt: null as string | null,
    challengeExpiresAt: null as string | null,
    lastChallengeSignature: "",
    enrolling: false,
    deactivatingFaceId: null as number | null
  });

  const resetFaceState = () => {
    faceState.selectedMemberId = 0;
    faceState.centerImageBase64 = "";
    faceState.turnImageBase64 = "";
    faceState.centerSourceType = "camera";
    faceState.turnSourceType = "camera";
    faceState.centerAnnotation = null;
    faceState.turnAnnotation = null;
    faceState.dedupPreview = null;
    faceState.dedupChecking = false;
    faceState.result = null;
    faceState.history = [];
    faceState.auditTrail = [];
    faceState.lastDedupSignature = "";
    faceState.challengeId = null;
    faceState.challengeIssuedAt = null;
    faceState.challengeExpiresAt = null;
    faceState.lastChallengeSignature = "";
    faceState.enrolling = false;
    faceState.deactivatingFaceId = null;
  };

  const loadFaceHistory = async () => {
    if (!faceState.selectedMemberId) {
      faceState.history = [];
      faceState.auditTrail = [];
      return;
    }

    faceState.history = (await auth.api().getFaceHistory(faceState.selectedMemberId)).history;
    faceState.auditTrail = (await auth.api().getFaceAuditTrail(faceState.selectedMemberId)).auditTrail;
  };

  const getSourceType = () =>
    faceState.centerSourceType === "camera" && faceState.turnSourceType === "camera" ? "camera" : "import";

  const challengeSignature = () => JSON.stringify({
    memberUserId: faceState.selectedMemberId,
    centerImageBase64: faceState.centerImageBase64,
    sourceType: faceState.centerSourceType
  });

  const dedupSignature = () => JSON.stringify({
    memberUserId: faceState.selectedMemberId,
    centerImageBase64: faceState.centerImageBase64,
    turnImageBase64: faceState.turnImageBase64,
    sourceType: getSourceType()
  });

  const handleChallengeStart = async () => {
    if (!faceState.selectedMemberId || !faceState.centerImageBase64) {
      faceState.challengeId = null;
      faceState.challengeIssuedAt = null;
      faceState.challengeExpiresAt = null;
      faceState.lastChallengeSignature = "";
      return;
    }

    const signature = challengeSignature();
    if (signature === faceState.lastChallengeSignature) {
      return;
    }

    try {
      const response = await auth.api().startFaceChallenge(faceState.selectedMemberId);
      faceState.challengeId = response.challenge.challengeId;
      faceState.challengeIssuedAt = response.challenge.issuedAt;
      faceState.challengeExpiresAt = response.challenge.expiresAt;
      faceState.lastChallengeSignature = signature;
    } catch (error) {
      faceState.challengeId = null;
      faceState.challengeIssuedAt = null;
      faceState.challengeExpiresAt = null;
      faceState.lastChallengeSignature = "";
      setFeedback({ error: error instanceof Error ? error.message : "Timed challenge could not be started" });
    }
  };

  const handleDedupPreview = async () => {
    if (
      !faceState.selectedMemberId ||
      !faceState.centerImageBase64 ||
      !faceState.turnImageBase64
    ) {
      faceState.dedupPreview = null;
      faceState.lastDedupSignature = "";
      return;
    }

    const signature = dedupSignature();
    if (signature === faceState.lastDedupSignature) {
      return;
    }

    faceState.dedupChecking = true;
    try {
      const response = await auth.api().dedupCheck({
        memberUserId: faceState.selectedMemberId,
        sourceType: getSourceType(),
        centerImageBase64: faceState.centerImageBase64,
        turnImageBase64: faceState.turnImageBase64
      });
      faceState.dedupPreview = response.dedup.duplicateWarning;
      faceState.lastDedupSignature = signature;
    } catch (error) {
      faceState.dedupPreview = null;
      faceState.lastDedupSignature = "";
      setFeedback({ error: error instanceof Error ? error.message : "Duplicate preview failed" });
    } finally {
      faceState.dedupChecking = false;
    }
  };

  watch(
    () => challengeSignature(),
    () => {
      void handleChallengeStart();
    }
  );

  watch(
    () => dedupSignature(),
    () => {
      void handleDedupPreview();
    }
  );

  const handleEnrollFace = async () => {
    if (faceState.enrolling) return;
    faceState.enrolling = true;
    try {
      if (
        !faceState.selectedMemberId ||
        !faceState.centerImageBase64 ||
        !faceState.turnImageBase64 ||
        !faceState.challengeId
      ) {
        throw new Error("Capture the center image, start the timed challenge, and complete the head-turn capture before submission");
      }

      faceState.result = (await auth.api().enrollFace({
        memberUserId: faceState.selectedMemberId,
        sourceType: getSourceType(),
        challengeId: faceState.challengeId,
        centerImageBase64: faceState.centerImageBase64,
        turnImageBase64: faceState.turnImageBase64
      })).result;
      await loadFaceHistory();
      faceState.challengeId = null;
      faceState.challengeIssuedAt = null;
      faceState.challengeExpiresAt = null;
      faceState.lastChallengeSignature = "";
      setFeedback({
        success: faceState.result.duplicateWarning
          ? "Face enrollment completed with a duplicate warning for review."
          : "Face enrollment completed with quality and liveness validation."
      });
    } catch (error) {
      faceState.result = null;
      setFeedback({ error: error instanceof Error ? error.message : "Face enrollment failed" });
    } finally {
      faceState.enrolling = false;
    }
  };

  const handleDeactivateFace = async (faceRecordId: number) => {
    if (faceState.deactivatingFaceId === faceRecordId) return;
    faceState.deactivatingFaceId = faceRecordId;
    try {
      await auth.api().deactivateFace(faceRecordId);
      await loadFaceHistory();
      setFeedback({ success: `Face record ${faceRecordId} was deactivated.` });
    } catch (error) {
      setFeedback({ error: error instanceof Error ? error.message : "Face deactivation failed" });
    } finally {
      faceState.deactivatingFaceId = null;
    }
  };

  return {
    faceState,
    loadFaceHistory,
    handleDedupPreview,
    handleEnrollFace,
    handleDeactivateFace,
    resetFaceState
  };
};
