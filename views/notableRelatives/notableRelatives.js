/*
 * Notable Relatives
 *
 * Lists the notable people (profiles with a notable template, found with WikiTree+) within 7 degrees of the
 * starting profile, grouped by degree, with filters for category, location, marker and name.
 *
 * Idea by Blake Ashton (Ashton-4458), in his answer of 7 November 2026 to the G2G question
 * "WikiTree Days Saturday Question: If you could invent one new WikiTree tool, what would it do?"
 * https://www.wikitree.com/g2g/2105562/wikitree-days-saturday-question-could-invent-wikitree-would?show=2105577#a2105577
 */

import * as nr from "./notable_data.js";

const IDEA_URL =
    "https://www.wikitree.com/g2g/2105562/wikitree-days-saturday-question-could-invent-wikitree-would?show=2105577#a2105577";
const IDEA_PROFILE = "https://www.wikitree.com/wiki/Ashton-4458";
const WIKI = "https://www.wikitree.com/wiki/";
const FILTER_PARAMS = ["degree", "cat", "loc", "place", "marker", "q"];

const esc = (s) =>
    String(s ?? "").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
const fmt = (n) => Number(n).toLocaleString();
const plural = (n, word, words = `${word}s`) => `${fmt(n)} ${n === 1 ? word : words}`;

