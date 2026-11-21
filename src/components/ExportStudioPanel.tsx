import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  FileJson,
  PackageCheck,
  Sparkles,
  Terminal,
  XCircle,
} from 'lucide-react';
import {useMemo, useState} from 'react';
import {
  buildDpoJsonl,
  buildPortableBrainBundle,
  buildSftJsonl,
  generateColabQloraNotebook,
  generateDropInChatHtml,
  generateOllamaModelfile,
  generateStandaloneChatroomSdkCode,
  runExportedBundleSmokeTest,
  sanitizeModelSlug,
  saveModelCard,
  triggerFileDownload,
} from '../lib/modelExporter';
import type {
  EvalRunSummary,
  KnowledgeEntry,
  KnowledgeFolder,
  ModelCardConfig,
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
}

export function ExportStudioPanel({
  modelCard,
  onUpdateModelCard,
  entries,
  folders,
  skills,
  trainingSamples,
  latestEval,
}: ExportStudioPanelProps) {
  const [draft, setDraft] = useState<ModelCardConfig>(modelCard);
  const [savedNotice, setSavedNotice] = useState(false);
  const [copiedSdk, setCopiedSdk] = useState(false);
  const [smokeResult, setSmokeResult] = useState<ReturnType<typeof runExportedBundleSmokeTest> | null>(
    null,
  );

  const liveBundle = useMemo(
    () =>
      buildPortableBrainBundle({
        modelCard: draft,
        entries,
        folders,
        skills,
        latestEval,
      }),
    [draft, entries, folders, skills, latestEval],
  );

  const safeSlug = sanitizeModelSlug(draft.modelName);
  const sftJsonl = useMemo(
    () => buildSftJsonl(trainingSamples, entries, draft),
    [trainingSamples, entries, draft],
  );
  const dpoJsonl = useMemo(() => buildDpoJsonl(trainingSamples), [trainingSamples]);

  function handleSaveCard() {
    const saved = saveModelCard(draft);
    setDraft(saved);
    onUpdateModelCard(saved);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2000);
  }

  function handleRunSmokeTest() {
    const res = runExportedBundleSmokeTest(liveBundle);
    setSmokeResult(res);
  }

  async function handleCopySdk() {
    try {
      await navigator.clipboard.writeText(generateStandaloneChatroomSdkCode(liveBundle));
      setCopiedSdk(true);
      window.setTimeout(() => setCopiedSdk(false), 1800);
    } catch {
      // ignore clipboard restrictions
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-ink">
            Model Naming &amp; Portable Export Studio
          </h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            Name your trained AI, run the isolated round-trip verifier, and download it for any external chatroom app, Ollama, or Free Colab T4 LoRA training.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRunSmokeTest}
          className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-accent-border bg-accent-soft px-3.5 py-1.5 text-xs font-semibold text-accent-text hover:bg-accent hover:text-white"
        >
          <PackageCheck className="h-4 w-4" />
          <span>Verify Export Bundle</span>
        </button>
      </div>

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
              {smokeResult.passed ? 'All Checks Passed ✓' : 'Attention Needed'}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-ink-muted">
              {liveBundle.knowledge.length} memories · {liveBundle.skills.length} skills
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

      {/* Model Card Identity Form */}
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
              <span>{savedNotice ? 'Saved Identity ✓' : 'Save Model Name'}</span>
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="font-medium text-ink-muted">Custom Model Name</span>
              <input
                type="text"
                value={draft.modelName}
                onChange={(e) => setDraft({...draft, modelName: e.target.value})}
                placeholder="e.g. Mantis-Alpha-7B"
                className="min-h-[40px] w-full rounded border border-line-strong bg-inset px-3 font-mono text-xs text-ink focus:border-accent focus:outline-none"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-ink-muted">Version Tag</span>
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
              <span className="font-medium text-ink-muted">Base Open-Weight Model (Colab/Ollama)</span>
              <input
                type="text"
                value={draft.baseArchitecture}
                onChange={(e) => setDraft({...draft, baseArchitecture: e.target.value})}
                className="min-h-[40px] w-full rounded border border-line-strong bg-inset px-3 font-mono text-xs text-ink focus:border-accent focus:outline-none"
              />
            </label>
          </div>

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
                  Open in any browser or embed — runs offline with {liveBundle.knowledge.length} memories &amp; {liveBundle.skills.length} skills
                </div>
              </div>
              <Download className="h-4 w-4 shrink-0" />
            </button>

            {/* 2. Brain JSON Bundle + JS SDK */}
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
                <span>.mantisbrain.json</span>
                <FileJson className="h-4 w-4 shrink-0 text-accent-text" />
              </button>

              <button
                type="button"
                onClick={() => void handleCopySdk()}
                className="flex min-h-[44px] items-center justify-between gap-2 rounded-md border border-line-strong bg-inset px-3 py-2 text-left text-xs font-medium text-ink hover:border-accent-border"
              >
                <span>{copiedSdk ? 'SDK Copied ✓' : 'Copy Chatroom SDK'}</span>
                {copiedSdk ? (
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
                <span className="truncate">sft_train.jsonl ({sftJsonl ? sftJsonl.split('\n').length : 0})</span>
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
                <span className="truncate">dpo_train.jsonl ({dpoJsonl ? dpoJsonl.split('\n').length : 0})</span>
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
    </div>
  );
}
