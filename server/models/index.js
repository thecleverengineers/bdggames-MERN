import mongoose from "mongoose";

const { Schema, model } = mongoose;
const money = { type: Number, required: true, min: 0 };

const userSchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 80 },
    email: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    phone: { type: String, trim: true, unique: true, sparse: true },
    passwordHash: { type: String, required: true, select: false },
    mustResetPassword: { type: Boolean, default: false },
    role: { type: String, enum: ["player", "manager", "admin"], default: "player" },
    status: { type: String, enum: ["active", "suspended", "closed"], default: "active" },
    avatar: { type: String, default: "" },
    referralCode: { type: String, trim: true, uppercase: true, unique: true, sparse: true },
    referredBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    vipLevel: { type: Number, default: 0, min: 0, max: 10 },
    wallet: {
      cash: { ...money, default: 0 },
      bonus: { ...money, default: 0 },
      currency: { type: String, default: "INR", uppercase: true },
      lifetimeDeposits: { ...money, default: 0 },
      lifetimeWithdrawals: { ...money, default: 0 },
      lifetimeWagered: { ...money, default: 0 },
    },
    kyc: {
      status: { type: String, enum: ["not_started", "pending", "verified", "rejected"], default: "not_started" },
      verifiedAt: Date,
    },
    lastLoginAt: Date,
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

userSchema.virtual("wallet.total").get(function total() {
  return Number((this.wallet.cash + this.wallet.bonus).toFixed(2));
});
userSchema.index({ role: 1, status: 1, createdAt: -1 });

const walletTransactionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: {
      type: String,
      enum: ["deposit", "withdrawal", "transfer_in", "transfer_out", "bet", "win", "bonus", "adjustment", "refund"],
      required: true,
    },
    direction: { type: String, enum: ["credit", "debit"], required: true },
    amount: money,
    currency: { type: String, default: "INR" },
    balanceAfter: { ...money, default: 0 },
    status: { type: String, enum: ["pending", "completed", "rejected", "cancelled"], default: "completed" },
    reference: { type: String, trim: true, index: true },
    request: { type: Schema.Types.ObjectId, ref: "PaymentRequest" },
    gameRound: { type: Schema.Types.ObjectId, ref: "GameRound" },
    description: { type: String, trim: true, maxlength: 240 },
    metadata: Schema.Types.Mixed,
  },
  { timestamps: true },
);
walletTransactionSchema.index({ user: 1, createdAt: -1 });

const paymentRequestSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["deposit", "withdrawal"], required: true },
    amount: money,
    currency: { type: String, default: "INR" },
    channel: { type: String, enum: ["manual", "upi", "bank", "crypto"], default: "manual" },
    status: { type: String, enum: ["pending", "approved", "rejected", "paid", "cancelled"], default: "pending", index: true },
    reference: { type: String, required: true, unique: true, index: true },
    destination: Schema.Types.Mixed,
    note: { type: String, trim: true, maxlength: 500 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
  },
  { timestamps: true },
);
paymentRequestSchema.index({ type: 1, status: 1, createdAt: -1 });

const gameRoundSchema = new Schema(
  {
    game: { type: String, required: true, index: true },
    period: { type: String, required: true },
    opensAt: { type: Date, required: true },
    closesAt: { type: Date, required: true, index: true },
    state: { type: String, enum: ["open", "closed", "settled"], default: "open", index: true },
    serverSeed: { type: String, required: true, select: false },
    serverSeedHash: { type: String, required: true },
    outcome: Schema.Types.Mixed,
    settledAt: Date,
  },
  { timestamps: true },
);
gameRoundSchema.index({ game: 1, period: 1 }, { unique: true });

const betSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    round: { type: Schema.Types.ObjectId, ref: "GameRound", required: true, index: true },
    game: { type: String, required: true, index: true },
    selection: { type: String, required: true, trim: true, maxlength: 50 },
    amount: money,
    odds: { type: Number, required: true, min: 1 },
    payout: { ...money, default: 0 },
    status: { type: String, enum: ["open", "won", "lost", "void"], default: "open", index: true },
    settledAt: Date,
  },
  { timestamps: true },
);
betSchema.index({ user: 1, createdAt: -1 });

const promotionClaimSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["daily_checkin", "welcome", "referral", "vip"], required: true },
    claimKey: { type: String, required: true },
    amount: money,
  },
  { timestamps: true },
);
promotionClaimSchema.index({ user: 1, type: 1, claimKey: 1 }, { unique: true });

const auditLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: "User" },
    action: { type: String, required: true, index: true },
    subject: Schema.Types.Mixed,
    ip: String,
    metadata: Schema.Types.Mixed,
  },
  { timestamps: true },
);

export const User = model("User", userSchema);
export const WalletTransaction = model("WalletTransaction", walletTransactionSchema);
export const PaymentRequest = model("PaymentRequest", paymentRequestSchema);
export const GameRound = model("GameRound", gameRoundSchema);
export const Bet = model("Bet", betSchema);
export const PromotionClaim = model("PromotionClaim", promotionClaimSchema);
export const AuditLog = model("AuditLog", auditLogSchema);
