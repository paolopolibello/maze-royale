import { CONFIG } from './config.js';

/**
 * Risolutore matematico rigoroso Circle-vs-AABB sulla griglia del labirinto:
 * - Sub-stepping automatico per impedire tunneling durante il Dash
 * - Ordinamento per distanza dal centro cella
 * - Protezione anti-giunto (seam) tra celle muro adiacenti
 * - Spinta radiale sugli spigoli esterni: zero compenetrazione agli angoli e scivolamento fluido
 */
export function resolveMazeCollision(maze, prevX, prevZ, targetX, targetZ, radius = CONFIG.PLAYER_RADIUS) {
  const stepMax = Math.max(0.12, radius * 0.35);
  const dx = targetX - prevX;
  const dz = targetZ - prevZ;
  const moveDist = Math.hypot(dx, dz);
  const substeps = Math.max(1, Math.ceil(moveDist / stepMax));

  let px = prevX;
  let pz = prevZ;

  const cellSize = maze.cellSize;
  const halfCell = cellSize * 0.5;
  const mid = maze.mid;
  const eps = 1e-5;
  const boundHalf = (maze.N * 0.5 - 1) * cellSize - radius;

  for (let step = 0; step < substeps; step++) {
    px += dx / substeps;
    pz += dz / substeps;

    // 3 iterazioni di rilassamento risolvono spigoli e corridoi stretti senza residui
    for (let iter = 0; iter < 3; iter++) {
      const centerGx = Math.round(px / cellSize + mid);
      const centerGz = Math.round(pz / cellSize + mid);

      const candidateWalls = [];
      for (let oz = -1; oz <= 1; oz++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = centerGx + ox;
          const gz = centerGz + oz;
          if (!maze.isWall(gx, gz)) continue;
          const cx = (gx - mid) * cellSize;
          const cz = (gz - mid) * cellSize;
          const distSqCenter = (px - cx) * (px - cx) + (pz - cz) * (pz - cz);
          candidateWalls.push({ gx, gz, cx, cz, distSqCenter });
        }
      }

      // Risolvi prima le celle muro il cui centro e' piu' vicino (previene impuntamenti sulle giunzioni)
      candidateWalls.sort((a, b) => a.distSqCenter - b.distSqCenter);

      let adjusted = false;
      for (const wall of candidateWalls) {
        const minX = wall.cx - halfCell;
        const maxX = wall.cx + halfCell;
        const minZ = wall.cz - halfCell;
        const maxZ = wall.cz + halfCell;

        const closestX = Math.max(minX, Math.min(maxX, px));
        const closestZ = Math.max(minZ, Math.min(maxZ, pz));

        const vx = px - closestX;
        const vz = pz - closestZ;
        const distSq = vx * vx + vz * vz;

        if (distSq >= radius * radius) continue;

        if (distSq > 1e-9) {
          const dist = Math.sqrt(distSq);
          const nx = vx / dist;
          const nz = vz / dist;

          // Se la normale punta dentro un muro adiacente condiviso (seam interno), verifica i lati liberi
          const onLeftSeam = closestX === minX && maze.isWall(wall.gx - 1, wall.gz);
          const onRightSeam = closestX === maxX && maze.isWall(wall.gx + 1, wall.gz);
          const onTopSeam = closestZ === minZ && maze.isWall(wall.gx, wall.gz - 1);
          const onBotSeam = closestZ === maxZ && maze.isWall(wall.gx, wall.gz + 1);

          if (
            (nx < -0.9 && onLeftSeam) ||
            (nx > 0.9 && onRightSeam) ||
            (nz < -0.9 && onTopSeam) ||
            (nz > 0.9 && onBotSeam)
          ) {
            continue;
          }

          const push = radius - dist + eps;
          px += nx * push;
          pz += nz * push;
          adjusted = true;
        } else {
          // Centro finito dentro il box: spingi fuori lungo il lato aperto piu' vicino
          const choices = [];
          if (!maze.isWall(wall.gx - 1, wall.gz)) choices.push({ nx: -1, nz: 0, d: Math.abs(px - minX) });
          if (!maze.isWall(wall.gx + 1, wall.gz)) choices.push({ nx: 1, nz: 0, d: Math.abs(maxX - px) });
          if (!maze.isWall(wall.gx, wall.gz - 1)) choices.push({ nx: 0, nz: -1, d: Math.abs(pz - minZ) });
          if (!maze.isWall(wall.gx, wall.gz + 1)) choices.push({ nx: 0, nz: 1, d: Math.abs(maxZ - pz) });
          if (choices.length > 0) {
            choices.sort((a, b) => a.d - b.d);
            const best = choices[0];
            px += best.nx * (best.d + radius + eps);
            pz += best.nz * (best.d + radius + eps);
            adjusted = true;
          }
        }
      }

      if (!adjusted) break;
    }

    // Clamp di sicurezza entro il perimetro interno del labirinto
    px = Math.max(-boundHalf, Math.min(boundHalf, px));
    pz = Math.max(-boundHalf, Math.min(boundHalf, pz));
  }

  return { x: px, z: pz };
}

/**
 * Calcola la minima penetrazione su qualsiasi cella muro (utile per test e drop sicuri).
 */
export function getMaxWallPenetration(maze, x, z, radius = CONFIG.PLAYER_RADIUS) {
  const cellSize = maze.cellSize;
  const halfCell = cellSize * 0.5;
  const mid = maze.mid;
  const gx0 = Math.round(x / cellSize + mid);
  const gz0 = Math.round(z / cellSize + mid);
  let maxPen = 0;

  for (let oz = -1; oz <= 1; oz++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = gx0 + ox;
      const gz = gz0 + oz;
      if (!maze.isWall(gx, gz)) continue;
      const cx = (gx - mid) * cellSize;
      const cz = (gz - mid) * cellSize;
      const closestX = Math.max(cx - halfCell, Math.min(cx + halfCell, x));
      const closestZ = Math.max(cz - halfCell, Math.min(cz + halfCell, z));
      const dist = Math.hypot(x - closestX, z - closestZ);
      const pen = radius - dist;
      if (pen > maxPen) maxPen = pen;
    }
  }
  return maxPen;
}

/**
 * Trova una posizione calpestabile sicura vicina a (x, z) per droppare i fogli alla morte
 * evitando di far cadere un foglio dentro un muro.
 */
export function findSafeDropPosition(maze, x, z, offsetRadius = 1.0, angleRad = 0) {
  const tx = x + Math.cos(angleRad) * offsetRadius;
  const tz = z + Math.sin(angleRad) * offsetRadius;
  const resolved = resolveMazeCollision(maze, x, z, tx, tz, 0.45);
  const cell = maze.worldToCell(resolved.x, resolved.z);
  if (!maze.isWall(cell.gx, cell.gz)) {
    return resolved;
  }
  // Fallback su cella libera piu' vicina
  let best = maze.floorCells[0];
  let bestD = Infinity;
  for (const fc of maze.floorCells) {
    const d = Math.hypot(fc.x - x, fc.z - z);
    if (d < bestD) {
      bestD = d;
      best = fc;
    }
  }
  return { x: best.x, z: best.z };
}
