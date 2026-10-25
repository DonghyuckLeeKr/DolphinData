// Tray icon drawn as a tiny water tank: the level is the selected plan's remaining data,
// the colour follows the forecast status, and the dolphin swims at the surface.

import { DOLPHIN_BODY_PATH, DOLPHIN_FIN_PATH } from '../utils/dolphinShape.js';

export const TRAY_ICON_SIZE = 32;
// 4% steps are about one pixel of water at 32px, so finer updates would be invisible.
const LEVEL_STEPS = 25;

const TRAY_COLORS = {
  tank: '#04173f',
  ring: '#3a9dfd',
  dolphin: '#e6f2ff',
  water: {
    safe: ['#18e3ef', '#0b4fc0'],
    tight: ['#fcd34d', '#b45309'],
    over: ['#fb7185', '#9f1239'],
    exhausted: ['#fb7185', '#9f1239']
  }
};

export const quantizeLevel = remainingRatio => {
  const ratio = Math.min(1, Math.max(0, Number(remainingRatio) || 0));
  // Any data left keeps at least one step so a nearly empty plan never looks fully drained.
  return ratio > 0 ? Math.max(1, Math.round(ratio * LEVEL_STEPS)) / LEVEL_STEPS : 0;
};

// Changes only when the drawn icon would change, so the tray is not redrawn every second.
export const trayGaugeKey = ({ remainingRatio, status }) => `${status}:${quantizeLevel(remainingRatio).toFixed(2)}`;

export const drawTrayGauge = (ctx, size, { remainingRatio, status }) => {
  const level = quantizeLevel(remainingRatio);
  const [waterTop, waterBottom] = TRAY_COLORS.water[status] || TRAY_COLORS.water.safe;
  const center = size / 2;
  const radius = size / 2 - 1;
  const ringWidth = Math.max(1.5, size / 16);

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fillStyle = TRAY_COLORS.tank;
  ctx.fill();
  ctx.clip();

  const inner = radius - ringWidth / 2;
  const surfaceY = center + inner - level * inner * 2;
  if (level > 0) {
    const gradient = ctx.createLinearGradient(0, surfaceY, 0, size);
    gradient.addColorStop(0, waterTop);
    gradient.addColorStop(1, waterBottom);
    ctx.fillStyle = gradient;
    const wave = size / 20;
    ctx.beginPath();
    ctx.moveTo(0, surfaceY);
    ctx.quadraticCurveTo(size * 0.25, surfaceY - wave, size * 0.5, surfaceY);
    ctx.quadraticCurveTo(size * 0.75, surfaceY + wave, size, surfaceY);
    ctx.lineTo(size, size);
    ctx.lineTo(0, size);
    ctx.closePath();
    ctx.fill();

    // The dolphin rides the surface but stays inside the porthole near the top and bottom.
    const scale = (size * 0.68) / 100;
    const dolphinY = Math.min(Math.max(surfaceY - 2 * scale, center - inner + 27 * scale), center + inner - 10 * scale);
    if (typeof Path2D === 'function') {
      ctx.save();
      ctx.translate(center, dolphinY);
      ctx.rotate(-0.14);
      ctx.scale(scale, scale);
      // A navy outline keeps the pale dolphin readable against light cyan water as well as the dark tank.
      const body = new Path2D(DOLPHIN_BODY_PATH);
      const fin = new Path2D(DOLPHIN_FIN_PATH);
      ctx.lineJoin = 'round';
      ctx.lineWidth = (size / 20) / scale;
      ctx.strokeStyle = TRAY_COLORS.tank;
      ctx.stroke(body);
      ctx.stroke(fin);
      ctx.fillStyle = TRAY_COLORS.dolphin;
      ctx.fill(body);
      ctx.fill(fin);
      ctx.restore();
    }
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(center, center, radius - ringWidth / 2 + 0.5, 0, Math.PI * 2);
  ctx.lineWidth = ringWidth;
  ctx.strokeStyle = status === 'safe' ? TRAY_COLORS.ring : waterTop;
  ctx.stroke();
};

export const renderTrayGaugeRgba = (gauge, size = TRAY_ICON_SIZE) => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  drawTrayGauge(ctx, size, gauge);
  return Array.from(ctx.getImageData(0, 0, size, size).data);
};
