import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { currentClockSec, formatClock, halftimeRemainingSec, formatSigned } from '../lib/clock';
import { formationByName } from '../domain/formations';
import { PitchView } from '../components/PitchView';
import { ReservesBench } from '../components/ReservesBench';
import { RunnerEventLog } from '../components/RunnerEventLog';
import { NotesSheet, SubReasonSheet, PickAnotherPlayerSheet, type SubReason } from '../components/RunnerActionSheet';
import { useDevMode } from '../dev/DevModeContext';
import type {
  FieldState,
  LiveState,
  Match,
  MatchEvent,
  Player,
  Segment,
  SegmentPosition,
} from '../types';

type MatchDetail = {
  match: Match;
  availablePlayerIds: string[];
  segments: Segment[];
  positions: SegmentPosition[];
};

export default function EnterGamePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { matchId } = useParams<{ matchId: string }>();
  const { devMode } = useDevMode();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingSub, setPendingSub] = useState<{ outId: string; inId: string } | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [showScorerPicker, setShowScorerPicker] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const matchQuery = useQuery({
    queryKey: ['match', matchId],
    queryFn: () => api<MatchDetail>(`/matches/${matchId}`),
    enabled: !!matchId,
  });
  const playersQuery = useQuery({
    queryKey: ['players'],
    queryFn: () => api<{ players: Player[] }>('/players'),
  });
  const eventsQuery = useQuery({
    queryKey: ['match-events', matchId],
    queryFn: () => api<{ events: MatchEvent[] }>(`/matches/${matchId}/events`),
    enabled: !!matchId,
    refetchInterval: 5000,
  });

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ['match', matchId] });
    qc.invalidateQueries({ queryKey: ['match-events', matchId] });
    qc.invalidateQueries({ queryKey: ['matches'] });
  };

  const m_begin = useMutation({
    mutationFn: () => api(`/matches/${matchId}/begin`, { method: 'POST' }),
    onSuccess: refetchAll,
  });
  const m_pause = useMutation({
    mutationFn: () => api(`/matches/${matchId}/pause`, { method: 'POST' }),
    onSuccess: refetchAll,
  });
  const m_resume = useMutation({
    mutationFn: () => api(`/matches/${matchId}/resume`, { method: 'POST' }),
    onSuccess: refetchAll,
  });
  const m_endHalf = useMutation({
    mutationFn: () => api(`/matches/${matchId}/end-half`, { method: 'POST' }),
    onSuccess: refetchAll,
  });
  const m_beginSecond = useMutation({
    mutationFn: () => api(`/matches/${matchId}/begin-second-half`, { method: 'POST' }),
    onSuccess: refetchAll,
  });
  const m_complete = useMutation({
    mutationFn: () => api(`/matches/${matchId}/complete`, { method: 'POST' }),
    onSuccess: () => {
      refetchAll();
      qc.invalidateQueries({ queryKey: ['players'] });
      navigate(`/matches/${matchId}/stats`);
    },
  });
  const m_rotate = useMutation({
    mutationFn: () => api(`/matches/${matchId}/rotate-substitutes`, { method: 'POST' }),
    onSuccess: refetchAll,
  });
  const m_setClockMult = useMutation({
    mutationFn: (multiplier: number) =>
      api(`/matches/${matchId}/dev/clock-multiplier`, {
        method: 'POST',
        json: { multiplier },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['match', matchId] }),
  });
  const m_rotateBack = useMutation({
    mutationFn: (playerId: string) =>
      api(`/matches/${matchId}/rotate-back`, { method: 'POST', json: { playerId } }),
    onSuccess: refetchAll,
  });
  const m_toSickBay = useMutation({
    mutationFn: (playerId: string) =>
      api(`/matches/${matchId}/to-sick-bay`, { method: 'POST', json: { playerId } }),
    onSuccess: refetchAll,
  });
  const m_event = useMutation({
    mutationFn: (body: { eventType: string; payload: Record<string, unknown> }) =>
      api(`/matches/${matchId}/events`, { method: 'POST', json: body }),
    onSuccess: refetchAll,
  });
  const m_deleteEvent = useMutation({
    mutationFn: (eventId: string) =>
      api(`/matches/${matchId}/events/${eventId}`, { method: 'DELETE' }),
    onSuccess: refetchAll,
  });

  const players = playersQuery.data?.players ?? [];
  const playersById = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  if (matchQuery.isLoading || playersQuery.isLoading) {
    return <div className="p-4 text-slate-500">Loading…</div>;
  }
  if (matchQuery.error || !matchQuery.data) {
    return (
      <div className="p-4 text-rose-600">
        Couldn't load this match.{' '}
        <button onClick={() => navigate('/')} className="underline">Back</button>
      </div>
    );
  }
  const detail = matchQuery.data;
  const match = detail.match;
  const live: LiveState | null = match.liveState ?? null;
  const fs: FieldState | null = match.fieldState ?? null;
  const events = eventsQuery.data?.events ?? [];

  if (match.status === 'completed') {
    return (
      <div className="space-y-4 p-2">
        <h1 className="text-xl font-bold">Match complete</h1>
        <p className="text-sm text-slate-600">
          Final: {match.myScore ?? 0} – {match.opponentScore ?? 0} vs {match.opponent}
        </p>
        <button onClick={() => navigate(`/matches/${matchId}/stats`)} className="btn-primary">
          View match stats
        </button>
      </div>
    );
  }

  const availablePlayers = players.filter((p) => detail.availablePlayerIds.includes(p.id));
  const segLengthSec = (match.halfLengthMinutes * 2 * 60) / (match.substitutionWindows + 1);
  const segmentsPerHalf = (match.substitutionWindows + 1) / 2;
  const clockSec = currentClockSec(live);
  const myScore = match.myScore ?? 0;
  const oppScore = match.opponentScore ?? 0;

  // Active segment: from server's field_state when running, otherwise plan-derived.
  const activeSegmentIdx = fs?.currentSegmentIdx ?? 0;
  const currentSegment = detail.segments.find((s) => s.segmentIndex === activeSegmentIdx);
  const formation = currentSegment
    ? formationByName(currentSegment.playerCount, currentSegment.formation)
    : undefined;

  // Build field/reserve/sickBay views from fs (if running) or plan (pre-match).
  type Placed = { playerId: string; slot: number | null; isGoalie: boolean };
  let fieldPlaced: Placed[] = [];
  let reserveIds: string[] = [];
  let sickBayIds: string[] = [];
  if (fs) {
    fieldPlaced = fs.field;
    reserveIds = fs.reserves;
    sickBayIds = fs.sickBay;
  } else if (currentSegment) {
    // Pre-match: use the segment plan.
    const segPlacements = detail.positions.filter((p) => p.segmentId === currentSegment.id);
    fieldPlaced = segPlacements
      .filter((p) => p.isField)
      .map((p) => ({ playerId: p.playerId, slot: p.positionSlot, isGoalie: p.isGoalie }));
    reserveIds = segPlacements.filter((p) => !p.isField).map((p) => p.playerId);
    // Anyone available but not placed in this segment also goes to reserves.
    const placedSet = new Set(segPlacements.map((p) => p.playerId));
    for (const ap of availablePlayers) {
      if (!placedSet.has(ap.id)) reserveIds.push(ap.id);
    }
  }
  const playerBySlot = new Map<number, Placed>();
  let goaliePlaced: Placed | null = null;
  for (const f of fieldPlaced) {
    if (f.isGoalie) goaliePlaced = f;
    else if (f.slot !== null) playerBySlot.set(f.slot, f);
  }
  const reserves = reserveIds.map((id) => playersById.get(id)).filter(Boolean) as Player[];
  const sickBay = sickBayIds.map((id) => playersById.get(id)).filter(Boolean) as Player[];

  // Which area is a given player currently in?
  function areaOf(playerId: string): 'field' | 'goalie' | 'reserve' | 'sickbay' | 'none' {
    if (goaliePlaced?.playerId === playerId) return 'goalie';
    if (fieldPlaced.some((f) => f.playerId === playerId && !f.isGoalie)) return 'field';
    if (reserveIds.includes(playerId)) return 'reserve';
    if (sickBayIds.includes(playerId)) return 'sickbay';
    return 'none';
  }

  // ---------- Tap handling ----------

  function onTap(playerId: string) {
    const area = areaOf(playerId);
    if (selectedId === null) {
      setSelectedId(playerId);
      return;
    }
    if (selectedId === playerId) {
      setSelectedId(null);
      return;
    }
    const selArea = areaOf(selectedId);

    // Sick bay can only select itself — never swaps with the field directly.
    if (selArea === 'sickbay') {
      setSelectedId(playerId);
      return;
    }
    if (area === 'sickbay') {
      // Re-select target as the new selection rather than swap.
      setSelectedId(playerId);
      return;
    }

    const selOnField = selArea === 'field' || selArea === 'goalie';
    const tgtOnField = area === 'field' || area === 'goalie';

    if (selOnField && tgtOnField) {
      // Position switch — no reason prompt, no sick bay.
      m_event.mutate({
        eventType: 'position_switch',
        payload: { playerAId: selectedId, playerBId: playerId },
      });
      setSelectedId(null);
      return;
    }
    if (selOnField && !tgtOnField) {
      // Selected is field/goalie, target is reserve → substitution
      setPendingSub({ outId: selectedId, inId: playerId });
      setSelectedId(null);
      return;
    }
    if (!selOnField && tgtOnField) {
      setPendingSub({ outId: playerId, inId: selectedId });
      setSelectedId(null);
      return;
    }
    // Both on bench / unplaced — no-op.
    setSelectedId(null);
  }

  function confirmSub(outId: string, inId: string, reason: SubReason, reasonText?: string) {
    m_event.mutate({
      eventType: 'substitution',
      payload: { outPlayerId: outId, inPlayerId: inId, reason, ...(reasonText ? { reasonText } : {}) },
    });
    setPendingSub(null);
  }

  function logGoal(side: 'us' | 'opp', playerId?: string) {
    m_event.mutate({
      eventType: 'goal',
      payload: { side, ...(playerId ? { playerId } : {}) },
    });
  }

  function addNote(text: string) {
    m_event.mutate({ eventType: 'note', payload: { text } });
    setShowNotes(false);
  }

  // ---------- Upcoming subs + Rotate button enablement ----------

  // "Next sub window" computation. Going-off / coming-on are derived from
  // current field state versus the next segment's plan, then EXTRA reserves
  // not in the plan (typically rotated back from sick bay) are added to
  // coming-on and paired with current stayers as additional going-off — so
  // they enter the rotation immediately rather than waiting another segment.
  const nextSegment = detail.segments.find((s) => s.segmentIndex === activeSegmentIdx + 1);
  let upcomingSubs: { off: Player | null; on: Player | null }[] = [];
  if (currentSegment && nextSegment) {
    const nxtPlan = detail.positions.filter((p) => p.segmentId === nextSegment.id);
    const nxtFieldSet = new Set(
      nxtPlan.filter((p) => p.isField && !p.isGoalie).map((p) => p.playerId),
    );

    const currentFieldIds = fieldPlaced.filter((f) => !f.isGoalie).map((f) => f.playerId);
    const currentReserveIds = [...reserveIds];

    const planGoingOffIds = currentFieldIds.filter((pid) => !nxtFieldSet.has(pid));
    const planComingOnIds = currentReserveIds.filter((pid) => nxtFieldSet.has(pid));
    const stayerIds = currentFieldIds.filter((pid) => nxtFieldSet.has(pid));
    const extraReserveIds = currentReserveIds.filter((pid) => !nxtFieldSet.has(pid));

    const extraSwaps = Math.min(extraReserveIds.length, stayerIds.length);
    const goingOffIds = [...planGoingOffIds, ...stayerIds.slice(0, extraSwaps)];
    const comingOnIds = [...planComingOnIds, ...extraReserveIds.slice(0, extraSwaps)];

    const maxLen = Math.max(goingOffIds.length, comingOnIds.length);
    for (let i = 0; i < maxLen; i++) {
      upcomingSubs.push({
        off: goingOffIds[i] ? playersById.get(goingOffIds[i]) ?? null : null,
        on: comingOnIds[i] ? playersById.get(comingOnIds[i]) ?? null : null,
      });
    }
  }

  // Distance to the next sub window time (signed; negative = overdue).
  // Used purely for the "out of window" confirm dialog now — the button is
  // always enabled.
  let secondsToNextWindow: number | null = null;
  let isHalfTimeTransition = false;
  if (
    nextSegment &&
    fs &&
    (live?.phase === 'first_half' || live?.phase === 'second_half')
  ) {
    const segmentInHalf =
      live.phase === 'first_half'
        ? activeSegmentIdx
        : activeSegmentIdx - segmentsPerHalf;
    const nextSegInHalf = segmentInHalf + 1;
    isHalfTimeTransition = nextSegInHalf >= segmentsPerHalf;
    if (!isHalfTimeTransition) {
      const subWindowAt = nextSegInHalf * segLengthSec;
      secondsToNextWindow = subWindowAt - clockSec;
    }
  }

  // Recent subs in the Next Sub Window panel — substitutions and scheduled
  // segment advances only. Position switches stay in the main log but not here.
  const recentSubs = events
    .filter((e) => e.eventType === 'substitution' || e.eventType === 'segment_advance')
    .slice(-5)
    .reverse();

  // ---------- Phase controls ----------

  function phaseControls() {
    if (!live || live.phase === 'pre_match') {
      return (
        <button
          disabled={m_begin.isPending}
          onClick={() => m_begin.mutate()}
          className="btn-primary text-lg px-8"
        >
          {m_begin.isPending ? 'Starting…' : 'Begin match'}
        </button>
      );
    }
    if (live.phase === 'first_half' || live.phase === 'second_half') {
      const paused = !!live.pausedAt;
      return (
        <div className="flex gap-2 flex-wrap justify-center">
          {paused ? (
            <button onClick={() => m_resume.mutate()} className="btn-secondary">Resume</button>
          ) : (
            <button onClick={() => m_pause.mutate()} className="btn-secondary">Pause</button>
          )}
          <button
            onClick={() => {
              if (confirm(`End ${live.phase === 'first_half' ? 'first' : 'second'} half now?`)) {
                m_endHalf.mutate();
              }
            }}
            className="btn-danger"
          >
            End {live.phase === 'first_half' ? 'first' : 'second'} half
          </button>
        </div>
      );
    }
    if (live.phase === 'halftime') {
      const remaining = halftimeRemainingSec(live);
      return (
        <div className="flex flex-col items-center gap-2">
          <div className="text-sm">
            Halftime ·{' '}
            <span className={remaining < 0 ? 'text-rose-600 font-bold' : 'text-slate-700'}>
              {formatSigned(remaining)}
            </span>
          </div>
          <button onClick={() => m_beginSecond.mutate()} className="btn-primary">
            Begin second half
          </button>
        </div>
      );
    }
    return (
      <button
        onClick={() => {
          if (confirm('Save the game? Playtime will be added to each player.')) {
            m_complete.mutate();
          }
        }}
        className="btn-primary text-lg px-8"
      >
        Save game
      </button>
    );
  }

  // ---------- Render ----------

  const inPlay = live?.phase === 'first_half' || live?.phase === 'second_half';
  const selectedPlayer = selectedId ? playersById.get(selectedId) : null;
  const selectedArea = selectedId ? areaOf(selectedId) : null;

  return (
    <div className="space-y-4 pb-4">
      {/* Scoreboard */}
      <div className="card text-center space-y-2">
        <div className="text-sm font-semibold text-slate-600">
          vs <span className="font-bold">{match.opponent}</span>
        </div>
        <div className="text-6xl font-extrabold tabular-nums tracking-tight">
          {myScore} <span className="text-slate-400">–</span> {oppScore}
        </div>
        {inPlay && (
          <div className="text-4xl font-bold tabular-nums tracking-tight text-slate-800">
            {formatClock(clockSec, match.halfLengthMinutes)}
            {live?.pausedAt && (
              <span className="ml-2 text-base text-amber-600 font-semibold align-middle">paused</span>
            )}
          </div>
        )}
        <div className="text-xs text-slate-500">
          {phaseLabel(live)}
          {currentSegment && fs &&
            ` · Seg ${activeSegmentIdx + 1}/${detail.segments.length} (${currentSegment.formation})`}
        </div>
        <div className="pt-2">{phaseControls()}</div>
      </div>

      {inPlay && (
        <div className="card flex gap-2">
          <button onClick={() => setShowScorerPicker(true)} className="btn-primary flex-1">
            ⚽ Goal for us
          </button>
          <button onClick={() => logGoal('opp')} className="btn-secondary flex-1">
            Goal for {match.opponent}
          </button>
        </div>
      )}

      {devMode && live && (
        <div className="card bg-purple-50 border-purple-200">
          <div className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-2">
            Dev · clock speed
          </div>
          <div className="flex gap-2">
            {[1, 5, 10, 60].map((m) => {
              const active = (live.clockMultiplier ?? 1) === m;
              return (
                <button
                  key={m}
                  onClick={() => m_setClockMult.mutate(m)}
                  disabled={active || m_setClockMult.isPending}
                  className={`flex-1 ${active ? 'btn-primary' : 'btn-secondary'}`}
                >
                  {m}×
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Multiplies game time vs real time. The clock will jump when changed mid-match.
          </p>
        </div>
      )}

      {formation && (
        <PitchView
          goalie={goaliePlaced ? toJersey(playersById.get(goaliePlaced.playerId)) : null}
          goalieSelected={!!goaliePlaced && selectedId === goaliePlaced.playerId}
          onGoalieClick={goaliePlaced && inPlay ? () => onTap(goaliePlaced!.playerId) : undefined}
          goalieReadOnly={!inPlay || !goaliePlaced}
          slots={formation.positions.map((pos) => {
            const placed = playerBySlot.get(pos.slot);
            const player = placed ? toJersey(playersById.get(placed.playerId)) : null;
            const isSelected = placed?.playerId === selectedId;
            return {
              position: pos,
              player,
              selected: isSelected,
              onClick: placed && inPlay ? () => onTap(placed.playerId) : undefined,
            };
          })}
        />
      )}

      {/* Selection banner */}
      {selectedPlayer && (
        <div className="card text-sm bg-emerald-50 border-emerald-200">
          <div>
            <span className="font-semibold">{selectedPlayer.name}</span> selected ({selectedArea}).{' '}
            Tap another player to {selectedArea === 'sickbay' ? 'change selection' : 'swap'}.
          </div>
          {selectedArea === 'sickbay' && (
            <div className="mt-2">
              <button
                onClick={() => {
                  m_rotateBack.mutate(selectedPlayer.id);
                  setSelectedId(null);
                }}
                className="btn-primary"
              >
                Rotate back into reserves
              </button>
            </div>
          )}
        </div>
      )}

      {/* Reserves + Sick Bay side-by-side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ReservesBench
          reserves={reserves}
          highlightColors={{}}
          selectedPlayerId={selectedId}
          onPlayerClick={inPlay ? onTap : () => {}}
          title="Reserves"
          emptyText="No reserves available."
        />
        <ReservesBench
          reserves={sickBay}
          highlightColors={{}}
          selectedPlayerId={selectedId}
          onPlayerClick={inPlay ? onTap : () => {}}
          title="Sick Bay"
          emptyText="No one off injured / rested."
          tone="sickbay"
          showAddSlot={inPlay && selectedArea === 'reserve' && !!selectedId}
          onAddSlotClick={() => {
            if (selectedId) {
              m_toSickBay.mutate(selectedId);
              setSelectedId(null);
            }
          }}
          addSlotLabel="Move here"
        />
      </div>

      {/* Next Sub Window */}
      {(upcomingSubs.length > 0 || recentSubs.length > 0 || nextSegment || live?.phase === 'halftime') && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Next sub window
              </div>
              {live?.phase === 'halftime' ? (
                <div className="text-xs text-slate-600">
                  Halftime break — next window opens when the second half begins.
                </div>
              ) : (
                <>
                  {secondsToNextWindow !== null && (
                    <div className="text-xs text-slate-600">
                      {secondsToNextWindow > 0
                        ? `in ${formatSigned(secondsToNextWindow)}`
                        : `${formatSigned(secondsToNextWindow)} overdue`}
                    </div>
                  )}
                  {isHalfTimeTransition && (
                    <div className="text-xs text-slate-600">
                      Auto-applied when you end the first half.
                    </div>
                  )}
                </>
              )}
            </div>
            {!isHalfTimeTransition && nextSegment && live?.phase !== 'halftime' && (
              <button
                onClick={() => {
                  const inWindow =
                    secondsToNextWindow !== null && Math.abs(secondsToNextWindow) <= 60;
                  if (
                    !inWindow &&
                    !confirm(
                      "Rotate now? You're outside the scheduled ±1 minute window for the next sub.",
                    )
                  ) {
                    return;
                  }
                  m_rotate.mutate();
                }}
                disabled={m_rotate.isPending}
                className="btn-primary"
              >
                Rotate Substitutes
              </button>
            )}
          </div>

          {upcomingSubs.length > 0 && live?.phase !== 'halftime' && (
            <ul className="space-y-1 text-sm">
              {upcomingSubs.map((s, i) => (
                <li key={i}>
                  <span className="font-medium">{s.off ? s.off.name : '—'}</span>
                  <span className="text-slate-400 mx-1">→</span>
                  <span className="font-medium">{s.on ? s.on.name : '—'}</span>
                </li>
              ))}
            </ul>
          )}

          {recentSubs.length > 0 && (
            <div className="border-t border-slate-200 pt-2">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Previous subs
              </div>
              <ul className="space-y-1 text-sm">
                {recentSubs.map((e) => (
                  <li key={e.id} className="flex items-start gap-2">
                    <span className="text-[10px] font-mono text-slate-500 w-12 shrink-0 pt-0.5">
                      H{e.half} {formatSigned(e.matchClockSeconds)}
                    </span>
                    <span className="flex-1">{describeSub(e, playersById)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      <div className="flex justify-end">
        <button onClick={() => setShowNotes(true)} className="btn-secondary">
          + Add note
        </button>
      </div>

      {/* Event log */}
      <div className="card !p-0 overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 uppercase tracking-wide">
          Match log
        </div>
        <div className="max-h-64 overflow-y-auto">
          <RunnerEventLog
            events={events}
            playersById={playersById}
            opponentName={match.opponent}
            onDelete={(id) => m_deleteEvent.mutate(id)}
          />
        </div>
      </div>

      {pendingSub && (() => {
        const outP = playersById.get(pendingSub.outId);
        const inP = playersById.get(pendingSub.inId);
        if (!outP || !inP) return null;
        return (
          <SubReasonSheet
            outPlayer={outP}
            inPlayer={inP}
            onConfirm={(reason, txt) => confirmSub(pendingSub.outId, pendingSub.inId, reason, txt)}
            onClose={() => setPendingSub(null)}
          />
        );
      })()}

      {showNotes && <NotesSheet onSubmit={addNote} onClose={() => setShowNotes(false)} />}

      {showScorerPicker && (
        <PickAnotherPlayerSheet
          title="Who scored?"
          candidates={[
            ...fieldPlaced
              .map((f) => playersById.get(f.playerId))
              .filter((x): x is Player => !!x),
          ]}
          onPick={(pid) => {
            logGoal('us', pid);
            setShowScorerPicker(false);
          }}
          onClose={() => setShowScorerPicker(false)}
        />
      )}
    </div>
  );
}

function toJersey(p: Player | undefined) {
  if (!p) return null;
  return { id: p.id, name: p.name, jerseyNumber: p.jerseyNumber };
}

function phaseLabel(live: LiveState | null): string {
  if (!live || live.phase === 'pre_match') return 'Ready to begin';
  if (live.phase === 'first_half') return 'First half';
  if (live.phase === 'halftime') return 'Halftime';
  if (live.phase === 'second_half') return 'Second half';
  return 'Match ended — save to record';
}

function describeSub(
  ev: MatchEvent,
  playersById: Map<string, Player>,
): React.ReactNode {
  const p = (id?: string) => (id ? playersById.get(id)?.name ?? 'Unknown' : 'Unknown');
  const payload = ev.payload as Record<string, unknown>;
  if (ev.eventType === 'substitution') {
    const reason = (payload.reason as string) ?? '';
    const reasonText = typeof payload.reasonText === 'string' ? payload.reasonText : undefined;
    return (
      <span>
        {p(payload.outPlayerId as string)}{' '}
        <span className="text-slate-400">→</span> {p(payload.inPlayerId as string)}{' '}
        <span className="text-xs text-slate-500">({reasonText ? `other: ${reasonText}` : reason})</span>
      </span>
    );
  }
  if (ev.eventType === 'position_switch') {
    return (
      <span>
        {p(payload.playerAId as string)} <span className="text-slate-400">↔</span>{' '}
        {p(payload.playerBId as string)}
      </span>
    );
  }
  if (ev.eventType === 'segment_advance') {
    const swaps = (payload.swaps as { outPlayerId: string; inPlayerId: string }[]) ?? [];
    if (swaps.length === 0) {
      return <span className="text-slate-600 italic">Sub window applied</span>;
    }
    return (
      <span className="text-slate-700">
        Sub window:{' '}
        {swaps.map((s, i) => (
          <span key={i}>
            {i > 0 && ', '}
            {p(s.outPlayerId)}→{p(s.inPlayerId)}
          </span>
        ))}
      </span>
    );
  }
  return null;
}
