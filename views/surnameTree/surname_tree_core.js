/*
Created By: Azure Robinson (Robinson-27225)
*/

// The pure parts of the Surname Tree feature: counting surnames, the shape of the tree, and the word cloud layout.
// Nothing here touches the page, so it can be tested on its own. Sizes are in "logical pixels" on a WIDTH x HEIGHT canvas.

export const WIDTH = 1000;
export const HEIGHT = 880;
export const CELL = 4; // the layout grid is CELL logical pixels per cell

/** Capital letters are about this tall compared with the font size; the layout reserves a box of this height. */
const CAP_HEIGHT = 0.8;

/** Surname values that stand for "nobody", so they are not drawn. */
const NOT_A_SURNAME = /^(unknown|unk|unknown-?\d*|private|private-?\d*|\?+|-+|n\/?a|none|\(.*\))$/i;

/** The surname a person is counted under: the one they were born with (or the current one when that is missing), in capitals. "" if none. */
export function surnameOf(person) {
    const raw = String((person && (person.LastNameAtBirth || person.LastNameCurrent)) || "")
        .replace(/\s+/g, " ")
        .trim();
    return !raw || NOT_A_SURNAME.test(raw) ? "" : raw.toLocaleUpperCase();
}

/**
 * What the tree is made of. Surnames are one name each. First names and middle names are fields that can hold several
 * names with spaces between ("Mary Ann"), and each of those is counted on its own.
 */
export const NAME_KINDS = [
    {
        id: "surname",
        name: "Surnames",
        noun: "surname",
        nouns: "surnames",
        title: "Surname Tree",
        file: "surname-tree",
    },
    {
        id: "first",
        name: "First names",
        noun: "first name",
        nouns: "first names",
        title: "First Name Tree",
        file: "first-name-tree",
    },
    {
        id: "middle",
        name: "Middle names",
        noun: "middle name",
        nouns: "middle names",
        title: "Middle Name Tree",
        file: "middle-name-tree",
    },
    {
        id: "given",
        name: "First and middle names",
        noun: "given name",
        nouns: "given names",
        title: "Given Name Tree",
        file: "given-name-tree",
    },
];

export const kindById = (id) => NAME_KINDS.find((k) => k.id === id) || NAME_KINDS[0];

/** Punctuation round a name that is not part of it: "(Ann)," or "J." */
const EDGE_PUNCTUATION = /^[\s.,;:!?()[\]{}"'\u2018\u2019\u201c\u201d]+|[\s.,;:!?()[\]{}"'\u2018\u2019\u201c\u201d]+$/g;

/**
 * The separate names in a field, in capitals: it is split wherever there is a space, so "Mary Ann" is MARY and ANN, and
 * "Mary-Ann" (no space) stays one name. Initials (a single letter, as in "J." or "J") and values that stand for nobody
 * ("Unknown", "Private") are left out. A name that appears twice in the field is listed once.
 */
export function splitNames(field) {
    const names = [];
    String(field || "")
        .split(/\s+/)
        .forEach((token) => {
            const name = token.replace(EDGE_PUNCTUATION, "");
            if (name.length < 2 || NOT_A_SURNAME.test(name)) return;
            const upper = name.toLocaleUpperCase();
            if (!names.includes(upper)) names.push(upper);
        });
    return names;
}

/** The names a person is counted under for this kind of tree, each once: a person with two first names is in both. */
export function namesOf(person, kind = "surname") {
    if (!person) return [];
    if (kind === "surname") {
        const surname = surnameOf(person);
        return surname ? [surname] : [];
    }
    const fields =
        kind === "first"
            ? [person.FirstName]
            : kind === "middle"
            ? [person.MiddleName]
            : [person.FirstName, person.MiddleName];
    const names = [];
    fields.forEach((field) => splitNames(field).forEach((name) => names.includes(name) || names.push(name)));
    return names;
}

/**
 * Group entries ({ person, bio, adopt }) by name, for surnames, first names, middle names or both given names. Returns
 * [{ text, count, entries }], most common first, ties alphabetical. A person counts once for each of their names.
 */
export function groupNames(entries, kind = "surname") {
    const groups = new Map();
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
        namesOf(entry && entry.person, kind).forEach((text) => {
            if (!groups.has(text)) groups.set(text, []);
            groups.get(text).push(entry);
        });
    });
    return [...groups]
        .map(([text, list]) => ({ text, count: list.length, entries: list }))
        .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
}

