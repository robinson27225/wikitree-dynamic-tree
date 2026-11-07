/*
 * Data for the Notable Relatives view.
 *
 * - WikiTree+ finds the notable profiles in the starting profile's CC7 (Query "CC7=<id> NotableProfile";
 *   NotableProfile means any notable template, so it already includes every "Notability" and
 *   "Notables Sticker" profile). WikiTree+ returns profile ids only.
 * - The WikiTree API (getPeople, nuclear=7) gives each CC7 relative's degree (Meta.Degrees) and parents,
 *   and a second getPeople call gives the notables' details, categories and templates.
 *
 * The network functions take the API caller as an argument, so this module runs under node for tests.
 */

import { parentGraph, relationshipNamer, relationshipFromSteps } from "./kinship.js";

export const APP_ID = "notableRelatives"; // WikiTreeAPI.postToAPI prepends "TA-"
export const PLUS_APP_ID = "TA-notableRelatives";
export const MAX_DEGREE = 7;
export const PAGE_LIMIT = 1025;
const MAX_PAGES = 40;
const PROFILE_CHUNK = 1000;

const CC7_FIELDS = ["Id", "Name", "Father", "Mother", "Gender", "Meta"];
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

export function plusSearchUrl(query, appId = PLUS_APP_ID) {
    return (
        "https://plus.wikitree.com/function/WTWebProfileSearch/" +
        `${appId}.json?Query=${encodeURIComponent(query)}&MaxProfiles=100000&Format=JSON&appID=${appId}`
    );
}

/** Ids of the notable profiles within 7 degrees of wtId (a WikiTree ID such as "Windsor-1"). */
export async function fetchPlusNotableIds(wtId, { fetchFn = fetch, signal } = {}) {
    const res = await fetchFn(plusSearchUrl(`CC7=${wtId} NotableProfile`), { signal });
    if (!res.ok) throw new Error(`The WikiTree+ search did not answer (HTTP ${res.status}). Please try again later.`);
    const json = await res.json();
    return {
        ids: (json?.response?.profiles || []).map(Number).filter(Boolean),
        dataDate: json?.debug?.dataDate || "",
    };
}

/**
 * Everyone within `degrees` of rootId, with their degree and parents.
 * Asked for one degree at a time (nuclear=d, minGeneration=d): getPeople keeps no fixed order between the pages
 * of one big request, so paging through all 7 degrees at once skips people. Within a degree WikiTree returns at
 * most PAGE_LIMIT relatives per call and says "Maximum number of profiles" when more follow.
 * @returns {Promise<{people: Map<number, object>, isPartial: boolean}>}
 */
