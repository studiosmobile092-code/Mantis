import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  FileJson,
  History,
  Laptop,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {
  COLAB_BASE_MODEL_PRESETS,
  buildDpoJsonl,
  buildPortableBrainBundle,
  buildSftJsonl,
  deleteReleaseEntry,
  generateColabQloraNotebook,
  generateDropInChatHtml,
  generateOllamaModelfile,
  generateStandaloneChatroomSdkCode,
  loadReleaseLedger,
  recordModelRelease,
  runExportedBundleSmokeTest,
  sanitizeModelSlug,
  saveModelCard,
  triggerFileDownload,
} from '../lib/modelExporter';
import type {
  ConstitutionalPrinciple,
  EvalRunSummary,
  KnowledgeEntry,
  KnowledgeFolder,
  ModelCardConfig,
  ModelReleaseEntry,
  NeuralCheckpoint,
  ScratchSkillRule,
  TrainingSample,
} from '../types/mantis';

interface ExportStudioPanelProps {
  modelCard: ModelCardConfig;
  onUpdateModelCard: (next: ModelCardConfig) => void;
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
  skills: ScratchSkillRule[];
  trainingSamples: TrainingSample[];
  latestEval: EvalRunSummary | null;
  activeCheckpoint?: NeuralCheckpoint | null;
  principles?: ConstitutionalPrinciple[];
}

type HardwareGuideTab = 'android' | 'chromebook' | 'web-sdk';

