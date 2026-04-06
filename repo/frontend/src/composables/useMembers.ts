import { reactive, ref } from "vue";
import { useAuthStore } from "../stores/auth";
import type { MemberSummary } from "../types";

type FeedbackSetter = (value: { error?: string | null; success?: string | null }) => void;

export const useMembers = (auth: ReturnType<typeof useAuthStore>, setFeedback: FeedbackSetter) => {
  const membersState = reactive({
    members: [] as MemberSummary[],
    coaches: [] as Array<{ id: number; username: string; fullName: string }>,
    form: {
      username: "",
      fullName: "",
      password: "",
      phone: "",
      locationCode: "HQ",
      notes: "",
      coachUserId: null as number | null
    },
    creating: false,
    assigningMemberId: null as number | null,
    consentingMemberId: null as number | null,
    ownConsentSaving: false
  });
  const memberSelf = ref<MemberSummary | null>(null);

  const resetMembersState = () => {
    membersState.members = [];
    membersState.coaches = [];
    Object.assign(membersState.form, {
      username: "",
      fullName: "",
      password: "",
      phone: "",
      locationCode: "HQ",
      notes: "",
      coachUserId: null
    });
    membersState.creating = false;
    membersState.assigningMemberId = null;
    membersState.consentingMemberId = null;
    membersState.ownConsentSaving = false;
    memberSelf.value = null;
  };

  const loadMembers = async () => {
    const response = await auth.api().listMembers();
    membersState.members = response.members;
    membersState.coaches = response.coaches;
  };

  const loadSelf = async () => {
    if (!auth.currentUser?.hasMemberProfile) {
      memberSelf.value = null;
      return;
    }

    try {
      memberSelf.value = (await auth.api().getSelfProfile()).member;
    } catch {
      memberSelf.value = null;
    }
  };

  const handleCreateMember = async () => {
    if (membersState.creating) return;
    membersState.creating = true;
    try {
      await auth.api().createMember({
        ...membersState.form,
        phone: membersState.form.phone || null,
        coachUserId: membersState.form.coachUserId
      });
      Object.assign(membersState.form, {
        username: "",
        fullName: "",
        password: "",
        phone: "",
        locationCode: "HQ",
        notes: "",
        coachUserId: null
      });
      await loadMembers();
      setFeedback({ success: "Member enrollment completed with real persistence." });
    } catch (error) {
      setFeedback({ error: error instanceof Error ? error.message : "Member enrollment failed" });
    } finally {
      membersState.creating = false;
    }
  };

  const handleAssignCoach = async (memberId: number, coachUserId: number) => {
    if (membersState.assigningMemberId === memberId) return;
    membersState.assigningMemberId = memberId;
    try {
      await auth.api().assignCoach(memberId, coachUserId);
      await loadMembers();
      setFeedback({ success: "Coach assignment updated." });
    } catch (error) {
      setFeedback({ error: error instanceof Error ? error.message : "Coach assignment failed" });
    } finally {
      membersState.assigningMemberId = null;
    }
  };

  const handleMemberConsent = async (memberId: number, consentStatus: "granted" | "declined") => {
    if (membersState.consentingMemberId === memberId) return;
    membersState.consentingMemberId = memberId;
    try {
      await auth.api().setFaceConsent(memberId, consentStatus);
      await loadMembers();
      setFeedback({ success: `Face consent ${consentStatus} for the selected member.` });
    } catch (error) {
      setFeedback({ error: error instanceof Error ? error.message : "Consent update failed" });
    } finally {
      membersState.consentingMemberId = null;
    }
  };

  const handleOwnConsent = async (consentStatus: "granted" | "declined") => {
    if (membersState.ownConsentSaving) return;
    membersState.ownConsentSaving = true;
    try {
      memberSelf.value = (await auth.api().setOwnFaceConsent(consentStatus)).member;
    } catch (error) {
      setFeedback({ error: error instanceof Error ? error.message : "Self-service consent update failed" });
    } finally {
      membersState.ownConsentSaving = false;
    }
  };

  return {
    membersState,
    memberSelf,
    loadMembers,
    loadSelf,
    handleCreateMember,
    handleAssignCoach,
    handleMemberConsent,
    handleOwnConsent,
    resetMembersState
  };
};
