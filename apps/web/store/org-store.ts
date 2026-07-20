import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface OrgState {
  activeOrganizationId: string | null;
  setActiveOrganizationId: (id: string | null) => void;
}

/**
 * Remembers which organization the org switcher last selected, purely as a
 * client-side UX convenience — the source of truth for membership/role data
 * is always the server (fetched fresh per request).
 */
export const useOrgStore = create<OrgState>()(
  persist(
    (set) => ({
      activeOrganizationId: null,
      setActiveOrganizationId: (id) => set({ activeOrganizationId: id }),
    }),
    { name: 'bondos-active-org' },
  ),
);
