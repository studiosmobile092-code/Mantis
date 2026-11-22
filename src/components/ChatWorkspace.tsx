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
  MoreHorizontal,
  PlusCircle,
  Scale,
  Send,
  Sparkles,
  Terminal,
  ThumbsUp,
  Trash2,
  Wrench,
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
import {OnboardingGuide} from './OnboardingGuide';

export type StudioComposerMode = 'scratch' | 'cloud' | 'distill' | 'assassin';

const SLASH_COMMANDS: Array<{cmd: string; template: string; desc: string}> = [
  {cmd: '/search', template: '/search ', desc: 'Search Hybrid BM25 + Int8 Knowledge memory'},
  {cmd: '/repo', template: '/repo ', desc: 'Search synced GitHub repository files'},
  {cmd: '/teach', template: '/teach Title :: ', desc: 'Save a Trusted rule with auto-folder classification'},
  {cmd: '/execute', template: '/execute ', desc: 'Parallel patch prep + static safety gate'},
  {cmd: '/suggest', template: '/suggest ', desc: 'Propose an approval-gated diff for a file'},
  {cmd: '/self-audit', template: '/self-audit', desc: 'Scan Mantis codebase for safety & health'},
];

function isLowConfidenceReply(content: string): boolean {
  return (
    content.includes('[Low Confidence') ||
    content.includes('found no high-confidence stored skill') ||
    content.includes('found no stored skill or knowledge entry') ||
    content.includes('[Scratch Fallback')
  );
}

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
  onTeachScratchFix?: (userPrompt: string, correctedAnswer: string) => Promise<boolean>;
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
  showOnboarding?: boolean;
  onOpenKnowledge?: () => void;
  onDismissOnboarding?: () => void;
}

