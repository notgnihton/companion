import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { RuntimeStore } from "./store.js";
import { AuthSession, AuthUser } from "./types.js";

export interface AuthServiceOptions {
  required: boolean;
  adminEmail?: string;
  adminPassword?: string;
  sessionTtlHours: number;
}

export interface AuthSessionResult {
  token: string;
  expiresAt: string;
  user: AuthUser;
}

interface AuthContext {
  token: string;
  tokenHash: string;
  session: AuthSession;
  user: AuthUser;
}

const PASSWORD_HASH_KEY_LENGTH = 64;
const SESSION_TOKEN_BYTES = 32;
const SESSION_TOUCH_INTERVAL_MS = 60_000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createPasswordHash(password: string, salt?: string): string {
  const normalizedPassword = password.normalize("NFKC");
  const actualSalt = salt ?? randomBytes(16).toString("hex");
  const derived = scryptSync(normalizedPassword, actualSalt, PASSWORD_HASH_KEY_LENGTH).toString("hex");
  return `${actualSalt}:${derived}`;
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  const [salt, storedHash] = passwordHash.split(":");
  if (!salt || !storedHash) {
    return false;
  }

  const normalizedPassword = password.normalize("NFKC");
  const calculated = scryptSync(normalizedPassword, salt, PASSWORD_HASH_KEY_LENGTH);
  const stored = Buffer.from(storedHash, "hex");
  if (stored.length !== calculated.length) {
    return false;
  }

  return timingSafeEqual(stored, calculated);
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function parseBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, value] = authorizationHeader.split(" ");
  if (!scheme || !value || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  const token = value.trim();
  return token.length > 0 ? token : null;
}

export class AuthService {
  private readonly store: RuntimeStore;
  private readonly options: AuthServiceOptions;
  private readonly lastTouchedByTokenHash = new Map<string, number>();

  constructor(store: RuntimeStore, options: AuthServiceOptions) {
    this.store = store;
    this.options = options;
  }

  isRequired(): boolean {
    return this.options.required;
  }

  bootstrapAdminUser(): AuthUser | null {
    const adminEmail = this.options.adminEmail ? normalizeEmail(this.options.adminEmail) : "";
    const adminPassword = this.options.adminPassword ?? "";

    if (!adminEmail || !adminPassword) {
      if (this.options.required) {
        console.warn(
          "[auth] Authentication is enabled but AUTH_ADMIN_EMAIL / AUTH_ADMIN_PASSWORD are not set. " +
            "Admin user will not be created — users can still log in via OAuth providers."
        );
      }
      return null;
    }

    const passwordHash = createPasswordHash(adminPassword);
    return this.store.upsertUserByEmail({
      email: adminEmail,
      passwordHash,
      role: "admin"
    });
  }

  login(email: string, password: string): AuthSessionResult | null {
    const normalizedEmail = normalizeEmail(email);
    this.store.deleteExpiredAuthSessions();

    const user = this.store.getUserByEmail(normalizedEmail);
    if (!user) {
      return null;
    }

    if (!verifyPassword(password, user.passwordHash)) {
      return null;
    }

    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + this.options.sessionTtlHours * 60 * 60 * 1000).toISOString();
    this.store.createAuthSession({
      userId: user.id,
      tokenHash,
      expiresAt
    });

    return {
      token,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        provider: user.provider,
        role: user.role,
        plan: user.plan,
        trialEndsAt: user.trialEndsAt,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    };
  }

  authenticateFromAuthorizationHeader(authorizationHeader: string | undefined): AuthContext | null {
    const token = parseBearerToken(authorizationHeader);
    if (!token) {
      return null;
    }

    return this.authenticateToken(token);
  }

  authenticateToken(token: string): AuthContext | null {
    this.store.deleteExpiredAuthSessions();

    const tokenHash = hashSessionToken(token);
    const session = this.store.getAuthSessionByTokenHash(tokenHash);
    if (!session) {
      return null;
    }

    const expiresAtMs = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      this.store.deleteAuthSessionByTokenHash(tokenHash);
      this.lastTouchedByTokenHash.delete(tokenHash);
      return null;
    }

    const user = this.store.getUserById(session.userId);
    if (!user) {
      this.store.deleteAuthSessionByTokenHash(tokenHash);
      this.lastTouchedByTokenHash.delete(tokenHash);
      return null;
    }

    const nowMs = Date.now();
    const lastTouchedMs = this.lastTouchedByTokenHash.get(tokenHash) ?? 0;
    if (nowMs - lastTouchedMs >= SESSION_TOUCH_INTERVAL_MS) {
      this.store.touchAuthSession(tokenHash);
      this.lastTouchedByTokenHash.set(tokenHash, nowMs);
    }

    return {
      token,
      tokenHash,
      session,
      user
    };
  }

  logout(token: string): boolean {
    const tokenHash = hashSessionToken(token);
    this.lastTouchedByTokenHash.delete(tokenHash);
    return this.store.deleteAuthSessionByTokenHash(tokenHash);
  }
}
