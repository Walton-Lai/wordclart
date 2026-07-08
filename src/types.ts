/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Player {
  id: string;
  name: string;
  lives: number;
  score: number;
  isHost: boolean;
  avatarSeed: string;
  isConnected: boolean;
  typingText?: string;
}

export interface LobbyState {
  id: string;
  isPrivate: boolean;
  isSolo?: boolean;
  status: "waiting" | "countdown" | "active" | "gameover";
  players: Player[];
  activePlayerIndex: number;
  prompt: string;
  currentTurnDuration: number; // ms
  turnTimerRemaining: number; // ms
  winnerId: string | null;
  usedWords: string[];
  countdownValue: number;
  logs: string[];
  longestWord: { word: string; player: string } | null;
  wordsPlayedCount: number;
  totalGuesses: number;
  correctGuesses: number;
  currentRound?: number;
  turnsPlayedInCurrentRound?: number;
  turnNumber?: number;
  playedWordsDetail?: { word: string; player: string; round: number; prompt?: string; success?: boolean; turnNumber?: number }[];
}
