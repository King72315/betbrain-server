export type SupportedLeague = "NBA" | "WNBA";

export const LEAGUE_THEME: Record<
  SupportedLeague,
  {
    titleColor: string;
    headerBorder: string;
    refreshBg: string;
    activeFilterBorder: string;
    activeFilterBg: string;
    activeFilterText: string;
    sectionTitle: string;
    gameCardBorder: string;
    leagueBadgeText: string;
    leagueBadgeBg: string;
  }
> = {
  WNBA: {
    titleColor: "#f472b6",
    headerBorder: "#831843",
    refreshBg: "#be185d",
    activeFilterBorder: "#f472b6",
    activeFilterBg: "#500724",
    activeFilterText: "#fbcfe8",
    sectionTitle: "#f472b6",
    gameCardBorder: "#831843",
    leagueBadgeText: "#fce7f3",
    leagueBadgeBg: "#be185d",
  },
  NBA: {
    titleColor: "#60a5fa",
    headerBorder: "#1e3a5f",
    refreshBg: "#2563eb",
    activeFilterBorder: "#60a5fa",
    activeFilterBg: "#1e3a8a",
    activeFilterText: "#dbeafe",
    sectionTitle: "#60a5fa",
    gameCardBorder: "#1e3a5f",
    leagueBadgeText: "#bfdbfe",
    leagueBadgeBg: "#1e40af",
  },
};
