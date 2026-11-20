import {ArrowUpRight, BookmarkPlus, Cpu, FileCode2, Send, ThumbsUp, Trash2} from 'lucide-react';
import {type FormEvent, useEffect, useMemo, useRef, useState} from 'react';
import type {ChatMessage, GitHubConnection, KnowledgeEntry} from '../types/mantis';

interface ChatWorkspaceProps {
  messages: ChatMessage[];
  entries: KnowledgeEntry[];
  connection: GitHubConnection | null;
  brainConnected: boolean;
  brainModel: string;
  isLoading: boolean;
  isSending: boolean;
  onSendMessage: (prompt: string) => Promise<void>;
  onClearChat: () => Promise<void>;
  onInspectEntry: (entryId: string) => void;
  onInspectRepoFile: (filePath: string) => void;
  onSaveTextToTeach: (suggestedTitle: string, content: string) => void;
  onReinforceEntries: (entryIds: string[]) => Promise<void>;
  onOpenSettings: () => void;
}

export function ChatWorkspace({
  messages,
  entries,
  connection,
  brainConnected,
  brainModel,
  isLoading,
  isSending,
  onSendMessage,
  onClearChat,
  onInspectEntry,
  onInspectRepoFile,
  onSaveTextToTeach,
  onReinforceEntries,
  onOpenSettings,
}: ChatWorkspaceProps) {
  const [input, setInput] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [reinforcedMsgIds, setReinforcedMsgIds] = useState<Record<string, boolean>>({});
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  const entryMap = useMemo(
    () => new Map<string, KnowledgeEntry>(entries.map((e) => [e.id, e])),
    [entries],
  );

  const quickPrompts = useMemo(() => {
    const base = [
      'What have I taught you so far?',
      '/teach Coding Rule :: Keep secret keys out of frontend code',
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

  async function submitPrompt() {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;
    setInput('');
    await onSendMessage(trimmed);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await submitPrompt();
  }

  async function handleQuickPrompt(prompt: string) {
    if (prompt.startsWith('/teach ')) {
      setInput(prompt);
      return;
    }
    if (isSending) return;
    await onSendMessage(prompt);
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
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-800 pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">Chat / Work</h1>
            {brainConnected ? (
              <span className="inline-flex items-center gap-1.5 font-mono text-xs text-emerald-400">
                <Cpu className="h-3.5 w-3.5" />
                <span>{brainModel.split('/').pop()}</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex items-center gap-1.5 font-mono text-xs text-amber-300 underline underline-offset-2 hover:text-amber-200"
              >
                <Cpu className="h-3.5 w-3.5" />
                <span>Memory Mode (Connect AI Brain in Settings)</span>
              </button>
            )}
          </div>
          <p className="text-sm text-slate-400">
            Searches your Knowledge folders{connection ? ` and ${connection.owner}/${connection.repo}` : ''}.
            Use <code className="font-mono text-xs text-slate-200">/search</code>,{' '}
            <code className="font-mono text-xs text-slate-200">/repo</code>,{' '}
            <code className="font-mono text-xs text-slate-200">/suggest</code>,{' '}
            <code className="font-mono text-xs text-slate-200">/self-audit</code>, or{' '}
            <code className="font-mono text-xs text-slate-200">/teach Title :: Note</code>.
          </p>
        </div>

        {messages.length > 0 && (
          <div className="flex items-center gap-2">
            {confirmClear ? (
              <>
                <button
                  type="button"
                  disabled={isClearing}
                  onClick={handleConfirmClear}
                  className="min-h-[40px] rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {isClearing ? 'Clearing...' : 'Confirm Clear'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="min-h-[40px] rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-400 hover:border-slate-700 hover:text-slate-200"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear History</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Conversation History */}
      <div className="min-h-[360px] space-y-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((n) => (
              <div
                key={n}
                className="h-20 animate-pulse rounded-md border border-slate-800 bg-slate-900"
              />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex min-h-[280px] flex-col items-center justify-center space-y-4 text-center">
            <div className="space-y-1.5">
              <h2 className="text-sm font-semibold text-slate-200">
                Mantis Memory &amp; Repo Chat Ready
              </h2>
              <p className="max-w-md text-xs leading-relaxed text-slate-400">
                Ask about your saved knowledge notes or any indexed file in your connected GitHub
                repository. Conversations persist in Supabase across devices.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => handleQuickPrompt(prompt)}
                  className="min-h-[40px] rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-200 transition-colors hover:border-emerald-500/60 hover:bg-slate-800"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              const citedEntries = (msg.cited_entry_ids || [])
                .map((id) => entryMap.get(id))
                .filter((e): e is KnowledgeEntry => Boolean(e));
              const citedRepoPaths = msg.cited_repo_paths || [];

              return (
                <div
                  key={msg.id}
                  className={`rounded-lg border p-4 ${
                    isUser
                      ? 'border-slate-700 bg-slate-800/80'
                      : 'border-slate-800 bg-[#0B1120]'
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
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
                        <span>Save as Knowledge</span>
                      </button>
                    )}

                    {!isUser && (
                      <div className="flex items-center gap-1.5">
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
                            <span>{reinforcedMsgIds[msg.id] ? 'Reinforced' : 'Helpful'}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onSaveTextToTeach('Learned from Mantis Chat', msg.content)}
                          className="inline-flex min-h-[34px] items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                        >
                          <BookmarkPlus className="h-3.5 w-3.5" />
                          <span>Remember</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                    {msg.content}
                  </div>

                  {(citedEntries.length > 0 || citedRepoPaths.length > 0) && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
                      <span className="font-mono text-xs text-slate-400">Sources:</span>
                      {citedEntries.map((cited) => (
                        <button
                          key={cited.id}
                          type="button"
                          onClick={() => onInspectEntry(cited.id)}
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-emerald-300 transition-colors hover:border-emerald-500/50 hover:bg-slate-800"
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
                          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 font-mono text-xs text-sky-300 transition-colors hover:border-sky-500/50 hover:bg-slate-800"
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

      {/* Composer */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3 sm:flex-row sm:items-end"
      >
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submitPrompt();
            }
          }}
          placeholder="Ask about your Knowledge notes or connected GitHub repo..."
          className="min-h-[48px] flex-1 resize-y rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={isSending || !input.trim()}
          className="inline-flex min-h-[46px] shrink-0 items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          <span>{isSending ? 'Saving...' : 'Send'}</span>
        </button>
      </form>
    </div>
  );
}
