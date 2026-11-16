/*
 * Data for the Notable Relatives view.
 *
 * Two searches:
 *
 * - "Shared ancestors" (the default), in the spirit of Relative Finder: the starting profile's ancestors up to
 *   N generations (WikiTree API), then WikiTree+ finds the notable ancestors ("Ancestors=<id> NotableProfile"),
 *   the notable descendants ("Descendants=<id> NotableProfile") and, one generation at a time, the notable
 *   descendants of each generation of ancestors ("Descendants=<ancestor> NotableProfile OR ..."). A notable is
 *   grouped by the first generation whose ancestors it descends from: its closest shared ancestors.
 * - "Within 7 degrees": everyone within 7 degrees from getPeople nuclear=7, matched against WikiTree+'s list of all
 *   notable profiles ("NotableProfile"). WikiTree+'s own "CC7=<id>" stops at private profiles, so on its own it
 *   misses notables reached through a private relative; its "CC7=<id> NotableProfile" answer is still added in.
 *
 * NotableProfile means any notable template, so it includes every "Notability" and "Notables Sticker" profile.
 * WikiTree+ returns profile ids only; a getPeople call gives the notables' details, categories and templates.
 *
 * The network functions take the API caller as an argument, so this module runs under node for tests.
 */

import {
    parentGraph,
    relationshipNamer,
    relationshipFromSteps,
    describeRelationship,
    sharedAncestorsLabel,
    cousinRangeLabel,
} from "./kinship.js";

// Semantic version (major.minor.patch), 0.x while the app is in beta. Raise it with every upload and add an entry to
// CHANGELOG.md; a test checks the two agree. A fix raises the last number, a new feature the middle one.
export const VERSION = "0.2.0";
export const AUTHOR_ID = "Robinson-27225";
export const AUTHOR_URL = `https://www.wikitree.com/wiki/${AUTHOR_ID}`;
export const HELP_URL = "https://www.wikitree.com/wiki/Space:Notable_Relatives";

export const APP_ID = "notableRelatives"; // WikiTreeAPI.postToAPI prepends "TA-"
export const PLUS_APP_ID = "TA-notableRelatives";
export const MAX_DEGREE = 7;
export const DEFAULT_GENERATIONS = 12;
export const MAX_GENERATIONS = 15;
const MAX_DESCENDANT_GENERATIONS = 10; // the API's limit
export const PAGE_LIMIT = 1025;
const MAX_PAGES = 40;
const PROFILE_CHUNK = 1000;
const MAX_QUERY_LENGTH = 3000; // characters of encoded WikiTree+ query per request

const TREE_FIELDS = ["Id", "Name", "Father", "Mother", "Gender", "Meta"];
export const PROFILE_FIELDS = [
    "Id",
    "Name",
    "FirstName",
    "LastNameAtBirth",
    "LastNameCurrent",
    "Derived.ShortName",
    "Derived.LongName",
    "Gender",
    "BirthDate",
    "DeathDate",
    "BirthLocation",
    "DeathLocation",
    "IsLiving",
    "Photo",
    "PhotoData",
    "Categories",
    "Templates",
];

export const MARKERS = {
    notability: "Notability template",
    sticker: "Notables Sticker",
    other: "Other notable template",
};

// ---------- WikiTree+ ----------

export function plusSearchUrl(query, appId = PLUS_APP_ID, page = null) {
    const paging = page ? `&PageSize=${page.size}&PageIdx=${page.index}` : "";
    return (
        "https://plus.wikitree.com/function/WTWebProfileSearch/" +
        `${appId}.json?Query=${encodeURIComponent(query)}&MaxProfiles=${page ? 1000000 : 100000}${paging}` +
        `&Format=JSON&appID=${appId}`
    );
}

/** Profile ids matching a WikiTree+ query. @returns {Promise<{ids:number[], dataDate:string}>} */
export async function fetchPlusIds(query, { fetchFn = fetch, signal } = {}) {
    const res = await withRetry(() => fetchFn(plusSearchUrl(query), { signal }), { signal });
    if (!res.ok) throw new Error(`The WikiTree+ search did not answer (HTTP ${res.status}). Please try again later.`);
    const json = await res.json();
    return {
        ids: (json?.response?.profiles || []).map(Number).filter(Boolean),
        dataDate: json?.debug?.dataDate || "",
    };
}

