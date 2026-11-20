import {
  ArrowUpRight,
  BookmarkPlus,
  Cpu,
  FileCode2,
  GitPullRequest,
  PlusCircle,
  Radio,
  Send,
  Sparkles,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import {type FormEvent, useEffect, useMemo, useRef, useState} from 'react';
import type {
  BrainRouteStatus,
  ChatMessage,
  GitHubConnection,
  KnowledgeEntry,
} from '../types/mantis';

interface ChatWorkspaceProps {
  messages: ChatMessage[];
  entries: KnowledgeEntry[];
  connection: GitHubConnection | null;
  routeStatus: BrainRouteStatus;
  preferBuiltInFirst: boolean;
  onTogglePreferBuiltIn: (next: boolean) => void;
  brainModel: string;
  isLoading: boolean;
  isSending: boolean;
  escalatingMsgId: string | null;
  composerPrefill?: string;
  onConsumeComposerPrefill?: () => void;
  onSendMessage: (prompt: string, forceCloudAssist?: boolean) => Promise<void>;
  onEscalateMessageToCloud: (msgId: string) => Promise<void>;
  onClearChat: () => Promise<void>;
  onInspectEntry: (entryId: string) => void;
  onInspectRepoFile: (filePath: string) => void;
  onSaveTextToTeach: (suggestedTitle: string, content: string) => void;
  onReinforceEntries: (entryIds: string[]) => Promise<void>;
  onOpenIngest: () => void;
  onOpenTeach: () => void;
  onOpenSuggestions: () => void;
  onOpenSettings: () => void;
}

export function ChatWorkspace({
  messages,
  entries,
  connection,
  routeStatus,
  preferBuiltInFirst,
  onTogglePreferBuiltIn,
  brainModel,
  isLoading,
  isSending,
  escalatingMsgId,
  composerPrefill,
  onConsumeComposerPrefill,
  onSendMessage,
  onEscalateMessageToCloud,
  onClearChat,
  onInspectEntry,
  onInspectRepoFile,
  onSaveTextToTeach,
  onReinforceEntries,
  onOpenIngest,
  onOpenTeach,
  onOpenSuggestions,
  onOpenSettings,
}: ChatWorkspaceProps) {
  const [input, setInput] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [reinforcedMsgIds, setReinforcedMsgIds] = useState<Record<string, boolean>>({});
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  const hasCloudRoute = routeStatus.activeKind !== 'built-in-only';

  useEffect(() => {
    if (composerPrefill) {
      setInput(composerPrefill);
      onConsumeComposerPrefill?.();
    }
  }, [composerPrefill, onConsumeComposerPrefill]);

  const entryMap = useMemo(
    () => new Map<string, KnowledgeEntry>(entries.map((e) => [e.id, e])),
    [entries],
  );

  const quickPrompts = useMemo(() => {
    const base = [
      'What do you know so far?',
      'Remember: Keep all secret keys strictly inside backend Secrets.',
      '/search supabase',
    ];
    if (connection) {
      base.push('/repo App.tsx');
      base.push('/suggest App.tsx');
    }
    base.push('/self-audit');
    return base;
  }, [connection]);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({behavior: 'smooth'});
  }, [messages.length]);

  async function submitPrompt(forceCloudAssist = false) {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;
    setInput('');
    await onSendMessage(trimmed, forceCloudAssist);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await submitPrompt(false);
  }

  async function handleQuickPrompt(prompt: string) {
    if (prompt.startsWith('/teach ') || prompt.startsWith('Remember:')) {
      setInput(prompt);
      return;
    }
    if (isSending) return;
    await onSendMessage(prompt, false);
  }

  async function handleConfirmClear() {
    setIsClearing(true);
    try {
      await onClearChat();
      setConfirmClear(false);
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      {/* Studio Workbench Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#0F172A] px-4 py-3">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight text-slate-100">
              AI Studio Workbench
            </h1>
            <span className="font-mono text-xs text-slate-400">
              {preferBuiltInFirst ? 'Built-in AI Leads' : 'Cloud Assist Primary'}
              {hasCloudRoute ? ` · ${brainModel.split('/').pop()}` : ''}
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Built-in rule miner, concept recall{connection ? `, and ${connection.owner}/${connection.repo}` : ''}.
            Use <code className="font-mono text-slate-200">/teach</code>,{' '}
            <code className="font-mono text-slate-200">/search</code>,{' '}
            <code className="font-mono text-slate-200">/suggest</code>,{' '}
            <code className="font-mono text-slate-200">/self-audit</code>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Mode Switchers */}
          <button
            type="button"
            onClick={onOpenIngest}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-600 hover:bg-slate-800"
          >
            <Radio className="h-3.5 w-3.5 text-emerald-400" />
            <span>Ingest</span>
          </button>

          <button
            type="button"
            onClick={onOpenTeach}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-600 hover:bg-slate-800"
          >
            <PlusCircle className="h-3.5 w-3.5 text-sky-400" />
            <span>Teach</span>
          </button>

          <button
            type="button"
            onClick={onOpenSuggestions}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-600 hover:bg-slate-800"
          >
            <GitPullRequest className="h-3.5 w-3.5 text-amber-400" />
            <span>Diffs</span>
          </button>

          {messages.length > 0 && (
            <div className="flex items-center gap-1.5">
              {confirmClear ? (
                <>
                  <button
                    type="button"
                    disabled={isClearing}
                    onClick={handleConfirmClear}
                    className="min-h-[38px] rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    {isClearing ? 'Clearing...' : 'Confirm'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="min-h-[38px] rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  aria-label="Clear conversation history"
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-slate-800 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-400 hover:border-slate-700 hover:text-slate-200"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Clear</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Routing Control Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 bg-[#0F172A] px-3.5 py-2 text-xs">
        <div className="flex items-center gap-2 font-mono text-[11px] text-slate-300">
          <Cpu className="h-3.5 w-3.5 text-emerald-400" />
          <span>
            Mode:{' '}
            <strong className="text-slate-100">
              {preferBuiltInFirst ? 'Built-in AI First (Instant + Auto-Mine)' : 'Cloud Assist Auto'}
            </strong>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-slate-800 bg-[#0B1120] p-0.5">
            <button
              type="button"
              onClick={() => onTogglePreferBuiltIn(true)}
              className={`min-h-[30px] rounded px-2.5 text-[11px] font-medium transition-colors ${
                preferBuiltInFirst
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Built-in Leads
            </button>
            <button
              type="button"
              onClick={() => onTogglePreferBuiltIn(false)}
              className={`min-h-[30px] rounded px-2.5 text-[11px] font-medium transition-colors ${
                !preferBuiltInFirst
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Cloud Auto
            </button>
          </div>

          {!hasCloudRoute && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="font-mono text-[11px] text-amber-300 underline underline-offset-2 hover:text-amber-200"
            >
              Setup Cloud Backup
            </button>
          )}
        </div>
      </div>

      {/* Conversation Stream */}
      <div className="min-h-[380px] space-y-3.5 rounded-lg border border-slate-800 bg-[#0F172A] p-4">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((n) => (
              <div
                key={n}
                className="h-20 animate-pulse rounded-md border border-slate-800 bg-[#0B1120]"
              />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center space-y-4 text-center">
            <div className="space-y-1.5">
              <h2 className="text-sm font-semibold text-slate-200">
                Mantis Built-in AI Workbench Ready
              </h2>
              <p className="max-w-md text-xs leading-relaxed text-slate-400">
                Write rules starting with <code className="font-mono text-slate-200">Remember:</code>,
                query your stored concepts or synced GitHub files, or escalate any turn to Cloud Assist.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => handleQuickPrompt(prompt)}
                  className="min-h-[38px] rounded-md border border-slate-700 bg-[#0B1120] px-3 py-1.5 font-mono text-xs text-slate-200 transition-colors hover:border-emerald-500/60 hover:bg-slate-800"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3.5">
            {messages.map((msg, idx) => {
              const isUser = msg.role === 'user';
              const citedEntries = (msg.cited_entry_ids || [])
                .map((id) => entryMap.get(id))
                .filter((e): e is KnowledgeEntry => Boolean(e));
              const citedRepoPaths = msg.cited_repo_paths || [];
              const prevUserMsg = idx > 0 && messages[idx - 1]?.role === 'user' ? messages[idx - 1] : null;
              const isEscalating = escalatingMsgId === msg.id;

              return (
                <div
                  key={msg.id}
                  className={`rounded-md border p-3.5 ${
                    isUser
                      ? 'border-slate-700 bg-slate-800/70'
                      : 'border-slate-800 bg-[#0B1120]'
                  }`}
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-mono text-xs text-slate-400">
                      <span
                        className={
                          isUser ? 'font-semibold text-slate-200' : 'font-semibold text-emerald-400'
                        }
                      >
                        {isUser ? 'You' : 'Mantis'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {new Date(msg.created_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    {isUser && !msg.content.startsWith('/teach') && (
                      <button
                        type="button"
                        onClick={() => onSaveTextToTeach(msg.content.slice(0, 60), msg.content)}
                        className="inline-flex min-h-[34px] items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-700/60 hover:text-slate-100"
                      >
                        <BookmarkPlus className="h-3.5 w-3.5" />
                        <span>Save Rule</span>
                      </button>
                    )}

                    {!isUser && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {prevUserMsg && !msg.content.startsWith('[Cloud Assist') && (
                          <button
                            type="button"
                            disabled={isEscalating || isSending}
                            onClick={() => void onEscalateMessageToCloud(msg.id)}
                            className="inline-flex min-h-[34px] items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-sky-300 hover:border-sky-500/50 hover:bg-slate-800 disabled:opacity-50"
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            <span>{isEscalating ? 'Assisting...' : 'Ask Cloud Assist'}</span>
                          </button>
                        )}

                        {citedEntries.length > 0 && (
                          <button
                            type="button"
                            disabled={Boolean(reinforcedMsgIds[msg.id])}
                            onClick={async () => {
                              setReinforcedMsgIds((prev) => ({...prev, [msg.id]: true}));
                              await onReinforceEntries(citedEntries.map((e) => e.id));
                            }}
                            className={`inline-flex min-h-[34px] items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                              reinforcedMsgIds[msg.id]
                                ? 'text-emerald-400'
                                : 'text-slate-400 hover:bg-slate-800 hover:text-emerald-300'
                            }`}
                          >
                            <ThumbsUp className="h-3.5 w-3.5" />
                            <span>{reinforcedMsgIds[msg.id] ? 'Boosted' : 'Helpful'}</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => onSaveTextToTeach('Learned from Studio Turn', msg.content)}
                          className="inline-flex min-h-[34px] items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                        >
                          <BookmarkPlus className="h-3.5 w-3.5" />
                          <span>Store</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                    {msg.content}
                  </div>

                  {(citedEntries.length > 0 || citedRepoPaths.length > 0) && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-2.5">
                      <span className="font-mono text-xs text-slate-400">Sources:</span>
                      {citedEntries.map((cited) => (
                        <button
                          key={cited.id}
                          type="button"
                          onClick={() => onInspectEntry(cited.id)}
                          className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-emerald-300 transition-colors hover:border-emerald-500/50 hover:bg-slate-800"
                        >
                          <span>{cited.title}</span>
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                      ))}
                      {citedRepoPaths.map((repoPath) => (
                        <button
                          key={repoPath}
                          type="button"
                          onClick={() => onInspectRepoFile(repoPath)}
                          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 font-mono text-xs text-sky-300 transition-colors hover:border-sky-500/50 hover:bg-slate-800"
                        >
                          <FileCode2 className="h-3.5 w-3.5" />
                          <span>{repoPath}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={scrollEndRef} />
          </div>
        )}
      </div>

      {/* Studio Composer */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-[#0F172A] p-3"
      >
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submitPrompt(false);
            }
          }}
          placeholder="Ask Mantis, teach a rule (e.g. 'Remember: always validate JWTs server-side'), or run /suggest..."
          className="min-h-[48px] w-full resize-y rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-slate-500">
            Rules with &quot;Remember:&quot;, &quot;Always&quot;, or &quot;Fix:&quot; auto-save immediately to Supabase.
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {preferBuiltInFirst && hasCloudRoute && (
              <button
                type="button"
                disabled={isSending || !input.trim()}
                onClick={() => void submitPrompt(true)}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2 text-xs font-medium text-sky-300 hover:border-sky-500/50 hover:bg-slate-800 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Send + Cloud Assist</span>
              </button>
            )}
            <button
              type="submit"
              disabled={isSending || !input.trim()}
              className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{isSending ? 'Running...' : 'Run'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
