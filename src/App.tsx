import type {Session} from '@supabase/supabase-js';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {AuthGate} from './components/AuthGate';
import {ChatWorkspace} from './components/ChatWorkspace';
import {GitHubPreview} from './components/GitHubPreview';
import {KnowledgeBrowser} from './components/KnowledgeBrowser';
import {SchemaSetupBanner} from './components/SchemaSetupBanner';
import {SettingsPanel} from './components/SettingsPanel';
import {TeachPanel} from './components/TeachPanel';
import {TopBar} from './components/TopBar';
import {STARTER_FOLDERS, buildMemoryReply, computeMemoryReadiness} from './lib/memory';
import {isMissingTableError, supabase} from './lib/supabase';
import type {AreaId, ChatMessage, KnowledgeEntry, KnowledgeFolder} from './types/mantis';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [activeArea, setActiveArea] = useState<AreaId>('chat');
  const [folders, setFolders] = useState<KnowledgeFolder[]>([]);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [highlightedEntryId, setHighlightedEntryId] = useState<string | null>(null);
  const [teachPrefill, setTeachPrefill] = useState<{
    key: number;
    title: string;
    content: string;
  }>({key: 0, title: '', content: ''});

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(({data}) => {
      if (!mounted) return;
      setSession(data.session);
      setAuthReady(true);
    });

    const {data: authListener} = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setAuthReady(true);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const loadWorkspaceData = useCallback(async (activeSession: Session) => {
    setIsLoadingData(true);
    setErrorBanner(null);

    try {
      const [foldersRes, entriesRes, messagesRes] = await Promise.all([
        supabase.from('knowledge_folders').select('*').order('created_at', {ascending: true}),
        supabase.from('knowledge_entries').select('*').order('updated_at', {ascending: false}),
        supabase.from('chat_messages').select('*').order('created_at', {ascending: true}),
      ]);

      if (
        isMissingTableError(foldersRes.error) ||
        isMissingTableError(entriesRes.error) ||
        isMissingTableError(messagesRes.error)
      ) {
        setSchemaMissing(true);
        setFolders([]);
        setEntries([]);
        setMessages([]);
        return;
      }

      const firstError = foldersRes.error || entriesRes.error || messagesRes.error;
      if (firstError) {
        setErrorBanner(firstError.message);
        return;
      }

      setSchemaMissing(false);
      let loadedFolders = (foldersRes.data as KnowledgeFolder[]) || [];

      if (loadedFolders.length === 0) {
        const seedRows = STARTER_FOLDERS.map((folder) => ({
          user_id: activeSession.user.id,
          name: folder.name,
          description: folder.description,
        }));
        const {data: seeded, error: seedError} = await supabase
          .from('knowledge_folders')
          .insert(seedRows)
          .select('*');
        if (!seedError && seeded) {
          loadedFolders = seeded as KnowledgeFolder[];
        }
      }

      setFolders(loadedFolders);
      setEntries((entriesRes.data as KnowledgeEntry[]) || []);
      setMessages((messagesRes.data as ChatMessage[]) || []);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to reach Supabase');
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (session) {
      void loadWorkspaceData(session);
    } else {
      setFolders([]);
      setEntries([]);
      setMessages([]);
      setSchemaMissing(false);
      setErrorBanner(null);
    }
  }, [session, loadWorkspaceData]);

  const metrics = useMemo(
    () => computeMemoryReadiness(entries, folders, messages),
    [entries, folders, messages],
  );

  async function handleCreateFolder(
    name: string,
    description: string,
  ): Promise<KnowledgeFolder | null> {
    if (!session) return null;
    setErrorBanner(null);
    const {data, error} = await supabase
      .from('knowledge_folders')
      .insert({
        user_id: session.user.id,
        name,
        description,
      })
      .select('*')
      .single();

    if (error) {
      setErrorBanner(error.message);
      return null;
    }

    const created = data as KnowledgeFolder;
    setFolders((prev) => [...prev, created]);
    return created;
  }

  async function handleSaveEntry(payload: {
    title: string;
    content: string;
    folderId: string | null;
    tags: string[];
    source: string;
  }): Promise<boolean> {
    if (!session) return false;
    setErrorBanner(null);

    const {data, error} = await supabase
      .from('knowledge_entries')
      .insert({
        user_id: session.user.id,
        folder_id: payload.folderId,
        title: payload.title,
        content: payload.content,
        tags: payload.tags,
        source: payload.source,
      })
      .select('*')
      .single();

    if (error) {
      setErrorBanner(error.message);
      return false;
    }

    const created = data as KnowledgeEntry;
    setEntries((prev) => [created, ...prev]);
    return true;
  }

  async function handleUpdateEntry(
    id: string,
    payload: {title: string; content: string; folderId: string | null; tags: string[]},
  ): Promise<boolean> {
    if (!session) return false;
    setErrorBanner(null);

    const {data, error} = await supabase
      .from('knowledge_entries')
      .update({
        title: payload.title,
        content: payload.content,
        folder_id: payload.folderId,
        tags: payload.tags,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      setErrorBanner(error.message);
      return false;
    }

    const updated = data as KnowledgeEntry;
    setEntries((prev) => prev.map((item) => (item.id === id ? updated : item)));
    return true;
  }

  async function handleDeleteEntry(id: string): Promise<boolean> {
    if (!session) return false;
    setErrorBanner(null);

    const {error} = await supabase.from('knowledge_entries').delete().eq('id', id);
    if (error) {
      setErrorBanner(error.message);
      return false;
    }

    setEntries((prev) => prev.filter((item) => item.id !== id));
    return true;
  }

  async function handleSendChatMessage(prompt: string) {
    if (!session) return;
    setIsSendingChat(true);
    setErrorBanner(null);

    try {
      const {data: userMsgData, error: userMsgErr} = await supabase
        .from('chat_messages')
        .insert({
          user_id: session.user.id,
          role: 'user',
          content: prompt,
          cited_entry_ids: [],
        })
        .select('*')
        .single();

      if (userMsgErr) {
        setErrorBanner(userMsgErr.message);
        return;
      }

      const savedUserMsg = userMsgData as ChatMessage;
      setMessages((prev) => [...prev, savedUserMsg]);

      let replyText = '';
      let citedEntryIds: string[] = [];

      if (prompt.toLowerCase().startsWith('/teach ')) {
        const rawBody = prompt.slice(7).trim();
        const separatorIdx = rawBody.indexOf('::');
        const noteTitle =
          separatorIdx > 0
            ? rawBody.slice(0, separatorIdx).trim()
            : rawBody.slice(0, 64).trim() || 'Quick Note';
        const noteContent =
          separatorIdx > 0 ? rawBody.slice(separatorIdx + 2).trim() : rawBody;

        if (!noteContent) {
          replyText = 'Provide note details after `/teach Title :: Details`.';
        } else {
          const defaultFolder =
            folders.find((f) => f.name.toLowerCase() === 'patterns') || folders[0] || null;
          const {data: savedNote, error: noteErr} = await supabase
            .from('knowledge_entries')
            .insert({
              user_id: session.user.id,
              folder_id: defaultFolder?.id || null,
              title: noteTitle,
              content: noteContent,
              tags: [],
              source: 'chat',
            })
            .select('*')
            .single();

          if (noteErr) {
            replyText = `Could not save note to Supabase: ${noteErr.message}`;
          } else {
            const createdNote = savedNote as KnowledgeEntry;
            setEntries((prev) => [createdNote, ...prev]);
            citedEntryIds = [createdNote.id];
            replyText = `Saved "${createdNote.title}" to ${
              defaultFolder?.name || 'Uncategorized'
            }. I will retrieve and cite this entry when relevant.`;
          }
        }
      } else {
        const result = buildMemoryReply(prompt, entries, folders);
        replyText = result.replyText;
        citedEntryIds = result.citedEntryIds;
      }

      const {data: mantisMsgData, error: mantisMsgErr} = await supabase
        .from('chat_messages')
        .insert({
          user_id: session.user.id,
          role: 'mantis',
          content: replyText,
          cited_entry_ids: citedEntryIds,
        })
        .select('*')
        .single();

      if (mantisMsgErr) {
        setErrorBanner(mantisMsgErr.message);
        return;
      }

      setMessages((prev) => [...prev, mantisMsgData as ChatMessage]);
    } finally {
      setIsSendingChat(false);
    }
  }

  async function handleClearChat() {
    if (!session) return;
    setErrorBanner(null);
    const {error} = await supabase
      .from('chat_messages')
      .delete()
      .eq('user_id', session.user.id);
    if (error) {
      setErrorBanner(error.message);
      return;
    }
    setMessages([]);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setSession(null);
  }

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0B1120] text-sm text-slate-400">
        Loading Mantis...
      </div>
    );
  }

  if (!session) {
    return <AuthGate onAuthenticated={() => {}} />;
  }

  const statusLabel = schemaMissing
    ? 'Setup Required'
    : errorBanner
      ? 'Check Connection'
      : 'Connected';

  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-100">
      <TopBar
        activeArea={activeArea}
        onSelectArea={setActiveArea}
        statusLabel={statusLabel}
        knowledgeCount={entries.length}
        readinessScore={metrics.readinessScore}
        isSyncing={isLoadingData}
        onSync={() => void loadWorkspaceData(session)}
      />

      <main className="mx-auto max-w-6xl space-y-6 px-4 pt-6 pb-24 sm:px-6 md:pb-12">
        {schemaMissing && (
          <SchemaSetupBanner
            isChecking={isLoadingData}
            onRetry={() => void loadWorkspaceData(session)}
          />
        )}

        {errorBanner && !schemaMissing && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-3 text-xs text-red-200"
          >
            <span>{errorBanner}</span>
            <button
              type="button"
              onClick={() => void loadWorkspaceData(session)}
              className="rounded border border-red-400/40 px-3 py-1 font-semibold hover:bg-red-900/40"
            >
              Retry
            </button>
          </div>
        )}

        {activeArea === 'chat' && (
          <ChatWorkspace
            messages={messages}
            entries={entries}
            isLoading={isLoadingData}
            isSending={isSendingChat}
            onSendMessage={handleSendChatMessage}
            onClearChat={handleClearChat}
            onInspectEntry={(entryId) => {
              setHighlightedEntryId(entryId);
              setActiveArea('knowledge');
            }}
            onSaveTextToTeach={(suggestedTitle, content) => {
              setTeachPrefill({
                key: Date.now(),
                title: suggestedTitle,
                content,
              });
              setActiveArea('teach');
            }}
          />
        )}

        {activeArea === 'knowledge' && (
          <KnowledgeBrowser
            folders={folders}
            entries={entries}
            isLoading={isLoadingData}
            highlightedEntryId={highlightedEntryId}
            onClearHighlight={() => setHighlightedEntryId(null)}
            onCreateFolder={handleCreateFolder}
            onUpdateEntry={handleUpdateEntry}
            onDeleteEntry={handleDeleteEntry}
            onOpenTeach={() => setActiveArea('teach')}
          />
        )}

        {activeArea === 'teach' && (
          <TeachPanel
            key={teachPrefill.key}
            folders={folders}
            initialTitle={teachPrefill.title}
            initialContent={teachPrefill.content}
            onSaveEntry={handleSaveEntry}
            onCreateFolder={handleCreateFolder}
            onOpenKnowledge={() => setActiveArea('knowledge')}
          />
        )}

        {activeArea === 'github' && <GitHubPreview />}

        {activeArea === 'settings' && (
          <SettingsPanel
            userEmail={session.user.email || 'Signed-in user'}
            metrics={metrics}
            schemaMissing={schemaMissing}
            onSignOut={handleSignOut}
          />
        )}
      </main>
    </div>
  );
}
