import { useState } from 'react';

type Size = 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'w-10 h-10 text-sm',
  md: 'w-16 h-16 text-base',
  lg: 'w-24 h-24 text-lg',
};

export function PlayerAvatar({
  photoUrl,
  jerseyNumber,
  name,
  size = 'md',
  showNumber = true,
}: {
  photoUrl?: string | null;
  jerseyNumber?: number | null;
  name?: string;
  size?: Size;
  showNumber?: boolean;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const usePhoto = photoUrl && !photoFailed;

  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-full bg-slate-200 overflow-hidden shrink-0 ${SIZE_CLASSES[size]}`}
      aria-label={name}
    >
      {usePhoto ? (
        <img
          src={photoUrl!}
          alt={name ?? 'Player photo'}
          className="w-full h-full object-cover"
          onError={() => setPhotoFailed(true)}
        />
      ) : (
        <img
          src="/jersey.png"
          alt=""
          className="w-[80%] h-[80%] object-contain"
          aria-hidden="true"
        />
      )}
      {showNumber && jerseyNumber !== null && jerseyNumber !== undefined && (
        <span className="absolute bottom-0 right-0 translate-x-1 translate-y-1 px-1.5 py-0.5 rounded-full text-xs font-bold bg-slate-900 text-white border-2 border-white">
          {jerseyNumber}
        </span>
      )}
    </span>
  );
}
