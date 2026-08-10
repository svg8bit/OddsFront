import { create } from "zustand";

interface ConflictMapPreviewState {
  hoveredEventId: string | null;
  selectedEventId: string | null;
  popupOpen: boolean;
  effectsVisible: boolean;
  zoom: number;
  setHoveredEvent: (id: string | null) => void;
  selectEvent: (id: string | null) => void;
  closePopup: () => void;
  toggleEffects: () => void;
  setZoom: (zoom: number) => void;
  resetApprovalState: () => void;
}

export const useConflictMapPreviewStore = create<ConflictMapPreviewState>((set) => ({
  hoveredEventId: null,
  selectedEventId: null,
  popupOpen: false,
  effectsVisible: true,
  zoom: 1.72,
  setHoveredEvent: (id) => set({ hoveredEventId: id }),
  selectEvent: (id) => set({ selectedEventId: id, popupOpen: id !== null }),
  closePopup: () => set({ selectedEventId: null, popupOpen: false }),
  toggleEffects: () => set((state) => ({ effectsVisible: !state.effectsVisible })),
  setZoom: (zoom) => set({ zoom }),
  resetApprovalState: () =>
    set({
      hoveredEventId: null,
      selectedEventId: null,
      popupOpen: false,
      effectsVisible: true,
      zoom: 1.72,
    }),
}));