/** Ids of the notable profiles within 7 degrees of wtId (a WikiTree ID such as "Windsor-1"). */
export function fetchPlusNotableIds(wtId, options = {}) {
    return fetchPlusIds(`CC7=${wtId} NotableProfile`, options);
}

const ALL_NOTABLES_PAGE = 100000; // WikiTree+ returns at most 100,000 ids per answer
let allNotablesPromise = null;

/**
 * The ids of every notable profile on WikiTree (about 111,000, under 1 MB), asked once per page load.
 * @returns {Promise<{ids:Set<number>, dataDate:string}>}
 */
export function fetchAllNotableIds({ fetchFn = fetch, signal } = {}) {
    if (!allNotablesPromise) {
        allNotablesPromise = (async () => {
            const ids = new Set();
            let dataDate = "";
            for (let index = 0; index < 10; index++) {
                const url = plusSearchUrl("NotableProfile", PLUS_APP_ID, { size: ALL_NOTABLES_PAGE, index });
                const res = await withRetry(() => fetchFn(url, { signal }), { signal });
                if (!res.ok)
                    throw new Error(
                        `The WikiTree+ search did not answer (HTTP ${res.status}). Please try again later.`
                    );
                const json = await res.json();
                const page = (json?.response?.profiles || []).map(Number).filter(Boolean);
                page.forEach((id) => ids.add(id));
                dataDate = dataDate || json?.debug?.dataDate || "";
                const found = Number(json?.response?.found) || 0;
                if (page.length < ALL_NOTABLES_PAGE || ids.size >= found) break;
            }
            return { ids, dataDate };
        })();
        allNotablesPromise.catch(() => (allNotablesPromise = null)); // a failed download is tried again next time
    }
    return allNotablesPromise;
}

/** Forgets the downloaded list of notables (for tests). */
export function resetAllNotableIds() {
    allNotablesPromise = null;
}

/**
 * "Descendants=A NotableProfile OR Descendants=B NotableProfile ..." in as few queries as fit the length limit.
 * WikiTree+ binds AND tighter than OR, so each ancestor needs its own NotableProfile.
 */
export function descendantsQueries(wtIds, maxLength = MAX_QUERY_LENGTH) {
    const queries = [];
    let terms = [];
    let length = 0;
    for (const wtId of wtIds) {
        const term = `Descendants=${wtId} NotableProfile`;
        const termLength = encodeURIComponent(` OR ${term}`).length;
        if (terms.length && length + termLength > maxLength) {
            queries.push(terms.join(" OR "));
            terms = [];
            length = 0;
        }
        terms.push(term);
        length += termLength;
    }
    if (terms.length) queries.push(terms.join(" OR "));
    return queries;
}

// ---------- WikiTree API ----------

/**
 * Everyone up to maxGeneration steps from rootId along `relation` ("nuclear", "ancestors" or "descendants"),
 * asked one generation at a time (relation=g, minGeneration=g): getPeople keeps no fixed order between the pages
 * of one big request, so paging through all generations at once skips people. Within a generation WikiTree returns
 * at most PAGE_LIMIT people per call and says "Maximum number of profiles" when more follow.
 * The starting profile is not included.
 * @returns {Promise<{people: Map<number, object>, isPartial: boolean}>}
 */
export async function fetchByGeneration(
    rootId,
    relation,
    maxGeneration,
    { api, signal, onProgress = () => {}, people = new Map() } = {}
) {
    let isPartial = false;
    for (let generation = 1; generation <= maxGeneration; generation++) {
        let start = 0;
        let foundHere = 0;
        for (let page = 0; page < MAX_PAGES; page++) {
            const result = await withRetry(
                () =>
                    api(
                        {
                            appId: APP_ID,
                            action: "getPeople",
                            keys: String(rootId),
                            [relation]: generation,
                            minGeneration: generation,
                            fields: TREE_FIELDS.join(","),
                            start,
                            limit: PAGE_LIMIT,
                        },
                        signal
                    ),
                { signal }
            );
            const status = String(result?.[0]?.status || "");
            const got = Object.values(result?.[0]?.people || {});
            const before = people.size;
            for (const p of got) {
                if (Number(p?.Id) !== Number(rootId)) addTreePerson(people, p, generation);
            }
            foundHere += people.size - before;
            onProgress(people.size, generation);

            const hasMore = status.startsWith("Maximum number of profiles");
            if (status && !hasMore) {
                if (!got.length) throw new Error(`WikiTree could not list the relatives: ${status}`);
                isPartial = true;
                break;
            }
            if (!hasMore || people.size === before) break;
            start += PAGE_LIMIT;
            if (page === MAX_PAGES - 1) isPartial = true;
        }
        if (!foundHere) break; // the family reaches no further
    }
    return { people, isPartial };
}