export async function fetchCc7(rootId, { api, signal, onProgress = () => {}, degrees = MAX_DEGREE } = {}) {
    const people = new Map();
    let isPartial = false;
    // minGeneration leaves the starting profile out, and its parents are needed to name relationships.
    const rootResult = await api(
        { appId: APP_ID, action: "getPeople", keys: String(rootId), fields: CC7_FIELDS.join(",") },
        signal
    );
    for (const p of Object.values(rootResult?.[0]?.people || {})) {
        if (Number(p?.Id) === Number(rootId)) addCc7Person(people, { ...p, Meta: { Degrees: 0 } }, 0);
    }
    for (let degree = 1; degree <= degrees; degree++) {
        let start = 0;
        let foundAtDegree = 0;
        for (let page = 0; page < MAX_PAGES; page++) {
            const result = await api(
                {
                    appId: APP_ID,
                    action: "getPeople",
                    keys: String(rootId),
                    nuclear: degree,
                    minGeneration: degree,
                    fields: CC7_FIELDS.join(","),
                    start,
                    limit: PAGE_LIMIT,
                },
                signal
            );
            const status = String(result?.[0]?.status || "");
            const got = Object.values(result?.[0]?.people || {});
            const before = people.size;
            for (const p of got) addCc7Person(people, p, Number(p?.Id) === Number(rootId) ? 0 : degree);
            foundAtDegree += people.size - before;
            onProgress(people.size, degree);

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
        if (!foundAtDegree && degree > 1) break; // the family reaches no further
    }
    return { people, isPartial };
}

function addCc7Person(people, p, askedDegree) {
    const id = Number(p?.Id);
    if (!id) return;
    const metaDegree = p.Meta && Number.isFinite(Number(p.Meta.Degrees)) ? Number(p.Meta.Degrees) : null;
    const degree = metaDegree ?? askedDegree;
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

/** Full details for the given ids, in chunks the API accepts. @returns {Promise<Map<number, object>>} */
export async function fetchProfiles(ids, { api, signal } = {}) {
    const profiles = new Map();
    for (let i = 0; i < ids.length; i += PROFILE_CHUNK) {
        const keys = ids.slice(i, i + PROFILE_CHUNK);
        const result = await api(
            { appId: APP_ID, action: "getPeople", keys: keys.join(","), fields: PROFILE_FIELDS.join(",") },
            signal
        );
        for (const p of Object.values(result?.[0]?.people || {})) {
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
    const result = await api({ appId: APP_ID, action: "getConnections", keys: `${rootWtId},${wtId}` }, signal);
    const res = Array.isArray(result) ? result[0] : result;
    const path = Array.isArray(res?.path) ? res.path : [];
    if (path.length < 2) return null;
    return { degree: path.length - 1, steps: path.slice(1).map((s) => String(s?.pathType || "")) };
}

/** Fills in a record's degree and relationship from fetchConnection(). Leaves it unchanged when conn is null. */
export function applyConnection(record, conn) {
    if (!conn || conn.degree > MAX_DEGREE + 1) return record;
    const { label, isBlood } = relationshipFromSteps(conn.steps, record.gender);
    record.degree = conn.degree;
    record.relationship = label;
    record.isBlood = isBlood;
    record.isFromConnection = true;
    return record;
}

// ---------- shaping ----------

const COUNTRY_ALIASES = new Map(
    [
        ["usa", "United States"],
        ["u.s.a.", "United States"],
        ["us", "United States"],
        ["u.s.", "United States"],
        ["united states", "United States"],
        ["united states of america", "United States"],
        ["uk", "United Kingdom"],
        ["great britain", "United Kingdom"],
    ].map(([k, v]) => [k, v])
);

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
        const gender = p.Gender || rel?.gender || "";
        const { label, isBlood } = nameRelationship(id, gender, degree);
        const birthPlace = p.BirthLocation || "";
        const deathPlace = p.DeathLocation || "";
        const countries = [...new Set([countryOf(birthPlace), countryOf(deathPlace)].filter(Boolean))];
        records.push({
            id,
            wtId: p.Name || rel?.name || "",
            name: displayName(p),
            longName: p?.Derived?.LongName || "",
            gender,
            birthDate: formatDate(p.BirthDate),
            deathDate: formatDate(p.DeathDate),
            birthYear: yearOf(p.BirthDate),
            deathYear: yearOf(p.DeathDate),
            birthPlace,
            deathPlace,
            countries,
            photoUrl: photoUrl(p),
            categories: (p.Categories || []).map(categoryLabel).sort(compareCategories),
            markers: markersOf(p.Templates),
            degree,
            relationship: label,
            isBlood,
        });
    }
    return records;
}

const isNotablesCategory = (c) => /notables?\b/i.test(c);
function compareCategories(a, b) {
    return isNotablesCategory(b) - isNotablesCategory(a) || a.localeCompare(b);
}

// ---------- filters and facets ----------

/**
 * @param {object[]} records
 * @param {{degrees?:Set<number|string>, category?:string, country?:string, place?:string, marker?:string, q?:string}} f
 *        degrees holds numbers, plus "unknown" for relatives whose degree WikiTree did not give.
 */
export function applyFilters(records, f = {}) {
    const place = (f.place || "").trim().toLowerCase();
    const q = (f.q || "").trim().toLowerCase();
    return records.filter((r) => {
        if (f.degrees && f.degrees.size && !f.degrees.has(r.degree === null ? "unknown" : r.degree)) return false;
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

/** Counts for the filter menus: [[value, count], ...] sorted by count. */
export function facets(records) {
    return {
        categories: countBy(records, (r) => r.categories),
        countries: countBy(records, (r) => r.countries),
        markers: countBy(records, (r) => r.markers),
        degrees: countBy(records, (r) => [r.degree === null ? "unknown" : r.degree]),
    };
}

/** [[degree, records sorted by birth year], ...] closest first, unknown degree last. */
export function groupByDegree(records) {
    const groups = new Map();
    for (const r of records) {
        const key = r.degree === null ? "unknown" : r.degree;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    const order = (k) => (k === "unknown" ? Infinity : k);
    return [...groups.entries()]
        .sort((a, b) => order(a[0]) - order(b[0]))
        .map(([k, list]) => [
            k,
            list.sort((a, b) => (a.birthYear ?? 9999) - (b.birthYear ?? 9999) || a.name.localeCompare(b.name)),
        ]);
}

// ---------- CSV ----------

const csvCell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(records) {
    const header = [
        "Degree",
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
        r.degree ?? "",
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
