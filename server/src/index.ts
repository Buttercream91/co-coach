import express from 'express';
import cors from 'cors';
import { env } from './env.js';
import { authRouter } from './routes/auth.js';
import { teamsRouter } from './routes/teams.js';
import { playersRouter } from './routes/players.js';
import { matchesRouter } from './routes/matches.js';
import { matchRunnerRouter } from './routes/match-runner.js';
import { errorHandler } from './middleware/error.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/players', playersRouter);
app.use('/api/matches', matchesRouter);
// Live-runner endpoints share the /matches prefix.
app.use('/api/matches', matchRunnerRouter);

app.use(errorHandler);

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Co-Coach API listening on http://localhost:${env.PORT}`);
});
