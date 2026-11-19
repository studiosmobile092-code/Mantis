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
  created_at: string;
}

export interface RetrievalMatch {
  entry: KnowledgeEntry;
  folderName: string;
  score: number;
  reasons: string[];
}

export interface MemoryReadinessMetrics {
  entryCount: number;
  folderCount: number;
  substantiveCount: number;
  taggedCount: number;
  conversationTurns: number;
  readinessScore: number;
}
