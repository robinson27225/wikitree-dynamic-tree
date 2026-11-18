/*
 * Data for the Notable Relatives view.
 *
 * Two searches:
 *
 * - "Shared ancestors" (the default), in the spirit of Relative Finder: the starting profile's ancestors up to
 *   N generations (WikiTree API), then ONE WikiTree+ search for the notable descendants of the furthest-back
 *   ancestors on every line: 'descendants="<id>,<id>,..." NotableProfile'. Everyone descended from a child is
 *   descended from that child's parents, and a couple shares its descendants, so only the top ancestors are listed,
 *   one partner per couple. Each list includes the people named in it, so the answer holds every notable ancestor
 *   within the N generations as well as the descendants and cousins. "Ancestors only" asks
 *   'ancestors="<id>" NotableProfile' instead and keeps those within the N generations.
 * - "Within 7 degrees": everyone within 7 degrees from getPeople nuclear=7, matched against WikiTree+'s list of all
 *   notable profiles ("NotableProfile"). WikiTree+'s own "CC7=<id>" stops at private profiles, so on its own it
 *   misses notables reached through a private relative; its "CC7=<id> NotableProfile" answer is still added in.
 *
 * NotableProfile means any notable template, so it includes every "Notability" and "Notables Sticker" profile.
 * WikiTree+ returns profile ids only; a getPeople call gives the notables' details, categories and templates.
 *
 * The network functions take the API caller as an argument, so this module runs under node for tests.
 */

import { parentGraph, relationshipNamer, relationshipFromSteps, describeRelationship } from "./kinship.js";

// Semantic version (major.minor.patch), 0.x while the app is in beta. Raise it with every upload and add an entry to
// CHANGELOG.md; a test checks the two agree. A fix raises the last number, a new feature the middle one.
export const VERSION = "0.3.1";
export const AUTHOR_ID = "Robinson-27225";
export const AUTHOR_URL = `https://www.wikitree.com/wiki/${AUTHOR_ID}`;
export const HELP_URL = "https://www.wikitree.com/wiki/Space:Notable_Relatives";

export const APP_ID = "notableRelatives"; // WikiTreeAPI.postToAPI prepends "TA-"
export const PLUS_APP_ID = "TA-notableRelatives";
export const MAX_DEGREE = 7;
export const DEFAULT_GENERATIONS = 8; // each generation further back makes WikiTree+'s Descendants searches much heavier
export const MAX_GENERATIONS = 15;
const MAX_DESCENDANT_GENERATIONS = 10; // the API's limit
export const PAGE_LIMIT = 1025;
const MAX_PAGES = 40;
const PROFILE_CHUNK = 1000;
// A search longer than this many encoded characters is sent by POST, which WikiTree+ allows "when necessary".
const MAX_GET_QUERY = 6000;
const ALL_RESULTS = 1000000; // MaxProfiles for the relatives search: every notable must come back

const TREE_FIELDS = ["Id", "Name", "Father", "Mother", "BioFather", "BioMother", "Gender", "Meta"];
// What the view shows about the starting profile, asked for in the same call as its family.
export const ROOT_FIELDS = ["Id", "Name", "FirstName", "LastNameAtBirth", "Derived.ShortName"];
const FAMILY_FIELDS = [...new Set([...TREE_FIELDS, ...ROOT_FIELDS])];
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

const PLUS_SEARCH = "https://plus.wikitree.com/function/WTWebProfileSearch/";

export function plusSearchUrl(query, appId = PLUS_APP_ID, page = null, maxProfiles = 0) {
    const paging = page ? `&PageSize=${page.size}&PageIdx=${page.index}` : "";
    const max = maxProfiles || (page ? 1000000 : 100000);
    return `${PLUS_SEARCH}${appId}.json?Query=${encodeURIComponent(query)}&MaxProfiles=${max}${paging}&appID=${appId}`;
}

/*
 * Being a good guest on WikiTree+. It runs on one volunteer-maintained server, and a Descendants search for an ancestor
 * many generations back can take it several seconds. So, for the whole page:
 *   - one WikiTree+ request at a time, with a pause after each;
 *   - a request that has started is never cancelled: WikiTree+ would keep working on it, so a new search waits for
 *     it to finish instead of piling another request on top. A stopped search drops only its requests still waiting;
 *   - no automatic retries (a request that timed out may still be running on the server);
 *   - a refusal (HTTP 429 or 403, or an error answer) stops all WikiTree+ requests from the page for a while.
 */
export const plusSettings = { pauseMs: 1000, coolOffMs: 5 * 60 * 1000 };
let plusChain = Promise.resolve();
let plusRefusal = null; // { at, until } of the last refusal seen by this page
const REFUSED_KEY = "notableRelatives:plusRefusal:v2"; // kept across reloads, so a reload does not ask again

/** The refusal WikiTree+ should still be spared from, from this page or an earlier visit, or null. */
export function plusPause(now = Date.now()) {
    let saved = null;
    try {
        saved = JSON.parse(browserStorage()?.getItem(REFUSED_KEY) || "null");
    } catch {
        // blocked or unreadable storage: this page's own record is enough
    }
    const latest = [plusRefusal, saved].filter((r) => r?.until > now).sort((a, b) => b.until - a.until)[0];
    return latest || null;
}

