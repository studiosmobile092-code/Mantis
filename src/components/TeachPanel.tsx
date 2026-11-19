import {CheckCircle2, FolderPlus, PlusCircle, Sparkles} from 'lucide-react';
import {type FormEvent, useMemo, useState} from 'react';
import {parseTagsInput} from '../lib/memory';
import type {KnowledgeEntry, KnowledgeFolder} from '../types/mantis';

interface TeachPanelProps {
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
  initialTitle?: string;
  initialContent?: string;
  initialTags?: string;
  onSaveEntry: (payload: {
    title: string;
    content: string;
    folderId: string | null;
    tags: string[];
    source: string;
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
    label: 'Code Snippet',
    folderHint: 'Patterns',
    tags: 'snippet, pattern',
    titlePrefix: 'Snippet: ',
    body: '// Purpose:\n\n',
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
  initialTitle = '',
  initialContent = '',
  initialTags = '',
  onSaveEntry,
  onCreateFolder,
  onOpenKnowledge,
}: TeachPanelProps) {
  const [title, setTitle] = useState(initialTitle);
  const [folderId, setFolderId] = useState<string>(folders[0]?.id || '');
  const [tagsRaw, setTagsRaw] = useState(initialTags);
  const [content, setContent] = useState(initialContent);
  const [isSaving, setIsSaving] = useState(false);
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

  function applyTemplate(tpl: (typeof TEACH_TEMPLATES)[number]) {
    const matchedFolder = folders.find(
      (f) => f.name.toLowerCase() === tpl.folderHint.toLowerCase(),
    );
    if (matchedFolder) {
      setFolderId(matchedFolder.id);
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
      const ok = await onSaveEntry({
        title: trimmedTitle,
        content: trimmedContent,
        folderId: folderId || folders[0]?.id || null,
        tags: parseTagsInput(tagsRaw),
        source: 'teach',
      });
      if (ok) {
        setSavedNotice(`Saved "${trimmedTitle}" to persistent Supabase memory.`);
        setTitle('');
        setTagsRaw('');
        setContent('');
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
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1 border-b border-slate-800 pb-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">Teach Mantis</h1>
        <p className="text-sm text-slate-400">
          Store coding patterns, preferences, debugging fixes, or architecture notes in Supabase.
          Mantis retrieves and cites these entries in Chat / Work.
        </p>
      </div>

      {/* Phase 2 Quick-Teach Templates */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
          <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
          <span>Quick-Teach Templates (optional starter structure)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {TEACH_TEMPLATES.map((tpl) => (
            <button
              key={tpl.label}
              type="button"
              onClick={() => applyTemplate(tpl)}
              className="min-h-[40px] rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-emerald-500/50 hover:bg-slate-800"
            >
              {tpl.label}
            </button>
          ))}
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-lg border border-slate-800 bg-slate-900 p-5 sm:p-6"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="teach-title" className="block text-xs font-medium text-slate-300">
              Title
            </label>
            <input
              id="teach-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Supabase Publishable Key Header Rule"
              className="min-h-[44px] w-full rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="teach-folder" className="block text-xs font-medium text-slate-300">
                Folder
              </label>
              <button
                type="button"
                onClick={() => setShowNewFolder((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 hover:text-emerald-300"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                <span>{showNewFolder ? 'Cancel' : 'New Folder'}</span>
              </button>
            </div>

            {showNewFolder ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Folder name"
                  className="min-h-[44px] flex-1 rounded-md border border-slate-700 bg-[#0B1120] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleQuickCreateFolder}
                  disabled={isCreatingFolder || !newFolderName.trim()}
                  className="min-h-[44px] rounded-md bg-slate-800 px-3.5 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-50"
                >
                  {isCreatingFolder ? 'Adding...' : 'Add'}
                </button>
              </div>
            ) : (
              <select
                id="teach-folder"
                value={folderId || folders[0]?.id || ''}
                onChange={(e) => setFolderId(e.target.value)}
                className="min-h-[44px] w-full rounded-md border border-slate-700 bg-[#0B1120] px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                {folders.length === 0 ? (
                  <option value="">Uncategorized</option>
                ) : (
                  folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))
                )}
              </select>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="teach-tags" className="block text-xs font-medium text-slate-300">
            Tags (comma-separated, optional)
          </label>
          <input
            id="teach-tags"
            type="text"
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="e.g. supabase, auth, typescript, pattern"
            className="min-h-[44px] w-full rounded-md border border-slate-700 bg-[#0B1120] px-3.5 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
          />
          {existingTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
              <span>Quick tags:</span>
              {existingTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => addSuggestedTag(tag)}
                  className="rounded border border-slate-800 bg-[#0B1120] px-2 py-1 font-mono text-[11px] text-slate-300 hover:border-slate-700 hover:text-emerald-300"
                >
                  +{tag}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="teach-content" className="block text-xs font-medium text-slate-300">
            Knowledge / Code Snippet / Rule
          </label>
          <textarea
            id="teach-content"
            required
            rows={7}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write the pattern, fact, or code example you want Mantis to remember..."
            className="w-full rounded-md border border-slate-700 bg-[#0B1120] p-3.5 font-mono text-xs leading-relaxed text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        {errorNotice && (
          <div
            role="alert"
            className="rounded-md border border-red-500/40 bg-red-950/30 px-3.5 py-2.5 text-xs text-red-200"
          >
            {errorNotice}
          </div>
        )}

        {savedNotice && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-500/40 bg-emerald-950/30 px-3.5 py-2.5 text-xs text-emerald-200"
          >
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>{savedNotice}</span>
            </span>
            <button
              type="button"
              onClick={onOpenKnowledge}
              className="font-semibold text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
            >
              Browse in Knowledge
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-800 pt-4">
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
          >
            <PlusCircle className="h-4 w-4" />
            <span>{isSaving ? 'Saving to Supabase...' : 'Save to Knowledge'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
