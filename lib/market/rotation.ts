import type { Candle } from "../types";

/**
 * Momentum Rotation: hold the strongest risk-adjusted performers while BTC is above its long
 * moving average, otherwise hold cash. Signals use only daily candles closed at the rebalance.
 */
export interface RotationParams { lookbackDays: number; holdings: number; regimeSma: number; rebalanceDays: number }
export interface RotationPick { symbol: string; momentumPct: number; volatilityPct: number; score: number; weight: number }
export interface RotationSignal { asOf: string; params: RotationParams; regimeOn: boolean; btcClose: number | null; btcSma: number | null; picks: RotationPick[]; ranked: RotationPick[] }
export interface RotationBacktest {
  params: RotationParams; start: string; end: string; rebalances: number; totalReturnPct: number; btcReturnPct: number; maxDrawdownPct: number;
  sharpe: number | null; exposurePct: number; costBps: number; equity: { time: string; value: number; btc: number }[];
}

const DAY = 86_400_000;
/** Small predeclared grid; the trainer chooses from it on the training window only. */
export const ROTATION_GRID: RotationParams[] = [14, 28, 56].flatMap(lookbackDays => [3, 5].map(holdings => ({ lookbackDays, holdings, regimeSma: 100, rebalanceDays: 7 })));
export const DEFAULT_ROTATION: RotationParams = { lookbackDays: 28, holdings: 3, regimeSma: 100, rebalanceDays: 7 };

const sma = (values: number[], period: number) => values.length >= period ? values.slice(-period).reduce((s, v) => s + v, 0) / period : null;

/** Rank by momentum divided by realized volatility; require positive momentum and a close above SMA50. */
export function rotationSignal(daily: Record<string, Candle[]>, asOf: number, params: RotationParams = DEFAULT_ROTATION): RotationSignal {
  const closedAt = (candles: Candle[]) => candles.filter(candle => candle.closeTime < asOf);
  const btc = closedAt(daily.BTCUSDT ?? []).map(candle => candle.close);
  const btcSma = sma(btc, params.regimeSma), btcClose = btc.at(-1) ?? null;
  const regimeOn = btcSma !== null && btcClose !== null && btcClose > btcSma;
  const ranked: RotationPick[] = [];
  for (const [symbol, candles] of Object.entries(daily)) {
    const closes = closedAt(candles).map(candle => candle.close);
    if (closes.length < Math.max(params.lookbackDays + 1, 51)) continue;
    const window = closes.slice(-(params.lookbackDays + 1));
    const returns = window.slice(1).map((close, i) => Math.log(close / window[i]));
    const meanReturn = returns.reduce((s, v) => s + v, 0) / returns.length;
    const volatility = Math.sqrt(returns.reduce((s, v) => s + (v - meanReturn) ** 2, 0) / returns.length);
    const momentum = window.at(-1)! / window[0] - 1;
    if (!(volatility > 0) || momentum <= 0 || closes.at(-1)! <= sma(closes, 50)!) continue;
    ranked.push({ symbol, momentumPct: momentum * 100, volatilityPct: volatility * 100, score: momentum / (volatility * Math.sqrt(params.lookbackDays)), weight: 0 });
  }
  ranked.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  const picks = regimeOn ? ranked.slice(0, params.holdings).map(pick => ({ ...pick })) : [];
  // Inverse-volatility weights keep each holding's risk contribution comparable.
  const inverse = picks.reduce((s, pick) => s + 1 / pick.volatilityPct, 0);
  for (const pick of picks) pick.weight = 1 / pick.volatilityPct / inverse;
  return { asOf: new Date(asOf).toISOString(), params, regimeOn, btcClose, btcSma, picks, ranked: ranked.slice(0, 10) };
}

/** Daily close-to-close portfolio simulation with turnover costs; weights change only at rebalance closes. */
export function backtestRotation(daily: Record<string, Candle[]>, start: number, end: number, params: RotationParams, costBps = 15): RotationBacktest {
  const closeOf = new Map(Object.entries(daily).map(([symbol, candles]) => [symbol, new Map(candles.map(candle => [candle.closeTime + 1, candle.close]))]));
  const firstDay = Math.ceil(start / DAY) * DAY, lastDay = Math.floor(end / DAY) * DAY;
  let equity = 1, btcEquity = 1, peak = 1, drawdown = 0, rebalances = 0, invested = 0, days = 0;
  let weights = new Map<string, number>();
  const curve: RotationBacktest["equity"] = [], dailyReturns: number[] = [];
  const btcStart = closeOf.get("BTCUSDT")?.get(firstDay) ?? null;
  for (let day = firstDay, step = 0; day <= lastDay; day += DAY, step++) {
    if (step > 0) {
      let portfolio = 0;
      for (const [symbol, weight] of weights) {
        const today = closeOf.get(symbol)?.get(day), yesterday = closeOf.get(symbol)?.get(day - DAY);
        if (today && yesterday) portfolio += weight * (today / yesterday - 1);
      }
      equity *= 1 + portfolio; dailyReturns.push(portfolio); days++;
      if (weights.size) invested++;
      const btcToday = closeOf.get("BTCUSDT")?.get(day);
      if (btcToday && btcStart) btcEquity = btcToday / btcStart;
    }
    if (step % params.rebalanceDays === 0) {
      const signal = rotationSignal(daily, day, params);
      const next = new Map(signal.picks.map(pick => [pick.symbol, pick.weight]));
      let turnover = 0;
      for (const symbol of new Set([...weights.keys(), ...next.keys()])) turnover += Math.abs((next.get(symbol) ?? 0) - (weights.get(symbol) ?? 0));
      equity *= 1 - turnover * costBps / 10_000;
      if (turnover > 0) rebalances++;
      weights = next;
    }
    peak = Math.max(peak, equity); drawdown = Math.max(drawdown, (peak - equity) / peak * 100);
    curve.push({ time: new Date(day).toISOString(), value: equity, btc: btcEquity });
  }
  const meanDaily = dailyReturns.length ? dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length : 0;
  const sd = dailyReturns.length > 1 ? Math.sqrt(dailyReturns.reduce((s, v) => s + (v - meanDaily) ** 2, 0) / (dailyReturns.length - 1)) : 0;
  return { params, start: new Date(firstDay).toISOString(), end: new Date(lastDay).toISOString(), rebalances, totalReturnPct: (equity - 1) * 100, btcReturnPct: (btcEquity - 1) * 100,
    maxDrawdownPct: drawdown, sharpe: sd > 0 ? meanDaily / sd * Math.sqrt(365) : null, exposurePct: days ? invested / days * 100 : 0, costBps,
    equity: curve.filter((_, i) => i % 2 === 0 || i === curve.length - 1) };
}

/** Pick the training-window parameter set with the best Sharpe among those that actually traded. */
export function chooseRotation(daily: Record<string, Candle[]>, start: number, end: number): { params: RotationParams; train: RotationBacktest; grid: Omit<RotationBacktest, "equity">[] } {
  const results = ROTATION_GRID.map(params => backtestRotation(daily, start, end, params));
  const eligible = results.filter(result => result.rebalances >= 10 && result.sharpe !== null);
  const best = (eligible.length ? eligible : results).sort((a, b) => (b.sharpe ?? -99) - (a.sharpe ?? -99))[0];
  return { params: best.params, train: best, grid: results.map(({ equity: _equity, ...rest }) => { void _equity; return rest; }) };
}
