# Security Summary

**Reviewed Files**: 18
**Issues Resolved**: 5

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Unsafe External Link URIs | `src/components/KnowledgeBrowser.tsx`, `src/components/CaptureReviewModal.tsx`, `src/components/SuggestionsPanel.tsx` | 817, 206, 634 | Stored `source_url` and `pr_url` values were placed directly into `<a href=...>` attributes without verifying the URL scheme. | High | Fixed | Added `sanitizeExternalHttpUrl` in `src/lib/knowledgeSync.ts` enforcing strictly `http:` and `https:` schemes and blocking `javascript:`, `data:`, and `vbscript:` links before rendering. |
| Unvalidated External URL Fetching | `cloudflare/worker.js`, `supabase/functions/mantis-brain/helpers.ts`, `supabase/functions/mantis-brain/routes.ts`, `src/lib/aiBrain.ts` | 124, 92, 65, 224 | `/extract-url` and YouTube caption lookups could accept loopback, private network, integer/hex IP, or cloud metadata URLs and follow redirects without re-checking the target host. | High | Fixed | Added `isSafePublicHttpUrl`, `safePublicFetch` (manual redirect re-validation up to 4 hops), `isAllowedYouTubeCaptionUrl` (`*.youtube.com` / `*.googlevideo.com` HTTPS only), and client preflight `isSafePublicTargetUrl`. |
| Permissive CORS Origin Reflection | `cloudflare/worker.js`, `supabase/functions/mantis-brain/helpers.ts` | 30, 26 | Proxy responses echoed arbitrary `Origin` headers (or `*`), allowing untrusted websites to invoke authenticated browser CORS probes. | Medium | Fixed | Replaced open reflection with strict `resolveAllowedOrigin` allowlisting (`studiosmobile092-code.github.io`, `localhost`, AI Studio/Cloud Run preview origins, `*.github.io`) and `Vary: Origin`. |
| GitHub Path & Repo Identifier Handling | `src/lib/github.ts` | 41, 145 | Repo owner/name segments and file paths were concatenated into GitHub API URLs without checking for `..` traversal, query/fragment injection, or invalid characters. | Medium | Fixed | Added strict `GITHUB_SEGMENT_RE` validation, query/fragment stripping in `parseGitHubRepoInput`, `sanitizeRepoPath` blocking `.` / `..` / control chars, URL encoding, and `https://github.com/` PR link checks. |
| Unvalidated Offline Queue Payload | `src/lib/knowledgeSync.ts` | 265 | Queued write objects read from browser `localStorage` were replayed to Supabase without whitelisting columns or sanitizing field types. | Medium | Fixed | Added `ALLOWED_OFFLINE_ENTRY_COLUMNS` and `sanitizeOfflinePayload` inside both `enqueueOfflineWrite` and `loadOfflineWriteQueue` so tampered storage entries are dropped before database calls. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| Backend Authentication | `cloudflare/worker.js`, `supabase/functions/mantis-brain/helpers.ts` | Every protected route verifies the user's Supabase Bearer JWT against `/auth/v1/user` (with optional `ALLOWED_EMAIL` check) before invoking any AI provider or URL extractor. |
| API Keys & Secrets | `src/`, `.env.example`, `cloudflare/worker.js` | Private provider keys (`GROQ_API_KEY`, `OPENROUTER_API_KEY`, `HF_TOKEN`) and Supabase secret keys remain strictly inside backend Secrets and never appear in frontend code or GitHub Pages bundles. |
| Output Rendering | `src/components/ChatWorkspace.tsx`, `src/components/KnowledgeBrowser.tsx` | All chat messages, fenced code blocks, inline code spans, and saved entries render through React JSX text bindings with zero raw HTML injection (`dangerouslySetInnerHTML` absent across `src/`). |
| Dependency Security | `bun.lock`, `package.json` | Ran `bun audit --json` with zero known vulnerable dependencies reported (`{}`). |

---

## PoC Verification

