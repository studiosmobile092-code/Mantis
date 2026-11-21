import {
  ArrowDown,
  ArrowUpRight,
  BookmarkPlus,
  Check,
  Compass,
  Copy,
  Crosshair,
  FileCode2,
  FolderPlus,
  GitPullRequest,
  GraduationCap,
  PlusCircle,
  Radio,
  Scale,
  Send,
  Sparkles,
  Terminal,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import {type FormEvent, memo, useEffect, useMemo, useRef, useState} from 'react';
import type {
  AssassinPrepBrief,
  BrainRouteStatus,
  ChatMessage,
  GitHubConnection,
  KnowledgeEntry,
  KnowledgeFolder,
  KnowledgeGrowthStats,
  RepoFile,
} from '../types/mantis';
import {AssassinBriefCard} from './AssassinBriefCard';
import {ConceptGraphCanvas} from './ConceptGraphCanvas';

export type StudioComposerMode = 'scratch' | 'cloud' | 'distill' | 'assassin';

interface ChatWorkspaceProps {
  messages: ChatMessage[];
  entries: KnowledgeEntry[];
  folders: KnowledgeFolder[];
  repoFiles: RepoFile[];
  growth: KnowledgeGrowthStats;
  connection: GitHubConnection | null;
  routeStatus: BrainRouteStatus;
  preferBuiltInFirst: boolean;
  onTogglePreferBuiltIn: (next: boolean) => void;
  brainModel: string;
  isLoading: boolean;
  isSending: boolean;
  escalatingMsgId: string | null;
  distillingMsgId: string | null;
  activeTab: 'stream' | 'graph';
  onChangeTab: (tab: 'stream' | 'graph') => void;
  activeAssassinBrief: AssassinPrepBrief | null;
  onApproveAssassinBrief: (brief: AssassinPrepBrief) => Promise<void>;
  onRejectAssassinBrief: (brief: AssassinPrepBrief) => void;
  composerPrefill?: string;
  onConsumeComposerPrefill?: () => void;
  onSendMessage: (
    prompt: string,
    modeOverride?: StudioComposerMode,
  ) => Promise<void>;
  onEscalateMessageToCloud: (msgId: string) => Promise<void>;
  onDistillMessageWithTeacher: (msgId: string) => Promise<void>;
  onSendToArena: (prompt: string) => void;
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

function renderInlineProse(text: string) {
  const tokens = text.split(/(`[^`\n]+`)/g);
  return tokens.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code
          key={i}
          className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[12px] text-accent-text"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function RichMessageContent({content}: {content: string}) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const blocks = useMemo(() => {
    const parts: Array<{type: 'prose' | 'code'; text: string; lang?: string}> = [];
    const fenceRe = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null = null;
    while ((match = fenceRe.exec(content)) !== null) {
      if (match.index > lastIdx) {
        parts.push({type: 'prose', text: content.slice(lastIdx, match.index)});
      }
      parts.push({
        type: 'code',
        lang: match[1] || 'code',
        text: match[2].replace(/\n$/, ''),
      });
      lastIdx = fenceRe.lastIndex;
    }
    if (lastIdx < content.length) {
      parts.push({type: 'prose', text: content.slice(lastIdx)});
    }
    return parts.length > 0 ? parts : [{type: 'prose' as const, text: content}];
  }, [content]);

  async function handleCopyCode(text: string, idx: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(idx);
      window.setTimeout(() => setCopiedIndex(null), 1800);
    } catch {
      // ignore clipboard errors
    }
  }

  return (
    <div className="space-y-3 text-[14px] leading-relaxed text-ink">
      {blocks.map((block, idx) =>
        block.type === 'code' ? (
          <div
            key={idx}
            className="overflow-hidden rounded-md border border-line-strong bg-inset"
          >
            <div className="flex items-center justify-between border-b border-line bg-surface px-3 py-1.5">
              <span className="font-mono text-[11px] font-medium text-ink-muted">
                {block.lang || 'code'}
              </span>
              <button
                type="button"
                onClick={() => void handleCopyCode(block.text, idx)}
                className="inline-flex min-h-[32px] items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-ink-muted hover:bg-elevated hover:text-ink"
              >
                {copiedIndex === idx ? (
                  <Check className="h-3 w-3 text-accent-text" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                <span>{copiedIndex === idx ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-ink">
              <code>{block.text}</code>
            </pre>
          </div>
        ) : (
          <div key={idx} className="whitespace-pre-wrap">
            {renderInlineProse(block.text)}
          </div>
        ),
      )}
    </div>
  );
}

const STREAM_WINDOW_SIZE = 60;

export const ChatWorkspace = memo(function ChatWorkspace({
  messages,
  entries,
  folders,
  repoFiles,
  growth,
  connection,
  routeStatus,
  preferBuiltInFirst,
  onTogglePreferBuiltIn,
  brainModel,
  isLoading,
  isSending,
  escalatingMsgId,
  distillingMsgId,
  activeTab,
  onChangeTab,
  activeAssassinBrief,
  onApproveAssassinBrief,
  onRejectAssassinBrief,
  composerPrefill,
  onConsumeComposerPrefill,
  onSendMessage,
  onEscalateMessageToCloud,
  onDistillMessageWithTeacher,
  onSendToArena,
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
  const [composerMode, setComposerMode] = useState<StudioComposerMode>(
    preferBuiltInFirst ? 'scratch' : 'cloud',
  );
  const [visibleCount, setVisibleCount] = useState(STREAM_WINDOW_SIZE);
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
    setComposerMode((prev) =>
      prev === 'assassin' || prev === 'distill'
        ? prev
        : preferBuiltInFirst
          ? 'scratch'
          : 'cloud',
    );
  }, [preferBuiltInFirst]);

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

  const windowedMessages = useMemo(() => {
    if (messages.length <= visibleCount) return messages;
    return messages.slice(messages.length - visibleCount);
  }, [messages, visibleCount]);

  const quickPrompts = useMemo(() => {
    const base = [
      'hi',
      '1+1',
      'What do you know so far?',
      '/search supabase',
    ];
    if (connection) {
      base.push('/execute Improve error handling and RAM safety in App.tsx');
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

  async function submitPrompt(modeOverride?: StudioComposerMode) {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;
    setInput('');
    await onSendMessage(trimmed, modeOverride ?? composerMode);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await submitPrompt();
  }

  async function handleQuickPrompt(prompt: string) {
    if (prompt.startsWith('/teach ') || prompt.startsWith('Remember:')) {
      setInput(prompt);
      return;
    }
    if (isSending) return;
    await onSendMessage(prompt, prompt.startsWith('/execute ') ? 'assassin' : composerMode);
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
      {/* VS Code Tabbed Workbench Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onChangeTab('stream')}
            className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'stream'
                ? 'bg-elevated text-ink border border-line-strong'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            <Terminal className="h-3.5 w-3.5 text-accent-text" />
            <span>Studio Stream</span>
          </button>

          <button
            type="button"
            onClick={() => onChangeTab('graph')}
            className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'graph'
                ? 'bg-elevated text-ink border border-line-strong'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            <Compass className="h-3.5 w-3.5 text-accent-text" />
            <span>Concept Graph</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenIngest}
            className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink-muted hover:border-line-strong hover:text-ink"
          >
            <Radio className="h-3.5 w-3.5 text-accent-text" />
            <span>Capture</span>
          </button>
          <button
            type="button"
            onClick={onOpenTeach}
            className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink-muted hover:border-line-strong hover:text-ink"
          >
            <PlusCircle className="h-3.5 w-3.5 text-accent-text" />
            <span>Teach</span>
          </button>
          <button
            type="button"
            onClick={onOpenSuggestions}
            className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink-muted hover:border-line-strong hover:text-ink"
          >
            <GitPullRequest className="h-3.5 w-3.5 text-amber-400" />
            <span>Diffs</span>
          </button>
          {messages.length > 0 && activeTab === 'stream' && (
            confirmClear ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={isClearing}
                  onClick={handleConfirmClear}
                  className="min-h-[36px] rounded bg-red-600 px-2.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {isClearing ? 'Clearing…' : 'Confirm'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="min-h-[36px] rounded border border-line px-2 text-xs text-ink-muted hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                aria-label="Clear stream"
                className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-md border border-line bg-surface px-2.5 text-xs text-ink-muted hover:border-line-strong hover:text-ink"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Clear</span>
              </button>
            )
          )}
        </div>
      </div>

      {activeTab === 'graph' ? (
        <ConceptGraphCanvas
          entries={entries}
          folders={folders}
          repoFiles={repoFiles}
          growth={growth}
          onQueryConcept={(label) => {
            onChangeTab('stream');
            setInput(`/search ${label}`);
          }}
          onInspectEntry={onInspectEntry}
          onInspectRepoFile={onInspectRepoFile}
        />
      ) : (
        <>
          {/* Smart-Assassin Execution Brief (Inline Approval Gate) */}
          {activeAssassinBrief && (
            <AssassinBriefCard
              brief={activeAssassinBrief}
              onApprove={onApproveAssassinBrief}
              onReject={onRejectAssassinBrief}
            />
          )}

          {/* Grok Clean Editorial Canvas Stream (Zero Speech Bubbles) */}
          <div className="relative rounded-lg border border-line bg-surface/40">
            <div
              ref={streamRef}
              onScroll={handleStreamScroll}
              className="max-h-[60vh] min-h-[380px] overflow-y-auto px-4 py-4 sm:px-6"
            >
              <div className="mx-auto max-w-[78ch]">
                {isLoading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map((n) => (
                      <div key={n} className="space-y-2 border-b border-line pb-4">
                        <div className="h-3 w-24 rounded bg-elevated" />
                        <div className="h-3.5 w-4/5 rounded bg-elevated" />
                        <div className="h-3.5 w-2/3 rounded bg-elevated" />
                      </div>
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex min-h-[320px] flex-col items-center justify-center space-y-5 text-center">
                    <div className="space-y-1.5">
                      <h1 className="text-lg font-semibold tracking-tight text-ink">
                        Mantis Precision AI Studio
                      </h1>
                      <p className="mx-auto max-w-md text-xs leading-relaxed text-ink-muted">
                        Scratch AI answers instantly via Hybrid RAG &amp; Safe Math. When Scratch lacks coverage, the Teacher Brain distills permanent skills offline. Use{' '}
                        <code className="font-mono text-ink">/execute</code> for Smart-Assassin parallel code prep.
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                      {quickPrompts.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => void handleQuickPrompt(prompt)}
                          className="min-h-[40px] rounded-md border border-line-strong bg-inset px-3 py-1.5 font-mono text-xs text-ink transition-colors hover:border-accent-border hover:bg-elevated"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div>
                    {messages.length > visibleCount && (
                      <div className="mb-4 flex justify-center border-b border-line pb-3">
                        <button
                          type="button"
                          onClick={() => setVisibleCount((c) => c + 60)}
                          className="min-h-[36px] rounded-md border border-line bg-inset px-3 text-xs font-medium text-ink-muted hover:text-ink"
                        >
                          Load earlier turns ({messages.length - visibleCount} older)
                        </button>
                      </div>
                    )}

                    {windowedMessages.map((msg, idx) => {
                      const isUser = msg.role === 'user';
                      const citedEntries = (msg.cited_entry_ids || [])
                        .map((id) => entryMap.get(id))
                        .filter((e): e is KnowledgeEntry => Boolean(e));
                      const citedRepoPaths = msg.cited_repo_paths || [];
                      const prevUserMsg =
                        idx > 0 && windowedMessages[idx - 1]?.role === 'user'
                          ? windowedMessages[idx - 1]
                          : null;
                      const isEscalating = escalatingMsgId === msg.id;
                      const isDistilling = distillingMsgId === msg.id;
                      const storedFolder = savedMsgFolders[msg.id];
                      const isStoringThis = savingMsgId === msg.id;

                      return (
                        <article
                          key={msg.id}
                          className={`mantis-virtual-item border-b border-line py-4 last:border-b-0 ${
                            isUser ? 'bg-inset/35 -mx-3 px-3 rounded-md' : ''
                          }`}
                        >
                          {/* Subtle Author + Timestamp Row */}
                          <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
                              <span
                                className={
                                  isUser
                                    ? 'font-semibold text-ink'
                                    : 'font-semibold text-accent-text'
                                }
                              >
                                {isUser ? 'Operator' : 'Mantis'}
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
                                    className={`inline-flex min-h-[34px] items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
                                      storedFolder
                                        ? 'text-accent-text'
                                        : 'text-ink-subtle hover:text-ink'
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
                                        <span>{isStoringThis ? 'Filing…' : 'Store'}</span>
                                      </>
                                    )}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    onSaveTextToTeach(deriveChatTitle(msg.content), msg.content)
                                  }
                                  className="inline-flex min-h-[34px] items-center gap-1 rounded px-2 text-[11px] font-medium text-ink-subtle hover:text-ink"
                                >
                                  <BookmarkPlus className="h-3 w-3" />
                                  <span>Rule</span>
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
                                    className="inline-flex min-h-[34px] items-center gap-1 rounded border border-line bg-surface px-2 text-[11px] font-medium text-accent-text hover:border-accent-border disabled:opacity-50"
                                  >
                                    <Sparkles className="h-3 w-3" />
                                    <span>{isEscalating ? 'Assisting…' : 'Cloud Assist'}</span>
                                  </button>
                                )}

                                {prevUserMsg && (
                                  <button
                                    type="button"
                                    disabled={isDistilling || isSending}
                                    onClick={() => void onDistillMessageWithTeacher(msg.id)}
                                    className="inline-flex min-h-[34px] items-center gap-1 rounded border border-line bg-surface px-2 text-[11px] font-medium text-ink-muted hover:border-line-strong hover:text-ink disabled:opacity-50"
                                  >
                                    <GraduationCap className="h-3 w-3 text-accent-text" />
                                    <span>{isDistilling ? 'Teaching…' : 'Teach Scratch'}</span>
                                  </button>
                                )}

                                {prevUserMsg && (
                                  <button
                                    type="button"
                                    onClick={() => onSendToArena(prevUserMsg.content)}
                                    className="inline-flex min-h-[34px] items-center gap-1 rounded px-2 text-[11px] font-medium text-ink-subtle hover:text-ink"
                                  >
                                    <Scale className="h-3 w-3" />
                                    <span>Arena</span>
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
                                    className={`inline-flex min-h-[34px] items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
                                      reinforcedMsgIds[msg.id]
                                        ? 'text-accent-text'
                                        : 'text-ink-subtle hover:text-ink'
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
                                    className={`inline-flex min-h-[34px] items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
                                      storedFolder
                                        ? 'text-accent-text'
                                        : 'text-ink-subtle hover:text-ink'
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
                                        <span>{isStoringThis ? 'Filing…' : 'Store'}</span>
                                      </>
                                    )}
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() =>
                                    onSaveTextToTeach(deriveChatTitle(msg.content), msg.content)
                                  }
                                  className="inline-flex min-h-[34px] items-center gap-1 rounded px-2 text-[11px] font-medium text-ink-subtle hover:text-ink"
                                >
                                  <BookmarkPlus className="h-3 w-3" />
                                  <span>Edit</span>
                                </button>
                              </div>
                            )}
                          </header>

                          {/* Editorial Prose Body */}
                          <RichMessageContent content={msg.content} />

                          {/* Compact Inline Citations */}
                          {(citedEntries.length > 0 || citedRepoPaths.length > 0) && (
                            <footer className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-mono text-[11px] text-ink-subtle">
                                Grounded:
                              </span>
                              {citedEntries.map((cited) => (
                                <button
                                  key={cited.id}
                                  type="button"
                                  onClick={() => onInspectEntry(cited.id)}
                                  className="inline-flex min-h-[32px] items-center gap-1 rounded border border-line bg-inset px-2 py-0.5 text-xs font-medium text-accent-text hover:border-accent-border"
                                >
                                  <span>{cited.title}</span>
                                  <ArrowUpRight className="h-3 w-3" />
                                </button>
                              ))}
                              {citedRepoPaths.map((repoPath) => (
                                <button
                                  key={repoPath}
                                  type="button"
                                  onClick={() => onInspectRepoFile(repoPath)}
                                  className="inline-flex min-h-[32px] items-center gap-1 rounded border border-line bg-inset px-2 py-0.5 font-mono text-[11px] text-ink hover:border-accent-border"
                                >
                                  <FileCode2 className="h-3 w-3 text-accent-text" />
                                  <span>{repoPath}</span>
                                </button>
                              ))}
                            </footer>
                          )}
                        </article>
                      );
                    })}
                    <div ref={scrollEndRef} />
                  </div>
                )}
              </div>
            </div>

            {showJumpLatest && (
              <button
                type="button"
                onClick={jumpToLatest}
                className="mantis-slide-up absolute right-4 bottom-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-accent-border bg-surface/95 px-3 py-1 text-xs font-semibold text-accent-text shadow-lg backdrop-blur-xs hover:bg-elevated"
              >
                <ArrowDown className="h-3.5 w-3.5" />
                <span>Latest</span>
              </button>
            )}
          </div>

          {/* Grok-Style Clean Anchored Omnibar Composer */}
          <form
            onSubmit={handleSubmit}
            className="mx-auto w-full max-w-[82ch] rounded-xl border border-line-strong bg-surface p-3 shadow-sm"
          >
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submitPrompt();
                }
              }}
              placeholder={
                composerMode === 'assassin'
                  ? 'Describe a code goal for Smart-Assassin parallel prep (/execute automatically applied)…'
                  : 'Ask Scratch AI, teach with Remember:, or run /execute, /suggest, /self-audit…'
              }
              className="min-h-[48px] w-full resize-none bg-transparent px-1.5 py-1 text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
            />

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
              {/* Inline Mode Selector */}
              <div className="flex flex-wrap items-center gap-1">
                {(
                  [
                    {id: 'scratch', label: 'Scratch Leads'},
                    {id: 'cloud', label: 'Cloud Assist'},
                    {id: 'distill', label: 'Teacher Distill'},
                    {id: 'assassin', label: 'Assassin'},
                  ] as const
                ).map((mode) => {
                  const active = composerMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => {
                        setComposerMode(mode.id);
                        if (mode.id === 'scratch') onTogglePreferBuiltIn(true);
                        if (mode.id === 'cloud') onTogglePreferBuiltIn(false);
                      }}
                      className={`inline-flex min-h-[36px] shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2.5 text-[11px] font-medium transition-colors ${
                        active
                          ? 'bg-accent-soft text-accent-text border border-accent-border'
                          : 'text-ink-muted hover:bg-elevated hover:text-ink'
                      }`}
                    >
                      {mode.id === 'assassin' && <Crosshair className="h-3 w-3" />}
                      {mode.id === 'distill' && <GraduationCap className="h-3 w-3" />}
                      {mode.id === 'cloud' && <Sparkles className="h-3 w-3" />}
                      <span>{mode.label}</span>
                    </button>
                  );
                })}

                {!hasCloudRoute && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="ml-1 font-mono text-[11px] text-amber-400 underline underline-offset-2 hover:opacity-90"
                  >
                    Connect Cloud ({brainModel.split('/').pop()})
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={isSending || !input.trim()}
                className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                <span>
                  {isSending
                    ? 'Executing…'
                    : composerMode === 'assassin'
                      ? 'Prep Brief'
                      : 'Execute'}
                </span>
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
});
