// 天気と季節。戦いごとに、月と乱数の種から決める（同じ種なら同じ天気）。効果の大きさは data/system/combat.json の weather。

import { RNG, codeToSeed } from '../core/rng';
import { D } from '../data/db';
import type { Season, Weather } from '../data/types';

export interface Sky { weather: Weather; night: boolean }

export const WEATHERS: Weather[] = ['clear', 'rain', 'fog', 'snow'];
export const WEATHER_NAME: Record<Weather, string> = { clear: '晴れ', rain: '雨', fog: '霧', snow: '雪' };
export const SEASON_NAME: Record<Season, string> = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };

/** 月（1〜12）→ 季節。3〜5月が春 */
export function seasonOf(month: number): Season {
  const m = ((Math.round(month) - 1) % 12 + 12) % 12 + 1;
  return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter';
}

/** 月と種から、その戦いの天気と昼夜を決める。戦闘の乱数（st.rng）とは別の乱数を使う */
export function skyFor(month: number, seed: string): Sky {
  const W = D.combat.weather;
  const rng = new RNG(codeToSeed(`${seed}:sky`));
  const odds = W.odds[seasonOf(month)];
  const sum = WEATHERS.reduce((s, k) => s + (odds[k] ?? 0), 0);
  let v = rng.float() * sum, weather: Weather = 'clear';
  for (const k of WEATHERS) {
    v -= odds[k] ?? 0;
    if (v < 0) { weather = k; break; }
  }
  return { weather, night: rng.float() < W.nightChance };
}

/** 画面に出す、効果の短い説明 */
export function skyEffects(sky: Sky): string[] {
  const W = D.combat.weather;
  const sign = (v: number) => `${v >= 0 ? '+' : ''}${v}`;
  const out: string[] = [];
  if (sky.weather === 'rain') out.push(`射程2以上の技の命中${sign(W.rainRangedHit)}`, `火の技・軍略の威力${Math.round(W.rainFireMult * 100)}%`);
  if (sky.weather === 'fog') out.push(`2マス以上離れた相手への技の命中${sign(W.fogFarHit)}`);
  if (sky.weather === 'snow') out.push(`道と建物のほかは移動コスト+${W.snowMoveCost}`, `戦いの上限+${W.snowExtraRounds}巡`);
  if (sky.night) out.push(`技の命中${sign(W.nightHit)}`);
  return out;
}

/** 「雨・夜」のような短い名前 */
export function skyLabel(sky: Sky): string {
  return WEATHER_NAME[sky.weather] + (sky.night ? '・夜' : '');
}
