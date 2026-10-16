// 戦場の下見：領の戦場マップを小さな絵にする（戦略の画面の、領の欄に出す）。
// 戦場の淡い塗り（TERRAIN_WASH）は小さくすると見分けにくいので、下見は濃いめの色で塗る。

import type { BattleMap } from '../battle/map';
import type { TerrainKind } from '../data/types';

const COLOR: Record<TerrainKind, string> = {
  plain: '#d8d0a2', road: '#c4a46a', bridge: '#9c7444', forest: '#6e8c58', mountain: '#8c7f6a', swamp: '#7d988a', water: '#6a98b6',
  castle: '#b23a2c', town: '#c8885a', cliff: '#544a42', camp: '#d2a23c', fort: '#9c5636', paddy: '#a2bd6c', wall: '#3e3834', gate: '#b8b0a0', tower: '#6a4c38', desert: '#e0c486', snowfield: '#f2f4f4', void: 'transparent',
};
/** 下見の中に字を添えるマス */
const MARK: Partial<Record<TerrainKind, string>> = { castle: '城', fort: '砦', camp: '陣', town: '街', gate: '門' };

/** 下見の絵（data URL）。size はマスの中心から角までの長さ */
export function mapPreviewUrl(m: BattleMap, size = 10): string {
  const g = m.grid, [w, h] = g.pixelSize(size);
  const scale = Math.min(2, Math.max(1, Math.round(window.devicePixelRatio || 1)));
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w * scale); cv.height = Math.ceil(h * scale);
  const ctx = cv.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(size * 1.05)}px serif`;
  for (let i = 0; i < g.n; i++) {
    const [x, y] = g.center(i, size), k = m.terrain[i];
    if (k === 'void') continue;
    ctx.beginPath();
    for (let a = 0; a < 6; a++) {
      const t = (Math.PI / 3) * a;
      const px = x + size * Math.cos(t), py = y + size * Math.sin(t);
      if (a) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = COLOR[k];
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,30,20,0.25)'; ctx.lineWidth = 0.6; ctx.stroke();
    const mark = MARK[k];
    if (mark) { ctx.fillStyle = k === 'gate' || k === 'camp' ? '#2a2018' : '#fff6e6'; ctx.fillText(mark, x, y + 0.5); }
  }
  // 攻め手の入ってくる所：配置場所のまん中に「攻」
  const zone = m.spawn[0];
  if (zone.length) {
    let ax = 0, ay = 0;
    for (const i of zone) { const [x, y] = g.center(i, size); ax += x; ay += y; }
    ax /= zone.length; ay /= zone.length;
    ctx.beginPath(); ctx.arc(ax, ay, size * 0.95, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(178,58,44,0.92)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff6e6'; ctx.stroke();
    ctx.fillStyle = '#fff6e6'; ctx.font = `bold ${Math.round(size * 1.05)}px serif`; ctx.fillText('攻', ax, ay + 0.5);
  }
  const url = cv.toDataURL('image/png');
  cv.width = cv.height = 0;
  return url;
}
