import { useState } from 'react';
import type { Player } from '../types';
import { PlayerAvatar } from './PlayerAvatar';

export type SubReason = 'exhaustion' | 'injury' | 'other';

export function PlayerActionSheet({
  player,
  isField,
  onSubstitute,
  onSwitch,
  onMarkScorer,
  onClose,
}: {
  player: Player;
  isField: boolean;
  onSubstitute: () => void;
  onSwitch: () => void;
  onMarkScorer?: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose} title={player.name}>
      <div className="flex items-center gap-3 px-4 py-2">
        <PlayerAvatar
          photoUrl={player.photoUrl}
          jerseyNumber={player.jerseyNumber}
          name={player.name}
        />
        <div className="text-sm text-slate-600">
          {isField ? 'On the field' : 'On the bench'}
        </div>
      </div>
      <div className="p-3 space-y-2">
        {isField && (
          <button onClick={onSwitch} className="btn-secondary w-full">
            Switch position with another player
          </button>
        )}
        <button onClick={onSubstitute} className="btn-secondary w-full">
          Substitute {isField ? 'off' : 'on'}
        </button>
        {isField && onMarkScorer && (
          <button onClick={onMarkScorer} className="btn-primary w-full">
            ⚽ Mark as goal scorer
          </button>
        )}
      </div>
    </Sheet>
  );
}

export function PickAnotherPlayerSheet({
  title,
  candidates,
  onPick,
  onClose,
}: {
  title: string;
  candidates: Player[];
  onPick: (playerId: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose} title={title}>
      {candidates.length === 0 ? (
        <div className="p-4 text-sm text-slate-500">No candidates available.</div>
      ) : (
        <ul className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
          {candidates.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => onPick(p.id)}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-50 text-left"
              >
                <PlayerAvatar
                  photoUrl={p.photoUrl}
                  jerseyNumber={p.jerseyNumber}
                  name={p.name}
                  size="sm"
                />
                <span className="font-medium">{p.name}</span>
                <span className="ml-auto text-xs text-slate-500">
                  {Math.floor(p.playTimeSeconds / 60)}m played
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

export function SubReasonSheet({
  outPlayer,
  inPlayer,
  onConfirm,
  onClose,
}: {
  outPlayer: Player;
  inPlayer: Player;
  onConfirm: (reason: SubReason, reasonText?: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<SubReason | null>(null);
  const [other, setOther] = useState('');

  function confirm(r: SubReason) {
    if (r === 'other') {
      if (!other.trim()) return;
      onConfirm('other', other.trim());
    } else {
      onConfirm(r);
    }
  }

  return (
    <Sheet onClose={onClose} title="Why the substitution?">
      <div className="p-4 space-y-3">
        <div className="text-sm">
          <span className="font-semibold">{outPlayer.name}</span> off,{' '}
          <span className="font-semibold">{inPlayer.name}</span> on.
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => confirm('exhaustion')}
            className="btn-secondary"
          >
            Exhaustion
          </button>
          <button onClick={() => confirm('injury')} className="btn-secondary">
            Injury
          </button>
          <button onClick={() => setReason('other')} className="btn-secondary">
            Other
          </button>
        </div>
        {reason === 'other' && (
          <div className="space-y-2">
            <input
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="Reason…"
              className="input"
              autoFocus
            />
            <button
              disabled={!other.trim()}
              onClick={() => confirm('other')}
              className="btn-primary w-full"
            >
              Confirm
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

export function NotesSheet({
  onSubmit,
  onClose,
}: {
  onSubmit: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  return (
    <Sheet onClose={onClose} title="Add a note">
      <div className="p-4 space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="input"
          placeholder="What just happened?"
          autoFocus
        />
        <button
          disabled={!text.trim()}
          onClick={() => {
            onSubmit(text.trim());
            setText('');
          }}
          className="btn-primary w-full"
        >
          Save note
        </button>
      </div>
    </Sheet>
  );
}

function Sheet({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-30 bg-black/40 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl max-h-[90vh] flex flex-col"
      >
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div className="font-bold truncate">{title}</div>
          <button onClick={onClose} className="text-slate-500 text-sm shrink-0">
            Close
          </button>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
