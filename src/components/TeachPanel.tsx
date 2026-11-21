import {
  CheckCircle2,
  FolderPlus,
  Loader2,
  PlusCircle,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {type FormEvent, useMemo, useState} from 'react';
import {suggestSemanticFolderWithAi} from '../lib/aiBrain';
import {
  AUTO_FOLDER_OPTION,
  ensureAutoFolderExists,
  inferFolderDeterministically,
} from '../lib/autoFolders';
import {parseTagsInput} from '../lib/memory';
import type {
  KnowledgeEntry,
  KnowledgeFolder,
  KnowledgeStatus,
  SaveFeedbackInfo,
} from '../types/mantis';

interface TeachPanelProps {
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
  brainUrl?: string;
  backupBrainUrl?: string;
  brainModel?: string;
  accessToken?: string;
  initialTitle?: string;
  initialContent?: string;
  initialTags?: string;
  saveFeedback?: SaveFeedbackInfo;
  onRetrySave?: () => void;
  onSaveEntry: (payload: {
    title: string;
    content: string;
    folderId: string | null;
    tags: string[];
    source: string;
    status?: KnowledgeStatus;
  }) => Promise<boolean>;
  onCreateFolder: (name: string, description: string) => Promise<KnowledgeFolder | null>;
  onOpenKnowledge: () => void;
}

const TEACH_TEMPLATES: Array<{
  label: string;
  folderHint: string;
  tags: string;
  titlePrefix: string;
  body: string;
}> = [
  {
    label: 'Coding Rule',
    folderHint: 'Preferences',
    tags: 'rule, convention',
    titlePrefix: 'Rule: ',
    body: 'When writing code for this project, always...\n\nWhy:\n- ',
  },
  {
    label: 'Bug Fix',
    folderHint: 'Debugging',
    tags: 'debugging, fix',
    titlePrefix: 'Fix: ',
    body: 'Symptom:\n\nRoot Cause:\n\nWorking Fix:\n',
  },
  {
    label: 'Word / Definition',
    folderHint: AUTO_FOLDER_OPTION,
    tags: 'definition, vocabulary',
    titlePrefix: 'Definition: ',
    body: 'Meaning:\n\nHow to use in speech:\n\nExample sentence:\n',
  },
  {
    label: 'Architecture Note',
    folderHint: 'Architecture',
    tags: 'architecture, design',
    titlePrefix: 'Architecture: ',
    body: 'Decision:\n\nTrade-off:\n',
  },
];

export function TeachPanel({
  folders,
  entries,
  brainUrl = '',
  backupBrainUrl = '',
  brainModel = '',
  accessToken = '',
  initialTitle = '',
  initialContent = '',
  initialTags = '',
  saveFeedback,
  onRetrySave,
  onSaveEntry,
  onCreateFolder,
  onOpenKnowledge,
}: TeachPanelProps) {
  const [title, setTitle] = useState(initialTitle);
  const [folderId, setFolderId] = useState<string>(AUTO_FOLDER_OPTION);
  const [tagsRaw, setTagsRaw] = useState(initialTags);
  const [content, setContent] = useState(initialContent);
  const [isSaving, setIsSaving] = useState(false);
  const [isSuggestingFolder, setIsSuggestingFolder] = useState(false);
  const [suggestedFolderHint, setSuggestedFolderHint] = useState<string>('');
  const [suggestedFolderDesc, setSuggestedFolderDesc] = useState<string>('');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const existingTags = useMemo(() => {
    const freq = new Map<string, number>();
    for (const entry of entries) {
      for (const tag of entry.tags) {
        freq.set(tag, (freq.get(tag) || 0) + 1);
      }
    }
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag]) => tag);
  }, [entries]);

  const liveFolderPreview = useMemo(() => {
    if (folderId !== AUTO_FOLDER_OPTION) return null;
    if (suggestedFolderHint) {
      const existing = folders.find(
        (f) => f.name.toLowerCase() === suggestedFolderHint.toLowerCase(),
      );
      return {
        name: existing ? existing.name : suggestedFolderHint,
        isNew: !existing,
      };
    }
    if (!title.trim() && !content.trim()) return null;
    const guess = inferFolderDeterministically(title, content, folders);
    return {name: guess.folderName, isNew: guess.isNew};
  }, [folderId, suggestedFolderHint, title, content, folders]);

  function applyTemplate(tpl: (typeof TEACH_TEMPLATES)[number]) {
    if (tpl.folderHint === AUTO_FOLDER_OPTION) {
      setFolderId(AUTO_FOLDER_OPTION);
    } else {
      const matchedFolder = folders.find(
        (f) => f.name.toLowerCase() === tpl.folderHint.toLowerCase(),
      );
      if (matchedFolder) {
        setFolderId(matchedFolder.id);
      }
    }
    if (!title.trim()) {
      setTitle(tpl.titlePrefix);
    }
    setTagsRaw(tpl.tags);
    if (!content.trim()) {
      setContent(tpl.body);
    }
    setSavedNotice(null);
    setErrorNotice(null);
  }

  function addSuggestedTag(tag: string) {
    const current = parseTagsInput(tagsRaw);
    if (current.includes(tag)) return;
    setTagsRaw(current.length > 0 ? `${current.join(', ')}, ${tag}` : tag);
  }

  async function handleAiSuggestFolder() {
    if (!title.trim() && !content.trim()) return;
    setIsSuggestingFolder(true);
    try {
      const result = await suggestSemanticFolderWithAi({
        brainUrl,
        backupBrainUrl,
        accessToken,
        model: brainModel,
        title: title.trim(),
        content: content.trim(),
        existingFolders: folders,
      });
      setFolderId(AUTO_FOLDER_OPTION);
      setSuggestedFolderHint(result.folderName);
      setSuggestedFolderDesc(result.description);
      const mergedTags = Array.from(
        new Set([...parseTagsInput(tagsRaw), ...result.tags]),
      );
      if (mergedTags.length > 0) {
        setTagsRaw(mergedTags.join(', '));
      }
    } finally {
      setIsSuggestingFolder(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrorNotice(null);
    setSavedNotice(null);

    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedTitle || !trimmedContent) {
      setErrorNotice('Both a title and knowledge content are required.');
      return;
    }

    setIsSaving(true);
    try {
      let resolvedFolderId: string | null = folderId || folders[0]?.id || null;
      let folderResultLabel = '';

      if (folderId === AUTO_FOLDER_OPTION) {
        let targetName = suggestedFolderHint;
        let targetDesc = suggestedFolderDesc;

        if (!targetName) {
          const classified = await suggestSemanticFolderWithAi({
            brainUrl,
            backupBrainUrl,
            accessToken,
            model: brainModel,
            title: trimmedTitle,
            content: trimmedContent,
            existingFolders: folders,
          }).catch(() => {
            const local = inferFolderDeterministically(trimmedTitle, trimmedContent, folders);
            return {folderName: local.folderName, description: local.description, tags: local.suggestedTags};
          });
          targetName = classified.folderName;
          targetDesc = classified.description;
        }

        const ensured = await ensureAutoFolderExists(
          targetName,
          targetDesc,
          folders,
          onCreateFolder,
        );
        resolvedFolderId = ensured.folder?.id || folders[0]?.id || null;
        if (ensured.folder) {
          folderResultLabel = ensured.createdNew
            ? ` into auto-created "${ensured.folder.name}" folder`
            : ` into "${ensured.folder.name}"`;
        }
      }

      const ok = await onSaveEntry({
        title: trimmedTitle,
        content: trimmedContent,
        folderId: resolvedFolderId,
        tags: parseTagsInput(tagsRaw),
        source: 'teach',
        status: 'trusted',
      });
      if (ok) {
        setSavedNotice(`Saved "${trimmedTitle}" as Trusted${folderResultLabel}.`);
        setTitle('');
        setTagsRaw('');
        setContent('');
        setSuggestedFolderHint('');
        setSuggestedFolderDesc('');
      } else {
        setErrorNotice('Save failed — tap Retry below to try again.');
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function handleQuickCreateFolder() {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    setIsCreatingFolder(true);
    try {
      const created = await onCreateFolder(trimmed, 'Custom knowledge folder');
      if (created) {
        setFolderId(created.id);
        setNewFolderName('');
        setShowNewFolder(false);
      }
    } finally {
      setIsCreatingFolder(false);
    }
  }

  return (
    <div className="mantis-fade-in mx-auto max-w-3xl space-y-6">
      <div className="space-y-1 border-b border-line pb-4">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Teach Mantis</h1>
        <p className="text-sm text-ink-muted">
          Store coding patterns, preferences, word definitions, or facts into Supabase. Auto-Folder files topics cleanly for you.
        </p>
      </div>

      {/* Quick-Teach Templates */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
          <Sparkles className="h-3.5 w-3.5 text-accent-text" />
          <span>Quick-Teach Templates (optional starter structure)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {TEACH_TEMPLATES.map((tpl) => (
            <button
              key={tpl.label}
              type="button"
              onClick={() => applyTemplate(tpl)}
              className="min-h-[42px] rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-accent-border hover:bg-elevated"
            >
              {tpl.label}
            </button>
          ))}
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-lg border border-line bg-surface p-5 sm:p-6"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="teach-title" className="block text-xs font-medium text-ink-muted">
              Title
            </label>
            <input
              id="teach-title"
              type="text"
              required
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setSuggestedFolderHint('');
              }}
              placeholder="e.g. Definition of Turkey or Auth Key Rule"
              className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3.5 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="teach-folder" className="block text-xs font-medium text-ink-muted">
                Folder
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={isSuggestingFolder || (!title.trim() && !content.trim())}
                  onClick={() => void handleAiSuggestFolder()}
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent-text hover:underline disabled:opacity-50"
                >
                  <Sparkles className="h-3 w-3" />
                  <span>{isSuggestingFolder ? 'Detecting…' : 'AI Detect'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewFolder((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                  <span>{showNewFolder ? 'Cancel' : 'New Folder'}</span>
                </button>
              </div>
            </div>

            {showNewFolder ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Folder name"
                  className="min-h-[44px] flex-1 rounded-md border border-line-strong bg-inset px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleQuickCreateFolder}
                  disabled={isCreatingFolder || !newFolderName.trim()}
                  className="min-h-[44px] rounded-md bg-elevated px-3.5 text-xs font-semibold text-ink hover:opacity-90 disabled:opacity-50"
                >
                  {isCreatingFolder ? 'Adding…' : 'Add'}
                </button>
              </div>
            ) : (
              <select
                id="teach-folder"
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
              >
                <option value={AUTO_FOLDER_OPTION}>
                  Auto-Create Topic Folder (AI)
                  {liveFolderPreview ? ` → ${liveFolderPreview.name}` : ''}
                </option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            )}

            {liveFolderPreview && !showNewFolder && (
              <div className="font-mono text-[11px] text-accent-text">
                {liveFolderPreview.isNew
                  ? `Will auto-create folder "${liveFolderPreview.name}"`
                  : `Files into existing "${liveFolderPreview.name}"`}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="teach-tags" className="block text-xs font-medium text-ink-muted">
            Tags (comma-separated, optional)
          </label>
          <input
            id="teach-tags"
            type="text"
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="e.g. food, greetings, supabase, pattern"
            className="min-h-[44px] w-full rounded-md border border-line-strong bg-inset px-3.5 py-2 font-mono text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
          />
          {existingTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
              <span>Quick tags:</span>
              {existingTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => addSuggestedTag(tag)}
                  className="min-h-[40px] rounded border border-line bg-inset px-2.5 py-1 font-mono text-[11px] text-ink-muted hover:border-line-strong hover:text-accent-text"
                >
                  +{tag}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="teach-content" className="block text-xs font-medium text-ink-muted">
            Knowledge / Code Snippet / Definition
          </label>
          <textarea
            id="teach-content"
            required
            rows={7}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setSuggestedFolderHint('');
            }}
            placeholder="Write the pattern, fact, definition, or code example you want Mantis to remember..."
            className="w-full rounded-md border border-line-strong bg-inset p-3.5 font-mono text-xs leading-relaxed text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
          />
        </div>

        {errorNotice && (
          <div
            role="alert"
            className="rounded-md border border-danger-border bg-danger-soft px-3.5 py-2.5 text-xs text-danger"
          >
            {errorNotice}
          </div>
        )}

        {savedNotice && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent-border bg-accent-soft px-3.5 py-2.5 text-xs text-ink"
          >
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-accent-text" />
              <span>{savedNotice}</span>
            </span>
            <button
              type="button"
              onClick={onOpenKnowledge}
              className="font-semibold text-accent-text underline underline-offset-2 hover:opacity-90"
            >
              Browse in Knowledge
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <div className="flex items-center gap-2 text-xs">
            {saveFeedback && saveFeedback.state !== 'idle' && (
              <span
                className={`inline-flex items-center gap-1.5 font-mono ${
                  saveFeedback.state === 'failed'
                    ? 'text-danger'
                    : saveFeedback.state === 'saved'
                      ? 'text-accent-text'
                      : 'text-ink-muted'
                }`}
              >
                {saveFeedback.state === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{saveFeedback.message}</span>
              </span>
            )}
            {saveFeedback?.state === 'failed' && onRetrySave && (
              <button
                type="button"
                onClick={onRetrySave}
                className="inline-flex min-h-[40px] items-center gap-1 rounded border border-danger-border bg-danger-soft px-2.5 py-1 text-xs font-semibold text-danger hover:opacity-90"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Retry</span>
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            <PlusCircle className="h-4 w-4" />
            <span>{isSaving ? 'Saving…' : 'Save to Knowledge'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
