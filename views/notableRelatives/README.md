# Notable Relatives

A Tree App view that finds the notable people related to a profile, grouped by how closely they are related, with
filters for category, country, place, notable marker, and name.

**Help page:** [Space:Notable_Relatives](https://www.wikitree.com/wiki/Space:Notable_Relatives). **Version:** shown at
the bottom of the view with links to the author's profile ([Robinson-27225](https://www.wikitree.com/wiki/Robinson-27225))
and the Help page; history in [CHANGELOG.md](CHANGELOG.md).

Open it from any profile's Tree Apps, or go to
`https://apps.wikitree.com/apps/wikitree-dynamic-tree/#name=<WikiTree-ID>&view=notableRelatives`.

**Idea:** Blake Ashton ([Ashton-4458](https://www.wikitree.com/wiki/Ashton-4458)), in an answer posted 7 November 2026
to the G2G question
[WikiTree Days Saturday Question: If you could invent one new WikiTree tool, what would it do?](https://www.wikitree.com/g2g/2105562/wikitree-days-saturday-question-could-invent-wikitree-would?show=2105577#a2105577).
Inspired by Relative Finder, which finds famous relatives on FamilySearch.

## Two searches

### Shared ancestors (default)

Finds notable ancestors, notable descendants, and notable cousins through shared ancestors up to 15 generations
back. You choose 3–15 generations; the default is 8.

1. **Family** comes from ONE WikiTree API call, `getPeople ancestors=<gens> descendants=10` (no descendants for
   "ancestors only"), when it fits in one answer of 1,000 relatives; otherwise a generation at a time
   (`getPeople ancestors=g minGeneration=g`).
2. **One WikiTree+ search**, `descendants="<ID>,<ID>,…" NotableProfile` (numeric user IDs; no `Format` parameter,
   since `.json` says it; sent by POST when too long for a web address). The list holds only the furthest-back
   ancestors on each line, one partner per couple: everyone descended from a child is descended from that child's
   parents, and a couple shares its descendants. Each list includes the people named in it, so the answer also
   holds the notable ancestors within the chosen generations, and none further back.
   **What to find** (`find=` in the address): `all` (the default), `relatives` (the same search, ancestors left
   out), or `ancestors`, which asks `ancestors="<ID>" NotableProfile` instead (or `ancestors="<chosen parents>"`
   with a Biological or Adoptive choice) and keeps only the ancestors within the chosen generations.
3. **Sorting the answer:** ancestors are those in the family call, named exactly ("6th great-grandfather"). The
   starting profile's own descendants are those in its descendants list, named exactly ("grandson"). Everyone else is
   a cousin; each card's **Relationship** link opens WikiTree's Relationship Finder for the exact relationship.

WikiTree+ is asked one request at a time with a pause after each, a request is never abandoned or resent, and a
refusal pauses all WikiTree+ requests for 15 minutes (see `plusQueue` in `notable_data.js`).

### Within 7 degrees

`CC7=<ID> NotableProfile` from WikiTree+, plus each relative's degree from `getPeople nuclear=d minGeneration=d`.
This search includes in-laws. Some notables appear in WikiTree+'s CC7 that the API's list didn't reach. That
happens when the API, without a login, won't go on past living, privacy-limited profiles. For those, the shortest
path comes from `getConnections`. Relationships are named from the parent links (`kinship.js`). When a marriage link
is closer than the blood link, the marriage comes first, e.g. "husband (also 2nd cousin once removed)".

### Both searches

`NotableProfile` means any notable template, so it includes the `{{Notability}}` template and the Notables Sticker.
The search and filters are kept in the URL hash (`mode`, `gens`, `group`, `cat`, `loc`, `place`, `marker`, `q`), so a
list can be shared. Finished searches are kept in memory, so switching between them is instant.

## Logo

`images/notable-relatives-logo.svg` (on the dark-green tile, shown in the view header) and
`images/notable-relatives-mark.svg` (no tile), with PNG copies at 512, 192 and 32 px for G2G posts or a free-space
page. How it was made: `images/logo.brief.md`.

## Files

| File                   | What it does                                                                      |
| ---------------------- | --------------------------------------------------------------------------------- |
| `notableRelatives.js`  | The view: search choice, progress, filters, groups, cards, CSV download           |
| `notable_data.js`      | WikiTree+ and API calls, both searches, records, filters, facets, CSV (no DOM)    |
| `kinship.js`           | Relationship names from parent links or a connection path (no DOM)                |
| `notableRelatives.css` | Styles, all scoped under `.nr-view`                                               |
| `CHANGELOG.md`         | Version history; the newest entry must match `VERSION` in `notable_data.js`       |
| `images/`              | The logo (SVG and PNG) and its brief                                              |
| `test/`                | `node --test views/notableRelatives/test/` (Node 22 or later, nothing to install) |

## Uploading to the Apps server

The app is uploaded from its own folder, `~/code/notable-relatives`, the same way as `~/code/genealogy-report`. That
folder is the whole Tree Apps site (the view needs `tree.js`, `WikiTreeAPI.js`, `index.html` and `index.js`) with this
view. Drafts (the Space page markup, the G2G post, and the Space page images) are kept outside the repo and the upload
folder, in `~/code/docs/notable-relatives/`.
The code and tests live in the git repo, `~/code/wikitree-dynamic-tree` (branch `notableRelatives`).

1. After changing the code in the repo, refresh the folder (the tests stay in the repo):

    ```bash
    rsync -a --delete --exclude .git --exclude .github --exclude .claude --exclude node_modules \
      --exclude views/notableRelatives/test ~/code/wikitree-dynamic-tree/ ~/code/notable-relatives/
    ```

2. Upload the contents of `~/code/notable-relatives/` to `apps/robinson27225/notable-relatives/` on the Apps server
   (see [Help:WikiTree Apps Server](https://www.wikitree.com/wiki/Help:WikiTree_Apps_Server)).
3. Open `https://apps.wikitree.com/apps/robinson27225/notable-relatives/index.html#view=notableRelatives`, enter a
   WikiTree ID, and click GO. Hard-refresh if the version at the bottom is not the one you uploaded.
