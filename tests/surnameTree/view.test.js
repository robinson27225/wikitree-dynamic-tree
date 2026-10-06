import {
    BUTTON_FACTOR,
    IDENTITY,
    MAX_ZOOM,
    MIN_ZOOM,
    clientToView,
    panBy,
    transformText,
    viewScale,
    wheelFactor,
    zoomAbout,
} from "../../views/surnameTree/surname_tree_zoom.js";
import { attachZoom, renderTreeSvg } from "../../views/surnameTree/surname_tree_svg.js";
import {
    PAGE_SIZE,
    cardHtml,
    countText,
    escapeHtml,
    listHtml,
    profileHref,
    sortedEntries,
} from "../../views/surnameTree/surname_tree_list.js";

describe("zoom", () => {
    it("keeps the point under the pointer still when zooming", () => {
        const t = zoomAbout(IDENTITY, 2, 300, 200);
        expect(t.k).toBe(2);
        // the point (300, 200) is drawn where it was: x + k * 300 = 300
        expect(t.x + t.k * 300).toBeCloseTo(300);
        expect(t.y + t.k * 200).toBeCloseTo(200);
        const again = zoomAbout(t, 1.5, 100, 50);
        expect(again.x + again.k * ((100 - t.x) / t.k)).toBeCloseTo(100);
    });
    it("is kept between the least and most zoom", () => {
        expect(zoomAbout(IDENTITY, 1000, 0, 0).k).toBe(MAX_ZOOM);
        expect(zoomAbout(IDENTITY, 0.0001, 0, 0).k).toBe(MIN_ZOOM);
    });
    it("pans, and writes the transform for the drawing", () => {
        expect(panBy({ x: 1, y: 2, k: 3 }, 10, -5)).toEqual({ x: 11, y: -3, k: 3 });
        expect(transformText({ x: 1, y: 2, k: 3 })).toBe("translate(1 2) scale(3)");
    });
    it("turns a pointer position into the drawing's coordinates", () => {
        // 2000 x 880: the 1000 x 880 drawing fills the height and is centred, with 500 pixels spare each side
        const rect = { left: 10, top: 20, width: 2000, height: 880 };
        expect(viewScale(rect)).toBe(1);
        expect(clientToView(rect, 10 + 500, 20)).toEqual({ x: 0, y: 0 });
        expect(clientToView(rect, 10 + 1000, 20 + 440)).toEqual({ x: 500, y: 440 });
    });
    it("zooms in on scrolling up and out on scrolling down, faster for a pinch", () => {
        expect(wheelFactor({ deltaY: -100, deltaMode: 0 })).toBeGreaterThan(1);
        expect(wheelFactor({ deltaY: 100, deltaMode: 0 })).toBeLessThan(1);
        expect(wheelFactor({ deltaY: -10, ctrlKey: true })).toBeGreaterThan(wheelFactor({ deltaY: -10 }));
    });
});

const items = [
    { text: "SMITH", count: 3, region: "crown", x: 500, y: 300, size: 90, angle: 0, w: 240, h: 72, rank: 0 },
    { text: "BAKER", count: 2, region: "crown", x: 300, y: 200, size: 50, angle: -90, w: 140, h: 40, rank: 1 },
    { text: "SMITH", count: 3, region: "trunk", x: 500, y: 700, size: 12, angle: 33.5, w: 40, h: 10, rank: 0 },
];

