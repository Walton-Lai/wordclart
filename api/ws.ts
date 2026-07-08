/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { WebSocketServer, WebSocket } from "ws";
import { fallbackWords } from "../src/dictionary";
import crypto from "crypto";
import express from "express";
import { createServer } from "http";
import path from "path";

// Setup WebSocketServer instance as a headless server
const wss = new WebSocketServer({ noServer: true });

// Maintain a list of all words and an ultra-fast lookup Set for exhaustive English vocabulary
let dictionary: string[] = [...fallbackWords];
let commonWords: string[] = [...fallbackWords];
const wordSet = new Set<string>(fallbackWords.map(w => w.trim().toLowerCase()));

// Load broader dictionary asynchronously from CDN raw raw url
async function loadBiggerDictionary() {
  try {
    console.log("Fetching expanded dictionary from Google 10,000 English wordlist...");
    const res = await fetch("https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-usa-no-swears-medium.txt");
    if (res.ok) {
      const text = await res.text();
      const words = text
        .split("\n")
        .map(w => w.trim().toLowerCase())
        .filter(w => w.length > 0 && /^[a-z]+$/.test(w));
      commonWords = words;
      words.forEach(w => wordSet.add(w));
      console.log("Common wordlist loaded successfully.");
    }
  } catch (err) {
    console.error("Error loading google 10000 dictionary", err);
  }

  try {
    console.log("Fetching massive 370,000 English wordlist (exhaustive lexicon)...");
    const res = await fetch("https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt");
    if (res.ok) {
      const text = await res.text();
      const words = text
        .split("\r\n")
        .join("\n")
        .split("\n")
        .map(w => w.trim().toLowerCase())
        .filter(w => w.length > 0 && /^[a-z]+$/.test(w));
      if (words.length > 1000) {
        words.forEach(w => wordSet.add(w));
        console.log(`Massive dictionary loaded successfully. Total size: ${wordSet.size} words.`);
      }
    } else {
      console.warn("Failed to load massive wordlist. Falling back to loaded set.");
    }
  } catch (err) {
    console.error("Error loading massive dictionary from network.", err);
  }

  // Synchronize dictionary list for random prompt generators
  dictionary = Array.from(wordSet);
}

// Call on boot
loadBiggerDictionary();

interface Player {
  id: string;
  name: string;
  lives: number;
  score: number;
  isHost: boolean;
  avatarSeed: string;
  isConnected: boolean;
  typingText?: string;
}

interface Lobby {
  id: string;
  isPrivate: boolean;
  isSolo?: boolean;
  status: "waiting" | "countdown" | "active" | "gameover";
  players: Player[];
  activePlayerIndex: number;
  prompt: string;
  currentTurnDuration: number; // starts at 8000ms, drops by 400ms per successful word
  turnTimerRemaining: number; // remaining ms for the active turn
  winnerId: string | null;
  usedWords: string[];
  countdownValue: number; // 3, 2, 1
  logs: string[];
  // Statistics
  longestWord: { word: string; player: string } | null;
  wordsPlayedCount: number;
  totalGuesses: number;
  correctGuesses: number;
  currentRound: number;
  turnsPlayedInCurrentRound: number;
  turnNumber: number; // keeps increasing 1, 2, 3, etc. and doesn't reset across rounds
  playedWordsDetail: { word: string; player: string; round: number; prompt?: string; success?: boolean; turnNumber?: number }[];
  turnExpiresAt?: number; // millisecond timestamp when the active turn expires
}

const lobbies = new Map<string, Lobby>();
const clientLobbies = new Map<WebSocket, { lobbyId: string; playerId: string }>();
const disconnectTimeouts = new Map<string, NodeJS.Timeout>();

async function getLobby(id: string, useCacheOnly: boolean = false): Promise<Lobby | undefined> {
  const normalizedId = id.toUpperCase();
  const lobby = lobbies.get(normalizedId);

  // If active, dynamically calculate turnTimerRemaining based on actual system clock
  if (lobby && lobby.status === "active" && lobby.turnExpiresAt) {
    const remaining = lobby.turnExpiresAt - Date.now();
    lobby.turnTimerRemaining = Math.max(0, remaining);
  }
  return lobby;
}

async function setLobby(id: string, lobby: Lobby): Promise<void> {
  const normalizedId = id.toUpperCase();
  lobbies.set(normalizedId, lobby);
}

async function deleteLobby(id: string): Promise<void> {
  const normalizedId = id.toUpperCase();
  lobbies.delete(normalizedId);
}