/** The same, for surnames. */
export const groupSurnames = (entries) => groupNames(entries, "surname");

/** Count the surnames in a list of people from the API: [{ text, count }], most common first. */
export function countSurnames(people) {
    return groupSurnames((Array.isArray(people) ? people : []).map((person) => ({ person }))).map(
        ({ text, count }) => ({
            text,
            count,
        })
    );
}

/**
 * How far the tree reaches. "Ancestors" goes back by generations; "CC7" is everyone connected within a number of degrees
 * (parents, children, siblings and spouses each one degree). min and max bound the + and - buttons (the API's own limit
 * for degrees is 10).
 */
export const SCOPES = [
    {
        id: "ancestors",
        name: "Ancestors",
        hint: "parents, grandparents and so on back through the generations",
        unit: "generation",
        units: "generations",
        min: 2,
        max: 12,
        start: 8,
    },
    {
        id: "cc7",
        name: "CC7 (everyone nearby)",
        hint: "everyone connected within a number of degrees: parents, children, siblings and spouses each count as one",
        unit: "degree",
        units: "degrees",
        min: 1,
        max: 10,
        start: 7,
    },
];

export const scopeById = (id) => SCOPES.find((s) => s.id === id) || SCOPES[0];

/** WikiTree's `DataStatus.Father` / `DataStatus.Mother` value for a parent who is not the birth parent. */
const NON_BIOLOGICAL = 5;

/** A real profile id: a positive number. Zero, null and negative placeholders (private) are not. */
const realId = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

const isNonBiological = (person, field) =>
    Number(person && person.DataStatus && person.DataStatus[field]) === NON_BIOLOGICAL;

/**
 * The links from a person up to their parents: [{ id, adoptive }]. The parent shown on the profile is an adoptive (or
 * step or foster) parent when it is marked non-biological, and then BioFather / BioMother, when present, name the birth
 * parent as well. A shown parent that is not marked non-biological is the birth parent.
 */
export function parentEdges(person) {
    if (!person) return [];
    const edges = [];
    [
        ["Father", "BioFather"],
        ["Mother", "BioMother"],
    ].forEach(([shownField, bioField]) => {
        const shown = realId(person[shownField]);
        const bio = realId(person[bioField]);
        const shownIsAdoptive = isNonBiological(person, shownField);
        if (bio) edges.push({ id: bio, adoptive: false });
        if (shown && shown !== bio) edges.push({ id: shown, adoptive: shownIsAdoptive });
    });
    return edges;
}

/** A person's own id as a number. */
export const idOf = (person) => realId(person && person.Id);

/**
 * Which of the two kinds of connection reach each person from the root, within `maxSteps` steps. "Biological" means a
 * path of birth links only; "adoptive" means a path with at least one adoptive link in it (after which any link may
 * follow, since the adoptive parent's own parents are the adopted person's family too), that does not come back to the
 * root. Marriages count as neither, so
 * they keep whichever kind the path already was. Returns Map id -> { bio, adopt }.
 *
 * `neighbours(id)` gives [{ id, adoptive }] for the links out of a person.
 */
export function reachFrom(rootId, maxSteps, neighbours) {
    const reach = new Map();
    const seen = new Set([`${rootId}|false`]);
    let frontier = [{ id: rootId, adoptive: false }];
    for (let step = 0; frontier.length; step++) {
        markReach(reach, frontier);
        if (step >= maxSteps) break;
        frontier = nextFrontier(frontier, seen, neighbours, rootId);
    }
    return reach;
}

/** Record in `reach` that these people ({ id, adoptive }) were reached, by a birth path or an adoptive one. */
export function markReach(reach, frontier) {
    frontier.forEach(({ id, adoptive }) => {
        const mark = reach.get(id) || { bio: false, adopt: false };
        if (adoptive) mark.adopt = true;
        else mark.bio = true;
        reach.set(id, mark);
    });
}