### 1. Unsafe External Link URI (`javascript:` Payload Blocked)

#### Summary
| Field | Value |
|---|---|
| Issue Type | Unsafe External Link URI in Knowledge & Review Views |
| Impact | High |
| Affected File | `src/lib/knowledgeSync.ts:250`, `src/components/KnowledgeBrowser.tsx:817`, `src/components/CaptureReviewModal.tsx:206`, `src/components/SuggestionsPanel.tsx:634` |
| Test Scenario | Saved entry or drafted capture carrying `source_url: "javascript:alert(document.domain)"` or `data:text/html,<script>alert(1)</script>`. |

#### How It Was Fixed
Created `sanitizeExternalHttpUrl` in `src/lib/knowledgeSync.ts` to parse candidate URLs with `new URL(...)`, allow only `http:` and `https:` protocols, and return `null` for all other schemes or malformed strings. Applied it across every external anchor in `KnowledgeBrowser.tsx`, `CaptureReviewModal.tsx`, and `SuggestionsPanel.tsx`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `KnowledgeBrowser.tsx` (line 817) passes `entry.source_url` (`"javascript:alert(document.domain)"`) into `sanitizeExternalHttpUrl(entry.source_url)`. | Input enters URL sanitizer |
| 2 | `new URL(trimmed)` in `src/lib/knowledgeSync.ts` (line 255) parses `parsed.protocol === "javascript:"`. | Protocol check fails (`!== 'http:' && !== 'https:'`) |
| 3 | `sanitizeExternalHttpUrl` returns `null`; JSX conditional `{safeSourceUrl && <a href={safeSourceUrl}>...}` omits the link completely. | **Handled Safely** |

#### Conclusion
**Fix Verified** — Non-HTTP/HTTPS URIs cannot render as clickable anchors anywhere in the app.

---

### 2. Server-Side URL Extraction & Redirect Access (`169.254.169.254` Blocked)

#### Summary
| Field | Value |
|---|---|
| Issue Type | Private Network / Metadata Fetch via `/extract-url` |
| Impact | High |
| Affected File | `cloudflare/worker.js:124-183`, `supabase/functions/mantis-brain/helpers.ts:92-149`, `src/lib/aiBrain.ts:224-252` |
| Test Scenario | Authenticated POST to `/extract-url` with `{"url": "http://169.254.169.254/latest/meta-data/"}` or a public URL redirecting `302 Location: http://127.0.0.1:8080/admin`. |

#### How It Was Fixed
Added `isPrivateOrDisallowedHost`, `isSafePublicHttpUrl`, and `safePublicFetch` (`redirect: 'manual'` loop re-validating every `Location` target up to 4 hops) across both `cloudflare/worker.js` and `supabase/functions/mantis-brain/helpers.ts`, mirrored client-side by `isSafePublicTargetUrl` in `src/lib/aiBrain.ts`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `extractUrlViaBrain` (`src/lib/aiBrain.ts`) or backend `/extract-url` receives `http://169.254.169.254/latest/meta-data/` or follows a `302` redirect to `http://127.0.0.1:8080/admin`. | Target URL enters validator |
| 2 | `isSafePublicHttpUrl` invokes `isPrivateOrDisallowedHost(parsed.hostname)` matching `169.254.*` link-local metadata and `127.*` loopback ranges. | Validation returns `false` |
| 3 | `safePublicFetch` throws `'Blocked unsafe or private network URL target.'` before issuing any network request to the disallowed host. | **Handled Safely** |

#### Conclusion
**Fix Verified** — Loopback, private network, integer/hex IP, and cloud metadata endpoints are rejected both initially and after HTTP redirects.

---

### 3. Permissive CORS Origin Allowlist Enforcement

#### Summary
| Field | Value |
|---|---|
| Issue Type | Cross-Origin Request Reflection |
| Impact | Medium |
| Affected File | `cloudflare/worker.js:30-56`, `supabase/functions/mantis-brain/helpers.ts:26-49` |
| Test Scenario | Third-party page at `https://untrusted-site.example` sends an authenticated `fetch` or preflight `OPTIONS` request to `/ai/chat` or `/ai/verify` with `Origin: https://untrusted-site.example`. |

