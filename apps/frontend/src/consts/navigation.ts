export const NAV_LINKS_BEFORE = [
  { label: 'Home', to: '/' }
] as const;

export const NAV_LINKS_AFTER = [
  { label: 'Technology', to: '/technology' },
  { label: 'About', to: '/about' }
] as const;

export const NAV_LINKS = [...NAV_LINKS_BEFORE, ...NAV_LINKS_AFTER] as const;
