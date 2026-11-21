import type {
  BrainRouteStatus,
  ComputeEngineStatus,
  GitHubConnection,
} from '../types/mantis';

interface StatusFooterProps {
  routeStatus: BrainRouteStatus;
  computeStatus: ComputeEngineStatus;
  connection: GitHubConnection | null;
  pendingOfflineCount: number;
  knowledgeCount: number;
  skillsCount: number;
  modelName: string;
  onOpenSettings: () => void;
  onOpenTraining: () => void;
}

export function StatusFooter({
  routeStatus,
  computeStatus,
  connection,
  pendingOfflineCount,
  knowledgeCount,
  skillsCount,
  modelName,
  onOpenSettings,
  onOpenTraining,
}: StatusFooterProps) {
  const routeText =
    routeStatus.activeKind === 'primary-worker'
      ? 'Worker Route'
      : routeStatus.activeKind === 'backup-supabase'
        ? 'Edge Backup'
        : routeStatus.activeKind === 'ollama-direct'
          ? 'Ollama Local'
          : 'Scratch Local';

  const gpuText =
    computeStatus.backend === 'webgpu-vulkan'
      ? 'WebGPU · Vulkan'
      : computeStatus.backend === 'webgpu'
        ? 'WebGPU Active'
        : computeStatus.workerActive
          ? 'Worker Pool'
          : 'CPU Direct';

  const int8Kb = Math.round(computeStatus.vectorBytesUsed / 1024);

  return (
    <footer
      aria-label="Workstation operational status bar"
      className="hidden h-6 shrink-0 items-center justify-between border-t border-line bg-inset px-3 font-mono text-[11px] tabular-nums text-ink-muted md:flex"
    >
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onOpenSettings}
          className="whitespace-nowrap text-accent-text transition-colors hover:text-ink"
        >
          {routeText}
        </button>

        <span className="whitespace-nowrap text-ink-subtle">
          Compute: <span className="text-ink-muted">{gpuText}</span>
        </span>

        {connection && (
          <span className="truncate whitespace-nowrap text-ink-subtle">
            {connection.owner}/{connection.repo} ({connection.branch})
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onOpenTraining}
          className="whitespace-nowrap text-ink-muted transition-colors hover:text-ink"
        >
          Model: {modelName}
        </button>

        <span className="whitespace-nowrap text-ink-subtle">
          {knowledgeCount} notes · {skillsCount} skills · {int8Kb} KB Int8
        </span>

        {pendingOfflineCount > 0 && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="whitespace-nowrap text-warn underline underline-offset-2 hover:text-ink"
          >
            {pendingOfflineCount} queued
          </button>
        )}
      </div>
    </footer>
  );
}