/**
 * The people one more step out from `frontier`, skipping any already reached the same way (`seen` remembers them).
 * A path through an adoptive link may not come back to the root: that would lead out along the root's own birth
 * relatives and make them adoptive family too.
 */
export function nextFrontier(frontier, seen, neighbours, rootId) {
    const next = [];
    frontier.forEach(({ id, adoptive }) => {
        neighbours(id).forEach((edge) => {
            const flag = adoptive || edge.adoptive;
            if (flag && edge.id === rootId) return;
            const key = `${edge.id}|${flag}`;
            if (seen.has(key)) return;
            seen.add(key);
            next.push({ id: edge.id, adoptive: flag });
        });
    });
    return next;
}

/**
 * Everyone within `degrees` of the root, from a list of profiles that already holds them all (the API's CC7 answer):
 * a graph of parent, child, sibling and spouse links, searched with reachFrom. Siblings are a link of their own: an
 * adoptive one if either child was adopted by the shared parent. Returns Map id -> { bio, adopt }.
 */
export function reachNearby(people, rootId, degrees) {
    const byId = new Map();
    people.forEach((person) => idOf(person) && byId.set(idOf(person), person));
    const links = new Map();
    const link = (from, to, adoptive) => {
        if (!byId.has(from) || !byId.has(to) || from === to) return;
        if (!links.has(from)) links.set(from, []);
        links.get(from).push({ id: to, adoptive });
    };
    const children = new Map(); // parent id -> [{ id: child id, adoptive }]
    byId.forEach((person, id) => {
        parentEdges(person).forEach((edge) => {
            link(id, edge.id, edge.adoptive);
            link(edge.id, id, edge.adoptive);
            if (!children.has(edge.id)) children.set(edge.id, []);
            children.get(edge.id).push({ id, adoptive: edge.adoptive });
        });
        const spouses = person.Spouses;
        const spouseIds = Array.isArray(spouses)
            ? spouses.map((s) => realId(s && s.Id))
            : Object.entries(spouses || {}).map(([key, value]) => realId((value && value.Id) || key));
        spouseIds.forEach((spouseId) => {
            link(id, spouseId, false);
            link(spouseId, id, false);
        });
    });
    children.forEach((kids) => {
        for (let i = 0; i < kids.length; i++) {
            for (let j = i + 1; j < kids.length; j++) {
                const adoptive = kids[i].adoptive || kids[j].adoptive;
                link(kids[i].id, kids[j].id, adoptive);
                link(kids[j].id, kids[i].id, adoptive);
            }
        }
    });
    return reachFrom(rootId, degrees, (id) => links.get(id) || []);
}

/** Entries ({ person, bio, adopt }) for the people a reach map holds. */
export function entriesFromReach(reach, byId) {
    const entries = [];
    reach.forEach((mark, id) => {
        const person = byId.get(id);
        if (person) entries.push({ person, bio: mark.bio, adopt: mark.adopt });
    });
    return entries;
}

/** The entries to show for the Biological and Adoptive tick boxes. */
export function chooseByRelation(entries, { biological = true, adoptive = true } = {}) {
    return (entries || []).filter((e) => (biological && e.bio) || (adoptive && e.adopt));
}

/** "adoptive" for someone who is family only through an adoption; "" otherwise. */
export const relationNote = (entry) => (entry && entry.adopt && !entry.bio ? "adoptive" : "");

// ---------------------------------------------------------------------------------------------
// Showing people
// ---------------------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "1901-08-02" as "2 Aug 1901"; "1901-08-00" as "Aug 1901"; "1901-00-00" as "1901"; nothing known as "". */
export function formatDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match || match[1] === "0000") return "";
    const [, year, month, day] = match;
    const monthName = MONTHS[Number(month) - 1];
    if (!monthName) return year;
    return Number(day) ? `${Number(day)} ${monthName} ${year}` : `${monthName} ${year}`;
}

/** A person's full name: WikiTree's LongName when the API gave it, otherwise built from the parts. */
export function fullName(person) {
    if (!person) return "";
    const long = String(person.LongName || "")
        .replace(/\s+/g, " ")
        .trim();
    if (long) return long;
    const built = [
        person.FirstName || person.RealName,
        person.MiddleName,
        person.LastNameAtBirth || person.LastNameCurrent,
    ]
        .filter(Boolean)
        .join(" ")
        .trim();
    return built || person.Name || "";
}