function deriveChatTitle(text: string): string {
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) || text;
  const cleaned = firstLine.replace(/^\[.*?\]\s*/, '').replace(/^[#>*-\s]+/, '').trim();
  if (cleaned.length <= 58) return cleaned || 'Saved Studio Note';
  return `${cleaned.slice(0, 55).trim()}…`;
}

function renderInlineProse(text: string) {
  const tokens = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|_[^_\n]+_)/g);
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
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={i} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('_') && part.endsWith('_') && part.length >= 3) {
      return (
        <em key={i} className="italic text-ink-muted">
          {part.slice(1, -1)}
        </em>
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
    <div className="mantis-prose space-y-3 text-[14px] leading-relaxed text-ink">
      {blocks.map((block, idx) =>
        block.type === 'code' ? (
          <div
            key={idx}
            className="overflow-hidden rounded-md border border-line bg-inset"
          >
            <div className="flex items-center justify-between border-b border-line bg-surface px-3 py-1">
              <span className="font-mono text-[11px] font-medium text-ink-muted">
                {block.lang || 'code'}
              </span>
              <button
                type="button"
                onClick={() => void handleCopyCode(block.text, idx)}
                className="inline-flex min-h-[36px] items-center gap-1 rounded px-2 text-xs font-medium text-ink-muted hover:bg-elevated hover:text-ink"
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
  onTeachScratchFix,
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
  showOnboarding = false,
  onOpenKnowledge,
  onDismissOnboarding,
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

  // Per-turn overflow menu + copy confirmation
  const [openMenuMsgId, setOpenMenuMsgId] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  // Low-confidence inline feedback/fix state
  const [fixingMsgId, setFixingMsgId] = useState<string | null>(null);
  const [fixDraft, setFixDraft] = useState('');
  const [isSavingFix, setIsSavingFix] = useState(false);
  const [fixedMsgIds, setFixedMsgIds] = useState<Record<string, boolean>>({});

  // Slash command palette state
  const [slashIndex, setSlashIndex] = useState(0);
  const [forceSlashMenu, setForceSlashMenu] = useState(false);

  const streamRef = useRef<HTMLDivElement | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
      window.setTimeout(() => textareaRef.current?.focus(), 20);
    }
  }, [composerPrefill, onConsumeComposerPrefill]);

  // Dismiss overflow menu on outside pointer click or Escape
  useEffect(() => {
    if (!openMenuMsgId) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-turn-menu]')) return;
      setOpenMenuMsgId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenuMsgId(null);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('touchstart', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('touchstart', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenuMsgId]);

  const entryMap = useMemo(
    () => new Map<string, KnowledgeEntry>(entries.map((e) => [e.id, e])),
    [entries],
  );

  const trustedCount = useMemo(
    () => entries.filter((e) => e.status === 'trusted').length,
    [entries],
  );

  const messageIndexById = useMemo(() => {
    const map = new Map<string, number>();
    messages.forEach((m, i) => map.set(m.id, i));
    return map;
  }, [messages]);

  const lastUserPrompt = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') return messages[i].content;
    }
    return '';
  }, [messages]);

  const matchingSlashCommands = useMemo(() => {
    const trimmedStart = input.trimStart();
    if (
      !forceSlashMenu &&
      (!trimmedStart.startsWith('/') || trimmedStart.includes(' ') || trimmedStart.includes('\n'))
    ) {
      return [];
    }
    const prefix = trimmedStart.toLowerCase();
    return SLASH_COMMANDS.filter((item) =>
      forceSlashMenu && !prefix.startsWith('/') ? true : item.cmd.startsWith(prefix),
    );
  }, [input, forceSlashMenu]);

  useEffect(() => {
    setSlashIndex(0);
  }, [matchingSlashCommands.length]);

  const windowedMessages = useMemo(() => {
    if (messages.length <= visibleCount) return messages;
    return messages.slice(messages.length - visibleCount);
  }, [messages, visibleCount]);

  const quickPrompts = useMemo(() => {
    const base = ['hi', '1+1', 'What do you know so far?', '/search supabase'];
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

  async function handleCopyMessage(msg: ChatMessage) {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedMsgId(msg.id);
      window.setTimeout(() => setCopiedMsgId(null), 1600);
    } catch {
      // ignore clipboard errors
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Slim Sub-Bar (Pinned Top of Workbench) */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line bg-inset px-3 sm:px-5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onChangeTab('stream')}
            className={`inline-flex min-h-[36px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors ${
              activeTab === 'stream'
                ? 'bg-elevated text-ink'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            <Terminal className="h-3.5 w-3.5 text-accent-text" />
            <span>Stream</span>
          </button>

          <button
            type="button"
            onClick={() => onChangeTab('graph')}
            className={`inline-flex min-h-[36px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors ${
              activeTab === 'graph'
                ? 'bg-elevated text-ink'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            <Compass className="h-3.5 w-3.5 text-accent-text" />
            <span>Graph</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onOpenTeach}
            className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            <PlusCircle className="h-3.5 w-3.5 text-accent-text" />
            <span>Teach</span>
          </button>
          <button
            type="button"
            onClick={onOpenSuggestions}
            className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            <GitPullRequest className="h-3.5 w-3.5 text-ink-muted" />
            <span className="hidden sm:inline">Diffs</span>
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
                className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-md px-2.5 text-xs text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Clear</span>
              </button>
            )
          )}
        </div>
      </div>

      {activeTab === 'graph' ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          <div className="mx-auto max-w-6xl">
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
          </div>
        </div>
      ) : (
        <>
          {/* Single Scrollable Stream Area */}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div
              ref={streamRef}
              onScroll={handleStreamScroll}
              className="h-full overflow-y-auto px-3 py-4 sm:px-6"
            >
              <div className="mx-auto max-w-[76ch] space-y-4">
                {activeAssassinBrief && (
                  <AssassinBriefCard
                    brief={activeAssassinBrief}
                    onApprove={onApproveAssassinBrief}
                    onReject={onRejectAssassinBrief}
                  />
                )}

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
                  <div className="flex flex-col items-center justify-center space-y-5 py-8 text-center">
                    <div className="space-y-2">
                      <h1 className="text-lg font-semibold tracking-tight text-ink">
                        Mantis Training Workbench
                      </h1>
                      <p className="mx-auto max-w-lg text-xs leading-relaxed text-ink-muted">
                        Your local student starts with zero built-in world knowledge and learns strictly from what you teach, distill from your Teacher model, and verify. Use{' '}
                        <code className="font-mono text-ink">/execute</code> for parallel patch staging.
                      </p>
                    </div>

                    <div className="flex flex-wrap justify-center gap-2">
                      {quickPrompts.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => void handleQuickPrompt(prompt)}
                          className="min-h-[40px] rounded-md border border-line bg-surface px-3 py-1.5 font-mono text-xs text-ink transition-colors hover:border-line-strong hover:bg-elevated"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>

                    {showOnboarding && onOpenKnowledge && onDismissOnboarding && (
                      <OnboardingGuide
                        knowledgeCount={entries.length}
                        trustedCount={trustedCount}
                        hasInteractedChat={messages.length > 0}
                        onTeachFirstRule={onOpenTeach}
                        onOpenKnowledge={onOpenKnowledge}
                        onOpenCapture={onOpenIngest}
                        onDismiss={onDismissOnboarding}
                      />
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-line">
                    {messages.length > visibleCount && (
                      <div className="flex justify-center pb-4">
                        <button
                          type="button"
                          onClick={() => setVisibleCount((c) => c + 60)}
                          className="min-h-[40px] rounded-md border border-line bg-surface px-3.5 text-xs font-medium text-ink-muted hover:text-ink"
                        >
                          Load earlier turns ({messages.length - visibleCount} older)
                        </button>
                      </div>
                    )}

                    {windowedMessages.map((msg) => {
                      const isUser = msg.role === 'user';
                      const citedEntries = (msg.cited_entry_ids || [])
                        .map((id) => entryMap.get(id))
                        .filter((e): e is KnowledgeEntry => Boolean(e));
                      const citedRepoPaths = msg.cited_repo_paths || [];

                      let prevUserMsg: ChatMessage | null = null;
                      if (!isUser) {
                        const fullIdx = messageIndexById.get(msg.id) ?? -1;
                        for (let back = fullIdx - 1; back >= 0; back -= 1) {
                          if (messages[back]?.role === 'user') {
                            prevUserMsg = messages[back];
                            break;
                          }
                        }
                      }

                      const isLowConf = !isUser && isLowConfidenceReply(msg.content);
                      const isEscalating = escalatingMsgId === msg.id;
                      const isDistilling = distillingMsgId === msg.id;
                      const storedFolder = savedMsgFolders[msg.id];
                      const isStoringThis = savingMsgId === msg.id;
                      const isMenuOpen = openMenuMsgId === msg.id;

                      const canCloudAssist =
                        !isUser && Boolean(prevUserMsg) && !msg.content.startsWith('[Cloud Assist');
                      const primaryAssistantAction = isLowConf
                        ? 'distill'
                        : canCloudAssist
                          ? 'cloud'
                          : prevUserMsg
                            ? 'distill'
                            : null;

                      return (
                        <article
                          key={msg.id}
                          className={`mantis-virtual-item py-4 first:pt-1 ${
                            isUser ? 'rounded-md bg-surface/60 px-3.5' : ''
                          }`}
                        >
                          {/* Unboxed Metadata + Clean Single Action + Overflow Menu */}
                          <header className="mb-2 flex items-center justify-between gap-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-2 font-mono text-[11px] text-ink-muted">
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
                              {isLowConf && !fixedMsgIds[msg.id] && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-warn">
                                    Low confidence · teach needed
                                  </span>
                                </>
                              )}
                              {fixedMsgIds[msg.id] && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-accent-text">Skill taught</span>
                                </>
                              )}
                              {storedFolder && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-accent-text">Saved to {storedFolder}</span>
                                </>
                              )}
                            </div>

                            <div className="relative flex shrink-0 items-center gap-1" data-turn-menu>
                              {!isUser && primaryAssistantAction === 'distill' && prevUserMsg && (
                                <button
                                  type="button"
                                  disabled={isDistilling || isSending}
                                  onClick={() => void onDistillMessageWithTeacher(msg.id)}
                                  className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                                    isLowConf
                                      ? 'border-warn-border bg-warn-soft text-warn hover:bg-surface'
                                      : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink'
                                  }`}
                                >
                                  <GraduationCap className="h-3.5 w-3.5" />
                                  <span>{isDistilling ? 'Teaching…' : 'Teach Student'}</span>
                                </button>
                              )}

                              {!isUser && primaryAssistantAction === 'cloud' && (
                                <button
                                  type="button"
                                  disabled={isEscalating || isSending}
                                  onClick={() => void onEscalateMessageToCloud(msg.id)}
                                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
                                >
                                  <Sparkles className="h-3.5 w-3.5 text-accent-text" />
                                  <span>{isEscalating ? 'Assisting…' : 'Cloud Assist'}</span>
                                </button>
                              )}

                              <button
                                type="button"
                                aria-expanded={isMenuOpen}
                                aria-label="Message actions"
                                onClick={() =>
                                  setOpenMenuMsgId((cur) => (cur === msg.id ? null : msg.id))
                                }
                                className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </button>

                              {isMenuOpen && (
                                <div
                                  role="menu"
                                  className="mantis-slide-up absolute top-11 right-0 z-30 w-52 overflow-hidden rounded-lg border border-line-strong bg-surface p-1 shadow-xl"
                                >
                                  {!isUser && prevUserMsg && primaryAssistantAction !== 'distill' && (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      disabled={isDistilling || isSending}
                                      onClick={() => {
                                        setOpenMenuMsgId(null);
                                        void onDistillMessageWithTeacher(msg.id);
                                      }}
                                      className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-ink hover:bg-elevated disabled:opacity-50"
                                    >
                                      <GraduationCap className="h-3.5 w-3.5 text-accent-text" />
                                      <span>Teach Student</span>
                                    </button>
                                  )}

                                  {!isUser && canCloudAssist && primaryAssistantAction !== 'cloud' && (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      disabled={isEscalating || isSending}
                                      onClick={() => {
                                        setOpenMenuMsgId(null);
                                        void onEscalateMessageToCloud(msg.id);
                                      }}
                                      className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-ink hover:bg-elevated disabled:opacity-50"
                                    >
                                      <Sparkles className="h-3.5 w-3.5 text-accent-text" />
                                      <span>Cloud Assist</span>
                                    </button>
                                  )}

                                  {!isUser && prevUserMsg && onTeachScratchFix && (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        setOpenMenuMsgId(null);
                                        setFixingMsgId((cur) => (cur === msg.id ? null : msg.id));
                                        setFixDraft('');
                                      }}
                                      className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-ink hover:bg-elevated"
                                    >
                                      <Wrench className="h-3.5 w-3.5 text-ink-muted" />
                                      <span>{fixingMsgId === msg.id ? 'Cancel Fix' : 'Fix Answer'}</span>
                                    </button>
                                  )}

                                  {!isUser && prevUserMsg && (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        setOpenMenuMsgId(null);
                                        onSendToArena(prevUserMsg.content);
                                      }}
                                      className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-ink hover:bg-elevated"
                                    >
                                      <Scale className="h-3.5 w-3.5 text-ink-muted" />
                                      <span>Compare Replies</span>
                                    </button>
                                  )}

                                  {!isUser && citedEntries.length > 0 && (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      disabled={Boolean(reinforcedMsgIds[msg.id])}
                                      onClick={async () => {
                                        setOpenMenuMsgId(null);
                                        setReinforcedMsgIds((prev) => ({...prev, [msg.id]: true}));
                                        await onReinforceEntries(citedEntries.map((e) => e.id));
                                      }}
                                      className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-ink hover:bg-elevated disabled:opacity-60"
                                    >
                                      <ThumbsUp className="h-3.5 w-3.5 text-accent-text" />
                                      <span>
                                        {reinforcedMsgIds[msg.id]
                                          ? 'Citations Boosted'
                                          : 'Boost Cited Memory'}
                                      </span>
                                    </button>
                                  )}

                                  {onQuickSaveMessage && !msg.content.startsWith('/teach') && (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      disabled={isStoringThis || Boolean(storedFolder)}
                                      onClick={() => {
                                        setOpenMenuMsgId(null);
                                        void handleQuickStore(msg);
                                      }}
                                      className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-ink hover:bg-elevated disabled:opacity-60"
                                    >
                                      <FolderPlus className="h-3.5 w-3.5 text-ink-muted" />
                                      <span>
                                        {storedFolder
                                          ? `Stored in ${storedFolder}`
                                          : isStoringThis
                                            ? 'Filing…'
                                            : 'Save to Memory'}
                                      </span>
                                    </button>
                                  )}

                                  {!msg.content.startsWith('/teach') && (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        setOpenMenuMsgId(null);
                                        onSaveTextToTeach(deriveChatTitle(msg.content), msg.content);
                                      }}
                                      className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-ink hover:bg-elevated"
                                    >
                                      <BookmarkPlus className="h-3.5 w-3.5 text-ink-muted" />
                                      <span>Edit as Trusted Rule</span>
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setOpenMenuMsgId(null);
                                      void handleCopyMessage(msg);
                                    }}
                                    className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-ink hover:bg-elevated"
                                  >
                                    <Copy className="h-3.5 w-3.5 text-ink-muted" />
                                    <span>{copiedMsgId === msg.id ? 'Copied!' : 'Copy Text'}</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </header>

                          {/* Editorial Prose Body */}
                          <RichMessageContent content={msg.content} />

                          {/* Inline Skill Correction Drawer */}
                          {!isUser && prevUserMsg && onTeachScratchFix && fixingMsgId === msg.id && (
                            <div className="mt-3 space-y-2 rounded-lg border border-line-strong bg-inset p-3">
                              <div className="text-[11px] font-medium text-ink-muted">
                                Teach local student the preferred answer for:{' '}
                                <span className="font-mono text-ink">&quot;{prevUserMsg.content}&quot;</span>
                              </div>
                              <textarea
                                rows={2}
                                value={fixDraft}
                                onChange={(e) => setFixDraft(e.target.value)}
                                placeholder="Enter the preferred rule or answer to save as a Trusted note and local skill…"
                                className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
                              />
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFixingMsgId(null);
                                    setFixDraft('');
                                  }}
                                  className="min-h-[40px] rounded border border-line px-3 text-xs text-ink-muted hover:text-ink"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  disabled={isSavingFix || !fixDraft.trim()}
                                  onClick={async () => {
                                    if (!prevUserMsg || !fixDraft.trim()) return;
                                    setIsSavingFix(true);
                                    try {
                                      const ok = await onTeachScratchFix(
                                        prevUserMsg.content,
                                        fixDraft.trim(),
                                      );
                                      if (ok) {
                                        setFixedMsgIds((prev) => ({...prev, [msg.id]: true}));
                                        setFixingMsgId(null);
                                        setFixDraft('');
                                      }
                                    } finally {
                                      setIsSavingFix(false);
                                    }
                                  }}
                                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md bg-accent px-3.5 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  <span>{isSavingFix ? 'Saving…' : 'Save Skill & Rule'}</span>
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Unboxed Inline Citations (Zero Capsule Pills) */}
                          {(citedEntries.length > 0 || citedRepoPaths.length > 0) && (
                            <footer className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                              <span className="font-mono text-[11px] text-ink-subtle">
                                Grounded:
                              </span>
                              {citedEntries.map((cited) => (
                                <button
                                  key={cited.id}
                                  type="button"
                                  onClick={() => onInspectEntry(cited.id)}
                                  className="inline-flex min-h-[36px] items-center gap-1 text-xs font-medium text-accent-text underline decoration-line-strong underline-offset-4 hover:decoration-accent"
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
                                  className="inline-flex min-h-[36px] items-center gap-1 font-mono text-[11px] text-ink-muted underline decoration-line underline-offset-4 hover:text-ink"
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
                className="mantis-slide-up absolute right-4 bottom-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-line-strong bg-surface/95 px-3 py-1 text-xs font-medium text-accent-text shadow-lg backdrop-blur-xs hover:bg-elevated"
              >
                <ArrowDown className="h-3.5 w-3.5" />
                <span>Latest</span>
              </button>
            )}
          </div>

          {/* Pinned Bottom Composer (Always Visible Above On-Screen Keyboards) */}
          <div className="shrink-0 border-t border-line bg-canvas px-3 py-2.5 sm:px-6">
            <form
              onSubmit={handleSubmit}
              className="mx-auto w-full max-w-[76ch] rounded-lg border border-line-strong bg-surface p-2.5"
            >
              {matchingSlashCommands.length > 0 && (
                <div className="mb-2 space-y-0.5 rounded-md border border-line bg-inset p-1">
                  {matchingSlashCommands.map((item, idx) => (
                    <button
                      key={item.cmd}
                      type="button"
                      onClick={() => {
                        setInput(item.template);
                        setForceSlashMenu(false);
                        if (item.cmd === '/execute') setComposerMode('assassin');
                        textareaRef.current?.focus();
                      }}
                      className={`flex min-h-[40px] w-full items-center justify-between gap-2 rounded px-2.5 py-1 text-left text-xs transition-colors ${
                        idx === slashIndex
                          ? 'bg-accent-soft text-accent-text'
                          : 'text-ink-muted hover:bg-elevated hover:text-ink'
                      }`}
                    >
                      <span className="font-mono font-semibold text-ink">{item.cmd}</span>
                      <span className="truncate text-[11px] text-ink-muted">{item.desc}</span>
                    </button>
                  ))}
                </div>
              )}

              <textarea
                ref={textareaRef}
                rows={2}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  if (forceSlashMenu && e.target.value.includes(' ')) {
                    setForceSlashMenu(false);
                  }
                }}
                onKeyDown={(e) => {
                  if (matchingSlashCommands.length > 0) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSlashIndex((i) => (i + 1) % matchingSlashCommands.length);
                      return;
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSlashIndex((i) =>
                        (i - 1 + matchingSlashCommands.length) % matchingSlashCommands.length,
                      );
                      return;
                    }
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      const picked = matchingSlashCommands[slashIndex] || matchingSlashCommands[0];
                      if (picked) {
                        setInput(picked.template);
                        setForceSlashMenu(false);
                        if (picked.cmd === '/execute') setComposerMode('assassin');
                      }
                      return;
                    }
                    if (e.key === 'Escape') {
                      setForceSlashMenu(false);
                      return;
                    }
                  } else if (e.key === 'ArrowUp' && !input.trim() && lastUserPrompt) {
                    e.preventDefault();
                    setInput(lastUserPrompt);
                    return;
                  }

                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    setForceSlashMenu(false);
                    void submitPrompt();
                  }
                }}
                placeholder={
                  composerMode === 'assassin'
                    ? 'Describe a code goal for parallel patch prep (/execute automatically applied)…'
                    : 'Message Mantis, type / for commands, or Remember: to teach…'
                }
                className="min-h-[44px] w-full resize-none bg-transparent px-1.5 py-1 text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
              />

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setForceSlashMenu((prev) => !prev)}
                    aria-label="Toggle slash command helper"
                    className={`inline-flex min-h-[38px] shrink-0 items-center rounded border px-2.5 font-mono text-[11px] font-semibold transition-colors ${
                      forceSlashMenu || matchingSlashCommands.length > 0
                        ? 'border-accent-border bg-accent-soft text-accent-text'
                        : 'border-line bg-inset text-ink-muted hover:text-ink'
                    }`}
                  >
                    /
                  </button>
                  {(
                    [
                      {id: 'scratch', label: 'Local Student'},
                      {id: 'cloud', label: 'Cloud Assist'},
                      {id: 'distill', label: 'Teacher Distill'},
                      {id: 'assassin', label: 'Parallel Patch'},
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
                        className={`inline-flex min-h-[38px] shrink-0 items-center gap-1 whitespace-nowrap rounded px-2.5 text-[11px] font-medium transition-colors ${
                          active
                            ? 'border border-accent-border bg-accent-soft text-accent-text'
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
                      className="ml-1 min-h-[38px] font-mono text-[11px] text-warn underline underline-offset-2 hover:opacity-90"
                    >
                      Connect Cloud ({brainModel.split('/').pop()})
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSending || !input.trim()}
                  className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-4 text-xs font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>
                    {isSending
                      ? 'Running…'
                      : composerMode === 'assassin'
                        ? 'Stage Brief'
                        : 'Send'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
});
