/*
 * Names how a relative is related to the starting profile, from the parent links of everyone in the CC7:
 * find the closest ancestor the two share, then count the generations down each side
 * (the same idea WikiTree's Relationship Finder uses).
 *
 * Pure functions, no DOM and no network, so they can be tested with node.
 */

const MAX_DEPTH = 8;

/**
 * @param {Iterable<{id:number, father:number, mother:number}>} people
 * @returns {Map<number, {father:number, mother:number}>}
 */
export function parentGraph(people) {
    const graph = new Map();
    for (const p of people) {
        if (!p || !p.id) continue;
        graph.set(Number(p.id), { father: Number(p.father) || 0, mother: Number(p.mother) || 0 });
    }
    return graph;
}

/** Every "father|mother" pair, so we can tell full siblings/cousins from half ones. */
export function coupleSet(graph) {
    const couples = new Set();
    for (const node of graph.values()) {
        if (node.father && node.mother) couples.add(`${node.father}|${node.mother}`);
    }
    return couples;
}

/** id -> fewest generations up from start (start itself is 0). */
export function ancestorGenerations(graph, start, maxDepth = MAX_DEPTH) {
    const gens = new Map([[start, 0]]);
    let frontier = [start];
    for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
        const next = [];
        for (const id of frontier) {
            const node = graph.get(id);
            if (!node) continue;
            for (const parent of [node.father, node.mother]) {
                if (parent && !gens.has(parent)) {
                    gens.set(parent, depth);
                    next.push(parent);
                }
            }
        }
        frontier = next;
    }
    return gens;
}

/**
 * The shared ancestor(s) with the fewest generations in all.
 * a = generations from the starting profile up to it, b = from the relative up to it.
 */
export function closestCommon(gensA, gensB) {
    let best = null;
    for (const [id, a] of gensA) {
        const b = gensB.get(id);
        if (b === undefined) continue;
        const total = a + b;
        if (!best || total < best.total || (total === best.total && Math.max(a, b) < Math.max(best.a, best.b))) {
            best = { a, b, total, ids: [id] };
        } else if (total === best.total && a === best.a && b === best.b) {
            best.ids.push(id);
        }
    }
    return best;
}

/**
 * "Half" only when we know it: the two lines come down from one shared ancestor through children whose other
 * parents are both recorded and different. A missing parent is common on WikiTree, so it is not taken as "half".
 */
export function isHalf(graph, gensA, gensB, common, couples) {
    if (!common || common.a === 0 || common.b === 0) return false;
    const ids = common.ids;
    if (ids.some((x) => ids.some((y) => couples.has(`${x}|${y}`)))) return false;
    if (ids.length !== 1) return false;
    const x = ids[0];
    const childrenOfX = (gens, gen) =>
        [...gens]
            .filter(([id, g]) => g === gen && (graph.get(id)?.father === x || graph.get(id)?.mother === x))
            .map(([id]) => id);
    const otherParent = (child) => {
        const node = graph.get(child);
        return node.father === x ? node.mother : node.father;
    };
    const sideA = childrenOfX(gensA, common.a - 1);
    const sideB = childrenOfX(gensB, common.b - 1);
    if (!sideA.length || !sideB.length) return false;
    for (const ca of sideA) {
        for (const cb of sideB) {
            const pa = otherParent(ca);
            const pb = otherParent(cb);
            if (!pa || !pb || pa === pb) return false;
        }
    }
    return true;
}

const ordinal = (n) => {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
};
const timesRemoved = (n) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
const bySex = (gender, male, female, neutral) => (gender === "Male" ? male : gender === "Female" ? female : neutral);
// 0 -> "", 1 -> "great-", 2 -> "2nd great-", ...
const greats = (n) => (n <= 0 ? "" : n === 1 ? "great-" : `${ordinal(n)} great-`);

/**
 * a = generations from the starting profile up to the shared ancestor, b = from the relative up to it.
 * @returns {string} e.g. "2nd cousin once removed", "great-grandmother", "half brother"
 */
