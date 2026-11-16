/*
 * Notable Relatives
 *
 * Finds the notable people (profiles with a notable template, found with WikiTree+) related to the starting
 * profile, in one of two ways:
 *   - Shared ancestors (default): notable ancestors, notable descendants, and the notable descendants of each
 *     generation of ancestors up to 15 generations back, grouped by the closest shared ancestors.
 *   - Within 7 degrees: everyone in the CC7, in-laws included, grouped by degree.
 * Filters for category, country, place, marker and name.
 *
 * Idea by Blake Ashton (Ashton-4458), in his answer of 7 November 2026 to the G2G question
 * "WikiTree Days Saturday Question: If you could invent one new WikiTree tool, what would it do?"
 * https://www.wikitree.com/g2g/2105562/wikitree-days-saturday-question-could-invent-wikitree-would?show=2105577#a2105577
 * Inspired by Relative Finder, which finds famous relatives on FamilySearch.
 *
 * Help page: https://www.wikitree.com/wiki/Space:Notable_Relatives. Version and history: VERSION in notable_data.js and
 * CHANGELOG.md.
 */

import * as nr from "./notable_data.js";

const IDEA_URL =
    "https://www.wikitree.com/g2g/2105562/wikitree-days-saturday-question-could-invent-wikitree-would?show=2105577#a2105577";
const IDEA_PROFILE = "https://www.wikitree.com/wiki/Ashton-4458";
const WIKI = "https://www.wikitree.com/wiki/";
const FILTER_PARAMS = ["mode", "gens", "group", "cat", "loc", "place", "marker", "q"];
const PAGE_SIZE = 60; // cards shown per group before "Show more"

const esc = (s) =>
    String(s ?? "").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
const fmt = (n) => Number(n).toLocaleString();
const plural = (n, word, words = `${word}s`) => `${fmt(n)} ${n === 1 ? word : words}`;
const relationshipUrl = (a, b) =>
    "https://www.wikitree.com/index.php?title=Special:Relationship&action=calculate" +
    `&person1Name=${encodeURIComponent(a)}&person2Name=${encodeURIComponent(b)}`;