async function findWaitingPublicLobby(): Promise<Lobby | undefined> {
  return Array.from(lobbies.values()).find(
    l => !l.isPrivate && !l.isSolo && l.status === "waiting" && l.players.length < 5
  );
}

// Helper to generate a unique random 4-char lobby ID
async function generateLobbyId(): Promise<string> {
  const chars = "ABCDEFGHIJKLMNPQRSTUVWXYZ23456789"; // No easily confused characters like O, 1, 0, I
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  const existing = await getLobby(code);
  if (existing) {
    return generateLobbyId();
  }
  return code;
}

// Helper to log with timestamp
function formatLogTime(): string {
  const now = new Date();
  return `[${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}]`;
}

// Ensure addLobbyLog functions correctly
function addLobbyLog(lobby: Lobby, message: string) {
  const fullLog = `${formatLogTime()} ${message}`;
  lobby.logs.push(fullLog);
  if (lobby.logs.length > 50) {
    lobby.logs.shift();
  }
}

function getRoundSettings(round: number): { duration: number; promptLength: number } {
  if (round === 1) {
    return { duration: 7000, promptLength: 1 };
  } else if (round === 2) {
    return { duration: 6000, promptLength: 2 };
  } else if (round === 3) {
    return { duration: 5000, promptLength: 3 };
  } else {
    // Keep subtracting 0.5s (500ms) from 5000ms per round.
    const subtract = (round - 3) * 500;
    // Floor at 2500ms for playability
    const duration = Math.max(2500, 5000 - subtract);
    return { duration, promptLength: 3 };
  }
}

// Helper to select an appropriate prompt of length L based on actual words in the dictionary
function generatePrompt(length: number, exclude?: string): string {
  // Use commonWords (the Google 10,000 English word list) to find highly playable prompts.
  const sourceWords = commonWords.filter(w => w.length >= length && /^[a-z]+$/.test(w));
  const pool = sourceWords.length > 100 ? sourceWords : dictionary.filter(w => w.length >= length && /^[a-z]+$/.test(w));

  const upperExclude = exclude ? exclude.toUpperCase() : null;

  if (pool.length === 0) {
    if (length === 1) return "A" === upperExclude ? "E" : "A";
    if (length === 2) return "TH" === upperExclude ? "IN" : "TH";
    if (length === 3) return "STR" === upperExclude ? "ING" : "STR";
    return "TION" === upperExclude ? "NESS" : "TION";
  }

  // Attempt up to 100 times to extract a clean alphabetical substring from a random word
  for (let i = 0; i < 100; i++) {
    const word = pool[Math.floor(Math.random() * pool.length)];
    const start = Math.floor(Math.random() * (word.length - length + 1));
    const sub = word.slice(start, start + length).toUpperCase();

    if (upperExclude && sub === upperExclude) {
      continue;
    }

    if (/^[A-Z]+$/.test(sub)) {
      // Avoid 2 and 3 letter prompts that literally spell out an English word itself (e.g. AGE, ATE, ARE, etc.)
      if ((length === 2 || length === 3) && wordSet.has(sub.toLowerCase())) {
        continue;
      }

      // For 3-letter prompts, let's ensure it has at least 3 matches inside the COMMON pool itself!
      // This guarantees that there are multiple very common everyday words containing the prompt.
      // E.g., for "ONB", it won't have 3 common words in Google 10k!
      const commonMatches = pool.filter(w => w.toUpperCase().includes(sub));
      const minMatches = length === 3 ? 3 : 2;
      if (commonMatches.length >= minMatches) {
        return sub;
      }
    }
  }

  // Pure fallbacks
  const fallbacks = length === 1 ? ["A", "E", "O", "I"] : length === 2 ? ["TH", "IN", "ER", "AN"] : length === 3 ? ["STR", "ING", "ENT", "TER"] : ["TION", "NESS", "MENT", "ABLE"];
  for (const fb of fallbacks) {
    if (upperExclude && fb === upperExclude) continue;
    return fb;
  }
  return fallbacks[0];
}