/** "2 Aug 1901, Caledonia, Missouri": the date and the place, whichever are known. */
export const lifeEvent = (date, place) => [formatDate(date), String(place || "").trim()].filter(Boolean).join(", ");

/** A sort key for a person's list order: birth year, with unknown years last. */
export function birthYear(person) {
    const m = String((person && person.BirthDate) || "").match(/^(\d{4})/);
    return m && m[1] !== "0000" ? Number(m[1]) : 9999;
}

/** A small seeded random number generator, so the same profile gives the same tree until "Shuffle" is pressed. */
export function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A number from a string, for seeding. */
export function hashString(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

// ---------------------------------------------------------------------------------------------
// The shape
// ---------------------------------------------------------------------------------------------

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const lerp = (a, b, t) => a + (b - a) * t;

/** A rough crown, like the rounded dome of an oak or a maple: lobes of leaves. buildTree bends, resizes and adds to these so no two trees match. */
const CROWN_TEMPLATE = [
    [500, 225, 215],
    [315, 280, 172],
    [690, 280, 175],
    [190, 375, 135],
    [815, 372, 138],
    [395, 215, 150],
    [610, 205, 150],
    [385, 375, 135],
    [630, 372, 135],
    [500, 360, 142],
    [260, 235, 110],
    [745, 235, 112],
];

/** Points along a cubic Bezier curve. */
function bezier(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return [
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ];
}

/**
 * A limb as a chain of circles along a curve, thick at the start and tapering to the tip. Circles overlap enough to
 * look like a smooth tapered stroke, and the whole limb is the union of its circles.
 */
function limb(p0, p1, p2, p3, startRadius, endRadius, taper = 1) {
    const circles = [];
    let t = 0;
    while (t <= 1) {
        const [x, y] = bezier(p0, p1, p2, p3, t);
        const r = lerp(startRadius, endRadius, Math.pow(t, taper));
        circles.push({ x, y, r });
        t += Math.max(0.01, (r * 0.4) / 340);
    }
    const [x, y] = p3;
    circles.push({ x, y, r: endRadius });
    return circles;
}

/** Whether two circles overlap well enough to look like one mass (a fraction `slack` of the smaller one's radius). */
export const touching = (a, b, slack = 0.3) =>
    Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - slack * Math.min(a.r, b.r);

/**
 * Make a set of circles one connected mass: starting from the biggest, the circle nearest to what is joined so far is
 * moved in until it overlaps it, and so on. So no clump of leaves is left floating apart from the rest of the crown.
 */
export function joinUp(circles) {
    if (circles.length < 2) return circles;
    const biggest = circles.reduce((a, b) => (b.r > a.r ? b : a));
    const joined = [biggest];
    let rest = circles.filter((c) => c !== biggest);
    while (rest.length) {
        let best = null;
        rest.forEach((c) =>
            joined.forEach((j) => {
                const gap = Math.hypot(c.x - j.x, c.y - j.y) - (c.r + j.r - 0.4 * Math.min(c.r, j.r));
                if (!best || gap < best.gap) best = { c, j, gap };
            })
        );
        if (best.gap > 0) {
            const distance = Math.hypot(best.c.x - best.j.x, best.c.y - best.j.y) || 1;
            best.c.x += ((best.j.x - best.c.x) * best.gap) / distance;
            best.c.y += ((best.j.y - best.c.y) * best.gap) / distance;
        }
        joined.push(best.c);
        rest = rest.filter((c) => c !== best.c);
    }
    return circles;
}

/**
 * A tree that is different for each seed: a rounded crown of leafy lobes of uneven size and tint, leaning one way, with
 * small bumps round its edge, all joined into one mass; and a thick, leaning, curving trunk that forks into limbs of
 * different lengths, thickness and curl. Each limb runs up into a clump of leaves, and the twigs off them end in the
 * leaves too, so nothing hangs loose. Returns { crown: [{ x, y, r, hue, light }], trunk: [{ x, y, r }], tips, seed },
 * where tips are the points where limbs and twigs end, inside the crown.
 */
export function buildTree(seed = 1) {
    const random = seededRandom((seed >>> 0) ^ 0x9e3779b9);
    const between = (lo, hi) => lo + random() * (hi - lo);

    // ---- the crown
    const lean = between(-1, 1); // which side droops
    const widthLeft = between(0.94, 1.06);
    const widthRight = between(0.94, 1.06);
    const fit = (c) => {
        const r = clamp(c.r, 18, 230);
        return { ...c, r, x: clamp(c.x, 8 + r, 992 - r), y: clamp(c.y, 8 + r, 600 - r) };
    };
    const body = CROWN_TEMPLATE.map(([x, y, r]) => {
        const spread = x < 500 ? widthLeft : widthRight;
        return fit({
            x: 500 + (x - 500) * spread + between(-40, 40),
            y: y + between(-36, 36) + lean * (x - 500) * 0.1,
            r: r * between(0.8, 1.18),
        });
    });
    // now and then a lobe is missing, so the outline is not the same each time
    if (random() < 0.6) body.splice(1 + Math.floor(random() * 6), 1);
    // small bumps of leaves round the outside
    const bumps = [];
    const bumpCount = 7 + Math.floor(random() * 6);
    for (let i = 0; i < bumpCount; i++) {
        const base = body[Math.floor(random() * body.length)];
        const angle = between(Math.PI * 0.95, Math.PI * 2.05); // the top and sides, not the underside
        bumps.push(
            fit({
                x: base.x + Math.cos(angle) * base.r * 0.88,
                y: base.y + Math.sin(angle) * base.r * 0.88,
                r: between(24, 58),
            })
        );
    }
    let crown = body.concat(bumps).map((c) => ({ ...c, hue: between(100, 140), light: random() })); // each clump its own green
    // pulled together into one mass (then kept inside the picture), so no clump floats apart
    for (let pass = 0; pass < 3; pass++) crown = joinUp(crown).map(fit);
    // drawn from the top down, so lower clumps overlap the ones above them
    crown.sort((a, b) => a.y + a.r - (b.y + b.r));

    // ---- the trunk, and limbs that end in clumps of leaves
    const lowest = Math.max(...body.map((c) => c.y + c.r));
    const base = [500 + between(-60, 60), 872];
    const fork = [base[0] + between(-60, 60) + lean * 25, clamp(lowest + between(10, 70), 540, 650)];
    const sway = between(40, 80) * (random() < 0.5 ? -1 : 1);
    const trunk = limb(
        base,
        [base[0] + sway, base[1] - (base[1] - fork[1]) * 0.33],
        [fork[0] - sway * 0.8, base[1] - (base[1] - fork[1]) * 0.7],
        fork,
        between(62, 80),
        between(30, 40),
        0.8
    );
    const tips = [];
    // limbs go to the lower clumps of leaves, spread across the crown
    const lower = body.filter((c) => c.y + c.r > lowest - 230).sort((a, b) => a.x - b.x);
    const limbCount = Math.min(lower.length, random() < 0.35 ? 4 : 3);
    const used = new Set();
    for (let i = 0; i < limbCount; i++) {
        const wanted = lerp(210, 790, (i + 0.5) / limbCount) + between(-50, 50);
        const target = lower
            .filter((c) => !used.has(c))
            .sort((a, b) => Math.abs(a.x - wanted) - Math.abs(b.x - wanted))[0];
        used.add(target);
        // the tip is well inside the clump, so the limb is hidden in the leaves where it ends
        const tip = [target.x + between(-0.3, 0.3) * target.r, target.y + between(-0.2, 0.35) * target.r];
        const dx = tip[0] - fork[0];
        const body1 = limb(
            fork,
            [fork[0] + dx * between(0.05, 0.3), fork[1] - between(50, 130)],
            [tip[0] - dx * between(0.1, 0.35), tip[1] + between(30, 110)],
            tip,
            between(24, 33),
            between(6, 11),
            between(0.7, 1.1)
        );
        trunk.push(...body1);
        tips.push({ x: tip[0], y: tip[1] });
        // a twig off most limbs, growing up into the leaves
        if (random() < 0.8) {
            const at = body1[Math.floor(body1.length * between(0.4, 0.75))];
            const near = body.filter((c) => Math.hypot(c.x - at.x, c.y - at.y) < 340 && c !== target);
            if (near.length) {
                const goal = near[Math.floor(random() * near.length)];
                const end = [goal.x + between(-0.35, 0.35) * goal.r, goal.y + between(-0.35, 0.35) * goal.r];
                const side = end[0] > at.x ? 1 : -1;
                trunk.push(
                    ...limb(
                        [at.x, at.y],
                        [at.x + side * between(5, 25), at.y - between(20, 60)],
                        [end[0] - side * between(10, 40), end[1] + between(20, 60)],
                        end,
                        at.r * 0.7,
                        3.5,
                        0.9
                    )
                );
                tips.push({ x: end[0], y: end[1] });
            }
        }
    }
    return { crown, trunk, tips, seed };
}

/** Rasterize circles into a mask of grid cells. */
function paintCircles(mask, cols, rows, circles, skip) {
    circles.forEach(({ x, y, r }) => {
        const row0 = Math.max(0, Math.floor((y - r) / CELL));
        const row1 = Math.min(rows - 1, Math.ceil((y + r) / CELL));
        const col0 = Math.max(0, Math.floor((x - r) / CELL));
        const col1 = Math.min(cols - 1, Math.ceil((x + r) / CELL));
        for (let row = row0; row <= row1; row++) {
            for (let col = col0; col <= col1; col++) {
                const dx = (col + 0.5) * CELL - x;
                const dy = (row + 0.5) * CELL - y;
                if (dx * dx + dy * dy <= r * r && !(skip && skip[row * cols + col])) mask[row * cols + col] = 1;
            }
        }
    });
}

const DEFAULT_TREE_SEED = 1;

/** Which cells of the layout grid are inside the crown, and inside the trunk and limbs (the part the crown does not cover). */
export function buildMasks(tree = buildTree(DEFAULT_TREE_SEED)) {
    const cols = Math.ceil(WIDTH / CELL);
    const rows = Math.ceil(HEIGHT / CELL);
    const crown = new Uint8Array(cols * rows);
    const trunk = new Uint8Array(cols * rows);
    paintCircles(crown, cols, rows, tree.crown);
    paintCircles(trunk, cols, rows, tree.trunk, crown);
    return { cols, rows, crown, trunk };
}

/** The middle of a mask, in cells. */
function centroid(mask, cols) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let i = 0; i < mask.length; i++) {
        if (mask[i]) {
            sx += i % cols;
            sy += Math.floor(i / cols);
            n++;
        }
    }
    return n ? { col: sx / n, row: sy / n } : { col: 0, row: 0 };
}