function markRefused() {
    const at = Date.now();
    plusRefusal = { at, until: at + plusSettings.coolOffMs };
    try {
        browserStorage()?.setItem(REFUSED_KEY, JSON.stringify(plusRefusal));
    } catch {
        // blocked storage
    }
}

/** Ends a pause early, when the reader asks to try WikiTree+ again. */
export function clearPlusPause() {
    plusRefusal = null;
    try {
        browserStorage()?.removeItem(REFUSED_KEY);
        browserStorage()?.removeItem("notableRelatives:plusRefusedUntil"); // from the first test copy
    } catch {
        // blocked storage
    }
}

/**
 * WikiTree+ turned a search away (isPause false), or the app did not ask because it is pausing after an earlier
 * refusal (isPause true: nothing was sent). at and until are when that refusal happened and when the pause ends.
 */
export class PlusUnavailableError extends Error {
    constructor(detail, { isPause = false, at = 0, until = 0 } = {}) {
        super(`WikiTree+ is not available to Notable Relatives (${detail}).`);
        this.name = "PlusUnavailableError";
        Object.assign(this, { isPause, at, until, detail });
    }
}

const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** What to tell the reader, saying whether a search was actually sent. */
const REFUSAL_REASONS = {
    "HTTP 429": 'it answered "too many requests" (HTTP 429), which usually means it is busy',
    "HTTP 403": 'it answered "forbidden" (HTTP 403)',
    "search refused": "it dropped the search without running it",
};

/** What to tell the reader, saying whether a search was actually sent and what WikiTree+ answered. */
export function plusUnavailableMessage(err) {
    if (err?.isPause) {
        return (
            `No search was sent to WikiTree+: it turned away a search from Notable Relatives at ${clock(err.at)}, ` +
            `so the app is giving it a rest until ${clock(err.until)}. Choose "Try WikiTree+ now" to ask anyway.`
        );
    }
    const why = REFUSAL_REASONS[err?.detail] ? ` (${REFUSAL_REASONS[err.detail]})` : "";
    return (
        `WikiTree+ turned away this search${why}, so it stopped before finding any notable relatives. ` +
        `The app will rest until ${clock(err?.until || Date.now())}; choose "Try WikiTree+ now" to ask again sooner.`
    );
}

const abortError = () => Object.assign(new Error("The search was stopped."), { name: "AbortError" });

/** Rejects as soon as signal aborts, without cancelling the work behind promise. */
export function untilAborted(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(abortError());
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
            (value) => {
                signal.removeEventListener("abort", onAbort);
                resolve(value);
            },
            (err) => {
                signal.removeEventListener("abort", onAbort);
                reject(err);
            }
        );
    });
}

/**
 * Queues task behind every other WikiTree+ request from this page. Skipped (AbortError) if signal aborts while it
 * waits; once started it runs to the end.
 */
export function plusQueue(task, { signal } = {}) {
    const run = plusChain.then(async () => {
        if (signal?.aborted) throw abortError();
        const pause = plusPause();
        if (pause) throw new PlusUnavailableError("pausing after a refusal", { isPause: true, ...pause });
        try {
            return await task();
        } finally {
            if (plusSettings.pauseMs) await new Promise((r) => setTimeout(r, plusSettings.pauseMs));
        }
    });
    plusChain = run.catch(() => {});
    return untilAborted(run, signal);
}

/** Forgets the queue and any refusal (for tests). */
export function resetPlusQueue() {
    plusChain = Promise.resolve();
    clearPlusPause();
}

/**
 * One WikiTree+ request through the queue, as JSON. Throws PlusUnavailableError on a refusal. sentQuery is the
 * search that was sent, so an answer that comes back without it can be told apart from a search we left empty.
 */
async function plusJson(url, { fetchFn = fetch, signal, sentQuery = "", init } = {}) {
    return plusQueue(
        async () => {
            const res = await (init ? fetchFn(url, init) : fetchFn(url)); // no signal: see above
            if (res.status === 429 || res.status === 403) {
                markRefused();
                throw new PlusUnavailableError(`HTTP ${res.status}`, plusRefusal);
            }
            if (!res.ok)
                throw new Error(`The WikiTree+ search did not answer (HTTP ${res.status}). Please try again later.`);
            const json = await res.json();
            const error = json?.response?.error;
            // A search sent with text that comes back empty was dropped by WikiTree+: it is refusing this app.
            if (error && sentQuery.trim() && json?.request && !json.request.query) {
                markRefused();
                throw new PlusUnavailableError("search refused", plusRefusal);
            }
            if (error) throw new Error(`WikiTree+ could not run the search: ${error}`);
            return json;
        },
        { signal }
    );
}

/**
 * Profile ids matching a WikiTree+ query. isCut is true when WikiTree+ stopped at MaxProfiles ("more"), so some
 * matches are missing. An empty query is not sent at all. @returns {Promise<{ids:number[], dataDate:string, isCut:boolean}>}
 */
export async function fetchPlusIds(query, { maxProfiles = 0, ...options } = {}) {
    if (!String(query || "").trim()) return { ids: [], dataDate: "", isCut: false };
    let url = plusSearchUrl(query, PLUS_APP_ID, null, maxProfiles);
    let init;
    if (encodeURIComponent(query).length > MAX_GET_QUERY) {
        // Too long for a web address: the same search as a form POST.
        url = `${PLUS_SEARCH}${PLUS_APP_ID}.json`;
        const body = new URLSearchParams({
            Query: query,
            MaxProfiles: String(maxProfiles || 100000),
            appID: PLUS_APP_ID,
        });
        init = { method: "POST", body };
    }
    const json = await plusJson(url, { ...options, init, sentQuery: query });
    return {
        ids: (json?.response?.profiles || []).map(Number).filter(Boolean),
        dataDate: json?.debug?.dataDate || "",
        isCut: json?.response?.more === true,
    };
}

