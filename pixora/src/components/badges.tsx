import React from 'react';
import { BadgeCheck, Crown, Clapperboard, Store } from 'lucide-react';

export function Badges({ user, size = 16 }: { user: any; size?: number }) {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {user.isVerified && <BadgeCheck size={size} className="text-sky-400" />}
      {user.isPremium && <Crown size={size} className="text-amber-400" />}
      {user.isCreator && <Clapperboard size={size} className="text-pink-400" />}
      {user.isBusiness && <Store size={size} className="text-emerald-400" />}
    </span>
  );
}
