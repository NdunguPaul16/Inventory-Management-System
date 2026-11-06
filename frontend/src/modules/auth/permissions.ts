import type { AuthUser } from '@ims/shared';
import type { NavSection } from '../../app/navigation';

/** Mirrors the backend's exact and module-wildcard permission matching. */
export function hasPermission(permissions: readonly string[], permission: string): boolean {
  return permissions.some(
    (candidate) =>
      candidate === '*' ||
      candidate === permission ||
      (candidate.endsWith('.*') && permission.startsWith(candidate.slice(0, -1))),
  );
}

export function canAccess(user: AuthUser, permission?: string): boolean {
  return !permission || hasPermission(user.permissions, permission);
}

export function visibleNavigation(sections: NavSection[], user: AuthUser): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccess(user, item.permission)),
    }))
    .filter((section) => section.items.length > 0);
}
