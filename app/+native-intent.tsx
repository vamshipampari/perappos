export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  // Prevent auth callback deep links from being treated as app routes.
  // Session handling is done in app/_layout.tsx.
  if (path.includes('auth/callback')) {
    return '/';
  }

  return path;
}