/** Everyone within `degrees` of rootId (CC7), with their degree and parents, the starting profile included. */
export async function fetchCc7(rootId, { api, signal, onProgress = () => {}, degrees = MAX_DEGREE } = {}) {
    const people = new Map();
    // minGeneration leaves the starting profile out, and its parents are needed to name relationships.
    const rootResult = await withRetry(
        () => api({ appId: APP_ID, action: "getPeople", keys: String(rootId), fields: TREE_FIELDS.join(",") }, signal),
        { signal }
    );
    for (const p of Object.values(rootResult?.[0]?.people || {})) {
        if (Number(p?.Id) === Number(rootId)) addTreePerson(people, p, 0, true);
    }
    return fetchByGeneration(rootId, "nuclear", degrees, { api, signal, onProgress, people });
}

function addTreePerson(people, p, askedDegree, isExact = false) {
    const id = Number(p?.Id);
    if (!id) return;
    const metaDegree = p.Meta && Number.isFinite(Number(p.Meta.Degrees)) ? Number(p.Meta.Degrees) : null;
    const degree = isExact ? askedDegree : (metaDegree ?? askedDegree);
    const prev = people.get(id);
    if (prev && prev.degree !== null && (degree === null || prev.degree <= degree)) return;
    people.set(id, {
        id,
        name: p.Name || "",
        father: Number(p.Father) || 0,
        mother: Number(p.Mother) || 0,
        gender: p.Gender || "",
        degree,
    });
}

/** True when the browser lost the connection ("Failed to fetch" in Chrome, "NetworkError" in Firefox, "Load failed" in Safari). */
export function isNetworkError(err) {
    if (err?.name === "AbortError") return false;
    return /failed to fetch|networkerror|network error|load failed|network connection/i.test(
        String(err?.message ?? err ?? "")
    );
}

export const NETWORK_MESSAGE =
    "The connection to WikiTree dropped (Failed to fetch). Check your internet connection and try again.";

const RETRY_DELAYS = [1500, 4000]; // milliseconds before the second and third tries

/** Runs fn, trying again after a pause when the connection drops. Other errors are not retried. */
export async function withRetry(fn, { signal, delays = RETRY_DELAYS } = {}) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (!isNetworkError(err) || attempt >= delays.length || signal?.aborted) throw err;
            await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
        }
    }
}

/** True for WikiTree's rate limit: the API's "Limit exceeded." status, or HTTP 429 from postToAPI. */
export function isLimitError(errOrStatus) {
    const text = String(errOrStatus?.message ?? errOrStatus ?? "");
    return /limit exceeded|status: 429/i.test(text);
}

export const LIMIT_MESSAGE =
    "WikiTree is limiting requests from this computer for a while (Limit exceeded). " +
    "Wait a few minutes and try again, or choose fewer generations.";

/**
 * Full details for the given ids, in chunks the API accepts. @returns {Promise<Map<number, object>>}
 * A chunk WikiTree refuses (for example "Limit exceeded.") is an error, so notables are never dropped silently.
 */
export async function fetchProfiles(ids, { api, signal } = {}) {
    const profiles = new Map();
    for (let i = 0; i < ids.length; i += PROFILE_CHUNK) {
        const keys = ids.slice(i, i + PROFILE_CHUNK);
        const result = await withRetry(
            () =>
                api(
                    { appId: APP_ID, action: "getPeople", keys: keys.join(","), fields: PROFILE_FIELDS.join(",") },
                    signal
                ),
            { signal }
        );
        const status = String(result?.[0]?.status || "");
        const people = Object.values(result?.[0]?.people || {});
        if (status && !people.length) throw new Error(`WikiTree could not read the notable profiles: ${status}`);
        for (const p of people) {
            const id = Number(p?.Id);
            if (id) profiles.set(id, p);
        }
    }
    return profiles;
}