describe("renderTreeSvg", () => {
    const draw = () => {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const result = renderTreeSvg(svg, items);
        return { svg, ...result };
    };

    it("draws the trunk, the clumps of leaves and a group for each word", () => {
        const { svg } = draw();
        expect(svg.getAttribute("viewBox")).toBe("0 0 1000 880");
        expect(svg.querySelector(".sutree-trunk")).not.toBeNull();
        expect(svg.querySelectorAll(".sutree-crown").length).toBeGreaterThan(8);
        expect(svg.querySelectorAll(".sutree-word")).toHaveLength(3);
        expect(svg.querySelector(".sutree-word text").textContent).toBe("SMITH");
    });

    it("shades the trunk across, and each clump of leaves from the light side to the shadow side", () => {
        const { svg } = draw();
        const bark = svg.querySelector("#suTreeBark");
        expect(bark.tagName).toBe("linearGradient");
        expect(svg.querySelector(".sutree-trunk").getAttribute("fill")).toBe("url(#suTreeBark)");
        const first = svg.querySelector(".sutree-crown");
        const id = first.getAttribute("fill").match(/#([^)]+)/)[1];
        const gradient = svg.querySelector(`#${id}`);
        expect(gradient.tagName).toBe("radialGradient");
        const [lit, shade] = [...gradient.querySelectorAll("stop")].map((stop) => stop.getAttribute("stop-color"));
        expect(lit).not.toBe(shade);
        // the light falls on the upper left of the clump
        expect(Number(gradient.getAttribute("cx"))).toBeLessThan(Number(first.getAttribute("cx")));
        expect(Number(gradient.getAttribute("cy"))).toBeLessThan(Number(first.getAttribute("cy")));
    });

    it("clips everything to the drawing's frame, so the foot of the trunk does not show below the ground", () => {
        const { svg } = draw();
        const viewport = svg.querySelector(".sutree-viewport");
        expect(viewport.getAttribute("clip-path")).toBe("url(#suTreeFrame)");
        const rect = svg.querySelector("#suTreeFrame rect");
        expect(["x", "y", "width", "height"].map((a) => rect.getAttribute(a))).toEqual(["0", "0", "1000", "880"]);
        // the clip is on the group that zoom moves, so it moves with the picture
        expect(viewport.parentNode).toBe(svg);
    });

    it("draws the ground, ridges of bark kept inside the trunk, and the shadow under the leaves", () => {
        const { svg } = draw();
        const ground = svg.querySelector(".sutree-ground");
        expect(ground.tagName).toBe("ellipse");
        expect(Number(ground.getAttribute("cy"))).toBeGreaterThan(850);
        const bark = svg.querySelector(".sutree-bark");
        expect(bark.getAttribute("d").match(/M/g).length).toBeGreaterThanOrEqual(10);
        expect(bark.getAttribute("clip-path")).toBe("url(#suTreeTrunkClip)");
        expect(svg.querySelector("#suTreeTrunkClip path")).not.toBeNull();
        const shadow = svg.querySelector(".sutree-shadow");
        expect(shadow.getAttribute("transform")).toMatch(/^translate\(\d+ \d+\)$/);
        // the decoration never gets in the way of hovering or clicking the words
        [ground, bark, shadow].forEach((el) => expect(el.getAttribute("pointer-events")).toBe("none"));
        // and it is drawn before the words, behind them
        const order = [...svg.querySelector(".sutree-viewport").children];
        expect(order.indexOf(shadow)).toBeLessThan(order.indexOf(svg.querySelector(".sutree-word")));
        expect(order.indexOf(svg.querySelector(".sutree-trunk"))).toBeLessThan(
            order.indexOf(svg.querySelector(".sutree-crown"))
        );
    });

    it("turns each word to its own angle, with an invisible box to hit that turns with it", () => {
        const { svg } = draw();
        const groups = svg.querySelectorAll(".sutree-word");
        expect(groups[0].getAttribute("transform")).toBe("translate(500 300) rotate(0)");
        expect(groups[1].getAttribute("transform")).toBe("translate(300 200) rotate(-90)");
        expect(groups[2].getAttribute("transform")).toBe("translate(500 700) rotate(33.5)");
        const box = groups[1].querySelector("rect");
        expect([
            box.getAttribute("x"),
            box.getAttribute("y"),
            box.getAttribute("width"),
            box.getAttribute("height"),
        ]).toEqual(["-70", "-20", "140", "40"]);
        expect(groups[1].querySelector("text").hasAttribute("transform")).toBe(false);
    });

    it("maps each surname to all its words, and gives the keyboard one stop for each surname", () => {
        const { svg, words } = draw();
        expect(words.get("SMITH")).toHaveLength(2);
        expect(words.get("BAKER")).toHaveLength(1);
        expect(svg.querySelectorAll('.sutree-word[tabindex="0"]')).toHaveLength(2);
        expect(svg.querySelector('[data-surname="BAKER"]').getAttribute("aria-label")).toBe("BAKER, 2 profiles");
    });

    it("replaces what was drawn before", () => {
        const { svg } = draw();
        renderTreeSvg(svg, items.slice(0, 1));
        expect(svg.querySelectorAll(".sutree-word")).toHaveLength(1);
    });
});

describe("attachZoom", () => {
    const setup = () => {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 880 });
        document.body.appendChild(svg);
        renderTreeSvg(svg, items);
        return { svg, zoom: attachZoom(svg) };
    };
    const transformOf = (svg) => svg.querySelector(".sutree-viewport").getAttribute("transform");

    it("zooms with the buttons, and resets", () => {
        const { svg, zoom } = setup();
        zoom.zoomIn();
        expect(zoom.transform().k).toBeCloseTo(BUTTON_FACTOR);
        expect(transformOf(svg)).toMatch(/scale\(1\.6/);
        zoom.zoomOut();
        expect(zoom.transform().k).toBeCloseTo(1);
        zoom.zoomIn();
        zoom.reset();
        expect(transformOf(svg)).toBe("translate(0 0) scale(1)");
    });

    it("zooms about the pointer when the wheel turns", () => {
        const { svg, zoom } = setup();
        const event = new window.WheelEvent("wheel", {
            deltaY: -300,
            clientX: 100,
            clientY: 100,
            cancelable: true,
            bubbles: true,
        });
        svg.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(zoom.transform().k).toBeGreaterThan(1);
        // the point under the pointer stayed where it was
        expect(zoom.transform().x + zoom.transform().k * 100).toBeCloseTo(100);
    });

    it("pans on a drag, and says it was a drag so the click that ends it is ignored", () => {
        const { svg, zoom } = setup();
        svg.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: 100, clientY: 100, bubbles: true }));
        document.dispatchEvent(new MouseEvent("mousemove", { clientX: 160, clientY: 130 }));
        expect(zoom.transform()).toMatchObject({ x: 60, y: 30, k: 1 });
        expect(zoom.wasDragged()).toBe(true);
        document.dispatchEvent(new MouseEvent("mouseup"));
    });

    it("does not treat a plain click as a drag", () => {
        const { svg, zoom } = setup();
        svg.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: 100, clientY: 100, bubbles: true }));
        document.dispatchEvent(new MouseEvent("mousemove", { clientX: 101, clientY: 101 }));
        expect(zoom.wasDragged()).toBe(false);
        document.dispatchEvent(new MouseEvent("mouseup"));
    });

    it("keeps its zoom when the tree is drawn again", () => {
        const { svg, zoom } = setup();
        zoom.zoomIn();
        renderTreeSvg(svg, items);
        zoom.reapply();
        expect(transformOf(svg)).toMatch(/scale\(1\.6/);
    });
});

