import type { UserProfile } from '../context/AuthContext';

interface UserAvatarProps {
  size?: number;
  profile: UserProfile | null;
  email?: string | null;
  className?: string;
}

/**
 * Shared avatar component.
 * Priority: avatarUrl (image) > avatarInitials > displayName initials > email[0] > '?'
 */
export default function UserAvatar({ size = 28, profile, email, className = '' }: UserAvatarProps) {
  const fontSize = Math.round(size * 0.38);

  // Compute display text
  let initials = '?';
  if (profile?.avatarInitials) {
    initials = profile.avatarInitials.toUpperCase();
  } else if (profile?.displayName) {
    const parts = profile.displayName.trim().split(/\s+/);
    initials = parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].substring(0, 2).toUpperCase();
  } else if (email) {
    const localPart = email.split('@')[0] ?? '';
    initials = localPart.substring(0, 2).toUpperCase() || '?';
  }

  if (profile?.avatarUrl) {
    return (
      <img
        src={profile.avatarUrl}
        alt="Avatar"
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={`rounded-full bg-zinc-700 dark:bg-zinc-300 flex items-center justify-center font-bold text-white dark:text-zinc-800 shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize }}
    >
      {initials}
    </div>
  );
}