/**
 * The degree of one relative the CC7 list did not reach, from WikiTree's shortest connection.
 * Without a login the API does not go on past living, privacy-limited profiles, but getConnections does.
 * @returns {Promise<{degree:number, steps:string[]}|null>}
 */
export async function fetchConnection(rootWtId, wtId, { api, signal } = {}) {
    const result = await withRetry(
        () => api({ appId: APP_ID, action: "getConnections", keys: `${rootWtId},${wtId}` }, signal),
        { signal }
    );
    const res = Array.isArray(result) ? result[0] : result;
    const path = Array.isArray(res?.path) ? res.path : [];
    if (path.length < 2) return null;
    return { degree: path.length - 1, steps: path.slice(1).map((s) => String(s?.pathType || "")) };
}

/** Fills in a CC7 record's degree and relationship from fetchConnection(). Unchanged when conn is null. */
export function applyConnection(record, conn) {
    if (!conn || conn.degree > MAX_DEGREE + 1) return record;
    const { label, isBlood } = relationshipFromSteps(conn.steps, record.gender);
    record.degree = conn.degree;
    record.relationship = label;
    record.isBlood = isBlood;
    record.isFromConnection = true;
    Object.assign(record, cc7Group(conn.degree));
    return record;
}

// ---------- the shared-ancestors search ----------

/**
 * Finds the notable ancestors, descendants and cousins of the starting profile, nearest generation first.
 * onFound is awaited for each batch, so the caller can read the profiles and show them as they come.
 *
 * @param {object} o
 * @param {number} o.rootId
 * @param {string} o.rootWtId
 * @param {number} o.generations how many generations of ancestors to search through
 * @param {(found: {kind:"ancestor"|"ancestor-far"|"descendant"|"cousin", ids:number[], generation?:number,
 *        ancestors:Map, descendants:Map, generations:number}) => any} o.onFound   pass it to buildAncestralRecords
 * @param {(status: {stage:string, generation?:number, count?:number, query?:number, queries?:number}) => void} o.onStatus
 */
export async function searchAncestral({
    rootId,
    rootWtId,
    generations,
    api,
    fetchFn = fetch,
    signal,
    onStatus = () => {},
    onFound = () => {},
}) {
    const gens = Math.max(1, Math.min(MAX_GENERATIONS, Number(generations) || DEFAULT_GENERATIONS));
    const { people: ancestors, isPartial } = await fetchByGeneration(rootId, "ancestors", gens, {
        api,
        signal,
        onProgress: (count, generation) => onStatus({ stage: "ancestors", count, generation }),
    });
    const seen = new Set([Number(rootId), ...ancestors.keys()]);
    let descendants = new Map();
    const report = (found) => onFound({ ...found, ancestors, descendants, generations: gens });
    let dataDate = "";
    let failedQueries = 0;
    const plus = async (query) => {
        const res = await fetchPlusIds(query, { fetchFn, signal });
        dataDate = dataDate || res.dataDate;
        return res.ids;
    };

    // Notable ancestors: WikiTree+ looks back through every generation.
    onStatus({ stage: "notable-ancestors" });
    const ancestorIds = await plus(`Ancestors=${rootWtId} NotableProfile`);
    const near = ancestorIds.filter((id) => ancestors.has(id));
    const far = ancestorIds.filter((id) => !ancestors.has(id) && id !== Number(rootId));
    far.forEach((id) => seen.add(id));
    if (near.length) await report({ kind: "ancestor", ids: near });
    if (far.length) await report({ kind: "ancestor-far", ids: far });

    // Notable descendants, with their generation from the API.
    onStatus({ stage: "notable-descendants" });
    const descendantIds = (await plus(`Descendants=${rootWtId} NotableProfile`)).filter((id) => !seen.has(id));
    if (descendantIds.length) {
        descendants = (await fetchByGeneration(rootId, "descendants", MAX_DESCENDANT_GENERATIONS, { api, signal }))
            .people;
        descendantIds.forEach((id) => seen.add(id));
        await report({ kind: "descendant", ids: descendantIds });
    }

    // Cousins: the notable descendants of each generation of ancestors, nearest first.
    for (let generation = 1; generation <= gens; generation++) {
        const wtIds = [...ancestors.values()].filter((a) => a.degree === generation && a.name).map((a) => a.name);
        const queries = descendantsQueries(wtIds);
        const found = [];
        for (let q = 0; q < queries.length; q++) {
            onStatus({ stage: "cousins", generation, query: q + 1, queries: queries.length });
            let ids = null;
            for (let attempt = 0; attempt < 2 && ids === null; attempt++) {
                try {
                    ids = await plus(queries[q]);
                } catch (err) {
                    if (err?.name === "AbortError") throw err;
                    if (attempt === 1) failedQueries++;
                }
            }
            for (const id of ids || []) {
                if (!seen.has(id)) {
                    seen.add(id);
                    found.push(id);
                }
            }
        }
        if (found.length) await report({ kind: "cousin", ids: found, generation });
    }
    return { ancestors, descendants, generations: gens, dataDate, failedQueries, isPartial };
}

