import type { Request, Response, NextFunction } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { teamMembers } from '../db/schema.js';
import { HttpError } from './error.js';

declare module 'express-serve-static-core' {
  interface Request {
    teamId?: string;
  }
}

// Resolves the team the request is scoped to. Prefers an X-Team-Id header
// (verifying the user is a member of that team); falls back to the user's
// first team membership.
export async function requireTeam(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw new HttpError(401, 'Unauthenticated');

  const headerTeamId =
    typeof req.headers['x-team-id'] === 'string'
      ? (req.headers['x-team-id'] as string).trim()
      : '';

  if (headerTeamId) {
    const [m] = await db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(
        and(eq(teamMembers.userId, req.user.id), eq(teamMembers.teamId, headerTeamId)),
      )
      .limit(1);
    if (!m) throw new HttpError(403, 'You are not a member of the requested team');
    req.teamId = headerTeamId;
    next();
    return;
  }

  const [first] = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, req.user.id))
    .limit(1);
  if (!first) throw new HttpError(403, 'You are not a member of any team yet');
  req.teamId = first.teamId;
  next();
}

// Verifies the requesting user is a member of the given team. Used when a
// teamId is supplied in the URL/body rather than inferred.
export async function assertMember(userId: string, teamId: string) {
  const [m] = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, teamId)))
    .limit(1);
  if (!m) throw new HttpError(403, 'Not a member of this team');
}
