/** @jest-environment node */
import { Buffer } from "buffer";
import {
    FORMATS,
    MAX_WIDTH,
    MIN_WIDTH,
    SIZES,
    buildPdf,
    exportFileName,
    formatById,
    imageHeight,
    pdfText,
    sizeLabel,
    widthFor,
} from "../../views/surnameTree/surname_tree_export.js";

describe("formats and sizes", () => {
    it("offers PNG, JPG and PDF, and only asks for a size for the pictures", () => {
        expect(FORMATS.map((f) => [f.id, f.sized])).toEqual([
            ["png", true],
            ["jpg", true],
            ["pdf", false],
        ]);
        expect(formatById("nonsense").id).toBe("png");
    });

    it("has small, medium and large sizes that keep the tree's shape", () => {
        expect(SIZES.map((s) => s.id)).toEqual(["small", "medium", "large"]);
        expect(imageHeight(1000)).toBe(880);
        expect(imageHeight(1600)).toBe(1408);
        expect(sizeLabel(1600)).toBe("1,600 × 1,408 pixels");
    });

    it("gives the width for a size, and checks a custom width", () => {
        expect(widthFor("small")).toBe(800);
        expect(widthFor("large")).toBe(3200);
        expect(widthFor("custom", "2500")).toBe(2500);
        expect(widthFor("custom", "2500.4")).toBe(2500);
        expect(widthFor("custom", MIN_WIDTH - 1)).toBe(0);
        expect(widthFor("custom", MAX_WIDTH + 1)).toBe(0);
        expect(widthFor("custom", "")).toBe(0);
        expect(widthFor("custom", "wide")).toBe(0);
        expect(widthFor("huge")).toBe(0);
    });

    it("names the file for the profile, with the width for pictures", () => {
        expect(exportFileName("Robinson-27274", "png", 1600)).toBe("surname-tree-Robinson-27274-1600px.png");
        expect(exportFileName("Robinson-27274", "jpg", 800)).toBe("surname-tree-Robinson-27274-800px.jpg");
        expect(exportFileName("Robinson-27274", "pdf", 0)).toBe("surname-tree-Robinson-27274.pdf");
    });
});

describe("pdfText", () => {
    it("escapes what PDF treats specially, and replaces letters outside Latin-1", () => {
        expect(pdfText("a (b) c\\d")).toBe("a \\(b\\) c\\\\d");
        expect(pdfText("Zoë Müller")).toBe("Zoë Müller");
        expect(pdfText("Łukasz 李")).toBe("?ukasz ?");
        expect(pdfText("two\nlines")).toBe("two lines");
    });
});

describe("buildPdf", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9]);
    const make = (extra = {}) =>
        buildPdf({
            jpeg,
            pixelWidth: 2400,
            pixelHeight: 2112,
            title: "Surname Tree of A (B)",
            caption: "5 surnames.",
            ...extra,
        });
    const text = (pdf) => Buffer.from(pdf).toString("latin1");

    it("is a PDF with one page, the picture as a JPEG, and the title and caption", () => {
        const pdf = make();
        const t = text(pdf);
        expect(t.startsWith("%PDF-1.4")).toBe(true);
        expect(t.trimEnd().endsWith("%%EOF")).toBe(true);
        expect(t).toContain("/Count 1");
        expect(t).toContain("/Filter /DCTDecode");
        expect(t).toContain("/Width 2400 /Height 2112");
        expect(t).toContain("(Surname Tree of A \\(B\\)) Tj");
        expect(t).toContain("(5 surnames.) Tj");
        expect(Buffer.from(pdf).includes(Buffer.from(jpeg))).toBe(true);
    });

    it("has a cross-reference table whose offsets point at the objects", () => {
        const pdf = make();
        const t = text(pdf);
        const startxref = parseInt(t.match(/startxref\n(\d+)/)[1], 10);
        expect(t.slice(startxref, startxref + 4)).toBe("xref");
        const entries = [...t.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => parseInt(m[1], 10));
        expect(entries).toHaveLength(7);
        entries.forEach((offset, i) =>
            expect(t.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`)
        );
    });

    it("declares a stream length that matches the picture's bytes", () => {
        const t = text(make());
        expect(t).toContain(`/Length ${jpeg.length} >>`);
    });

    it("uses the paper chosen", () => {
        expect(text(make({ paper: "letter" }))).toContain("/MediaBox [0 0 612 792]");
        expect(text(make({ paper: "a4" }))).toContain("/MediaBox [0 0 595.28 841.89]");
        expect(text(make({ paper: "nonsense" }))).toContain("/MediaBox [0 0 612 792]");
    });

    it("shrinks a very long title to fit the page", () => {
        const size = (t) => parseFloat(t.match(/\/F1 ([\d.]+) Tf/)[1]);
        expect(size(text(make()))).toBe(20);
        expect(size(text(make({ title: "Surname Tree of " + "Longname ".repeat(12) })))).toBeLessThan(10);
    });
});
