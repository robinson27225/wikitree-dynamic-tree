import { Buffer } from "buffer";

jest.mock("../../views/surnameTree/surname_tree_image.js", () => ({
    ...jest.requireActual("../../views/surnameTree/surname_tree_image.js"),
    readImageFile: (...args) => global.mockReadImage(...args),
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

const APP = "../../views/surnameTree/surname_tree_app.js";
const START = { scope: "ancestors", generations: 6, degrees: 7, fillGaps: false };
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
const status = () => document.getElementById("suTreeStatus").textContent;
const words = () => [...document.querySelectorAll(".sutree-word")].map((g) => g.dataset.surname);
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
function pictureOf(rgb, { disc = true } = {}) {
    const W = 1000;
    const H = 880;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) data.set([255, 255, 255, 255], i * 4);
    if (disc) {
        for (let y = 140; y < 740; y++) {
            for (let x = 200; x < 800; x++)
                if ((x - 500) ** 2 + (y - 440) ** 2 <= 300 * 300) data.set([...rgb, 255], (y * W + x) * 4);
        }
    }
    return { pixels: { width: W, height: H, data }, rect: { x: 0, y: 0, w: W, h: H } };
}
const chooseFile = async (name = "disc.png") => {
    const input = document.getElementById("suTreeFile");
    Object.defineProperty(input, "files", { value: [{ name, type: "image/png", size: 100 }], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
};
const chosenShape = () => document.getElementById("suTreeShapeKind").value;

const open = async () => {
    await loadFeature();
    await openView();
};

describe("Surname Tree", () => {
    it("opens with ancestors, biological and adoptive together, as the options say", async () => {
        await open();
        expect(document.getElementById("suTreeScope").value).toBe("ancestors");
        expect(document.getElementById("suTreeBio").checked).toBe(true);
        expect(document.getElementById("suTreeAdopt").checked).toBe(true);
        expect(document.getElementById("suTreeAmount").textContent).toBe("6 generations");
        expect(distinctWords()).toEqual(["CAVE", "DUNN", "GANT", "HALE", "MOSS", "ROBINSON"]);
        expect(status()).toMatch(/6 surnames from 8 people \(Ancestors, 6 generations, biological and adoptive\)/);
    });

    it("shows biological relatives, adoptive ones, or both, and keeps one ticked", async () => {
        await open();
        await change("#suTreeAdopt", false);
        expect(distinctWords()).toEqual(["CAVE", "DUNN", "ROBINSON"]);
        expect(status()).toMatch(/biological only/);
        await change("#suTreeAdopt", true);
        await change("#suTreeBio", false);
        expect(distinctWords()).toEqual(["GANT", "HALE", "MOSS"]);
        expect(status()).toMatch(/adoptive only/);
        // the last one cannot be taken off
        await change("#suTreeAdopt", false);
        expect(document.getElementById("suTreeAdopt").checked).toBe(true);
        expect(status()).toMatch(/Keep at least one/);
        expect(distinctWords()).toEqual(["GANT", "HALE", "MOSS"]);
    });

    it("does not ask the API again when the tick boxes change", async () => {
        await open();
        const calls = global.mockGetPeople.mock.calls.length;
        await change("#suTreeAdopt", false);
        await change("#suTreeAdopt", true);
        expect(global.mockGetPeople.mock.calls.length).toBe(calls);
    });

    it("says so when there is no adoptive family", async () => {
        global.mockTree = { 1: person(1, "Robinson", { Father: 4, DataStatus: { Father: 20 } }), 4: person(4, "Cave") };
        await open();
        await change("#suTreeBio", false);
        expect(status()).toMatch(/No adoptive connections were found/);
        expect(document.getElementById("suTreeSaveAs").disabled).toBe(true);
    });

    it("goes further out or back in with + and -, within the limits, without asking again for a number it has had", async () => {
        await open();
        const more = document.getElementById("suTreeMore");
        const fewer = document.getElementById("suTreeFewer");
        await click("#suTreeMore");
        expect(document.getElementById("suTreeAmount").textContent).toBe("7 generations");
        const calls = global.mockGetPeople.mock.calls.length;
        await click("#suTreeFewer");
        expect(document.getElementById("suTreeAmount").textContent).toBe("6 generations");
        expect(global.mockGetPeople.mock.calls.length).toBe(calls);
        for (let i = 0; i < 6; i++) await click("#suTreeFewer");
        expect(document.getElementById("suTreeAmount").textContent).toBe("2 generations");
        expect(fewer.disabled).toBe(true);
        expect(more.disabled).toBe(false);
    });

    it("switches to CC7, with degrees to add or take away, and the people nearby", async () => {
        await open();
        await change("#suTreeScope", "cc7");
        expect(document.getElementById("suTreeAmount").textContent).toBe("7 degrees");
        expect(global.mockGetPeople.mock.calls.some((c) => c[3] && c[3].nuclear === 7)).toBe(true);
        expect(status()).toMatch(/\(CC7 \(everyone nearby\), 7 degrees, biological and adoptive\)/);
        await change("#suTreeAdopt", false);
        expect(distinctWords()).toEqual(["CAVE", "DUNN", "ROBINSON"]);
        await click("#suTreeMore");
        expect(document.getElementById("suTreeAmount").textContent).toBe("8 degrees");
        expect(global.mockGetPeople.mock.calls.some((c) => c[3] && c[3].nuclear === 8)).toBe(true);
        for (let i = 0; i < 2; i++) await click("#suTreeMore");
        expect(document.getElementById("suTreeAmount").textContent).toBe("10 degrees");
        expect(document.getElementById("suTreeMore").disabled).toBe(true);
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
        expect(document.getElementById("suTreeScope").value).toBe("cc7");
        expect(document.getElementById("suTreeAmount").textContent).toBe("3 degrees");
        expect(document.getElementById("suTreeAdopt").checked).toBe(false);
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
            const tip = document.getElementById("suTreeTip");
            expect(tip.textContent).toContain("CAVE");
            expect(tip.textContent).toContain("2 profiles");
            expect(tip.style.opacity).toBe("1");
            expect(document.querySelectorAll('[data-surname="CAVE"].is-hot').length).toBe(
                document.querySelectorAll('[data-surname="CAVE"]').length
            );
            expect(document.getElementById("suTreeSvg").classList.contains("sutree-hovering")).toBe(true);
            document
                .querySelector('[data-surname="CAVE"] rect')
                .dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
            expect(tip.style.opacity).toBe("0");
            expect(document.querySelector(".is-hot")).toBeNull();
        });

        it("says how many are family by adoption when some are", async () => {
            await open();
            await over("GANT");
            expect(document.getElementById("suTreeTip").textContent).toContain(
                "2 profiles (0 by birth, 2 by adoption)"
            );
        });

        it("lists the people on a click: full name, WikiTree ID, born and died, as links", async () => {
            await open();
            await click('[data-surname="CAVE"] rect');
            const list = document.getElementById("suTreeList");
            expect(list.hidden).toBe(false);
            expect(document.getElementById("suTreeListName").textContent).toBe("CAVE");
            expect(document.getElementById("suTreeListCount").textContent).toBe("2 profiles");
            const names = [...list.querySelectorAll("a.sutree-name")];
            expect(names.map((a) => a.textContent)).toEqual(["Person 4 Cave", "Person 6 Cave"]); // oldest first
            expect([...list.querySelectorAll("a.sutree-id")].map((a) => a.textContent)).toEqual(["Cave-4", "Cave-6"]);
            expect(names[0].getAttribute("href")).toBe("https://www.wikitree.com/wiki/Cave-4");
            expect(list.textContent).toContain("Born: 5 Apr 1804, Leeds, England");
            expect(list.textContent).toContain("Died: not recorded");
            expect(document.querySelectorAll('[data-surname="CAVE"].is-selected').length).toBeGreaterThan(0);
        });

        it("tags the adoptive relatives in the list", async () => {
            await open();
            await click('[data-surname="HALE"] rect');
            expect(document.getElementById("suTreeList").textContent).toContain("adoptive");
        });

        it("opens a card on a click on a name in the list, instead of leaving the page", async () => {
            await open();
            await click('[data-surname="CAVE"] rect');
            const link = document.querySelector("a.sutree-name");
            const event = new MouseEvent("click", { bubbles: true, cancelable: true });
            link.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
            const card = document.getElementById("suTreeCard");
            expect(card.hidden).toBe(false);
            expect(card.querySelector("b").textContent).toBe("Person 4 Cave");
            expect(card.textContent).toContain("Born: 5 Apr 1804, Leeds, England");
            const openLink = card.querySelector("a");
            expect(openLink.getAttribute("href")).toBe("https://www.wikitree.com/wiki/Cave-4");
            expect(openLink.getAttribute("target")).toBe("_blank");
            // the ID link does the same, and closing it hides the card
            document
                .querySelector("a.sutree-id")
                .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            expect(card.hidden).toBe(false);
            await click(".sutree-card-close");
            expect(card.hidden).toBe(true);
        });

        it("lets a click with Ctrl or Cmd go to the profile as usual", async () => {
            await open();
            await click('[data-surname="CAVE"] rect');
            const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
            document.querySelector("a.sutree-name").dispatchEvent(event);
            expect(event.defaultPrevented).toBe(false);
            expect(document.getElementById("suTreeCard").hidden).toBe(true);
        });

        it("keeps the list when ticking Biological and Adoptive if the surname is still there, and closes it if not", async () => {
            await open();
            await click('[data-surname="GANT"] rect');
            await change("#suTreeBio", false);
            expect(document.getElementById("suTreeList").hidden).toBe(false);
            await change("#suTreeBio", true);
            await change("#suTreeAdopt", false);
            expect(document.getElementById("suTreeList").hidden).toBe(true);
        });

        it("closes the list with its button, and Escape closes the card", async () => {
            await open();
            await click('[data-surname="CAVE"] rect');
            await click("#suTreeListClose");
            expect(document.getElementById("suTreeList").hidden).toBe(true);
            await click('[data-surname="CAVE"] rect');
            document
                .querySelector("a.sutree-name")
                .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            expect(document.getElementById("suTreeCard").hidden).toBe(false);
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            expect(document.getElementById("suTreeCard").hidden).toBe(true);
            expect(document.querySelector(".sutree-app")).not.toBeNull();
        });

        it("lists a surname from the keyboard", async () => {
            await open();
            document
                .querySelector('[data-surname="CAVE"][tabindex="0"]')
                .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            expect(document.getElementById("suTreeList").hidden).toBe(false);
        });
    });

    describe("first names and middle names", () => {
        const pick = async (kind) => {
            await change("#suTreeKind", kind);
        };

        it("offers surnames, first names, middle names and both, and starts on the one in the options", async () => {
            await open();
            expect([...document.getElementById("suTreeKind").options].map((o) => o.value)).toEqual([
                "surname",
                "first",
                "middle",
                "given",
            ]);
            expect(document.getElementById("suTreeKind").value).toBe("surname");
            global.mockOptions = { names: "first", scope: "ancestors", generations: 6, fillGaps: false };
            await open();
            expect(document.getElementById("suTreeKind").value).toBe("first");
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
            expect(document.getElementById("suTreeListName").textContent).toBe("WILLIAM");
            expect(document.getElementById("suTreeListCount").textContent).toMatch(/^4 profiles/);
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
            expect(document.getElementById("suTreeListCount").textContent).toMatch(/^4 profiles/);
        });

        it("says so when nobody has a middle name", async () => {
            global.mockTree = {
                1: person(1, "Robinson", { MiddleName: "" }),
                2: person(2, "Gant", { MiddleName: "" }),
            };
            await open();
            await pick("middle");
            expect(status()).toMatch(/No middle names could be found/);
            expect(document.getElementById("suTreeSaveAs").disabled).toBe(true);
        });

        it("closes the list of the old names when the kind of name changes", async () => {
            await open();
            await click('[data-surname="CAVE"] rect');
            expect(document.getElementById("suTreeList").hidden).toBe(false);
            await pick("first");
            expect(document.getElementById("suTreeList").hidden).toBe(true);
        });

        it("hovers with the right words, and names the PDF and files for the kind of name", async () => {
            await open();
            await pick("first");
            document
                .querySelector('[data-surname="MARY"] rect')
                .dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: 50, clientY: 50 }));
            expect(document.getElementById("suTreeTip").textContent).toContain("MARY");
            expect(status()).toMatch(/Hover a first name/);
            const saved = [];
            const original = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function () {
                saved.push(this.download);
            };
            await click("#suTreeSaveAs");
            await click("#suTreeSaveGo");
            await change('input[name="suTreeFormat"][value="pdf"]', true);
            await click("#suTreeSaveGo");
            HTMLAnchorElement.prototype.click = original;
            expect(saved).toEqual(["first-name-tree-Robinson-1-1600px.png", "first-name-tree-Robinson-1.pdf"]);
            expect(global.mockPdfs[0]).toContain("First Name Tree of Person 1 Robinson");
        });
    });

    describe("look: shaded or flat", () => {
        it("offers both, starts on the one in the options, and redraws without asking the API again", async () => {
            global.mockOptions = { ...START, fillGaps: true };
            await open();
            const look = document.getElementById("suTreeLook");
            expect([...look.options].map((o) => o.value)).toEqual(["shaded", "flat"]);
            expect(look.value).toBe("shaded");
            expect(document.querySelector(".sutree-ground")).not.toBeNull();
            const shadedWords = words().length;
            const calls = global.mockGetPeople.mock.calls.length;
            await change("#suTreeLook", "flat");
            // the flat look: solid colours, with nothing shaded, no bark, no ground, no shadow
            expect(document.querySelector(".sutree-crown").getAttribute("fill")).toBe("#d4ecd4");
            expect(document.querySelector(".sutree-trunk").getAttribute("fill")).toBe("#e9dbc2");
            ["ground", "bark", "shadow", "inner"].forEach((part) =>
                expect(document.querySelector(`.sutree-${part}`)).toBeNull()
            );
            expect(document.querySelectorAll("radialGradient").length).toBe(0);
            expect(words().length).toBeGreaterThan(shadedWords); // and the words are packed tighter
            expect(global.mockGetPeople.mock.calls.length).toBe(calls);
            await change("#suTreeLook", "shaded");
            expect(document.querySelector(".sutree-ground")).not.toBeNull();
        });

        it("starts on flat when the options say so", async () => {
            global.mockOptions = { ...START, look: "flat" };
            await open();
            expect(document.getElementById("suTreeLook").value).toBe("flat");
            expect(document.querySelector(".sutree-ground")).toBeNull();
        });
    });

    describe("shape: an oak, or a picture of your own", () => {
        beforeEach(() => {
            global.mockOptions = { ...START, fillGaps: true }; // the words fill the shape, so there are plenty to look at
        });

        it("offers an oak or a picture, and shows the picture controls only for a picture", async () => {
            await open();
            expect([...document.getElementById("suTreeShapeKind").options].map((o) => o.value)).toEqual([
                "tree",
                "image",
            ]);
            expect(chosenShape()).toBe("tree");
            expect(document.getElementById("suTreeChoose").hidden).toBe(true);
            expect(document.getElementById("suTreeSenseLabel").hidden).toBe(true);
        });

        it("opens the file chooser when My picture is picked and there is no picture yet", async () => {
            await open();
            const input = document.getElementById("suTreeFile");
            input.click = jest.fn();
            await change("#suTreeShapeKind", "image");
            expect(input.click).toHaveBeenCalledTimes(1);
            expect(global.mockReadImage).not.toHaveBeenCalled();
        });

        it("fills the picture's shape with the words, in the picture's colours, with the picture faintly behind", async () => {
            await open();
            await change("#suTreeShapeKind", "image");
            await chooseFile("disc.png");
            expect(global.mockReadImage).toHaveBeenCalledTimes(1);
            expect(chosenShape()).toBe("image");
            expect(document.getElementById("suTreeChoose").hidden).toBe(false);
            expect(document.getElementById("suTreeSenseLabel").hidden).toBe(false);
            expect(document.getElementById("suTreeChoose").title).toMatch(/disc\.png/);
            // no oak: the picture is the shape, and it is shown faintly behind the words
            expect(document.querySelector(".sutree-trunk")).toBeNull();
            expect(document.querySelector(".sutree-crown")).toBeNull();
            const backdrop = document.querySelector(".sutree-backdrop");
            expect(backdrop.getAttribute("href")).toMatch(/^data:image\/png/);
            expect(Number(backdrop.getAttribute("opacity"))).toBeLessThan(0.4);
            // every word is a green, the colour of the picture
            const fills = [...document.querySelectorAll(".sutree-word text")].map((t) => t.getAttribute("fill"));
            expect(fills.length).toBeGreaterThan(10);
            fills.forEach((hex) => {
                const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
                expect(g).toBeGreaterThan(r);
                expect(g).toBeGreaterThan(b);
            });
        });

        it("keeps hovering, the list and the card working in a picture's shape", async () => {
            await open();
            await change("#suTreeShapeKind", "image");
            await chooseFile();
            await click('[data-surname="CAVE"] rect');
            expect(document.getElementById("suTreeList").hidden).toBe(false);
            expect(document.getElementById("suTreeListName").textContent).toBe("CAVE");
            document
                .querySelector("a.sutree-name")
                .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            expect(document.getElementById("suTreeCard").hidden).toBe(false);
        });

        it("works in the flat look too, and goes back to the oak", async () => {
            await open();
            await change("#suTreeShapeKind", "image");
            await chooseFile();
            await change("#suTreeLook", "flat");
            expect(document.querySelector(".sutree-backdrop")).not.toBeNull();
            expect(words().length).toBeGreaterThan(20);
            await change("#suTreeShapeKind", "tree");
            expect(document.querySelector(".sutree-backdrop")).toBeNull();
            expect(document.querySelector(".sutree-trunk")).not.toBeNull();
            expect(document.getElementById("suTreeChoose").hidden).toBe(true);
            // and back to the picture without choosing it again
            await change("#suTreeShapeKind", "image");
            expect(global.mockReadImage).toHaveBeenCalledTimes(1);
            expect(document.querySelector(".sutree-backdrop")).not.toBeNull();
        });

        it("cuts out more or less of the picture with the slider, without reading it again", async () => {
            await open();
            await change("#suTreeShapeKind", "image");
            await chooseFile();
            const before = document.querySelector(".sutree-word");
            await change("#suTreeSense", "120");
            expect(document.querySelector(".sutree-word")).not.toBe(before); // drawn again
            expect(global.mockReadImage).toHaveBeenCalledTimes(1);
        });

        it("keeps the Shuffle button working for a picture, arranging the words afresh", async () => {
            await open();
            await change("#suTreeShapeKind", "image");
            await chooseFile();
            const arrangement = () =>
                [...document.querySelectorAll(".sutree-word")].map((g) => g.getAttribute("transform")).join("|");
            const before = arrangement();
            await click("#suTreeShuffle");
            expect(arrangement()).not.toBe(before);
            expect(document.querySelector(".sutree-backdrop")).not.toBeNull();
        });

        it("shows the oak and says so when no shape can be found in the picture", async () => {
            global.mockReadImage = jest.fn(() => Promise.resolve(pictureOf([240, 240, 240], { disc: false })));
            await open();
            await change("#suTreeShapeKind", "image");
            await chooseFile("blank.png");
            expect(status()).toMatch(/No shape could be found in that picture, so the oak is shown/);
            expect(chosenShape()).toBe("tree");
            expect(document.querySelector(".sutree-trunk")).not.toBeNull();
            expect(document.getElementById("suTreeChoose").hidden).toBe(true);
        });

        it("says why a picture could not be used, and stays on what it was showing", async () => {
            global.mockReadImage = jest.fn(() => Promise.reject(new Error("That file is not a picture.")));
            await open();
            await change("#suTreeShapeKind", "image");
            await chooseFile("notes.pdf");
            expect(status()).toMatch(/That file is not a picture/);
            expect(chosenShape()).toBe("tree");
            expect(document.querySelector(".sutree-trunk")).not.toBeNull();
            // a bad second choice keeps the first picture
            global.mockReadImage = jest.fn(() => Promise.resolve(pictureOf([30, 140, 40])));
            await change("#suTreeShapeKind", "image");
            await chooseFile("good.png");
            global.mockReadImage = jest.fn(() => Promise.reject(new Error("That picture could not be opened.")));
            await click("#suTreeChoose");
            await chooseFile("bad.png");
            expect(chosenShape()).toBe("image");
            expect(document.querySelector(".sutree-backdrop")).not.toBeNull();
        });

        it("goes back to the oak when the file chooser is closed without a choice", async () => {
            await open();
            const input = document.getElementById("suTreeFile");
            input.click = jest.fn();
            await change("#suTreeShapeKind", "image");
            input.dispatchEvent(new Event("cancel"));
            expect(chosenShape()).toBe("tree");
        });

        it("saves a picture's shape as a PNG and a PDF like the oak", async () => {
            await open();
            await change("#suTreeShapeKind", "image");
            await chooseFile();
            const saved = [];
            const original = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function () {
                saved.push(this.download);
            };
            await click("#suTreeSaveAs");
            await click("#suTreeSaveGo");
            await change('input[name="suTreeFormat"][value="pdf"]', true);
            await click("#suTreeSaveGo");
            HTMLAnchorElement.prototype.click = original;
            expect(saved).toEqual(["surname-tree-Robinson-1-1600px.png", "surname-tree-Robinson-1.pdf"]);
            expect(global.mockBlobs.length).toBeGreaterThan(0);
        });
    });

    describe("zoom", () => {
        const transform = () => document.querySelector(".sutree-viewport").getAttribute("transform");
        it("zooms in and out with the buttons and resets", async () => {
            await open();
            await click("#suTreeZoomIn");
            expect(transform()).toMatch(/scale\(1\.6/);
            await click("#suTreeZoomOut");
            expect(transform()).toMatch(/scale\(1\)/);
            await click("#suTreeZoomIn");
            await click("#suTreeZoomReset");
            expect(transform()).toBe("translate(0 0) scale(1)");
        });
    });

    it("fills the window with Full screen, and Escape leaves it", async () => {
        await open();
        const app = document.querySelector(".sutree-app");
        await click("#suTreeFull");
        expect(app.classList.contains("sutree-full")).toBe(true);
        expect(document.getElementById("suTreeFull").textContent).toBe("Leave full screen");
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(app.classList.contains("sutree-full")).toBe(false);
        expect(document.getElementById("suTreeFull").textContent).toBe("Full screen");
    });

    it("makes a different tree, as well as a different arrangement, with Shuffle", async () => {
        await open();
        const shape = () => document.querySelector(".sutree-trunk").getAttribute("d");
        const before = shape();
        await click("#suTreeShuffle");
        expect(shape()).not.toBe(before);
    });

    it("sets the words at different angles", async () => {
        await open();
        const turns = [...document.querySelectorAll(".sutree-word")].map(
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
            const panel = document.getElementById("suTreeSavePanel");
            expect(panel.hidden).toBe(true);
            await click("#suTreeSaveAs");
            expect(panel.hidden).toBe(false);
            expect([...document.querySelectorAll('input[name="suTreeFormat"]')].map((r) => r.value)).toEqual([
                "png",
                "jpg",
                "pdf",
            ]);
            const size = document.getElementById("suTreeSize");
            expect([...size.options].map((o) => o.value)).toEqual(["small", "medium", "large", "custom"]);
            expect(size.value).toBe("medium");
            expect(document.getElementById("suTreeSizeNote").textContent).toBe(
                "The picture will be 1,600 × 1,408 pixels."
            );
            await click("#suTreeSaveCancel");
            expect(panel.hidden).toBe(true);
        });

        it("saves a PNG or JPG at the size chosen, named for the profile and the size", async () => {
            await open();
            const { saved, restore } = saveClicks();
            await click("#suTreeSaveAs");
            await click("#suTreeSaveGo");
            expect(saved).toEqual(["surname-tree-Robinson-1-1600px.png"]);
            expect(global.mockBlobs.pop()).toMatchObject({ type: "image/png", width: 1600, height: 1408 });
            await click("#suTreeSaveAs");
            await change('input[name="suTreeFormat"][value="jpg"]', true);
            await change("#suTreeSize", "large");
            await click("#suTreeSaveGo");
            restore();
            expect(saved[1]).toBe("surname-tree-Robinson-1-3200px.jpg");
            expect(global.mockBlobs.pop()).toMatchObject({ type: "image/jpeg", width: 3200, height: 2816 });
        });

        it("takes a custom width, and will not save one that is out of range", async () => {
            await open();
            await click("#suTreeSaveAs");
            await change("#suTreeSize", "custom");
            expect(document.getElementById("suTreeCustomLabel").hidden).toBe(false);
            await change("#suTreeCustom", "12");
            expect(document.getElementById("suTreeSaveGo").disabled).toBe(true);
            expect(document.getElementById("suTreeSizeNote").textContent).toMatch(/Enter a width from 200 to 6,000/);
            await change("#suTreeCustom", "2500");
            expect(document.getElementById("suTreeSaveGo").disabled).toBe(false);
            expect(document.getElementById("suTreeSizeNote").textContent).toBe(
                "The picture will be 2,500 × 2,200 pixels."
            );
        });

        it("saves a PDF without asking for a size, but asks for the paper", async () => {
            await open();
            const { saved, restore } = saveClicks();
            await click("#suTreeSaveAs");
            await change('input[name="suTreeFormat"][value="pdf"]', true);
            expect(document.getElementById("suTreeSizeRow").hidden).toBe(true);
            expect(document.getElementById("suTreePaperRow").hidden).toBe(false);
            await click("#suTreeSaveGo");
            restore();
            expect(saved).toEqual(["surname-tree-Robinson-1.pdf"]);
            expect(global.mockPdfs[0]).toContain("%PDF-1.4");
            expect(global.mockPdfs[0]).toContain("Surname Tree of Person 1 Robinson");
            expect(status()).toBe("Saved as PDF.");
        });

        it("says so when the browser cannot make a picture that big", async () => {
            await open();
            await click("#suTreeSaveAs");
            global.mockCanvasFails = true;
            await click("#suTreeSaveGo");
            global.mockCanvasFails = false;
            expect(status()).toMatch(/could not be made.*smaller/);
            expect(document.getElementById("suTreeSavePanel").hidden).toBe(false);
        });
    });
});
