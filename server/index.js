import "dotenv/config";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import mongoose from "mongoose";
import morgan from "morgan";
import { Server } from "socket.io";
import { errorHandler, notFound } from "./lib/http.js";
import { requireAuth } from "./middleware/auth.js";
import apiRouter from "./routes/api.js";
import { startGameClock } from "./services/games.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const bundledAssetsDir = path.join(rootDir, "public-assets");
const legacyAssetsDir = path.join(rootDir, "src", "public");
const assetsDir = fs.existsSync(bundledAssetsDir) ? bundledAssetsDir : legacyAssetsDir;
const port = Number(process.env.PORT || 5000);
const clientOrigin = process.env.CLIENT_ORIGIN || (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : "http://localhost:5173");
const origins = clientOrigin.split(",").map((origin) => origin.trim());

if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required. Copy .env.example to an untracked .env file.");
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET must be at least 32 characters long.");

await mongoose.connect(process.env.MONGODB_URI, { autoIndex: process.env.NODE_ENV !== "production" });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: origins, credentials: true } });
app.locals.io = io;

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin(origin, callback) { if (!origin || origins.includes(origin)) return callback(null, true); return callback(new Error("Origin is not allowed by CORS")); }, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 500, standardHeaders: "draft-7", legacyHeaders: false }));

app.use("/assets", express.static(path.join(assetsDir, "assets"), { maxAge: "7d", immutable: true }));
app.use("/images", express.static(path.join(assetsDir, "images"), { maxAge: "7d" }));
app.use("/banner", express.static(path.join(assetsDir, "banner"), { maxAge: "7d" }));
app.use("/games_icons", express.static(path.join(assetsDir, "games_icons"), { maxAge: "7d" }));
app.use("/jili_games", express.static(path.join(assetsDir, "jili_games"), { maxAge: "7d" }));
app.use("/jdb_images", express.static(path.join(assetsDir, "jdb_images"), { maxAge: "7d" }));

app.use("/api", apiRouter);
io.on("connection", async (socket) => {
  try {
    const fakeRes = { cookie() {} };
    const request = { cookies: socket.handshake.headers.cookie ? Object.fromEntries(socket.handshake.headers.cookie.split("; ").map((value) => value.split("=")).filter((value) => value.length === 2)) : {}, get: () => socket.handshake.auth?.token };
    await new Promise((resolve, reject) => requireAuth(request, fakeRes, (error) => error ? reject(error) : resolve()));
    socket.join(`user:${request.user.id}`);
  } catch {
    // Anonymous clients receive public game-round events only.
  }
});

const clientDist = path.join(rootDir, "client", "dist");
app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  return res.sendFile(path.join(clientDist, "index.html"), (error) => error && next(error));
});
app.use(notFound);
app.use(errorHandler);

const gameClock = startGameClock(io);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  clearInterval(gameClock);
  await mongoose.disconnect();
  server.close(() => process.exit(0));
};
process.on("SIGTERM", close);
process.on("SIGINT", close);

server.listen(port, () => console.log(`Legend Casino API listening on http://localhost:${port}`));
