/** Gradient-boosted decision trees with logistic loss, histogram splits and deterministic subsampling. */
export interface TreeNode { f: number; t: number; l: number; r: number; v?: number }
export interface BoostedModel { kind: "gbdt"; base: number; rate: number; trees: TreeNode[][] }
export interface BoostingOptions { rounds?: number; rate?: number; depth?: number; minLeaf?: number; bins?: number; subsample?: number; l2?: number; seed?: number }

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, z))));

function treeValue(tree: TreeNode[], row: number[]): number {
  let node = tree[0];
  while (node.v === undefined) node = tree[row[node.f] <= node.t ? node.l : node.r];
  return node.v;
}

export function boostedScore(model: BoostedModel, row: number[]): number {
  let z = model.base;
  for (const tree of model.trees) z += model.rate * treeValue(tree, row);
  return z;
}
export function boostedProbability(model: BoostedModel, row: number[]): number { return sigmoid(boostedScore(model, row)); }

/** Quantile cut points per feature; missing values should be imputed before training. */
function cutPoints(rows: number[][], bins: number): number[][] {
  const k = rows[0].length;
  return Array.from({ length: k }, (_, j) => {
    const values = rows.map(row => row[j]).sort((a, b) => a - b);
    const cuts: number[] = [];
    for (let b = 1; b < bins; b++) {
      const value = values[Math.floor(b * values.length / bins)];
      if (cuts.at(-1) !== value) cuts.push(value);
    }
    return cuts;
  });
}

export function trainBoosted(rows: number[][], labels: number[], options: BoostingOptions = {}): BoostedModel {
  const { rounds = 150, rate = .05, depth = 3, minLeaf = 40, bins = 24, subsample = .8, l2 = 5, seed = 13 } = options;
  const n = rows.length, k = rows[0]?.length ?? 0;
  if (!n || n !== labels.length) throw new Error("Boosting requires matching rows and labels");
  const cuts = cutPoints(rows, bins);
  // Pre-bin every value so each split scan is a histogram pass.
  const binned = rows.map(row => row.map((value, j) => { let b = 0; while (b < cuts[j].length && value > cuts[j][b]) b++; return b; }));
  const mean = labels.reduce((s, v) => s + v, 0) / n;
  const base = Math.log(Math.max(1e-3, mean) / Math.max(1e-3, 1 - mean));
  const score = new Float64Array(n).fill(base);
  let state = seed >>> 0;
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  const trees: TreeNode[][] = [];
  for (let round = 0; round < rounds; round++) {
    const gradient = new Float64Array(n), hessian = new Float64Array(n);
    for (let i = 0; i < n; i++) { const p = sigmoid(score[i]); gradient[i] = labels[i] - p; hessian[i] = Math.max(1e-6, p * (1 - p)); }
    const sample: number[] = [];
    for (let i = 0; i < n; i++) if (random() < subsample) sample.push(i);
    const tree: TreeNode[] = [];
    const grow = (indices: number[], level: number): number => {
      const g = indices.reduce((s, i) => s + gradient[i], 0), h = indices.reduce((s, i) => s + hessian[i], 0);
      const id = tree.length;
      tree.push({ f: -1, t: 0, l: -1, r: -1, v: g / (h + l2) });
      if (level >= depth || indices.length < 2 * minLeaf) return id;
      let best = { gain: 1e-9, feature: -1, bin: -1 };
      const parent = g * g / (h + l2);
      for (let j = 0; j < k; j++) {
        const width = cuts[j].length + 1;
        if (width < 2) continue;
        const hg = new Float64Array(width), hh = new Float64Array(width), hc = new Int32Array(width);
        for (const i of indices) { const b = binned[i][j]; hg[b] += gradient[i]; hh[b] += hessian[i]; hc[b]++; }
        let lg = 0, lh = 0, lc = 0;
        for (let b = 0; b < width - 1; b++) {
          lg += hg[b]; lh += hh[b]; lc += hc[b];
          const rc = indices.length - lc;
          if (lc < minLeaf || rc < minLeaf) continue;
          const gain = lg * lg / (lh + l2) + (g - lg) ** 2 / (h - lh + l2) - parent;
          if (gain > best.gain) best = { gain, feature: j, bin: b };
        }
      }
      if (best.feature < 0) return id;
      const left = indices.filter(i => binned[i][best.feature] <= best.bin), right = indices.filter(i => binned[i][best.feature] > best.bin);
      const node = tree[id];
      delete node.v;
      node.f = best.feature; node.t = cuts[best.feature][best.bin];
      node.l = grow(left, level + 1); node.r = grow(right, level + 1);
      return id;
    };
    grow(sample, 0);
    // Compact numbers keep the serialized model small.
    for (const node of tree) { if (node.v !== undefined) node.v = Number(node.v.toPrecision(6)); else node.t = Number(node.t.toPrecision(8)); }
    trees.push(tree);
    for (let i = 0; i < n; i++) score[i] += rate * treeValue(tree, rows[i]);
  }
  return { kind: "gbdt", base, rate, trees };
}
