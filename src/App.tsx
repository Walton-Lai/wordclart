/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Swords, Menu, User, Copy, Lock, HelpCircle, Volume2, VolumeX, 
  Timer, Check, X, Terminal, ArrowRight, RotateCcw, 
  Trophy, Heart, Percent, Star, Coins, Flame, AlertCircle, Info, Zap, Plus
} from "lucide-react";
import { audio } from "./audio";
import { Player, LobbyState } from "./types";

export default function App() {
  const [playerName, setPlayerName] = useState(() => {
    return localStorage.getItem("wordclart_name") || "";
  });
  const [avatarSeed, setAvatarSeed] = useState(() => {
    return localStorage.getItem("wordclart_seed") || Math.random().toString(36).substring(7);
  });
  const [customLobbyId, setCustomLobbyId] = useState("");
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [inputText, setInputText] = useState("");
  const [muted, setMuted] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);

  // Tabs for direct visual review (Lobby, Battle, Stats) matching the bottom nav in screenshots
  // We sync this automatically with actual game state, but allow manual overrides for pure visual inspection.
  const [activeTab, setActiveTab] = useState<"lobby" | "battle" | "stats">("lobby");
  
  // Client-side feedback notifications
  const [feedback, setFeedback] = useState<{ id: string; text: string; isSuccess: boolean } | null>(null);
  
  // Local turn timer interpolation for extra smooth visuals
  const [localTimerRemaining, setLocalTimerRemaining] = useState<number>(12000);

  const socketRef = useRef<WebSocket | null>(null);
  const feedbackTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);

  // Sync activeTab with live game state automatically
  useEffect(() => {
    if (!lobby) return;
    if (lobby.status === "waiting") {
      setActiveTab("lobby");
    } else if (lobby.status === "active" || lobby.status === "countdown") {
      setActiveTab("battle");
    } else if (lobby.status === "gameover") {
      setActiveTab("stats");
    }
  }, [lobby?.status]);

  // Automatically scroll to the top of the page with a seamless transition when changing pages
  useEffect(() => {
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }, [lobby !== null, activeTab, lobby?.status]);

  // Initialize Audio settings
  useEffect(() => {
    setMuted(audio.isMuted());
  }, []);

  const handleMuteToggle = () => {
    const isMuted = audio.toggleMute();
    setMuted(isMuted);
  };

  const randomizeAvatar = () => {
    const newSeed = Math.random().toString(36).substring(7);
    setAvatarSeed(newSeed);
    localStorage.setItem("wordclart_seed", newSeed);
    audio.playType();
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const lettersOnly = e.target.value.replace(/[^a-zA-Z]/g, '');
    setPlayerName(lettersOnly);
    audio.playType();
  };

  // Load lobby from URL on start
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lobbyParam = params.get("room") || params.get("lobby");
    if (lobbyParam && !lobby) {
      setCustomLobbyId(lobbyParam.toUpperCase());
    }
  }, []);

  // Clear input field when the prompt or turn transitions to prevent stale letters
  useEffect(() => {
    setInputText("");
  }, [lobby?.prompt, lobby?.activePlayerIndex]);

  // Sync timer
  useEffect(() => {
    if (!lobby || lobby.status !== "active") return;
    setLocalTimerRemaining(lobby.turnTimerRemaining);
  }, [lobby?.turnTimerRemaining]);

  // Trigger fast clock ticking sound effect when under 2.5 seconds left with perfect clockwork rhythm
  useEffect(() => {
    if (!lobby || lobby.status !== "active") return;

    const activePlayer = lobby.players[lobby.activePlayerIndex];
    const isOurTurn = activePlayer && activePlayer.id === playerId;

    const isTimeCritical = localTimerRemaining <= 2500 && localTimerRemaining > 0;

    if (!isOurTurn || !isTimeCritical) {
      return;
    }

    // Play immediate first tick
    let isTock = false;
    audio.playTick(isTock);

    // Exact, steady 250ms mechanical rhythm (completely immune to local timer jitter or rounding)
    const tickInterval = setInterval(() => {
      isTock = !isTock;
      audio.playTick(isTock);
    }, 250);

    return () => clearInterval(tickInterval);
  }, [lobby?.status, lobby?.activePlayerIndex, playerId, localTimerRemaining <= 2500 && localTimerRemaining > 0]);

  // Smooth interpolator for timers (60fps fluid update)
  useEffect(() => {
    if (!lobby || lobby.status !== "active") return;
    let lastTime = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();
      const delta = now - lastTime;
      lastTime = now;
      setLocalTimerRemaining((prev) => {
        if (prev <= 0) return 0;
        return Math.max(0, prev - delta);
      });
    }, 16);
    return () => clearInterval(interval);
  }, [lobby?.status, lobby?.activePlayerIndex]);

  // Scroll logs
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [lobby?.logs?.length]);

  // Connect to core socket
  const connectToSocket = (actionCallback: () => void) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      actionCallback();
      return;
    }

    const socketUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/ws`;
    
    console.log("Connecting to core WebSocket server:", socketUrl);
    const socket = new WebSocket(socketUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      setWsConnected(true);
      actionCallback();
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        console.log("WS Payload:", payload);

        switch (payload.type) {
          case "lobby_update": {
            const updatedLobby = payload.lobby as LobbyState;
            setLobby(updatedLobby);
            
            // Auto match ourselves
            if (!playerId) {
              const matched = updatedLobby.players.find(
                p => p.name === playerName || (p.isHost && updatedLobby.players.length === 1)
              );
              if (matched) {
                setPlayerId(matched.id);
              }
            }

            if (updatedLobby.status === "countdown") {
              if (lobby?.status !== "countdown" || lobby?.countdownValue !== updatedLobby.countdownValue) {
                audio.playCountdown(updatedLobby.countdownValue);
              }
            }
            if (updatedLobby.status === "active" && lobby?.status === "countdown") {
              audio.playCountdown(0);
            }
            if (updatedLobby.status === "gameover" && lobby?.status === "active") {
              const weWon = updatedLobby.winnerId === playerId;
              audio.playGameOver(weWon);
            }
            break;
          }

          case "word_feedback": {
            const { success, reason, word } = payload;
            let text = success ? `NICE ONE. "${word}"` : `❌ ${reason}`;
            if (success && word === "WALTON") {
              text = "GOOD BOY!";
            } else if (success && word === "GHENISA") {
              text = "SUSSY?";
            }
            setFeedback({ id: Math.random().toString(), text, isSuccess: success });
            if (success) {
              audio.playSuccess();
            } else {
              audio.playError();
            }
            if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
            feedbackTimerRef.current = setTimeout(() => setFeedback(null), 2500);
            break;
          }

          case "tick": {
            setLocalTimerRemaining(payload.turnTimerRemaining);
            break;
          }

          case "explode": {
            audio.playExplode();
            setFeedback({ id: Math.random().toString(), text: "💥 BOMB EXPLODED!", isSuccess: false });
            if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
            feedbackTimerRef.current = setTimeout(() => setFeedback(null), 2500);
            break;
          }

          case "error": {
            setFeedback({ id: Math.random().toString(), text: payload.message, isSuccess: false });
            audio.playError();
            break;
          }
        }
      } catch (err) {
        console.error("WS parse error:", err);
      }
    };

    socket.onerror = (error) => {
      console.error("GAME_WS_ERROR:", error);
    };

    socket.onclose = (event) => {
      setWsConnected(false);
      console.warn("GAME_WS_CLOSED:", event.code, event.reason);
    };
  };

  const joinLobby = (isPrivate: boolean, specificId?: string, isSolo?: boolean) => {
    const finalName = playerName.trim();
    if (!finalName) {
      setFeedback({ id: Math.random().toString(), text: "❌ Please enter a player name first!", isSuccess: false });
      audio.playError();
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = setTimeout(() => setFeedback(null), 2500);
      return;
    }
    setPlayerName(finalName);
    localStorage.setItem("wordclart_name", finalName);

    connectToSocket(() => {
      if (!socketRef.current) return;
      socketRef.current.send(JSON.stringify({
        type: "join_lobby",
        name: finalName,
        isPrivate,
        lobbyId: specificId || undefined,
        avatarSeed,
        isSolo
      }));
    });
  };

  // Handle tab visibility change - forfeit and leave if they switch tabs / go inactive for more than 1 minute
  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    let hiddenAt: number | null = null;

    const handleLeave = () => {
      if (lobby && socketRef.current) {
        console.log("Forfeiting/leaving game due to tab switch or exit event");
        if (socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: "leave_lobby" }));
          socketRef.current.close();
        }
        setLobby(null);
        setPlayerId(null);
        setInputText("");
        setFeedback({
          id: Math.random().toString(),
          text: "⚠️ MATCH FORFEITED: You left the tab for more than 1 minute!",
          isSuccess: false
        });
        audio.playError();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (!hiddenAt) {
          hiddenAt = Date.now();
        }
        // Set a timer for 1 minute (60,000ms)
        if (!timeoutId) {
          timeoutId = setTimeout(() => {
            handleLeave();
          }, 60000);
        }
      } else if (document.visibilityState === "visible") {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (hiddenAt) {
          const elapsed = Date.now() - hiddenAt;
          hiddenAt = null;
          if (elapsed >= 60000) {
            handleLeave();
          }
        }
      }
    };

    const handlePageHide = () => {
      handleLeave();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);
    };
  }, [lobby, playerId]);

  const startBattle = () => {
    if (!lobby || !socketRef.current) return;
    audio.playSuccess();
    socketRef.current.send(JSON.stringify({
      type: "start_game",
      lobbyId: lobby.id
    }));
  };

  const submitWord = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lobby || !playerId || !inputText.trim() || !socketRef.current) return;

    audio.playType();
    const clean = inputText.trim().toUpperCase();
    setInputText("");

    // Clear typing text on the server immediately
    socketRef.current.send(JSON.stringify({
      type: "typing_update",
      lobbyId: lobby.id,
      text: ""
    }));

    socketRef.current.send(JSON.stringify({
      type: "submit_word",
      lobbyId: lobby.id,
      playerId,
      word: clean
    }));

    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const initiateRematch = () => {
    if (!lobby || !socketRef.current) return;
    audio.playSuccess();
    socketRef.current.send(JSON.stringify({
      type: "rematch",
      lobbyId: lobby.id
    }));
  };

  const leaveLobby = () => {
    audio.playClose();
    if (socketRef.current) {
      socketRef.current.send(JSON.stringify({ type: "leave_lobby" }));
      socketRef.current.close();
    }
    setLobby(null);
    setPlayerId(null);
    setInputText("");
    setFeedback(null);
  };

  const copyRoomLink = () => {
    if (!lobby) return;
    const url = `${window.location.origin}${window.location.pathname}?lobby=${lobby.id}`;
    navigator.clipboard.writeText(url).then(() => {
      audio.playSuccess();
      setFeedback({ id: "copy", text: "ROOM LINK COPIED!", isSuccess: true });
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = setTimeout(() => setFeedback(null), 2000);
    });
  };

  const getAvatarBg = (seed: string) => {
    const bgColors = [
      "bg-[#f59e0b]", "bg-[#10b981]", "bg-[#3b82f6]", 
      "bg-[#ec4899]", "bg-[#8b5cf6]", "bg-[#06b6d4]", "bg-[#f43f5e]"
    ];
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    }
    return bgColors[Math.abs(hash) % bgColors.length];
  };

  // Percent timer logic
  const getTimerRemainingPercent = () => {
    if (!lobby) return 100;
    return (localTimerRemaining / lobby.currentTurnDuration) * 100;
  };

  const getAnxietyColor = () => {
    const pct = getTimerRemainingPercent();
    if (pct > 60) return "bg-[#10b981]";
    if (pct > 30) return "bg-[#f59e0b]";
    return "bg-[#ef4444] animate-pulse";
  };

  const activePlayer = lobby ? lobby.players[lobby.activePlayerIndex] : null;
  const isOurTurn = activePlayer && activePlayer.id === playerId;

  // Automatically focus the input field on mobile / desktop when it's our turn
  useEffect(() => {
    if (isOurTurn && inputRef.current) {
      const focusInput = () => {
        if (inputRef.current) {
          inputRef.current.focus();
          // Ensure virtual keyboard triggers by calling click and positioning caret at the end
          inputRef.current.click();
          const len = inputRef.current.value.length;
          try {
            inputRef.current.setSelectionRange(len, len);
          } catch (e) {
            // Ignored if type doesn't support selection range
          }
        }
      };

      // Try immediately
      focusInput();

      // Progressive timeouts to handle render lag, transitions, or disabled state changes
      const t1 = setTimeout(focusInput, 50);
      const t2 = setTimeout(focusInput, 150);
      const t3 = setTimeout(focusInput, 300);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
  }, [isOurTurn, lobby?.prompt, lobby?.activePlayerIndex]);

  const getGameOverBanner = () => {
    if (!lobby) return { text: "💀 DEFEATED", style: "bg-red-600 text-white" };

    const isSolo = !!lobby.isSolo;
    const isWinner = !isSolo && lobby.winnerId === playerId;
    
    if (isWinner) {
      return {
        text: "🏆 VICTORY!",
        style: "bg-[#facc15] text-black"
      };
    }

    const currentRound = lobby.currentRound || 1;

    if (currentRound === 1) {
      return {
        text: "😡 SERIOUSLY?",
        style: "bg-red-600 text-white"
      };
    } else if (currentRound === 2) {
      return {
        text: "🙄 BRUH...",
        style: "bg-red-400 text-white"
      };
    } else if (currentRound === 3) {
      return {
        text: "😐 MEH...",
        style: "bg-orange-500 text-white"
      };
    } else {
      return {
        text: "😅 WELP, YA TRIED.",
        style: "bg-orange-300 text-black"
      };
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col bg-[#131313] text-[#e5e2e1] font-sans selection:bg-[#facc15] selection:text-black antialiased overflow-x-hidden">
      {/* Background Matrix */}
      <div className="fixed inset-0 bg-grid-pattern opacity-40 pointer-events-none z-0" />
      <div className="fixed inset-0 dot-grid-bg opacity-25 pointer-events-none z-0" />

      {/* Floating graphics: varied styled squares */}
      <div className="hidden md:block fixed -bottom-16 -left-16 w-64 h-64 border-[4px] border-white/5 rotate-12 pointer-events-none z-0" />
      <div className="hidden md:block fixed top-1/4 -right-12 w-48 h-48 border-[4px] border-[#facc15]/10 -rotate-45 pointer-events-none z-0" />
      <div className="hidden sm:block fixed top-12 left-10 w-32 h-32 border-[3px] border-white/5 rotate-[24deg] pointer-events-none z-0" />
      <div className="hidden md:block fixed top-1/3 left-1/4 w-80 h-80 border-[4px] border-white/3 rotate-[-35deg] pointer-events-none z-0" />
      <div className="hidden lg:block fixed top-1/2 right-1/4 w-56 h-56 border-[3px] border-[#facc15]/5 rotate-[15deg] pointer-events-none z-0" />
      <div className="hidden sm:block fixed bottom-10 right-10 w-40 h-40 border-[3px] border-white/8 rotate-[70deg] pointer-events-none z-0" />
      <div className="hidden md:block fixed top-8 left-1/2 w-16 h-16 border-[2px] border-[#facc15]/10 rotate-[55deg] pointer-events-none z-0" />
      <div className="hidden xl:block fixed bottom-24 left-1/3 w-48 h-48 border-[3px] border-white/4 rotate-[-18deg] pointer-events-none z-0" />



      {/* (BOMBO)CLART CLOCK (Present at top in Combat/Battle arena view - Image 4) */}
      {lobby && lobby.status === "active" && activeTab === "battle" && (
        <div className="relative z-50 w-full bg-black border-b-[4px] border-white px-3 md:px-6 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-[#ef4444] fill-[#ef4444] animate-bounce" />
            <span className="font-black text-xs tracking-[0.2em] text-[#ef4444] uppercase">(BOMBO)CLART CLOCK</span>
          </div>
          <div className="flex-1 max-w-xl mx-2 md:mx-4 h-4 bg-[#1c1b1b] border-[3px] border-white rounded-none overflow-hidden relative">
            <div 
              className={`h-full transition-[width] duration-30 ease-out transition-colors duration-500 ease-in-out ${getAnxietyColor()}`}
              style={{ width: `${getTimerRemainingPercent()}%` }}
            />
          </div>
          <div className="text-right">
            <span className="font-mono font-black text-xs text-white">
              {(localTimerRemaining / 1000).toFixed(1)}s
            </span>
          </div>
        </div>
      )}



      {/* CORE FRAME LAYOUT */}
      <div className="flex-1 flex flex-col md:flex-row relative z-10">

        {/* MAIN CONTAINER FRAME */}
        <main className="flex-grow flex flex-col items-center justify-center px-4 py-8 relative">
          <AnimatePresence mode="wait">

            {/* SCREEN 1: SPLASH VIEW (Image 1) */}
            {!lobby && (
              <motion.div 
                key="splash"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25 }}
                className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-center"
              >
                {/* Left side: Hero Typography & Info badge */}
                <div className="lg:col-span-7 flex flex-col gap-6">
                  <div className="relative inline-block">
                    <h1 
                      className="text-6xl sm:text-8xl md:text-9xl font-black tracking-tighter text-white uppercase italic select-none leading-[0.85]"
                      style={{ 
                        WebkitTextStroke: "3px #facc15",
                        paintOrder: "stroke fill"
                      }}
                    >
                      WORD
                      <br />
                      CLART
                    </h1>
                    {/* The signature yellow rotated block from Screenshot Part 1 */}
                    <div className="absolute -bottom-4 left-0 w-36 h-5 bg-[#facc15] -rotate-2 border-[3px] border-white rounded-none -z-10" />
                  </div>

                  <p className="text-lg md:text-xl text-gray-400 max-w-md mt-6 border-l-[6px] border-[#facc15] pl-4 font-bold tracking-tight uppercase leading-snug">
                    HIGH-SPEED WORD GAME.
                    <span className="text-white block mt-1">OUT-THINK. OUT-SPELL. OUT-LAST.</span>
                  </p>
                </div>

                {/* Right side: Interactive Bento Form & Actions */}
                <div id="rules-container-card" className="lg:col-span-5 flex flex-col gap-5 bg-[#1c1b1b] border-[4px] border-white p-6 rounded-none relative shadow-[6px_6px_0px_0px_rgba(250,204,21,1)] overflow-hidden">
                  
                  {/* Identity settings block */}
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-black uppercase tracking-widest text-[#facc15]">Your Player Profile</label>
                    <div className="flex gap-3">
                      <button 
                        id="avatar-btn"
                        onClick={randomizeAvatar}
                        className={`w-14 h-14 shrink-0 border-[3px] border-white rounded-none flex items-center justify-center font-black text-2xl tracking-tighter uppercase transition-transform active:scale-95 hover:rotate-6 ${getAvatarBg(avatarSeed)}`}
                        title="Randomize avatar identity"
                      >
                        {playerName ? playerName.substring(0, 1).toUpperCase() : "A"}
                      </button>
                      <input 
                        id="player-name"
                        type="text"
                        placeholder="NAME..."
                        value={playerName}
                        onChange={handleNameChange}
                        maxLength={14}
                        className="flex-grow w-0 min-w-0 bg-[#131313] text-white border-[3px] border-white px-2 sm:px-4 font-black text-xs sm:text-sm tracking-wider uppercase placeholder:text-gray-600 focus:outline-none focus:border-[#facc15]"
                      />
                    </div>
                  </div>

                  <hr className="border-t-[2px] border-white opacity-25 my-1" />

                  {/* ACTION 1: QUICK MATCH BATTLE (Image 1 - Yellow card with hard offset shadow) */}
                  <div className="relative group">
                    <button 
                      id="join-battle-btn"
                      onClick={() => {
                        audio.playOpen();
                        joinLobby(false);
                      }}
                      className="relative w-full border-[3px] border-white bg-[#facc15] hover:bg-[#eab308] p-5 flex flex-col items-start transition-all hover:-translate-y-1 hover:-translate-x-1 active:translate-y-0.5 active:translate-x-0.5 text-black"
                    >
                      <div className="w-full flex justify-between items-center mb-1">
                        <Flame className="w-6 h-6 fill-black text-black" />
                        <ArrowRight className="w-6 h-6 stroke-[3]" />
                      </div>
                      <span className="font-black text-xl uppercase tracking-tight">JOIN GAME</span>
                      <span className="text-xs font-bold uppercase tracking-wider text-black/70">Enter the global arena now</span>
                    </button>
                    {/* Hard offset background block */}
                    <div className="absolute inset-0 bg-white translate-x-2 translate-y-2 -z-10 rounded-none border-[3px] border-white" />
                  </div>

                  {/* ACTION 2: SOLO MODE (Image 1 - Play alone) */}
                  <div className="relative group mt-2">
                    <button 
                      id="create-solo-btn"
                      onClick={() => {
                        audio.playOpen();
                        joinLobby(true, undefined, true);
                      }}
                      className="relative w-full border-[3px] border-white bg-[#facc15] hover:bg-[#eab308] p-5 flex flex-col items-start transition-all hover:-translate-y-1 hover:-translate-x-1 active:translate-y-0.5 active:translate-x-0.5 text-black"
                    >
                      <div className="w-full flex justify-between items-center mb-1">
                        <Zap className="w-6 h-6 text-black fill-black" />
                        <ArrowRight className="w-6 h-6 stroke-[3] text-black" />
                      </div>
                      <span className="font-black text-xl uppercase tracking-tight">SOLO MODE</span>
                      <span className="text-xs font-bold uppercase tracking-wider text-black/70">PLAY WITH YOURSELF...</span>
                    </button>
                    {/* Hard offset red/orange block */}
                    <div className="absolute inset-0 bg-white translate-x-2 translate-y-2 -z-10 rounded-none border-[3px] border-white" />
                  </div>

                  {/* ACTION 3: PRIVATE ROOM / HOST CHALLENGE (Image 1 - Dark card, Lock symbol) */}
                  <div className="relative group mt-2">
                    <button 
                      id="create-private-btn"
                      onClick={() => {
                        audio.playOpen();
                        joinLobby(true);
                      }}
                      className="relative w-full border-[3px] border-white bg-[#facc15] hover:bg-[#eab308] p-5 flex flex-col items-start transition-all hover:-translate-y-1 hover:-translate-x-1 active:translate-y-0.5 active:translate-x-0.5 text-black"
                    >
                      <div className="w-full flex justify-between items-center mb-1">
                        <div className="flex gap-1.5">
                          <User className="w-5 h-5 text-black" />
                          <Lock className="w-5 h-5 text-black" />
                        </div>
                        <Plus className="w-6 h-6 stroke-[3] text-black" />
                      </div>
                      <span className="font-black text-xl uppercase tracking-tight">PRIVATE ROOM</span>
                      <span className="text-sm font-bold uppercase tracking-wider text-black/70 mt-1">Challenge friends</span>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-black/50">Up to 5 players</span>
                    </button>
                    {/* Hard offset yellow block */}
                    <div className="absolute inset-0 bg-white translate-x-2 translate-y-2 -z-10 rounded-none border-[3px] border-white" />
                  </div>

                  {/* Private Join lobby code field */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1">
                    <input 
                      id="lobby-code-input"
                      type="text"
                      placeholder="LOBBY CODE..."
                      value={customLobbyId}
                      onChange={(e) => {
                        setCustomLobbyId(e.target.value.toUpperCase());
                        audio.playType();
                      }}
                      maxLength={4}
                      className="w-full bg-[#131313] text-white border-[3px] border-white py-2 px-3 text-center font-black tracking-[0.2em] uppercase placeholder:text-gray-700 focus:outline-none focus:border-[#facc15]"
                    />
                    <button 
                      id="join-private-btn"
                      onClick={() => {
                        audio.playOpen();
                        joinLobby(true, customLobbyId);
                      }}
                      className="w-full border-[3px] border-white bg-[#131313] hover:bg-[#201f1f] text-white font-black uppercase py-2 px-4 text-xs tracking-wider transition-all active:translate-y-0.5"
                    >
                      Enter Code
                    </button>
                  </div>

                  {/* How To Play block (Image 1 - Bottom help button) */}
                  <button 
                    id="toggle-how-to-btn"
                    onClick={() => {
                      setShowHowToPlay(true);
                      audio.playOpen();
                      setTimeout(() => {
                        const card = document.getElementById("rules-container-card");
                        if (card) {
                          card.scrollIntoView({ behavior: "smooth", block: "start" });
                        } else {
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }
                      }, 100);
                    }}
                    className="w-full flex items-center justify-between border-[3px] border-white p-3 text-xs font-black uppercase tracking-widest mt-2 transition-all duration-200 bg-[#131313] text-white hover:bg-black hover:border-[#facc15] hover:text-[#facc15] active:translate-y-0.5"
                  >
                    <span className="flex items-center gap-2">
                      <HelpCircle className="w-4 h-4 text-[#facc15]" />
                      <span>HOW TO PLAY RULES</span>
                    </span>
                    <span className="w-6 h-6 border-2 border-white flex items-center justify-center text-[10px] font-black bg-[#facc15] text-black">?</span>
                  </button>

                  <AnimatePresence>
                    {showHowToPlay && (
                      <motion.div 
                        initial={{ y: "100%" }}
                        animate={{ y: 0 }}
                        exit={{ y: "100%" }}
                        transition={{ type: "spring", damping: 26, stiffness: 220 }}
                        className="absolute inset-0 z-30 bg-[#181717] p-6 flex flex-col"
                      >
                        {/* Terminal Header */}
                        <div className="flex items-center justify-between border-b-[3px] border-white pb-3 shrink-0 mb-4">
                          <span className="font-black text-sm text-[#facc15] tracking-widest flex items-center gap-2">
                            <Flame className="w-4 h-4 text-[#facc15] animate-pulse" />
                            GAME RULES
                          </span>
                          <button 
                            onClick={() => {
                              setShowHowToPlay(false);
                              audio.playClose();
                            }}
                            className="bg-red-600 hover:bg-red-700 text-white border-2 border-white px-2 py-1 text-[9px] font-black uppercase tracking-wider rounded-none transition-all active:translate-y-0.5 shadow-[2px_2px_0px_0px_white]"
                          >
                            CLOSE
                          </button>
                        </div>

                        {/* Interactive Upgraded Rules Sheet */}
                        <div className="flex-grow overflow-y-auto space-y-4 text-xs text-gray-200 font-medium pr-1 select-none">
                          
                          {/* Section 1: The Directive */}
                          <div className="space-y-1.5">
                            <h3 className="font-black text-white text-[11px] uppercase tracking-wider flex items-center gap-1.5 border-b border-white/10 pb-1">
                              ⚠️ HERE'S WHAT YOU'RE GONNA DO
                            </h3>
                            <p className="leading-relaxed">
                              You are handed a ticking bomb. A random set of letters will show up on the screen (e.g., <span className="bg-black/60 px-1.5 py-0.5 border border-white/20 font-mono text-[#facc15] font-black">"TH"</span>).
                            </p>
                            <p className="leading-relaxed">
                              Quickly type a real English word containing those letters in that exact order (e.g., <span className="underline decoration-[#facc15] underline-offset-2 font-bold text-white">TH</span>INK, BA<span className="underline decoration-[#facc15] underline-offset-2 font-bold text-white">TH</span>, or CLO<span className="underline decoration-[#facc15] underline-offset-2 font-bold text-white">TH</span>ES) and press <kbd className="bg-black/60 px-1.5 py-0.5 border border-white/20 text-[#facc15] font-mono text-[9px] uppercase font-black tracking-wider">[Enter]</kbd> to instantly pass the bomb to the next player!
                            </p>
                          </div>

                          {/* Section 2: Overheating Fusion Timers */}
                          <div className="space-y-1.5">
                            <h3 className="font-black text-white text-[11px] uppercase tracking-wider flex items-center gap-1.5 border-b border-white/10 pb-1">
                              ⚡ ESCALATING ROUNDS
                            </h3>
                            <p className="leading-relaxed">
                              Every round, the timer gets faster. A round finishes when everyone has completed a turn (or after 3 turns if playing solo).
                            </p>

                            <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[9px]">
                              <div className="bg-black/40 border border-white/10 p-1.5 flex flex-col justify-between">
                                <span className="text-gray-400 text-[8px] font-black tracking-widest">ROUND 1</span>
                                <span className="text-white font-black">7.0s <span className="text-gray-500 font-sans text-[8px]">/ 1 letter</span></span>
                              </div>
                              <div className="bg-black/40 border border-white/10 p-1.5 flex flex-col justify-between">
                                <span className="text-gray-400 text-[8px] font-black tracking-widest">ROUND 2</span>
                                <span className="text-white font-black">6.0s <span className="text-gray-500 font-sans text-[8px]">/ 2 letters</span></span>
                              </div>
                              <div className="bg-black/40 border border-white/10 p-1.5 flex flex-col justify-between">
                                <span className="text-gray-400 text-[8px] font-black tracking-widest">ROUND 3</span>
                                <span className="text-white font-black">5.0s <span className="text-gray-500 font-sans text-[8px]">/ 3 letters</span></span>
                              </div>
                              <div className="bg-[#facc15]/5 border border-[#facc15]/30 p-1.5 flex flex-col justify-between">
                                <span className="text-[#facc15] text-[8px] font-black tracking-widest">ROUND 4+</span>
                                <span className="text-[#facc15] font-black">Shrinks -0.5s <span className="text-gray-400 text-[8px]">/ floor 2.5s</span></span>
                              </div>
                            </div>
                          </div>

                          {/* Section 3: System Law & Exclusions */}
                          <div className="bg-black/40 border border-white/10 p-3 space-y-1.5">
                            <p className="font-black text-white text-[10px] uppercase flex items-center gap-1">
                              <Info className="w-3.5 h-3.5 text-[#facc15]" /> GAME RULES
                            </p>
                            <ul className="list-disc pl-4 space-y-1 text-[10px] text-gray-300 leading-relaxed">
                              <li><span className="font-bold text-[#facc15]">FUSE DETONATION</span>: If your timer hits zero, the bomb explodes and you lose <span className="text-red-500 font-bold">1 ❤️ Life</span>.</li>
                              <li><span className="font-bold text-[#facc15]">NO REUSING WORDS</span>: You can't use the same word twice. Any word already used in the game is blocked.</li>
                              <li><span className="font-bold text-[#facc15]">REAL WORDS ONLY</span>: Only real English words from the dictionary are allowed. Slang, abbreviations, and shortcuts are banned.</li>
                            </ul>
                          </div>
                        </div>

                        {/* Understood Action Button */}
                        <div className="pt-3 border-t border-white/10 shrink-0">
                          <button
                            onClick={() => {
                              setShowHowToPlay(false);
                              audio.playClose();
                            }}
                            className="w-full bg-[#facc15] hover:bg-[#eab308] text-black font-black uppercase py-2.5 text-xs tracking-widest border-[3px] border-white rounded-none active:translate-y-0.5 transition-colors shadow-[3px_3px_0px_0px_white]"
                          >
                            UNDERSTOOD, LET'S PLAY!
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}

            {/* SCREEN 2: GET READY COUNTDOWN ARENA (Image 2) */}
            {lobby && lobby.status === "countdown" && activeTab === "battle" && (
              <motion.div 
                key="countdown"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.15 }}
                className="flex flex-col items-center justify-center space-y-8 select-none max-w-lg w-full"
              >
                {/* Massive countdown text with hard offset shadow */}
                <h1 className="text-[120px] sm:text-[180px] md:text-[240px] font-black text-white leading-none relative">
                  <span className="relative z-10">{lobby.countdownValue}</span>
                  <span className="absolute inset-0 text-[#facc15] translate-x-3 sm:translate-x-4 translate-y-3 sm:translate-y-4 -z-10 select-none">
                    {lobby.countdownValue}
                  </span>
                </h1>

                <p className="font-black text-2xl md:text-3xl uppercase tracking-[0.2em] text-white animate-pulse">
                  GET READY...
                </p>
                
                {/* Thick yellow progress bar (Image 2) */}
                <div className="w-full max-w-sm h-7 bg-black border-[4px] border-white p-0.5 rounded-none overflow-hidden relative">
                  <motion.div 
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 3, ease: "linear" }}
                    className="h-full bg-[#facc15]"
                  />
                </div>



                {/* Additional Lobby bento descriptors */}
                {lobby.players.length > 1 && (
                  <div className="w-full">
                    <div className="bg-[#1c1b1b] border-[3px] border-white p-3 text-center">
                      <span className="block text-[10px] font-black uppercase text-[#facc15] tracking-widest">PLAYER TOTAL</span>
                      <span className="font-mono text-base font-black text-white">
                        {`${lobby.players.length} PLAYERS`}
                      </span>
                    </div>
                  </div>
                )}

                {/* Bottom button indicator */}
                <button className="w-full bg-[#facc15] text-black border-[3px] border-white py-4 font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2">
                  <Swords className="w-4 h-4" />
                  <span>GAME STARTING SOON...</span>
                </button>
              </motion.div>
            )}

            {/* SCREEN 3: LOBBY SCREEN (Image 3) */}
            {lobby && activeTab === "lobby" && (
              <motion.div 
                key="lobby-screen"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="max-w-2xl w-full space-y-6"
              >
                {/* Lobby Hero Card - "READY FOR BATTLE" (Image 3) */}
                <div className="bg-[#1c1b1b] border-[4px] border-white p-6 relative shadow-[6px_6px_0px_0px_white]">
                  <p className="text-[#facc15] font-black uppercase tracking-[0.25em] text-xs flex items-center gap-2 mb-3">
                    <Flame className="w-4 h-4 fill-[#facc15]" /> READY FOR GAME
                  </p>
                  
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b-2 border-white/10 pb-4">
                    <div>
                      {lobby.isSolo ? (
                        <div>
                          <h2 className="text-xl sm:text-3xl font-black text-white uppercase leading-tight">
                            SOLO GAME RUN
                          </h2>
                          <p className="text-[10.5px] text-gray-400 mt-2 uppercase font-bold">TYPE WORDS WITH THE PROMPT SUBSTRING BEFORE TIME RUNS OUT!</p>
                        </div>
                      ) : (
                        <div>
                          <h2 className="text-xl sm:text-3xl font-black text-white uppercase leading-tight">
                            LOBBY CODE: <span className="text-lg sm:text-3xl text-[#facc15] font-mono bg-[#131313] px-2 py-0.5 sm:px-3 sm:py-1 border-[2px] border-white inline-block mt-1.5 sm:mt-0">{lobby.id}</span>
                          </h2>
                          <p className="text-[10.5px] text-gray-400 mt-2 uppercase font-bold">Invite friends with this room code</p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                      {!lobby.isSolo && (
                        <button 
                          id="copy-link-btn"
                          onClick={copyRoomLink}
                          className="flex-1 sm:flex-initial bg-white text-black hover:bg-gray-100 border-[3px] border-black px-3 py-2 font-black uppercase text-[10px] sm:text-xs rounded-none flex items-center justify-center gap-1.5 transition-all active:translate-y-0.5"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>COPY LINK</span>
                        </button>
                      )}
                      <button 
                        id="leave-btn"
                        onClick={leaveLobby}
                        className="flex-1 sm:flex-initial bg-red-600 text-white hover:bg-red-700 border-[3px] border-white px-3 py-2 font-black uppercase text-[10px] sm:text-xs rounded-none flex items-center justify-center gap-1.5 transition-all active:translate-y-0.5"
                      >
                        <span>QUIT ARENA</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Forfeiture Warning Notification Banner */}
                <div className="bg-red-950/40 border-[3px] border-red-600/70 p-4 flex items-start gap-3 rounded-none shadow-[4px_4px_0px_0px_rgba(220,38,38,0.2)]">
                  <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5 animate-pulse" />
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-red-400 block mb-0.5">⚠️ TAB FOCUS ENFORCED (1-MIN GRACE)</span>
                    <p className="text-xs font-bold uppercase tracking-wide text-white leading-normal">
                      Leaving this tab, switching apps, or going inactive for <span className="text-red-400 font-extrabold underline decoration-red-500 underline-offset-2">more than 1 minute</span> will forfeit the match and remove you from the lobby.
                    </p>
                  </div>
                </div>

                {/* Player Grid Bento (Image 3) - Dynamically support up to 5 players */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {lobby.players.map((player, index) => (
                    <div 
                      key={player.id} 
                      className="bg-[#1c1b1b] border-[3px] border-white p-4 flex items-center justify-between shadow-[4px_4px_0px_0px_white]"
                    >
                      <div className="flex items-center gap-3.5">
                        <div className={`w-12 h-12 border-[3px] border-white flex items-center justify-center font-black text-lg text-white ${getAvatarBg(player.avatarSeed)}`}>
                          {player.name.substring(0, 1).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-black text-base text-white uppercase flex items-center gap-1.5 leading-tight">
                            <span>{player.name}</span>
                            {player.id === playerId && (
                              <span className="text-[9px] bg-white text-black font-black px-1 py-0.2 rounded-none">YOU</span>
                            )}
                          </p>
                          <span className={`${index === 0 ? 'bg-[#facc15] text-black' : 'bg-red-500 text-white'} px-2 py-0.5 font-black text-[9px] uppercase tracking-wider inline-block mt-1`}>
                            {index === 0 ? (lobby.isSolo ? "SOLO PLAYER" : "HOST") : `PLAYER ${index + 1}`}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {index === 0 ? (
                          <div className="w-8 h-8 rounded-none bg-[#facc15] border-2 border-white flex items-center justify-center">
                            <Star className="w-4 h-4 text-black fill-black" />
                          </div>
                        ) : (
                          <div className="w-3 h-3 bg-green-500 animate-ping rounded-none" />
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Vacant slots to fill up if waiting and multiplayer */}
                  {!lobby.isSolo && lobby.players.length < 2 && (
                    <div className="bg-[#1c1b1b] border-[3px] border-white border-dashed p-4 flex flex-col justify-center items-center gap-2 min-h-[84px] relative">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 bg-yellow-400 rounded-none animate-bounce" />
                        <span className="text-xs font-black text-gray-400 uppercase tracking-widest">CONNECTING...</span>
                      </div>
                      <span className="text-[10px] text-gray-500 uppercase font-bold text-center">WAITING FOR PLAYERS TO JOIN</span>
                    </div>
                  )}
                </div>

                {/* System Logs Console Console (Image 3) */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-gray-400">
                    <Terminal className="text-[#facc15] w-4 h-4" />
                    <span className="font-black text-xs uppercase tracking-widest">SYSTEM LOGS</span>
                  </div>
                  <div 
                    ref={logsContainerRef}
                    className="bg-black border-[3px] border-white p-4 h-36 overflow-y-auto font-mono text-[11px] text-green-400 space-y-1 rounded-none select-text"
                  >
                    <div className="text-gray-500">// Wordclart Core Connection Protocol</div>
                    <div className="text-[#facc15]">&gt;&gt; ROOM CODE DETECTED: {lobby.id}</div>
                    {lobby.logs.map((line, idx) => (
                      <div key={idx} className="flex gap-2">
                        <span className="text-gray-600">[{idx}]</span>
                        <span className="text-slate-200">{line}</span>
                      </div>
                    ))}
                    {lobby.isSolo && lobby.players.length === 1 && (
                      <div className="text-[#facc15] animate-pulse mt-2 font-bold uppercase text-[10px]">
                        &gt;&gt; READY FOR SOLO RUN: PRESS 'START SOLO RUN' BELOW!
                      </div>
                    )}
                  </div>
                </div>

                {/* Huge Yellow Start Button Footer (Image 3) */}
                <div>
                  {lobby.players[0]?.id === playerId ? (
                    <button 
                      id="start-battle-btn"
                      onClick={startBattle}
                      disabled={lobby.isSolo ? lobby.players.length < 1 : lobby.players.length < 2}
                      className={`w-full py-5 rounded-none font-black text-xl uppercase tracking-wider border-[3px] border-white transition-all ${
                        (lobby.isSolo ? lobby.players.length >= 1 : lobby.players.length >= 2)
                          ? "bg-[#facc15] text-black hover:bg-[#eab308] shadow-[4px_4px_0px_0px_white] active:translate-y-0.5" 
                          : "bg-gray-800 text-gray-500 cursor-not-allowed border-gray-700"
                      }`}
                    >
                      {lobby.isSolo ? "START SOLO RUN" : lobby.players.length >= 2 ? "START WORD GAME" : "WAITING FOR OPPONENT..."}
                    </button>
                  ) : (
                    <div className="bg-[#1c1b1b] border-[3px] border-white p-4 text-center font-black text-xs text-gray-400 uppercase animate-pulse">
                      Waiting for host ({lobby.players.find(p => p.isHost)?.name || "Player 1"}) to start game...
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* SCREEN 4: ACTIVE BATTLE ARENA (Image 4) */}
            {lobby && activeTab === "battle" && lobby.status !== "countdown" && (
              <motion.div 
                key="battle-screen"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  if (isOurTurn && inputRef.current) {
                    inputRef.current.focus();
                    inputRef.current.click();
                  }
                }}
                className="w-full max-w-2xl flex flex-col space-y-6 cursor-pointer"
              >
                {/* Active turn banner and Quit button */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 w-full border-b-[3px] border-white/20 pb-4">
                  <div className="text-[10px] sm:text-xs font-black text-gray-400 uppercase tracking-widest sm:text-left text-center">
                    ROOM: <span className="text-[#facc15] font-mono">{lobby.id}</span>
                  </div>
                  <div className="text-center flex-1">
                    {isOurTurn ? (
                      <div className="bg-[#facc15] text-black border-[3px] border-white py-2 px-4 sm:px-6 rounded-none inline-block font-black uppercase text-[10px] sm:text-xs tracking-[0.1em] sm:tracking-[0.2em] animate-bounce shadow-[3px_3px_0px_0px_rgba(255,255,255,0.1)]">
                        👉 YOUR TURN! TYPE NOW!
                      </div>
                    ) : (
                      <div className="bg-[#1c1b1b] border-[3px] border-white py-2 px-4 sm:px-6 rounded-none inline-block font-black text-gray-400 uppercase text-[10px] sm:text-xs tracking-[0.1em] sm:tracking-[0.2em]">
                        ⚠️ WAITING FOR {activePlayer ? activePlayer.name.toUpperCase() : "OPPONENT"}...
                      </div>
                    )}
                  </div>
                  <div className="shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation(); // Prevent focusing input when clicking quit
                        leaveLobby();
                      }}
                      className="bg-red-600 hover:bg-red-700 text-white border-[3px] border-white px-4 py-2 text-xs font-black uppercase tracking-widest rounded-none transition-all active:translate-y-0.5 shadow-[3px_3px_0px_0px_white]"
                    >
                      QUIT GAME
                    </button>
                  </div>
                </div>

                {/* Central Prompt Square (Image 4 - Thick Yellow/Red Border Box) */}
                <div className="flex flex-col items-center justify-center py-4">
                  <div className={`relative w-64 h-64 sm:w-72 sm:h-72 rounded-none flex flex-col items-center justify-center border-[5px] transition-all bg-[#1c1b1b] shadow-[8px_8px_0px_0px_rgba(255,255,255,0.1)] ${
                    isOurTurn 
                      ? (getTimerRemainingPercent() <= 35 ? "anxiety-flash-red border-red-500 ring-4 ring-red-500/20" : "border-[#facc15] ring-4 ring-[#facc15]/35") 
                      : "border-red-600/40 opacity-90"
                  }`}>
                    {/* Prompt Header */}
                    <span className="text-gray-400 font-black text-[10px] uppercase tracking-[0.25em] mb-2 select-none">WORD THAT CONTAINS...</span>
                    
                    {/* Word characters required */}
                    <div className="font-black text-5xl sm:text-7xl text-white tracking-wider uppercase select-all font-mono">
                      {lobby.prompt || "RE"}
                    </div>

                    {/* Clock badge top right (Image 4 - Yellow badge) */}
                    <div className={`absolute -top-3.5 -right-3.5 text-black border-[3px] border-white px-3 py-1.5 font-black text-xs flex items-center gap-1.5 shadow-[2px_2px_0px_0px_white] ${
                      isOurTurn ? "bg-[#facc15]" : "bg-red-500 text-white"
                    }`}>
                      <Timer className="w-4 h-4" />
                      <span>{(localTimerRemaining / 1000).toFixed(1)}s LEFT</span>
                    </div>

                    {/* Level Speed indicators */}
                    <div className="absolute -bottom-3.5 left-4 bg-black text-gray-400 border-[2px] border-white/40 px-2.5 py-1 text-[9px] font-bold tracking-widest uppercase flex items-center gap-2">
                      <span>ROUND {lobby.currentRound || 1}</span>
                      <span className="text-gray-600">|</span>
                      <span>Pace: {(lobby.currentTurnDuration / 1000).toFixed(1)}s</span>
                    </div>

                    {/* Active turn badge inside the box */}
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-full text-center px-4">
                      {isOurTurn ? (
                        <span className="text-[#facc15] font-black text-[10px] uppercase tracking-[0.25em] animate-pulse bg-black/60 px-2.5 py-1 border border-[#facc15]/20">
                          ⚡ ACTIVE TURN • YOU ⚡
                        </span>
                      ) : (
                        <span className="text-red-500 font-black text-[10px] uppercase tracking-[0.25em] bg-black/60 px-2.5 py-1 border border-red-500/20">
                          ⏳ {activePlayer ? activePlayer.name.toUpperCase() : "OPPONENT"}'S TURN ⏳
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Spaced Input Field / Real-time typing display */}
                <div className="w-full max-w-md mx-auto" onClick={(e) => e.stopPropagation()}>
                  {isOurTurn ? (
                    <form onSubmit={submitWord} className="relative flex flex-col items-center gap-3">
                      <div className="w-full relative">
                        <input 
                          ref={inputRef}
                          type="text"
                          placeholder="TYPE WORD..."
                          value={inputText}
                          onChange={(e) => {
                            const lettersOnly = e.target.value.replace(/[^a-zA-Z]/g, '');
                            const upper = lettersOnly.toUpperCase();
                            setInputText(upper);
                            audio.playType();
                            if (socketRef.current && lobby) {
                              socketRef.current.send(JSON.stringify({
                                type: "typing_update",
                                lobbyId: lobby.id,
                                text: upper
                              }));
                            }
                          }}
                          disabled={false}
                          maxLength={24}
                          autoFocus
                          className="w-full bg-transparent border-b-[5px] border-[#facc15] py-3 px-12 text-center font-black text-3xl text-white placeholder:text-gray-800 tracking-[0.2em] focus:outline-none uppercase"
                        />
                        {inputText.length > 0 && (
                          <button 
                            type="submit"
                            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-[#facc15] text-black border-2 border-white flex items-center justify-center font-black rounded-none"
                          >
                            ↵
                          </button>
                        )}
                      </div>

                      <p className="text-center text-[10.5px] font-black uppercase tracking-wider text-gray-400">
                        Enter a word containing <span className="text-[#facc15] font-bold">"{lobby.prompt}"</span>
                      </p>
                    </form>
                  ) : (
                    <div className="relative flex flex-col items-center gap-3">
                      <div className="w-full bg-zinc-950/40 border-[3px] border-dashed border-red-500/30 py-4 px-6 text-center select-none min-h-[80px] flex flex-col items-center justify-center relative overflow-hidden">
                        {/* Little indicator tab */}
                        <span className="absolute top-1 left-2 text-[8px] font-black tracking-widest text-red-500 uppercase animate-pulse">
                          LIVE VIEW • {activePlayer ? activePlayer.name.toUpperCase() : "OPPONENT"} IS TYPING
                        </span>
                        
                        <span className="font-mono font-black text-2xl text-[#facc15] tracking-[0.2em] uppercase block break-all pt-2">
                          {activePlayer?.typingText ? (
                            <>
                              {activePlayer.typingText}
                              <span className="animate-ping inline-block w-2.5 h-6 ml-1 bg-[#facc15] align-middle" />
                            </>
                          ) : (
                            <span className="text-gray-600 italic tracking-wider text-sm">WAITING FOR THEM TO TYPE...</span>
                          )}
                        </span>
                      </div>
                      
                      <p className="text-center text-[10.5px] font-black uppercase tracking-wider text-gray-500">
                        You can see what they type in real-time above!
                      </p>
                    </div>
                  )}
                </div>

                {/* Footer players status list (Image 4) */}
                <div className="pt-6 border-t-[4px] border-white">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {lobby.players.map((p) => {
                      const isActive = activePlayer && activePlayer.id === p.id;
                      const isEliminated = p.lives <= 0;
                      const isUs = p.id === playerId;
                      return (
                        <div 
                          key={p.id}
                          className={`p-3 border-[3px] rounded-none transition-all flex flex-col gap-1.5 relative ${
                            isEliminated 
                              ? "bg-[#131313] border-gray-800 opacity-45 grayscale"
                              : isActive 
                              ? isUs 
                                ? "bg-[#1c1b1b] border-[#facc15] shadow-[0_0_15px_rgba(250,204,21,0.4)] animate-pulse" 
                                : "bg-[#1c1b1b] border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)]"
                              : "bg-[#1c1b1b] border-white/40"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-black text-xs text-white uppercase truncate block">
                              {p.name} {isUs && <span className="text-[#facc15] text-[9px] font-bold tracking-widest ml-1">(YOU)</span>}
                            </span>
                            {isActive && !isEliminated && (
                              <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-none uppercase tracking-wider ${
                                isUs ? "bg-[#facc15] text-black" : "bg-red-500 text-white"
                              }`}>
                                {isUs ? "YOUR TURN" : "THEIR TURN"}
                              </span>
                            )}
                          </div>

                          {/* Hearts layout */}
                          <div className="flex gap-1">
                            {[1, 2, 3].map((heartIdx) => {
                              const isAlive = p.lives >= heartIdx;
                              return (
                                <Heart 
                                  key={heartIdx}
                                  className={`w-4 h-4 ${
                                    isEliminated 
                                      ? "text-gray-700 stroke-[2]"
                                      : isAlive 
                                      ? "text-red-500 fill-red-500 stroke-[1.5]" 
                                      : "text-gray-800 stroke-[2]"
                                  }`}
                                />
                              );
                            })}
                          </div>

                          {/* Live typing on the opponent's player card */}
                          {!isEliminated && p.typingText && !isUs && (
                            <div className="mt-1 bg-black/45 px-2 py-1 border border-red-500/20 rounded-none">
                              <span className="text-[7.5px] text-red-400 font-black uppercase tracking-wider block leading-none">TYPING:</span>
                              <span className="text-[11px] font-mono text-[#facc15] font-black truncate block mt-0.5">{p.typingText}</span>
                            </div>
                          )}

                          {/* State labels */}
                          {isEliminated ? (
                            <span className="text-[8px] bg-red-600 text-white font-black px-1 py-0.5 uppercase tracking-wider text-center mt-1">
                              ELIMINATED
                            </span>
                          ) : (
                            isActive && (
                              <div className="h-1.5 w-full bg-gray-800 overflow-hidden mt-1">
                                <div 
                                  className={`h-full transition-[width] duration-30 ease-out ${
                                    isUs ? "bg-[#facc15]" : "bg-red-500"
                                  }`}
                                  style={{ width: `${getTimerRemainingPercent()}%` }}
                                />
                              </div>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

              </motion.div>
            )}

            {/* SCREEN 5: GAME OVER / STATS VIEW (Image 5) */}
            {lobby && activeTab === "stats" && (
              <motion.div 
                key="stats-screen"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="max-w-2xl w-full flex flex-col items-center"
              >
                {/* Result header banner */}
                <div className="text-center mb-6">
                  {(() => {
                    const banner = getGameOverBanner();
                    return (
                      <div className={`mb-3 border-[4px] border-white px-6 py-2 rotate-[-2deg] inline-block font-black text-xl uppercase ${banner.style}`}>
                        {banner.text}
                      </div>
                    );
                  })()}
                  
                  <h2 className="text-5xl md:text-7xl font-black text-white leading-none uppercase tracking-tighter">
                    GAME OVER
                  </h2>
                </div>

                {/* Statistics Bento Grid (Image 5) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full mb-6">
                  
                  {/* Longest word bento card */}
                  <div className="bg-[#1c1b1b] border-[3px] border-white p-5 hover:bg-[#201f1f]">
                    <span className="text-[9px] font-black uppercase tracking-widest text-[#facc15] block mb-1">ACHIEVEMENT</span>
                    <h3 className="font-black text-xs text-gray-400 uppercase">LONGEST WORD</h3>
                    <p className="font-black text-xl text-[#facc15] uppercase mt-2 break-all leading-tight">
                      {lobby.longestWord ? lobby.longestWord.word : "N/A"}
                    </p>
                    <p className="text-[9px] text-gray-500 mt-1 uppercase font-bold">
                      TYPED BY: {lobby.longestWord ? lobby.longestWord.player : "N/A"}
                    </p>
                  </div>

                  {/* Words played bento card */}
                  <div className="bg-[#1c1b1b] border-[3px] border-white p-5 hover:bg-[#201f1f]">
                    <span className="text-[9px] font-black uppercase tracking-widest text-[#facc15] block mb-1">VOLUME</span>
                    <h3 className="font-black text-xs text-gray-400 uppercase">WORDS PLAYED</h3>
                    <p className="font-black text-3xl text-white mt-2 font-mono">
                      {lobby.wordsPlayedCount || "0"}
                    </p>
                    <p className="text-[9px] text-gray-500 mt-2 uppercase font-bold">
                      TOTAL ROUND TURNS
                    </p>
                  </div>

                  {/* Accuracy percentage bento card */}
                  <div className="bg-[#1c1b1b] border-[3px] border-white p-5 hover:bg-[#201f1f]">
                    <span className="text-[9px] font-black uppercase tracking-widest text-[#facc15] block mb-1">PRECISION</span>
                    <h3 className="font-black text-xs text-gray-400 uppercase">WORD ACCURACY</h3>
                    {(() => {
                      const pct = lobby.totalGuesses > 0 
                        ? Math.round((lobby.correctGuesses / lobby.totalGuesses) * 100) 
                        : 100;
                      let colorClass = "text-green-500";
                      if (pct < 50) {
                        colorClass = "text-red-500";
                      } else if (pct < 80) {
                        colorClass = "text-yellow-500";
                      }
                      return (
                        <p className={`font-black text-3xl mt-2 font-mono ${colorClass}`}>
                          {pct}%
                        </p>
                      );
                    })()}
                    <p className="text-[9px] text-gray-500 mt-2 uppercase font-bold">
                      {lobby.correctGuesses} CORRECT OUT OF {lobby.totalGuesses} GUESSES
                    </p>
                  </div>

                </div>

                {/* All words played in the match */}
                <MatchWordHistory lobby={lobby} />

                {/* Bottom Action buttons */}
                <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md justify-center mb-6">
                  <button 
                    id="rematch-btn"
                    onClick={initiateRematch}
                    className="flex-1 bg-[#facc15] text-black border-[3px] border-white py-4 font-black uppercase text-sm transition-all shadow-[3px_3px_0px_0px_white] active:translate-y-0.5"
                  >
                    REMATCH
                  </button>
                  <button 
                    id="return-lobby-btn"
                    onClick={leaveLobby}
                    className="flex-1 bg-white text-black border-[3px] border-black py-4 font-black uppercase text-sm transition-all shadow-[3px_3px_0px_0px_#facc15] active:translate-y-0.5"
                  >
                    MAIN MENU
                  </button>
                </div>



              </motion.div>
            )}

          </AnimatePresence>
        </main>
      </div>



      {/* FLOATING RESPONSE FEEDBACK WIDGET */}
      <AnimatePresence>
        {feedback && (
          <motion.div 
            initial={{ opacity: 0, y: -40, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -15, scale: 0.9 }}
            className={`fixed top-28 left-1/2 -translate-x-1/2 z-[150] px-5 py-3 border-[3px] border-white font-black text-xs uppercase rounded-none shadow-[4px_4px_0px_0px_white] flex items-center gap-2 ${
              feedback.isSuccess ? "bg-green-600 text-white" : "bg-red-600 text-white animate-bounce"
            }`}
          >
            {feedback.isSuccess ? <Check className="w-4 h-4 stroke-[3]" /> : <AlertCircle className="w-4 h-4 stroke-[3]" />}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CUSTOM CROSSHAIR CURSOR FOR PC PLAYERS */}
      <CustomCursor />

    </div>
  );
}

function CustomCursor() {
  const [position, setPosition] = useState({ x: -100, y: -100 });
  const [isHovered, setIsHovered] = useState(false);
  const [isClicked, setIsClicked] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Only activate custom cursor if the device has a fine pointer (e.g. mouse/trackpad)
    const mediaQuery = window.matchMedia("(pointer: fine)");
    if (!mediaQuery.matches) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({ x: e.clientX, y: e.clientY });
      if (!isVisible) setIsVisible(true);
    };

    const handleMouseLeave = () => {
      setIsVisible(false);
    };

    const handleMouseEnter = () => {
      setIsVisible(true);
    };

    const handleMouseDown = () => {
      setIsClicked(true);
    };

    const handleMouseUp = () => {
      setIsClicked(false);
    };

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      
      const isClickable = 
        target.tagName === 'BUTTON' || 
        target.tagName === 'A' || 
        target.tagName === 'INPUT' || 
        target.tagName === 'SELECT' || 
        target.tagName === 'TEXTAREA' || 
        target.closest('button') || 
        target.closest('a') || 
        target.closest('[role="button"]') ||
        target.classList.contains('cursor-pointer') ||
        window.getComputedStyle(target).cursor === 'pointer';

      setIsHovered(!!isClickable);
    };

    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);
    document.addEventListener('mouseenter', handleMouseEnter);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mouseover', handleMouseOver);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      document.removeEventListener('mouseenter', handleMouseEnter);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mouseover', handleMouseOver);
    };
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        zIndex: 99999,
      }}
      className="hidden md:block"
    >
      <motion.div
        animate={{
          rotate: isHovered ? 45 : 0,
          scale: isClicked ? 0.75 : isHovered ? 1.25 : 1,
        }}
        transition={{
          type: "spring",
          stiffness: 450,
          damping: 20,
        }}
        className="w-8 h-8 flex items-center justify-center relative"
      >
        <svg
          width="36"
          height="36"
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]"
        >
          {/* Center dot */}
          <rect
            x="21"
            y="21"
            width="6"
            height="6"
            fill="#facc15"
            stroke="black"
            strokeWidth="2"
            strokeLinejoin="miter"
          />

          {/* North bar */}
          <rect
            x="22"
            y="6"
            width="4"
            height="11"
            fill="#facc15"
            stroke="black"
            strokeWidth="2"
            strokeLinejoin="miter"
          />

          {/* South bar */}
          <rect
            x="22"
            y="31"
            width="4"
            height="11"
            fill="#facc15"
            stroke="black"
            strokeWidth="2"
            strokeLinejoin="miter"
          />

          {/* West bar */}
          <rect
            x="6"
            y="22"
            width="11"
            height="4"
            fill="#facc15"
            stroke="black"
            strokeWidth="2"
            strokeLinejoin="miter"
          />

          {/* East bar */}
          <rect
            x="31"
            y="22"
            width="11"
            height="4"
            fill="#facc15"
            stroke="black"
            strokeWidth="2"
            strokeLinejoin="miter"
          />

          {/* Top-Left Corner L */}
          <path
            d="M 10,19 L 10,10 L 19,10 L 19,14 L 14,14 L 14,19 Z"
            fill="#facc15"
            stroke="black"
            strokeWidth="2"
            strokeLinejoin="miter"
          />

          {/* Top-Right Corner L */}
          <path
            d="M 29,10 L 38,10 L 38,19 L 34,19 L 34,14 L 29,14 Z"
            fill="#facc15"
            stroke="black"
            strokeWidth="2"
            strokeLinejoin="miter"
          />

          {/* Bottom-Left Corner L */}
          <path
            d="M 10,29 L 14,29 L 14,34 L 19,34 L 19,38 L 10,38 Z"
            fill="#facc15"
            stroke="black"
            strokeWidth="2"
            strokeLinejoin="miter"
          />

          {/* Bottom-Right Corner L */}
          <path
            d="M 34,29 L 38,29 L 38,38 L 29,38 L 29,34 L 34,34 Z"
            fill="#facc15"
            stroke="black"
            strokeWidth="2"
            strokeLinejoin="miter"
          />
        </svg>
      </motion.div>
    </div>
  );
}

interface MatchWordHistoryProps {
  lobby: LobbyState;
}

function MatchWordHistory({ lobby }: MatchWordHistoryProps) {
  const [sortBy, setSortBy] = useState<"chrono" | "length" | "alpha">("chrono");
  const [filterPlayer, setFilterPlayer] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const rawWords: { word: string; player: string; round: number; prompt?: string; success?: boolean; turnNumber?: number }[] = lobby.playedWordsDetail || lobby.usedWords.map((word, index) => ({
    word: word,
    player: lobby.isSolo ? "Solo Player" : "Speller",
    round: 1,
    success: true,
    turnNumber: index + 1,
  }));

  // Extract unique players list from played words
  const uniquePlayers = Array.from(new Set(rawWords.map((w) => w.player)));

  // Filter and search
  let processedWords = rawWords.filter((item) => {
    const matchesPlayer = filterPlayer === "all" || item.player === filterPlayer;
    const matchesSearch = item.word.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesPlayer && matchesSearch;
  });

  // Sort
  if (sortBy === "length") {
    processedWords = [...processedWords].sort((a, b) => {
      const lenA = a.word === "TIMEOUT" ? 0 : a.word.length;
      const lenB = b.word === "TIMEOUT" ? 0 : b.word.length;
      return lenB - lenA;
    });
  } else if (sortBy === "alpha") {
    processedWords = [...processedWords].sort((a, b) => a.word.localeCompare(b.word));
  } // 'chrono' is default (already in order of entry)

  return (
    <div className="bg-[#1c1b1b] border-[3px] border-white p-5 w-full mb-6 relative text-left">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b-2 border-gray-800 pb-3 mb-4">
        <div>
          <span className="text-[9px] font-black uppercase tracking-widest text-[#facc15] block mb-1">HISTORY</span>
          <h3 className="font-black text-lg text-white uppercase flex items-center gap-2">
            📜 Turn-by-Turn History ({rawWords.length})
          </h3>
        </div>
        {/* Simple search bar with consistent sans-serif black-caps style */}
        <input
          type="text"
          placeholder="SEARCH WORD..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
          className="bg-black border-[3px] border-gray-700 text-xs text-white px-3 py-1.5 font-black tracking-wider uppercase focus:border-[#facc15] outline-none max-w-[180px] w-full"
        />
      </div>

      {rawWords.length === 0 ? (
        <div className="text-center py-6 text-gray-500 font-bold uppercase text-xs">
          No words were spelled in this match.
        </div>
      ) : (
        <>
          {/* Controls: Player filters & Sort Options */}
          <div className="flex flex-col gap-3 mb-4 text-xs font-bold">
            {/* Player Pills (if multiplayer and multiple players) */}
            {uniquePlayers.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-gray-500 uppercase text-[10px] mr-1">FILTER:</span>
                <button
                  onClick={() => setFilterPlayer("all")}
                  className={`px-2.5 py-1 border-2 text-[10px] transition-all uppercase ${
                    filterPlayer === "all"
                      ? "bg-[#facc15] text-black border-white"
                      : "bg-black text-gray-400 border-gray-800 hover:text-white"
                  }`}
                >
                  ALL
                </button>
                {uniquePlayers.map((player) => (
                  <button
                    key={player}
                    onClick={() => setFilterPlayer(player)}
                    className={`px-2.5 py-1 border-2 text-[10px] transition-all uppercase ${
                      filterPlayer === player
                        ? "bg-[#facc15] text-black border-white"
                        : "bg-black text-gray-400 border-gray-800 hover:text-white"
                    }`}
                  >
                    {player}
                  </button>
                ))}
              </div>
            )}

            {/* Sort Options */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-gray-500 uppercase text-[10px] mr-1">SORT:</span>
              <button
                onClick={() => setSortBy("chrono")}
                className={`px-2.5 py-1 border-2 text-[10px] transition-all uppercase ${
                  sortBy === "chrono"
                    ? "bg-[#facc15] text-black border-white"
                    : "bg-black text-gray-400 border-gray-800 hover:text-white"
                }`}
              >
                PLAY ORDER
              </button>
              <button
                onClick={() => setSortBy("length")}
                className={`px-2.5 py-1 border-2 text-[10px] transition-all uppercase ${
                  sortBy === "length"
                    ? "bg-[#facc15] text-black border-white"
                    : "bg-black text-gray-400 border-gray-800 hover:text-white"
                }`}
              >
                LENGTH
              </button>
              <button
                onClick={() => setSortBy("alpha")}
                className={`px-2.5 py-1 border-2 text-[10px] transition-all uppercase ${
                  sortBy === "alpha"
                    ? "bg-[#facc15] text-black border-white"
                    : "bg-black text-gray-400 border-gray-800 hover:text-white"
                }`}
              >
                A-Z
              </button>
            </div>
          </div>

          {/* Words grid container */}
          {processedWords.length === 0 ? (
            <div className="text-center py-4 text-gray-500 font-bold uppercase text-xs">
              No matching words found.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-[220px] overflow-y-auto pr-1.5 custom-scrollbar">
              {processedWords.map((item, index) => {
                const isTimeout = item.word === "TIMEOUT";
                const isWrong = item.success === false;
                return (
                  <div
                    key={index}
                    className={`bg-black/50 border-2 px-3 py-2 flex items-center justify-between gap-3 text-xs font-mono text-white transition-all ${
                      isTimeout
                        ? "border-red-900/60 hover:border-red-700 bg-red-950/10"
                        : isWrong
                        ? "border-red-950 hover:border-red-800"
                        : "border-gray-800 hover:border-gray-700"
                    }`}
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className={`font-black font-sans uppercase tracking-wide text-sm leading-none ${
                        isTimeout 
                          ? "text-red-400 tracking-wider font-bold animate-pulse" 
                          : isWrong 
                          ? "text-red-500 line-through decoration-red-700/50" 
                          : "text-[#facc15]"
                      }`}>
                        {isTimeout ? "💥 TIMEOUT" : item.word}
                      </span>
                      <div className="flex flex-col gap-0.5 mt-0.5 text-[9px] text-gray-400 uppercase font-sans font-semibold">
                        <span>{item.player}</span>
                        {item.prompt && (
                          <span className="text-cyan-400 font-bold tracking-wider">PROMPT: "{item.prompt}"</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 text-[9px] text-gray-500 font-bold font-sans">
                      <span>TURN: {item.turnNumber || (index + 1)}</span>
                      <span>ROUND: {item.round}</span>
                      <span>LENGTH: {isTimeout ? "-" : item.word.length}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

