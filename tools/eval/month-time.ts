// 月送りの時間を測る（観戦・12か月）。使い方：npx vite-node tools/eval/month-time.ts
import { convert } from '../../src/convert/convert';
import { autoMonth, newCampaign } from '../../src/strategy/campaign';
import { sampleRealms } from '../../src/strategy/chronicle';
import { loadFixture } from '../../tests/helpers';

const save = await loadFixture('sengoku_fid5_1575');
for (let run = 0; run < 2; run++) {
  const gs = convert(save), c = newCampaign(gs, save.world, 0);
  const t0 = performance.now();
  for (let m = 0; m < 12; m++) autoMonth(c);
  const t1 = performance.now();
  let s = 0;
  for (let m = 0; m < 12; m++) { const a = performance.now(); sampleRealms(c); s += performance.now() - a; }
  console.log(`12か月 ${Math.round(t1 - t0)}ms　家の記録12回 ${s.toFixed(1)}ms　記録 ${c.log.length}件`);
}
