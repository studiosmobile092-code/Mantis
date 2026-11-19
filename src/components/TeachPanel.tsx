import {CheckCircle2, FolderPlus, PlusCircle} from 'lucide-react';
import {type FormEvent, useState} from 'react';
import {parseTagsInput} from '../lib/memory';
import type {KnowledgeFolder} from '../types/mantis';

interface TeachPanelProps {
  folders: KnowledgeFolder[];
  initialTitle?: string;
  initialContent?: string;
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

export function TeachPanel({
  folders,
  initialTitle = '',
  initialContent = '',
  onSaveEntry,
  onCreateFolder,
  onOpenKnowledge,
}: TeachPanelProps) {
  const [title, setTitle] = useState(initialTitle);
  const [folderId, setFolderId] = useState<string>(folders[0]?.id || '');
  const [tagsRaw, setTagsRaw] = useState('');
  const [content, setContent] = useState(initialContent);
  const [isSaving, setIsSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

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

        <div className="space-y-1.5">
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
