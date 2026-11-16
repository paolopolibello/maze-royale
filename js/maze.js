import { CONFIG, getMazeSizeForLevel } from './config.js';

/**
 * Generatore PRNG deterministico (Mulberry32) condiviso tra giocatori nello stesso match.
 */
export function createRng(seed) {
  let t = (seed >>> 0) || 1337;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Crea un labirinto speculare N x N con cellSize = 4.5:
 * - Spawn A in basso a sinistra (1, N - 2)
 * - Spawn B in alto a destra (N - 2, 1)
 * - Porta finale al centro esatto (mid, mid) -> world (0, 0)
 * - Vicoli ciechi allargati in stanze per combattimento e loot
 */
export function generateSymmetricMaze(level = 1, seed = 4201) {
  const N = getMazeSizeForLevel(level);
  const mid = (N - 1) >> 1;
  const cellSize = CONFIG.CELL_SIZE;
  const rng = createRng(seed + level * 9973);

  // 1 = muro, 0 = pavimento
  const grid = Array.from({ length: N }, () => new Uint8Array(N).fill(1));
  const sym = (x, z) => [N - 1 - x, N - 1 - z];
  const carveSym = (x, z) => {
    if (x <= 0 || x >= N - 1 || z <= 0 || z >= N - 1) return;
    grid[z][x] = 0;
    const [sx, sz] = sym(x, z);
    grid[sz][sx] = 0;
  };

  // 1. Stanza centrale 3x3 attorno a (mid, mid) -> coordinate (0, 0)
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      grid[mid + dz][mid + dx] = 0;
    }
  }

  // 2. DFS speculare a passo 2 partendo da Spawn A (1, N - 2)
  const spawnACell = { gx: 1, gz: N - 2 };
  const spawnBCell = { gx: N - 2, gz: 1 };
  const visited = Array.from({ length: N }, () => new Uint8Array(N));

  const markVisitedSym = (x, z) => {
    visited[z][x] = 1;
    const [sx, sz] = sym(x, z);
    visited[sz][sx] = 1;
  };

  // Marca le celle dispari interne alla stanza centrale come parte del grafo visitabile
  for (let z = 1; z < N - 1; z += 2) {
    for (let x = 1; x < N - 1; x += 2) {
      if (Math.abs(x - mid) <= 1 && Math.abs(z - mid) <= 1) {
        markVisitedSym(x, z);
      }
    }
  }

  const dirs = [
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2]
  ];

  const runDfsFrom = (startX, startZ) => {
    const stack = [[startX, startZ]];
    carveSym(startX, startZ);
    markVisitedSym(startX, startZ);

    while (stack.length > 0) {
      const [cx, cz] = stack[stack.length - 1];
      const candidates = [];
      for (const [dx, dz] of dirs) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx > 0 && nx < N - 1 && nz > 0 && nz < N - 1 && !visited[nz][nx]) {
          candidates.push([nx, nz, cx + dx / 2, cz + dz / 2]);
        }
      }
      if (candidates.length === 0) {
        stack.pop();
        continue;
      }
      const pick = candidates[Math.floor(rng() * candidates.length)];
      const [nx, nz, mx, mz] = pick;
      carveSym(mx, mz);
      carveSym(nx, nz);
      markVisitedSym(nx, nz);
      stack.push([nx, nz]);
    }
  };

  runDfsFrom(spawnACell.gx, spawnACell.gz);

  // Scava eventuali celle dispari rimaste isolate collegandole a vicini aperti
  for (let z = 1; z < N - 1; z += 2) {
    for (let x = 1; x < N - 1; x += 2) {
      if (!visited[z][x]) {
        runDfsFrom(x, z);
      }
    }
  }

  // Collega la stanza centrale ad almeno due ingressi simmetrici sui lati opposti
  const centerSideHooks = [
    [mid - 2, mid],
    [mid + 2, mid],
    [mid, mid - 2],
    [mid, mid + 2]
  ];
  // Apri sempre il collegamento orizzontale o verticale che tocca un corridoio aperto
  const chosenBridge = rng() < 0.5 ? [mid - 1, mid - 2] : [mid - 2, mid - 1];
  const altBridge = chosenBridge[0] === mid - 1 ? [mid + 1, mid + 2] : [mid + 2, mid + 1];
  void centerSideHooks;
  // Ponte simmetrico garantito nella griglia attorno alla camera centrale 3x3
  carveSym(mid - 2, mid);
  carveSym(mid, mid + 2);
  void chosenBridge;
  void altBridge;

  // 3. Verifica BFS connettivita' globale da Spawn A; se esistono isole, connetti simmetricamente
  const bfsReachable = () => {
    const seen = Array.from({ length: N }, () => new Uint8Array(N));
    const queue = [[spawnACell.gx, spawnACell.gz]];
    seen[spawnACell.gz][spawnACell.gx] = 1;
    let head = 0;
    while (head < queue.length) {
      const [x, z] = queue[head++];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx > 0 && nx < N - 1 && nz > 0 && nz < N - 1 && grid[nz][nx] === 0 && !seen[nz][nx]) {
          seen[nz][nx] = 1;
          queue.push([nx, nz]);
        }
      }
    }
    return seen;
  };

  for (let pass = 0; pass < 32; pass++) {
    const seen = bfsReachable();
    if (seen[mid][mid] && seen[spawnBCell.gz][spawnBCell.gx]) break;
    let bridged = false;
    for (let z = 1; z < N - 1 && !bridged; z++) {
      for (let x = 1; x < N - 1 && !bridged; x++) {
        if (grid[z][x] !== 1) continue;
        const leftOpen = grid[z][x - 1] === 0;
        const rightOpen = grid[z][x + 1] === 0;
        const upOpen = grid[z - 1][x] === 0;
        const downOpen = grid[z + 1][x] === 0;
        if (leftOpen && rightOpen && seen[z][x - 1] !== seen[z][x + 1]) {
          carveSym(x, z);
          bridged = true;
        } else if (upOpen && downOpen && seen[z - 1][x] !== seen[z + 1][x]) {
          carveSym(x, z);
          bridged = true;
        }
      }
    }
    if (!bridged) break;
  }

  // Piccoli loop tattici secondari per evitare corridoi troppo lineari in PvP
  const extraBraids = Math.max(2, Math.floor(N * 0.3));
  for (let b = 0; b < extraBraids; b++) {
    const wx = 2 + Math.floor(rng() * (N - 4));
    const wz = 2 + Math.floor(rng() * (N - 4));
    if (grid[wz][wx] !== 1) continue;
    const hOpen = grid[wz][wx - 1] === 0 && grid[wz][wx + 1] === 0 && grid[wz - 1][wx] === 1 && grid[wz + 1][wx] === 1;
    const vOpen = grid[wz - 1][wx] === 0 && grid[wz + 1][wx] === 0 && grid[wz][wx - 1] === 1 && grid[wz][wx + 1] === 1;
    if ((hOpen || vOpen) && Math.abs(wx - mid) > 2) {
      carveSym(wx, wz);
    }
  }

  // 4. Riconoscimento vicoli ciechi e trasformazione in "Stanze"
  const isNearSpecial = (x, z) => {
    if (Math.abs(x - mid) <= 2 && Math.abs(z - mid) <= 2) return true;
    if (Math.abs(x - spawnACell.gx) + Math.abs(z - spawnACell.gz) <= 2) return true;
    if (Math.abs(x - spawnBCell.gx) + Math.abs(z - spawnBCell.gz) <= 2) return true;
    return false;
  };

  const deadEnds = [];
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      if (grid[z][x] !== 0 || isNearSpecial(x, z)) continue;
      let openNeighbors = 0;
      if (grid[z - 1][x] === 0) openNeighbors++;
      if (grid[z + 1][x] === 0) openNeighbors++;
      if (grid[z][x - 1] === 0) openNeighbors++;
      if (grid[z][x + 1] === 0) openNeighbors++;
      if (openNeighbors === 1) {
        deadEnds.push({ gx: x, gz: z });
      }
    }
  }

  const rooms = [];
  const halfPairs = deadEnds.filter((d) => {
    const [sx, sz] = sym(d.gx, d.gz);
    return d.gz < sz || (d.gz === sz && d.gx <= sx);
  });
  shuffleInPlace(halfPairs, rng);

  for (const de of halfPairs) {
    // Espande il vicolo cieco in una stanza 2x2 o 3x2 dove possibile senza toccare bordi o centro
    const offsets = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ];
    shuffleInPlace(offsets, rng);
    let carvedRoom = false;
    for (const [ox, oz] of offsets) {
      const ax = de.gx + ox;
      const az = de.gz + oz;
      if (ax > 1 && ax < N - 2 && az > 1 && az < N - 2 && !isNearSpecial(ax, az)) {
        carveSym(ax, az);
        // Prova ad aggiungere una terza cella adiacente per formare una nicchia a L / 2x2
        const perpX = oz !== 0 ? (rng() < 0.5 ? 1 : -1) : 0;
        const perpZ = ox !== 0 ? (rng() < 0.5 ? 1 : -1) : 0;
        const bx = ax + perpX;
        const bz = az + perpZ;
        if (bx > 1 && bx < N - 2 && bz > 1 && bz < N - 2 && !isNearSpecial(bx, bz)) {
          carveSym(bx, bz);
        }
        carvedRoom = true;
        break;
      }
    }
    if (carvedRoom || deadEnds.length <= 10) {
      rooms.push({ gx: de.gx, gz: de.gz });
      const [sx, sz] = sym(de.gx, de.gz);
      if (sx !== de.gx || sz !== de.gz) {
        rooms.push({ gx: sx, gz: sz });
      }
    }
  }

  // 5. Coordinate helper tra griglia e world (con (mid, mid) esattamente a (0, 0))
  const cellToWorld = (gx, gz) => ({
    x: (gx - mid) * cellSize,
    z: (gz - mid) * cellSize
  });

  const worldToCell = (x, z) => ({
    gx: Math.round(x / cellSize + mid),
    gz: Math.round(z / cellSize + mid)
  });

  const isWall = (gx, gz) => {
    if (gx < 0 || gz < 0 || gx >= N || gz >= N) return true;
    return grid[gz][gx] === 1;
  };

  // Mappa tutte le celle libere calpestabili distanti dagli spawn per piazziamento fallback
  const floorCells = [];
  const wallCells = [];
  for (let gz = 0; gz < N; gz++) {
    for (let gx = 0; gx < N; gx++) {
      if (grid[gz][gx] === 1) {
        wallCells.push({ gx, gz, ...cellToWorld(gx, gz) });
      } else {
        floorCells.push({ gx, gz, ...cellToWorld(gx, gz) });
      }
    }
  }

  // 6. Distribuzione dei 5 Fogli + Casse + Spawn Bot + Codice Segreto del Livello
  const pickedSymbols = shuffleInPlace([...CONFIG.SYMBOLS], rng).slice(0, 5);

  const farFloorPool = floorCells.filter((c) => {
    if (Math.abs(c.gx - mid) <= 1 && Math.abs(c.gz - mid) <= 1) return false;
    const distA = Math.abs(c.gx - spawnACell.gx) + Math.abs(c.gz - spawnACell.gz);
    const distB = Math.abs(c.gx - spawnBCell.gx) + Math.abs(c.gz - spawnBCell.gz);
    return distA >= 3 && distB >= 3;
  });

  // Priorita' alle stanze create dai vicoli ciechi per i 5 fogli
  const pageCandidates = [];
  const usedKeys = new Set();
  const pushUnique = (cell) => {
    const k = `${cell.gx},${cell.gz}`;
    if (!usedKeys.has(k) && !isNearSpecial(cell.gx, cell.gz)) {
      usedKeys.add(k);
      pageCandidates.push({ gx: cell.gx, gz: cell.gz, ...cellToWorld(cell.gx, cell.gz) });
    }
  };
  for (const r of shuffleInPlace([...rooms], rng)) pushUnique(r);
  for (const c of shuffleInPlace([...farFloorPool], rng)) pushUnique(c);

  const pageSpawns = [];
  for (let i = 0; i < 5; i++) {
    // Scegli celle ben separate fra loro
    let chosen = pageCandidates[0];
    let bestScore = -1;
    for (const cand of pageCandidates) {
      const minDist = pageSpawns.length === 0
        ? 99
        : Math.min(...pageSpawns.map((p) => Math.hypot(p.x - cand.x, p.z - cand.z)));
      if (minDist > bestScore) {
        bestScore = minDist;
        chosen = cand;
      }
    }
    const idx = pageCandidates.indexOf(chosen);
    if (idx >= 0) pageCandidates.splice(idx, 1);
    pageSpawns.push({
      index: i,
      slot: i + 1,
      symbol: pickedSymbols[i],
      gx: chosen.gx,
      gz: chosen.gz,
      x: chosen.x,
      z: chosen.z
    });
  }

  // Casse (loot simmetrico nelle stanze e corridoi per anti-camper)
  const chestCandidates = pageCandidates.filter((c) => {
    const [sx, sz] = sym(c.gx, c.gz);
    return c.gz < sz || (c.gz === sz && c.gx <= sx);
  });
  const chestPairsTarget = Math.min(5, Math.max(3, 2 + level));
  const chestSpawns = [];
  for (let i = 0; i < chestCandidates.length && chestSpawns.length < chestPairsTarget * 2; i++) {
    const c = chestCandidates[i];
    const w = cellToWorld(c.gx, c.gz);
    chestSpawns.push({ id: chestSpawns.length, gx: c.gx, gz: c.gz, x: w.x, z: w.z });
    const [sx, sz] = sym(c.gx, c.gz);
    if (sx !== c.gx || sz !== c.gz) {
      const sw = cellToWorld(sx, sz);
      chestSpawns.push({ id: chestSpawns.length, gx: sx, gz: sz, x: sw.x, z: sw.z });
    }
  }

  // Bot nemici lenti: difensori vicino al portale centrale + pattuglie nel labirinto
  const centerDefendersPool = farFloorPool.filter((c) => {
    const distCenter = Math.abs(c.gx - mid) + Math.abs(c.gz - mid);
    return distCenter >= 2 && distCenter <= 4;
  });
  const outerBotsPool = farFloorPool.filter((c) => {
    const dA = Math.abs(c.gx - spawnACell.gx) + Math.abs(c.gz - spawnACell.gz);
    const dB = Math.abs(c.gx - spawnBCell.gx) + Math.abs(c.gz - spawnBCell.gz);
    const distCenter = Math.abs(c.gx - mid) + Math.abs(c.gz - mid);
    return dA >= 4 && dB >= 4 && distCenter > 4;
  });
  shuffleInPlace(centerDefendersPool, rng);
  shuffleInPlace(outerBotsPool, rng);

  const defenderTarget = Math.min(centerDefendersPool.length, 1 + Math.floor(level / 2));
  const totalBots = Math.min(18, 4 + level * 3);
  const chosenBotCells = [
    ...centerDefendersPool.slice(0, defenderTarget),
    ...outerBotsPool.slice(0, Math.max(0, totalBots - defenderTarget))
  ];
  const botSpawns = chosenBotCells.map((c, idx) => ({
    id: `bot-${idx}`,
    gx: c.gx,
    gz: c.gz,
    x: c.x,
    z: c.z
  }));

  const spawnA = cellToWorld(spawnACell.gx, spawnACell.gz);
  const spawnB = cellToWorld(spawnBCell.gx, spawnBCell.gz);
  const centerWorld = cellToWorld(mid, mid); // Esattamente { x: 0, z: 0 }

  return {
    level,
    seed,
    N,
    mid,
    cellSize,
    grid,
    rooms,
    wallCells,
    floorCells,
    spawnACell,
    spawnBCell,
    spawnA,
    spawnB,
    center: centerWorld,
    doorCode: pickedSymbols,
    pageSpawns,
    chestSpawns,
    botSpawns,
    cellToWorld,
    worldToCell,
    isWall
  };
}