export function ExportStudioPanel({
  modelCard,
  onUpdateModelCard,
  entries,
  folders,
  skills,
  trainingSamples,
  latestEval,
  activeCheckpoint,
  principles,
}: ExportStudioPanelProps) {
  const [draft, setDraft] = useState<ModelCardConfig>(modelCard);
  const [savedNotice, setSavedNotice] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [smokeResult, setSmokeResult] = useState<ReturnType<typeof runExportedBundleSmokeTest> | null>(
    null,
  );
  const [showSandbox, setShowSandbox] = useState(false);
  const [sandboxSeed, setSandboxSeed] = useState(1);
  const [changelogDraft, setChangelogDraft] = useState('');
  const [releaseLedger, setReleaseLedger] = useState<ModelReleaseEntry[]>(() => loadReleaseLedger());
  const [deployTab, setDeployTab] = useState<HardwareGuideTab>('chromebook');

  useEffect(() => {
    setDraft(modelCard);
  }, [modelCard]);

  const liveBundle = useMemo(
    () =>
      buildPortableBrainBundle({
        modelCard: draft,
        entries,
        folders,
        skills,
        latestEval,
        activeCheckpoint,
        principles,
      }),
    [draft, entries, folders, skills, latestEval, activeCheckpoint, principles],
  );

  const safeSlug = sanitizeModelSlug(draft.modelName);
  const lowerSlug = safeSlug.toLowerCase();
  const sftJsonl = useMemo(
    () => buildSftJsonl(trainingSamples, entries, draft),
    [trainingSamples, entries, draft],
  );
  const dpoJsonl = useMemo(() => buildDpoJsonl(trainingSamples), [trainingSamples]);
  const sandboxHtml = useMemo(
    () => (showSandbox ? generateDropInChatHtml(liveBundle) : ''),
    [showSandbox, liveBundle],
  );

  function handleSaveCard() {
    const saved = saveModelCard(draft);
    setDraft(saved);
    onUpdateModelCard(saved);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2000);
  }

  function handleRunSmokeTest() {
    const res = runExportedBundleSmokeTest(liveBundle, {sftJsonl, dpoJsonl});
    setSmokeResult(res);
  }

  async function handleCopy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // ignore clipboard restrictions
    }
  }

  function handleRecordRelease() {
    const updated = recordModelRelease(liveBundle, changelogDraft);
    setReleaseLedger(updated);
    setChangelogDraft('');
  }

  const androidSnippet = `# Inside Android Termux (8 GB RAM safe Q4_K_M / Q4_0)
pkg update && pkg install ollama -y
ollama serve &
# Place ${safeSlug}.gguf & Modelfile in current folder:
ollama create ${lowerSlug} -f Modelfile
ollama run ${lowerSlug}`;

  const chromebookSnippet = `# Inside Chromebook Linux (Crostini) container
curl -fsSL https://ollama.com/install.sh | sh
OLLAMA_ORIGINS="*" ollama serve &
# Place ${safeSlug}.gguf & Modelfile in ~/models:
ollama create ${lowerSlug} -f Modelfile
ollama run ${lowerSlug}`;

  const webSdkSnippet = `import bundle from './${safeSlug}.mantisbrain.json';
import { createMantisRuntime } from './mantis-runtime-sdk.js';

const bot = createMantisRuntime(bundle, {
  // Optional: point to your local Ollama GGUF server when available
  endpointUrl: 'http://localhost:11434',
  model: '${lowerSlug}',
});

const offlineReply = bot.ask('How should Mantis protect secrets?');
console.log(offlineReply.engine, offlineReply.reply);`;

  const activeSnippet =
    deployTab === 'android'
      ? androidSnippet
      : deployTab === 'chromebook'
        ? chromebookSnippet
        : webSdkSnippet;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-ink">
            Model Naming, Sandbox Verification &amp; Portable Export
          </h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            Package your named neural checkpoint ({activeCheckpoint?.id || 'ckpt-base'} ·{' '}
            <span className="font-mono tabular-nums">
              {activeCheckpoint?.metrics.stepCount ?? 0} steps
            </span>
            ), Int8 memories, and constitutional rules into an isolated runtime anywhere.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setShowSandbox((prev) => !prev);
              setSandboxSeed((s) => s + 1);
            }}
            className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              showSandbox
                ? 'border-accent bg-accent-soft text-accent-text'
                : 'border-line-strong bg-surface text-ink hover:border-accent-border'
            }`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>{showSandbox ? 'Hide Sandbox Preview' : 'Test Outside Studio'}</span>
          </button>

          <button
            type="button"
            onClick={handleRunSmokeTest}
            className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-accent-border bg-accent-soft px-3.5 py-1.5 text-xs font-semibold text-accent-text hover:bg-accent hover:text-white"
          >
            <PackageCheck className="h-4 w-4" />
            <span>Verify Export Bundle</span>
          </button>
        </div>
      </div>

      {/* Bundle Integrity Bar */}
      <div className="grid gap-2.5 font-mono text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border border-line bg-surface p-3">
          <div className="text-[11px] text-ink-muted">Neural Core Embedded</div>
          <div className="mt-1 font-semibold tabular-nums text-ink">
            {liveBundle.checkpoint?.stepCount ?? 0} steps ·{' '}
            {liveBundle.neuralCore?.targets.length ?? 0} targets
          </div>
          <div className="mt-0.5 text-[11px] text-ink-subtle">
            Vocab: {liveBundle.checkpoint?.vocabSize ?? 0} BPE tokens
          </div>
        </div>

        <div className="rounded-md border border-line bg-surface p-3">
          <div className="text-[11px] text-ink-muted">Quantized Memory + Skills</div>
          <div className="mt-1 font-semibold tabular-nums text-ink">
            {liveBundle.knowledge.length} memories · {liveBundle.skills.length} skills
          </div>
          <div className="mt-0.5 text-[11px] text-ink-subtle">384-d Int8 zero-eval runtime</div>
        </div>

        <div className="rounded-md border border-line bg-surface p-3">
          <div className="text-[11px] text-ink-muted">Blind Eval &amp; Rules</div>
          <div className="mt-1 font-semibold tabular-nums text-accent-text">
            {liveBundle.evalScorecard?.blindPassRate !== null &&
            liveBundle.evalScorecard?.blindPassRate !== undefined
              ? `${liveBundle.evalScorecard.blindPassRate}% Blind`
              : 'Not evaled yet'}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-subtle">
            {liveBundle.constitutionalRules?.length ?? 0} constitutional rules
          </div>
        </div>

        <div className="rounded-md border border-line bg-surface p-3">
          <div className="text-[11px] text-ink-muted">Bundle Schema &amp; Hash</div>
          <div className="mt-1 font-semibold text-ink">{liveBundle.schema}</div>
          <div className="mt-0.5 truncate text-[11px] tabular-nums text-ink-subtle">
            SHA-hash: {liveBundle.fingerprint || 'pending'}
          </div>
        </div>
      </div>

      {/* Isolated Sandbox Chatroom Verifier ("Test Outside Studio") */}
      {showSandbox && (
        <section className="space-y-3 rounded-lg border border-accent-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-accent-text uppercase">
                <ShieldCheck className="h-4 w-4" />
                <span>Isolated Sandbox Chatroom Verifier (&ldquo;Test Outside Studio&rdquo;)</span>
              </h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                This iframe runs with <code className="font-mono">sandbox=&quot;allow-scripts&quot;</code> (zero access to Mantis Studio state, localStorage, or Supabase) — executing strictly the standalone <code className="font-mono">{safeSlug}-chatroom.html</code> bundle.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSandboxSeed((s) => s + 1)}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-line-strong bg-inset px-3 text-xs font-medium text-ink hover:bg-elevated"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Reload Sandbox</span>
            </button>
          </div>

          <iframe
            key={`${safeSlug}-${sandboxSeed}`}
            title={`${safeSlug} Isolated Export Sandbox`}
            sandbox="allow-scripts"
            srcDoc={sandboxHtml}
            className="h-[420px] w-full rounded-md border border-line-strong bg-[#090b0e]"
          />
        </section>
      )}

      {/* Round-trip Smoke Test Result */}
      {smokeResult && (
        <div
          className={`space-y-2 rounded-lg border p-4 ${
            smokeResult.passed
              ? 'border-accent-border bg-accent-soft/40'
              : 'border-warn-border bg-warn-soft'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-ink">
            <span>
              Isolated Bundle Round-Trip Test:{' '}
              {smokeResult.passed ? 'All 7 Checks Passed' : 'Attention Needed'}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-ink-muted">
              {liveBundle.knowledge.length} memories · {liveBundle.skills.length} skills ·{' '}
              {liveBundle.neuralCore?.targets.length ?? 0} neural targets
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {smokeResult.checks.map((c, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2 rounded border border-line bg-surface px-3 py-2 text-xs"
              >
                {c.passed ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-text" />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
                )}
                <div>
                  <div className="font-medium text-ink">{c.label}</div>
                  <div className="text-[11px] text-ink-muted">{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Model Card Identity & Export Actions */}
      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        <section className="space-y-3.5 rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center justify-between border-b border-line pb-2.5">
            <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
              Custom Model Card
            </h2>
            <button
              type="button"
              onClick={handleSaveCard}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-xs font-semibold text-white hover:bg-accent-hover"
            >
              {savedNotice ? <Check className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
              <span>{savedNotice ? 'Saved Identity' : 'Save Model Name'}</span>
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="font-medium text-ink-muted">Custom Model Name</span>
              <input
                type="text"
                value={draft.modelName}
                onChange={(e) => setDraft({...draft, modelName: e.target.value})}
                placeholder="e.g. Mantis-Coder-v1"
                className="min-h-[40px] w-full rounded border border-line-strong bg-inset px-3 font-mono text-xs text-ink focus:border-accent focus:outline-none"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-ink-muted">SemVer Tag</span>
              <input
                type="text"
                value={draft.version}
                onChange={(e) => setDraft({...draft, version: e.target.value})}
                placeholder="1.0.0"
                className="min-h-[40px] w-full rounded border border-line-strong bg-inset px-3 font-mono text-xs text-ink focus:border-accent focus:outline-none"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="font-medium text-ink-muted">Author / Studio</span>
              <input
                type="text"
                value={draft.author}
                onChange={(e) => setDraft({...draft, author: e.target.value})}
                className="min-h-[40px] w-full rounded border border-line-strong bg-inset px-3 text-xs text-ink focus:border-accent focus:outline-none"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-ink-muted">8 GB / Colab Base Architecture</span>
              <select
                value={
                  COLAB_BASE_MODEL_PRESETS.some((p) => p.id === draft.baseArchitecture)
                    ? draft.baseArchitecture
                    : '__custom__'
                }
                onChange={(e) => {
                  if (e.target.value !== '__custom__') {
                    setDraft({...draft, baseArchitecture: e.target.value});
                  }
                }}
                className="min-h-[40px] w-full rounded border border-line-strong bg-inset px-2.5 font-mono text-[11px] text-ink focus:border-accent focus:outline-none"
              >
                {COLAB_BASE_MODEL_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label} [{preset.ramProfile}]
                  </option>
                ))}
                {!COLAB_BASE_MODEL_PRESETS.some((p) => p.id === draft.baseArchitecture) && (
                  <option value="__custom__">Custom: {draft.baseArchitecture}</option>
                )}
              </select>
            </label>
          </div>

          <label className="block space-y-1 text-xs">
            <span className="font-medium text-ink-muted">Custom Base Repo ID (HF / Unsloth)</span>
            <input
              type="text"
              value={draft.baseArchitecture}
              onChange={(e) => setDraft({...draft, baseArchitecture: e.target.value})}
              className="min-h-[40px] w-full rounded border border-line-strong bg-inset px-3 font-mono text-xs text-ink focus:border-accent focus:outline-none"
            />
          </label>

          <label className="block space-y-1 text-xs">
            <span className="font-medium text-ink-muted">Persona &amp; System Prompt</span>
            <textarea
              rows={3}
              value={draft.personaPrompt}
              onChange={(e) => setDraft({...draft, personaPrompt: e.target.value})}
              className="w-full rounded border border-line-strong bg-inset p-3 text-xs leading-relaxed text-ink focus:border-accent focus:outline-none"
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-xs">
            <label className="flex items-center gap-2 text-ink">
              <input
                type="checkbox"
                checked={draft.includeOnlyTrusted}
                onChange={(e) => setDraft({...draft, includeOnlyTrusted: e.target.checked})}
                className="h-4 w-4 accent-[var(--m-accent)]"
              />
              <span>Export strictly Trusted rules only</span>
            </label>

            <label className="flex items-center gap-2 font-mono text-ink-muted">
              <span>Temp:</span>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1.5"
                value={draft.temperature}
                onChange={(e) =>
                  setDraft({...draft, temperature: Number(e.target.value) || 0.2})
                }
                className="min-h-[40px] w-16 rounded border border-line-strong bg-inset px-2 text-center text-xs tabular-nums text-ink"
              />
            </label>
          </div>
        </section>

        {/* Export Actions Column */}
        <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
          <div className="border-b border-line pb-2.5">
            <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
              Portable Chatroom &amp; Fine-Tune Exports
            </h2>
          </div>

          <div className="space-y-2">
            {/* 1. Drop-In Single HTML Chatroom */}
            <button
              type="button"
              onClick={() =>
                triggerFileDownload(
                  `${safeSlug}-chatroom.html`,
                  generateDropInChatHtml(liveBundle),
                  'text/html;charset=utf-8',
                )
              }
              className="flex min-h-[46px] w-full items-center justify-between gap-3 rounded-md bg-accent px-3.5 py-2.5 text-left text-xs font-semibold text-white transition-colors hover:bg-accent-hover"
            >
              <div>
                <div>Download Standalone Chatroom App (.html)</div>
                <div className="text-[11px] font-normal text-white/85">
                  Runs offline with {liveBundle.neuralCore?.targets.length ?? 0} neural targets,{' '}
                  {liveBundle.knowledge.length} memories &amp; optional GGUF endpoint slot
                </div>
              </div>
              <Download className="h-4 w-4 shrink-0" />
            </button>

            {/* 2. Brain JSON Bundle v2 + JS SDK */}
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() =>
                  triggerFileDownload(
                    `${safeSlug}.mantisbrain.json`,
                    JSON.stringify(liveBundle, null, 2),
                    'application/json;charset=utf-8',
                  )
                }
                className="flex min-h-[44px] items-center justify-between gap-2 rounded-md border border-line-strong bg-inset px-3 py-2 text-left text-xs font-medium text-ink hover:border-accent-border"
              >
                <span>.mantisbrain.json (v2)</span>
                <FileJson className="h-4 w-4 shrink-0 text-accent-text" />
              </button>

              <button
                type="button"
                onClick={() => void handleCopy(generateStandaloneChatroomSdkCode(liveBundle), 'sdk')}
                className="flex min-h-[44px] items-center justify-between gap-2 rounded-md border border-line-strong bg-inset px-3 py-2 text-left text-xs font-medium text-ink hover:border-accent-border"
              >
                <span>{copiedKey === 'sdk' ? 'SDK Copied' : 'Copy Chatroom SDK'}</span>
                {copiedKey === 'sdk' ? (
                  <Check className="h-4 w-4 shrink-0 text-accent-text" />
                ) : (
                  <Copy className="h-4 w-4 shrink-0 text-ink-muted" />
                )}
              </button>
            </div>

            {/* 3. Real LLM Training Exports (SFT, DPO, Colab T4, Ollama) */}
            <div className="border-t border-line pt-2.5 font-mono text-[11px] text-ink-muted">
              Real Weight Fine-Tuning (Free Colab T4 / Ollama / Hugging Face)
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() =>
                  triggerFileDownload(
                    'sft_train.jsonl',
                    sftJsonl || '{"messages":[]}\n',
                    'application/x-ndjson;charset=utf-8',
                  )
                }
                className="flex min-h-[42px] items-center justify-between gap-2 rounded-md border border-line bg-inset px-3 py-1.5 text-xs font-medium text-ink hover:border-line-strong"
              >
                <span className="truncate tabular-nums">
                  sft_train.jsonl ({sftJsonl ? sftJsonl.split('\n').length : 0})
                </span>
                <FileCode2 className="h-3.5 w-3.5 shrink-0 text-accent-text" />
              </button>

              <button
                type="button"
                onClick={() =>
                  triggerFileDownload(
                    'dpo_train.jsonl',
                    dpoJsonl,
                    'application/x-ndjson;charset=utf-8',
                  )
                }
                className="flex min-h-[42px] items-center justify-between gap-2 rounded-md border border-line bg-inset px-3 py-1.5 text-xs font-medium text-ink hover:border-line-strong"
              >
                <span className="truncate tabular-nums">
                  dpo_train.jsonl ({dpoJsonl ? dpoJsonl.split('\n').length : 0})
                </span>
                <FileCode2 className="h-3.5 w-3.5 shrink-0 text-accent-text" />
              </button>

              <button
                type="button"
                onClick={() =>
                  triggerFileDownload(
                    `${safeSlug}_QLoRA_Colab.ipynb`,
                    generateColabQloraNotebook(draft),
                    'application/x-ipynb+json;charset=utf-8',
                  )
                }
                className="flex min-h-[42px] items-center justify-between gap-2 rounded-md border border-line bg-inset px-3 py-1.5 text-xs font-medium text-ink hover:border-line-strong"
              >
                <span className="truncate">Free Colab QLoRA .ipynb</span>
                <Download className="h-3.5 w-3.5 shrink-0 text-accent-text" />
              </button>

              <button
                type="button"
                onClick={() =>
                  triggerFileDownload('Modelfile', generateOllamaModelfile(draft))
                }
                className="flex min-h-[42px] items-center justify-between gap-2 rounded-md border border-line bg-inset px-3 py-1.5 text-xs font-medium text-ink hover:border-line-strong"
              >
                <span className="truncate">Ollama Modelfile</span>
                <Terminal className="h-3.5 w-3.5 shrink-0 text-accent-text" />
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Release Ledger + 8 GB Hardware Deployment Guide */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Release History & Checksum Ledger */}
        <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center justify-between border-b border-line pb-2.5">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-ink-muted uppercase">
              <History className="h-3.5 w-3.5 text-accent-text" />
              <span>Model Release History &amp; Checksum Ledger</span>
            </h2>
            <span className="font-mono text-[11px] tabular-nums text-ink-subtle">
              {releaseLedger.length} snapshots
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={changelogDraft}
              onChange={(e) => setChangelogDraft(e.target.value)}
              placeholder="Release note (e.g. Passed 92% Blind Eval + TypeScript rules)"
              className="min-h-[40px] flex-1 rounded border border-line-strong bg-inset px-3 text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={handleRecordRelease}
              className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3 text-xs font-semibold text-accent-text hover:bg-accent hover:text-white"
            >
              <PackageCheck className="h-3.5 w-3.5" />
              <span>Record Snapshot</span>
            </button>
          </div>

          {releaseLedger.length === 0 ? (
            <div className="rounded border border-dashed border-line bg-inset p-4 text-center text-xs text-ink-muted">
              No release snapshots recorded yet. Verify your bundle and record a versioned release checkpoint above.
            </div>
          ) : (
            <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
              {releaseLedger.map((rel) => (
                <div
                  key={rel.id}
                  className="flex items-start justify-between gap-2 rounded border border-line bg-inset px-3 py-2 text-xs"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                      <span className="font-semibold text-ink">
                        {rel.modelName} v{rel.version}
                      </span>
                      <span className="text-accent-text">{rel.checkpointId}</span>
                      <span className="tabular-nums text-ink-muted">
                        {rel.blindPassRate !== null ? `${rel.blindPassRate}% Blind` : 'No eval'}
                      </span>
                      <span className="tabular-nums text-ink-subtle">hash {rel.fingerprint}</span>
                    </div>
                    <div className="text-ink-muted">{rel.changelog}</div>
                    <div className="font-mono text-[10px] tabular-nums text-ink-subtle">
                      {rel.stepCount} steps · {rel.knowledgeCount} memories · {rel.skillsCount} skills ·{' '}
                      {new Date(rel.exportedAt).toLocaleString()}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Delete release entry"
                    onClick={() => setReleaseLedger(deleteReleaseEntry(rel.id))}
                    className="inline-flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded text-ink-subtle hover:bg-surface hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 8 GB Hardware Deployment Guide */}
        <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-ink-muted uppercase">
              <Terminal className="h-3.5 w-3.5 text-accent-text" />
              <span>8 GB Hardware Deployment Guide</span>
            </h2>
            <button
              type="button"
              onClick={() => void handleCopy(activeSnippet, 'deploy-cmd')}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded border border-line-strong bg-inset px-2.5 text-xs font-medium text-ink hover:bg-elevated"
            >
              {copiedKey === 'deploy-cmd' ? (
                <Check className="h-3.5 w-3.5 text-accent-text" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copiedKey === 'deploy-cmd' ? 'Copied' : 'Copy Commands'}</span>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1 rounded-md border border-line bg-inset p-1 text-xs">
            <button
              type="button"
              onClick={() => setDeployTab('chromebook')}
              className={`inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded px-2 font-medium transition-colors ${
                deployTab === 'chromebook'
                  ? 'bg-elevated text-ink'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              <Laptop className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Chromebook</span>
            </button>
            <button
              type="button"
              onClick={() => setDeployTab('android')}
              className={`inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded px-2 font-medium transition-colors ${
                deployTab === 'android' ? 'bg-elevated text-ink' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <Smartphone className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Android Termux</span>
            </button>
            <button
              type="button"
              onClick={() => setDeployTab('web-sdk')}
              className={`inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded px-2 font-medium transition-colors ${
                deployTab === 'web-sdk' ? 'bg-elevated text-ink' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <FileCode2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Web JS SDK</span>
            </button>
          </div>

          <pre className="max-h-56 overflow-auto rounded-md border border-line bg-inset p-3 font-mono text-[11px] leading-relaxed text-ink">
            {activeSnippet}
          </pre>

          <p className="text-[11px] leading-relaxed text-ink-muted">
            Zero-setup option right now: use the downloaded <code className="font-mono">.html</code>{' '}
            or Web SDK directly on any static site (zero RAM spikes, zero API keys), or compile QLoRA
            GGUF weights in free Google Colab T4 GPU for native 8 GB RAM Ollama execution.
          </p>
        </section>
      </div>
    </div>
  );
}
