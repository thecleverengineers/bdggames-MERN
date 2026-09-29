import crypto from "crypto";
import { Bet, GameRound } from "../models/index.js";
import { createReference, creditWallet } from "./wallet.js";

export const GAMES = [
  { id: "wingo-1m", name: "Win Go", category: "Lottery", intervalMs: 60_000, image: "/images/logo-wingo.webp", choices: ["green", "red", "violet", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] },
  { id: "k3-1m", name: "K3 Dice", category: "Lottery", intervalMs: 60_000, image: "/images/lottery79.jpg", choices: ["small", "big", "sum-3", "sum-18"] },
  { id: "five-d-1m", name: "5D", category: "Lottery", intervalMs: 60_000, image: "/images/espgame3.png", choices: [] },
  { id: "aviator", name: "Aviator", category: "Partner game", image: "/games_icons/aviator_icon.jpeg", external: true },
  { id: "jili", name: "JILI Slots", category: "Partner game", image: "/images/casino.webp", external: true },
  { id: "jdb", name: "JDB Games", category: "Partner game", image: "/images/fishing.webp", external: true },
];

const config = (game) => GAMES.find((item) => item.id === game);
const period = (game, closesAt) => `${game}-${Math.floor(closesAt.getTime() / 1000)}`;
const seedHash = (seed) => crypto.createHash("sha256").update(seed).digest("hex");

function closeTime(game) {
  const now = Date.now();
  const intervalMs = config(game).intervalMs;
  return new Date(Math.floor(now / intervalMs + 1) * intervalMs);
}

export async function getOpenRound(game) {
  const gameConfig = config(game);
  if (!gameConfig || gameConfig.external) return null;
  const now = new Date();
  let round = await GameRound.findOne({ game, state: "open", closesAt: { $gt: now } }).sort({ closesAt: 1 });
  if (round) return round;
  const closesAt = closeTime(game);
  const opensAt = new Date(closesAt.getTime() - gameConfig.intervalMs);
  const serverSeed = crypto.randomBytes(32).toString("hex");
  try {
    round = await GameRound.create({ game, period: period(game, closesAt), opensAt, closesAt, serverSeed, serverSeedHash: seedHash(serverSeed) });
  } catch (error) {
    if (error.code === 11000) return GameRound.findOne({ game, state: "open" }).sort({ closesAt: 1 });
    throw error;
  }
  return round;
}

export function gameOutcome(game, serverSeed) {
  const digest = crypto.createHash("sha256").update(serverSeed).digest();
  if (game === "wingo-1m") return { number: digest[0] % 10 };
  if (game === "k3-1m") return { dice: [digest[0] % 6 + 1, digest[1] % 6 + 1, digest[2] % 6 + 1] };
  return { number: [...digest.subarray(0, 5)].map((byte) => byte % 10).join("") };
}

export function resolveSelection(game, selection, outcome) {
  if (game === "wingo-1m") {
    const number = outcome.number;
    if (selection === String(number)) return 9;
    if (selection === "green" && [1, 3, 7, 9].includes(number)) return 1.95;
    if (selection === "red" && [2, 4, 6, 8].includes(number)) return 1.95;
    if (selection === "violet" && [0, 5].includes(number)) return 4.5;
    return 0;
  }
  if (game === "k3-1m") {
    const sum = outcome.dice.reduce((total, die) => total + die, 0);
    if (selection === "small" && sum <= 10) return 1.9;
    if (selection === "big" && sum >= 11) return 1.9;
    if (selection === `sum-${sum}`) return sum === 3 || sum === 18 ? 150 : 18;
    return 0;
  }
  return selection === outcome.number ? 9_000 : 0;
}

export async function settleDueRounds(io) {
  const due = await GameRound.find({ state: "open", closesAt: { $lte: new Date() } }).select("+serverSeed");
  for (const round of due) {
    const outcome = gameOutcome(round.game, round.serverSeed);
    const claimed = await GameRound.findOneAndUpdate({ _id: round.id, state: "open" }, { $set: { state: "closed", outcome } }, { new: true });
    if (!claimed) continue;
    const bets = await Bet.find({ round: claimed.id, status: "open" });
    for (const bet of bets) {
      const odds = resolveSelection(claimed.game, bet.selection, outcome);
      const payout = Number((bet.amount * odds).toFixed(2));
      await Bet.updateOne({ _id: bet.id }, { $set: { status: payout ? "won" : "lost", odds: odds || bet.odds, payout, settledAt: new Date() } });
      if (payout) await creditWallet({ userId: bet.user, amount: payout, type: "win", reference: createReference("WIN"), gameRound: claimed.id, description: `${claimed.game} ${claimed.period} win` });
    }
    await GameRound.updateOne({ _id: claimed.id }, { $set: { state: "settled", settledAt: new Date() }, $unset: { serverSeed: 1 } });
    io?.emit("round:settled", { game: claimed.game, period: claimed.period, outcome, serverSeedHash: claimed.serverSeedHash });
  }
}

export function startGameClock(io) {
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await Promise.all(GAMES.filter((game) => !game.external).map((game) => getOpenRound(game.id)));
      await settleDueRounds(io);
    } finally {
      ticking = false;
    }
  };
  tick().catch(console.error);
  return setInterval(() => tick().catch(console.error), 1_000);
}