#### How It Was Fixed
Replaced unrestricted `Origin` reflection with `resolveAllowedOrigin(origin)` matching only exact expected production/local/preview hosts (`studiosmobile092-code.github.io`, `localhost`, `127.0.0.1`, `*.aistudio.google.com`, `*.run.app`, `*.googleusercontent.com`, `*.github.io`) and added `Vary: Origin`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Incoming request carries header `Origin: https://untrusted-site.example`. | Enters `corsHeaders(request)` |
| 2 | `resolveAllowedOrigin` parses hostname `untrusted-site.example` and checks the exact/suffix allowlist. | Returns empty string `''` |
| 3 | Response omits `Access-Control-Allow-Origin` for the untrusted origin while still sending `Vary: Origin`. | **Handled Safely** |

#### Conclusion
**Fix Verified** — Browsers block cross-origin reads from untrusted domains while GitHub Pages, local dev, and preview origins work normally.

---

### 4. GitHub Repository & Path Traversal Guard

#### Summary
| Field | Value |
|---|---|
| Issue Type | Path Traversal & API Segment Manipulation |
| Impact | Medium |
| Affected File | `src/lib/github.ts:41-55, 145-160` |
| Test Scenario | User or stored state supplies `repoInput = "owner/repo?per_page=100#frag"` or `filePath = "../../.github/workflows/deploy.yml"`. |

#### How It Was Fixed
Added `GITHUB_SEGMENT_RE` validation in `parseGitHubRepoInput` (stripping query/fragment suffixes and rejecting disallowed characters), plus `sanitizeRepoPath` rejecting leading `/`, backslashes, null bytes, and `.` / `..` path segments before issuing GitHub API requests.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `fetchGitHubFileContent` or `createPullRequestForApprovedSuggestion` receives `../../.github/workflows/deploy.yml`. | Enters `sanitizeRepoPath` |
| 2 | Segment split detects `'..'` traversal token and rejects the path immediately. | Guard throws validation error |
| 3 | No GitHub Contents or PR API request is dispatched for malformed owner/repo or traversal paths. | **Handled Safely** |

#### Conclusion
**Fix Verified** — GitHub API URLs always contain clean, validated owner, repo, and relative file paths.

---

### 5. LocalStorage Offline Queue Payload Sanitization

#### Summary
| Field | Value |
|---|---|
| Issue Type | Unvalidated Local Queue Replay Payload |
| Impact | Medium |
| Affected File | `src/lib/knowledgeSync.ts:233-335` |
| Test Scenario | Modified `mantis_offline_write_queue_v1` JSON in browser `localStorage` includes unexpected fields (`created_at`, arbitrary objects) or an unsafe `source_url` in `payload`. |

#### How It Was Fixed
Added `ALLOWED_OFFLINE_ENTRY_COLUMNS` and `sanitizeOfflinePayload` enforced both when queuing (`enqueueOfflineWrite`) and when reading (`loadOfflineWriteQueue`). Required keys (`title`/`content`, `id`, `status`) and column types are validated before queuing or replaying writes to Supabase.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `loadOfflineWriteQueue` reads `mantis_offline_write_queue_v1` containing unexpected keys or `source_url: "javascript:..."`. | Enters `sanitizeOfflinePayload` |
| 2 | Non-whitelisted keys are ignored, `status` is checked against `'raw' \| 'reviewed' \| 'trusted'`, and `source_url` is filtered through `sanitizeExternalHttpUrl`. | Unsafe fields stripped/nullified |
| 3 | Missing required string fields drop the malformed item cleanly before `flushOfflineQueue` ever calls Supabase. | **Handled Safely** |

#### Conclusion
**Fix Verified** — Only strictly typed, schema-whitelisted fields can replay from the offline queue to Supabase.
