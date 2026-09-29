/*
 * One-way importer for the legacy MySQL schema. It deliberately never imports
 * legacy plain-text or weak password hashes. Such accounts are marked for a
 * secure password reset after the provider-backed reset flow is configured.
 */
import "dotenv/config";
import crypto from "crypto";
import bcrypt from "bcrypt";
import mysql from "mysql2/promise";
import mongoose from "mongoose";
import { Bet, GameRound, PaymentRequest, User, WalletTransaction } from "../models/index.js";

const required = ["MONGODB_URI", "MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);

const asNumber = (value) => Math.max(0, Number(value) || 0);
const asDate = (value) => value ? new Date(Number(value) > 1_000_000_000_000 ? Number(value) : Number(value) * 1000) : new Date();
const hashSeed = (seed) => crypto.createHash("sha256").update(seed).digest("hex");
const ref = (prefix, id) => `${prefix}-LEGACY-${id}`;

const mysqlConnection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
await mongoose.connect(process.env.MONGODB_URI);

async function tableRows(query) {
  try {
    const [rows] = await mysqlConnection.query(query);
    return rows;
  } catch (error) {
    if (error.code === "ER_NO_SUCH_TABLE") return [];
    throw error;
  }
}

const legacyUsers = await tableRows("SELECT * FROM users");
const byLegacyPhone = new Map();
for (const row of legacyUsers) {
  const phone = row.phone ? String(row.phone) : undefined;
  const email = row.email ? String(row.email).trim().toLowerCase() : undefined;
  const lookup = phone ? { phone } : { email };
  if (!phone && !email) continue;
  const oldHash = String(row.password || "");
  const canRetainBcrypt = /^\$2[aby]\$/.test(oldHash);
  const user = await User.findOneAndUpdate(
    lookup,
    {
      $set: {
        name: String(row.name_user || row.username || phone || email).slice(0, 80),
        email,
        phone,
        passwordHash: canRetainBcrypt ? oldHash : await bcrypt.hash(crypto.randomUUID(), 12),
        mustResetPassword: !canRetainBcrypt,
        referralCode: String(row.code || `LG${crypto.randomBytes(4).toString("hex")}`).toUpperCase(),
        role: Number(row.level) === 1 ? "manager" : "player",
        status: Number(row.status) === 2 ? "suspended" : "active",
        wallet: {
          cash: asNumber(row.money),
          bonus: asNumber(row.bonus_money),
          currency: "INR",
          lifetimeDeposits: asNumber(row.total_money),
          lifetimeWithdrawals: 0,
          lifetimeWagered: 0,
        },
        createdAt: asDate(row.time),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  byLegacyPhone.set(phone, { id: user.id, invite: row.invite });
}

for (const { id, invite } of byLegacyPhone.values()) {
  if (!invite) continue;
  const parent = await User.findOne({ referralCode: String(invite).toUpperCase() });
  if (parent) await User.updateOne({ _id: id }, { $set: { referredBy: parent.id } });
}

const importPayments = async (table, type) => {
  const rows = await tableRows(`SELECT * FROM \`${table}\``);
  for (const row of rows) {
    const user = byLegacyPhone.get(String(row.phone));
    if (!user) continue;
    const status = Number(row.status) === 1 ? (type === "withdrawal" ? "paid" : "approved") : "rejected";
    const reference = ref(type === "deposit" ? "DEP" : "WDL", row.id);
    const request = await PaymentRequest.findOneAndUpdate(
      { reference },
      { $setOnInsert: { user: user.id, type, amount: asNumber(row.money), channel: "manual", status, reference, createdAt: asDate(row.time), reviewedAt: asDate(row.time) } },
      { new: true, upsert: true },
    );
    if (status === "approved" || status === "paid") {
      await WalletTransaction.updateOne(
        { reference, user: user.id },
        { $setOnInsert: { user: user.id, request: request.id, type, direction: type === "deposit" ? "credit" : "debit", amount: asNumber(row.money), balanceAfter: 0, reference, description: `Imported legacy ${type}`, createdAt: asDate(row.time) } },
        { upsert: true },
      );
    }
  }
};

await importPayments("recharge", "deposit");
await importPayments("withdraw", "withdrawal");

const legacyBets = await tableRows("SELECT * FROM minutes_1");
for (const row of legacyBets) {
  const user = byLegacyPhone.get(String(row.phone));
  if (!user) continue;
  const game = "wingo-1m";
  const period = `legacy-${row.period || row.id}`;
  const seed = `imported-${period}`;
  const round = await GameRound.findOneAndUpdate(
    { game, period },
    { $setOnInsert: { game, period, opensAt: asDate(row.time), closesAt: asDate(row.time), state: "settled", serverSeed: seed, serverSeedHash: hashSeed(seed), outcome: { imported: true }, settledAt: asDate(row.time) } },
    { new: true, upsert: true },
  );
  await Bet.updateOne(
    { user: user.id, round: round.id, selection: String(row.game || row.bet || "legacy"), createdAt: asDate(row.time) },
    { $setOnInsert: { user: user.id, round: round.id, game, selection: String(row.game || row.bet || "legacy"), amount: asNumber(row.money), odds: 0, payout: Number(row.status) === 1 ? asNumber(row.money) : 0, status: Number(row.status) === 1 ? "won" : "lost", settledAt: asDate(row.time), createdAt: asDate(row.time) } },
    { upsert: true },
  );
}

console.log(`Imported ${legacyUsers.length} users, ${legacyBets.length} Win Go bet records, and legacy payment records.`);
await mysqlConnection.end();
await mongoose.disconnect();
