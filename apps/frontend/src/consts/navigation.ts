export interface NavLinkItem {
  label: string;
  to: string;
}

export const NAV_LINKS_BEFORE: readonly NavLinkItem[] = [
  { label: 'Home', to: '/' }
];

export const NAV_LINKS_AFTER: readonly NavLinkItem[] = [
  { label: 'Technology', to: '/technology' },
  { label: 'About', to: '/about' }
];

export const NAV_LINKS: readonly NavLinkItem[] = [
  ...NAV_LINKS_BEFORE,
  ...NAV_LINKS_AFTER
];