let dataDatePromise = null;

/**
 * The date of the WikiTree database dump WikiTree+ is working from (/DataDates.json, a tiny file updated hourly),
 * asked once per page. Anything saved from an older dump is out of date. "" when it cannot be read.
 */
export function fetchPlusDataDate({ fetchFn = fetch } = {}) {
    if (!dataDatePromise) {
        dataDatePromise = plusJson(`https://plus.wikitree.com/DataDates.json?appID=${PLUS_APP_ID}`, { fetchFn }).then(
            (json) => String(json?.dataDate || ""),
            () => {
                // Unknown (WikiTree+ unreachable or pausing): saved data then goes by its age, and the date is asked
                // for again next time.
                dataDatePromise = null;
                return "";
            }
        );
    }
    return dataDatePromise;
}

/** Forgets the data date (for tests). */
export function resetPlusDataDate() {
    dataDatePromise = null;
}

/**
 * Ids of the notable profiles within 7 degrees of a profile, by its numeric id. WikiTree+ splits an unquoted
 * WikiTree ID at accented letters, hyphens in surnames and apostrophes ("Söderblom-7", "O'Brien-1" find nothing),
 * so every query here uses the numeric id.
 */
export function fetchPlusNotableIds(id, options = {}) {
    return fetchPlusIds(`CC7=${Number(id)} NotableProfile`, options);
}

const ALL_NOTABLES_PAGE = 100000; // WikiTree+ returns at most 100,000 ids per answer
const ALL_NOTABLES_KEY = "notableRelatives:allNotables:v1";
const SAVED_MAX_AGE = 8 * 24 * 60 * 60 * 1000; // WikiTree+ works on a weekly dump; never keep anything longer
let allNotablesPromise = null;

/** The browser's localStorage, or null where it is missing or blocked (private windows, node). */
export function browserStorage() {
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
        return null;
    }
}

/** True when something saved from WikiTree+ is still current: same data date, and not older than a week and a day. */
export function isSavedCurrent(saved, dataDate, now = Date.now()) {
    if (!saved?.savedAt || now - saved.savedAt > SAVED_MAX_AGE) return false;
    return !dataDate || saved.dataDate === dataDate; // when the date cannot be read, the age limit decides
}

function readSavedNotables(dataDate) {
    try {
        const saved = JSON.parse(browserStorage()?.getItem(ALL_NOTABLES_KEY) || "null");
        if (!isSavedCurrent(saved, dataDate) || !Array.isArray(saved.ids)) return null;
        return { ids: new Set(saved.ids), dataDate: saved.dataDate || "" };
    } catch {
        return null;
    }
}

function saveNotables({ ids, dataDate }) {
    try {
        browserStorage()?.setItem(ALL_NOTABLES_KEY, JSON.stringify({ savedAt: Date.now(), dataDate, ids: [...ids] }));
    } catch {
        // full or blocked: the list is simply downloaded again next time
    }
}

/**
 * The ids of every notable profile on WikiTree (about 111,000, under 1 MB), asked once per page load.
 * @returns {Promise<{ids:Set<number>, dataDate:string}>}
 */
export function fetchAllNotableIds({ fetchFn = fetch, signal } = {}) {
    if (!allNotablesPromise) {
        // Shared by every search on the page, so it is not tied to one search's signal: a stopped search must not
        // leave the next one waiting on a cancelled download.
        allNotablesPromise = (async () => {
            const saved = readSavedNotables(await fetchPlusDataDate({ fetchFn }));
            if (saved) return saved;
            const ids = new Set();
            let dataDate = "";
            for (let index = 0; index < 10; index++) {
                const url = plusSearchUrl("NotableProfile", PLUS_APP_ID, { size: ALL_NOTABLES_PAGE, index });
                const json = await plusJson(url, { fetchFn, sentQuery: "NotableProfile" });
                const page = (json?.response?.profiles || []).map(Number).filter(Boolean);
                page.forEach((id) => ids.add(id));
                dataDate = dataDate || json?.debug?.dataDate || "";
                const found = Number(json?.response?.found) || 0;
                if (page.length < ALL_NOTABLES_PAGE || ids.size >= found) break;
            }
            saveNotables({ ids, dataDate });
            return { ids, dataDate };
        })();
        allNotablesPromise.catch(() => (allNotablesPromise = null)); // a failed download is tried again next time
    }
    return untilAborted(allNotablesPromise, signal);
}

/** Forgets the downloaded list of notables (for tests). */
export function resetAllNotableIds() {
    allNotablesPromise = null;
}

/** The notable descendants of one or more profiles, as a single WikiTree+ term: descendants="1,2,3" NotableProfile. */
export function descendantsQuery(ids) {
    return `descendants="${ids.map(Number).join(",")}" NotableProfile`;
}

/**
 * The furthest-back ancestors on every line: those with no parent in the map. Everyone descended from an ancestor is
 * descended from that ancestor's parents, so their descendants cover everyone's.
 */
