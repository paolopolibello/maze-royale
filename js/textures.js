import * as THREE from '../vendor/three.module.js';

function makePixelTexture(size, drawFn) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  drawFn(ctx, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Texture pixel-art arenaria / mattoni egiziani per i muri del labirinto.
 */
export function createSandstoneWallTexture() {
  return makePixelTexture(32, (ctx, s) => {
    ctx.fillStyle = '#cf9e60';
    ctx.fillRect(0, 0, s, s);

    // Mattoni sfalsati 4 righe
    const rows = 4;
    const rowH = s / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      const offset = (r % 2) * (s / 4);
      // Fughe orizzontali
      ctx.fillStyle = '#6f4821';
      ctx.fillRect(0, y, s, 1);
      ctx.fillStyle = '#e5b87b';
      ctx.fillRect(0, y + 1, s, 1);

      // Giunti verticali
      for (let x = offset; x < s; x += s / 2) {
        ctx.fillStyle = '#6f4821';
        ctx.fillRect(x % s, y, 1, rowH);
      }

      // Granelli di arenaria pixel-art
      for (let px = 2; px < s; px += 4) {
        const shade = ((px * 13 + r * 29) % 3);
        ctx.fillStyle = shade === 0 ? '#b78347' : shade === 1 ? '#ddb072' : '#9c6c34';
        ctx.fillRect((px + r * 3) % s, y + 3 + ((px * 7) % (rowH - 4)), 2, 1);
      }
    }

    // Fregio egiziano stilizzato sulla fila centrale
    ctx.fillStyle = '#8b5a27';
    ctx.fillRect(12, 11, 8, 1);
    ctx.fillRect(15, 10, 2, 4);
    ctx.fillStyle = '#ecc589';
    ctx.fillRect(4, 26, 5, 2);
  });
}

/**
 * Texture pixel-art pavimentazione in pietra/sabbia scura.
 */
export function createFloorTexture() {
  return makePixelTexture(32, (ctx, s) => {
    ctx.fillStyle = '#4c3b29';
    ctx.fillRect(0, 0, s, s);

    ctx.fillStyle = '#312519';
    ctx.fillRect(0, 0, s, 1);
    ctx.fillRect(0, 0, 1, s);
    ctx.fillRect(0, 16, s, 1);
    ctx.fillRect(16, 0, 1, s);

    for (let y = 2; y < s; y += 3) {
      for (let x = 2; x < s; x += 5) {
        const v = (x * 17 + y * 31) % 5;
        ctx.fillStyle = v === 0 ? '#5d4934' : v === 1 ? '#3b2d1f' : '#453525';
        ctx.fillRect((x + y) % s, y, 1, 1);
      }
    }
  });
}

/**
 * Texture pixel-art per le casse di rifornimento anti-camper.
 */
export function createChestTexture() {
  return makePixelTexture(16, (ctx, s) => {
    ctx.fillStyle = '#6f4320';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#472810';
    ctx.fillRect(0, 6, s, 2);
    ctx.fillStyle = '#eab308';
    ctx.fillRect(0, 0, s, 1);
    ctx.fillRect(0, s - 1, s, 1);
    ctx.fillRect(0, 0, 1, s);
    ctx.fillRect(s - 1, 0, 1, s);
    ctx.fillRect(6, 5, 4, 4);
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(7, 6, 2, 2);
  });
}

/**
 * Texture pixel-art per la porta centrale d'uscita.
 */
export function createDoorTexture() {
  return makePixelTexture(32, (ctx, s) => {
    ctx.fillStyle = '#31233f';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#a855f7';
    ctx.fillRect(2, 2, s - 4, 2);
    ctx.fillRect(2, s - 4, s - 4, 2);
    ctx.fillRect(2, 2, 2, s - 4);
    ctx.fillRect(s - 4, 2, 2, s - 4);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(12, 8, 8, 16);
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(14, 14, 4, 4);
  });
}

/**
 * Texture pixel-art per ciascuno dei 5 fogli con simbolo astratto e numero slot.
 */
export function createPageTexture(symbol, slotNumber) {
  return makePixelTexture(64, (ctx, s) => {
    ctx.fillStyle = '#e7d5a8';
    ctx.fillRect(6, 4, s - 12, s - 8);
    ctx.fillStyle = '#c4a66a';
    ctx.fillRect(6, 4, s - 12, 3);
    ctx.fillRect(6, s - 7, s - 12, 3);
    ctx.fillRect(6, 4, 3, s - 8);
    ctx.fillRect(s - 9, 4, 3, s - 8);

    ctx.fillStyle = '#1e1b4b';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(symbol, s / 2, s / 2 + 4);

    ctx.fillStyle = '#7c2d12';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`#${slotNumber}`, s / 2, 15);
  });
}
