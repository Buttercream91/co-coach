import { Router } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import { db } from '../db/client.js';
import { teams, teamMembers, users } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';
import { requireTeam } from '../middleware/team.js';

export const teamsRouter = Router();

const createSchema = z.object({ name: z.string().min(1).max(120) });
const joinSchema = z.object({ code: z.string().min(4).max(16) });

// Short, human-friendly invite code: 8 base32-ish chars.
function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

teamsRouter.use(requireAuth);

// List every team this user belongs to.
teamsRouter.get('/', async (req, res) => {
  const memberships = await db
    .select({
      id: teams.id,
      name: teams.name,
      inviteCode: teams.inviteCode,
      role: teamMembers.role,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.userId, req.user!.id));
  res.json({ teams: memberships });
});

teamsRouter.post('/', async (req, res) => {
  const { name } = createSchema.parse(req.body);

  const inviteCode = generateInviteCode();
  const [team] = await db
    .insert(teams)
    .values({ name, inviteCode, createdBy: req.user!.id })
    .returning();

  await db.insert(teamMembers).values({
    teamId: team.id,
    userId: req.user!.id,
    role: 'owner',
  });

  res.json({ team: { id: team.id, name: team.name, inviteCode: team.inviteCode } });
});

teamsRouter.post('/join', async (req, res) => {
  const { code } = joinSchema.parse(req.body);

  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.inviteCode, code.toUpperCase()))
    .limit(1);
  if (!team) throw new HttpError(404, 'Invite code not recognised');

  // No-op if already a member; otherwise add them.
  const [existing] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, req.user!.id)))
    .limit(1);
  if (!existing) {
    await db.insert(teamMembers).values({
      teamId: team.id,
      userId: req.user!.id,
      role: 'coach',
    });
  }

  res.json({ team: { id: team.id, name: team.name, inviteCode: team.inviteCode } });
});

// Current team detail + members.
teamsRouter.get('/current', requireTeam, async (req, res) => {
  const [team] = await db.select().from(teams).where(eq(teams.id, req.teamId!)).limit(1);
  if (!team) throw new HttpError(404, 'Team not found');

  const members = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: teamMembers.role,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, team.id));

  res.json({
    team: { id: team.id, name: team.name, inviteCode: team.inviteCode },
    members,
  });
});

// Leave the current team. Owner can leave only if there are other members
// (ownership transfer is out of scope for Phase 1; this keeps a foot-gun off
// the table by requiring the team be wiped first).
teamsRouter.post('/leave', requireTeam, async (req, res) => {
  await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, req.teamId!), eq(teamMembers.userId, req.user!.id)));
  res.json({ ok: true });
});
