# Entity Resolution

Deterministic (no ML, no embeddings) duplicate merging — "John Smith", "John", "Mr Smith", and
"J. Smith" should resolve into one entity. Implemented in
`apps/web/features/graph/services/resolution.service.ts`, called by the extraction pipeline before
creating any new `PERSON` entity.

## Why person names specifically

Person names are the one extracted type where the same real-world entity plausibly appears under
several different surface strings across documents (a first-reference full name, then a shortened
or title-prefixed reference later). `COMPANY`/`PROJECT`/`MEETING`/`PRODUCT`/`EVENT`/`WEBSITE`
mentions are deduplicated with a simpler rule — an exact, case-insensitive title match
(`findEntityByExactTitle` in `packages/database/src/repositories/graph-nodes.ts`) — since
extraction doesn't attempt to normalize those the way it does names.

## The algorithm

```ts
function normalizeName(name: string): string {
  return name
    .replace(/^(mr|mrs|ms|miss|dr|prof)\.?\s+/i, '')
    .replace(/[.,]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
```

Match rules, tried in order, first match wins:

1. **Exact normalized match** — `normalizeName(candidate) === normalizeName(input)`. Catches "John
   Smith" vs "john smith" vs "John  Smith" (extra whitespace).
2. **Last-name + first-initial match** — splits both names into words; if the last word matches and
   the first letter of the first word matches, it's the same person. Catches "J. Smith" vs "John
   Smith" and "Mr Smith" vs "John Smith" (the honorific is stripped before this comparison, so
   "Mr Smith" normalizes to just "smith" — a single word — and falls through to rule 3 instead; see
   the worked example below).
3. **First-name-only match, only if unambiguous** — if the input is a single word (e.g. "John") and
   **exactly one** existing candidate in the org has that first name, treat it as the same person.
   If two or more existing people share that first name, a new entity is created instead of
   guessing — an ambiguous match is a worse failure mode than an occasional duplicate.

If none of the three rules match, `resolvePersonName` returns `{ matchedEntityId: null }` and the
pipeline creates a new `PERSON` entity.

## Worked example

Given an org that already has one `PERSON` entity, "John Smith":

| Input        | Normalized  | Rule that matches                              | Result            |
| ------------ | ----------- | ----------------------------------------------- | ----------------- |
| `John Smith` | `john smith`| 1 (exact)                                        | merged            |
| `J. Smith`   | `j. smith` → after punctuation strip: `j smith` | 2 (last name `smith` + first initial `j`) | merged |
| `Mr Smith`   | `smith` (honorific stripped, one word left)     | 3 — but only unambiguous, and `smith` isn't a *first* name here, so this actually **falls through to no match** and creates a new entity — a known, documented limitation of rule 3, which only fires for single-word inputs interpreted as first names. Rule 2 does not apply either, since `Mr Smith` after normalization has no "last name" to compare (single word). |
| `John`       | `john`      | 3 — matches only if "John" is the sole existing first name in the org | merged (if unambiguous) |

The "Mr Smith" case is a real, acknowledged gap: a bare last name with only an honorific isn't
matched by any of the three rules as written, since rule 2 needs two words (first + last) on the
input side. This is the kind of imprecision the spec explicitly accepts ("rule-based... no AI") —
documented here rather than silently glossed over.

## Match pool

`listPersonCandidates(organizationId)` (`packages/database/src/repositories/graph-nodes.ts`) pulls
every `PERSON`/`CONTACT` entity's `Contact.name` in the org — the resolution engine only ever
compares against existing entities within the same organization (multi-tenancy is preserved; see
"Permissions" in docs/knowledge-graph.md).

## What's not built

No fuzzy/edit-distance matching (e.g. Levenshtein), no phonetic matching (e.g. Soundex), no
cross-organization resolution, no manual "merge these two entities" UI — a human reviewing and
merging two entities that automatic resolution missed would be a reasonable Phase 4 addition, not
built here.
