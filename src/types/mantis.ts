export type AreaId = 'chat' | 'knowledge' | 'teach' | 'github' | 'settings';

export interface KnowledgeFolder {
  id: string;
  user_id: string;
  name: string;
  description: string;
  created_at: string;
}

export interface KnowledgeEntry {
  id: string;
  user_id: string;
  folder_id: string | null;
  title: string;
  content: string;
  tags: string[];
  source: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  role: 'user' | 'mantis';
  content: string;
  cited_entry_ids: string[];
  cited_repo_paths?: string[];
  created_at: string;
}

export interface GitHubConnection {
  id: string;
  user_id: string;
  owner: string;
  repo: string;
  branch: string;
  description: string;
  is_private: boolean;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface RepoFile {
  id: string;
  user_id: string;
  connection_id: string;
  path: string;
  size_bytes: number;
  sha: string;
  content: string;
  updated_at: string;
}

export type SuggestionStatus = 'pending' | 'approved' | 'rejected';

export interface CodeSuggestion {
  id: string;
  user_id: string;
  connection_id: string | null;
  file_path: string;
  title: string;
  rationale: string;
  original_content: string;
  proposed_content: string;
  status: SuggestionStatus;
  user_feedback: string;
  pr_url: string;
  created_at: string;
  updated_at: string;
}

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  oldLineNo: number | null;
  newLineNo: number | null;
  text: string;
}

export interface RetrievalMatch {
  entry: KnowledgeEntry;
  folderName: string;
  score: number;
  reasons: string[];
}

export interface RepoMatch {
  file: RepoFile;
  score: number;
  reasons: string[];
}

export interface MemoryReadinessMetrics {
  entryCount: number;
  folderCount: number;
  substantiveCount: number;
  taggedCount: number;
  conversationTurns: number;
  repoFileCount: number;
  approvedSuggestions: number;
  reviewedSuggestions: number;
  readinessScore: number;
}