const entry = (Id, extra = {}, flags = { bio: true, adopt: false }) => ({
    person: {
        Id,
        Name: `Smith-${Id}`,
        LongName: `John ${Id} Smith`,
        LastNameAtBirth: "Smith",
        BirthDate: "1850-03-02",
        BirthLocation: "Leeds, England",
        DeathDate: "1910-00-00",
        DeathLocation: "",
        ...extra,
    },
    ...flags,
});

describe("list and card", () => {
    it("escapes what goes into the page", () => {
        expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
        expect(profileHref({ Name: "Smith-1" })).toBe("https://www.wikitree.com/wiki/Smith-1");
    });

    it("counts profiles, and says how many are by adoption when some are", () => {
        const plain = { count: 1, entries: [entry(1)] };
        expect(countText(plain)).toBe("1 profile");
        const mixed = { count: 3, entries: [entry(1), entry(2), entry(3, {}, { bio: false, adopt: true })] };
        expect(countText(mixed)).toBe("3 profiles (2 by birth, 1 by adoption)");
    });

    it("sorts oldest first, with no birth year last", () => {
        const word = {
            entries: [
                entry(1, { BirthDate: "1900-01-01" }),
                entry(2, { BirthDate: "0000-00-00" }),
                entry(3, { BirthDate: "1800-05-05" }),
            ],
        };
        expect(sortedEntries(word).map((e) => e.person.Id)).toEqual([3, 1, 2]);
    });

    it("lists full name, WikiTree ID, and born and died with dates and places, as links to the profile", () => {
        const { html, entries } = listHtml({ text: "SMITH", count: 1, entries: [entry(1)] });
        const holder = document.createElement("div");
        holder.innerHTML = html;
        const links = [...holder.querySelectorAll("a")];
        expect(links.map((a) => a.textContent)).toEqual(["John 1 Smith", "Smith-1"]);
        expect(links.every((a) => a.getAttribute("href") === "https://www.wikitree.com/wiki/Smith-1")).toBe(true);
        expect(holder.textContent).toContain("Born: 2 Mar 1850, Leeds, England");
        expect(holder.textContent).toContain("Died: 1910");
        expect(entries).toHaveLength(1);
    });

    it("says when a date or place is not recorded, and tags adoptive relatives", () => {
        const { html } = listHtml({
            text: "SMITH",
            count: 1,
            entries: [
                entry(
                    1,
                    { BirthDate: "", BirthLocation: "", DeathDate: "", DeathLocation: "" },
                    { bio: false, adopt: true }
                ),
            ],
        });
        expect(html).toContain('Born: <span class="sutree-unknown">not recorded</span>');
        expect(html).toContain('<span class="sutree-tag">adoptive</span>');
    });

    it("shows a page at a time, with a button for more", () => {
        const entries = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => entry(i + 1));
        const first = listHtml({ text: "SMITH", count: entries.length, entries });
        expect(first.html.match(/sutree-person/g)).toHaveLength(PAGE_SIZE);
        expect(first.html).toContain("5 not shown");
        const all = listHtml({ text: "SMITH", count: entries.length, entries }, PAGE_SIZE + 5);
        expect(all.html).not.toContain("sutree-more");
    });

    it("makes a card with the name, ID, life events and a link that opens the profile in a new tab", () => {
        const holder = document.createElement("div");
        holder.innerHTML = cardHtml(entry(1));
        expect(holder.querySelector("b").textContent).toBe("John 1 Smith");
        expect(holder.textContent).toContain("(Smith-1)");
        expect(holder.textContent).toContain("Born: 2 Mar 1850, Leeds, England");
        const open = holder.querySelector("a");
        expect(open.getAttribute("href")).toBe("https://www.wikitree.com/wiki/Smith-1");
        expect(open.getAttribute("target")).toBe("_blank");
        expect(open.getAttribute("rel")).toContain("noopener");
        expect(holder.querySelector(".sutree-card-rel")).toBeNull();
    });

    it("says on the card how someone is family when adoption is involved", () => {
        const adopted = document.createElement("div");
        adopted.innerHTML = cardHtml(entry(1, {}, { bio: false, adopt: true }));
        expect(adopted.querySelector(".sutree-card-rel").textContent).toBe("Family by adoption");
        const both = document.createElement("div");
        both.innerHTML = cardHtml(entry(1, {}, { bio: true, adopt: true }));
        expect(both.querySelector(".sutree-card-rel").textContent).toBe("Family by birth and by adoption");
    });
});
