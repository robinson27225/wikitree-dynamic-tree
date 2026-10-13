import { Buffer } from "buffer";

jest.mock("../../views/nameCloud/name_cloud_image.js", () => ({
    ...jest.requireActual("../../views/nameCloud/name_cloud_image.js"),
    readImageFile: (...args) => global.mockReadImage(...args),
    readImageUrl: (...args) => global.mockReadImageUrl(...args),
    backdropDataUrl: () => "data:image/png;base64,AAAA",
}));
// the Tree Apps page provides jQuery and WikiTreeAPI as globals
global.$ = require("jquery");
global.WikiTreeAPI = {
    getPeople: (...args) => global.mockGetPeople(...args),
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => {
    for (let i = 0; i < 10; i++) await tick();
};

const APP = "../../views/nameCloud/name_cloud_app.js";
const START = {
    scope: "ancestors",
    generations: 6,
    degrees: 7,
    fillGaps: false,
    imagesUrl: "https://example.test/views/nameCloud/",
};
let mounted = null; // the app now on the page

/** Put the page's view area on the page, with a fresh copy of the app. */
async function loadFeature() {
    if (mounted) mounted.destroy();
    mounted = null;
    document.body.className = "";
    document.body.innerHTML = '<div id="view-container"></div>';
    jest.isolateModules(() => {
        global.mountApp = require(APP).mountApp;
    });
}

/** What the Tree Apps view does when the page opens it for a person. */
async function openView(personId = "1") {
    mounted = global.mountApp(document.querySelector("#view-container"), personId, global.mockOptions || START);
    await settle();
}

const click = async (selector, init = {}) => {
    document
        .querySelector(selector)
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
    await settle();
};
const change = async (selector, value) => {
    const el = document.querySelector(selector);
    if (el.type === "checkbox" || el.type === "radio") el.checked = value;
    else el.value = value;
    el.dispatchEvent(new Event(el.type === "number" ? "input" : "change", { bubbles: true }));
    await settle();
};
const status = () => document.getElementById("ncloudStatus").textContent;
const words = () => [...document.querySelectorAll(".ncloud-word")].map((g) => g.dataset.surname);
const distinctWords = () => [...new Set(words())].sort();
const person = (Id, surname, extra = {}) => ({
    Id,
    Name: `${surname}-${Id}`,
    LongName: `Person ${Id} ${surname}`,
    FirstName: Id % 2 ? "John William" : "Mary",
    MiddleName: Id === 4 ? "Ann Mary" : "",
    LastNameAtBirth: surname,
    BirthDate: `18${String(Id).padStart(2, "0")}-04-05`,
    BirthLocation: "Leeds, England",
    DeathDate: "",
    DeathLocation: "",
    ...extra,
});

// 1 Robinson was adopted by 2 Gant and 3 Hale; 2's parents are 8 Gant and 9 Moss.
// 1's birth parents are 4 Cave and 5 Dunn; 4's father is 6 Cave.
function makeTree() {
    const tree = {
        1: person(1, "Robinson", {
            Father: 2,
            Mother: 3,
            BioFather: 4,
            BioMother: 5,
            DataStatus: { Father: 5, Mother: 5 },
        }),
        2: person(2, "Gant", { Father: 8, Mother: 9, DataStatus: { Father: 20, Mother: 20 } }),
        3: person(3, "Hale"),
        4: person(4, "Cave", { Father: 6, DataStatus: { Father: 20 } }),
        5: person(5, "Dunn"),
        6: person(6, "Cave"),
        8: person(8, "Gant"),
        9: person(9, "Moss"),
    };
    Object.values(tree).forEach((p) => (p.Spouses = {}));
    tree[2].Spouses = { 3: { Id: 3 } };
    tree[3].Spouses = { 2: { Id: 2 } };
    return tree;
}

beforeAll(() => {
    global.Image = class {
        set src(value) {
            this._src = value;
            setTimeout(() => this.onload && this.onload(), 0);
        }
    };
    const gradient = { addColorStop() {} };
    const g = new Proxy(
        {},
        {
            get: (target, name) =>
                name === "measureText"
                    ? () => ({ width: 10 })
                    : /^create.*Gradient$/.test(String(name))
                      ? () => gradient
                      : () => {},
        }
    );
    window.HTMLCanvasElement.prototype.getContext = () => g;
    window.HTMLCanvasElement.prototype.toBlob = function (cb, type) {
        if (global.mockCanvasFails) return cb(null);
        global.mockBlobs.push({ type, width: this.width, height: this.height });
        cb(new Blob(["x"], { type }));
    };
    // what the PDF holds is read back from the blob the feature saves
    const createObjectURL = (blob) => {
        if (blob.type === "application/pdf") {
            const reader = new FileReader();
            reader.onload = () => global.mockPdfs.push(Buffer.from(reader.result).toString("latin1"));
            reader.readAsArrayBuffer(blob);
        }
        return "blob:x";
    };
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = () => {};
});

beforeEach(() => {
    global.mockReadImage = jest.fn(() => Promise.resolve(pictureOf([30, 140, 40])));
    global.mockReadImageUrl = jest.fn(() => Promise.resolve(pictureOf([240, 150, 20])));
    global.mockBlobs = [];
    global.mockPdfs = [];
    global.mockCanvasFails = false;
    global.mockOptions = undefined;
    global.mockTree = makeTree();
    global.mockGetPeople = jest.fn((app, keys, fields, options) => {
        const tree = global.mockTree;
        if (options && options.nuclear) return Promise.resolve(["", {}, tree]);
        const people = {};
        [].concat(keys).forEach((k) => {
            const found = Object.values(tree).find((p) => p.Id === Number(k) || p.Name === k);
            if (found) people[found.Id] = found;
        });
        return Promise.resolve(["", {}, people]);
    });
});

/** A made-up picture read from a file: a disc of one colour on a plain background (or all one colour if disc is false). */
function pictureOf(rgb, { disc = true, radius = 300, photo = false } = {}) {
    const W = 1000;
    const H = 880;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) data.set([255, 255, 255, 255], i * 4);
    if (photo) {
        // scenery to every edge, colours that change from pixel to pixel
        let seed = 9;
        const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < W * H; i++) data.set([40 + rnd() * 120, 80 + rnd() * 120, 40 + rnd() * 100, 255], i * 4);
    } else if (disc) {
        for (let y = 440 - radius; y < 440 + radius; y++) {
            for (let x = 500 - radius; x < 500 + radius; x++)
                if ((x - 500) ** 2 + (y - 440) ** 2 <= radius * radius) data.set([...rgb, 255], (y * W + x) * 4);
        }
    }
    return { pixels: { width: W, height: H, data }, rect: { x: 0, y: 0, w: W, h: H } };
}
const chooseFile = async (name = "disc.png") => {
    const input = document.getElementById("ncloudFile");
    Object.defineProperty(input, "files", { value: [{ name, type: "image/png", size: 100 }], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
};
const chosenShape = () => document.getElementById("ncloudShapeKind").value;

const open = async () => {
    await loadFeature();
    await openView();
};

describe("Name Cloud", () => {
    it("opens with ancestors, biological and adoptive together, as the options say", async () => {
        await open();
        expect(document.getElementById("ncloudScope").value).toBe("ancestors");
        expect(document.getElementById("ncloudBio").checked).toBe(true);
        expect(document.getElementById("ncloudAdopt").checked).toBe(true);
        expect(document.getElementById("ncloudAmount").textContent).toBe("6 generations");
        expect(distinctWords()).toEqual(["CAVE", "DUNN", "GANT", "HALE", "MOSS", "ROBINSON"]);
        expect(status()).toMatch(/6 surnames from 8 people \(Ancestors, 6 generations, biological and adoptive\)/);
    });

    it("shows biological relatives, adoptive ones, or both, and keeps one ticked", async () => {
        await open();
        await change("#ncloudAdopt", false);
        expect(distinctWords()).toEqual(["CAVE", "DUNN", "ROBINSON"]);
        expect(status()).toMatch(/biological only/);
        await change("#ncloudAdopt", true);
        await change("#ncloudBio", false);
        expect(distinctWords()).toEqual(["GANT", "HALE", "MOSS"]);
        expect(status()).toMatch(/adoptive only/);
        // the last one cannot be taken off
        await change("#ncloudAdopt", false);
        expect(document.getElementById("ncloudAdopt").checked).toBe(true);
        expect(status()).toMatch(/Keep at least one/);
        expect(distinctWords()).toEqual(["GANT", "HALE", "MOSS"]);
    });

    it("does not ask the API again when the tick boxes change", async () => {
        await open();
        const calls = global.mockGetPeople.mock.calls.length;
        await change("#ncloudAdopt", false);
        await change("#ncloudAdopt", true);
        expect(global.mockGetPeople.mock.calls.length).toBe(calls);
    });

    it("says so when there is no adoptive family", async () => {
        global.mockTree = { 1: person(1, "Robinson", { Father: 4, DataStatus: { Father: 20 } }), 4: person(4, "Cave") };
        await open();
        await change("#ncloudBio", false);
        expect(status()).toMatch(/No adoptive connections were found/);
        expect(document.getElementById("ncloudSaveAs").disabled).toBe(true);
    });

    it("goes further out or back in with + and -, within the limits, without asking again for a number it has had", async () => {
        await open();
        const more = document.getElementById("ncloudMore");
        const fewer = document.getElementById("ncloudFewer");
        await click("#ncloudMore");
        expect(document.getElementById("ncloudAmount").textContent).toBe("7 generations");
        const calls = global.mockGetPeople.mock.calls.length;
        await click("#ncloudFewer");
        expect(document.getElementById("ncloudAmount").textContent).toBe("6 generations");
        expect(global.mockGetPeople.mock.calls.length).toBe(calls);
        for (let i = 0; i < 6; i++) await click("#ncloudFewer");
        expect(document.getElementById("ncloudAmount").textContent).toBe("2 generations");
        expect(fewer.disabled).toBe(true);
        expect(more.disabled).toBe(false);
    });

    it("switches to CC7, with degrees to add or take away, and the people nearby", async () => {
        await open();
        await change("#ncloudScope", "cc7");
        expect(document.getElementById("ncloudAmount").textContent).toBe("7 degrees");
        expect(global.mockGetPeople.mock.calls.some((c) => c[3] && c[3].nuclear === 7)).toBe(true);
        expect(status()).toMatch(/\(CC7 \(everyone nearby\), 7 degrees, biological and adoptive\)/);
        await change("#ncloudAdopt", false);
        expect(distinctWords()).toEqual(["CAVE", "DUNN", "ROBINSON"]);
        await click("#ncloudMore");
        expect(document.getElementById("ncloudAmount").textContent).toBe("8 degrees");
        expect(global.mockGetPeople.mock.calls.some((c) => c[3] && c[3].nuclear === 8)).toBe(true);
        for (let i = 0; i < 2; i++) await click("#ncloudMore");
        expect(document.getElementById("ncloudAmount").textContent).toBe("10 degrees");
        expect(document.getElementById("ncloudMore").disabled).toBe(true);
    });

    it("starts on CC7 with the degrees from the options", async () => {
        global.mockOptions = {
            scope: "cc7",
            degrees: 3,
            generations: 6,
            biological: true,
            adoptive: false,
            fillGaps: false,
        };
        await open();
        expect(document.getElementById("ncloudScope").value).toBe("cc7");
        expect(document.getElementById("ncloudAmount").textContent).toBe("3 degrees");
        expect(document.getElementById("ncloudAdopt").checked).toBe(false);
        expect(global.mockGetPeople.mock.calls[0][3]).toEqual(expect.objectContaining({ nuclear: 3 }));
    });

    it("says so when the API cannot be reached, and when there are no surnames", async () => {
        global.mockGetPeople = jest.fn(() => Promise.reject(new Error("offline")));
        await open();
        expect(status()).toMatch(/could not be reached/);
        global.mockGetPeople = jest.fn(() =>
            Promise.resolve(["", {}, { 1: person(1, "Private", { Name: "Private-1" }) }])
        );
        await open();
        expect(status()).toMatch(/No surnames could be found/);
    });

    describe("hovering and clicking a surname", () => {
        const over = async (surname) => {
            const rect = document.querySelector(`[data-surname="${surname}"] rect`);
            rect.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: 50, clientY: 50 }));
            await settle();
        };

        it("shows how many profiles it has, and lights up every copy of the name", async () => {
            await open();
            await over("CAVE");
            const tip = document.getElementById("ncloudTip");
            expect(tip.textContent).toContain("CAVE");
            expect(tip.textContent).toContain("2 profiles");
            expect(tip.style.opacity).toBe("1");
            expect(document.querySelectorAll('[data-surname="CAVE"].is-hot').length).toBe(
                document.querySelectorAll('[data-surname="CAVE"]').length
            );
            expect(document.getElementById("ncloudSvg").classList.contains("ncloud-hovering")).toBe(true);
            document
                .querySelector('[data-surname="CAVE"] rect')
                .dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
            expect(tip.style.opacity).toBe("0");
            expect(document.querySelector(".is-hot")).toBeNull();
        });

        it("says how many are family by adoption when some are", async () => {
            await open();
            await over("GANT");
            expect(document.getElementById("ncloudTip").textContent).toContain(
                "2 profiles (0 by birth, 2 by adoption)"
            );
        });

        it("lists the people on a click: full name, WikiTree ID, born and died, as links", async () => {
            await open();
            await click('[data-surname="CAVE"] rect');
            const list = document.getElementById("ncloudList");
            expect(list.hidden).toBe(false);
            expect(document.getElementById("ncloudListName").textContent).toBe("CAVE");
            expect(document.getElementById("ncloudListCount").textContent).toBe("2 profiles");
            const names = [...list.querySelectorAll("a.ncloud-name")];
            expect(names.map((a) => a.textContent)).toEqual(["Person 4 Cave", "Person 6 Cave"]); // oldest first
            expect([...list.querySelectorAll("a.ncloud-id")].map((a) => a.textContent)).toEqual(["Cave-4", "Cave-6"]);
            expect(names[0].getAttribute("href")).toBe("https://www.wikitree.com/wiki/Cave-4");
            expect(list.textContent).toContain("Born: 5 Apr 1804, Leeds, England");
            expect(list.textContent).toContain("Died: not recorded");
            expect(document.querySelectorAll('[data-surname="CAVE"].is-selected').length).toBeGreaterThan(0);
        });

        it("tags the adoptive relatives in the list", async () => {
            await open();
            await click('[data-surname="HALE"] rect');
            expect(document.getElementById("ncloudList").textContent).toContain("adoptive");
        });

        it("opens a card on a click on a name in the list, instead of leaving the page", async () => {
            await open();
            await click('[data-surname="CAVE"] rect');
            const link = document.querySelector("a.ncloud-name");
            const event = new MouseEvent("click", { bubbles: true, cancelable: true });
            link.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
            const card = document.getElementById("ncloudCard");
            expect(card.hidden).toBe(false);
            expect(card.querySelector("b").textContent).toBe("Person 4 Cave");
            expect(card.textContent).toContain("Born: 5 Apr 1804, Leeds, England");
            const openLink = card.querySelector("a");
            expect(openLink.getAttribute("href")).toBe("https://www.wikitree.com/wiki/Cave-4");
            expect(openLink.getAttribute("target")).toBe("_blank");
            // the ID link does the same, and closing it hides the card
            document
                .querySelector("a.ncloud-id")
                .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            expect(card.hidden).toBe(false);
            await click(".ncloud-card-close");
            expect(card.hidden).toBe(true);
        });

        it("lets a click with Ctrl or Cmd go to the profile as usual", async () => {
            await open();
            await click('[data-surname="CAVE"] rect');
            const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
            document.querySelector("a.ncloud-name").dispatchEvent(event);
            expect(event.defaultPrevented).toBe(false);
            expect(document.getElementById("ncloudCard").hidden).toBe(true);
        });

        it("keeps the list when ticking Biological and Adoptive if the surname is still there, and closes it if not", async () => {
            await open();
            await click('[data-surname="GANT"] rect');
            await change("#ncloudBio", false);
            expect(document.getElementById("ncloudList").hidden).toBe(false);
            await change("#ncloudBio", true);
            await change("#ncloudAdopt", false);
            expect(document.getElementById("ncloudList").hidden).toBe(true);
        });

        it("closes the list with its button, and Escape closes the card", async () => {
            await open();
            await click('[data-surname="CAVE"] rect');
            await click("#ncloudListClose");
            expect(document.getElementById("ncloudList").hidden).toBe(true);
            await click('[data-surname="CAVE"] rect');
            document
                .querySelector("a.ncloud-name")
                .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            expect(document.getElementById("ncloudCard").hidden).toBe(false);
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            expect(document.getElementById("ncloudCard").hidden).toBe(true);
            expect(document.querySelector(".ncloud-app")).not.toBeNull();
        });

        it("lists a surname from the keyboard", async () => {
            await open();
            document
                .querySelector('[data-surname="CAVE"][tabindex="0"]')
                .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            expect(document.getElementById("ncloudList").hidden).toBe(false);
        });
    });

    describe("first names and middle names", () => {
        const pick = async (kind) => {
            await change("#ncloudKind", kind);
        };

        it("offers surnames, first names, middle names and both, and starts on the one in the options", async () => {
            await open();
            expect([...document.getElementById("ncloudKind").options].map((o) => o.value)).toEqual([
                "surname",
                "first",
                "middle",
                "given",
            ]);
            expect(document.getElementById("ncloudKind").value).toBe("surname");
            global.mockOptions = { names: "first", scope: "ancestors", generations: 6, fillGaps: false };
            await open();
            expect(document.getElementById("ncloudKind").value).toBe("first");
            expect(distinctWords()).toEqual(["JOHN", "MARY", "WILLIAM"]);
        });

        it("counts each name in a first-name field separately, and does not ask the API again", async () => {
            await open();
            const calls = global.mockGetPeople.mock.calls.length;
            await pick("first");
            // people 1, 3, 5, 9 are "John William"; 2, 4, 6, 8 are "Mary" (Id 3 here is Hale, 5 Dunn, and so on)
            expect(distinctWords()).toEqual(["JOHN", "MARY", "WILLIAM"]);
            expect(global.mockGetPeople.mock.calls.length).toBe(calls);
            expect(status()).toMatch(/3 first names from 8 people/);
            await click('[data-surname="WILLIAM"] rect');
            expect(document.getElementById("ncloudListName").textContent).toBe("WILLIAM");
            expect(document.getElementById("ncloudListCount").textContent).toMatch(/^4 profiles/);
        });

        it("counts middle names from the middle name field, and both together without counting a name twice", async () => {
            await open();
            await pick("middle");
            expect(distinctWords()).toEqual(["ANN", "MARY"]);
            expect(status()).toMatch(/2 middle names from 1 person/);
            await pick("given");
            // Mary is Person 4's middle name too, and also several people's first name: each person once
            const mary = [...document.querySelectorAll('[data-surname="MARY"]')].length;
            expect(mary).toBeGreaterThan(0);
            await click('[data-surname="MARY"] rect');
            expect(document.getElementById("ncloudListCount").textContent).toMatch(/^4 profiles/);
        });

        it("says so when nobody has a middle name", async () => {
            global.mockTree = {
                1: person(1, "Robinson", { MiddleName: "" }),
                2: person(2, "Gant", { MiddleName: "" }),
            };
            await open();
            await pick("middle");
            expect(status()).toMatch(/No middle names could be found/);
            expect(document.getElementById("ncloudSaveAs").disabled).toBe(true);
        });

        it("closes the list of the old names when the kind of name changes", async () => {
            await open();
            await click('[data-surname="CAVE"] rect');
            expect(document.getElementById("ncloudList").hidden).toBe(false);
            await pick("first");
            expect(document.getElementById("ncloudList").hidden).toBe(true);
        });

        it("hovers with the right words, and names the PDF and files for the kind of name", async () => {
            await open();
            await pick("first");
            document
                .querySelector('[data-surname="MARY"] rect')
                .dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: 50, clientY: 50 }));
            expect(document.getElementById("ncloudTip").textContent).toContain("MARY");
            expect(status()).toMatch(/Hover a first name/);
            const saved = [];
            const original = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function () {
                saved.push(this.download);
            };
            await click("#ncloudSaveAs");
            await click("#ncloudSaveGo");
            await change('input[name="ncloudFormat"][value="pdf"]', true);
            await click("#ncloudSaveGo");
            HTMLAnchorElement.prototype.click = original;
            expect(saved).toEqual(["first-name-cloud-Robinson-1-800px.png", "first-name-cloud-Robinson-1.pdf"]);
            expect(global.mockPdfs[0]).toContain("First Name Cloud of Person 1 Robinson");
        });
    });

    describe("reach: a category or a WikiTree+ search", () => {
        const ids = () => Object.values(global.mockTree).map((p) => p.Id);
        beforeEach(() => {
            global.fetch = jest.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ response: { found: 3, profiles: ids().slice(0, 3) } }),
                })
            );
        });

        it("offers both, and asks for a name or a search instead of generations", async () => {
            await open();
            const scopes = [...document.getElementById("ncloudScope").options].map((o) => o.value);
            expect(scopes).toEqual(["ancestors", "cc7", "category", "search"]);
            expect(document.getElementById("ncloudQueryBox").hidden).toBe(true);
            await change("#ncloudScope", "category");
            expect(document.getElementById("ncloudQueryBox").hidden).toBe(false);
            expect(document.querySelector(".ncloud-stepper").hidden).toBe(true);
            expect(document.querySelector(".ncloud-show").hidden).toBe(true);
            expect(status()).toMatch(/Type the name of a category above and press Draw/);
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it("draws the people of a category when Draw is pressed, and does not ask again for the same one", async () => {
            await open();
            await change("#ncloudScope", "category");
            document.getElementById("ncloudQuery").value = "Mayflower Passengers";
            await click("#ncloudGo");
            expect(global.fetch.mock.calls[0][0]).toContain(encodeURIComponent("CategoryFull=Mayflower_Passengers"));
            expect(words().length).toBeGreaterThan(0);
            expect(status()).toMatch(/from 3 people \(A category: Mayflower Passengers\)/);
            await click("#ncloudGo");
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        it("draws on Enter, from a search, and says so when nobody is found", async () => {
            await open();
            await change("#ncloudScope", "search");
            global.fetch = jest.fn(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve({ response: { found: 0 } }) })
            );
            const input = document.getElementById("ncloudQuery");
            input.value = "Surname=Nobody";
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await settle();
            expect(global.fetch.mock.calls[0][0]).toContain(encodeURIComponent("Surname=Nobody"));
            expect(status()).toMatch(/Nobody was found in that search/);
        });

        it("says so when WikiTree+ cannot be reached", async () => {
            await open();
            await change("#ncloudScope", "category");
            global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 503 }));
            document.getElementById("ncloudQuery").value = "Foo";
            await click("#ncloudGo");
            expect(status()).toMatch(/could not be reached/);
        });

        it("opens on a category given in the options", async () => {
            global.mockOptions = { ...START, scope: "category", query: "Foo Bar" };
            await open();
            expect(document.getElementById("ncloudQuery").value).toBe("Foo Bar");
            expect(global.fetch.mock.calls[0][0]).toContain(encodeURIComponent("CategoryFull=Foo_Bar"));
            expect(words().length).toBeGreaterThan(0);
        });
    });

    describe("names that did not fit", () => {
        // five generations of ancestors with a surname each, in a small shape: there is room for only some of the names
        const smallShape = async () => {
            global.mockTree = {};
            for (let id = 1; id < 64; id++) {
                const parents = id < 32 ? { Father: id * 2, Mother: id * 2 + 1 } : {};
                const surname = `Family${String.fromCharCode(97 + (id % 26))}${"x".repeat(id % 7)}${id}`;
                global.mockTree[id] = { ...person(id, surname, parents), Spouses: {} };
            }
            global.mockOptions = { ...START, generations: 5, fillGaps: false };
            global.mockReadImage = jest.fn(() => Promise.resolve(pictureOf([30, 140, 40], { radius: 80 })));
            await open();
            await change("#ncloudShapeKind", "image");
            await chooseFile("small.png");
        };

        it("names a few of them in the note, and for more offers a list with how many profiles each has", async () => {
            await smallShape();
            const left = (status().match(/(\d+) rarer surnames? did not fit/) || [])[1];
            expect(Number(left)).toBeGreaterThan(3);
            expect(status()).not.toMatch(/did not fit:/); // too many to name in the note
            const button = document.querySelector("#ncloudStatus .ncloud-linkbutton");
            expect(button.textContent).toBe("See the list");
            expect(document.getElementById("ncloudUnseen").hidden).toBe(true);
            await click(".ncloud-linkbutton");
            const popup = document.getElementById("ncloudUnseen");
            expect(popup.hidden).toBe(false);
            expect(document.getElementById("ncloudUnseenTitle").textContent).toBe(`${left} rarer surnames did not fit`);
            const rows = [...popup.querySelectorAll("li")].map((li) => li.textContent);
            expect(rows).toHaveLength(Number(left));
            expect(rows[0]).toMatch(/\d+ profiles?$/);
        });

        it("closes with the x or the Esc key, and a click on a name opens the list of its people", async () => {
            await smallShape();
            await click(".ncloud-linkbutton");
            await click("#ncloudUnseenClose");
            expect(document.getElementById("ncloudUnseen").hidden).toBe(true);
            await click(".ncloud-linkbutton");
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            expect(document.getElementById("ncloudUnseen").hidden).toBe(true);
            await click(".ncloud-linkbutton");
            const name = document.querySelector(".ncloud-unseen-name");
            const surname = name.dataset.name;
            await click(".ncloud-unseen-name");
            expect(document.getElementById("ncloudUnseen").hidden).toBe(true);
            expect(document.getElementById("ncloudList").hidden).toBe(false);
            expect(document.getElementById("ncloudListName").textContent).toBe(surname);
        });

        it("has no list when every name fits", async () => {
            await open();
            expect(document.querySelector(".ncloud-linkbutton")).toBeNull();
            expect(status()).not.toMatch(/did not fit/);
        });
    });

    describe("the wide banner for a profile's background", () => {
        const sizes = () => [...document.getElementById("ncloudSize").options].map((o) => o.value);

        it("fills a wide, short frame with the names in the greens of the canopy on a pale green background", async () => {
            await open();
            await change("#ncloudShapeKind", "banner");
            const svg = document.getElementById("ncloudSvg");
            const [, , w, h] = svg.getAttribute("viewBox").split(" ").map(Number);
            expect(w / h).toBeGreaterThan(6);
            expect(document.querySelector(".ncloud-banner-bg").getAttribute("fill")).toBe("#e9f4e1");
            expect(document.querySelector(".ncloud-trunk")).toBeNull();
            expect(document.querySelector(".ncloud-crown")).toBeNull();
            const fills = new Set(
                [...document.querySelectorAll(".ncloud-word text")].map((t) => t.getAttribute("fill"))
            );
            expect(fills.size).toBeGreaterThan(1); // the canopy's several greens
            expect(document.getElementById("ncloudLook").disabled).toBe(true);
            expect(document.getElementById("ncloudBannerBox").hidden).toBe(false);
            expect(document.getElementById("ncloudBannerWordColor").hidden).toBe(true);
            expect(document.querySelector(".ncloud-stage").classList.contains("ncloud-banner")).toBe(true);
            // every name is placed, and no word is outside the frame
            document.querySelectorAll(".ncloud-word").forEach((g) => {
                const [, x, y] = g
                    .getAttribute("transform")
                    .match(/translate\(([-\d.]+) ([-\d.]+)\)/)
                    .map(Number);
                expect(x).toBeGreaterThan(0);
                expect(x).toBeLessThan(w);
                expect(y).toBeGreaterThan(0);
                expect(y).toBeLessThan(h);
            });
        });

        it("lets the member choose the background colour and one colour for every word", async () => {
            await open();
            await change("#ncloudShapeKind", "banner");
            await change("#ncloudBannerBackground", "#102030");
            expect(document.querySelector(".ncloud-banner-bg").getAttribute("fill")).toBe("#102030");
            await change("#ncloudBannerWords", "one");
            expect(document.getElementById("ncloudBannerWordColor").hidden).toBe(false);
            await change("#ncloudBannerWordColor", "#aabbcc");
            const fills = new Set(
                [...document.querySelectorAll(".ncloud-word text")].map((t) => t.getAttribute("fill"))
            );
            expect([...fills]).toEqual(["#aabbcc"]);
            await change("#ncloudBannerWords", "canopy");
            expect(document.getElementById("ncloudBannerWordColor").hidden).toBe(true);
        });

        it("offers wider sizes for the banner, with its own height, and goes back to the tree's", async () => {
            await open();
            expect(sizes()).toEqual(["small", "medium", "large", "custom"]);
            expect(document.getElementById("ncloudSize").value).toBe("small");
            expect(document.querySelector('#ncloudSize option[value="small"]').textContent).toMatch(/800 × 704 pixels/);
            await change("#ncloudShapeKind", "banner");
            expect(document.getElementById("ncloudSize").value).toBe("large"); // wide enough for most screens
            expect(document.querySelector('#ncloudSize option[value="large"]').textContent).toMatch(
                /2,560 × 400 pixels/
            );
            expect(document.querySelector('#ncloudSize option[value="small"]').textContent).toMatch(
                /1,280 × 200 pixels/
            );
            await change("#ncloudShapeKind", "tree");
            expect(document.getElementById("ncloudSize").value).toBe("small");
            expect(document.getElementById("ncloudLook").disabled).toBe(false);
            expect(document.querySelector(".ncloud-stage").classList.contains("ncloud-banner")).toBe(false);
        });

        it("saves a banner picture at the banner's size, drawn with its colours", async () => {
            await open();
            await change("#ncloudShapeKind", "banner");
            await click("#ncloudSaveAs");
            await click("#ncloudSaveGo");
            await settle();
            expect(global.mockBlobs.length).toBeGreaterThan(0);
            const saved = global.mockBlobs[global.mockBlobs.length - 1];
            expect(saved.width).toBe(2560);
            expect(saved.height).toBe(400);
        });
    });

    describe("a photograph as the shape", () => {
        it("fills the whole picture, with the picture showing behind the words, and lets the member cut a background instead", async () => {
            global.mockReadImage = jest.fn(() => Promise.resolve(pictureOf([0, 0, 0], { photo: true })));
            await open();
            await change("#ncloudShapeKind", "image");
            await chooseFile("forest.jpg");
            expect(document.getElementById("ncloudWhole").checked).toBe(true);
            expect(document.getElementById("ncloudWholeLabel").hidden).toBe(false);
            expect(document.getElementById("ncloudSense").disabled).toBe(true);
            expect(Number(document.querySelector(".ncloud-backdrop").getAttribute("opacity"))).toBeGreaterThan(0.3);
            expect(words().length).toBeGreaterThan(5);
            await change("#ncloudWhole", false);
            expect(document.getElementById("ncloudWhole").checked).toBe(false);
            expect(Number(document.querySelector(".ncloud-backdrop")?.getAttribute("opacity") ?? 0)).toBeLessThan(0.3);
        });

        it("does not fill the whole of a picture that has a plain background", async () => {
            await open();
            await change("#ncloudShapeKind", "image");
            await chooseFile("disc.png");
            expect(document.getElementById("ncloudWhole").checked).toBe(false);
            expect(document.getElementById("ncloudSense").disabled).toBe(false);
        });

        it("never fills the whole of the pictures that come with the view", async () => {
            await open();
            await change("#ncloudShapeKind", "wikitree-heart");
            expect(document.getElementById("ncloudWhole").checked).toBe(false);
        });
    });

    describe("fill the gaps", () => {
        it("is off unless asked for", async () => {
            global.mockOptions = { scope: "ancestors", generations: 6, degrees: 7, imagesUrl: START.imagesUrl };
            await open();
            expect(document.getElementById("ncloudFill").checked).toBe(false);
            const once = words().length;
            await change("#ncloudFill", true);
            expect(words().length).toBeGreaterThanOrEqual(once);
        });
    });

    describe("a name shown more than once", () => {
        const hover = async (surname) => {
            const group = [...document.querySelectorAll(".ncloud-word")].find((g) => g.dataset.surname === surname);
            group.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: 50, clientY: 50 }));
            await settle();
        };

        it("tells, when hovered, that the small copies fill the gaps", async () => {
            global.mockOptions = { ...START, fillGaps: true };
            await open();
            const repeated = distinctWords().find((name) => words().filter((w) => w === name).length > 1);
            expect(repeated).toBeTruthy();
            await hover(repeated);
            expect(document.getElementById("ncloudTip").textContent).toMatch(/shown \d+ times.*untick Fill the gaps/);
        });

        it("says nothing of the kind for a name shown once", async () => {
            await open(); // Fill the gaps is off: each name once
            await hover(distinctWords()[0]);
            expect(document.getElementById("ncloudTip").textContent).not.toMatch(/times/);
        });
    });

    describe("look: shaded or flat", () => {
        it("offers both, starts on the one in the options, and redraws without asking the API again", async () => {
            global.mockOptions = { ...START, fillGaps: true };
            await open();
            const look = document.getElementById("ncloudLook");
            expect([...look.options].map((o) => o.value)).toEqual(["shaded", "flat", "outlined"]);
            expect(look.value).toBe("shaded");
            expect(document.querySelector(".ncloud-ground")).not.toBeNull();
            const shadedWords = words().length;
            const calls = global.mockGetPeople.mock.calls.length;
            await change("#ncloudLook", "flat");
            // the flat look: solid colours, with nothing shaded, no bark, no ground, no shadow
            expect(document.querySelector(".ncloud-crown").getAttribute("fill")).toBe("#d4ecd4");
            expect(document.querySelector(".ncloud-trunk").getAttribute("fill")).toBe("#e9dbc2");
            ["ground", "bark", "shadow", "inner"].forEach((part) =>
                expect(document.querySelector(`.ncloud-${part}`)).toBeNull()
            );
            expect(document.querySelectorAll("radialGradient").length).toBe(0);
            expect(words().length).toBeGreaterThan(shadedWords); // and the words are packed tighter
            expect(global.mockGetPeople.mock.calls.length).toBe(calls);
            await change("#ncloudLook", "shaded");
            expect(document.querySelector(".ncloud-ground")).not.toBeNull();
        });

        it("draws the outlined look with a dark outline round each puff of leaves and the trunk", async () => {
            await open();
            await change("#ncloudLook", "outlined");
            expect(document.querySelector(".ncloud-trunk-outline")).not.toBeNull();
            const puffs = document.querySelectorAll(".ncloud-crown");
            expect(puffs.length).toBeGreaterThan(3);
            puffs.forEach((p) => expect(p.getAttribute("stroke")).toBe("#27481f"));
            expect(document.querySelector(".ncloud-ground")).toBeNull();
            expect(words().length).toBeGreaterThan(0);
        });

        it("starts on flat when the options say so", async () => {
            global.mockOptions = { ...START, look: "flat" };
            await open();
            expect(document.getElementById("ncloudLook").value).toBe("flat");
            expect(document.querySelector(".ncloud-ground")).toBeNull();
        });
    });

    describe("shape: an oak, or a picture of your own", () => {
        beforeEach(() => {
            global.mockOptions = { ...START, fillGaps: true }; // the words fill the shape, so there are plenty to look at
        });

        it("offers an oak or a picture, and shows the picture controls only for a picture", async () => {
            await open();
            expect([...document.getElementById("ncloudShapeKind").options].map((o) => o.value)).toEqual([
                "tree",
                "wikitree-logo",
                "wikitree-heart",
                "oak-picture",
                "image",
                "banner",
            ]);
            expect([...document.getElementById("ncloudShapeKind").options].map((o) => o.textContent)).toEqual([
                "Oak tree (drawn)",
                "WikiTree logo",
                "WikiTree heart",
                "Oak tree (picture)",
                "My picture",
                "Wide banner (profile background)",
            ]);
            expect(chosenShape()).toBe("tree");
            expect(document.getElementById("ncloudChoose").hidden).toBe(true);
            expect(document.getElementById("ncloudSenseLabel").hidden).toBe(true);
        });

        it("opens the file chooser when My picture is picked and there is no picture yet", async () => {
            await open();
            const input = document.getElementById("ncloudFile");
            input.click = jest.fn();
            await change("#ncloudShapeKind", "image");
            expect(input.click).toHaveBeenCalledTimes(1);
            expect(global.mockReadImage).not.toHaveBeenCalled();
        });

        it("shows the Choose picture button and says to click it, for browsers (Safari) that block the chooser opened from a menu", async () => {
            await open();
            const input = document.getElementById("ncloudFile");
            input.click = jest.fn(); // as if the browser had not opened it
            await change("#ncloudShapeKind", "image");
            expect(chosenShape()).toBe("image");
            expect(document.getElementById("ncloudChoose").hidden).toBe(false);
            expect(status()).toMatch(/Click Choose picture/);
            expect(document.querySelector(".ncloud-trunk")).not.toBeNull(); // the oak stays until there is a picture
            await click("#ncloudChoose");
            expect(input.click).toHaveBeenCalledTimes(2);
            await chooseFile("disc.png");
            expect(document.querySelector(".ncloud-backdrop")).not.toBeNull();
        });

        it("fills the picture's shape with the words, in the picture's colours, with the picture faintly behind", async () => {
            await open();
            await change("#ncloudShapeKind", "image");
            await chooseFile("disc.png");
            expect(global.mockReadImage).toHaveBeenCalledTimes(1);
            expect(chosenShape()).toBe("image");
            expect(document.getElementById("ncloudChoose").hidden).toBe(false);
            expect(document.getElementById("ncloudSenseLabel").hidden).toBe(false);
            expect(document.getElementById("ncloudChoose").title).toMatch(/disc\.png/);
            // no oak: the picture is the shape, and it is shown faintly behind the words
            expect(document.querySelector(".ncloud-trunk")).toBeNull();
            expect(document.querySelector(".ncloud-crown")).toBeNull();
            const backdrop = document.querySelector(".ncloud-backdrop");
            expect(backdrop.getAttribute("href")).toMatch(/^data:image\/png/);
            expect(Number(backdrop.getAttribute("opacity"))).toBeLessThan(0.4);
            // every word is a green, the colour of the picture
            const fills = [...document.querySelectorAll(".ncloud-word text")].map((t) => t.getAttribute("fill"));
            expect(fills.length).toBeGreaterThan(10);
            fills.forEach((hex) => {
                const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
                expect(g).toBeGreaterThan(r);
                expect(g).toBeGreaterThan(b);
            });
        });

        describe("pictures that come with it", () => {
            it("loads one from the view's own folder, fills its shape, and shows the picture behind", async () => {
                await open();
                await change("#ncloudShapeKind", "wikitree-logo");
                expect(global.mockReadImageUrl).toHaveBeenCalledTimes(1);
                expect(global.mockReadImageUrl).toHaveBeenCalledWith(
                    "https://example.test/views/nameCloud/images/wikitree-logo.png"
                );
                expect(global.mockReadImage).not.toHaveBeenCalled(); // not the file reader
                expect(document.getElementById("ncloudShapeKind").value).toBe("wikitree-logo");
                expect(document.querySelector(".ncloud-backdrop")).not.toBeNull();
                expect(document.querySelector(".ncloud-trunk")).toBeNull();
                expect(words().length).toBeGreaterThan(20);
                // there is nothing to choose, so no Choose picture button; the cut-out and white controls are there
                expect(document.getElementById("ncloudChoose").hidden).toBe(true);
                expect(document.getElementById("ncloudSenseLabel").hidden).toBe(false);
                expect(document.getElementById("ncloudWhiteLabel").hidden).toBe(false);
            });

            it("leaves the white of the logo and the heart empty, and the oak picture's not", async () => {
                await open();
                await change("#ncloudShapeKind", "wikitree-logo");
                expect(document.getElementById("ncloudWhite").checked).toBe(true);
                await change("#ncloudShapeKind", "wikitree-heart");
                expect(document.getElementById("ncloudWhite").checked).toBe(true);
                await change("#ncloudShapeKind", "oak-picture");
                expect(document.getElementById("ncloudWhite").checked).toBe(false);
                expect(global.mockReadImageUrl.mock.calls.map((c) => c[0].split("/").pop())).toEqual([
                    "wikitree-logo.png",
                    "wikitree-heart.png",
                    "oak-tree.jpg",
                ]);
            });

            it("draws again when white is left empty or filled, without loading the picture again", async () => {
                await open();
                await change("#ncloudShapeKind", "wikitree-logo");
                const before = document.querySelector(".ncloud-word");
                await change("#ncloudWhite", false);
                expect(document.querySelector(".ncloud-word")).not.toBe(before);
                expect(global.mockReadImageUrl).toHaveBeenCalledTimes(1);
            });

            it("keeps a picture once loaded, and keeps the member's own picture while a built-in one is used", async () => {
                await open();
                await change("#ncloudShapeKind", "image");
                await chooseFile("mine.png");
                await change("#ncloudShapeKind", "wikitree-heart");
                await change("#ncloudShapeKind", "image");
                expect(global.mockReadImage).toHaveBeenCalledTimes(1); // mine is not read again
                expect(document.getElementById("ncloudChoose").hidden).toBe(false);
                expect(document.getElementById("ncloudChoose").title).toMatch(/mine\.png/);
                expect(document.getElementById("ncloudWhite").checked).toBe(false);
                await change("#ncloudShapeKind", "wikitree-heart");
                expect(global.mockReadImageUrl).toHaveBeenCalledTimes(1); // nor the heart
            });

            it("says so and stays on what was showing when a picture will not load", async () => {
                global.mockReadImageUrl = jest.fn(() => Promise.reject(new Error("That picture could not be opened.")));
                await open();
                await change("#ncloudShapeKind", "wikitree-logo");
                expect(status()).toMatch(/could not be opened/);
                expect(document.getElementById("ncloudShapeKind").value).toBe("tree");
                expect(document.querySelector(".ncloud-trunk")).not.toBeNull();
            });
        });

        it("keeps hovering, the list and the card working in a picture's shape", async () => {
            await open();
            await change("#ncloudShapeKind", "image");
            await chooseFile();
            await click('[data-surname="CAVE"] rect');
            expect(document.getElementById("ncloudList").hidden).toBe(false);
            expect(document.getElementById("ncloudListName").textContent).toBe("CAVE");
            document
                .querySelector("a.ncloud-name")
                .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            expect(document.getElementById("ncloudCard").hidden).toBe(false);
        });

        it("works in the flat look too, and goes back to the oak", async () => {
            await open();
            await change("#ncloudShapeKind", "image");
            await chooseFile();
            await change("#ncloudLook", "flat");
            expect(document.querySelector(".ncloud-backdrop")).not.toBeNull();
            expect(words().length).toBeGreaterThan(20);
            await change("#ncloudShapeKind", "tree");
            expect(document.querySelector(".ncloud-backdrop")).toBeNull();
            expect(document.querySelector(".ncloud-trunk")).not.toBeNull();
            expect(document.getElementById("ncloudChoose").hidden).toBe(true);
            // and back to the picture without choosing it again
            await change("#ncloudShapeKind", "image");
            expect(global.mockReadImage).toHaveBeenCalledTimes(1);
            expect(document.querySelector(".ncloud-backdrop")).not.toBeNull();
        });

        it("cuts out more or less of the picture with the slider, without reading it again", async () => {
            await open();
            await change("#ncloudShapeKind", "image");
            await chooseFile();
            const before = document.querySelector(".ncloud-word");
            await change("#ncloudSense", "120");
            expect(document.querySelector(".ncloud-word")).not.toBe(before); // drawn again
            expect(global.mockReadImage).toHaveBeenCalledTimes(1);
        });

        it("keeps the Shuffle button working for a picture, arranging the words afresh", async () => {
            await open();
            await change("#ncloudShapeKind", "image");
            await chooseFile();
            const arrangement = () =>
                [...document.querySelectorAll(".ncloud-word")].map((g) => g.getAttribute("transform")).join("|");
            const before = arrangement();
            await click("#ncloudShuffle");
            expect(arrangement()).not.toBe(before);
            expect(document.querySelector(".ncloud-backdrop")).not.toBeNull();
        });

        it("shows the oak and says so when no shape can be found in the picture", async () => {
            global.mockReadImage = jest.fn(() => Promise.resolve(pictureOf([240, 240, 240], { disc: false })));
            await open();
            await change("#ncloudShapeKind", "image");
            await chooseFile("blank.png");
            expect(status()).toMatch(/No shape could be found in that picture, so the oak is shown/);
            expect(chosenShape()).toBe("tree");
            expect(document.querySelector(".ncloud-trunk")).not.toBeNull();
            expect(document.getElementById("ncloudChoose").hidden).toBe(true);
        });

        it("says why a picture could not be used, and stays on what it was showing", async () => {
            global.mockReadImage = jest.fn(() => Promise.reject(new Error("That file is not a picture.")));
            await open();
            await change("#ncloudShapeKind", "image");
            await chooseFile("notes.pdf");
            expect(status()).toMatch(/That file is not a picture/);
            expect(chosenShape()).toBe("tree");
            expect(document.querySelector(".ncloud-trunk")).not.toBeNull();
            // a bad second choice keeps the first picture
            global.mockReadImage = jest.fn(() => Promise.resolve(pictureOf([30, 140, 40])));
            await change("#ncloudShapeKind", "image");
            await chooseFile("good.png");
            global.mockReadImage = jest.fn(() => Promise.reject(new Error("That picture could not be opened.")));
            await click("#ncloudChoose");
            await chooseFile("bad.png");
            expect(chosenShape()).toBe("image");
            expect(document.querySelector(".ncloud-backdrop")).not.toBeNull();
        });

        it("goes back to the oak when the file chooser is closed without a choice", async () => {
            await open();
            const input = document.getElementById("ncloudFile");
            input.click = jest.fn();
            await change("#ncloudShapeKind", "image");
            input.dispatchEvent(new Event("cancel"));
            expect(chosenShape()).toBe("tree");
        });

        it("saves a picture's shape as a PNG and a PDF like the oak", async () => {
            await open();
            await change("#ncloudShapeKind", "image");
            await chooseFile();
            const saved = [];
            const original = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function () {
                saved.push(this.download);
            };
            await click("#ncloudSaveAs");
            await click("#ncloudSaveGo");
            await change('input[name="ncloudFormat"][value="pdf"]', true);
            await click("#ncloudSaveGo");
            HTMLAnchorElement.prototype.click = original;
            expect(saved).toEqual(["surname-cloud-Robinson-1-800px.png", "surname-cloud-Robinson-1.pdf"]);
            expect(global.mockBlobs.length).toBeGreaterThan(0);
        });
    });

    describe("zoom", () => {
        const transform = () => document.querySelector(".ncloud-viewport").getAttribute("transform");
        it("zooms in and out with the buttons and resets", async () => {
            await open();
            await click("#ncloudZoomIn");
            expect(transform()).toMatch(/scale\(1\.6/);
            await click("#ncloudZoomOut");
            expect(transform()).toMatch(/scale\(1\)/);
            await click("#ncloudZoomIn");
            await click("#ncloudZoomReset");
            expect(transform()).toBe("translate(0 0) scale(1)");
        });
    });

    it("fills the window with Full screen, and Escape leaves it", async () => {
        await open();
        const app = document.querySelector(".ncloud-app");
        await click("#ncloudFull");
        expect(app.classList.contains("ncloud-full")).toBe(true);
        expect(document.getElementById("ncloudFull").textContent).toBe("Leave full screen");
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(app.classList.contains("ncloud-full")).toBe(false);
        expect(document.getElementById("ncloudFull").textContent).toBe("Full screen");
    });

    it("makes a different tree, as well as a different arrangement, with Shuffle", async () => {
        await open();
        const shape = () => document.querySelector(".ncloud-trunk").getAttribute("d");
        const before = shape();
        await click("#ncloudShuffle");
        expect(shape()).not.toBe(before);
    });

    it("sets the words at different angles", async () => {
        await open();
        const turns = [...document.querySelectorAll(".ncloud-word")].map(
            (g) => g.getAttribute("transform").match(/rotate\(([-\d.]+)\)/)[1]
        );
        expect(new Set(turns).size).toBeGreaterThan(2);
    });

    describe("saving a picture or PDF (optional)", () => {
        const saveClicks = () => {
            const saved = [];
            const original = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function () {
                saved.push(this.download);
            };
            return { saved, restore: () => (HTMLAnchorElement.prototype.click = original) };
        };

        it("asks what file type, and what size for a picture, before saving", async () => {
            await open();
            const panel = document.getElementById("ncloudSavePanel");
            expect(panel.hidden).toBe(true);
            await click("#ncloudSaveAs");
            expect(panel.hidden).toBe(false);
            expect([...document.querySelectorAll('input[name="ncloudFormat"]')].map((r) => r.value)).toEqual([
                "png",
                "jpg",
                "pdf",
            ]);
            const size = document.getElementById("ncloudSize");
            expect([...size.options].map((o) => o.value)).toEqual(["small", "medium", "large", "custom"]);
            expect(size.value).toBe("small");
            expect(document.getElementById("ncloudSizeNote").textContent).toBe("The picture will be 800 × 704 pixels.");
            await click("#ncloudSaveCancel");
            expect(panel.hidden).toBe(true);
        });

        it("saves a PNG or JPG at the size chosen, named for the profile and the size", async () => {
            await open();
            const { saved, restore } = saveClicks();
            await click("#ncloudSaveAs");
            await click("#ncloudSaveGo");
            expect(saved).toEqual(["surname-cloud-Robinson-1-800px.png"]);
            expect(global.mockBlobs.pop()).toMatchObject({ type: "image/png", width: 800, height: 704 });
            await click("#ncloudSaveAs");
            await change('input[name="ncloudFormat"][value="jpg"]', true);
            await change("#ncloudSize", "large");
            await click("#ncloudSaveGo");
            restore();
            expect(saved[1]).toBe("surname-cloud-Robinson-1-3200px.jpg");
            expect(global.mockBlobs.pop()).toMatchObject({ type: "image/jpeg", width: 3200, height: 2816 });
        });

        it("takes a custom width, and will not save one that is out of range", async () => {
            await open();
            await click("#ncloudSaveAs");
            await change("#ncloudSize", "custom");
            expect(document.getElementById("ncloudCustomLabel").hidden).toBe(false);
            await change("#ncloudCustom", "12");
            expect(document.getElementById("ncloudSaveGo").disabled).toBe(true);
            expect(document.getElementById("ncloudSizeNote").textContent).toMatch(/Enter a width from 200 to 6,000/);
            await change("#ncloudCustom", "2500");
            expect(document.getElementById("ncloudSaveGo").disabled).toBe(false);
            expect(document.getElementById("ncloudSizeNote").textContent).toBe(
                "The picture will be 2,500 × 2,200 pixels."
            );
        });

        it("saves a PDF without asking for a size, but asks for the paper", async () => {
            await open();
            const { saved, restore } = saveClicks();
            await click("#ncloudSaveAs");
            await change('input[name="ncloudFormat"][value="pdf"]', true);
            expect(document.getElementById("ncloudSizeRow").hidden).toBe(true);
            expect(document.getElementById("ncloudPaperRow").hidden).toBe(false);
            await click("#ncloudSaveGo");
            restore();
            expect(saved).toEqual(["surname-cloud-Robinson-1.pdf"]);
            expect(global.mockPdfs[0]).toContain("%PDF-1.4");
            expect(global.mockPdfs[0]).toContain("Surname Cloud of Person 1 Robinson");
            expect(status()).toBe("Saved as PDF.");
        });

        it("says so when the browser cannot make a picture that big", async () => {
            await open();
            await click("#ncloudSaveAs");
            global.mockCanvasFails = true;
            await click("#ncloudSaveGo");
            global.mockCanvasFails = false;
            expect(status()).toMatch(/could not be made.*smaller/);
            expect(document.getElementById("ncloudSavePanel").hidden).toBe(false);
        });
    });
});
