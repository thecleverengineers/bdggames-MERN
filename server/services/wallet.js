import crypto from "crypto";
import { AppError } from "../lib/http.js";
import { User, WalletTransaction } from "../models/index.js";

const round = (value) => Number(Number(value).toFixed(2));
export const createReference = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

export async function creditWallet({ userId, amount, type, reference, description, request, gameRound, metadata = {} }) {
  const value = round(amount);
  if (!(value > 0)) throw new AppError("Amount must be greater than zero");
  const user = await User.findByIdAndUpdate(userId, { $inc: { "wallet.cash": value } }, { new: true });
  if (!user) throw new AppError("Account not found", 404, "USER_NOT_FOUND");
  await WalletTransaction.create({ user: user.id, type, direction: "credit", amount: value, balanceAfter: user.wallet.cash, reference, description, request, gameRound, metadata });
  return user;
}

export async function debitWallet({ userId, amount, type, reference, description, request, gameRound, metadata = {}, wager = false }) {
  const value = round(amount);
  if (!(value > 0)) throw new AppError("Amount must be greater than zero");
  const update = { $inc: { "wallet.cash": -value } };
  if (wager) update.$inc["wallet.lifetimeWagered"] = value;
  const user = await User.findOneAndUpdate({ _id: userId, "wallet.cash": { $gte: value } }, update, { new: true });
  if (!user) throw new AppError("Insufficient playable balance", 409, "INSUFFICIENT_BALANCE");
  await WalletTransaction.create({ user: user.id, type, direction: "debit", amount: value, balanceAfter: user.wallet.cash, reference, description, request, gameRound, metadata });
  return user;
}

export const asMoney = round;