export function topAncestors(ancestors) {
    return [...ancestors.values()]
        .filter((a) => a.id > 0)
        .filter((a) => ![a.father, a.mother, a.bioFather, a.bioMother].some((p) => p > 0 && ancestors.has(p)))
        .map((a) => a.id);
}

/** Every [father, mother] pair among the given people (listed and birth parents), and any extra pairs given. */
export function couplesOf(people, extra = []) {
    const pairs = [...extra];
    for (const p of people) {
        pairs.push([p.father, p.mother]);
        pairs.push([p.bioFather || p.father, p.bioMother || p.mother]);
    }
    return pairs.filter(([a, b]) => a > 0 && b > 0 && a !== b);
}

/**
 * The ids with one partner of each couple left out: a couple shares its descendants, so asking for both makes
 * WikiTree+ find the same people twice. The father is kept.
 */
export function onePartnerPerCouple(ids, couples) {
    const wanted = new Set(ids);
    const skip = new Set();
    for (const [father, mother] of couples) {
        if (wanted.has(father) && wanted.has(mother) && !skip.has(father)) skip.add(mother);
    }
    return ids.filter((id) => !skip.has(id));
}

// ---------- WikiTree API ----------

/**
 * Everyone up to maxGeneration steps from rootId along `relation` ("nuclear", "ancestors" or "descendants"),
 * asked one generation at a time (relation=g, minGeneration=g): getPeople keeps no fixed order between the pages
 * of one big request, so paging through all generations at once skips people. Within a generation WikiTree returns
 * at most PAGE_LIMIT people per call and says "Maximum number of profiles" when more follow.
 * The starting profile is not included, and nor are private relatives the viewer may not see: WikiTree returns those
 * as placeholders whose negative ids repeat from one answer to the next, with no usable parent links.
 * If WikiTree stops answering part way (rate limit, lost connection, server error), the people found so far are
 * returned with isPartial; only a refusal for the starting profile itself, or a failure before anyone was found,
 * is thrown. With stopWhenFound, the walk ends as soon as all those ids have been found.
 * @returns {Promise<{people: Map<number, object>, isPartial: boolean, error?: Error}>}
 */
export async function fetchByGeneration(
    rootId,
    relation,
    maxGeneration,
    { api, signal, onProgress = () => {}, people = new Map(), stopWhenFound = null } = {}
) {
    let isPartial = false;
    const seeded = people.size; // fetchCc7 passes the starting profile in
    const hasFound = () => people.size > seeded;
    const allFound = () => stopWhenFound && [...stopWhenFound].every((id) => people.has(Number(id)));
    for (let generation = 1; generation <= maxGeneration && !allFound(); generation++) {
        let start = 0;
        let foundHere = 0;
        for (let page = 0; page < MAX_PAGES; page++) {
            let result;
            try {
                result = await askGeneration(api, signal, rootId, relation, generation, start);
            } catch (err) {
                if (err?.name === "AbortError" || !hasFound()) throw err;
                return { people, isPartial: true, error: err };
            }
            const status = String(result?.[0]?.status || "");
            const keyStatus = String(result?.[0]?.resultByKey?.[String(rootId)]?.status || "");
            if (/permission denied/i.test(keyStatus)) throw new PrivateProfileError(keyStatus);
            const got = Object.values(result?.[0]?.people || {}).filter((p) => Number(p?.Id) !== Number(rootId));
            const before = people.size;
            for (const p of got) addTreePerson(people, p, generation);
            foundHere += got.length; // placeholders count: the family goes on past them
            // A page of known, public people only would be a repeat: stop rather than page on forever.
            const isRepeat = people.size === before && got.every((p) => Number(p?.Id) > 0);
            onProgress(people.size, generation);

            const hasMore = status.startsWith("Maximum number of profiles");
            if (status && !hasMore) {
                if (!got.length && !hasFound()) throw new Error(`WikiTree could not list the relatives: ${status}`);
                isPartial = true;
                break;
            }
            if (!hasMore || !got.length || isRepeat) break;
            start += PAGE_LIMIT;
            if (page === MAX_PAGES - 1) isPartial = true;
        }
        if (!foundHere) break; // the family reaches no further
    }
    return { people, isPartial };
}