// ---------- shaping ----------

const COUNTRY_ALIASES = new Map([
    ["usa", "United States"],
    ["u.s.a.", "United States"],
    ["us", "United States"],
    ["u.s.", "United States"],
    ["united states", "United States"],
    ["united states of america", "United States"],
    ["uk", "United Kingdom"],
    ["great britain", "United Kingdom"],
]);

/** The last part of a WikiTree place ("Kensington, London, England" -> "England"). */
export function countryOf(place) {
    const parts = String(place || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    if (!parts.length) return "";
    const last = parts[parts.length - 1].replace(/\.$/, "");
    return COUNTRY_ALIASES.get(last.toLowerCase()) || last;
}

export function yearOf(date) {
    const m = /^(\d{4})/.exec(String(date || ""));
    return m && m[1] !== "0000" ? Number(m[1]) : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "1850-03-00" -> "Mar 1850", "1850-03-07" -> "7 Mar 1850", "0000-00-00" -> "" */
export function formatDate(date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ""));
    if (!m || m[1] === "0000") return "";
    const [, y, mo, d] = m;
    if (mo === "00") return y;
    const month = MONTHS[Number(mo) - 1] || "";
    return d === "00" ? `${month} ${y}` : `${Number(d)} ${month} ${y}`;
}

export function markersOf(templates) {
    const names = (Array.isArray(templates) ? templates : []).map((t) => String(t?.name || "").toLowerCase());
    const markers = [];
    if (names.includes("notability")) markers.push("notability");
    if (names.some((n) => n === "notables sticker" || n === "notables")) markers.push("sticker");
    if (!markers.length) markers.push("other");
    return markers;
}

export const categoryLabel = (c) => String(c || "").replace(/_/g, " ");

function displayName(p) {
    const short = p?.Derived?.ShortName || p?.ShortName;
    if (short) return short;
    const parts = [p?.FirstName, p?.LastNameAtBirth].filter(Boolean);
    return parts.length ? parts.join(" ") : p?.Name || "Private";
}

function photoUrl(p) {
    const url = p?.PhotoData?.url || p?.PhotoData?.path;
    return url ? `https://www.wikitree.com${url}` : "";
}

const isNotablesCategory = (c) => /notables?\b/i.test(c);
function compareCategories(a, b) {
    return isNotablesCategory(b) - isNotablesCategory(a) || a.localeCompare(b);
}

/** The fields every record has, from a getPeople profile. */
function baseRecord(id, p) {
    const birthPlace = p.BirthLocation || "";
    const deathPlace = p.DeathLocation || "";
    return {
        id,
        wtId: p.Name || "",
        name: displayName(p),
        longName: p?.Derived?.LongName || "",
        gender: p.Gender || "",
        birthDate: formatDate(p.BirthDate),
        deathDate: formatDate(p.DeathDate),
        birthYear: yearOf(p.BirthDate),
        deathYear: yearOf(p.DeathDate),
        birthPlace,
        deathPlace,
        countries: [...new Set([countryOf(birthPlace), countryOf(deathPlace)].filter(Boolean))],
        photoUrl: photoUrl(p),
        categories: (p.Categories || []).map(categoryLabel).sort(compareCategories),
        markers: markersOf(p.Templates),
        order: 0,
    };
}

