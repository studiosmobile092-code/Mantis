import {
  ArrowDown,
  ArrowUpRight,
  BookmarkPlus,
  Check,
  Cpu,
  FileCode2,
  FolderPlus,
  GitPullRequest,
  PlusCircle,
  Radio,
  Send,
  Sparkles,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import {type FormEvent, memo, useEffect, useMemo, useRef, useState} from 'react';
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
  onQuickSaveMessage?: (suggestedTitle: string, content: string) => Promise<string | null>;
  onReinforceEntries: (entryIds: string[]) => Promise<void>;
  onOpenIngest: () => void;
  onOpenTeach: () => void;
  onOpenSuggestions: () => void;
  onOpenSettings: () => void;
}

function deriveChatTitle(text: string): string {
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) || text;
  const cleaned = firstLine.replace(/^\[.*?\]\s*/, '').replace(/^[#>*-\s]+/, '').trim();
  if (cleaned.length <= 58) return cleaned || 'Saved Studio Note';
  return `${cleaned.slice(0, 55).trim()}…`;
}

export const ChatWorkspace = memo(function ChatWorkspace({
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
  onQuickSaveMessage,
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
  const [savedMsgFolders, setSavedMsgFolders] = useState<Record<string, string>>({});
  const [savingMsgId, setSavingMsgId] = useState<string | null>(null);
  const [showJumpLatest, setShowJumpLatest] = useState(false);

  const streamRef = useRef<HTMLDivElement | null>(null);
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
    const container = streamRef.current;
    if (!container) {
      scrollEndRef.current?.scrollIntoView({behavior: 'smooth'});
      return;
    }
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < 180 || messages.length <= 2) {
      scrollEndRef.current?.scrollIntoView({behavior: 'smooth'});
      setShowJumpLatest(false);
    }
  }, [messages.length]);

  function handleStreamScroll() {
    const el = streamRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJumpLatest(distanceFromBottom > 140);
  }

  function jumpToLatest() {
    scrollEndRef.current?.scrollIntoView({behavior: 'smooth'});
    setShowJumpLatest(false);
  }

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

  async function handleQuickStore(msg: ChatMessage) {
    const title = deriveChatTitle(msg.content);
    if (!onQuickSaveMessage) {
      onSaveTextToTeach(title, msg.content);
      return;
    }
    setSavingMsgId(msg.id);
    try {
      const folderName = await onQuickSaveMessage(title, msg.content);
      if (folderName) {
        setSavedMsgFolders((prev) => ({...prev, [msg.id]: folderName}));
      }
    } finally {
      setSavingMsgId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Studio Workbench Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight text-ink">
              AI Studio Workbench
            </h1>
            <span className="font-mono text-xs text-ink-muted">
              {preferBuiltInFirst ? 'Built-in AI Leads' : 'Cloud Assist Primary'}
              {hasCloudRoute ? ` · ${brainModel.split('/').pop()}` : ''}
            </span>
          </div>
          <p className="text-xs text-ink-muted">
            Built-in rule miner, concept recall{connection ? `, and ${connection.owner}/${connection.repo}` : ''}.
            Use <code className="font-mono text-ink">/teach</code>,{' '}
            <code className="font-mono text-ink">/search</code>,{' '}
            <code className="font-mono text-ink">/suggest</code>,{' '}
            <code className="font-mono text-ink">/self-audit</code>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenIngest}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-line-strong bg-inset px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-elevated"
          >
            <Radio className="h-3.5 w-3.5 text-accent-text" />
            <span>Ingest</span>
          </button>

          <button
            type="button"
            onClick={onOpenTeach}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-line-strong bg-inset px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-elevated"
          >
            <PlusCircle className="h-3.5 w-3.5 text-accent-text" />
            <span>Teach</span>
          </button>

          <button
            type="button"
            onClick={onOpenSuggestions}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-line-strong bg-inset px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-elevated"
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
                    className="min-h-[40px] rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    {isClearing ? 'Clearing…' : 'Confirm'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="min-h-[40px] rounded-md border border-line-strong px-2.5 py-1.5 text-xs text-ink-muted hover:bg-elevated"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  aria-label="Clear conversation history"
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-line bg-inset px-2.5 py-1.5 text-xs text-ink-muted hover:border-line-strong hover:text-ink"
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
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface px-3.5 py-2 text-xs">
        <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
          <Cpu className="h-3.5 w-3.5 text-accent-text" />
          <span>
            Mode:{' '}
            <strong className="text-ink">
              {preferBuiltInFirst ? 'Built-in AI First (Instant + Auto-Mine)' : 'Cloud Assist Auto'}
            </strong>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-line bg-inset p-0.5">
            <button
              type="button"
              onClick={() => onTogglePreferBuiltIn(true)}
              className={`min-h-[34px] rounded px-2.5 text-[11px] font-medium transition-colors ${
                preferBuiltInFirst
                  ? 'bg-accent text-white'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              Built-in Leads
            </button>
            <button
              type="button"
              onClick={() => onTogglePreferBuiltIn(false)}
              className={`min-h-[34px] rounded px-2.5 text-[11px] font-medium transition-colors ${
                !preferBuiltInFirst
                  ? 'bg-elevated text-ink'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              Cloud Auto
            </button>
          </div>

          {!hasCloudRoute && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="font-mono text-[11px] text-amber-400 underline underline-offset-2 hover:opacity-90"
            >
              Setup Cloud Backup
            </button>
          )}
        </div>
      </div>

      {/* Conversation Stream */}
      <div className="relative rounded-lg border border-line bg-surface">
        <div
          ref={streamRef}
          onScroll={handleStreamScroll}
          className="max-h-[62vh] min-h-[360px] space-y-2.5 overflow-y-auto p-3.5 sm:p-4"
        >
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="space-y-2 rounded-md border border-line bg-inset p-3.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="h-3 w-28 animate-pulse rounded bg-elevated" />
                    <div className="h-3 w-16 animate-pulse rounded bg-elevated" />
                  </div>
                  <div className="h-3.5 w-4/5 animate-pulse rounded bg-elevated" />
                  <div className="h-3.5 w-2/3 animate-pulse rounded bg-elevated" />
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center space-y-4 text-center">
              <div className="space-y-1.5">
                <h2 className="text-sm font-semibold text-ink">
                  Mantis Built-in AI Workbench Ready
                </h2>
                <p className="max-w-md text-xs leading-relaxed text-ink-muted">
                  Teach rules with <code className="font-mono text-ink">Remember:</code>, query
                  trusted Knowledge or synced GitHub files, or escalate any turn to Cloud Assist.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => handleQuickPrompt(prompt)}
                    className="min-h-[40px] rounded-md border border-line-strong bg-inset px-3 py-1.5 font-mono text-xs text-ink transition-colors hover:border-accent-border hover:bg-elevated"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {messages.map((msg, idx) => {
                const isUser = msg.role === 'user';
                const citedEntries = (msg.cited_entry_ids || [])
                  .map((id) => entryMap.get(id))
                  .filter((e): e is KnowledgeEntry => Boolean(e));
                const citedRepoPaths = msg.cited_repo_paths || [];
                const prevUserMsg =
                  idx > 0 && messages[idx - 1]?.role === 'user' ? messages[idx - 1] : null;
                const isEscalating = escalatingMsgId === msg.id;
                const storedFolder = savedMsgFolders[msg.id];
                const isStoringThis = savingMsgId === msg.id;

                return (
                  <div
                    key={msg.id}
                    className={`mantis-slide-up rounded-md border px-3.5 py-3 ${
                      isUser
                        ? 'ml-auto max-w-[92%] border-line-strong bg-elevated/55 sm:max-w-[85%]'
                        : 'border-line bg-inset'
                    }`}
                  >
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
                        <span
                          className={
                            isUser ? 'font-semibold text-ink' : 'font-semibold text-accent-text'
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
                        <div className="flex items-center gap-1">
                          {onQuickSaveMessage && (
                            <button
                              type="button"
                              disabled={isStoringThis || Boolean(storedFolder)}
                              onClick={() => void handleQuickStore(msg)}
                              className={`inline-flex min-h-[34px] items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                                storedFolder
                                  ? 'text-accent-text'
                                  : 'text-ink-muted hover:bg-elevated hover:text-ink'
                              }`}
                            >
                              {storedFolder ? (
                                <>
                                  <Check className="h-3 w-3" />
                                  <span>Saved · {storedFolder}</span>
                                </>
                              ) : (
                                <>
                                  <FolderPlus className="h-3 w-3" />
                                  <span>{isStoringThis ? 'Filing…' : 'Auto-Store'}</span>
                                </>
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              onSaveTextToTeach(deriveChatTitle(msg.content), msg.content)
                            }
                            className="inline-flex min-h-[34px] items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-ink-muted hover:bg-elevated hover:text-ink"
                          >
                            <BookmarkPlus className="h-3.5 w-3.5" />
                            <span>Save Rule</span>
                          </button>
                        </div>
                      )}

                      {!isUser && (
                        <div className="flex flex-wrap items-center gap-1">
                          {prevUserMsg && !msg.content.startsWith('[Cloud Assist') && (
                            <button
                              type="button"
                              disabled={isEscalating || isSending}
                              onClick={() => void onEscalateMessageToCloud(msg.id)}
                              className="inline-flex min-h-[34px] items-center gap-1 rounded border border-line-strong bg-surface px-2.5 py-1 text-[11px] font-medium text-accent-text hover:border-accent-border disabled:opacity-50"
                            >
                              <Sparkles className="h-3 w-3" />
                              <span>{isEscalating ? 'Assisting…' : 'Ask Cloud Assist'}</span>
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
                              className={`inline-flex min-h-[34px] items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                                reinforcedMsgIds[msg.id]
                                  ? 'text-accent-text'
                                  : 'text-ink-muted hover:bg-elevated hover:text-ink'
                              }`}
                            >
                              <ThumbsUp className="h-3 w-3" />
                              <span>{reinforcedMsgIds[msg.id] ? 'Boosted' : 'Helpful'}</span>
                            </button>
                          )}

                          {onQuickSaveMessage && (
                            <button
                              type="button"
                              disabled={isStoringThis || Boolean(storedFolder)}
                              onClick={() => void handleQuickStore(msg)}
                              className={`inline-flex min-h-[34px] items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                                storedFolder
                                  ? 'text-accent-text'
                                  : 'text-ink-muted hover:bg-elevated hover:text-ink'
                              }`}
                            >
                              {storedFolder ? (
                                <>
                                  <Check className="h-3 w-3" />
                                  <span>{storedFolder}</span>
                                </>
                              ) : (
                                <>
                                  <FolderPlus className="h-3 w-3" />
                                  <span>{isStoringThis ? 'Filing…' : 'Auto-Store'}</span>
                                </>
                              )}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              onSaveTextToTeach(deriveChatTitle(msg.content), msg.content)
                            }
                            className="inline-flex min-h-[34px] items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-ink-muted hover:bg-elevated hover:text-ink"
                          >
                            <BookmarkPlus className="h-3 w-3" />
                            <span>Edit &amp; Save</span>
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">
                      {msg.content}
                    </div>

                    {(citedEntries.length > 0 || citedRepoPaths.length > 0) && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
                        <span className="font-mono text-[11px] text-ink-muted">Sources:</span>
                        {citedEntries.map((cited) => (
                          <button
                            key={cited.id}
                            type="button"
                            onClick={() => onInspectEntry(cited.id)}
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium text-accent-text transition-colors hover:border-accent-border"
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
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 py-1 font-mono text-xs text-ink transition-colors hover:border-accent-border"
                          >
                            <FileCode2 className="h-3.5 w-3.5 text-accent-text" />
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

        {showJumpLatest && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="mantis-slide-up absolute right-4 bottom-3 inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-accent-border bg-surface/95 px-3 py-1.5 text-xs font-semibold text-accent-text shadow-lg backdrop-blur-xs hover:bg-elevated"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            <span>Jump to latest</span>
          </button>
        )}
      </div>

      {/* Studio Composer */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3"
      >
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submitPrompt(false);
            }
          }}
          placeholder="Ask Mantis, teach a rule (e.g. 'Remember: always validate JWTs server-side'), or run /suggest..."
          className="min-h-[52px] w-full resize-y rounded-md border border-line-strong bg-inset px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-ink-subtle">
            Rules with &quot;Remember:&quot;, &quot;Always&quot;, or &quot;Fix:&quot; auto-save immediately to Supabase.
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {preferBuiltInFirst && hasCloudRoute && (
              <button
                type="button"
                disabled={isSending || !input.trim()}
                onClick={() => void submitPrompt(true)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-line-strong bg-inset px-3.5 py-2 text-xs font-medium text-accent-text hover:border-accent-border disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Send + Cloud Assist</span>
              </button>
            )}
            <button
              type="submit"
              disabled={isSending || !input.trim()}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-accent px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{isSending ? 'Running…' : 'Run'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
});
