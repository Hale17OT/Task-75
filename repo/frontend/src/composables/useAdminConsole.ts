import { reactive } from "vue";
import { useAuthStore } from "../stores/auth";

type FeedbackSetter = (value: { error?: string | null; success?: string | null }) => void;

export const useAdminConsole = (auth: ReturnType<typeof useAuthStore>, setFeedback: FeedbackSetter) => {
  const adminState = reactive({
    console: null as Record<string, unknown> | null,
    backupResult: null as Record<string, unknown> | null,
    recoveryResult: null as Record<string, unknown> | null,
    dryRunBackupId: "",
    loadingBackup: false,
    loadingRecovery: false
  });

  const resetAdminState = () => {
    adminState.console = null;
    adminState.backupResult = null;
    adminState.recoveryResult = null;
    adminState.dryRunBackupId = "";
    adminState.loadingBackup = false;
    adminState.loadingRecovery = false;
  };

  const loadAdmin = async () => {
    adminState.console = (await auth.api().getAdminConsole()).console as unknown as Record<string, unknown>;
  };

  const handleCreateBackup = async () => {
    if (adminState.loadingBackup) return;
    adminState.loadingBackup = true;
    setFeedback({});
    adminState.recoveryResult = null;

    try {
      const response = await auth.api().createBackup();
      adminState.backupResult = response.backup as unknown as Record<string, unknown>;
      adminState.dryRunBackupId = String((response.backup as { id?: number }).id ?? "");
      await loadAdmin();
    } catch (error) {
      setFeedback({ error: error instanceof Error ? error.message : "Backup failed" });
    } finally {
      adminState.loadingBackup = false;
    }
  };

  const handleDryRunRestore = async () => {
    if (adminState.loadingRecovery) return;
    if (!adminState.dryRunBackupId) return;
    adminState.loadingRecovery = true;
    setFeedback({});

    try {
      adminState.recoveryResult = (await auth.api().dryRunRestore(Number(adminState.dryRunBackupId)))
        .recovery as Record<string, unknown>;
      await loadAdmin();
    } catch (error) {
      setFeedback({ error: error instanceof Error ? error.message : "Dry-run restore failed" });
    } finally {
      adminState.loadingRecovery = false;
    }
  };

  return {
    adminState,
    loadAdmin,
    handleCreateBackup,
    handleDryRunRestore,
    resetAdminState
  };
};