// ---------------------------------------------------------------------------------------------
// The layout
// ---------------------------------------------------------------------------------------------

/** The most surnames laid out, and how many in a row may fail to fit before the rest are given up on. */
export const MAX_WORDS = 600;
const MAX_MISSES = 15;

export const MAX_FONT = 118;
export const MIN_FONT = 10;

/** A font size for each count: the most common name is MAX_FONT, the least common near MIN_FONT, eased so the middle is not tiny. */
export function fontSizeFor(count, minCount, maxCount, maxFont = MAX_FONT, minFont = 14) {
    if (maxCount <= minCount) return Math.round((maxFont + minFont) / 2);
    const t = (count - minCount) / (maxCount - minCount);
    return Math.round(minFont + (maxFont - minFont) * Math.pow(t, 0.62));
}

/**
 * The angle, in degrees, to turn a word: clockwise is positive, and never past upright, so nothing is upside down. The
 * first few and the biggest words stay (nearly) level to be easy to read; the rest are level, upright, or at any angle.
 */
export function chooseAngle(random, index, size) {
    if (index === 0) return 0;
    if (index < 3 || size >= 80) return (random() - 0.5) * 24;
    const r = random();
    if (r < 0.38) return 0;
    if (r < 0.5) return random() < 0.5 ? -90 : 90;
    return (random() - 0.5) * 150; // anywhere from -75 to 75
}