function transitionToNextTurn(lobby: Lobby, wss: WebSocketServer) {
  // 1. Mark that a turn has been taken
  lobby.turnsPlayedInCurrentRound++;
  lobby.turnNumber++;

  // 2. Check if the round should advance.
  const alivePlayers = lobby.players.filter(p => p.lives > 0);

  // If the game is over, we shouldn't continue
  if (alivePlayers.length === 0 || (!lobby.isSolo && alivePlayers.length <= 1)) {
    lobby.status = "gameover";
    lobby.winnerId = lobby.isSolo ? lobby.players[0].id : (alivePlayers[0]?.id || null);
    addLobbyLog(lobby, `🏆 GAME OVER! ${lobby.isSolo ? lobby.players[0].name : (alivePlayers[0]?.name || "Nobody")} finished with score: ${lobby.wordsPlayedCount}!`);
    broadcastLobbyState(lobby, wss);
    return;
  }

  const targetTurns = lobby.isSolo ? 3 : alivePlayers.length;
  if (lobby.turnsPlayedInCurrentRound >= targetTurns) {
    // Round completed! Advance to next round!
    lobby.currentRound++;
    lobby.turnsPlayedInCurrentRound = 0;
    addLobbyLog(lobby, `🌟 ROUND ${lobby.currentRound} BEGINS!`);
  }

  // 3. Move to next alive player index
  let nextIndex = (lobby.activePlayerIndex + 1) % lobby.players.length;
  while (lobby.players[nextIndex].lives <= 0) {
    nextIndex = (nextIndex + 1) % lobby.players.length;
  }
  lobby.activePlayerIndex = nextIndex;

  // Reset all players' typing text for the new turn
  lobby.players.forEach(p => p.typingText = "");

  // 4. Get settings for the current round
  const settings = getRoundSettings(lobby.currentRound);
  const oldPrompt = lobby.prompt;
  lobby.prompt = generatePrompt(settings.promptLength, oldPrompt);
  lobby.currentTurnDuration = settings.duration;
  lobby.turnTimerRemaining = lobby.currentTurnDuration;
  lobby.turnExpiresAt = Date.now() + lobby.currentTurnDuration;

  addLobbyLog(lobby, `👉 It is ${lobby.players[lobby.activePlayerIndex].name}'s turn! Time: ${(lobby.currentTurnDuration / 1000).toFixed(1)}s. Prompt: "${lobby.prompt}"`);
  broadcastLobbyState(lobby, wss);
}

async function removePlayerFromLobby(lobby: Lobby, playerId: string, reason: string): Promise<void> {
  const index = lobby.players.findIndex(p => p.id === playerId);
  if (index === -1) return;

  const leftPlayer = lobby.players[index];
  const leftPlayerName = leftPlayer.name;
  
  // Splice the player from the list
  lobby.players.splice(index, 1);
  addLobbyLog(lobby, `${leftPlayerName} ${reason}.`);

  // Handle active game adjustments
  if (lobby.status === "active") {
    const alivePlayers = lobby.players.filter(p => p.lives > 0);
    if (alivePlayers.length === 0 || (!lobby.isSolo && alivePlayers.length <= 1)) {
      // Game over
      lobby.status = "gameover";
      lobby.winnerId = lobby.isSolo ? (lobby.players[0]?.id || null) : (alivePlayers[0]?.id || null);
      addLobbyLog(lobby, `🏆 GAME OVER! ${lobby.isSolo ? (lobby.players[0]?.name || "Nobody") : (alivePlayers[0]?.name || "Nobody")} finished with score: ${lobby.wordsPlayedCount}!`);
    } else {
      // Adjust active player index
      if (index === lobby.activePlayerIndex) {
        // The active player left! Transition to the next turn immediately.
        // Bumping index back so that transitionToNextTurn advances to the correct shifted slot.
        lobby.activePlayerIndex = (lobby.activePlayerIndex - 1 + lobby.players.length) % lobby.players.length;
        transitionToNextTurn(lobby, wss);
      } else if (index < lobby.activePlayerIndex) {
        // An earlier player was removed, shift index down to keep pointing to the same active player.
        lobby.activePlayerIndex--;
      }
    }
  }

  // Promote next player to host if the old host left
  if (lobby.players.length > 0) {
    if (leftPlayer.isHost) {
      lobby.players[0].isHost = true;
    }
    await setLobby(lobby.id, lobby);
  } else {
    await deleteLobby(lobby.id);
  }
}