/** One page of one generation from getPeople. */
function askGeneration(api, signal, rootId, relation, generation, start) {
    return withRetry(
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
}

/**
 * ONE getPeople call for the starting profile and its relatives (relations such as { ancestors: 8, descendants: 10 }
 * or { nuclear: 7 }), when they fit in one answer. Returns null when WikiTree says there are more than that
 * ("Maximum number of profiles"), so the caller can ask a generation at a time instead: paging one big answer
 * loses people, because getPeople keeps no fixed order between its pages.
 * @returns {Promise<{root: object|null, people: object[], isPartial: boolean}|null>}
 */
export async function fetchInOneCall(rootId, relations, { api, signal, fields = FAMILY_FIELDS } = {}) {
    const result = await withRetry(
        () =>
            api(
                {
                    appId: APP_ID,
                    action: "getPeople",
                    keys: String(rootId),
                    ...relations,
                    fields: fields.join(","),
                    limit: PAGE_LIMIT,
                },
                signal
            ),
        { signal }
    );
    const keyStatus = String(result?.[0]?.resultByKey?.[String(rootId)]?.status || "");
    if (/permission denied/i.test(keyStatus)) throw new PrivateProfileError(keyStatus);
    const status = String(result?.[0]?.status || "");
    if (status.startsWith("Maximum number of profiles")) return null;
    const all = Object.values(result?.[0]?.people || {});
    if (status && !all.length) throw new Error(`WikiTree could not list the relatives: ${status}`);
    return {
        root: all.find((p) => Number(p?.Id) === Number(rootId)) || null,
        people: all.filter((p) => Number(p?.Id) !== Number(rootId)),
        isPartial: Boolean(status),
    };
}

/**
 * The ids among people descended from rootId, following the parent links down (listed and birth parents).
 * Everyone else that getPeople returned with ancestors and descendants together is an ancestor.
 */
export function descendantIdsOf(rootId, people) {
    const found = new Set([Number(rootId)]);
    for (let grew = true; grew;) {
        grew = false;
        for (const p of people) {
            const id = Number(p?.Id);
            if (!(id > 0) || found.has(id)) continue;
            if ([p.Father, p.Mother, p.BioFather, p.BioMother].some((x) => found.has(Number(x)))) {
                found.add(id);
                grew = true;
            }
        }
    }
    found.delete(Number(rootId));
    return found;
}

/**
 * The starting profile, its ancestors up to `generations`, and its descendants, in one WikiTree API call when they
 * fit. When they do not, the profile and its ancestors are asked for a generation at a time, and descendants is
 * null (the search then asks for them only if it needs them).
 * @returns {Promise<{root: object|null, ancestors: Map, descendants: Map|null, isPartial: boolean, error?: Error}>}
 */
export async function fetchFamily(
    rootId,
    generations,
    { api, signal, onProgress = () => {}, withDescendants = true } = {}
) {
    const relations = withDescendants
        ? { ancestors: generations, descendants: MAX_DESCENDANT_GENERATIONS }
        : { ancestors: generations };
    const one = await fetchInOneCall(rootId, relations, { api, signal });
    if (one) {
        const downward = descendantIdsOf(rootId, one.people);
        const ancestors = new Map();
        const descendants = new Map();
        for (const p of one.people) {
            addTreePerson(downward.has(Number(p.Id)) ? descendants : ancestors, p, null);
        }
        onProgress(ancestors.size, generations);
        return { root: one.root, ancestors, descendants, isPartial: one.isPartial };
    }
    // Too big for one answer.
    const rootResult = await withRetry(
        () =>
            api({ appId: APP_ID, action: "getPeople", keys: String(rootId), fields: FAMILY_FIELDS.join(",") }, signal),
        { signal }
    );
    const root = Object.values(rootResult?.[0]?.people || {}).find((p) => Number(p?.Id) === Number(rootId)) || null;
    const walk = await fetchByGeneration(rootId, "ancestors", generations, { api, signal, onProgress });
    return { root, ancestors: walk.people, descendants: null, isPartial: walk.isPartial, error: walk.error };
}

/** Everyone within `degrees` of rootId (CC7), with their degree and parents, the starting profile included. */
export async function fetchCc7(rootId, { api, signal, onProgress = () => {}, degrees = MAX_DEGREE } = {}) {
    const people = new Map();
    // One call when everyone within the degrees fits in one answer.
    const one = await fetchInOneCall(rootId, { nuclear: degrees }, { api, signal, fields: TREE_FIELDS });
    if (one) {
        if (one.root) addTreePerson(people, one.root, 0, true);
        for (const p of one.people) addTreePerson(people, p, null);
        onProgress(people.size, degrees);
        return { people, isPartial: one.isPartial };
    }
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
    if (!(id > 0)) return; // a private placeholder
    const metaDegree = p.Meta && Number.isFinite(Number(p.Meta.Degrees)) ? Number(p.Meta.Degrees) : null;
    const degree = isExact ? askedDegree : (metaDegree ?? askedDegree);
    const prev = people.get(id);
    if (prev && prev.degree !== null && (degree === null || prev.degree <= degree)) return;
    people.set(id, {
        id,
        name: p.Name || "",
        father: Number(p.Father) || 0,
        mother: Number(p.Mother) || 0,
        bioFather: Number(p.BioFather) || 0,
        bioMother: Number(p.BioMother) || 0,
        gender: p.Gender || "",
        degree,
    });
}

/**
 * WikiTree will not show the starting profile, or list its relatives, to this viewer: the profile is private and the
 * viewer is not logged in to the Tree Apps, or not on its Trusted List.
 */
export class PrivateProfileError extends Error {
    constructor(message = "The starting profile is private.") {
        super(message);
        this.name = "PrivateProfileError";
    }
}

/**
 * Whether WikiTree still recognizes the reader's Tree Apps login: "ok", "expired", or "unknown" (no answer). The page
 * can keep saying "Logged into Apps" after WikiTree's own login has run out (wikitree-api, authentication.md).
 */
export async function checkAppsLogin(userId, { api, signal } = {}) {
    if (!userId) return "unknown";
    try {
        const data = await api({ appId: APP_ID, action: "clientLogin", checkLogin: userId }, signal);
        const result = data?.clientLogin?.result;
        return result === "ok" ? "ok" : result === "error" ? "expired" : "unknown";
    } catch (err) {
        if (err?.name === "AbortError") throw err;
        return "unknown";
    }
}

const sameWtId = (a, b) =>
    String(a || "")
        .replace(/ /g, "_")
        .toLowerCase() ===
    String(b || "")
        .replace(/ /g, "_")
        .toLowerCase();

/**
 * What to tell the reader when the starting profile comes back private, in the words the other Tree Apps use where
 * they fit. user: { isLoggedIn, name, login: "ok" | "expired" | "unknown" } (login from checkAppsLogin).
 */
export function privateProfileMessage(wtId, user = {}) {
    const start = `The starting profile data could not be retrieved${wtId ? ` for ${wtId}` : ""}: it is private.`;
    const relogin = 'Click "Logout" next to your name at the top of the page, then "Apps Login", and try again.';
    if (!user.isLoggedIn) {
        return (
            `${start} Try the Apps Login at the top of the page. The Tree Apps have their own login, so a private ` +
            "profile, even your own, needs it."
        );
    }
    const as = user.name ? ` as ${user.name}` : "";
    if (user.login === "expired") {
        return (
            `${start} The page says you are logged in to the Tree Apps${as}, but WikiTree no longer recognizes that ` +
            'login (it has run out), so it treated the request as logged out. Click "Apps Login" at the top of the ' +
            "page to log in again, then try again."
        );
    }
    if (sameWtId(wtId, user.name)) {
        // Never send a reader to their own Trusted List.
        return (
            `${start} You are logged in to the Tree Apps${as}, and this is your own profile, so WikiTree should have ` +
            `returned it. ${relogin} If it still happens, please let me know on the Notable Relatives page.`
        );
    }
    return (
        `${start} You are logged in to the Tree Apps${as}. You may need to be added to the starting profile's ` +
        `Trusted List. If you manage this profile or are on its Trusted List, ${relogin[0].toLowerCase()}${relogin.slice(1)}`
    );
}

/** True when the browser lost the connection ("Failed to fetch" in Chrome, "NetworkError" in Firefox, "Load failed" in Safari). */
export function isNetworkError(err) {
    if (err?.name === "AbortError") return false;
    return /failed to fetch|networkerror|network error|load failed|network connection/i.test(
        String(err?.message ?? err ?? "")
    );
}

/** True for a server error from WikiTree's API (postToAPI throws "HTTP error! Status: 502: ..."). */
export function isServerError(err) {
    return /status: 5\d\d/i.test(String(err?.message ?? err ?? ""));
}

export const NETWORK_MESSAGE =
    "The connection to WikiTree dropped (Failed to fetch). Check your internet connection and try again.";

const RETRY_DELAYS = [1500, 4000]; // milliseconds before the second and third tries

// The WikiTree API allows each user 200 requests a minute (Help:App Policies); one every 300 ms stays under that.
export const API_SPACING_MS = 300;

/**
 * Wraps a WikiTree API caller so its requests are at least spacingMs apart, for every search on the page.
 * A request still waiting for its turn is dropped when its search is stopped.
 */
export function pacedApi(api, spacingMs = API_SPACING_MS) {
    let nextAt = 0;
    return async (data, signal) => {
        const now = Date.now();
        const wait = Math.max(0, nextAt - now);
        nextAt = Math.max(now, nextAt) + spacingMs;
        if (wait) await untilAborted(new Promise((r) => setTimeout(r, wait)), signal);
        if (signal?.aborted) throw abortError();
        return api(data, signal);
    };
}

/**
 * Runs a WikiTree API call, trying again after a pause when the connection drops or the server has a passing error.
 * Other errors are not retried. Not used for WikiTree+, which is never retried (see plusQueue).
 */
export async function withRetry(fn, { signal, delays = RETRY_DELAYS } = {}) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn();
        } catch (err) {
            const isPassing = isNetworkError(err) || isServerError(err);
            if (!isPassing || attempt >= delays.length || signal?.aborted) throw err;
            await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
            if (signal?.aborted) throw abortError();
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
export async function fetchConnection(rootWtId, wtId, { api, signal, relation } = {}) {
    const request = { appId: APP_ID, action: "getConnections", keys: `${rootWtId},${wtId}` };
    if (relation !== undefined) request.relation = relation;
    const result = await withRetry(() => api(request, signal), { signal });
    const res = Array.isArray(result) ? result[0] : result;
    const path = Array.isArray(res?.path) ? res.path : [];
    if (path.length < 2) return null;
    return { degree: path.length - 1, steps: path.slice(1).map((s) => String(s?.pathType || "")) };
}

// getConnections relation 2: the shortest path through a common ancestor, the blood line a cousin is named from.
const THROUGH_COMMON_ANCESTOR = 2;

/**
 * A cousin's exact relationship to the starting profile ("2nd cousin twice removed"), from WikiTree's shortest
 * path through a common ancestor, as the Relationship Finder counts it. null when WikiTree shows no such path
 * (for example a private profile in between).
 */
export async function fetchCousinRelationship(rootWtId, wtId, gender, { api, signal } = {}) {
    const conn = await fetchConnection(rootWtId, wtId, { api, signal, relation: THROUGH_COMMON_ANCESTOR });
    if (!conn) return null;
    const { label, isBlood } = relationshipFromSteps(conn.steps, gender);
    return isBlood ? label : null;
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

// ---------- what to find ----------

/**
 * What the shared-ancestors search looks for: "all" (ancestors, descendants and cousins), "ancestors" only, or
 * "relatives" (descendants and cousins) only. A narrower choice also asks WikiTree+ a smaller question.
 */
export const FIND_CHOICES = ["all", "ancestors", "relatives"];
export const DEFAULT_FIND = "all";
export const FIND_LABELS = {
    all: "ancestors, descendants, and cousins",
    ancestors: "ancestors only",
    relatives: "descendants and cousins only",
};

// ---------- birth and adoptive parents ----------

/** Which parents of the starting profile to follow: "both" (the default), "bio" or "main" (the parents it lists). */
export const PARENT_CHOICES = ["both", "bio", "main"];
export const DEFAULT_PARENTS = "both";
export const PARENT_LABELS = { both: "Both", bio: "Biological", main: "Adoptive" };

const signedId = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

/**
 * The parents a profile can be followed through, as in the Genealogy Report. "main" are the parents the profile lists
 * (the adoptive or legal parents when the birth parents differ, marked "non-biological"); "bio" are the birth parents
 * (BioFather / BioMother), falling back to the listed parent when only one side differs. A birth parent the viewer
 * may not see comes back with a negative id: that side cannot be followed, and is named in hiddenBio.
 * @returns {{main:number[], bio:number[], hasAlternate:boolean, hiddenBio:string[]}}
 */
export function parentOptions(p) {
    const main = [Math.max(0, signedId(p?.Father)), Math.max(0, signedId(p?.Mother))];
    const hiddenBio = [];
    const bio = [
        ["BioFather", 0, "father"],
        ["BioMother", 1, "mother"],
    ].map(([field, i, side]) => {
        const id = signedId(p?.[field]);
        if (id > 0) return id;
        if (id < 0) {
            hiddenBio.push(side);
            return 0;
        }
        return main[i];
    });
    const hasAlternate = bio[0] !== main[0] || bio[1] !== main[1];
    return { main, bio, hasAlternate, hiddenBio };
}

/** The parent ids to search from for a choice, or null to follow every parent (no birth parents recorded). */
export function chosenParents(options, choice) {
    if (!options?.hasAlternate) return null;
    const ids = choice === "main" ? options.main : choice === "bio" ? options.bio : [...options.main, ...options.bio];
    return [...new Set(ids.filter((id) => id > 0))];
}

/**
 * The ancestors reachable from startIds (the starting profile's chosen parents, generation 1), through listed and
 * birth parents alike; the API's ancestors list holds both kinds at every generation. Each keeps the generation
 * counted on the chosen side, which can be further back than the API's degree through the other parents.
 */
export function ancestorsFrom(ancestors, startIds) {
    const kept = new Map();
    const queue = startIds.map((id) => [id, 1]);
    while (queue.length) {
        const [id, generation] = queue.shift(); // breadth first, so the first visit is the nearest
        if (kept.has(id) || !ancestors.has(id)) continue;
        const a = ancestors.get(id);
        kept.set(id, { ...a, degree: generation });
        for (const parent of [a.father, a.mother, a.bioFather, a.bioMother]) {
            if (parent > 0 && !kept.has(parent)) queue.push([parent, generation + 1]);
        }
    }
    return kept;
}

/**
 * The one WikiTree+ search for the shared-ancestors view:
 *   descendants="<top ancestors>" NotableProfile
 * which, since each list includes the people named in it, also finds the notable ancestors below the top ones, so
 * ancestors stay within the chosen generations. For "ancestors only", the lighter
 *   ancestors="<starting profile, or the chosen parents>" NotableProfile
 * whose answer is then cut to the chosen generations. With no ids the query is empty and is not sent.
 */
export function relativesQuery(rootId, parentIds, descendantIds, find = DEFAULT_FIND) {
    if (find === "ancestors") {
        const ancestorIds = parentIds || [Number(rootId)];
        return ancestorIds.length ? `ancestors="${ancestorIds.map(Number).join(",")}" NotableProfile` : "";
    }
    return descendantIds.length ? descendantsQuery(descendantIds) : "";
}

// ---------- the shared-ancestors search ----------

/**
 * Finds the notable ancestors, descendants and cousins of the starting profile, nearest generation first.
 * onFound is awaited for each batch, so the caller can read the profiles and show them as they come.
 *
 * @param {object} o
 * @param {number} o.rootId
 * @param {number} o.generations how many generations of ancestors to search through
 * @param {number[]|null} [o.parentIds] the starting profile's parents to search through (from chosenParents), or
 *        null for all of them
 * @param {number[][]} [o.rootCouples] the starting profile's [father, mother] pairs (listed and birth), so only
 *        one of its parents is asked about
 * @param {(found: {kind:"ancestor"|"descendant"|"cousin", ids:number[], generation?:number,
 *        ancestors:Map, descendants:Map, generations:number}) => any} o.onFound   pass it to buildAncestralRecords
 * @param {(status: {stage:string, generation?:number, count?:number, query?:number, queries?:number}) => void} o.onStatus
 */
export async function searchAncestral({
    rootId,
    generations,
    parentIds = null,
    rootCouples = [],
    find = DEFAULT_FIND,
    family = null,
    api,
    fetchFn = fetch,
    signal,
    onStatus = () => {},
    onFound = () => {},
}) {
    const gens = Math.max(1, Math.min(MAX_GENERATIONS, Number(generations) || DEFAULT_GENERATIONS));
    const fam =
        family ||
        (await fetchFamily(rootId, gens, {
            api,
            signal,
            withDescendants: find !== "ancestors",
            onProgress: (count, generation) => onStatus({ stage: "ancestors", count, generation }),
        }));
    const { ancestors: allAncestors, isPartial, error: walkError } = fam;
    const ancestors = parentIds ? ancestorsFrom(allAncestors, parentIds) : allAncestors;
    const seen = new Set([Number(rootId), ...ancestors.keys()]);
    let descendants = fam.descendants || new Map();
    const report = (found) => onFound({ ...found, ancestors, descendants, generations: gens });
    let dataDate = "";
    let failedQueries = 0;
    let isCut = false;
    const plus = async (query, options = {}) => {
        const res = await fetchPlusIds(query, { fetchFn, signal, ...options });
        dataDate = dataDate || res.dataDate;
        isCut = isCut || res.isCut;
        return res.ids;
    };

    // ONE WikiTree+ search: the notable ancestors of the starting profile (every
    // generation back) OR the notable descendants of the furthest-back ancestors on every line, which covers the
    // nearer ancestors' descendants and the starting profile's own. Without ancestors, its own descendants.
    const tops = onePartnerPerCouple(topAncestors(ancestors), couplesOf(ancestors.values(), rootCouples));
    const descendantIds = tops.length ? tops : [Number(rootId)];
    onStatus({ stage: "relatives", count: descendantIds.length, find });
    let ids = [];
    try {
        ids = await plus(relativesQuery(rootId, parentIds, descendantIds, find), { maxProfiles: ALL_RESULTS });
    } catch (err) {
        // Not retried: a search that failed may still be running on WikiTree+.
        if (err?.name === "AbortError" || err?.name === "PlusUnavailableError") throw err;
        failedQueries++;
    }

    // Sorting the one answer: the notable ancestors are those in the walk, so within the chosen generations.
    // ("Descendants and cousins only" leaves them out.)
    const near = ids.filter((id) => ancestors.has(id));
    if (near.length && find !== "relatives") await report({ kind: "ancestor", ids: near });
    // For "ancestors only", anything else in the answer is further back than the chosen generations: left out.
    const others = find === "ancestors" ? [] : ids.filter((id) => !seen.has(id) && !allAncestors.has(id));
    if (others.length) {
        // The starting profile's own descendants, and how many generations down: already in the one family call, or,
        // for a family too big for it, walked through the API until all are placed or the family ends.
        if (!fam.descendants) {
            onStatus({ stage: "descendants" });
            descendants = (
                await fetchByGeneration(rootId, "descendants", MAX_DESCENDANT_GENERATIONS, {
                    api,
                    signal,
                    stopWhenFound: new Set(others),
                })
            ).people;
        }
        const own = others.filter((id) => descendants.has(id));
        const cousins = others.filter((id) => !descendants.has(id));
        if (own.length) await report({ kind: "descendant", ids: own });
        if (cousins.length) await report({ kind: "cousin", ids: cousins });
    }
    return {
        ancestors,
        descendants,
        generations: gens,
        dataDate,
        failedQueries,
        isPartial: isPartial || isCut,
        walkError,
    };
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
    return {
        group: 1,
        groupKey: "cousins",
        groupHeading: "Notable cousins",
        groupShort: "Cousins",
        groupNote: `share ancestors with the starting profile up to ${generations} generations back`,
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
export const DIRECT_LINE_GROUPS = ["anc", "desc"];

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
        } else {
            record.relationship = "cousin through shared ancestors";
        }
        records.push(record);
    }
    return records;
}

// ---------- links to WikiTree ----------

/**
 * The WikiTree page that explains how someone is related to the starting profile. The Relationship Finder follows
 * blood lines only, so it comes up empty for someone related by marriage; for them the Connection Finder, which
 * follows marriages too, is linked instead (suggested by J Palotay, Palotay-1).
 * @returns {{url: string, label: string, title: string}}
 */
export function finderLink(rootWtId, wtId, isBlood, names = {}) {
    const pair = `person1Name=${encodeURIComponent(rootWtId)}&person2Name=${encodeURIComponent(wtId)}`;
    const between = names.root && names.other ? ` for ${names.root} and ${names.other}` : "";
    return isBlood
        ? {
              url: `https://www.wikitree.com/index.php?title=Special:Relationship&action=calculate&${pair}`,
              label: "Relationship",
              title: `WikiTree's Relationship Finder${between}`,
          }
        : {
              url: `https://www.wikitree.com/index.php?title=Special:Connection&action=connect&${pair}`,
              label: "Connection",
              title: `WikiTree's Connection Finder${between}, which follows marriages too`,
          };
}

// ---------- saving results ----------

// What a saved result keeps of each record: only what the search worked out (WikiTree+ ids, groups, relationships),
// never the profile details from the WikiTree API, which are read again when the result is shown.
const SAVED_FIELDS = [
    "id",
    "group",
    "groupKey",
    "groupHeading",
    "groupShort",
    "groupNote",
    "order",
    "relationship",
    "degree",
    "isBlood",
    "isConnectionTried",
    "isRelationshipTried",
    "isFromConnection",
];

/** A record reduced to SAVED_FIELDS. */
export function savedRecord(record) {
    return Object.fromEntries(SAVED_FIELDS.filter((f) => f in record).map((f) => [f, record[f]]));
}

/**
 * Saved records with fresh profile details. A profile WikiTree no longer returns (deleted, or now private to this
 * viewer) is left out.
 */
export function refreshRecords(saved, profiles) {
    const records = [];
    for (const s of saved) {
        const p = profiles.get(Number(s.id));
        if (p) records.push(Object.assign(baseRecord(Number(s.id), p), s));
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