/**
 * The cells (as [columns across, rows down] from the cell holding the word's middle) that a w x h box turned by `angle`
 * degrees covers, with `pad` added all round. A cell counts when its middle is inside the box.
 */
export function boxOffsets(w, h, angle, pad) {
    const radians = (angle * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const halfW = w / 2 + pad;
    const halfH = h / 2 + pad;
    const reach = Math.ceil(Math.hypot(halfW, halfH) / CELL);
    const cells = [];
    for (let dr = -reach; dr <= reach; dr++) {
        for (let dc = -reach; dc <= reach; dc++) {
            const x = dc * CELL;
            const y = dr * CELL;
            // the cell's middle, as seen from the turned box
            if (Math.abs(x * cos + y * sin) <= halfW && Math.abs(-x * sin + y * cos) <= halfH) cells.push([dc, dr]);
        }
    }
    return cells;
}

/** The grid cells a placed word covers (for checking that words stay inside the tree and apart from each other). */
export function wordCells(item) {
    const col = Math.round(item.x / CELL - 0.5);
    const row = Math.round(item.y / CELL - 0.5);
    return boxOffsets(item.w, item.h, item.angle, CELL * 0.5).map(([dc, dr]) => [col + dc, row + dr]);
}

/**
 * Place words inside the tree. Words are tried largest first, each spiralling out from the middle of its part of the tree
 * (the crown or the trunk) until it finds a spot where its turned box is wholly inside that part and clear of every other
 * word. A word that finds no room is made smaller until it fits or reaches the smallest size, then dropped.
 *
 * words:   [{ text, count }], most common first
 * measure: (text, fontSize) => width in logical pixels
 * masks:   from buildMasks(tree)
 * Returns [{ text, count, region: "crown" | "trunk", x, y, size, angle, w, h, rank }] where x, y is the middle of the
 * word, angle its turn in degrees, and w, h the size of its box before turning.
 */
export function layoutWords({ words, measure, random = Math.random, fillGaps = true, masks = buildMasks() }) {
    const { cols, rows } = masks;
    const regions = {
        crown: { mask: masks.crown, ...centroid(masks.crown, cols), stretchX: 1.5, stretchY: 1 },
        trunk: { mask: masks.trunk, ...centroid(masks.trunk, cols), stretchX: 0.55, stretchY: 1.7 },
    };
    const taken = new Uint8Array(cols * rows);
    const placed = [];

    /** Whether a word whose middle is the cell (col, row) fits: every cell it covers is in the region and free. */
    const fits = (region, col, row, cover) => {
        const mask = region.mask;
        for (let i = 0; i < cover.length; i++) {
            const c = col + cover[i][0];
            const r = row + cover[i][1];
            if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
            const at = r * cols + c;
            if (!mask[at] || taken[at]) return false;
        }
        return true;
    };

    const occupy = (col, row, cover) => {
        cover.forEach(([dc, dr]) => {
            const c = col + dc;
            const r = row + dr;
            if (c >= 0 && r >= 0 && c < cols && r < rows) taken[r * cols + c] = 1;
        });
    };

    /** Spiral out from the region's middle; returns the cell for the word's middle, or null. */
    const findSpot = (region, cover) => {
        const maxIterations = 9000;
        let theta = random() * Math.PI * 2;
        let r = 0;
        for (let i = 0; i < maxIterations; i++) {
            const col = Math.round(region.col + r * Math.cos(theta) * region.stretchX);
            const row = Math.round(region.row + r * Math.sin(theta) * region.stretchY);
            if (fits(region, col, row, cover)) return { col, row };
            theta += 1.6 / Math.max(r, 3);
            r += (3 / (Math.PI * 2)) * (1.6 / Math.max(r, 3));
            if (r > cols) break;
        }
        return null;
    };

    const place = (word, size, regionName, angle, rank) => {
        const region = regions[regionName];
        let fontSize = size;
        while (fontSize >= MIN_FONT) {
            const w = measure(word.text, fontSize);
            const h = fontSize * CAP_HEIGHT;
            const cover = boxOffsets(w, h, angle, CELL * 0.5);
            const spot = findSpot(region, cover);
            if (spot) {
                // a gap of one more cell round the word keeps the next one from touching it
                occupy(spot.col, spot.row, boxOffsets(w, h, angle, CELL * 1.5));
                const item = {
                    text: word.text,
                    count: word.count,
                    region: regionName,
                    x: (spot.col + 0.5) * CELL,
                    y: (spot.row + 0.5) * CELL,
                    size: fontSize,
                    angle,
                    w,
                    h,
                    rank,
                };
                placed.push(item);
                return item;
            }
            fontSize = Math.floor(fontSize * 0.88);
        }
        return null;
    };

    if (!words.length) return placed;
    const maxCount = words[0].count;
    const minCount = words[words.length - 1].count;

    // Pass one: every surname once, sized by how common it is. Every fifth name from the fourth on goes in the trunk, so
    // the trunk carries some of the larger names too rather than only the leftovers.
    // A big CC7 can have thousands of surnames, most of them one person each. Only the first MAX_WORDS are tried, and
    // trying stops after a run of names that find no room, since the rarer ones that follow would not fit either.
    let misses = 0;
    for (let index = 0; index < Math.min(words.length, MAX_WORDS) && misses < MAX_MISSES; index++) {
        const word = words[index];
        const size = fontSizeFor(word.count, minCount, maxCount);
        const regionName = index >= 3 && index % 5 === 4 ? "trunk" : "crown";
        const angle = chooseAngle(random, index, size);
        // if one part of the tree has no room for it, the other may
        const done =
            place(word, size, regionName, angle, index) ||
            place(word, size, regionName === "crown" ? "trunk" : "crown", angle, index);
        misses = done ? 0 : misses + 1;
    }

    // Pass two: if the member wants the tree filled, repeat the names at small sizes until nothing more fits.
    if (fillGaps) {
        let missed = 0;
        let i = 0;
        const limit = 700;
        while (missed < 25 && i < limit) {
            const index = i % words.length;
            const word = words[index];
            const size = Math.round(MIN_FONT + 3 + random() * 9);
            const regionName = random() < 0.8 ? "crown" : "trunk";
            const angle = chooseAngle(random, 99, size);
            const item = place(word, size, regionName, angle, index);
            if (!item) {
                const other = place(word, size, regionName === "crown" ? "trunk" : "crown", angle, index);
                missed = other ? 0 : missed + 1;
            } else {
                missed = 0;
            }
            i++;
        }
    }
    return placed;
}

// ---------------------------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------------------------

export function hslToHex(h, s, l) {
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const channel = (n) => {
        const k = (n + h / 30) % 12;
        const value = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(255 * value)
            .toString(16)
            .padStart(2, "0");
    };
    return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function hexToHsl(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (!d) return [0, 0, l * 100];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    return [h, s * 100, l * 100];
}

export const COLORS = {
    trunkLight: "#f1e4cd",
    trunkDark: "#cdb48f",
    trunkInner: "#6e4a1e", // the limbs as they show through the leaves
    crownWords: ["#1f8f2b", "#2ba03a", "#3aaa49", "#52b85a", "#1a7a26", "#6cc274"],
    trunkWords: ["#7a4510", "#8b5a1c", "#6b3a0c", "#9a6a2a", "#5d3309"],
};

/** How strongly the limbs show through the leaves. */
export const INNER_BRANCH_OPACITY = 0.12;

/** The two greens of a clump of leaves: lit at its upper left, shadowed towards the lower right. */
export function crownColors(lobe) {
    const lift = lobe.light * 6;
    return {
        lit: hslToHex(lobe.hue, 54, 94 - lift * 0.5),
        shade: hslToHex(lobe.hue + 6, 48, 74 - lift),
    };
}

/** Where on a clump the light falls, and how far the shading spreads, as fractions of its radius. */
export const LIGHT = { dx: -0.32, dy: -0.38, spread: 1.2 };

/**
 * The colour of a placed word: one of the greens (or browns on the trunk), made lighter towards the upper left of the tree and
 * darker towards the lower right, the way the clumps are shaded.
 */
export function colorFor(item) {
    const list = item.region === "trunk" ? COLORS.trunkWords : COLORS.crownWords;
    const [h, s, l] = hexToHsl(list[(item.rank * 7 + item.text.length) % list.length]);
    const toward = (item.x / WIDTH - 0.5) * 8 + (item.y / HEIGHT - 0.4) * 12; // positive towards the lower right
    return hslToHex(h, s, clamp(l - toward, 16, 58));
}
