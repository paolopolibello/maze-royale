import { CONFIG } from './config.js';

/**
 * Raycast deterministico 2D su griglia (algoritmo Amanatides-Woo DDA).
 * Verifica la linea di vista diretta (Line of Sight) tra due punti nel labirinto.
 * Restituisce true solo se nessuna cella muro blocca il segmento (x0, z0) -> (x1, z1).
 */
export function hasLineOfSight(maze, x0, z0, x1, z1) {
  const cellSize = maze.cellSize;
  const mid = maze.mid;
  const offset = (mid + 0.5) * cellSize; // Mappa x -> grid float in [0, N]

  const fx0 = (x0 + offset) / cellSize;
  const fz0 = (z0 + offset) / cellSize;
  const fx1 = (x1 + offset) / cellSize;
  const fz1 = (z1 + offset) / cellSize;

  let gx = Math.floor(fx0);
  let gz = Math.floor(fz0);
  const endGx = Math.floor(fx1);
  const endGz = Math.floor(fz1);

  if (maze.isWall(gx, gz) || maze.isWall(endGx, endGz)) {
    return false;
  }

  const dx = fx1 - fx0;
  const dz = fz1 - fz0;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return true;

  const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
  const stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;

  let tMaxX = stepX > 0
    ? (Math.floor(fx0) + 1 - fx0) * tDeltaX
    : stepX < 0
      ? (fx0 - Math.floor(fx0)) * tDeltaX
      : Infinity;

  let tMaxZ = stepZ > 0
    ? (Math.floor(fz0) + 1 - fz0) * tDeltaZ
    : stepZ < 0
      ? (fz0 - Math.floor(fz0)) * tDeltaZ
      : Infinity;

  const maxSteps = Math.abs(endGx - gx) + Math.abs(endGz - gz) + 4;
  for (let i = 0; i < maxSteps; i++) {
    if (gx === endGx && gz === endGz) return true;
    if (Math.min(tMaxX, tMaxZ) > 1.0) return true;

    if (Math.abs(tMaxX - tMaxZ) < 1e-6) {
      // Passa esattamente su un vertice: entrambi i lati contigui devono essere percorribili per evitare leak agli angoli
      if (maze.isWall(gx + stepX, gz) && maze.isWall(gx, gz + stepZ)) {
        return false;
      }
      gx += stepX;
      gz += stepZ;
      tMaxX += tDeltaX;
      tMaxZ += tDeltaZ;
    } else if (tMaxX < tMaxZ) {
      if (tMaxX > 1.0) return true;
      gx += stepX;
      tMaxX += tDeltaX;
    } else {
      if (tMaxZ > 1.0) return true;
      gz += stepZ;
      tMaxZ += tDeltaZ;
    }

    if (maze.isWall(gx, gz)) {
      return false;
    }
  }

  return true;
}

/**
 * Un nemico/avversario e' visibile e attivo SOLO se si trova dentro il raggio della torcia
 * del giocatore E c'e' linea di vista diretta priva di muri.
 */
export function isIlluminatedWithLoS(maze, viewerX, viewerZ, targetX, targetZ, range = CONFIG.TORCH_RANGE) {
  const dist = Math.hypot(targetX - viewerX, targetZ - viewerZ);
  if (dist > range) return false;
  return hasLineOfSight(maze, viewerX, viewerZ, targetX, targetZ);
}
