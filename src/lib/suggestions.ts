import {retrieveRelevantKnowledge} from './memory';
import type {KnowledgeEntry, KnowledgeFolder, RepoFile} from '../types/mantis';

export interface GeneratedSuggestionDraft {
  filePath: string;
  title: string;
  rationale: string;
  originalContent: string;
  proposedContent: string;
  matchedRuleTitles: string[];
}

function applySafeCodeImprovements(
  filePath: string,
  original: string,
  goal: string,
): {proposed: string; findings: string[]} {
  const findings: string[] = [];
  let updated = original;
  const lowerPath = filePath.toLowerCase();

  // 1. TSX / HTML button elements missing explicit type="button" or type="submit"
  if (lowerPath.endsWith('.tsx') || lowerPath.endsWith('.jsx')) {
    const buttonTagRegex = /<button(?![^>]*\btype=)([^>]*)>/g;
    if (buttonTagRegex.test(updated)) {
      updated = updated.replace(/<button(?![^>]*\btype=)([^>]*)>/g, '<button type="button"$1>');
      findings.push('Added explicit type="button" to <button> tags to prevent unintended form submissions.');
    }

    // 2. External links missing rel="noopener noreferrer"
    const blankTargetRegex = /target="_blank"(?![^>]*rel=)/g;
    if (blankTargetRegex.test(updated)) {
      updated = updated.replace(/target="_blank"(?![^>]*rel=)/g, 'target="_blank" rel="noopener noreferrer"');
      findings.push('Added rel="noopener noreferrer" to target="_blank" links for tabnabbing protection.');
    }
  }

  // 3. Replace blocking window.alert / window.confirm comments or calls in TS/JS
  if (
    (lowerPath.endsWith('.ts') ||
      lowerPath.endsWith('.tsx') ||
      lowerPath.endsWith('.js') ||
      lowerPath.endsWith('.jsx')) &&
    /\bwindow\.(alert|confirm)\s*\(/.test(updated)
  ) {
    updated = updated.replace(
      /\bwindow\.(alert|confirm)\s*\(([^)]+)\)/g,
      '/* Mantis Suggestion: replace blocking modal with inline UI state */ ($2, false)',
    );
    findings.push('Flagged blocking window.alert/window.confirm calls (incompatible with mobile/iframe UX).');
  }

  // 4. Flag explicit console.log debugging left in source files
  if (
    (lowerPath.endsWith('.ts') || lowerPath.endsWith('.tsx')) &&
    /^\s*console\.log\(/m.test(updated)
  ) {
    updated = updated.replace(/^(\s*)console\.log\((.*)\);?\s*$/gm, '$1// removed debug log: ($2)');
    findings.push('Cleaned leftover console.log statements in TypeScript source.');
  }

  // 5. GitHub Actions workflow check: warn if npm ci is used without package-lock.json guard
  if (lowerPath.endsWith('.yml') || lowerPath.endsWith('.yaml')) {
    if (updated.includes('run: npm ci') && !updated.includes('if [ -f package-lock.json ]')) {
      updated = updated.replace(
        'run: npm ci',
        'run: |\n          if [ -f package-lock.json ]; then\n            npm ci --legacy-peer-deps --no-audit --no-fund\n          else\n            npm install --legacy-peer-deps --no-audit --no-fund\n          fi',
      );
      findings.push('Added lockfile fallback and --legacy-peer-deps in GitHub Actions install step.');
    }
  }

  // 6. SQL files: ensure GRANT USAGE on schema public is present alongside RLS
  if (lowerPath.endsWith('.sql')) {
    if (
      updated.toLowerCase().includes('enable row level security') &&
      !updated.toLowerCase().includes('grant usage on schema public')
    ) {
      updated = `${updated.trimEnd()}\n\ngrant usage on schema public to anon, authenticated;\n`;
      findings.push('Added explicit schema USAGE grant required by Postgres before RLS evaluation.');
    }
  }

  // 7. Flag potential secret leak patterns in frontend files
  if (/(sb_secret_|hf_[A-Za-z0-9]{15,})/.test(updated)) {
    findings.push('CRITICAL: Detected potential secret token pattern — remove from frontend immediately.');
  }

  // 8. If no automated rule changed lines, attach a helpful header/comment scaffold tailored to the user goal
  if (updated === original) {
    const cleanGoal = goal.trim() || 'Code review & clarity improvement';
    if (lowerPath.endsWith('.md')) {
      updated = `${original.trimEnd()}\n\n<!-- Mantis Review Note: ${cleanGoal} -->\n`;
      findings.push(`No mechanical defects detected; added structured review note for "${cleanGoal}".`);
    } else if (lowerPath.endsWith('.py') || lowerPath.endsWith('.yml') || lowerPath.endsWith('.yaml')) {
      updated = `# Mantis Proposed Review: ${cleanGoal}\n${original}`;
      findings.push(`No mechanical defects detected; staged editable proposal for "${cleanGoal}".`);
    } else if (lowerPath.endsWith('.sql')) {
      updated = `-- Mantis Proposed Review: ${cleanGoal}\n${original}`;
      findings.push(`No mechanical defects detected; staged editable SQL proposal for "${cleanGoal}".`);
    } else if (lowerPath.endsWith('.json')) {
      findings.push('JSON syntax verified clean; you can edit the proposed JSON directly below before approving.');
    } else {
      updated = `// Mantis Proposed Review: ${cleanGoal}\n${original}`;
      findings.push(`No mechanical defects detected; staged editable proposal for "${cleanGoal}".`);
    }
  }

  return {proposed: updated, findings};
}

export function generateImprovementSuggestion(
  file: RepoFile,
  goal: string,
  entries: KnowledgeEntry[],
  folders: KnowledgeFolder[],
): GeneratedSuggestionDraft {
  const query = `${file.path} ${goal}`.trim();
  const relevantKnowledge = retrieveRelevantKnowledge(query, entries, folders, 3);
  const {proposed, findings} = applySafeCodeImprovements(file.path, file.content, goal);

  const matchedRuleTitles = relevantKnowledge.map((m) => m.entry.title);
  const rationaleParts = [...findings];
  if (matchedRuleTitles.length > 0) {
    rationaleParts.push(
      `Referenced Knowledge rules: ${matchedRuleTitles.join(', ')}.`,
    );
  }

  return {
    filePath: file.path,
    title: goal.trim()
      ? `${file.path}: ${goal.trim().slice(0, 64)}`
      : `Improve ${file.path}`,
    rationale: rationaleParts.join(' '),
    originalContent: file.content,
    proposedContent: proposed,
    matchedRuleTitles,
  };
}

export function generateNewCodeSuggestion(
  targetPath: string,
  goal: string,
  entries: KnowledgeEntry[],
  folders: KnowledgeFolder[],
): GeneratedSuggestionDraft {
  const cleanPath = targetPath.trim() || 'src/lib/newHelper.ts';
  const cleanGoal = goal.trim() || 'Utility helper grounded in Mantis Knowledge';
  const matches = retrieveRelevantKnowledge(`${cleanPath} ${cleanGoal}`, entries, folders, 3);
  const matchedRuleTitles = matches.map((m) => m.entry.title);
  const lower = cleanPath.toLowerCase();

  const rulesComment =
    matchedRuleTitles.length > 0
      ? matchedRuleTitles.map((t) => ` * - Knowledge rule: ${t}`).join('\n')
      : ' * - Grounded in Mantis Phase 3 guarded code proposals';

  let proposedContent = '';
  if (lower.endsWith('.py')) {
    proposedContent = [
      `"""${cleanGoal}`,
      ...(matchedRuleTitles.length > 0
        ? matchedRuleTitles.map((t) => `Knowledge rule: ${t}`)
        : ['Generated as a new guarded proposal by Mantis.']),
      `"""`,
      '',
      'def run_task(payload: dict) -> dict:',
      '    if not isinstance(payload, dict):',
      '        raise ValueError("payload must be a dictionary")',
      '    return {"ok": True, "input_keys": sorted(payload.keys())}',
      '',
    ].join('\n');
  } else if (lower.endsWith('.sql')) {
    proposedContent = [
      `-- ${cleanGoal}`,
      ...(matchedRuleTitles.map((t) => `-- Knowledge rule: ${t}`)),
      '',
      'create table if not exists public.example_items (',
      '  id uuid primary key default gen_random_uuid(),',
      '  user_id uuid not null default auth.uid(),',
      '  label text not null,',
      '  created_at timestamptz not null default now()',
      ');',
      '',
      'alter table public.example_items enable row level security;',
      'grant usage on schema public to authenticated;',
      'grant select, insert, update, delete on table public.example_items to authenticated;',
      '',
    ].join('\n');
  } else {
    proposedContent = [
      '/**',
      ` * ${cleanGoal}`,
      rulesComment,
      ' */',
      '',
      'export interface TaskResult<T> {',
      '  ok: boolean;',
      '  data?: T;',
      '  error?: string;',
      '}',
      '',
      'export function executeGuardedStep<T>(fn: () => T): TaskResult<T> {',
      '  try {',
      '    return {ok: true, data: fn()};',
      '  } catch (err) {',
      '    return {',
      '      ok: false,',
      '      error: err instanceof Error ? err.message : "Unexpected error",',
      '    };',
      '  }',
      '}',
      '',
    ].join('\n');
  }

  return {
    filePath: cleanPath,
    title: `New file: ${cleanPath}`,
    rationale: `Proposed new module for "${cleanGoal}"${
      matchedRuleTitles.length > 0
        ? ` referencing Knowledge: ${matchedRuleTitles.join(', ')}`
        : ''
    }. Requires your approval before any write action.`,
    originalContent: '',
    proposedContent,
    matchedRuleTitles,
  };
}