/*
 * Every record belongs to one group: group (a number, for order), groupKey (for the filter and the URL),
 * groupHeading, groupNote (a line under the heading) and groupShort (the filter checkbox).
 */

export function cc7Group(degree) {
    if (degree === null || degree === undefined) {
        return {
            group: 999,
            groupKey: "unknown",
            groupHeading: "Degree not found",
            groupShort: "Unknown",
            groupNote: "",
        };
    }
    return {
        group: degree,
        groupKey: `d${degree}`,
        groupHeading: degree === 0 ? "Starting profile" : `${degree} degree${degree === 1 ? "" : "s"} away`,
        groupShort: degree === 0 ? "Self" : String(degree),
        groupNote: "",
    };
}

export function ancestralGroup(kind, generation, generations) {
    if (kind === "ancestor") {
        return {
            group: -3,
            groupKey: "anc",
            groupHeading: "Notable ancestors",
            groupShort: "Ancestors",
            groupNote: "",
        };
    }
    if (kind === "descendant") {
        return {
            group: -2,
            groupKey: "desc",
            groupHeading: "Notable descendants",
            groupShort: "Descendants",
            groupNote: "",
        };
    }
    if (kind === "ancestor-far") {
        return {
            group: 1000,
            groupKey: "anc-far",
            groupHeading: `Notable ancestors more than ${generations} generations back`,
            groupShort: "Older ancestors",
            groupNote: "",
        };
    }
    return {
        group: generation,
        groupKey: `g${generation}`,
        groupHeading: `Shared ${sharedAncestorsLabel(generation)}`,
        groupShort: `Gen ${generation}`,
        groupNote: cousinRangeLabel(generation),
    };
}

/**
 * The notable relatives within 7 degrees: everyone the API walk reached (cc7) who is on the list of all notables,
 * then any WikiTree+ CC7 notables the walk did not reach. The starting profile is left out.
 * @param {Map<number, object>} cc7  @param {Set<number>} allNotables  @param {number[]} plusCc7Ids
 */
export function notablesInCc7(cc7, allNotables, plusCc7Ids = [], rootId = 0) {
    const ids = new Set();
    for (const id of cc7.keys()) if (allNotables.has(id)) ids.add(id);
    for (const id of plusCc7Ids) ids.add(Number(id));
    ids.delete(Number(rootId));
    return [...ids];
}

/** Group keys of the direct line (ancestors and descendants) in the shared-ancestors search. */
export const DIRECT_LINE_GROUPS = ["anc", "desc", "anc-far"];

/**
 * Joins the WikiTree+ ids, the CC7 degrees and the profile details into one record per notable relative.
 * @param {{notableIds:number[], cc7:Map, profiles:Map, rootId:number}} input
 */
export function buildRecords({ notableIds, cc7, profiles, rootId }) {
    const graph = parentGraph(cc7.values());
    const nameRelationship = relationshipNamer(graph, Number(rootId));
    const records = [];
    for (const id of new Set(notableIds.map(Number))) {
        const p = profiles.get(id);
        if (!p) continue; // WikiTree no longer has it, or it is not visible
        const rel = cc7.get(id);
        const degree = rel ? rel.degree : null;
        const record = baseRecord(id, p);
        record.wtId = record.wtId || rel?.name || "";
        record.gender = record.gender || rel?.gender || "";
        const { label, isBlood } = nameRelationship(id, record.gender, degree);
        records.push(Object.assign(record, { degree, relationship: label, isBlood }, cc7Group(degree)));
    }
    return records;
}

/**
 * Records for one onFound() batch of the shared-ancestors search.
 * @param {{kind:string, ids:number[], generation?:number, profiles:Map, ancestors:Map, descendants:Map, generations:number}} input
 */