// Broadcaster helper
function broadcastLobbyState(lobby: Lobby, wss: WebSocketServer) {
  const payload = JSON.stringify({
    type: "lobby_update",
    lobby: {
      id: lobby.id,
      isPrivate: lobby.isPrivate,
      isSolo: lobby.isSolo,
      status: lobby.status,
      players: lobby.players,
      activePlayerIndex: lobby.activePlayerIndex,
      prompt: lobby.prompt,
      currentTurnDuration: lobby.currentTurnDuration,
      turnTimerRemaining: lobby.turnTimerRemaining,
      winnerId: lobby.winnerId,
      usedWords: lobby.usedWords,
      countdownValue: lobby.countdownValue,
      logs: lobby.logs,
      longestWord: lobby.longestWord,
      wordsPlayedCount: lobby.wordsPlayedCount,
      totalGuesses: lobby.totalGuesses,
      correctGuesses: lobby.correctGuesses,
      currentRound: lobby.currentRound,
      turnsPlayedInCurrentRound: lobby.turnsPlayedInCurrentRound,
      turnNumber: lobby.turnNumber,
      playedWordsDetail: lobby.playedWordsDetail
    }
  });

  // Find all WS connections belonging to this lobby
  for (const [ws, info] of clientLobbies.entries()) {
    if (info.lobbyId === lobby.id && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

const PORT = 3000;

// Track lobbies currently processing transitions to prevent duplicate timer explosions
const processingLobbies = new Set<string>();

// Authoritative turn-timer ticker running every 100ms
setInterval(async () => {
  const activeLobbyIds = new Set<string>();
  for (const info of clientLobbies.values()) {
    activeLobbyIds.add(info.lobbyId);
  }

  for (const lobbyId of activeLobbyIds) {
    if (processingLobbies.has(lobbyId)) {
      continue;
    }

    // Use cache to avoid rate-limiting Redis during rapid interval ticks
    const lobby = await getLobby(lobbyId, true);
    if (lobby && lobby.status === "active") {
      const remaining = lobby.turnExpiresAt ? (lobby.turnExpiresAt - Date.now()) : lobby.turnTimerRemaining;
      lobby.turnTimerRemaining = Math.max(0, remaining);
      
      // Broadcast tick on every 100ms interval to keep client timer perfectly synchronized
      const tickPayload = JSON.stringify({
        type: "tick",
        turnTimerRemaining: Math.max(0, lobby.turnTimerRemaining)
      });
      for (const [ws, info] of clientLobbies.entries()) {
        if (info.lobbyId === lobby.id && ws.readyState === WebSocket.OPEN) {
          ws.send(tickPayload);
        }
      }

      if (lobby.turnTimerRemaining <= 0) {
        processingLobbies.add(lobby.id);
        try {
          // ACTIVE PLAYER BOMB EXPLODED!
          const activePlayer = lobby.players[lobby.activePlayerIndex];
          if (activePlayer) {
            activePlayer.lives--;
            addLobbyLog(lobby, `💥 BOMB EXPLODED! ${activePlayer.name} ran out of time! -1 Life.`);

            // Feedback payload
            const explodePayload = JSON.stringify({
              type: "explode",
              playerId: activePlayer.id,
              message: `${activePlayer.name}'s bomb exploded!`
            });
            for (const [ws, info] of clientLobbies.entries()) {
              if (info.lobbyId === lobby.id && ws.readyState === WebSocket.OPEN) {
                ws.send(explodePayload);
              }
            }

            // Record this turn in history
            lobby.playedWordsDetail.push({
              word: "TIMEOUT",
              player: activePlayer.name,
              round: lobby.currentRound,
              prompt: lobby.prompt.toUpperCase(),
              success: false,
              turnNumber: lobby.turnNumber
            });

            transitionToNextTurn(lobby, wss);
            await setLobby(lobby.id, lobby);
          }
        } catch (err) {
          console.error("Error handling bomb explosion:", err);
        } finally {
          processingLobbies.delete(lobby.id);
        }
      } else {
        // Keep local memory representation updated
        lobbies.set(lobby.id, lobby);
      }
    }
  }
}, 100);

// WebSocket Server listener
wss.on("connection", (ws) => {
  console.log("Client connected via WebSocket.");

  ws.on("message", async (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());
      console.log("Received action:", message.type, message);

      switch (message.type) {
        case "join_lobby": {
          const { name, lobbyId, isPrivate, avatarSeed, isSolo, playerId: incomingPlayerId } = message;
          let lobby: Lobby | undefined;

          if (lobbyId) {
            lobby = await getLobby(lobbyId);
          }

          if (!lobby && !isPrivate && !lobbyId && !isSolo) {
            // Global matchmaking quick join: Find any public lobby in 'waiting' state
            lobby = await findWaitingPublicLobby();
          }

          if (!lobby) {
            // Create a brand new lobby
            const newId = lobbyId ? lobbyId.toUpperCase() : await generateLobbyId();
            lobby = {
              id: newId,
              isPrivate: !!isPrivate || !!isSolo,
              isSolo: !!isSolo,
              status: "waiting",
              players: [],
              activePlayerIndex: 0,
              prompt: "RE",
              currentTurnDuration: 8000,
              turnTimerRemaining: 8000,
              winnerId: null,
              usedWords: [],
              playedWordsDetail: [],
              turnNumber: 0,
              countdownValue: 3,
              logs: [],
              longestWord: null,
              wordsPlayedCount: 0,
              totalGuesses: 0,
              correctGuesses: 0,
              currentRound: 1,
              turnsPlayedInCurrentRound: 0
            };
            await setLobby(newId, lobby);
            addLobbyLog(lobby, `Lobby created successfully. Code: ${newId}`);
          }

          // Check for valid player name
          if (!name || !name.trim()) {
            ws.send(JSON.stringify({ type: "error", message: "A player name is required to join!" }));
            return;
          }
          const finalName = name.trim();

          // Check if there is an existing player with the same name (case-insensitive)
          const existingPlayer = lobby.players.find(p => p.name.toLowerCase() === finalName.toLowerCase());
          let playerId: string;

          if (existingPlayer) {
            const isSameUser = incomingPlayerId && incomingPlayerId === existingPlayer.id;

            if (isSameUser) {
              // Same user reconnecting! Clean up old socket connection
              for (const [oldWs, info] of clientLobbies.entries()) {
                if (info.lobbyId === lobby.id && info.playerId === existingPlayer.id && oldWs !== ws) {
                  clientLobbies.delete(oldWs);
                  try {
                    oldWs.close();
                  } catch (e) {}
                }
              }

              // Cancel pending disconnect timeout if any
              const timeoutKey = `${lobby.id}_${existingPlayer.id}`;
              if (disconnectTimeouts.has(timeoutKey)) {
                clearTimeout(disconnectTimeouts.get(timeoutKey)!);
                disconnectTimeouts.delete(timeoutKey);
              }

              existingPlayer.isConnected = true;
              playerId = existingPlayer.id;
              clientLobbies.set(ws, { lobbyId: lobby.id, playerId });
              ws.send(JSON.stringify({ type: "join_success", playerId }));
              addLobbyLog(lobby, `${existingPlayer.name} reconnected.`);
              await setLobby(lobby.id, lobby);
              broadcastLobbyState(lobby, wss);
              break;
            } else {
              // Different user or new session trying to use the same name while it's taken
              ws.send(JSON.stringify({ type: "error", message: `Name "${finalName}" is already taken in this room!` }));
              return;
            }
          }

          // Create Player Profile
          playerId = "p_" + Math.random().toString(36).substr(2, 9);
          const newPlayer: Player = {
            id: playerId,
            name: finalName,
            lives: 3,
            score: 0,
            isHost: lobby.players.length === 0,
            avatarSeed: avatarSeed || Math.random().toString(36).substring(7),
            isConnected: true
          };

          // Enforce player limits
          if (lobby.isSolo) {
            if (lobby.players.length >= 1) {
              ws.send(JSON.stringify({ type: "error", message: "Solo arena is already occupied!" }));
              return;
            }
          } else {
            if (lobby.players.length >= 5) {
              ws.send(JSON.stringify({ type: "error", message: "Lobby is full! Max 5 players." }));
              return;
            }
          }

          lobby.players.push(newPlayer);
          clientLobbies.set(ws, { lobbyId: lobby.id, playerId });
          ws.send(JSON.stringify({ type: "join_success", playerId }));
          if (lobby.isSolo) {
            addLobbyLog(lobby, `${newPlayer.name} entered SOLO ARENA.`);
            
            // Automatically trigger start game countdown for solo lobby
            lobby.status = "countdown";
            lobby.countdownValue = 3;
            addLobbyLog(lobby, "Solo run starts in 3...");
            await setLobby(lobby.id, lobby);
            broadcastLobbyState(lobby, wss);

            const countdownInterval = setInterval(async () => {
              const freshLobby = await getLobby(lobby!.id);
              if (!freshLobby || freshLobby.status !== "countdown") {
                clearInterval(countdownInterval);
                return;
              }
              freshLobby.countdownValue--;
              if (freshLobby.countdownValue > 0) {
                addLobbyLog(freshLobby, `Solo run starts in ${freshLobby.countdownValue}...`);
                await setLobby(freshLobby.id, freshLobby);
                broadcastLobbyState(freshLobby, wss);
              } else {
                clearInterval(countdownInterval);
                freshLobby.status = "active";
                freshLobby.activePlayerIndex = 0;
                freshLobby.usedWords = [];
                freshLobby.playedWordsDetail = [];
                freshLobby.turnNumber = 1;
                freshLobby.wordsPlayedCount = 0;
                freshLobby.currentRound = 1;
                freshLobby.turnsPlayedInCurrentRound = 0;
                const settings = getRoundSettings(1);
                const oldPrompt = freshLobby.prompt;
                freshLobby.prompt = generatePrompt(settings.promptLength, oldPrompt);
                freshLobby.currentTurnDuration = settings.duration;
                freshLobby.turnTimerRemaining = freshLobby.currentTurnDuration;
                freshLobby.turnExpiresAt = Date.now() + freshLobby.currentTurnDuration;
                freshLobby.players.forEach(p => p.lives = 3);
                
                addLobbyLog(freshLobby, "SOLO ARENA RUN INITIATED! GO GO GO!");
                addLobbyLog(freshLobby, `Contains the letter: "${freshLobby.prompt}"`);
                
                await setLobby(freshLobby.id, freshLobby);
                broadcastLobbyState(freshLobby, wss);
              }
            }, 1000);
          } else {
            addLobbyLog(lobby, `${newPlayer.name} joined. [${lobby.players.length}/5]`);
            await setLobby(lobby.id, lobby);
            broadcastLobbyState(lobby, wss);
          }
          break;
        }

        case "start_game": {
          const { lobbyId } = message;
          const lobby = await getLobby(lobbyId);
          if (!lobby) return;

          if (lobby.isSolo) {
            if (lobby.players.length < 1) {
              ws.send(JSON.stringify({ type: "error", message: "Must have at least 1 player to start Solo run!" }));
              return;
            }
          } else {
            if (lobby.players.length < 2) {
              ws.send(JSON.stringify({ type: "error", message: "Must have at least 2 players to start game!" }));
              return;
            }
          }

          // Countdown before starting game
          lobby.status = "countdown";
          lobby.countdownValue = 3;
          addLobbyLog(lobby, "Game starts in 3...");
          await setLobby(lobby.id, lobby);
          broadcastLobbyState(lobby, wss);

          const countdownInterval = setInterval(async () => {
            const freshLobby = await getLobby(lobby.id);
            if (!freshLobby || freshLobby.status !== "countdown") {
              clearInterval(countdownInterval);
              return;
            }
            freshLobby.countdownValue--;
            if (freshLobby.countdownValue > 0) {
              addLobbyLog(freshLobby, `Game starts in ${freshLobby.countdownValue}...`);
              await setLobby(freshLobby.id, freshLobby);
              broadcastLobbyState(freshLobby, wss);
            } else {
              clearInterval(countdownInterval);
              freshLobby.status = "active";
              freshLobby.activePlayerIndex = 0;
              freshLobby.usedWords = [];
              freshLobby.playedWordsDetail = [];
              freshLobby.turnNumber = 1;
              freshLobby.wordsPlayedCount = 0;
              freshLobby.currentRound = 1;
              freshLobby.turnsPlayedInCurrentRound = 0;
              const settings = getRoundSettings(1);
              const oldPrompt = freshLobby.prompt;
              freshLobby.prompt = generatePrompt(settings.promptLength, oldPrompt);
              freshLobby.currentTurnDuration = settings.duration;
              freshLobby.turnTimerRemaining = freshLobby.currentTurnDuration;
              freshLobby.turnExpiresAt = Date.now() + freshLobby.currentTurnDuration;
              
              // Set lives to 3
              freshLobby.players.forEach(p => p.lives = 3);
              
              addLobbyLog(freshLobby, "GAME INITIATED! GO GO GO!");
              addLobbyLog(freshLobby, `Contains the letter: "${freshLobby.prompt}"`);
              
              await setLobby(freshLobby.id, freshLobby);
              broadcastLobbyState(freshLobby, wss);
            }
          }, 1000);
          break;
        }

        case "submit_word": {
          const { lobbyId, playerId, word } = message;
          const lobby = await getLobby(lobbyId);
          if (!lobby || lobby.status !== "active") return;

          const activePlayer = lobby.players[lobby.activePlayerIndex];
          if (!activePlayer || activePlayer.id !== playerId) {
            ws.send(JSON.stringify({ type: "word_feedback", success: false, reason: "NOT YOUR TURN!" }));
            return;
          }

          const cleanWord = word?.trim().toLowerCase();
          const prompt = lobby.prompt.toLowerCase();
          lobby.totalGuesses++;

          const isWaltonSpecial = cleanWord === "walton" && cleanWord.includes(prompt);
          const isGhenisaSpecial = cleanWord === "ghenisa" && cleanWord.includes(prompt);
          const isSpecialAllowedWord = isWaltonSpecial || isGhenisaSpecial;

          // Validation 1: Match prompt
          if (!cleanWord || !cleanWord.includes(prompt)) {
            await setLobby(lobby.id, lobby);
            ws.send(JSON.stringify({ 
              type: "word_feedback", 
              success: false, 
              reason: `MUST CONTAIN "${lobby.prompt}"` 
            }));
            return;
          }

          // Validation 2: Already used
          if (!isSpecialAllowedWord && lobby.usedWords.map(uw => uw.toLowerCase()).includes(cleanWord)) {
            await setLobby(lobby.id, lobby);
            ws.send(JSON.stringify({ 
              type: "word_feedback", 
              success: false, 
              reason: "WORD ALREADY SPELLED!" 
            }));
            return;
          }

          // Validation 3: Check dictionary (exhaustive lookup using wordSet and fallback API)
          let isValid = isSpecialAllowedWord || wordSet.has(cleanWord);
          if (!isValid) {
            try {
              console.log(`Checking live English Dictionary API fallback for: ${cleanWord}`);
              const apiRes = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${cleanWord}`);
              if (apiRes.status === 200) {
                isValid = true;
                wordSet.add(cleanWord);
                dictionary.push(cleanWord);
                console.log(`Live API verified obscure word: "${cleanWord}"! Unlocked.`);
              }
            } catch (apiErr) {
              console.error("Dictionary API check failed:", apiErr);
            }
          }

          if (!isValid) {
            await setLobby(lobby.id, lobby);
            ws.send(JSON.stringify({ 
              type: "word_feedback", 
              success: false, 
              reason: "NOT IN DICTIONARY!" 
            }));
            return;
          }

          // SUCCESSFUL SUBMISSION!
          lobby.usedWords.push(cleanWord.toUpperCase());
          lobby.playedWordsDetail.push({
            word: cleanWord.toUpperCase(),
            player: activePlayer.name,
            round: lobby.currentRound,
            prompt: lobby.prompt.toUpperCase(),
            success: true,
            turnNumber: lobby.turnNumber
          });
          addLobbyLog(lobby, `${activePlayer.name} typed: "${cleanWord.toUpperCase()}" (+ Accepted!)`);

          // Update statistics
          if (!lobby.longestWord || cleanWord.length > lobby.longestWord.word.length) {
            lobby.longestWord = { word: cleanWord.toUpperCase(), player: activePlayer.name };
          }
          lobby.wordsPlayedCount++;
          lobby.correctGuesses++;

          transitionToNextTurn(lobby, wss);
          await setLobby(lobby.id, lobby);

          ws.send(JSON.stringify({ 
            type: "word_feedback", 
            success: true, 
            word: cleanWord.toUpperCase(), 
            playerId: activePlayer.id,
            message: "STRIKE!" 
          }));
          break;
        }

        case "rematch": {
          const { lobbyId } = message;
          const lobby = await getLobby(lobbyId);
          if (!lobby) return;

          // Reset lobby variables but preserve the players and room connection
          lobby.winnerId = null;
          lobby.usedWords = [];
          lobby.playedWordsDetail = [];
          lobby.turnNumber = 0;
          lobby.longestWord = null;
          lobby.wordsPlayedCount = 0;
          lobby.totalGuesses = 0;
          lobby.correctGuesses = 0;
          lobby.currentRound = 1;
          lobby.turnsPlayedInCurrentRound = 0;
          const initialSettings = getRoundSettings(1);
          lobby.currentTurnDuration = initialSettings.duration;
          lobby.turnTimerRemaining = lobby.currentTurnDuration;
          lobby.turnExpiresAt = undefined;
          
          // Re-initialize players lives
          lobby.players.forEach(p => {
            p.lives = 3;
            p.score = 0;
            p.typingText = "";
          });

          if (lobby.isSolo) {
            lobby.status = "countdown";
            lobby.countdownValue = 3;
            addLobbyLog(lobby, "Solo run starts in 3...");
            await setLobby(lobby.id, lobby);
            broadcastLobbyState(lobby, wss);

            const countdownInterval = setInterval(async () => {
              const freshLobby = await getLobby(lobby.id);
              if (!freshLobby || freshLobby.status !== "countdown") {
                clearInterval(countdownInterval);
                return;
              }
              freshLobby.countdownValue--;
              if (freshLobby.countdownValue > 0) {
                addLobbyLog(freshLobby, `Solo run starts in ${freshLobby.countdownValue}...`);
                await setLobby(freshLobby.id, freshLobby);
                broadcastLobbyState(freshLobby, wss);
              } else {
                clearInterval(countdownInterval);
                freshLobby.status = "active";
                freshLobby.activePlayerIndex = 0;
                freshLobby.usedWords = [];
                freshLobby.playedWordsDetail = [];
                freshLobby.turnNumber = 1;
                freshLobby.wordsPlayedCount = 0;
                freshLobby.currentRound = 1;
                freshLobby.turnsPlayedInCurrentRound = 0;
                const settings = getRoundSettings(1);
                const oldPrompt = freshLobby.prompt;
                freshLobby.prompt = generatePrompt(settings.promptLength, oldPrompt);
                freshLobby.currentTurnDuration = settings.duration;
                freshLobby.turnTimerRemaining = freshLobby.currentTurnDuration;
                freshLobby.turnExpiresAt = Date.now() + freshLobby.currentTurnDuration;
                freshLobby.players.forEach(p => p.lives = 3);
                
                addLobbyLog(freshLobby, "SOLO ARENA RUN INITIATED! GO GO GO!");
                addLobbyLog(freshLobby, `Contains the letter: "${freshLobby.prompt}"`);
                
                await setLobby(freshLobby.id, freshLobby);
                broadcastLobbyState(freshLobby, wss);
              }
            }, 1000);
          } else {
            lobby.status = "waiting";
            addLobbyLog(lobby, "Rematch initiated. Waiting for start...");
            await setLobby(lobby.id, lobby);
            broadcastLobbyState(lobby, wss);
          }
          break;
        }

        case "typing_update": {
          const { lobbyId, text } = message;
          const info = clientLobbies.get(ws);
          if (info && info.lobbyId === lobbyId) {
            const lobby = await getLobby(lobbyId);
            if (lobby) {
              const player = lobby.players.find(p => p.id === info.playerId);
              if (player) {
                player.typingText = text || "";
                await setLobby(lobby.id, lobby);
                broadcastLobbyState(lobby, wss);
              }
            }
          }
          break;
        }

        case "leave_lobby": {
          const info = clientLobbies.get(ws);
          if (info) {
            const lobby = await getLobby(info.lobbyId);
            if (lobby) {
              // Cancel pending disconnect timeout if any
              const timeoutKey = `${lobby.id}_${info.playerId}`;
              if (disconnectTimeouts.has(timeoutKey)) {
                clearTimeout(disconnectTimeouts.get(timeoutKey)!);
                disconnectTimeouts.delete(timeoutKey);
              }
              await removePlayerFromLobby(lobby, info.playerId, "left the lobby");
              broadcastLobbyState(lobby, wss);
            }
            clientLobbies.delete(ws);
          }
          break;
        }
      }
    } catch (e) {
      console.error("Error processing websocket payload:", e);
    }
  });

  ws.on("close", async () => {
    const info = clientLobbies.get(ws);
    if (info) {
      const lobby = await getLobby(info.lobbyId);
      if (lobby) {
        const player = lobby.players.find(p => p.id === info.playerId);
        if (player) {
          player.isConnected = false;
          addLobbyLog(lobby, `${player.name} disconnected.`);
          await setLobby(lobby.id, lobby);
          broadcastLobbyState(lobby, wss);

          // Grace period: wait 4 seconds before kicking
          const timeoutKey = `${lobby.id}_${player.id}`;
          if (disconnectTimeouts.has(timeoutKey)) {
            clearTimeout(disconnectTimeouts.get(timeoutKey)!);
          }
          const timeoutId = setTimeout(async () => {
            disconnectTimeouts.delete(timeoutKey);
            const recheckLobby = await getLobby(info.lobbyId);
            if (recheckLobby) {
              const recheckPlayer = recheckLobby.players.find(p => p.id === info.playerId);
              if (recheckPlayer && !recheckPlayer.isConnected) {
                // Connection grace period expired - remove fully
                await removePlayerFromLobby(recheckLobby, info.playerId, "disconnected");
                broadcastLobbyState(recheckLobby, wss);
              }
            }
          }, 4000);
          disconnectTimeouts.set(timeoutKey, timeoutId);
        }
      }
      clientLobbies.delete(ws);
    }
  });
});

// Create express application and HTTP server
const app = express();
const httpServer = createServer(app);

// Mount WS server on upgrade
httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/api/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  }
});

// Dedicated health endpoints
app.get("/healthz", (req, res) => {
  res.send("OK");
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Wordclart API running." });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Dev mode: use Vite middleware
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("Vite dev server middleware mounted.");
    } catch (err) {
      console.error("Failed to mount Vite dev middleware:", err);
    }
  } else {
    // Production mode: serve static files from dist
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log(`Serving static files from ${distPath}`);
  }

  // Bind to port 3000 in dev to respect the hardcoded AI Studio container ingress.
  // In production, use the dynamic process.env.PORT (Render/Glitch), or default to 7860 (Hugging Face).
  const PORT = process.env.NODE_ENV === "production"
    ? (process.env.PORT ? parseInt(process.env.PORT) : 7860)
    : 3000;

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();

// Maintain compatibility with Vercel serverless exports if needed
export default httpServer;
