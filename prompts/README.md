# System prompts (IT-owned, file-based)

Prompts for the contract-review AI pipeline live **in Git** (`/prompts/<stage>/`). In the demo app, the **IT** role can view and edit the CURRENT file at `/dashboard/system-prompts` (writes to disk; same validation as CI). Prefer PR review for production changes. Legal-managed business rules (Ideal / Fallback / Red Line, severity, keywords, conditions) must **never** be hardcoded here — they are injected at runtime via `{{checklist_items}}` (and related placeholders) from the Legal checklist config (Mục 6.1).

## Stages

| Folder | Pipeline stage | When used |
|--------|----------------|-----------|
| `_shared/injection_guard.md` | Prepended to every stage at load time | All LLM calls |
| `checklist_review/` | First-pass AI review vs checklist | Processing Queue |
| `chat_edit/` | Follow-up edits from Purchasing chat | Chat panel |
| `ai_summary_fairness/` | Plain-language summary + fairness scoring inputs | Confidence / insight popup |

## Shared injection guard

`_shared/injection_guard.md` is **not** a stage. The loader (`loadSystemPrompt`) always prepends it before the stage CURRENT body. The IT console edits/saves **stage files only** (raw, without the guard) so the guard is never duplicated into `v*.md`.

The guard must not contain `{{placeholders}}` — CI rejects any.

## Versioning

- One file per version: `v1.md`, `v2.md`, …
- **Never edit a version file in place after it has been used in production.** Create `v2.md` and repoint `CURRENT`.
- `current.json` points at the active file (preferred over symlinks for Windows / CI):

```json
{ "file": "v1.md" }
```

Git history + the version filename give a full audit trail without a DB.

## Placeholder convention

Every prompt may contain `{{placeholder}}` tokens. Only the placeholders listed for that stage are allowed (CI rejects typos).

### `checklist_review`

| Placeholder | Meaning |
|-------------|---------|
| `{{contract_type}}` | Contract type id / label |
| `{{checklist_items}}` | Serialized Legal checklist (Loại, Mức độ nghiêm trọng, Văn bản mẫu chuẩn / Ideal, Fallback, Red Line, Rationale, Từ khoá/pattern, Điều kiện áp dụng) |
| `{{document_text}}` | Extracted contract text under review |

### `chat_edit`

| Placeholder | Meaning |
|-------------|---------|
| `{{contract_type}}` | Contract type id / label |
| `{{checklist_items}}` | Same checklist payload as above |
| `{{conversation_history}}` | Prior chat turns |
| `{{current_document_state}}` | Current reviewed document text / relevant excerpt |

### `ai_summary_fairness`

| Placeholder | Meaning |
|-------------|---------|
| `{{contract_type}}` | Contract type id / label |
| `{{findings}}` | Classified Red Flag / Warning / Protection / Missing Protection list |
| `{{approval_matrix_context}}` | Approval Matrix tiers / thresholds for scoring context |

## Hard rules (enforced in CI)

1. **No hardcoded Legal clause content** in prompt files. Heuristic lint rejects Vietnamese legal-sounding patterns / numeric thresholds (e.g. `60 ngày`, `90 ngày`) outside `{{...}}`. Business rules belong in Legal’s checklist config.
2. **Unknown placeholders** for the stage → CI fail (typo protection).
3. PR checklist (human): *Does this prompt hardcode any business rule that belongs in Legal’s checklist config instead?*

## Loader (app code)

```ts
import { loadSystemPrompt, renderPrompt } from "@/lib/system-prompts";

const template = loadSystemPrompt("checklist_review"); // guard + stage CURRENT
const prompt = renderPrompt(template, {
  contract_type: "...",
  checklist_items: "...",
  document_text: "...",
});
```

- `loadSystemPrompt(stage)` — prepends `_shared/injection_guard.md` + stage `current.json` / `CURRENT` (no substitution).
- `loadSystemPromptRaw(stage)` — stage file only (IT console).
- `renderPrompt(template, vars)` — substitutes `{{key}}`; throws if a placeholder used in the template is missing from `vars`.

## Local / CI validation

From `frontend/`:

```bash
npm run validate:prompts
```

This must run on every PR that touches `/prompts/**`.