window.NotableRelativesView = class NotableRelativesView extends View {
    static cache = new Map(); // starting profile Id -> { root, records, dataDate, isPartial, cc7Count }

    meta() {
        return {
            title: "Notable Relatives",
            description:
                "Notable people within 7 degrees (CC7) of this profile, grouped by degree, with category and " +
                "location filters. Idea by Blake Ashton (Ashton-4458) on G2G.",
            docs: IDEA_URL,
            params: FILTER_PARAMS,
        };
    }

    init(containerSelector, personId, params = {}) {
        this.container = document.querySelector(containerSelector);
        this.personId = Number(personId);
        this.filters = this.filtersFromParams(params);
        this.controller?.abort();
        this.controller = new AbortController();

        this.container.innerHTML = `
            <div class="nr-view">
                <div class="nr-header">
                    <h2 class="nr-title">Notable Relatives</h2>
                    <p class="nr-summary" aria-live="polite">Looking for notable relatives…</p>
                </div>
                <div class="nr-progress" aria-live="polite"></div>
                <div class="nr-filters hidden"></div>
                <div class="nr-results"></div>
                <footer class="nr-footer">
                    Notable profiles are those WikiTree+ lists with a notable template
                    (<a href="https://www.wikitree.com/wiki/Template:Notability" target="_blank">Notability</a>,
                    <a href="https://www.wikitree.com/wiki/Project:Notables" target="_blank">Notables Sticker</a>
                    and others). Degrees count steps through parents, children, siblings and spouses. Use
                    <em>Apps Login</em> to follow links through private profiles.<br />
                    Idea by <a href="${IDEA_PROFILE}" target="_blank">Blake Ashton (Ashton-4458)</a>
                    on <a href="${IDEA_URL}" target="_blank">G2G</a>.
                </footer>
            </div>`;

        const cached = NotableRelativesView.cache.get(this.personId);
        if (cached) {
            this.data = cached;
            this.showResults();
            const signal = this.controller.signal;
            this.findMissingDegrees((data, sig) => WikiTreeAPI.postToAPI(data, sig), signal).catch((err) =>
                console.warn("Notable Relatives:", err)
            );
            return;
        }
        this.load().catch((err) => {
            if (err?.name === "AbortError") return;
            console.error("Notable Relatives:", err);
            this.setProgress("");
            this.setSummary("");
            wtViewRegistry.showError(err?.message || String(err));
        });
    }

    close() {
        this.controller?.abort();
        this.controller = null;
    }

    async load() {
        const signal = this.controller.signal;
        const api = (data, sig) => WikiTreeAPI.postToAPI(data, sig);

        const rootResult = await api(
            {
                appId: nr.APP_ID,
                action: "getPeople",
                keys: String(this.personId),
                fields: "Id,Name,FirstName,LastNameAtBirth,Derived.ShortName",
            },
            signal
        );
        const root = Object.values(rootResult?.[0]?.people || {}).find((p) => Number(p.Id) === this.personId);
        if (!root?.Name) throw new Error("WikiTree did not return the starting profile.");
        const rootName = root?.Derived?.ShortName || [root.FirstName, root.LastNameAtBirth].join(" ") || root.Name;
        this.setSummary(`Looking for notable relatives of ${esc(rootName)}…`);

        let plusLine = "Asking WikiTree+ for notable profiles…";
        let cc7Line = "Loading relatives within 7 degrees…";
        const show = () => this.setProgress(`${plusLine}<br />${cc7Line}`);
        show();

        const plusPromise = nr.fetchPlusNotableIds(root.Name, { signal }).then((plus) => {
            plusLine = `WikiTree+ found ${plural(plus.ids.length, "notable profile")}.`;
            show();
            return plus;
        });
        const cc7Promise = nr
            .fetchCc7(this.personId, {
                api,
                signal,
                onProgress: (n, degree) => {
                    cc7Line = `Loading relatives, degree ${degree} of 7… ${fmt(n)} so far`;
                    show();
                },
            })
            .then((cc7) => {
                cc7Line = `Loaded ${plural(cc7.people.size, "relative")} within 7 degrees.`;
                show();
                return cc7;
            });
        const [plus, cc7] = await Promise.all([plusPromise, cc7Promise]);

        let profiles = new Map();
        if (plus.ids.length) {
            this.setProgress(`${plusLine}<br />${cc7Line}<br />Reading the notable profiles…`);
            profiles = await nr.fetchProfiles(plus.ids, { api, signal });
        }
        const records = nr.buildRecords({ notableIds: plus.ids, cc7: cc7.people, profiles, rootId: this.personId });

        this.data = {
            root: { id: this.personId, wtId: root.Name, name: rootName },
            records,
            dataDate: plus.dataDate,
            isPartial: cc7.isPartial,
            cc7Count: cc7.people.size,
        };
        NotableRelativesView.cache.set(this.personId, this.data);
        if (this.controller?.signal !== signal) return;
        this.showResults();
        await this.findMissingDegrees(api, signal);
    }

    // Notables WikiTree+ lists in the CC7 that the getPeople walk did not reach (usually because, without a login,
    // it does not go on past living, privacy-limited profiles). One getConnections lookup each, a few at a time.
    async findMissingDegrees(api, signal) {
        const missing = this.data.records.filter((r) => r.degree === null && !r.isConnectionTried);
        if (!missing.length) return;
        let done = 0;
        const total = missing.length;
        const say = () =>
            this.setProgress(
                `Finding the degree of ${plural(total, "notable relative")} reached only through private profiles… ` +
                    `${fmt(done)} of ${fmt(total)}`
            );
        say();
        const queue = [...missing];
        const worker = async () => {
            while (queue.length && !signal.aborted) {
                const r = queue.shift();
                r.isConnectionTried = true;
                try {
                    nr.applyConnection(r, await nr.fetchConnection(this.data.root.wtId, r.wtId, { api, signal }));
                } catch (err) {
                    if (err?.name === "AbortError") return;
                    console.warn(`Notable Relatives: no connection for ${r.wtId}`, err);
                }
                done++;
                say();
            }
        };
        await Promise.all([worker(), worker(), worker()]);
        if (signal.aborted || this.controller?.signal !== signal) return;
        this.setProgress("");
        const filters = this.container.querySelector(".nr-filters");
        if (!filters?.contains(document.activeElement)) this.renderFilters();
        this.renderResults();
    }

    // ---------- rendering ----------

    setProgress(html) {
        const el = this.container?.querySelector(".nr-progress");
        if (el) el.innerHTML = html;
    }

    setSummary(html) {
        const el = this.container?.querySelector(".nr-summary");
        if (el) el.innerHTML = html;
    }

    showResults() {
        const { root, records, dataDate, isPartial, cc7Count } = this.data;
        this.setProgress("");
        const rootLink = `<a href="${WIKI}${encodeURIComponent(root.wtId)}" target="_blank">${esc(root.name)}</a>`;
        const asOf = dataDate ? ` WikiTree+ data as of ${esc(dataDate)}.` : "";
        this.setSummary(
            `${plural(records.length, "notable relative")} within 7 degrees of ${rootLink}` +
                ` (out of ${fmt(cc7Count)} relatives).${asOf}`
        );
        if (isPartial) {
            wtViewRegistry.showWarning(
                "WikiTree stopped before listing every relative, so some degrees may be missing. Try again later."
            );
        }
        if (!records.length) {
            this.container.querySelector(".nr-results").innerHTML = `
                <p class="nr-empty">No notable profiles were found within 7 degrees of ${rootLink}.
                Notable profiles carry a template such as
                <a href="https://www.wikitree.com/wiki/Template:Notability" target="_blank">Notability</a>
                or the Notables Sticker. WikiTree+ is updated every few days, so a newly added template may
                not show yet.</p>`;
            return;
        }
        this.renderFilters();
        this.renderResults();
    }

    renderFilters() {
        const f = nr.facets(this.data.records);
        const el = this.container.querySelector(".nr-filters");
        const degreeLabel = (d) => (d === "unknown" ? "Unknown" : d === 0 ? "Self" : d);
        const degreeOrder = (d) => (d === "unknown" ? 99 : d);
        const degrees = [...f.degrees].sort((a, b) => degreeOrder(a[0]) - degreeOrder(b[0]));
        const notablesCats = f.categories.filter(([c]) => /notables?\b/i.test(c));
        const otherCats = f.categories.filter(([c]) => !/notables?\b/i.test(c));
        const opts = (list, selected, label = (v) => v) =>
            list
                .map(
                    ([v, n]) =>
                        `<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(label(v))} (${fmt(n)})</option>`
                )
                .join("");

        el.innerHTML = `
            <fieldset class="nr-degrees">
                <legend>Degree</legend>
                ${degrees
                    .map(
                        ([d, n]) => `
                    <label title="${plural(n, "notable relative")}">
                        <input type="checkbox" value="${d}" ${this.filters.degrees.has(d) ? "checked" : ""} />
                        ${degreeLabel(d)} <span class="nr-count">${fmt(n)}</span>
                    </label>`
                    )
                    .join("")}
            </fieldset>
            <label class="nr-field nr-wide">Category
                <select class="nr-category">
                    <option value="">All categories</option>
                    ${notablesCats.length ? `<optgroup label="Notables categories">${opts(notablesCats, this.filters.category)}</optgroup>` : ""}
                    ${otherCats.length ? `<optgroup label="Other categories">${opts(otherCats, this.filters.category)}</optgroup>` : ""}
                </select>
            </label>
            <label class="nr-field">Country
                <select class="nr-country">
                    <option value="">All countries</option>
                    ${opts(f.countries, this.filters.country)}
                </select>
            </label>
            <label class="nr-field">Place contains
                <input type="search" class="nr-place" placeholder="e.g. Dublin" value="${esc(this.filters.place)}" />
            </label>
            <label class="nr-field">Marker
                <select class="nr-marker-filter">
                    <option value="">Any notable template</option>
                    ${opts(f.markers, this.filters.marker, (m) => nr.MARKERS[m] || m)}
                </select>
            </label>
            <label class="nr-field">Name
                <input type="search" class="nr-q" placeholder="Search names" value="${esc(this.filters.q)}" />
            </label>
            <div class="nr-actions">
                <button type="button" class="small button nr-reset">Clear filters</button>
                <button type="button" class="small button nr-csv">Download CSV</button>
                <button type="button" class="small button nr-toggle">Collapse all</button>
            </div>`;
        el.classList.remove("hidden");

        const $el = $(el);
        if ($.fn.select2) {
            $el.find(".nr-category, .nr-country").select2({ width: "100%" });
        }
        $el.find(".nr-degrees input").on("change", () => {
            this.filters.degrees = new Set(
                $el
                    .find(".nr-degrees input:checked")
                    .map((i, cb) => (cb.value === "unknown" ? "unknown" : Number(cb.value)))
                    .get()
            );
            this.onFiltersChanged();
        });
        $el.find(".nr-category").on("change", (e) => this.setFilter("category", e.target.value));
        $el.find(".nr-country").on("change", (e) => this.setFilter("country", e.target.value));
        $el.find(".nr-marker-filter").on("change", (e) => this.setFilter("marker", e.target.value));
        let typing;
        $el.find(".nr-place, .nr-q").on("input", (e) => {
            clearTimeout(typing);
            const key = e.target.classList.contains("nr-place") ? "place" : "q";
            const value = e.target.value;
            typing = setTimeout(() => this.setFilter(key, value), 200);
        });
        $el.find(".nr-reset").on("click", () => {
            this.filters = this.filtersFromParams({});
            this.renderFilters();
            this.onFiltersChanged();
        });
        $el.find(".nr-csv").on("click", () => this.downloadCsv());
        $el.find(".nr-toggle").on("click", (e) => {
            const sections = this.container.querySelectorAll(".nr-degree");
            const open = e.target.textContent === "Expand all";
            sections.forEach((s) => (s.open = open));
            e.target.textContent = open ? "Collapse all" : "Expand all";
        });
    }

    setFilter(key, value) {
        this.filters[key] = value || "";
        this.onFiltersChanged();
    }

    onFiltersChanged() {
        this.writeParams();
        this.renderResults();
    }

    filtered() {
        return nr.applyFilters(this.data.records, this.filters);
    }

    renderResults() {
        const list = this.filtered();
        const results = this.container.querySelector(".nr-results");
        const total = this.data.records.length;
        const head =
            list.length === total
                ? `<p class="nr-showing">Showing all ${plural(total, "notable relative")}.</p>`
                : `<p class="nr-showing">Showing ${fmt(list.length)} of ${plural(total, "notable relative")}.</p>`;
        if (!list.length) {
            results.innerHTML = `${head}<p class="nr-empty">No notable relatives match these filters.</p>`;
            return;
        }
        results.innerHTML =
            head +
            nr
                .groupByDegree(list)
                .map(
                    ([degree, people]) => `
                <details class="nr-degree" open>
                    <summary>
                        <span class="nr-degree-name">${this.degreeHeading(degree)}</span>
                        <span class="nr-count">${plural(people.length, "notable relative")}</span>
                    </summary>
                    <div class="nr-grid">${people.map((r) => this.card(r)).join("")}</div>
                </details>`
                )
                .join("");

        $(results)
            .find(".nr-chip-cat")
            .on("click", (e) => this.pickFromCard("category", e.currentTarget.dataset.value));
        $(results)
            .find(".nr-chip-country")
            .on("click", (e) => this.pickFromCard("country", e.currentTarget.dataset.value));
    }

    pickFromCard(key, value) {
        this.filters[key] = value;
        const select = this.container.querySelector(key === "category" ? ".nr-category" : ".nr-country");
        if (select) $(select).val(value).trigger("change.select2");
        this.onFiltersChanged();
        this.container.querySelector(".nr-filters")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    degreeHeading(degree) {
        if (degree === "unknown") return "Degree not found";
        if (degree === 0) return "Starting profile";
        return `${degree} degree${degree === 1 ? "" : "s"} away`;
    }

    card(r) {
        const url = `${WIKI}${encodeURIComponent(r.wtId)}`;
        const photo = r.photoUrl
            ? `<img class="nr-photo" src="${esc(r.photoUrl)}" alt="" loading="lazy" />`
            : `<div class="nr-photo nr-photo-none" aria-hidden="true">${esc((r.name || "?").charAt(0))}</div>`;
        const life = [
            r.birthDate || r.birthPlace ? `b. ${esc(r.birthDate)}${r.birthPlace ? `, ${esc(r.birthPlace)}` : ""}` : "",
            r.deathDate || r.deathPlace ? `d. ${esc(r.deathDate)}${r.deathPlace ? `, ${esc(r.deathPlace)}` : ""}` : "",
        ]
            .filter(Boolean)
            .join("<br />");
        const shown = r.categories.slice(0, 4);
        const more = r.categories.length - shown.length;
        const chips = [
            ...r.markers.map((m) => `<span class="nr-marker nr-marker-${m}">${esc(nr.MARKERS[m] || m)}</span>`),
            ...r.countries.map(
                (c) =>
                    `<button type="button" class="nr-chip nr-chip-country" data-value="${esc(c)}" title="Show only ${esc(c)}">${esc(c)}</button>`
            ),
            ...shown.map(
                (c) =>
                    `<button type="button" class="nr-chip nr-chip-cat" data-value="${esc(c)}" title="Show only this category">${esc(c)}</button>`
            ),
            more ? `<span class="nr-more" title="${esc(r.categories.slice(4).join("\n"))}">+${more} more</span>` : "",
        ].join("");
        return `
            <article class="nr-card">
                ${photo}
                <div class="nr-card-body">
                    <a class="nr-name" href="${url}" target="_blank" title="${esc(r.longName || r.name)}">${esc(r.name)}</a>
                    <div class="nr-rel${r.isBlood ? "" : " nr-rel-marriage"}">${esc(r.relationship)}</div>
                    ${life ? `<div class="nr-life">${life}</div>` : ""}
                    <div class="nr-chips">${chips}</div>
                </div>
            </article>`;
    }

    downloadCsv() {
        const csv = nr.toCsv(nr.groupByDegree(this.filtered()).flatMap(([, list]) => list));
        const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `notable-relatives-${this.data.root.wtId}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    // ---------- URL parameters ----------

    filtersFromParams(params) {
        const degrees = new Set(
            String(params.degree || "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) => (s === "unknown" ? "unknown" : Number(s)))
                .filter((d) => d === "unknown" || Number.isInteger(d))
        );
        return {
            degrees,
            category: params.cat || "",
            country: params.loc || "",
            place: params.place || "",
            marker: params.marker || "",
            q: params.q || "",
        };
    }

    // Keeps the filters in the address so a filtered list can be shared. replaceState does not fire
    // "hashchange", so the Tree App does not reload the view.
    writeParams() {
        const usp = new URLSearchParams(window.location.hash.slice(1));
        const f = this.filters;
        const values = {
            degree: [...f.degrees].join(","),
            cat: f.category,
            loc: f.country,
            place: f.place,
            marker: f.marker,
            q: f.q,
        };
        for (const key of FILTER_PARAMS) {
            if (values[key]) usp.set(key, values[key]);
            else usp.delete(key);
        }
        history.replaceState(null, "", `#${usp.toString()}`);
    }
};
