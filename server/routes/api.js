import crypto from "crypto";
import express from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { AppError, asyncHandler } from "../lib/http.js";
import { clearSession, issueToken, requireAuth, requireRole, setSession } from "../middleware/auth.js";
import { AuditLog, Bet, GameRound, PaymentRequest, PromotionClaim, User, WalletTransaction } from "../models/index.js";
import { GAMES, getOpenRound } from "../services/games.js";
import { asMoney, createReference, creditWallet, debitWallet } from "../services/wallet.js";

const router = express.Router();
const integer = z.coerce.number().finite().positive().max(1_000_000);
const appMode = () => ({ mode: process.env.APP_MODE || "demo", realMoneyEnabled: process.env.REAL_MONEY_ENABLED === "true" });

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  status: user.status,
  avatar: user.avatar,
  referralCode: user.referralCode,
  vipLevel: user.vipLevel,
  wallet: { ...user.wallet.toObject?.(), total: Number((user.wallet.cash + user.wallet.bonus).toFixed(2)) },
  kyc: user.kyc,
  createdAt: user.createdAt,
});

const audit = (req, action, subject, metadata) =>
  AuditLog.create({ actor: req.user?.id, action, subject, metadata, ip: req.ip }).catch(console.error);

const parse = (schema, value) => {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(result.error.issues[0]?.message || "Invalid input", 422, "VALIDATION_ERROR");
  return result.data;
};

