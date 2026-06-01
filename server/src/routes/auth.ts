import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users, teamMembers, teams } from '../db/schema.js';
import { HttpError } from '../middleware/error.js';
import { requireAuth, signToken } from '../middleware/auth.js';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(120),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function loadProfile(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new HttpError(404, 'User not found');

  const memberships = await db
    .select({ teamId: teams.id, teamName: teams.name, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.userId, userId));

  const teamsList = memberships.map((m) => ({
    id: m.teamId,
    name: m.teamName,
    role: m.role,
  }));

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    teams: teamsList,
    // Legacy fields — kept for backwards compatibility while the client
    // migrates to the multi-team API.
    teamId: teamsList[0]?.id ?? null,
    teamName: teamsList[0]?.name ?? null,
  };
}

authRouter.post('/register', async (req, res) => {
  const { email, password, name } = registerSchema.parse(req.body);
  const emailNorm = email.trim().toLowerCase();

  const existing = await db.select().from(users).where(eq(users.email, emailNorm)).limit(1);
  if (existing.length > 0) throw new HttpError(409, 'Email already registered');

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(users)
    .values({ email: emailNorm, passwordHash, name })
    .returning();

  const token = signToken({ id: user.id, email: user.email });
  const profile = await loadProfile(user.id);
  res.json({ token, user: profile });
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const emailNorm = email.trim().toLowerCase();

  const [user] = await db.select().from(users).where(eq(users.email, emailNorm)).limit(1);
  if (!user) throw new HttpError(401, 'Invalid email or password');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new HttpError(401, 'Invalid email or password');

  const token = signToken({ id: user.id, email: user.email });
  const profile = await loadProfile(user.id);
  res.json({ token, user: profile });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const profile = await loadProfile(req.user!.id);
  res.json({ user: profile });
});