window.NotableRelativesView = class NotableRelativesView extends View {
    // "<Id>|<mode>|<gens>" -> results of a finished search
    static cache = new Map();

    meta() {
        return {
            title: "Notable Relatives",
            description:
                "Notable people related to this profile: notable ancestors, descendants and cousins through shared " +
                "ancestors up to 15 generations back, or everyone within 7 degrees. Filter by category and " +
                "location. Idea by Blake Ashton (Ashton-4458) on G2G.",
            docs: nr.HELP_URL,
            params: FILTER_PARAMS,
        };
    }

    init(containerSelector, personId, params = {}) {
        this.container = document.querySelector(containerSelector);
        this.personId = Number(personId);
        this.mode = params.mode === "cc7" ? "cc7" : "anc";
        this.gens = this.clampGens(params.gens);
        this.filters = this.filtersFromParams(params);
        this.shown = new Map();

        this.container.innerHTML = `
            <div class="nr-view" data-version="${nr.VERSION}">
                <div class="nr-header">
                    <div class="nr-brand">
                        <img class="nr-logo" src="views/notableRelatives/images/notable-relatives-logo.svg" alt="" width="48" height="48" />
                        <h2 class="nr-title">Notable Relatives</h2>
                    </div>
                    <div class="nr-modes" role="radiogroup" aria-label="Which relatives">
                        <label><input type="radio" name="nr-mode" value="anc" ${this.mode === "anc" ? "checked" : ""} />
                            Shared ancestors, up to
                            <select class="nr-gens" aria-label="Generations back">
                                ${Array.from({ length: nr.MAX_GENERATIONS - 2 }, (_, i) => i + 3)
                                    .map(
                                        (g) => `<option value="${g}" ${g === this.gens ? "selected" : ""}>${g}</option>`
                                    )
                                    .join("")}
                            </select>
                            generations back</label>
                        <label><input type="radio" name="nr-mode" value="cc7" ${this.mode === "cc7" ? "checked" : ""} />
                            Everyone within 7 degrees (includes in-laws)</label>
                        <button type="button" class="small button nr-stop hidden">Stop</button>
                    </div>
                    <p class="nr-summary" aria-live="polite"></p>
                </div>
                <div class="nr-progress" aria-live="polite"></div>
                <div class="nr-filters hidden"></div>
                <div class="nr-results"></div>
                <footer class="nr-footer">
                    Notable profiles are those WikiTree+ lists with a notable template
                    (<a href="https://www.wikitree.com/wiki/Template:Notability" target="_blank">Notability</a>,
                    <a href="https://www.wikitree.com/wiki/Project:Notables" target="_blank">Notables Sticker</a>
                    and others). <strong>Shared ancestors</strong> groups each notable by the nearest generation of
                    ancestors they descend from; open <em>Relationship</em> on a card for the exact relationship.
                    <strong>Within 7 degrees</strong> counts steps through parents, children, siblings and spouses.
                    Use <em>Apps Login</em> to follow links through private profiles.<br />
                    Idea by <a href="${IDEA_PROFILE}" target="_blank">Blake Ashton (Ashton-4458)</a>
                    on <a href="${IDEA_URL}" target="_blank">G2G</a>, inspired by Relative Finder.
                    <p class="nr-credit">
                        <span class="nr-version">Notable Relatives v${nr.VERSION}</span> ·
                        Created by <a href="${nr.AUTHOR_URL}" target="_blank" rel="noopener"
                            title="The author's WikiTree profile">${nr.AUTHOR_ID}</a> ·
                        <a href="${nr.HELP_URL}" target="_blank" rel="noopener"
                            title="About and how to use Notable Relatives, on WikiTree">Help</a>
                    </p>
                </footer>
            </div>`;

        const $c = $(this.container);
        $c.find("input[name=nr-mode]").on("change", (e) => this.switchMode(e.target.value, this.gens));
        $c.find(".nr-gens").on("change", (e) => this.switchMode("anc", this.clampGens(e.target.value)));
        $c.find(".nr-stop").on("click", () => this.stop());
        this.start();
    }

    close() {
        this.controller?.abort();
        this.controller = null;
    }

    clampGens(value) {
        const n = Number(value);
        return Number.isInteger(n) ? Math.max(3, Math.min(nr.MAX_GENERATIONS, n)) : nr.DEFAULT_GENERATIONS;
    }

    cacheKey() {
        return `${this.personId}|${this.mode}|${this.mode === "anc" ? this.gens : ""}`;
    }

    switchMode(mode, gens) {
        this.mode = mode === "cc7" ? "cc7" : "anc";
        this.gens = gens;
        this.container.querySelector(`input[name=nr-mode][value=${this.mode}]`).checked = true;
        this.filters.groups = new Set(); // group keys differ between the two searches
        this.writeParams();
        this.start();
    }

    start() {
        this.controller?.abort();
        this.controller = new AbortController();
        this.isStopping = false;
        this.shown = new Map();
        this.container.querySelector(".nr-results").innerHTML = "";
        this.container.querySelector(".nr-filters").classList.add("hidden");
        this.setProgress("");
        wtViewRegistry.clearStatus();

        const signal = this.controller.signal;
        const cached = NotableRelativesView.cache.get(this.cacheKey());
        if (cached) {
            this.data = cached;
            this.showStop(false);
            this.showResults();
            if (this.mode === "cc7") {
                this.findMissingDegrees(this.api, signal).catch((err) => console.warn("Notable Relatives:", err));
            }
            return;
        }
        const load = this.mode === "cc7" ? this.loadCc7(signal) : this.loadAncestral(signal);
        load.catch((err) => {
            if (err?.name === "AbortError" || signal.aborted) return;
            console.error("Notable Relatives:", err);
            this.setProgress("");
            this.setSummary("");
            this.showStop(false);
            wtViewRegistry.showError(
                nr.isLimitError(err)
                    ? nr.LIMIT_MESSAGE
                    : nr.isNetworkError(err)
                      ? nr.NETWORK_MESSAGE
                      : err?.message || String(err)
            );
        });
    }

    stop() {
        this.isStopping = true;
        this.controller?.abort();
    }

    api(data, signal) {
        return WikiTreeAPI.postToAPI(data, signal);
    }

    async loadRoot(signal) {
        if (this.root?.id === this.personId) return this.root;
        const result = await this.api(
            {
                appId: nr.APP_ID,
                action: "getPeople",
                keys: String(this.personId),
                fields: "Id,Name,FirstName,LastNameAtBirth,Derived.ShortName",
            },
            signal
        );
        const p = Object.values(result?.[0]?.people || {}).find((x) => Number(x.Id) === this.personId);
        if (!p?.Name) throw new Error("WikiTree did not return the starting profile.");
        const name = p?.Derived?.ShortName || [p.FirstName, p.LastNameAtBirth].filter(Boolean).join(" ") || p.Name;
        this.root = { id: this.personId, wtId: p.Name, name };
        return this.root;
    }

    // ---------- shared ancestors ----------

    async loadAncestral(signal) {
        const gens = this.gens;
        const key = this.cacheKey();
        this.setSummary("Looking for notable relatives…");
        this.showStop(true);
        const root = await this.loadRoot(signal);
        this.setSummary(`Looking for notable relatives of ${esc(root.name)}…`);
        const data = {
            mode: "anc",
            gens,
            root,
            records: [],
            dataDate: "",
            ancestorCount: 0,
            searchedTo: 0,
            isDone: false,
        };
        this.data = data;

        const say = (status) => {
            if (status.stage === "ancestors") {
                data.ancestorCount = status.count;
                this.setProgress(
                    `Loading ancestors, generation ${status.generation} of ${gens}… ${fmt(status.count)} so far`
                );
            } else if (status.stage === "notable-ancestors") {
                this.setProgress(`Found ${plural(data.ancestorCount, "ancestor")}. Looking for notable ancestors…`);
            } else if (status.stage === "notable-descendants") {
                this.setProgress("Looking for notable descendants…");
            } else if (status.stage === "cousins") {
                data.searchedTo = status.generation - 1;
                const label = nr.ancestralGroup("cousin", status.generation).groupHeading.replace(/^Shared /, "");
                const part = status.queries > 1 ? ` (part ${status.query} of ${status.queries})` : "";
                this.setProgress(
                    `Searching descendants of the ${label}, generation ${status.generation} of ${gens}${part}…`
                );
            }
        };

        let result = null;
        try {
            result = await nr.searchAncestral({
                rootId: root.id,
                rootWtId: root.wtId,
                generations: gens,
                api: this.api,
                signal,
                onStatus: say,
                onFound: async (found) => {
                    const profiles = await nr.fetchProfiles(found.ids, { api: this.api, signal });
                    data.records.push(...nr.buildAncestralRecords({ ...found, profiles }));
                    if (this.data === data) this.showResults();
                },
            });
        } catch (err) {
            // Keep what was found when WikiTree starts limiting requests part way through a long search.
            if (nr.isLimitError(err) && data.records.length) data.isLimited = true;
            else if (nr.isNetworkError(err) && data.records.length) data.isOffline = true;
            else if (!(this.isStopping && signal.aborted)) throw err;
        }
        this.showStop(false);
        if (result) {
            data.searchedTo = result.generations;
            data.dataDate = result.dataDate;
            data.failedQueries = result.failedQueries;
            data.isPartial = result.isPartial;
            data.isDone = true;
            NotableRelativesView.cache.set(key, data); // a stopped search is not kept, so it can be run again
        } else {
            data.isStopped = true;
            if (data.isLimited) {
                this.setProgress("");
                wtViewRegistry.showWarning(`${nr.LIMIT_MESSAGE} The relatives found so far are shown.`);
            } else if (data.isOffline) {
                this.setProgress("");
                wtViewRegistry.showWarning(`${nr.NETWORK_MESSAGE} The relatives found so far are shown.`);
            }
        }
        if (this.data === data) this.showResults();
    }

    // ---------- within 7 degrees ----------

    async loadCc7(signal) {
        const key = this.cacheKey();
        this.setSummary("Looking for notable relatives…");
        const root = await this.loadRoot(signal);
        this.setSummary(`Looking for notable relatives of ${esc(root.name)}…`);

        let plusLine = "Asking WikiTree+ for the list of notable profiles…";
        let cc7Line = "Loading relatives within 7 degrees…";
        const show = () => this.setProgress(`${plusLine}<br />${cc7Line}`);
        show();

        // WikiTree+'s own CC7 stops at private profiles, so the relatives the API walk reaches are matched against
        // the list of every notable profile. The WikiTree+ CC7 answer is added for any the walk did not reach.
        const plusPromise = Promise.all([
            nr.fetchAllNotableIds({ signal }),
            nr.fetchPlusNotableIds(root.wtId, { signal }),
        ]).then(([all, cc7Plus]) => {
            plusLine = `WikiTree+ lists ${plural(all.ids.size, "notable profile")} in all.`;
            show();
            return { all: all.ids, cc7Ids: cc7Plus.ids, dataDate: cc7Plus.dataDate || all.dataDate };
        });
        const cc7Promise = nr
            .fetchCc7(this.personId, {
                api: this.api,
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
        const notableIds = nr.notablesInCc7(cc7.people, plus.all, plus.cc7Ids, this.personId);

        let profiles = new Map();
        if (notableIds.length) {
            this.setProgress(`${plusLine}<br />${cc7Line}<br />Reading the notable profiles…`);
            profiles = await nr.fetchProfiles(notableIds, { api: this.api, signal });
        }
        const records = nr.buildRecords({ notableIds, cc7: cc7.people, profiles, rootId: this.personId });

        const data = {
            mode: "cc7",
            root,
            records,
            dataDate: plus.dataDate,
            isPartial: cc7.isPartial,
            cc7Count: cc7.people.size,
            isDone: true,
        };
        NotableRelativesView.cache.set(key, data);
        if (this.controller?.signal !== signal) return;
        this.data = data;
        this.setProgress("");
        this.showResults();
        await this.findMissingDegrees(this.api, signal);
    }

    // Notables WikiTree+ lists in the CC7 that the getPeople walk did not reach (usually because, without a login,
    // it does not go on past living, privacy-limited profiles). One getConnections lookup each, a few at a time.
    async findMissingDegrees(api, signal) {
        const data = this.data;
        const missing = data.records.filter((r) => r.degree === null && !r.isConnectionTried);
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
        let isLimited = false;
        const worker = async () => {
            while (queue.length && !signal.aborted) {
                const r = queue.shift();
                r.isConnectionTried = true;
                try {
                    nr.applyConnection(r, await nr.fetchConnection(data.root.wtId, r.wtId, { api, signal }));
                } catch (err) {
                    if (err?.name === "AbortError") return;
                    if (nr.isLimitError(err)) {
                        queue.length = 0; // stop asking; the rest keep "Degree not found"
                        isLimited = true;
                    } else {
                        console.warn(`Notable Relatives: no connection for ${r.wtId}`, err);
                    }
                }
                done++;
                say();
            }
        };
        await Promise.all([worker(), worker(), worker()]);
        if (signal.aborted || this.controller?.signal !== signal) return;
        this.setProgress("");
        this.showResults();
        if (isLimited) wtViewRegistry.showWarning(`${nr.LIMIT_MESSAGE} Some degrees could not be found.`);
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

    showStop(isShown) {
        this.container?.querySelector(".nr-stop")?.classList.toggle("hidden", !isShown);
    }

    showResults() {
        const d = this.data;
        const rootLink = `<a href="${WIKI}${encodeURIComponent(d.root.wtId)}" target="_blank">${esc(d.root.name)}</a>`;
        const asOf = d.dataDate ? ` WikiTree+ data as of ${esc(d.dataDate)}.` : "";
        const count = plural(d.records.length, "notable relative");
        if (d.mode === "cc7") {
            this.setSummary(`${count} within 7 degrees of ${rootLink} (out of ${fmt(d.cc7Count)} relatives).${asOf}`);
        } else {
            const reach = d.isDone
                ? `up to ${d.gens} generations back`
                : d.isStopped
                  ? `up to ${d.searchedTo} generation${d.searchedTo === 1 ? "" : "s"} back`
                  : "so far";
            const stopped = d.isStopped ? "; search stopped" : "";
            this.setSummary(
                `${count} of ${rootLink} through shared ancestors ${reach}` +
                    ` (${plural(d.ancestorCount, "ancestor")} searched${stopped}).${asOf}`
            );
            if (d.isDone || d.isStopped) this.setProgress("");
        }
        if (d.isPartial || d.failedQueries) {
            wtViewRegistry.showWarning(
                d.failedQueries
                    ? `WikiTree+ did not answer ${plural(d.failedQueries, "search")}, so some relatives may be missing.`
                    : "WikiTree stopped before listing every relative, so some may be missing. Try again later."
            );
        }

        if (!d.records.length) {
            this.container.querySelector(".nr-filters").classList.add("hidden");
            const tip =
                d.mode === "cc7"
                    ? "Try the shared-ancestors search."
                    : d.gens < nr.MAX_GENERATIONS
                      ? "Try more generations back."
                      : "";
            this.container.querySelector(".nr-results").innerHTML =
                d.isDone || d.isStopped
                    ? `<p class="nr-empty">No notable relatives were found for ${rootLink}. Notable profiles carry a
                        template such as
                        <a href="https://www.wikitree.com/wiki/Template:Notability" target="_blank">Notability</a>
                        or the Notables Sticker. ${tip} WikiTree+ is updated every few days, so a newly added template
                        may not show yet.</p>`
                    : "";
            return;
        }
        const filters = this.container.querySelector(".nr-filters");
        if (!filters.contains(document.activeElement)) this.renderFilters();
        this.renderResults();
    }

    renderFilters() {
        const f = nr.facets(this.data.records);
        const el = this.container.querySelector(".nr-filters");
        const notablesCats = f.categories.filter(([c]) => /notables?\b/i.test(c));
        const otherCats = f.categories.filter(([c]) => !/notables?\b/i.test(c));
        const opts = (list, selected, label = (v) => v) =>
            list
                .map(
                    ([v, n]) =>
                        `<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(label(v))} (${fmt(n)})</option>`
                )
                .join("");
        const isAnc = this.data.mode === "anc";

        el.innerHTML = `
            <fieldset class="nr-groups">
                <legend>${isAnc ? "Show" : "Degree"}</legend>
                ${
                    isAnc && f.groups.some((g) => nr.DIRECT_LINE_GROUPS.includes(g.key))
                        ? `<button type="button" class="small button nr-direct" title="Show only notable ancestors and descendants, no cousins">Direct line only</button>`
                        : ""
                }
                ${isAnc ? `<span class="nr-groups-hint">Shared ancestors by generation:</span>` : ""}
                ${f.groups
                    .map(
                        (g) => `
                    <label title="${esc(g.heading)} (${plural(g.count, "notable relative")})">
                        <input type="checkbox" value="${esc(g.key)}" ${this.filters.groups.has(g.key) ? "checked" : ""} />
                        ${esc(g.short)} <span class="nr-count">${fmt(g.count)}</span>
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

        // Put the "generations back" hint after the ancestor and descendant boxes, before the numbers.
        const hint = el.querySelector(".nr-groups-hint");
        const firstNumber = [...el.querySelectorAll(".nr-groups input")].find((cb) => /^g\d+$/.test(cb.value));
        if (hint && firstNumber) firstNumber.closest("label").before(hint);
        else hint?.remove();

        const $el = $(el);
        if ($.fn.select2) {
            $el.find(".nr-category, .nr-country").select2({ width: "100%" });
        }
        $el.find(".nr-groups input").on("change", () => {
            this.filters.groups = new Set(
                $el
                    .find(".nr-groups input:checked")
                    .map((i, cb) => cb.value)
                    .get()
            );
            this.onFiltersChanged();
        });
        $el.find(".nr-direct").on("click", () => {
            this.filters.groups = new Set(f.groups.map((g) => g.key).filter((k) => nr.DIRECT_LINE_GROUPS.includes(k)));
            this.renderFilters();
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
            const sections = this.container.querySelectorAll(".nr-group");
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
        this.shown = new Map();
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
        const closed = new Set([...results.querySelectorAll(".nr-group:not([open])")].map((el) => el.dataset.key));
        results.innerHTML =
            head +
            nr
                .groupRecords(list)
                .map((g) => {
                    const limit = this.shown.get(g.key) || PAGE_SIZE;
                    const visible = g.records.slice(0, limit);
                    const rest = g.records.length - visible.length;
                    return `
                <details class="nr-group" data-key="${esc(g.key)}" ${closed.has(g.key) ? "" : "open"}>
                    <summary>
                        <span class="nr-group-name">${esc(g.heading)}</span>
                        ${g.note ? `<span class="nr-group-note">${esc(g.note)}</span>` : ""}
                        <span class="nr-count">${plural(g.records.length, "notable relative")}</span>
                    </summary>
                    <div class="nr-grid">${visible.map((r) => this.card(r)).join("")}</div>
                    ${
                        rest
                            ? `<button type="button" class="small button nr-more-btn" data-key="${esc(g.key)}">
                                Show ${fmt(Math.min(rest, PAGE_SIZE))} more (${fmt(rest)} not shown)</button>`
                            : ""
                    }
                </details>`;
                })
                .join("");

        const $r = $(results);
        $r.find(".nr-chip-cat").on("click", (e) => this.pickFromCard("category", e.currentTarget.dataset.value));
        $r.find(".nr-chip-country").on("click", (e) => this.pickFromCard("country", e.currentTarget.dataset.value));
        $r.find(".nr-more-btn").on("click", (e) => {
            const key = e.currentTarget.dataset.key;
            this.shown.set(key, (this.shown.get(key) || PAGE_SIZE) + PAGE_SIZE);
            const y = window.scrollY;
            this.renderResults();
            window.scrollTo(0, y);
        });
    }

    pickFromCard(key, value) {
        this.filters[key] = value;
        const select = this.container.querySelector(key === "category" ? ".nr-category" : ".nr-country");
        if (select) $(select).val(value).trigger("change.select2");
        this.onFiltersChanged();
        this.container.querySelector(".nr-filters")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
        const root = this.data.root;
        const relLink =
            r.wtId && r.id !== root.id
                ? ` · <a class="nr-rel-link" href="${relationshipUrl(root.wtId, r.wtId)}" target="_blank"
                    title="WikiTree's Relationship Finder for ${esc(root.name)} and ${esc(r.name)}">Relationship</a>`
                : "";
        return `
            <article class="nr-card">
                ${photo}
                <div class="nr-card-body">
                    <a class="nr-name" href="${url}" target="_blank" title="${esc(r.longName || r.name)}">${esc(r.name)}</a>
                    <div class="nr-rel${r.isBlood ? "" : " nr-rel-marriage"}">${esc(r.relationship)}${relLink}</div>
                    ${life ? `<div class="nr-life">${life}</div>` : ""}
                    <div class="nr-chips">${chips}</div>
                </div>
            </article>`;
    }

    downloadCsv() {
        const csv = nr.toCsv(nr.groupRecords(this.filtered()).flatMap((g) => g.records));
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
        return {
            groups: new Set(
                String(params.group || "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
            ),
            category: params.cat || "",
            country: params.loc || "",
            place: params.place || "",
            marker: params.marker || "",
            q: params.q || "",
        };
    }

    // Keeps the search and filters in the address so a list can be shared. replaceState does not fire
    // "hashchange", so the Tree App does not reload the view.
    writeParams() {
        const usp = new URLSearchParams(window.location.hash.slice(1));
        const f = this.filters;
        const values = {
            mode: this.mode === "cc7" ? "cc7" : "",
            gens: this.mode === "anc" && this.gens !== nr.DEFAULT_GENERATIONS ? String(this.gens) : "",
            group: [...f.groups].join(","),
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
