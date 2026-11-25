export const VOICES = {
  motel: {
    speaker: "Motel promoter",
    text: "We have one motel room and fourteen revenue streams.",
    model: "aura-2-andromeda-en",
  },
  boardwalk: {
    speaker: "Boardwalk filmer",
    text: "The bird got unlimited crumbs. My lawyer says I should've asked for the same.",
    model: "aura-2-orpheus-en",
  },
  buyer: {
    speaker: "Angry buyer",
    text: "Bro. Where is the utility?",
    model: "aura-2-atlas-en",
  },
  laundromat: {
    speaker: "Laundry attendant",
    text: "Relax. We wash the books on cold.",
    model: "aura-2-pandora-en",
  },
  hotdog: {
    speaker: "Quantum Hot Dogs",
    text: "It's both lunch and a write-off until you look at it.",
    model: "aura-2-arcas-en",
  },
  incident: {
    speaker: "Treasury intern",
    text: "If anyone asks, the keys walked out on their own.",
    model: "aura-2-andromeda-en",
  },
  club: {
    speaker: "Club Liquid announcer",
    text: "Make some noise for the Slopmeister! Okay. Legal says that's enough noise.",
    model: "aura-2-thalia-en",
  },
} as const;

export type VoiceId = keyof typeof VOICES;
export interface VoiceCaption {
  speaker: string;
  text: string;
}