export function buildAncestralRecords({ kind, ids, generation, profiles, ancestors, descendants, generations }) {
    const records = [];
    for (const id of ids) {
        const p = profiles.get(id);
        if (!p) continue;
        const record = Object.assign(baseRecord(id, p), ancestralGroup(kind, generation, generations), {
            isBlood: true,
            degree: null,
        });
        if (kind === "ancestor") {
            const gen = ancestors.get(id)?.degree ?? null;
            record.order = gen ?? 0;
            record.relationship = gen ? describeRelationship(gen, 0, false, record.gender) : "ancestor";
        } else if (kind === "descendant") {
            const gen = descendants.get(id)?.degree ?? null;
            record.order = gen ?? 99;
            record.relationship = gen ? describeRelationship(0, gen, false, record.gender) : "descendant";
        } else if (kind === "ancestor-far") {
            record.relationship = `ancestor more than ${generations} generations back`;
        } else {
            record.order = generation;
            record.relationship = `shares the starting profile's ${sharedAncestorsLabel(generation)}`;
        }
        records.push(record);
    }
    return records;
}

// ---------- filters and facets ----------

/**
 * @param {object[]} records
 * @param {{groups?:Set<string>, category?:string, country?:string, place?:string, marker?:string, q?:string}} f
 */
export function applyFilters(records, f = {}) {
    const place = (f.place || "").trim().toLowerCase();
    const q = (f.q || "").trim().toLowerCase();
    return records.filter((r) => {
        if (f.groups && f.groups.size && !f.groups.has(r.groupKey)) return false;
        if (f.category && !r.categories.includes(f.category)) return false;
        if (f.country && !r.countries.includes(f.country)) return false;
        if (f.marker && !r.markers.includes(f.marker)) return false;
        if (place && !`${r.birthPlace}\n${r.deathPlace}`.toLowerCase().includes(place)) return false;
        if (q && !`${r.name}\n${r.longName}\n${r.wtId}`.toLowerCase().includes(q)) return false;
        return true;
    });
}

const countBy = (records, keysOf) => {
    const counts = new Map();
    for (const r of records) for (const k of keysOf(r)) counts.set(k, (counts.get(k) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
};

/** Counts for the filter menus: [[value, count], ...]; groups are in group order with their labels. */
export function facets(records) {
    const groupInfo = new Map();
    for (const r of records) {
        const g = groupInfo.get(r.groupKey);
        if (g) g.count++;
        else
            groupInfo.set(r.groupKey, {
                key: r.groupKey,
                group: r.group,
                short: r.groupShort,
                heading: r.groupHeading,
                count: 1,
            });
    }
    return {
        categories: countBy(records, (r) => r.categories),
        countries: countBy(records, (r) => r.countries),
        markers: countBy(records, (r) => r.markers),
        groups: [...groupInfo.values()].sort((a, b) => a.group - b.group),
    };
}

/** [{key, heading, note, records}] in group order; records by generation, then birth year. */
export function groupRecords(records) {
    const groups = new Map();
    for (const r of records) {
        if (!groups.has(r.groupKey)) {
            groups.set(r.groupKey, {
                key: r.groupKey,
                group: r.group,
                heading: r.groupHeading,
                note: r.groupNote,
                records: [],
            });
        }
        groups.get(r.groupKey).records.push(r);
    }
    const byOrder = (a, b) =>
        (a.order ?? 0) - (b.order ?? 0) ||
        (a.birthYear ?? 9999) - (b.birthYear ?? 9999) ||
        a.name.localeCompare(b.name);
    return [...groups.values()]
        .sort((a, b) => a.group - b.group)
        .map((g) => ({ ...g, records: g.records.sort(byOrder) }));
}

// ---------- CSV ----------

const csvCell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(records) {
    const header = [
        "Group",
        "Relationship",
        "Name",
        "WikiTree ID",
        "Birth",
        "Birth place",
        "Death",
        "Death place",
        "Markers",
        "Categories",
        "Profile",
    ];
    const rows = records.map((r) => [
        r.groupHeading,
        r.relationship,
        r.name,
        r.wtId,
        r.birthDate,
        r.birthPlace,
        r.deathDate,
        r.deathPlace,
        r.markers.map((m) => MARKERS[m]).join("; "),
        r.categories.join("; "),
        r.wtId ? `https://www.wikitree.com/wiki/${r.wtId}` : "",
    ]);
    return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