const makeReferralCode = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const value = `LG${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    if (!(await User.exists({ referralCode: value }))) return value;
  }
  throw new AppError("Unable to create referral code", 500);
};

router.get("/platform", (_req, res) => res.json({ ok: true, data: { ...appMode(), currency: "INR", minimumBet: 10 } }));
router.get("/health", (_req, res) => res.json({ ok: true, data: { service: "legend-casino-api", time: new Date().toISOString() } }));

router.post("/auth/register", asyncHandler(async (req, res) => {
  const input = parse(z.object({
    name: z.string().trim().min(2).max(80),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().min(6).max(20).optional(),
    password: z.string().min(10).max(128),
    referralCode: z.string().trim().toUpperCase().max(24).optional(),
  }).refine((value) => value.email || value.phone, "Enter an email address or phone number"), req.body);
  const existing = await User.findOne({ $or: [input.email ? { email: input.email.toLowerCase() } : null, input.phone ? { phone: input.phone } : null].filter(Boolean) });
  if (existing) throw new AppError("An account already exists with those details", 409, "DUPLICATE_ACCOUNT");
  const referrer = input.referralCode ? await User.findOne({ referralCode: input.referralCode }) : null;
  if (input.referralCode && !referrer) throw new AppError("Referral code was not found", 422, "INVALID_REFERRAL");
  const user = await User.create({
    name: input.name,
    email: input.email?.toLowerCase(),
    phone: input.phone,
    passwordHash: await bcrypt.hash(input.password, 12),
    referralCode: await makeReferralCode(),
    referredBy: referrer?.id,
  });
  if (referrer) await creditWallet({ userId: referrer.id, amount: 10, type: "bonus", reference: createReference("REF"), description: "Referral welcome bonus", metadata: { registeredUser: user.id } });
  const token = issueToken(user);
  setSession(res, token);
  await audit({ ...req, user }, "user.registered", { user: user.id });
  res.status(201).json({ ok: true, data: { user: publicUser(user) } });
}));

router.post("/auth/login", asyncHandler(async (req, res) => {
  const input = parse(z.object({ identifier: z.string().trim().min(3).max(100), password: z.string().min(1).max(128) }), req.body);
  const user = await User.findOne({ $or: [{ email: input.identifier.toLowerCase() }, { phone: input.identifier }] }).select("+passwordHash");
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) throw new AppError("Incorrect sign-in details", 401, "INVALID_CREDENTIALS");
  if (user.status !== "active") throw new AppError("This account is unavailable", 403, "ACCOUNT_UNAVAILABLE");
  if (user.mustResetPassword) throw new AppError("This migrated account requires a secure password reset before sign-in", 403, "PASSWORD_RESET_REQUIRED");
  user.lastLoginAt = new Date();
  await user.save();
  setSession(res, issueToken(user));
  await audit({ ...req, user }, "user.logged_in", { user: user.id });
  res.json({ ok: true, data: { user: publicUser(user) } });
}));

router.post("/auth/logout", requireAuth, asyncHandler(async (req, res) => {
  clearSession(res);
  await audit(req, "user.logged_out", { user: req.user.id });
  res.status(204).end();
}));

router.get("/auth/me", requireAuth, (req, res) => res.json({ ok: true, data: { user: publicUser(req.user) } }));
router.patch("/auth/me", requireAuth, asyncHandler(async (req, res) => {
  const input = parse(z.object({ name: z.string().trim().min(2).max(80).optional(), avatar: z.string().url().max(500).or(z.literal("")).optional() }), req.body);
  Object.assign(req.user, input);
  await req.user.save();
  res.json({ ok: true, data: { user: publicUser(req.user) } });
}));

router.post("/auth/change-password", requireAuth, asyncHandler(async (req, res) => {
  const input = parse(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(10).max(128) }), req.body);
  const user = await User.findById(req.user.id).select("+passwordHash");
  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) throw new AppError("Current password is incorrect", 422, "INVALID_PASSWORD");
  user.passwordHash = await bcrypt.hash(input.newPassword, 12);
  await user.save();
  res.status(204).end();
}));

router.get("/wallet/summary", requireAuth, asyncHandler(async (req, res) => {
  const requests = await PaymentRequest.aggregate([{ $match: { user: req.user._id, status: "pending" } }, { $group: { _id: "$type", amount: { $sum: "$amount" } } }]);
  res.json({ ok: true, data: { wallet: publicUser(req.user).wallet, pending: Object.fromEntries(requests.map((item) => [item._id, item.amount])) } });
}));

router.get("/wallet/transactions", requireAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const transactions = await WalletTransaction.find({ user: req.user.id }).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({ ok: true, data: { transactions } });
}));

router.get("/wallet/requests", requireAuth, asyncHandler(async (req, res) => {
  const requests = await PaymentRequest.find({ user: req.user.id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ ok: true, data: { requests } });
}));

router.post("/wallet/deposits", requireAuth, asyncHandler(async (req, res) => {
  const input = parse(z.object({ amount: integer, channel: z.enum(["manual", "upi", "bank", "crypto"]).default("manual"), note: z.string().trim().max(500).optional() }), req.body);
  const request = await PaymentRequest.create({ user: req.user.id, type: "deposit", amount: asMoney(input.amount), channel: input.channel, note: input.note, reference: createReference("DEP") });
  await audit(req, "wallet.deposit_requested", { request: request.id }, { amount: request.amount, channel: request.channel });
  res.status(201).json({ ok: true, data: { request, ...appMode() } });
}));

router.post("/wallet/withdrawals", requireAuth, asyncHandler(async (req, res) => {
  const input = parse(z.object({ amount: integer, channel: z.enum(["manual", "upi", "bank", "crypto"]).default("manual"), destination: z.object({ accountName: z.string().trim().max(120).optional(), accountNumber: z.string().trim().max(100).optional(), upiId: z.string().trim().max(120).optional(), address: z.string().trim().max(200).optional() }).optional(), note: z.string().trim().max(500).optional() }), req.body);
  const { realMoneyEnabled } = appMode();
  if (realMoneyEnabled && req.user.kyc.status !== "verified") throw new AppError("Identity verification is required before withdrawal", 403, "KYC_REQUIRED");
  const reference = createReference("WDL");
  const request = await PaymentRequest.create({ user: req.user.id, type: "withdrawal", amount: asMoney(input.amount), channel: input.channel, destination: input.destination, note: input.note, reference });
  try {
    await debitWallet({ userId: req.user.id, amount: request.amount, type: "withdrawal", reference, request: request.id, description: "Withdrawal request" });
  } catch (error) {
    await PaymentRequest.deleteOne({ _id: request.id });
    throw error;
  }
  await audit(req, "wallet.withdrawal_requested", { request: request.id }, { amount: request.amount, channel: request.channel });
  res.status(201).json({ ok: true, data: { request } });
}));

router.post("/wallet/transfers", requireAuth, asyncHandler(async (req, res) => {
  const input = parse(z.object({ recipient: z.string().trim().min(3).max(100), amount: integer, note: z.string().trim().max(140).optional() }), req.body);
  const recipient = await User.findOne({ $or: [{ email: input.recipient.toLowerCase() }, { phone: input.recipient }, { referralCode: input.recipient.toUpperCase() }] });
  if (!recipient) throw new AppError("Recipient was not found", 404, "RECIPIENT_NOT_FOUND");
  if (recipient.id === req.user.id) throw new AppError("You cannot transfer to yourself", 422, "INVALID_RECIPIENT");
  const reference = createReference("TRF");
  await debitWallet({ userId: req.user.id, amount: input.amount, type: "transfer_out", reference, description: input.note || `Transfer to ${recipient.name || recipient.phone}` });
  await creditWallet({ userId: recipient.id, amount: input.amount, type: "transfer_in", reference, description: input.note || `Transfer from ${req.user.name || req.user.phone}` });
  await audit(req, "wallet.transferred", { recipient: recipient.id }, { amount: input.amount, reference });
  res.status(201).json({ ok: true, data: { reference } });
}));

router.get("/games", asyncHandler(async (_req, res) => {
  const rounds = await Promise.all(GAMES.filter((game) => !game.external).map((game) => getOpenRound(game.id)));
  res.json({ ok: true, data: { games: GAMES, rounds: rounds.map((round) => ({ id: round.id, game: round.game, period: round.period, closesAt: round.closesAt, serverSeedHash: round.serverSeedHash })) } });
}));

router.get("/games/:game/round", asyncHandler(async (req, res) => {
  const game = GAMES.find((item) => item.id === req.params.game && !item.external);
  if (!game) throw new AppError("This game is unavailable", 404, "GAME_NOT_FOUND");
  const round = await getOpenRound(game.id);
  res.json({ ok: true, data: { round: { id: round.id, game: round.game, period: round.period, opensAt: round.opensAt, closesAt: round.closesAt, serverSeedHash: round.serverSeedHash }, game } });
}));

router.post("/games/:game/bets", requireAuth, asyncHandler(async (req, res) => {
  const game = GAMES.find((item) => item.id === req.params.game && !item.external);
  if (!game) throw new AppError("This game is unavailable", 404, "GAME_NOT_FOUND");
  const input = parse(z.object({ selection: z.string().trim().min(1).max(50), amount: integer.min(10) }), req.body);
  const validChoice = game.id === "five-d-1m" ? /^\d{5}$/.test(input.selection) : game.choices.includes(input.selection);
  if (!validChoice) throw new AppError("This selection is not available for the game", 422, "INVALID_SELECTION");
  const round = await getOpenRound(game.id);
  if (round.closesAt <= new Date()) throw new AppError("The betting window has closed", 409, "ROUND_CLOSED");
  const reference = createReference("BET");
  const provisionalOdds = game.id === "wingo-1m" ? (input.selection === "violet" ? 4.5 : input.selection.length === 1 ? 9 : 1.95) : game.id === "k3-1m" ? (input.selection === "small" || input.selection === "big" ? 1.9 : 18) : 9000;
  await debitWallet({ userId: req.user.id, amount: input.amount, type: "bet", reference, gameRound: round.id, description: `${game.name} bet: ${input.selection}`, wager: true });
  try {
    const bet = await Bet.create({ user: req.user.id, round: round.id, game: game.id, selection: input.selection, amount: asMoney(input.amount), odds: provisionalOdds });
    req.app.locals.io?.to(`user:${req.user.id}`).emit("wallet:changed");
    res.status(201).json({ ok: true, data: { bet, round: { period: round.period, closesAt: round.closesAt } } });
  } catch (error) {
    await creditWallet({ userId: req.user.id, amount: input.amount, type: "refund", reference, gameRound: round.id, description: "Bet creation failed — funds returned" });
    throw error;
  }
}));

router.get("/games/history", requireAuth, asyncHandler(async (req, res) => {
  const bets = await Bet.find({ user: req.user.id }).populate("round", "period outcome serverSeedHash closesAt").sort({ createdAt: -1 }).limit(100).lean();
  res.json({ ok: true, data: { bets } });
}));

router.get("/promotions", requireAuth, asyncHandler(async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const claimedToday = await PromotionClaim.exists({ user: req.user.id, type: "daily_checkin", claimKey: today });
  const referrals = await User.countDocuments({ referredBy: req.user.id });
  res.json({ ok: true, data: { dailyCheckin: { amount: 5, claimed: Boolean(claimedToday) }, referral: { code: req.user.referralCode, signups: referrals, rewardPerSignup: 10 }, vipLevel: req.user.vipLevel } });
}));

router.post("/promotions/daily-checkin", requireAuth, asyncHandler(async (req, res) => {
  const claimKey = new Date().toISOString().slice(0, 10);
  try {
    await PromotionClaim.create({ user: req.user.id, type: "daily_checkin", claimKey, amount: 5 });
  } catch (error) {
    if (error.code === 11000) throw new AppError("Today’s reward has already been claimed", 409, "ALREADY_CLAIMED");
    throw error;
  }
  const user = await creditWallet({ userId: req.user.id, amount: 5, type: "bonus", reference: createReference("CHK"), description: "Daily check-in reward" });
  res.status(201).json({ ok: true, data: { wallet: publicUser(user).wallet, amount: 5 } });
}));

router.get("/admin/dashboard", requireAuth, requireRole("admin", "manager"), asyncHandler(async (_req, res) => {
  const [users, payments, openBets, wagered] = await Promise.all([
    User.countDocuments(),
    PaymentRequest.aggregate([{ $match: { status: "pending" } }, { $group: { _id: "$type", amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
    Bet.countDocuments({ status: "open" }),
    Bet.aggregate([{ $group: { _id: null, amount: { $sum: "$amount" }, payout: { $sum: "$payout" } } }]),
  ]);
  res.json({ ok: true, data: { users, payments: Object.fromEntries(payments.map((item) => [item._id, { count: item.count, amount: item.amount }])), openBets, wagered: wagered[0] || { amount: 0, payout: 0 } } });
}));

router.get("/admin/users", requireAuth, requireRole("admin", "manager"), asyncHandler(async (req, res) => {
  const query = String(req.query.q || "").trim();
  const filter = query ? { $or: [{ name: new RegExp(query, "i") }, { email: new RegExp(query, "i") }, { phone: new RegExp(query, "i") }, { referralCode: new RegExp(query, "i") }] } : {};
  const users = await User.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ ok: true, data: { users } });
}));

router.patch("/admin/users/:id", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const input = parse(z.object({ status: z.enum(["active", "suspended", "closed"]).optional(), role: z.enum(["player", "manager", "admin"]).optional(), kycStatus: z.enum(["not_started", "pending", "verified", "rejected"]).optional() }), req.body);
  const update = { ...input };
  if (input.kycStatus) { update["kyc.status"] = input.kycStatus; delete update.kycStatus; }
  const user = await User.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  await audit(req, "admin.user_updated", { user: user.id }, input);
  res.json({ ok: true, data: { user: publicUser(user) } });
}));

router.post("/admin/users/:id/adjustments", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const input = parse(z.object({ direction: z.enum(["credit", "debit"]), amount: integer, reason: z.string().trim().min(4).max(240) }), req.body);
  const reference = createReference("ADJ");
  const user = input.direction === "credit"
    ? await creditWallet({ userId: req.params.id, amount: input.amount, type: "adjustment", reference, description: input.reason })
    : await debitWallet({ userId: req.params.id, amount: input.amount, type: "adjustment", reference, description: input.reason });
  await audit(req, "admin.wallet_adjusted", { user: user.id }, { ...input, reference });
  res.status(201).json({ ok: true, data: { user: publicUser(user), reference } });
}));

router.get("/admin/payment-requests", requireAuth, requireRole("admin", "manager"), asyncHandler(async (req, res) => {
  const type = req.query.type;
  const status = req.query.status || "pending";
  const filter = { status };
  if (["deposit", "withdrawal"].includes(type)) filter.type = type;
  const requests = await PaymentRequest.find(filter).populate("user", "name email phone wallet kyc").sort({ createdAt: -1 }).limit(100).lean();
  res.json({ ok: true, data: { requests } });
}));

router.post("/admin/payment-requests/:id/review", requireAuth, requireRole("admin", "manager"), asyncHandler(async (req, res) => {
  const input = parse(z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(500).optional() }), req.body);
  const request = await PaymentRequest.findOne({ _id: req.params.id, status: "pending" });
  if (!request) throw new AppError("Payment request is not pending", 409, "REQUEST_NOT_PENDING");
  request.status = input.decision === "approve" ? (request.type === "withdrawal" ? "paid" : "approved") : "rejected";
  request.reviewedBy = req.user.id;
  request.reviewedAt = new Date();
  if (input.note) request.note = input.note;
  await request.save();
  if (request.type === "deposit" && input.decision === "approve") {
    await creditWallet({ userId: request.user, amount: request.amount, type: "deposit", reference: request.reference, request: request.id, description: "Deposit approved" });
    await User.updateOne({ _id: request.user }, { $inc: { "wallet.lifetimeDeposits": request.amount } });
  }
  if (request.type === "withdrawal" && input.decision === "reject") {
    await creditWallet({ userId: request.user, amount: request.amount, type: "refund", reference: request.reference, request: request.id, description: "Withdrawal request rejected — funds returned" });
  }
  if (request.type === "withdrawal" && input.decision === "approve") await User.updateOne({ _id: request.user }, { $inc: { "wallet.lifetimeWithdrawals": request.amount } });
  await audit(req, "admin.payment_reviewed", { request: request.id }, { decision: input.decision, type: request.type, amount: request.amount });
  res.json({ ok: true, data: { request } });
}));

router.get("/admin/bets", requireAuth, requireRole("admin", "manager"), asyncHandler(async (req, res) => {
  const bets = await Bet.find({}).populate("user", "name email phone").populate("round", "period outcome closesAt").sort({ createdAt: -1 }).limit(100).lean();
  res.json({ ok: true, data: { bets } });
}));

router.post("/admin/rounds/:id/settle", requireAuth, requireRole("admin"), asyncHandler(async (_req, _res) => {
  throw new AppError("Manual result selection is deliberately unavailable. Demo rounds are settled from a committed server seed.", 403, "PROVABLY_FAIR_LOCKED");
}));

export default router;
