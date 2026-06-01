import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Match, Player, Segment, SegmentPosition } from '../types';
import { formationByName, formationsFor, SUPPORTED_PLAYER_COUNTS } from '../domain/formations';
import {
  autofillAll,
  computeSubColors,
  indexBySegment,
  type Placement,
  type SegmentInfo,
} from '../lib/autofill';
import { PitchView, subColorClass } from '../components/PitchView';
import { ReservesBench } from '../components/ReservesBench';
import { MatchSettingsModal, type MatchSettingsValues } from '../components/MatchSettingsModal';

type MatchDetail = {
  match: Match;
  availablePlayerIds: string[];
  segments: Segment[];
  positions: SegmentPosition[];
};

export default function MatchEditPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { matchId } = useParams<{ matchId: string }>();

  const matchQuery = useQuery({
    queryKey: ['match', matchId],
    queryFn: () => api<MatchDetail>(`/matches/${matchId}`),
    enabled: !!matchId,
  });

  const playersQuery = useQuery({
    queryKey: ['players'],
    queryFn: () => api<{ players: Player[] }>('/players'),
  });

  const [activeIdx, setActiveIdx] = useState(0);
  const [placements, setPlacements] = useState<Map<number, Placement[]>>(new Map());
  const [segmentFormations, setSegmentFormations] = useState<Map<number, string>>(new Map());
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Hydrate state when data lands or after settings save (which may have wiped positions).
  useEffect(() => {
    if (!matchQuery.data || !playersQuery.data) return;
    const detail = matchQuery.data;
    const allPlayers = playersQuery.data.players;
    const availablePlayers = allPlayers.filter((p) => detail.availablePlayerIds.includes(p.id));

    const initialFormations = new Map<number, string>();
    for (const seg of detail.segments) initialFormations.set(seg.segmentIndex, seg.formation);

    const existing = indexBySegment(detail.positions, detail.segments);
    const hasSavedPositions = Array.from(existing.values()).some((arr) => arr.length > 0);

    if (hasSavedPositions) {
      setPlacements(existing);
      setDirty(false);
    } else {
      const filled = autofillAll({
        availablePlayers,
        goaliePlayerId: detail.match.goaliePlayerId,
        segments: detail.segments.map(toSegmentInfo),
        halfLengthMinutes: detail.match.halfLengthMinutes,
        substitutionWindows: detail.match.substitutionWindows,
      });
      setPlacements(filled);
      // No DB rows yet → mark dirty so the Continue button will persist.
      setDirty(true);
    }

    setSegmentFormations(initialFormations);
    // Preserve activeIdx and selectedPlayerId across re-hydrates (e.g. after a
    // settings save) so the user doesn't jump back to segment 1.
  }, [matchQuery.data, playersQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!matchId || !matchQuery.data) return;
      const segments = matchQuery.data.segments;
      for (const seg of segments) {
        const formation = segmentFormations.get(seg.segmentIndex) ?? seg.formation;
        const segPlacements = placements.get(seg.segmentIndex) ?? [];
        await api(`/matches/${matchId}/segments/${seg.segmentIndex}`, {
          method: 'PUT',
          json: {
            formation,
            playerCount: seg.playerCount,
            positions: segPlacements.map((p) => ({
              playerId: p.playerId,
              isField: p.isField,
              positionSlot: p.positionSlot,
              isGoalie: p.isGoalie,
            })),
          },
        });
      }
    },
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['match', matchId] });
    },
  });

  const allPlayers = playersQuery.data?.players ?? [];
  const playersById = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of allPlayers) m.set(p.id, p);
    return m;
  }, [allPlayers]);

  if (matchQuery.isLoading || playersQuery.isLoading) {
    return <div className="text-slate-500 p-4">Loading match…</div>;
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
  const availablePlayers = allPlayers.filter((p) => detail.availablePlayerIds.includes(p.id));
  const segLength = (detail.match.halfLengthMinutes * 2 * 60) / (detail.match.substitutionWindows + 1);
  const segmentLengthMin = segLength / 60;

  const activeSegment = detail.segments.find((s) => s.segmentIndex === activeIdx);
  if (!activeSegment) return null;

  const activeFormationName = segmentFormations.get(activeIdx) ?? activeSegment.formation;
  const activeFormation = formationByName(activeSegment.playerCount, activeFormationName);
  const activePlacements = placements.get(activeIdx) ?? [];

  // Index placements for the active segment.
  const placementByPlayer = new Map<string, Placement>();
  const playerBySlot = new Map<number, Placement>();
  let goaliePlacement: Placement | null = null;
  for (const p of activePlacements) {
    placementByPlayer.set(p.playerId, p);
    if (p.isGoalie) goaliePlacement = p;
    else if (p.isField && p.positionSlot !== null) playerBySlot.set(p.positionSlot, p);
  }

  const reserves = availablePlayers.filter((p) => {
    const place = placementByPlayer.get(p.id);
    if (!place) return true; // available but unplaced — treat as reserve
    if (place.isGoalie) return false;
    return !place.isField;
  });

  // Sub-pair colours for tabs > 0.
  const subColors = activeIdx > 0
    ? computeSubColors(placements.get(activeIdx - 1) ?? [], activePlacements)
    : undefined;
  const subColorMap: Record<string, string | undefined> = {};
  if (subColors) {
    for (const [pid, idx] of Object.entries(subColors)) subColorMap[pid] = subColorClass(idx);
  }

  function toSegmentInfo(s: Segment): SegmentInfo {
    return {
      segmentIndex: s.segmentIndex,
      formation: segmentFormations.get(s.segmentIndex) ?? s.formation,
      playerCount: s.playerCount,
    };
  }

  // Re-run autofill from `fromIndex` onward, treating earlier segments as
  // preserved (whatever the user has set or autofilled there stays). If
  // `overrideFormations` is passed it temporarily replaces segmentFormations
  // for this run.
  function cascadeFrom(
    fromIndex: number,
    nextPlacements: Map<number, Placement[]>,
    overrideFormations?: Map<number, string>,
  ) {
    if (!matchQuery.data || !playersQuery.data) return nextPlacements;
    const detailLocal = matchQuery.data;
    const avail = playersQuery.data.players.filter((p) =>
      detailLocal.availablePlayerIds.includes(p.id),
    );

    const preserved = new Map<number, Placement[]>();
    for (let i = 0; i < fromIndex; i++) {
      const v = nextPlacements.get(i);
      if (v) preserved.set(i, v);
    }

    const formations = overrideFormations ?? segmentFormations;
    const segmentsForFill = detailLocal.segments.map<SegmentInfo>((s) => ({
      segmentIndex: s.segmentIndex,
      formation: formations.get(s.segmentIndex) ?? s.formation,
      playerCount: s.playerCount,
    }));

    return autofillAll({
      availablePlayers: avail,
      goaliePlayerId: detailLocal.match.goaliePlayerId,
      segments: segmentsForFill,
      halfLengthMinutes: detailLocal.match.halfLengthMinutes,
      substitutionWindows: detailLocal.match.substitutionWindows,
      preserved,
    });
  }

  function changeFormation(name: string) {
    // Apply this formation to current AND all later segments (per spec).
    const newFormations = new Map(segmentFormations);
    for (const s of detail.segments) {
      if (s.segmentIndex >= activeIdx) newFormations.set(s.segmentIndex, name);
    }
    setSegmentFormations(newFormations);

    const next = cascadeFrom(activeIdx, placements, newFormations);
    setPlacements(next);
    setSelectedPlayerId(null);
    setDirty(true);
  }

  function commitActiveAndCascade(newActive: Placement[]) {
    const next = new Map(placements);
    next.set(activeIdx, newActive);
    const cascaded = cascadeFrom(activeIdx + 1, next);
    setPlacements(cascaded);
    setSelectedPlayerId(null);
    setDirty(true);
  }

  function swapPlayers(aId: string, bId: string) {
    const a = placementByPlayer.get(aId);
    const b = placementByPlayer.get(bId);
    if (!a || !b) return;
    if (a.isGoalie || b.isGoalie) return; // goalie is read-only

    // Swap (isField, positionSlot) between the two placements.
    const next = activePlacements.map((p) => {
      if (p.playerId === aId) {
        return { ...p, isField: b.isField, positionSlot: b.positionSlot, isGoalie: false };
      }
      if (p.playerId === bId) {
        return { ...p, isField: a.isField, positionSlot: a.positionSlot, isGoalie: false };
      }
      return p;
    });
    commitActiveAndCascade(next);
  }

  function moveToEmptySlot(playerId: string, slot: number) {
    const placement = placementByPlayer.get(playerId);
    if (!placement || placement.isGoalie) return;
    const next = activePlacements.map((p) => {
      if (p.playerId === playerId) {
        return { ...p, isField: true, positionSlot: slot, isGoalie: false };
      }
      return p;
    });
    commitActiveAndCascade(next);
  }

  function onJerseyTap(playerId: string | null, slotIfEmpty: number | null) {
    // playerId === null means the user tapped an empty slot.
    if (playerId !== null) {
      if (selectedPlayerId === null) {
        setSelectedPlayerId(playerId);
        return;
      }
      if (selectedPlayerId === playerId) {
        setSelectedPlayerId(null);
        return;
      }
      swapPlayers(selectedPlayerId, playerId);
      return;
    }

    if (selectedPlayerId !== null && slotIfEmpty !== null) {
      moveToEmptySlot(selectedPlayerId, slotIfEmpty);
    }
  }

  async function handleSettingsSave(values: MatchSettingsValues) {
    await api(`/matches/${matchId}`, {
      method: 'PATCH',
      json: values,
    });
    setSettingsOpen(false);
    await qc.invalidateQueries({ queryKey: ['match', matchId] });
  }

  function onContinueOrSave() {
    if (dirty) {
      saveMutation.mutate(undefined, {
        onSuccess: () => navigate('/'),
      });
    } else {
      navigate('/');
    }
  }

  const tabs = [...detail.segments].sort((a, b) => a.segmentIndex - b.segmentIndex);
  const canEditSettings = detail.match.status === 'upcoming';
  const continueLabel = saveMutation.isPending
    ? 'Saving…'
    : dirty
    ? 'Save & continue'
    : 'Continue';

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">vs {detail.match.opponent}</h1>
          <div className="text-xs text-slate-500">
            {new Date(detail.match.scheduledAt).toLocaleString()} · 2 × {detail.match.halfLengthMinutes}min ·{' '}
            {detail.match.substitutionWindows} sub windows · {segmentLengthMin.toFixed(1)}min segments
          </div>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          disabled={!canEditSettings}
          className="btn-secondary text-xs"
          title={canEditSettings ? undefined : 'Cannot edit after the game has started'}
        >
          Match settings
        </button>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto -mx-4 px-4 gap-1 border-b border-slate-200">
        {tabs.map((s) => {
          const isActive = s.segmentIndex === activeIdx;
          const startMin = s.segmentIndex * segmentLengthMin;
          const half = startMin >= detail.match.halfLengthMinutes ? 2 : 1;
          const minutesInHalf = half === 1 ? startMin : startMin - detail.match.halfLengthMinutes;
          return (
            <button
              key={s.id}
              onClick={() => {
                setActiveIdx(s.segmentIndex);
                setSelectedPlayerId(null);
              }}
              className={`shrink-0 px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                isActive ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-600'
              }`}
            >
              Seg {s.segmentIndex + 1}
              <span className="block text-[10px] text-slate-500">
                H{half} {minutesInHalf.toFixed(1)}m
              </span>
            </button>
          );
        })}
      </div>

      <div className="card space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="formation">Formation</label>
            <select
              id="formation"
              value={activeFormationName}
              onChange={(e) => changeFormation(e.target.value)}
              className="input"
            >
              {formationsFor(activeSegment.playerCount).map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="pcount">Player count</label>
            <select id="pcount" value={activeSegment.playerCount} disabled className="input">
              {SUPPORTED_PLAYER_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
        {selectedPlayerId && (
          <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
            <span className="font-semibold">{playersById.get(selectedPlayerId)?.name}</span> selected — tap another
            player to swap, an empty slot to move them, or this player again to deselect.
          </div>
        )}
      </div>

      {activeFormation && (
        <PitchView
          goalie={goaliePlacement ? toJersey(playersById.get(goaliePlacement.playerId)) : null}
          goalieReadOnly
          slots={activeFormation.positions.map((pos) => {
            const placed = playerBySlot.get(pos.slot);
            const player = placed ? toJersey(playersById.get(placed.playerId)) : null;
            const isSelected = placed?.playerId === selectedPlayerId;
            return {
              position: pos,
              player,
              highlightColor: placed ? subColorMap[placed.playerId] : undefined,
              selected: isSelected,
              onClick: () => onJerseyTap(placed?.playerId ?? null, placed ? null : pos.slot),
            };
          })}
        />
      )}

      <ReservesBench
        reserves={reserves}
        highlightColors={subColorMap}
        selectedPlayerId={selectedPlayerId}
        onPlayerClick={(pid) => onJerseyTap(pid, null)}
      />

      {/* Historical reserves from previous segments — read-only. Shown in
          descending order: most recent past segment on top, earlier ones below. */}
      {Array.from({ length: activeIdx }, (_, i) => activeIdx - 1 - i).map((segIdx) => {
        const segPlacements = placements.get(segIdx) ?? [];
        const reservesForSeg = availablePlayers.filter((p) => {
          const place = segPlacements.find((pl) => pl.playerId === p.id);
          if (!place) return false;
          if (place.isGoalie) return false;
          return !place.isField;
        });
        return (
          <ReservesBench
            key={segIdx}
            reserves={reservesForSeg}
            highlightColors={{}}
            selectedPlayerId={null}
            onPlayerClick={() => {}}
            title={`Seg ${segIdx + 1} Reserves`}
            emptyText="No reserves in that segment."
            readOnly
          />
        );
      })}

      <div className="sticky bottom-16 sm:bottom-4 z-10 flex gap-2 bg-slate-50/95 backdrop-blur p-3 -mx-4 px-4 border-t border-slate-200">
        <button onClick={onContinueOrSave} className="btn-primary flex-1">
          {continueLabel}
        </button>
      </div>

      {settingsOpen && (
        <MatchSettingsModal
          match={detail.match}
          availablePlayerIds={detail.availablePlayerIds}
          players={allPlayers}
          onSave={handleSettingsSave}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

function toJersey(p: Player | undefined) {
  if (!p) return null;
  return { id: p.id, name: p.name, jerseyNumber: p.jerseyNumber };
}