export function describeRelationship(a, b, half, gender) {
    if (a === 0 && b === 0) return "starting profile";
    if (b === 0) {
        // The relative is the shared ancestor: a direct ancestor of the starting profile.
        if (a === 1) return bySex(gender, "father", "mother", "parent");
        return greats(a - 2) + bySex(gender, "grandfather", "grandmother", "grandparent");
    }
    if (a === 0) {
        if (b === 1) return bySex(gender, "son", "daughter", "child");
        return greats(b - 2) + bySex(gender, "grandson", "granddaughter", "grandchild");
    }
    const h = half ? "half " : "";
    if (a === 1 && b === 1) return h + bySex(gender, "brother", "sister", "sibling");
    if (b === 1) return h + greats(a - 2) + bySex(gender, "uncle", "aunt", "aunt/uncle");
    if (a === 1) return h + greats(b - 2) + bySex(gender, "nephew", "niece", "niece/nephew");
    const cousin = Math.min(a, b) - 1;
    const removed = Math.abs(a - b);
    return `${h}${ordinal(cousin)} cousin${removed ? ` ${timesRemoved(removed)} removed` : ""}`;
}

/**
 * Builds a function naming each relative's relationship to rootId.
 * @param {Map} graph from parentGraph()
 * @param {number} rootId
 * @returns {(id:number, gender:string, degree:number|null) => {label:string, isBlood:boolean}}
 */
export function relationshipNamer(graph, rootId) {
    const couples = coupleSet(graph);
    const rootGens = ancestorGenerations(graph, rootId);
    return (id, gender, degree) => {
        if (id === rootId) return { label: "starting profile", isBlood: true };
        const theirGens = ancestorGenerations(graph, id);
        const common = closestCommon(rootGens, theirGens);
        const marriage = degree === 1 ? bySex(gender, "husband", "wife", "spouse") : "related by marriage";
        if (!common) return { label: marriage, isBlood: false };
        const half = isHalf(graph, rootGens, theirGens, common, couples);
        const blood = describeRelationship(common.a, common.b, half, gender);
        // WikiTree's degrees step through siblings, so up-and-down to a shared ancestor is one step shorter.
        const bloodSteps = common.a > 0 && common.b > 0 ? common.total - 1 : common.total;
        // A blood line longer than the degree means the closer link is a marriage (a husband who was also a cousin).
        if (degree !== null && degree !== undefined && bloodSteps > degree) {
            return { label: `${marriage} (also ${blood})`, isBlood: false };
        }
        return { label: blood, isBlood: true };
    };
}

/**
 * Names a relationship from a connection path (each step "parent", "child", "sibling" or "spouse", read from the
 * starting profile outwards). Blood only when the path goes up and then down with no spouse step.
 * @returns {{label:string, isBlood:boolean}}
 */
export function relationshipFromSteps(steps, gender) {
    let up = 0;
    let down = 0;
    let isGoingDown = false;
    let isBlood = true;
    for (const step of steps) {
        if (step === "parent" && !isGoingDown) up++;
        else if (step === "sibling" && !isGoingDown) {
            up++;
            down++;
            isGoingDown = true;
        } else if (step === "child") {
            down++;
            isGoingDown = true;
        } else {
            isBlood = false;
            break;
        }
    }
    if (isBlood && (up || down)) return { label: describeRelationship(up, down, false, gender), isBlood: true };
    if (steps.length === 1 && steps[0] === "spouse") {
        return { label: bySex(gender, "husband", "wife", "spouse"), isBlood: false };
    }
    return { label: "related by marriage", isBlood: false };
}

/** 1 -> "parents", 2 -> "grandparents", 3 -> "great-grandparents", 4 -> "2nd great-grandparents" */
export function sharedAncestorsLabel(generation) {
    if (generation === 1) return "parents";
    return `${greats(generation - 2)}grandparents`;
}

/** Who someone sharing those ancestors usually is. */
export function cousinRangeLabel(generation) {
    if (generation === 1) return "siblings and their descendants";
    if (generation === 2) return "aunts, uncles, 1st cousins and their descendants";
    return `${ordinal(generation - 1)} cousins (some removed) and their families`;
}
